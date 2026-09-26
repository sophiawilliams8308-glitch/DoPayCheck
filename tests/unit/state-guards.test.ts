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
  it('imports no database client or Prisma, except the one intentional Step 3.5 seam', () => {
    // Steps 1-3.4 are contracts/pure logic only. Step 3.5's candidate
    // retrieval is the one module explicitly designed to reach the database
    // (lib/tax/state/rules/candidateRetrieval.ts) — everything else in this
    // tree must stay exactly as DB-free as it always was.
    const offenders = stateFiles()
      .filter((file) => !file.rel.endsWith('rules/candidateRetrieval.ts'))
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
  it('confines the calculation entry point to the one approved module', () => {
    // Originally (af980f5, Phase 5 Step 1): "contains no calculation entry
    // point yet" — the engine was contracts-only, and any calculateState*
    // export here would mean Step 2+ had leaked in. The engine has since
    // progressed through Steps 2-4 (CLAUDE.md §6); DM-03 Slice 8 added the
    // one approved entry point, calculateStateTaxes() in
    // lib/tax/state/index.ts. What this guard protects — calculation logic
    // never scattered across more than one exported entry point — still
    // holds, so the prohibition is scoped to exclude that one file rather
    // than retired outright, mirroring the Step 3.5 boundary guard below,
    // which excludes its own one approved exception the same way.
    const offenders = stateFiles()
      .filter((file) => file.rel !== 'lib/tax/state/index.ts')
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

describe('Step 3.3 scope — coverage gate only, F-02 stays deferred', () => {
  it('introduces no capability -> rule-key mapping in the coverage gate', () => {
    const offenders = stateFiles()
      .filter((file) => file.rel.endsWith('coverageGate.ts'))
      .filter((file) =>
        /StateRuleKey|from '\.\/ruleKeys'|'STATE\.[A-Z0-9_.]*'/.test(code(file.text)),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('imports no candidate-rule retrieval module (Step 3.4 does not exist yet)', () => {
    const gate = code(readFileSync(join(STATE, 'coverageGate.ts'), 'utf8'));
    expect(gate).not.toMatch(/retrieveCandidates|candidateRetrieval|from '\.\/rules\/retrieve/i);
  });

  it('the gate is synchronous, so it cannot itself await a candidate-rule query', () => {
    const gate = readFileSync(join(STATE, 'coverageGate.ts'), 'utf8');
    expect(gate).toContain('export function consultCoverage(');
    expect(gate).not.toContain('export async function consultCoverage(');
  });

  it('does not build a second coverage model or a jurisdiction vocabulary', () => {
    const gate = code(readFileSync(join(STATE, 'coverageGate.ts'), 'utf8'));
    expect(gate).not.toMatch(/\bSTATES\s*[:=]\s*\[|'US-[A-Z]{2}'/);
    // Reuses Step 2's matrix/cell lookup rather than a second data source.
    expect(gate).toContain("from './coverage/coverage'");
  });

  it('performs no monetary arithmetic and touches no tax value', () => {
    const gate = code(readFileSync(join(STATE, 'coverageGate.ts'), 'utf8'));
    expect(gate).not.toMatch(/from '@\/lib\/core\/money'|\bMoney\b|\bDecimal\b/);
    expect(gate).not.toMatch(/\b\d+\.\d+\b/);
  });

  it('never collapses the eight coverage statuses into one generic outcome', () => {
    // Every status must reach its own switch branch — a `default:` here would
    // let two different statuses silently share a fate.
    const gate = readFileSync(join(STATE, 'coverageGate.ts'), 'utf8');
    const consultCoverageBody =
      /export function consultCoverage\([\s\S]*?\n\}/.exec(gate)?.[0] ?? '';
    expect(consultCoverageBody.length).toBeGreaterThan(0);
    expect(consultCoverageBody).not.toMatch(/^\s*default:/m);
  });
});

describe('Step 3.4 scope — F-02 mapping only, no later-stage functionality', () => {
  it('imports no database client or Prisma', () => {
    const mapping = code(readFileSync(join(STATE, 'capabilityRuleKeys.ts'), 'utf8'));
    expect(mapping).not.toMatch(/from '@\/lib\/db\/|getPrisma|PrismaClient|prisma/i);
  });

  it('does not import candidate retrieval or rule resolution (neither exists yet)', () => {
    const mapping = code(readFileSync(join(STATE, 'capabilityRuleKeys.ts'), 'utf8'));
    expect(mapping).not.toMatch(
      /retrieveCandidates|candidateRetrieval|resolveRule|from '\.\/resolver/i,
    );
  });

  it('performs no monetary arithmetic and touches no tax value', () => {
    const mapping = code(readFileSync(join(STATE, 'capabilityRuleKeys.ts'), 'utf8'));
    expect(mapping).not.toMatch(/from '@\/lib\/core\/money'|\bMoney\b|\bDecimal\b/);
    expect(mapping).not.toMatch(/\b\d+\.\d+\b/);
  });

  it('does not import or reference the CoverageMatrix / coverage gate at all', () => {
    // F-02 and the Coverage Gate are independent seams — this file must not
    // reach into Step 3.3's module or its data.
    const mapping = code(readFileSync(join(STATE, 'capabilityRuleKeys.ts'), 'utf8'));
    expect(mapping).not.toMatch(/CoverageMatrix|findCoverageCell|consultCoverage|coverageGate/);
  });

  it('does not introduce a second coverage model', () => {
    const mapping = code(readFileSync(join(STATE, 'capabilityRuleKeys.ts'), 'utf8'));
    expect(mapping).not.toMatch(/CoverageStatus|CoverageCell|CoverageScenario/);
  });

  it('has no production path that returns an empty array for a known capability', () => {
    // Every value in the canonical mapping must be a non-empty array literal.
    const mapping = readFileSync(join(STATE, 'capabilityRuleKeys.ts'), 'utf8');
    const mapBody = /CAPABILITY_RULE_KEYS[\s\S]*?\n {2}\}\);/.exec(mapping)?.[0] ?? '';
    expect(mapBody.length).toBeGreaterThan(0);
    expect(mapBody).not.toMatch(/Object\.freeze\(\[\]\)/);
  });

  it('Step 3.3 coverageGate.ts is unmodified in spirit — it still imports no rule-key namespace', () => {
    // Re-asserted after Step 3.4 exists alongside it: adding F-02 must not
    // have pulled coverageGate.ts into referencing it.
    const gate = code(readFileSync(join(STATE, 'coverageGate.ts'), 'utf8'));
    expect(gate).not.toMatch(/capabilityRuleKeys|CAPABILITY_RULE_KEYS|requiredRuleKeys/);
  });
});

describe('Step 3.5 scope — candidate retrieval only, no resolution or calculation', () => {
  const CANDIDATE_RETRIEVAL = join(STATE, 'rules/candidateRetrieval.ts');

  it('performs no tax calculation and touches no tax value', () => {
    const source = code(readFileSync(CANDIDATE_RETRIEVAL, 'utf8'));
    expect(source).not.toMatch(/from '@\/lib\/core\/money'|\bMoney\b|\bDecimal\b/);
    expect(source).not.toMatch(/\b\d+\.\d+\b/);
  });

  it('does not call the pure Phase 2 resolution decision (resolveApplicableRules)', () => {
    // Candidate retrieval hands rows to a LATER stage; it must never itself
    // decide RESOLVED/AMBIGUOUS/NOT_FOUND.
    const source = code(readFileSync(CANDIDATE_RETRIEVAL, 'utf8'));
    expect(source).not.toMatch(/resolveApplicableRules|ResolutionStatus/);
  });

  it('does not construct a ResolvedStateRuleSet or import the final state-rule-set module', () => {
    const source = code(readFileSync(CANDIDATE_RETRIEVAL, 'utf8'));
    expect(source).not.toMatch(/ResolvedStateRuleSet|freezeStateRuleSet|from '\.\/stateRuleSet'/);
  });

  it('does not duplicate the F-02 capability -> rule-key mapping', () => {
    const source = code(readFileSync(CANDIDATE_RETRIEVAL, 'utf8'));
    expect(source).not.toMatch(/CAPABILITY_RULE_KEYS|requiredRuleKeys|capabilityRuleKeys/);
  });

  it('does not import or reference the Step 3.3 coverage model', () => {
    const source = code(readFileSync(CANDIDATE_RETRIEVAL, 'utf8'));
    expect(source).not.toMatch(
      /CoverageMatrix|CoverageStatus|CoverageCell|coverageGate|consultCoverage/,
    );
  });

  it('never substitutes a fallback jurisdiction — no hardcoded jurisdiction code', () => {
    const source = code(readFileSync(CANDIDATE_RETRIEVAL, 'utf8'));
    expect(source).not.toMatch(/\bUS\b|'US-[A-Z]{2}'|DEFAULT_JURISDICTION|FALLBACK/);
  });

  it('does not silently swallow a database error (no empty-catch around the query)', () => {
    const source = readFileSync(CANDIDATE_RETRIEVAL, 'utf8');
    expect(source).not.toMatch(/catch\s*(\([^)]*\))?\s*\{\s*\}/);
    expect(source).not.toMatch(/\.catch\(\s*\(\)\s*=>\s*(\[\]|null|undefined)\s*\)/);
  });

  it('performs at most one findMany call — narrowing happens in one query, not per key', () => {
    const source = code(readFileSync(CANDIDATE_RETRIEVAL, 'utf8'));
    const matches = source.match(/\.findMany\(/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe('Step 3.6 scope — candidate resolution only, no retrieval or final assembly', () => {
  const RESOLVE_CANDIDATES = join(STATE, 'rules/resolveCandidates.ts');

  it('imports no database client or Prisma', () => {
    const source = code(readFileSync(RESOLVE_CANDIDATES, 'utf8'));
    expect(source).not.toMatch(/from '@\/lib\/db\/|getPrisma|PrismaClient/);
  });

  it('does not import the candidate-retrieval module for execution', () => {
    // Step 3.6 consumes Step 3.5's OUTPUT TYPE only — it must never call
    // retrieveCandidates() itself, which would blur the two seams.
    const source = code(readFileSync(RESOLVE_CANDIDATES, 'utf8'));
    expect(source).not.toMatch(/retrieveCandidates\(/);
  });

  it('does not import or reference the Step 3.3 coverage model', () => {
    const source = code(readFileSync(RESOLVE_CANDIDATES, 'utf8'));
    expect(source).not.toMatch(
      /CoverageMatrix|CoverageStatus|CoverageCell|coverageGate|consultCoverage/,
    );
  });

  it('does not import or duplicate the F-02 capability -> rule-key mapping', () => {
    const source = code(readFileSync(RESOLVE_CANDIDATES, 'utf8'));
    expect(source).not.toMatch(/CAPABILITY_RULE_KEYS|requiredRuleKeys|capabilityRuleKeys/);
  });

  it('does not construct or freeze the final ResolvedStateRuleSet', () => {
    const source = code(readFileSync(RESOLVE_CANDIDATES, 'utf8'));
    expect(source).not.toMatch(
      /ResolvedStateRuleSet|freezeStateRuleSet|\bstateRule\(|from '\.\/stateRuleSet'/,
    );
  });

  it('performs no tax calculation and touches no tax value', () => {
    const source = code(readFileSync(RESOLVE_CANDIDATES, 'utf8'));
    expect(source).not.toMatch(/from '@\/lib\/core\/money'|\bMoney\b|\bDecimal\b/);
    expect(source).not.toMatch(/\b\d+\.\d+\b/);
  });

  it('reimplements no selection heuristic — calls the generic resolver exactly once per group', () => {
    const source = code(readFileSync(RESOLVE_CANDIDATES, 'utf8'));
    const matches = source.match(/resolveApplicableRules\(/g) ?? [];
    expect(matches.length).toBe(1);
    expect(source).not.toMatch(/\.sort\(|newest|oldest|highestVersion|latestVersion/i);
  });

  it('is synchronous — no async function, no Promise-returning export', () => {
    const source = readFileSync(RESOLVE_CANDIDATES, 'utf8');
    expect(source).toContain('export function resolveCandidates(');
    expect(source).not.toContain('export async function resolveCandidates(');
  });
});

describe('Step 3.7 scope — final assembly only, no database access or re-resolution', () => {
  const ASSEMBLE = join(STATE, 'rules/assembleStateRuleSet.ts');

  it('imports no database client, Prisma, or repository', () => {
    const source = code(readFileSync(ASSEMBLE, 'utf8'));
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/getPrisma|PrismaClient|from '@\/lib\/db\//);
    expect(importLines).not.toMatch(/from '@\/lib\/jurisdictions\/repository'/);
  });

  it('does not import the candidate-retrieval module, type-only or otherwise', () => {
    const source = code(readFileSync(ASSEMBLE, 'utf8'));
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/candidateRetrieval/);
  });

  it('does not import or call the generic resolver — resolution stays Step 3.6’s job', () => {
    const source = code(readFileSync(ASSEMBLE, 'utf8'));
    expect(source).not.toMatch(/resolveApplicableRules|from '@\/lib\/rules\/resolution'/);
  });

  it('does not import or duplicate the F-02 capability -> rule-key mapping', () => {
    const source = code(readFileSync(ASSEMBLE, 'utf8'));
    expect(source).not.toMatch(/CAPABILITY_RULE_KEYS|requiredRuleKeys|capabilityRuleKeys/);
  });

  it('does not import or reference the Step 3.3 coverage model', () => {
    const source = code(readFileSync(ASSEMBLE, 'utf8'));
    expect(source).not.toMatch(
      /CoverageMatrix|CoverageStatus|CoverageCell|coverageGate|consultCoverage/,
    );
  });

  it('performs no tax calculation and touches no tax value', () => {
    const source = code(readFileSync(ASSEMBLE, 'utf8'));
    expect(source).not.toMatch(/from '@\/lib\/core\/money'|\bMoney\b|\bDecimal\b/);
    expect(source).not.toMatch(/\b\d+\.\d+\b/);
  });

  it('uses the canonical freezeStateRuleSet constructor rather than a parallel one', () => {
    const source = code(readFileSync(ASSEMBLE, 'utf8'));
    expect(source).toMatch(/from '\.\/stateRuleSet'/);
    expect(source).toContain('freezeStateRuleSet(');
    const matches = source.match(/freezeStateRuleSet\(/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('does not arbitrate ambiguity — no selection heuristic over multiple candidates', () => {
    const source = code(readFileSync(ASSEMBLE, 'utf8'));
    expect(source).not.toMatch(/\.sort\(|newest|oldest|highestVersion|latestVersion/i);
  });

  it('is synchronous — no async function, no Promise-returning export', () => {
    const source = readFileSync(ASSEMBLE, 'utf8');
    expect(source).toContain('export function assembleStateRuleSet(');
    expect(source).not.toContain('export async function assembleStateRuleSet(');
  });
});

describe('DM-03 Slice 13 scope — SUTA employer-rate contract: unit resolved, selector still open', () => {
  it('StateEmployerProfile.sutaRate documents its unit as a decimal fraction', () => {
    // Locks in the Slice 13 evidence-based resolution (DeductionInput.percent's
    // established convention) against silent regression — this field has no
    // companion `unit` field, so the documentation IS the contract.
    const source = readFileSync(join(STATE, 'context.ts'), 'utf8');
    expect(source).toMatch(/sutaRate\?:\s*DecimalString/);
    expect(source).toMatch(/DECIMAL FRACTION/);
  });

  it('does not invent an employer-type/experience-rating discriminator field', () => {
    // The still-open half of the Slice 13 gap: no selection heuristic and no
    // new discriminator field were added, per the task's explicit boundary.
    const offenders = stateFiles()
      .filter((file) =>
        /\bemployerType\b|\bisNewEmployer\b|\bexperienceRating\b|\bemployerClassification\b/.test(
          code(file.text),
        ),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  // The "exports no employer-side calculation function" assertion that
  // stood here through Slice 13 is superseded by Slice 15, whose explicit
  // job was to implement exactly that function — see the Slice 15 block
  // below for the guard that replaces it.
});

describe('DM-03 Slice 14 scope — SUTA employer-rate selection contract now resolved (Option A)', () => {
  it('StateEmployerProfile.sutaRate documents itself as the sole, required employer-rate input', () => {
    // Locks in the Slice 14 resolution: sutaRate absent -> unavailable, never
    // a silent fallback to either jurisdiction rate key.
    const source = readFileSync(join(STATE, 'context.ts'), 'utf8');
    expect(source).toMatch(/SOLE,/);
    expect(source).toMatch(/REQUIRED input for a computable employer SUTA amount/);
    expect(source).toMatch(/UNAVAILABLE/);
  });

  it('still does not invent an employer-type/experience-rating discriminator field', () => {
    // Re-asserted after Slice 14: resolving the selection CONTRACT did not
    // require, and did not add, a new field.
    const offenders = stateFiles()
      .filter((file) =>
        /\bemployerType\b|\bisNewEmployer\b|\bexperienceRating\b|\bemployerClassification\b/.test(
          code(file.text),
        ),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('still does not read SUTA_EMPLOYER_RATE or SUTA_NEW_EMPLOYER_RATE anywhere', () => {
    // The resolved contract says a future calculateSutaEmployer() must never
    // select either jurisdiction rate key — no code anywhere reads them yet.
    const offenders = stateFiles()
      .filter((file) => !file.rel.endsWith('ruleKeys.ts') && !file.rel.endsWith('detailSchemas.ts'))
      .filter((file) => !file.rel.endsWith('read-detail.ts') && !file.rel.endsWith('wageBase.ts'))
      .filter((file) => !file.rel.endsWith('capabilityRuleKeys.ts'))
      .filter((file) =>
        /StateRuleKey\.SUTA_EMPLOYER_RATE|StateRuleKey\.SUTA_NEW_EMPLOYER_RATE/.test(
          code(file.text),
        ),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});

describe('DM-03 Slice 15 scope — SUTA employer calculation implemented, on the locked contract only', () => {
  it('calculateSuta.ts now exports calculateSutaEmployer', () => {
    const suta = code(readFileSync(join(STATE, 'suta/calculateSuta.ts'), 'utf8'));
    expect(suta).toMatch(/export function calculateSutaEmployer/);
  });

  it('calculateSutaEmployer never reads SUTA_EMPLOYER_RATE or SUTA_NEW_EMPLOYER_RATE', () => {
    const suta = code(readFileSync(join(STATE, 'suta/calculateSuta.ts'), 'utf8'));
    expect(suta).not.toMatch(/StateRuleKey\.SUTA_EMPLOYER_RATE/);
    expect(suta).not.toMatch(/StateRuleKey\.SUTA_NEW_EMPLOYER_RATE/);
  });

  it('still does not invent an employer-type/experience-rating discriminator field', () => {
    // Re-asserted after Slice 15: implementing the function did not require,
    // and did not add, a new field.
    const offenders = stateFiles()
      .filter((file) =>
        /\bemployerType\b|\bisNewEmployer\b|\bexperienceRating\b|\bemployerClassification\b/.test(
          code(file.text),
        ),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});

describe('DM-03 Slice 17 scope — withholding methodology dispatcher, classification only', () => {
  it('withholdingMethodology.ts exists and exports resolveWithholdingMethodology', () => {
    const source = code(readFileSync(join(STATE, 'rules/withholdingMethodology.ts'), 'utf8'));
    expect(source).toMatch(/export function resolveWithholdingMethodology/);
  });

  it('classifies only FORMULA and TABLE; never invents FLAT/PROGRESSIVE/NONE/HYBRID semantics', () => {
    // The four unresolved structures must all resolve through the same
    // SCENARIO_UNSUPPORTED branch of the switch, never through a case that
    // returns readOk — this is the machine-enforced form of "no guessed
    // default or fallback to FORMULA/TABLE" for this module.
    const source = code(readFileSync(join(STATE, 'rules/withholdingMethodology.ts'), 'utf8'));
    const formulaCase = /case 'FORMULA':\s*\n\s*return readOk/;
    const tableCase = /case 'TABLE':\s*\n\s*return readOk/;
    expect(source).toMatch(formulaCase);
    expect(source).toMatch(tableCase);
    // NONE/FLAT/PROGRESSIVE/HYBRID must be grouped into one shared
    // readFail(...SCENARIO_UNSUPPORTED...) branch, not four separate readOk
    // branches.
    expect(source).not.toMatch(/case 'NONE':\s*\n\s*return readOk/);
    expect(source).not.toMatch(/case 'FLAT':\s*\n\s*return readOk/);
    expect(source).not.toMatch(/case 'PROGRESSIVE':\s*\n\s*return readOk/);
    expect(source).not.toMatch(/case 'HYBRID':\s*\n\s*return readOk/);
    expect(source).toMatch(/StateReason\.SCENARIO_UNSUPPORTED/);
  });

  it('does not run the formula interpreter, the table row selector, or any arithmetic', () => {
    const source = code(readFileSync(join(STATE, 'rules/withholdingMethodology.ts'), 'utf8'));
    expect(source).not.toMatch(/runStateWithholdingFormula|selectStateWithholdingTableRow/);
    expect(source).not.toMatch(/\bsubtract\(|\bsum\(|\bmultiply\(|\bmoney\(/);
  });

  it('does not access a ResolvedStateRuleSet directly — classification takes an already-read detail', () => {
    const source = code(readFileSync(join(STATE, 'rules/withholdingMethodology.ts'), 'utf8'));
    expect(source).not.toMatch(/ResolvedStateRuleSet|stateRule\(/);
  });
});

describe('DM-03 Slice 24 scope — index.ts wiring uses the dispatcher, never bypasses it', () => {
  // Slice 17's original "not wired into index.ts at all" guard is
  // superseded here: Slice 24 is the explicitly authorized wiring slice.
  // What must still hold is that index.ts consumes the existing dispatcher
  // rather than re-deciding methodology itself.
  it('calls resolveWithholdingMethodology() rather than switching on .structure directly', () => {
    const source = code(readFileSync(join(STATE, 'index.ts'), 'utf8'));
    expect(source).toMatch(/resolveWithholdingMethodology\(/);
    expect(source).not.toMatch(/\.structure\s*===|switch\s*\(\s*\w+\.structure\s*\)/);
  });

  it('does not implement TABLE post-selection arithmetic in index.ts', () => {
    const source = code(readFileSync(join(STATE, 'index.ts'), 'utf8'));
    expect(source).not.toMatch(/selectStateWithholdingTableRow/);
    expect(source).toMatch(/TABLE_SELECTION_ONLY/);
    expect(source).toMatch(/METHOD_NOT_IMPLEMENTED/);
  });

  it('captures the WITHHOLDING_FORMULA container reference at the orchestrator layer, not inside the interpreter', () => {
    const indexSource = code(readFileSync(join(STATE, 'index.ts'), 'utf8'));
    expect(indexSource).toMatch(/StateRuleKey\.WITHHOLDING_FORMULA/);
    // The interpreter's own doc comments, error text, and its pre-existing
    // `FORMULA_RULE_KEY` constant (used only to label error messages, never
    // to read a rule) all legitimately mention "WITHHOLDING_FORMULA" — what
    // must never appear ANYWHERE ELSE is that key passed to `readDetail(`/
    // `stateRule(` as an actual rule access.
    const interpreterSource = code(
      readFileSync(join(STATE, 'rules/withholdingFormulaInterpreter.ts'), 'utf8'),
    )
      .split('\n')
      .filter((line) => !/const FORMULA_RULE_KEY/.test(line))
      .join('\n');
    expect(interpreterSource).not.toMatch(/StateRuleKey\.WITHHOLDING_FORMULA/);
  });

  it('does not modify resolveStatePayPeriodsPerYear() or readDetail()', () => {
    const payPeriodsSource = code(
      readFileSync(join(STATE, 'rules/withholdingPayPeriods.ts'), 'utf8'),
    );
    expect(payPeriodsSource).toMatch(/export function resolveStatePayPeriodsPerYear/);
    expect(payPeriodsSource).not.toMatch(/stateRule\(/);
    const readDetailSource = code(readFileSync(join(STATE, 'rules/read-detail.ts'), 'utf8'));
    expect(readDetailSource).not.toMatch(/reference:/);
  });
});

describe('DM-03 Slice 18 scope — withholding table reader, read-only', () => {
  it('withholdingTableReader.ts exists and exports readWithholdingTable', () => {
    const source = code(readFileSync(join(STATE, 'rules/withholdingTableReader.ts'), 'utf8'));
    expect(source).toMatch(/export function readWithholdingTable/);
  });

  it('delegates existence/verification/schema handling entirely to readDetail()', () => {
    const source = code(readFileSync(join(STATE, 'rules/withholdingTableReader.ts'), 'utf8'));
    expect(source).toMatch(/readDetail\(/);
    // No second existence/verification check duplicated locally.
    expect(source).not.toMatch(/verificationStatus\s*===|verificationStatus\s*!==/);
  });

  it('performs no row selection, arithmetic, or filing-status/pay-frequency matching', () => {
    const source = code(readFileSync(join(STATE, 'rules/withholdingTableReader.ts'), 'utf8'));
    expect(source).not.toMatch(/selectStateWithholdingTableRow/);
    expect(source).not.toMatch(/\bsubtract\(|\bsum\(|\bmultiply\(|\bmoney\(|\bcompare\(/);
    expect(source).not.toMatch(/filingStatus\s*===|payFrequency\s*===/);
  });

  it('does not duplicate methodology dispatch logic and imports no federal module', () => {
    const source = code(readFileSync(join(STATE, 'rules/withholdingTableReader.ts'), 'utf8'));
    expect(source).not.toMatch(/withholdingMethodology|resolveWithholdingMethodology/);
    expect(source).not.toMatch(/tax\/federal|lib\/calculator/);
  });

  it('is not wired into calculateStateTaxes(), index.ts, or the Slice 17 dispatcher', () => {
    // Slice 18's explicit boundary: reader contract only, no wiring.
    const indexSource = code(readFileSync(join(STATE, 'index.ts'), 'utf8'));
    expect(indexSource).not.toMatch(/readWithholdingTable|withholdingTableReader/);
    const methodologySource = code(
      readFileSync(join(STATE, 'rules/withholdingMethodology.ts'), 'utf8'),
    );
    expect(methodologySource).not.toMatch(/readWithholdingTable|withholdingTableReader/);
  });

  it('does not modify the existing selector file — withholdingTable.ts is untouched by this reader', () => {
    // The reader lives in its own file, mirroring the existing
    // withholdingFormula.ts (reader) / withholdingFormulaInterpreter.ts
    // (consumer) split, rather than being merged into or renaming the
    // already-committed selector module.
    const selectorSource = code(readFileSync(join(STATE, 'rules/withholdingTable.ts'), 'utf8'));
    expect(selectorSource).toMatch(/export function selectStateWithholdingTableRow/);
    expect(selectorSource).not.toMatch(/export function readWithholdingTable\b/);
  });
});

describe('DM-03 Slice 19 scope — rounding: ROUND stays excluded, appliedAt stays inert', () => {
  it('the formula interpreter still declares no ROUND case — Task 4O-6R31 remains in force', () => {
    // Task 4O-6R31 (already committed, predating this slice) architecturally
    // excludes ROUND from this interpreter entirely — "never to a
    // formula-step operation." Slice 19 investigated whether repository
    // evidence now supports implementing it and found none (appliedAt's
    // execution meaning is unestablished anywhere in the repository — see
    // the next test) — so that exclusion stands, and this guard protects it
    // from silent reversal.
    const source = code(
      readFileSync(join(STATE, 'rules/withholdingFormulaInterpreter.ts'), 'utf8'),
    );
    expect(source).not.toMatch(/case 'ROUND'\s*:/);
    expect(source).not.toMatch(/WITHHOLDING_ROUNDING_POLICY/);
    expect(source).not.toMatch(/readWithholdingRoundingPolicy/);
  });

  it('appliedAt branches execution ONLY at the DM-03 Slice 28 orchestrator boundary, nowhere else', () => {
    // Slice 19 found `.appliedAt` read in exactly one place (the reader's own
    // pass-through field mapping) with no execution branch anywhere. Slice
    // 26/27 then locked the one place it MAY branch execution: the
    // `incomeTaxWithheldAmount()` boundary in index.ts, distinguishing
    // TAX_LEVEL (round) from STEP_LEVEL (METHOD_NOT_IMPLEMENTED) — per the
    // Slice 26/27 architecture decision, implemented in Slice 28. It must
    // still never branch execution anywhere else in the state namespace
    // (the formula interpreter, the reader itself, or any other module).
    const offenders = stateFiles()
      .filter((file) => !file.rel.endsWith('withholdingRoundingPolicy.ts'))
      .filter((file) => !file.rel.endsWith('index.ts'))
      .filter((file) => /\.appliedAt\b/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('introduces no second rounding primitive — round() in lib/core/money.ts remains the only one', () => {
    // Non-negotiable per DM-03 Slice 19: no competing Money rounding system.
    // State code may consume the existing `round()`/`RoundingMode` from
    // `lib/core/money.ts`, never redefine decimal-place rounding itself.
    // Matches an actual primitive definition (`function round(`,
    // `function roundMoney(`, ...), not any identifier that merely contains
    // "round" as a substring (e.g. `readWithholdingRoundingPolicy`).
    const offenders = stateFiles()
      .filter((file) =>
        /function\s+(round|roundMoney|roundTo|quantize|roundTax|roundIntermediate)\s*\(/.test(
          code(file.text),
        ),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('readWithholdingRoundingPolicy() still delegates entirely to readDetail() and applies no policy', () => {
    const source = code(readFileSync(join(STATE, 'rules/withholdingRoundingPolicy.ts'), 'utf8'));
    expect(source).toMatch(/readDetail\(/);
    expect(source).not.toMatch(/\bround\(/);
  });

  it('IS wired into calculateStateTaxes()/index.ts as of DM-03 Slice 28, reusing the existing reader unmodified', () => {
    // Slice 19's own boundary was "no new calculation orchestration yet" —
    // true at the time, but superseded once Slice 26/27 locked the rounding
    // architecture and Slice 28 implemented it. This guard now protects the
    // OPPOSITE fact: `readWithholdingRoundingPolicy()` (still unmodified,
    // still delegating entirely to `readDetail()` per the earlier test in
    // this block) IS called from index.ts, and nowhere is a second, parallel
    // reader introduced to bypass it.
    const source = code(readFileSync(join(STATE, 'index.ts'), 'utf8'));
    expect(source).toMatch(/readWithholdingRoundingPolicy/);
  });

  it('does not modify Slice 17 methodology dispatch or Slice 18 table reader semantics', () => {
    const methodologySource = code(
      readFileSync(join(STATE, 'rules/withholdingMethodology.ts'), 'utf8'),
    );
    expect(methodologySource).toMatch(/export function resolveWithholdingMethodology/);
    expect(methodologySource).not.toMatch(
      /WITHHOLDING_ROUNDING_POLICY|readWithholdingRoundingPolicy/,
    );

    const tableReaderSource = code(
      readFileSync(join(STATE, 'rules/withholdingTableReader.ts'), 'utf8'),
    );
    expect(tableReaderSource).toMatch(/export function readWithholdingTable\b/);
    expect(tableReaderSource).not.toMatch(
      /WITHHOLDING_ROUNDING_POLICY|readWithholdingRoundingPolicy/,
    );
  });
});
