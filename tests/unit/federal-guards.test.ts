import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { statusForFederalReason } from '@/lib/tax/federal/errors/federal-errors';
import { FederalRuleKey } from '@/lib/tax/federal/rule-keys';
import { PUB_15T_REQUIRED_KEYS, checkTrackBProvenance } from '@/lib/tax/federal/rules/provenance';

/**
 * Architectural guards for the federal engine (Phase 4).
 *
 * These are scanners, not unit tests. They enforce the properties the engine's correctness
 * rests on — purity, no invented tax data, no annual/withholding substitution — so a future
 * change cannot quietly break one and still pass a green suite.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FEDERAL = join(ROOT, 'lib/tax/federal');

/** Stage A is the ONE module allowed to touch the outside world. */
const STAGE_A = 'lib/tax/federal/rules/resolver.ts';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return full.endsWith('.ts') ? [full] : [];
  });
}

function federalFiles(): { path: string; rel: string; text: string }[] {
  return sourceFiles(FEDERAL).map((path) => ({
    path,
    rel: relative(ROOT, path),
    text: readFileSync(path, 'utf8'),
  }));
}

/** Strips comments so prose about a banned construct does not trip the scanner. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('Stage B purity', () => {
  const banned: readonly { readonly name: string; readonly pattern: RegExp }[] = [
    { name: 'Date.now()', pattern: /\bDate\.now\s*\(/ },
    { name: 'new Date() with no argument', pattern: /new Date\s*\(\s*\)/ },
    { name: 'process.env', pattern: /\bprocess\.env\b/ },
    { name: 'Math.random', pattern: /\bMath\.random\s*\(/ },
    { name: 'fetch', pattern: /\bfetch\s*\(/ },
    { name: 'a Prisma client', pattern: /getPrisma|PrismaClient/ },
  ];

  for (const { name, pattern } of banned) {
    it(`no pure federal module uses ${name}`, () => {
      const offenders = federalFiles()
        .filter((file) => file.rel !== STAGE_A)
        .filter((file) => pattern.test(code(file.text)))
        .map((file) => file.rel);
      expect(offenders).toEqual([]);
    });
  }

  it('only the resolver imports the database client', () => {
    // `@/lib/db/generated/client` is type-only and erased; `@/lib/db/client` is the live
    // Prisma accessor, and exactly one module may reach for it.
    const offenders = federalFiles()
      .filter((file) => /from '@\/lib\/db\/client'/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([STAGE_A]);
  });

  it('the engine entry point is synchronous', () => {
    const index = readFileSync(join(FEDERAL, 'index.ts'), 'utf8');
    expect(index).toContain('export function calculateFederalTaxes');
    expect(index).not.toContain('export async function calculateFederalTaxes');
  });
});

describe('no invented tax data', () => {
  it('no federal module contains a decimal literal that could be a rate or threshold', () => {
    const offenders: string[] = [];

    for (const file of federalFiles()) {
      const stripped = code(file.text);
      // Version strings like '4.0.0-phase4' are not tax values.
      const withoutVersions = stripped.replace(/'[\w.-]*\d+\.\d+[\w.-]*'/g, "''");
      const matches = withoutVersions.match(/\b\d+\.\d+\b/g) ?? [];
      if (matches.length > 0) {
        offenders.push(`${file.rel}: ${matches.join(', ')}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('no federal module names a real tax year', () => {
    // The 2020 W-4 redesign is a METHODOLOGY boundary, not a tax year, so every spelling of
    // it — including the hyphenated prose form — is removed before the scan.
    const w4RevisionNames =
      /[Pp][Rr][Ee][-_]?2020|REVISION_2020_PLUS|POST2019|2019-or-earlier|2020-or-later/g;
    const offenders = federalFiles()
      .filter((file) => /\b20(2[0-9]|3[0-9])\b/.test(code(file.text).replace(w4RevisionNames, '')))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});

describe('Track A and Track B cannot substitute for one another', () => {
  it('withholding modules never read an annual rule key', () => {
    const offenders = federalFiles()
      .filter((file) => file.rel.includes('/fit/') && !file.rel.includes('annualLiability'))
      .filter((file) =>
        /FED\.ANNUAL\.|ANNUAL_RATE_SCHEDULE|ANNUAL_STANDARD_DEDUCTION/.test(code(file.text)),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('the annual module never reads a withholding rule key', () => {
    const annual = code(readFileSync(join(FEDERAL, 'fit/annualLiability.ts'), 'utf8'));
    expect(annual).not.toMatch(/FIT_WORKSHEET_1A|FIT_SUPPLEMENTAL|FED\.FIT\./);
  });

  it('the two namespaces stay distinct', () => {
    const keys = readFileSync(join(FEDERAL, 'rule-keys.ts'), 'utf8');
    // Track B withholding and Track A annual liability each keep their own
    // namespace, so a mis-wiring is a visibly different string (§2.5).
    expect(keys).toContain("FIT_RATE_SCHEDULE_STANDARD: 'FED.FIT.RATE_SCHEDULE.ANNUAL.STANDARD'");
    expect(keys).toContain("ANNUAL_RATE_BRACKETS: 'FED.ANNUAL.RATE_BRACKETS'");

    const declared = [...keys.matchAll(/'(FED\.[A-Z0-9_.]+)'/g)].map((match) => match[1] ?? '');
    expect(declared.length).toBeGreaterThan(0);
    // No key may live in both namespaces.
    for (const key of declared) {
      expect(key.startsWith('FED.ANNUAL.') && key.startsWith('FED.FIT.')).toBe(false);
    }
  });
});

describe('no floating-point arithmetic (§35.4)', () => {
  const banned: readonly { readonly name: string; readonly pattern: RegExp }[] = [
    { name: 'toFixed', pattern: /\.toFixed\s*\(/ },
    { name: 'parseFloat', pattern: /\bparseFloat\s*\(/ },
    { name: 'Number(', pattern: /\bNumber\s*\(/ },
    { name: 'Math.round', pattern: /\bMath\.round\s*\(/ },
  ];

  for (const { name, pattern } of banned) {
    it(`no federal module uses ${name}`, () => {
      // Money is decimal.js end to end. A single float conversion would round a
      // cent away silently, and a paycheck is where that shows up.
      const offenders = federalFiles()
        .filter((file) => pattern.test(code(file.text)))
        .map((file) => file.rel);
      expect(offenders).toEqual([]);
    });
  }
});

describe('import boundary (§35.4)', () => {
  it('no federal module imports from /app or /components', () => {
    // The engine must stay usable without a UI: a React import here would make
    // the calculation untestable in isolation and invite presentation logic in.
    const offenders = federalFiles()
      .filter((file) => /from '@\/(app|components)\//.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});

describe('source provenance (§35.4)', () => {
  it('the Track B schedule keys require Pub. 15-T', () => {
    expect(PUB_15T_REQUIRED_KEYS).toContain(FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD);
    expect(PUB_15T_REQUIRED_KEYS).toContain(FederalRuleKey.FIT_RATE_SCHEDULE_STEP2);
  });

  it('accepts a schedule cited to Pub. 15-T, however it is spelled', () => {
    for (const source of [
      { code: 'IRS-PUB-15-T-2099', title: 'Federal Income Tax Withholding Methods' },
      { code: 'SYNTHETIC-A', title: 'Publication 15-T' },
      { code: 'SYNTHETIC-B', title: 'IRS Pub 15T' },
    ]) {
      expect(checkTrackBProvenance(FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD, [source])).toBeNull();
    }
  });

  it('refuses a withholding schedule cited to the annual tax tables', () => {
    // The substitution that would silently mis-withhold every paycheck.
    const problem = checkTrackBProvenance(FederalRuleKey.FIT_RATE_SCHEDULE_STANDARD, [
      { code: 'IRS-REV-PROC-SYNTHETIC', title: 'Annual inflation adjustments' },
    ]);
    expect(problem?.reason).toBe('SOURCE_PROVENANCE_MISMATCH');
    expect(statusForFederalReason('SOURCE_PROVENANCE_MISMATCH')).toBe('RULE_CONFLICT');
  });

  it('leaves keys outside Track B alone', () => {
    expect(
      checkTrackBProvenance(FederalRuleKey.SS_EMPLOYEE_RATE, [
        { code: 'SYNTHETIC-C', title: 'Some other document' },
      ]),
    ).toBeNull();
  });

  it('the resolver applies the check', () => {
    const resolver = code(readFileSync(join(FEDERAL, 'rules/resolver.ts'), 'utf8'));
    expect(resolver).toContain('checkTrackBProvenance');
  });
});

describe('no deduction-type literals (§35.4)', () => {
  it('federal calculation code names no deduction type', () => {
    // Taxability is DATA (§12.4). A literal here would hardcode one employer's
    // plan naming into the engine and bypass the sourced profile entirely.
    const deductionTypes =
      /\b(?:401K|403B|457B|HSA|FSA|SECTION_?125|CAFETERIA|ROTH|SIMPLE_?IRA|SEP_?IRA|COMMUTER|DEPENDENT_?CARE)\b/i;
    const offenders = federalFiles()
      .filter((file) => deductionTypes.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});

describe('fixture isolation (§35.4)', () => {
  it('no synthetic fixture is reachable from production code', () => {
    const offenders = sourceFiles(join(ROOT, 'lib'))
      .filter((path) =>
        /from '[^']*(?:tests|fixtures|synthetic)[^']*'/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => relative(ROOT, path));
    expect(offenders).toEqual([]);
  });

  it('every synthetic fixture declares itself synthetic', () => {
    const fixtures = sourceFiles(join(ROOT, 'tests/fixtures/federal'));
    expect(fixtures.length).toBeGreaterThan(0);
    for (const path of fixtures) {
      expect(readFileSync(path, 'utf8')).toContain('SYNTHETIC');
    }
  });
});

describe('employer and employee separation', () => {
  it('the Additional Medicare module exposes no employer rate', () => {
    const source = code(readFileSync(join(FEDERAL, 'fica/additional-medicare.ts'), 'utf8'));
    expect(source).not.toMatch(/employerRate/);
  });

  it('the FUTA module exposes no employee figure', () => {
    const source = code(readFileSync(join(FEDERAL, 'employer/futa.ts'), 'utf8'));
    expect(source).not.toMatch(/\bemployee\b/);
  });
});
