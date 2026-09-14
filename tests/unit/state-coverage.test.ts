import { describe, expect, it } from 'vitest';

import {
  ALL_STATE_CAPABILITIES,
  CAPABILITY_PROGRAM,
  EMPLOYEE_SIDE_CAPABILITIES,
  EMPLOYER_SIDE_CAPABILITIES,
  STATE_CAPABILITY_COUNT,
  StateCapability,
  isStateCapability,
} from '@/lib/tax/state/coverage/capabilities';
import {
  ALL_COVERAGE_STATUSES,
  ALL_SUPPORT_CONDITIONS,
  COVERAGE_CONTRACT_VERSION,
  CoverageStatus,
  INITIAL_COVERAGE_STATUS,
  SupportCondition,
  assessSupport,
  buildCoverageMatrix,
  coverageCellKey,
  coversInstant,
  emptyEvidence,
  findCoverageCell,
  isSupported,
  queryCoverage,
  summarizeCoverage,
  type CoverageCell,
} from '@/lib/tax/state/coverage/coverage';
import { ALL_STATE_PROGRAMS } from '@/lib/tax/state/ruleKeys';

/**
 * State coverage model (Phase 5 Step 2).
 *
 * Jurisdiction codes here are RESERVED TEST codes. The real 51 are asserted in
 * tests/integration/state-coverage-matrix.test.ts, derived from the seeded
 * jurisdiction repository rather than duplicated as a literal list.
 */

const TEST_YEAR = 2099;
const TEST_JURISDICTIONS = ['TEST-AA', 'TEST-BB', 'TEST-CC'];

/** A cell with every readiness condition satisfied. Synthetic throughout. */
function fullyEvidencedCell(overrides: Partial<CoverageCell> = {}): CoverageCell {
  return {
    jurisdictionCode: 'TEST-AA',
    capability: StateCapability.WITHHOLDING,
    taxYear: TEST_YEAR,
    status: CoverageStatus.SUPPORTED,
    scenario: {},
    evidence: {
      sourceIds: ['synthetic-source'],
      ruleIds: ['synthetic-rule'],
      verifiedBy: 'synthetic-verifier',
      verifiedAt: '2099-06-15T00:00:00.000Z',
      notes: null,
    },
    effectiveFrom: null,
    effectiveTo: null,
    contractVersion: COVERAGE_CONTRACT_VERSION,
    disclosures: [],
    ...overrides,
  };
}

describe('capability vocabulary', () => {
  it('declares exactly 13 capabilities', () => {
    expect(STATE_CAPABILITY_COUNT).toBe(13);
    expect(ALL_STATE_CAPABILITIES.length).toBe(13);
  });

  it('declares every capability key exactly once', () => {
    expect(new Set(ALL_STATE_CAPABILITIES).size).toBe(ALL_STATE_CAPABILITIES.length);
    const names = Object.keys(StateCapability);
    expect(new Set(names).size).toBe(names.length);
  });

  it('recognises its own capabilities and rejects anything else', () => {
    expect(isStateCapability(StateCapability.SUTA)).toBe(true);
    expect(isStateCapability('NOT_A_CAPABILITY')).toBe(false);
  });

  it('reuses the Step 1 programme vocabulary rather than a parallel one', () => {
    for (const program of Object.values(CAPABILITY_PROGRAM)) {
      expect(ALL_STATE_PROGRAMS).toContain(program);
    }
  });

  it('keeps employee-side and employer-side capability sets distinct', () => {
    // They overlap (a wage base matters to both sides) but neither contains the
    // other, so an employer-side gap cannot gate something reaching net pay.
    const employeeOnly = EMPLOYEE_SIDE_CAPABILITIES.filter(
      (capability) => !EMPLOYER_SIDE_CAPABILITIES.includes(capability),
    );
    const employerOnly = EMPLOYER_SIDE_CAPABILITIES.filter(
      (capability) => !EMPLOYEE_SIDE_CAPABILITIES.includes(capability),
    );
    expect(employeeOnly.length).toBeGreaterThan(0);
    expect(employerOnly.length).toBeGreaterThan(0);
  });
});

