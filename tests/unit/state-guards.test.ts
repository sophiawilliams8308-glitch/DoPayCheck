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

describe('Step 3.1 scope — prohibited resolver architecture is absent', () => {
  it('implements no second effective-date predicate', () => {
    // Phase 2 owns effective-window applicability. A second predicate would be a
    // second source of truth about which rule governs a paycheck.
    const offenders = stateFiles()
      .filter((file) =>
        /function\s+isEffective|effectiveTo\s*[<>]|effectiveFrom\s*[<>]/.test(code(file.text)),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('creates none of the deferred Step 3 modules', () => {
    // precedence, applicability evaluation, a coverage gate and orchestration
    // all belong to later sub-steps.
    const present = stateFiles().map((file) => file.rel);
    for (const deferred of [
      'lib/tax/state/resolver/resolver.ts',
      'lib/tax/state/resolver/precedence.ts',
      'lib/tax/state/resolver/applicability.ts',
      'lib/tax/state/resolver/coverage-gate.ts',
      'lib/tax/state/precedence.ts',
      'lib/tax/state/effective-date.ts',
      'lib/tax/state/effective-instant.ts',
    ]) {
      expect(present, `${deferred} belongs to a later step`).not.toContain(deferred);
    }
  });

  it('adds no precedence ranking, caching or expression evaluation', () => {
    const offenders = stateFiles()
      .filter((file) =>
        /\brank\(|\bprecedence\b|specificityVector|new Map\(\).*cache|\bcacheIdentity\b/i.test(
          code(file.text),
        ),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('keeps the resolver projection free of money and identity fields', () => {
    const projection = code(readFileSync(join(STATE, 'resolutionContext.ts'), 'utf8'));
    for (const forbidden of [
      'employeeCategory',
      'reciprocityContext',
      'localContext',
      'employerJurisdiction',
      'ruleDataVersion',
      'PREVIEW',
    ]) {
      expect(projection, `${forbidden} must not appear`).not.toContain(forbidden);
    }
    // `wages`/`ytd` may be READ from the argument but must never be emitted.
    expect(projection).not.toMatch(/^\s*wages:/m);
    expect(projection).not.toMatch(/^\s*ytd:/m);
  });

  it('does not import or modify the Phase 2 provider', () => {
    const offenders = stateFiles()
      .filter((file) => /from '@\/lib\/rules\/repository'/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('defines the capability vocabulary exactly once', () => {
    // CapabilityCode aliases Step 2's StateCapability; a second list of the 13
    // members would be two vocabularies drifting apart.
    const offenders = stateFiles()
      .filter((file) => !file.rel.endsWith('coverage/capabilities.ts'))
      .filter((file) => /INCOME_TAX:\s*'INCOME_TAX'/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});

describe('Step 3.2 scope — validation only, F-02 stays deferred', () => {
  it('introduces no capability -> rule-key mapping', () => {
    // The whole reason F-02 is deferred: deciding what a capability NEEDS
    // requires a mapping nobody has approved yet. No file may import the rule
    // key namespace to build one, however indirectly.
    const offenders = stateFiles()
      .filter((file) => file.rel.endsWith('resolutionContext.ts'))
      .filter((file) =>
        /StateRuleKey|from '\.\/ruleKeys'|'STATE\.[A-Z0-9_.]*'/.test(code(file.text)),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('constructs no required-key list', () => {
    const offenders = stateFiles()
      .filter((file) => file.rel.endsWith('resolutionContext.ts'))
      .filter((file) => /requiredKeys|REQUIRED_KEYS|requiredRuleKeys/i.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('produces no MISSING_REQUIRED_CONTEXT outcome — the symbol does not exist here', () => {
    const validation = code(readFileSync(join(STATE, 'resolutionContext.ts'), 'utf8'));
    expect(validation).not.toContain('MISSING_REQUIRED_CONTEXT');
  });

  it('applies no format/case/length/regex rule to a jurisdiction field', () => {
    // Jurisdiction validation is structural-only (Amendment 2 / F-5): blank vs
    // non-blank, nothing else. No RegExp may be applied to either field.
    const validation = readFileSync(join(STATE, 'resolutionContext.ts'), 'utf8');
    const jurisdictionSection =
      /\/\/ ---- 3\. workJurisdiction[\s\S]*?\/\/ ---- 5\./.exec(validation)?.[0] ?? '';
    expect(jurisdictionSection.length).toBeGreaterThan(0);
    expect(jurisdictionSection).not.toMatch(/\/[^/\n]+\/\.test\(/);
  });

  it('validation applies no effective-date filtering', () => {
    const validation = code(readFileSync(join(STATE, 'resolutionContext.ts'), 'utf8'));
    expect(validation).not.toMatch(/effectiveFrom|effectiveTo|isEffectiveAt/);
  });

  it('performs no monetary arithmetic and touches no money type', () => {
    const validation = code(readFileSync(join(STATE, 'resolutionContext.ts'), 'utf8'));
    expect(validation).not.toMatch(/from '@\/lib\/core\/money'|\bMoney\b|\bDecimal\b/);
  });

  it('the validator is synchronous, so it cannot itself await a query', () => {
    const validation = readFileSync(join(STATE, 'resolutionContext.ts'), 'utf8');
    expect(validation).toContain('export function validateResolutionContext(');
    expect(validation).not.toContain('export async function validateResolutionContext(');
  });
});

describe('Amendment 3 scope — capabilitiesRequested is caller-supplied, F-02 stays deferred', () => {
  it('projectResolutionContext requires the argument — no optional flag, no default value', () => {
    const source = code(readFileSync(join(STATE, 'resolutionContext.ts'), 'utf8'));
    const signature =
      /export function projectResolutionContext\(([\s\S]*?)\):/.exec(source)?.[1] ?? '';
    expect(signature.length).toBeGreaterThan(0);
    // Neither `capabilitiesRequested?:` nor `capabilitiesRequested: ... = ...`.
    expect(signature).not.toMatch(/capabilitiesRequested\s*\?/);
    expect(signature).not.toMatch(/capabilitiesRequested\s*:[^,)]*=/);
  });

  it('does not read capabilitiesRequested from StateCalculationContext', () => {
    // StateCalculationContext (Step 1, context.ts) must not grow a field this
    // projection could read instead of taking the explicit argument.
    const contextSource = code(readFileSync(join(STATE, 'context.ts'), 'utf8'));
    expect(contextSource).not.toMatch(/capabilitiesRequested/);

    const projectionSource = code(readFileSync(join(STATE, 'resolutionContext.ts'), 'utf8'));
    expect(projectionSource).not.toMatch(/calcContext\.\w*[Cc]apabilit\w*/);
  });

  it('does not read capabilitiesRequested from CalculationInput', () => {
    const inputSource = code(readFileSync(join(ROOT, 'lib/calculator/types/input.ts'), 'utf8'));
    expect(inputSource).not.toMatch(/capabilitiesRequested/i);

    const projectionSource = code(readFileSync(join(STATE, 'resolutionContext.ts'), 'utf8'));
    expect(projectionSource).not.toMatch(/from '@\/lib\/calculator\/types\/input'/);
  });

  it('has no production path that manufactures an empty capabilitiesRequested itself', () => {
    // The one place `new Set()`/`new Set<CapabilityCode>()` may appear with no
    // argument is the deferred `wageTypesPresent` line — never the
    // capabilitiesRequested line, which must copy the parameter instead.
    const source = readFileSync(join(STATE, 'resolutionContext.ts'), 'utf8');
    const capabilitiesLine = source
      .split('\n')
      .find((line) => /capabilitiesRequested:\s*new Set/.test(line));
    expect(capabilitiesLine).toBeDefined();
    expect(capabilitiesLine).toMatch(/new Set<CapabilityCode>\(capabilitiesRequested\)/);
    expect(capabilitiesLine).not.toMatch(/new Set<CapabilityCode>\(\)/);
  });

  it('still introduces no capability -> rule-key mapping', () => {
    // Re-asserted after Amendment 3: accepting an explicit request set must not
    // have grown into resolving what that request needs.
    const offenders = stateFiles()
      .filter((file) => file.rel.endsWith('resolutionContext.ts'))
      .filter((file) =>
        /StateRuleKey|from '\.\/ruleKeys'|'STATE\.[A-Z0-9_.]*'/.test(code(file.text)),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});
