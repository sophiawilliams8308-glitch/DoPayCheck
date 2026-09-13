import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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
    const w4RevisionNames = /[Pp][Rr][Ee][-_]?2020|REVISION_2020_PLUS/g;
    const offenders = federalFiles()
      .filter((file) => /\b20(2[0-9]|3[0-9])\b/.test(code(file.text).replace(w4RevisionNames, '')))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('production code never imports a synthetic fixture', () => {
    const offenders = sourceFiles(join(ROOT, 'lib'))
      .filter(
        (path) =>
          /synthetic|fixtures/.test(readFileSync(path, 'utf8')) &&
          /import .*fixtures/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => relative(ROOT, path));
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
    expect(keys).toContain("FIT_WORKSHEET_1A: 'FED.FIT.WORKSHEET_1A'");
    expect(keys).toContain("ANNUAL_RATE_SCHEDULE: 'FED.ANNUAL.RATE_SCHEDULE'");
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