describe('status vocabulary', () => {
  it('declares all eight statuses', () => {
    expect(ALL_COVERAGE_STATUSES.length).toBe(8);
    expect(new Set(ALL_COVERAGE_STATUSES).size).toBe(8);
  });

  it('starts every cell at PENDING_RESEARCH', () => {
    expect(INITIAL_COVERAGE_STATUS).toBe(CoverageStatus.PENDING_RESEARCH);
  });

  it('keeps NOT_APPLICABLE distinct from NOT_STATED', () => {
    // "This state has no disability programme" is a sourced fact you can
    // calculate from. "The source does not say" is an absence you cannot.
    expect(CoverageStatus.NOT_APPLICABLE).not.toBe(CoverageStatus.NOT_STATED);
    expect(isSupported(fullyEvidencedCell({ status: CoverageStatus.NOT_APPLICABLE }))).toBe(false);
    expect(isSupported(fullyEvidencedCell({ status: CoverageStatus.NOT_STATED }))).toBe(false);
  });

  it('keeps PENDING_RESEARCH distinct from PENDING_VERIFICATION', () => {
    expect(CoverageStatus.PENDING_RESEARCH).not.toBe(CoverageStatus.PENDING_VERIFICATION);
    const researched = assessSupport(
      fullyEvidencedCell({ status: CoverageStatus.PENDING_VERIFICATION }),
    );
    const unresearched = assessSupport(
      fullyEvidencedCell({ status: CoverageStatus.PENDING_RESEARCH }),
    );
    expect(researched.supported).toBe(false);
    expect(unresearched.supported).toBe(false);
    expect(unresearched.unmetConditions).toContain(SupportCondition.RESEARCH_RECORDED);
    expect(researched.unmetConditions).not.toContain(SupportCondition.RESEARCH_RECORDED);
  });
});

describe('non-support statuses never pass the gate', () => {
  const nonSupport = ALL_COVERAGE_STATUSES.filter((status) => status !== CoverageStatus.SUPPORTED);

  for (const status of nonSupport) {
    it(`${status} is not treated as supported`, () => {
      expect(isSupported(fullyEvidencedCell({ status }))).toBe(false);
    });
  }

  it('CONFLICT names the unresolved conflict as the blocker', () => {
    const assessment = assessSupport(fullyEvidencedCell({ status: CoverageStatus.CONFLICT }));
    expect(assessment.supported).toBe(false);
    expect(assessment.unmetConditions).toContain(SupportCondition.NO_CONFLICT);
  });

  it('PARTIALLY_SUPPORTED is not support', () => {
    // The unsupported subset is exactly the case a user is most likely to hit
    // and least likely to notice.
    const assessment = assessSupport(
      fullyEvidencedCell({ status: CoverageStatus.PARTIALLY_SUPPORTED }),
    );
    expect(assessment.supported).toBe(false);
    expect(assessment.reason).toContain('not SUPPORTED');
  });

  it('UNSUPPORTED_SCENARIO remains unsupported however much evidence exists', () => {
    expect(isSupported(fullyEvidencedCell({ status: CoverageStatus.UNSUPPORTED_SCENARIO }))).toBe(
      false,
    );
  });
});

describe('SUPPORTED requires explicit evidence', () => {
  it('passes only when every readiness condition is met', () => {
    const assessment = assessSupport(fullyEvidencedCell());
    expect(assessment.supported).toBe(true);
    expect(assessment.unmetConditions).toEqual([]);
  });

  it('refuses a cell labelled SUPPORTED with no cited source', () => {
    const cell = fullyEvidencedCell({
      evidence: { ...fullyEvidencedCell().evidence, sourceIds: [] },
    });
    const assessment = assessSupport(cell);
    expect(assessment.supported).toBe(false);
    expect(assessment.unmetConditions).toContain(SupportCondition.SOURCE_CITED);
  });

  it('refuses a cell labelled SUPPORTED with no linked rule', () => {
    const assessment = assessSupport(
      fullyEvidencedCell({ evidence: { ...fullyEvidencedCell().evidence, ruleIds: [] } }),
    );
    expect(assessment.supported).toBe(false);
    expect(assessment.unmetConditions).toContain(SupportCondition.RULE_LINKED);
  });

  it('refuses a cell labelled SUPPORTED that no human verified', () => {
    const assessment = assessSupport(
      fullyEvidencedCell({
        evidence: { ...fullyEvidencedCell().evidence, verifiedBy: null, verifiedAt: null },
      }),
    );
    expect(assessment.supported).toBe(false);
    expect(assessment.unmetConditions).toContain(SupportCondition.HUMAN_VERIFIED);
  });

  it('declares all five readiness conditions', () => {
    expect(ALL_SUPPORT_CONDITIONS.length).toBe(5);
  });
});

