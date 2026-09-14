import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FEDERAL_KEY_PREFIX, STATE_KEY_PREFIX } from '@/lib/tax/state/ruleKeys';

/**
 * Architectural guards for the state engine (Phase 5).
 *
 * Scanners, not unit tests. They enforce the properties the engine's
 * correctness rests on — no invented tax data, no cross-namespace reads, no
 * executable admin input, no per-state branching — so a future change cannot
 * quietly break one and still pass a green suite.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STATE = join(ROOT, 'lib/tax/state');
const FEDERAL = join(ROOT, 'lib/tax/federal');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return full.endsWith('.ts') ? [full] : [];
  });
}

function filesIn(dir: string): { rel: string; text: string }[] {
  return sourceFiles(dir).map((path) => ({
    rel: relative(ROOT, path),
    text: readFileSync(path, 'utf8'),
  }));
}

/** Strips comments so prose about a banned construct does not trip the scanner. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const stateFiles = (): { rel: string; text: string }[] => filesIn(STATE);

describe('no invented state tax data', () => {
  it('contains no decimal literal that could be a rate, threshold or wage base', () => {
    const offenders: string[] = [];
    for (const file of stateFiles()) {
      const stripped = code(file.text);
      // Version-like strings ('1.0.0-phase5') are not tax values.
      const withoutVersions = stripped.replace(/'[\w.-]*\d+\.\d+[\w.-]*'/g, "''");
      const matches = withoutVersions.match(/\b\d+\.\d+\b/g) ?? [];
      if (matches.length > 0) {
        offenders.push(`${file.rel}: ${matches.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('names no bracket, rate, threshold or wage-base value', () => {
    // Schemas declare SHAPES. A numeric literal assigned to one of these names
    // would be a value smuggled into code.
    const valueAssignment =
      /\b(rate|ratePercent|wageBase|threshold|bracket|amount|baseWithholding|allowanceAmount)\s*[:=]\s*-?\d/i;
    const offenders = stateFiles()
      .filter((file) => valueAssignment.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('names no real state or territory', () => {
    // A jurisdiction named in engine code is the first step toward a branch per
    // state. Jurisdictions are DATA, supplied per rule row.
    const realJurisdictions =
      /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|Ohio|Oklahoma|Oregon|Pennsylvania|Tennessee|Texas|Utah|Vermont|Virginia|Washington|Wisconsin|Wyoming|Puerto Rico|Guam)\b/i;
    const offenders = stateFiles()
      .filter((file) => realJurisdictions.test(file.text))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('names no real tax year', () => {
    const offenders = stateFiles()
      .filter((file) => /\b20(2[0-9]|3[0-9])\b/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});

describe('no floating-point arithmetic', () => {
  const banned: readonly { readonly name: string; readonly pattern: RegExp }[] = [
    { name: 'toFixed', pattern: /\.toFixed\s*\(/ },
    { name: 'parseFloat', pattern: /\bparseFloat\s*\(/ },
    { name: 'parseInt', pattern: /\bparseInt\s*\(/ },
    { name: 'Math.round', pattern: /\bMath\.round\s*\(/ },
  ];

  for (const { name, pattern } of banned) {
    it(`no state module uses ${name}`, () => {
      const offenders = stateFiles()
        .filter((file) => pattern.test(code(file.text)))
        .map((file) => file.rel);
      expect(offenders).toEqual([]);
    });
  }
});

describe('no executable admin-authored input', () => {
  const banned: readonly { readonly name: string; readonly pattern: RegExp }[] = [
    { name: 'eval', pattern: /\beval\s*\(/ },
    { name: 'the Function constructor', pattern: /\bnew\s+Function\s*\(/ },
    { name: 'a dynamic import of a string', pattern: /\bimport\s*\(\s*[^'"\s)]/ },
    { name: 'setTimeout with a string body', pattern: /setTimeout\s*\(\s*['"]/ },
  ];

  for (const { name, pattern } of banned) {
    it(`no state module uses ${name}`, () => {
      const offenders = stateFiles()
        .filter((file) => pattern.test(code(file.text)))
        .map((file) => file.rel);
      expect(offenders).toEqual([]);
    });
  }

  it('declares formula operations as a closed enum, never a free expression', () => {
    // An administrator transcribing a published formula must not be able to
    // author executable code, even by accident.
    const schemas = readFileSync(join(STATE, 'rules/detailSchemas.ts'), 'utf8');
    expect(schemas).toContain('StateFormulaOperation');
    expect(schemas).toMatch(/StateFormulaOperation\s*=\s*z\.enum\(/);
    expect(schemas).not.toMatch(/expression\s*:\s*z\.string/);
  });
});

describe('boundaries', () => {
  it('imports no database client or Prisma at this stage', () => {
    // Step 1 is contracts only. The future state resolver is the one module
    // that may reach for the database, and it does not exist yet.
    const offenders = stateFiles()
      .filter((file) => /from '@\/lib\/db\/|getPrisma|PrismaClient/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('imports nothing from /app or /components', () => {
    const offenders = stateFiles()
      .filter((file) => /from '@\/(app|components)\//.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('imports no frontend dependency', () => {
    const offenders = stateFiles()
      .filter((file) => /from '(react|next|next\/[\w/-]+|react-dom)'/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});

describe('state and federal namespaces stay disjoint', () => {
  it('state code reads no FED.* rule key', () => {
    const offenders = stateFiles()
      .filter((file) => {
        const stripped = code(file.text);
        // ruleKeys.ts names the federal PREFIX so guards can assert its absence;
        // that declaration is the one permitted mention.
        const withoutPrefixDeclaration = stripped.replace(/FEDERAL_KEY_PREFIX\s*=\s*'FED\.'/, '');
        return /'FED\.[A-Z0-9_.]*'/.test(withoutPrefixDeclaration);
      })
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('state code imports no federal rule key module', () => {
    const offenders = stateFiles()
      .filter((file) => /from '[^']*federal\/rule-keys'/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('federal code reads no STATE.* rule key', () => {
    const offenders = filesIn(FEDERAL)
      .filter((file) => /'STATE\.[A-Z0-9_.]*'/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('federal code imports nothing from the state engine', () => {
    const offenders = filesIn(FEDERAL)
      .filter((file) => /from '[^']*tax\/state/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('keeps the two prefixes distinct', () => {
    expect(STATE_KEY_PREFIX).not.toBe(FEDERAL_KEY_PREFIX);
    expect(STATE_KEY_PREFIX.startsWith(FEDERAL_KEY_PREFIX)).toBe(false);
    expect(FEDERAL_KEY_PREFIX.startsWith(STATE_KEY_PREFIX)).toBe(false);
  });
});

describe('no per-state dispatch', () => {
  it('branches on no state code', () => {
    // The difference between fifty-one jurisdictions lives in RULE DATA. A
    // conditional on a state code is how a 50-state engine becomes fifty
    // engines that drift apart.
    const stateCodeComparison =
      /(===|!==|case)\s*'(?:US-)?(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)'/;
    const offenders = stateFiles()
      .filter((file) => stateCodeComparison.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('dispatches on declared method, not on jurisdiction', () => {
    const schemas = readFileSync(join(STATE, 'rules/detailSchemas.ts'), 'utf8');
    // METHOD_DESCRIPTOR is the one permitted form of dispatch.
    expect(schemas).toContain("shape: z.literal('METHOD_DESCRIPTOR')");
  });
});

describe('Step 1 scope', () => {
  it('contains no calculation entry point yet', () => {
    // Contracts only. A calculate function here would mean Step 2+ leaked in.
    const offenders = stateFiles()
      .filter((file) => /export function calculateState/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('adds no deduction limit to the Phase 3 input contract', () => {
    // D-DED-1: statutory programme caps are rule-side facts; generic elective
    // deduction limits are out of scope and must not appear on DeductionInput.
    const input = readFileSync(join(ROOT, 'lib/calculator/types/input.ts'), 'utf8');
    const deductionInput = /export interface DeductionInput \{[\s\S]*?\n\}/.exec(input)?.[0] ?? '';
    expect(deductionInput.length).toBeGreaterThan(0);
    expect(deductionInput).not.toMatch(/annualLimit|perPeriodLimit|contributionLimit|maxAmount/);
  });
});

describe('Step 2 coverage scope', () => {
  it('claims support for no jurisdiction by default', () => {
    // Every production cell starts PENDING_RESEARCH. A literal SUPPORTED in the
    // coverage implementation would be a claim nobody researched.
    const coverage = code(readFileSync(join(STATE, 'coverage/coverage.ts'), 'utf8'));
    expect(coverage).toContain(
      'INITIAL_COVERAGE_STATUS: CoverageStatus = CoverageStatus.PENDING_RESEARCH',
    );
  });

  it('hardcodes no jurisdiction list', () => {
    // The 51 come from the seeded jurisdiction repository. A second list here
    // would be a second thing to keep in step, and the seed is authoritative.
    const offenders = stateFiles()
      .filter((file) => /\bSTATES\s*[:=]\s*\[|'US-[A-Z]{2}'/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('fabricates no source URL', () => {
    // Evidence references Phase 2 Source ids. There is nowhere for an invented
    // citation to live, and no http(s) literal anywhere under the state engine.
    const offenders = stateFiles()
      .filter((file) => /https?:\/\//.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('persists nothing — the coverage model touches no database', () => {
    const coverage = code(readFileSync(join(STATE, 'coverage/coverage.ts'), 'utf8'));
    expect(coverage).not.toMatch(/prisma|getPrisma|findMany|create\(/i);
  });

  it('keeps the readiness gate dependent on the cell alone', () => {
    // assessSupport takes one argument. It cannot reach for the engine, a
    // resolver, or whether a calculation would succeed.
    const coverage = code(readFileSync(join(STATE, 'coverage/coverage.ts'), 'utf8'));
    expect(coverage).toContain('export function assessSupport(cell: CoverageCell)');
  });
});