describe('generic engine existence never implies support', () => {
  it('leaves a freshly built matrix entirely unsupported', () => {
    // The whole coverage model exists to forbid: "the code runs, therefore the
    // state is supported."
    const matrix = buildCoverageMatrix(TEST_JURISDICTIONS, TEST_YEAR);
    expect(matrix.cells.every((cell) => !isSupported(cell))).toBe(true);
    expect(matrix.cells.every((cell) => cell.status === CoverageStatus.PENDING_RESEARCH)).toBe(
      true,
    );
  });

  it('assesses support from the cell alone, never from the engine', () => {
    // assessSupport takes one argument: the recorded claim. It cannot consult
    // whether a rule resolves or a calculation would succeed.
    expect(assessSupport.length).toBe(1);
  });

  it('treats an unrecorded cell as PENDING_RESEARCH, not as absent', () => {
    const matrix = buildCoverageMatrix([], TEST_YEAR);
    const cell = findCoverageCell(matrix, 'TEST-ZZ', StateCapability.SUTA);
    expect(cell.status).toBe(CoverageStatus.PENDING_RESEARCH);
    expect(isSupported(cell)).toBe(false);
  });
});

describe('matrix structure', () => {
  const matrix = buildCoverageMatrix(TEST_JURISDICTIONS, TEST_YEAR);

  it('produces jurisdictions x capabilities cells', () => {
    expect(matrix.cells.length).toBe(TEST_JURISDICTIONS.length * STATE_CAPABILITY_COUNT);
  });

  it('contains no duplicate jurisdiction/capability cell', () => {
    const keys = matrix.cells.map((cell) =>
      coverageCellKey(cell.jurisdictionCode, cell.capability, cell.taxYear),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers every capability for every jurisdiction', () => {
    for (const jurisdictionCode of TEST_JURISDICTIONS) {
      for (const capability of ALL_STATE_CAPABILITIES) {
        expect(findCoverageCell(matrix, jurisdictionCode, capability).status).toBe(
          CoverageStatus.PENDING_RESEARCH,
        );
      }
    }
  });

  it('is tax-year aware', () => {
    const other = buildCoverageMatrix(TEST_JURISDICTIONS, TEST_YEAR + 1);
    expect(other.taxYear).toBe(TEST_YEAR + 1);
    expect(other.cells.every((cell) => cell.taxYear === TEST_YEAR + 1)).toBe(true);
    // A cell key separates years, so one year's claim cannot answer for another.
    expect(coverageCellKey('TEST-AA', StateCapability.WITHHOLDING, TEST_YEAR)).not.toBe(
      coverageCellKey('TEST-AA', StateCapability.WITHHOLDING, TEST_YEAR + 1),
    );
  });

  it('records the contract version on every cell', () => {
    expect(matrix.cells.every((cell) => cell.contractVersion === COVERAGE_CONTRACT_VERSION)).toBe(
      true,
    );
  });
});

describe('effective-date awareness', () => {
  it('treats a cell with no period as covering the whole year', () => {
    expect(coversInstant(fullyEvidencedCell(), '2099-01-01T00:00:00.000Z')).toBe(true);
    expect(coversInstant(fullyEvidencedCell(), '2099-12-31T00:00:00.000Z')).toBe(true);
  });

  it('applies a half-open period, as Phase 2 rules do', () => {
    const cell = fullyEvidencedCell({
      effectiveFrom: '2099-07-01T00:00:00.000Z',
      effectiveTo: '2099-10-01T00:00:00.000Z',
    });
    expect(coversInstant(cell, '2099-06-30T23:59:59.000Z')).toBe(false);
    expect(coversInstant(cell, '2099-07-01T00:00:00.000Z')).toBe(true);
    expect(coversInstant(cell, '2099-09-30T00:00:00.000Z')).toBe(true);
    // Exclusive upper bound: the instant the next claim begins.
    expect(coversInstant(cell, '2099-10-01T00:00:00.000Z')).toBe(false);
  });
});

describe('scenario dimensions', () => {
  it('distinguishes support narrowed by a dimension from support that is not narrowed', () => {
    const narrowed = fullyEvidencedCell({
      scenario: { payFrequencies: ['WEEKLY'], side: 'EMPLOYEE', dependsOnEmployerSize: true },
    });
    expect(narrowed.scenario.payFrequencies).toEqual(['WEEKLY']);
    expect(fullyEvidencedCell().scenario.payFrequencies).toBeUndefined();
  });

  it('carries every required dimension', () => {
    const cell = fullyEvidencedCell({
      scenario: {
        payFrequencies: ['WEEKLY'],
        filingStatuses: ['SYNTHETIC_STATUS'],
        wageTypes: ['REGULAR'],
        side: 'BOTH',
        residencyStatuses: ['RESIDENT'],
        programs: ['SDI'],
        requiresElection: true,
        dependsOnEmployerSize: true,
        dependsOnPrivatePlan: true,
        dependsOnReciprocity: true,
      },
    });
    expect(Object.keys(cell.scenario).sort()).toEqual(
      [
        'dependsOnEmployerSize',
        'dependsOnPrivatePlan',
        'dependsOnReciprocity',
        'filingStatuses',
        'payFrequencies',
        'programs',
        'requiresElection',
        'residencyStatuses',
        'side',
        'wageTypes',
      ].sort(),
    );
  });
});

describe('evidence carries identifiers, never invented sources', () => {
  it('starts empty rather than fabricating a citation', () => {
    const evidence = emptyEvidence();
    expect(evidence.sourceIds).toEqual([]);
    expect(evidence.ruleIds).toEqual([]);
    expect(evidence.verifiedBy).toBeNull();
    expect(evidence.verifiedAt).toBeNull();
  });

  it('has no field capable of holding a URL or a tax value', () => {
    // Sources are referenced by Phase 2 id. There is nowhere here for an
    // unsourced URL or a remembered rate to appear.
    expect(Object.keys(emptyEvidence()).sort()).toEqual(
      ['notes', 'ruleIds', 'sourceIds', 'verifiedAt', 'verifiedBy'].sort(),
    );
  });
});

describe('admin-facing queries', () => {
  const matrix = buildCoverageMatrix(TEST_JURISDICTIONS, TEST_YEAR);

  it('filters by jurisdiction', () => {
    const cells = queryCoverage(matrix, { jurisdictionCode: 'TEST-AA' });
    expect(cells.length).toBe(STATE_CAPABILITY_COUNT);
  });

  it('filters by capability', () => {
    const cells = queryCoverage(matrix, { capability: StateCapability.RECIPROCITY });
    expect(cells.length).toBe(TEST_JURISDICTIONS.length);
  });

  it('identifies pending research', () => {
    const cells = queryCoverage(matrix, { status: CoverageStatus.PENDING_RESEARCH });
    expect(cells.length).toBe(matrix.cells.length);
  });

  it('identifies conflicts, pending verification and partial support when none exist', () => {
    for (const status of [
      CoverageStatus.CONFLICT,
      CoverageStatus.PENDING_VERIFICATION,
      CoverageStatus.PARTIALLY_SUPPORTED,
    ]) {
      expect(queryCoverage(matrix, { status }).length).toBe(0);
    }
  });

  it('summarises every status, including the zeroes', () => {
    const summary = summarizeCoverage(matrix);
    expect(Object.keys(summary).length).toBe(ALL_COVERAGE_STATUSES.length);
    expect(summary.PENDING_RESEARCH).toBe(matrix.cells.length);
    expect(summary.SUPPORTED).toBe(0);
  });
});
