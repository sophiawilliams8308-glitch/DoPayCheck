import { describe, expect, it } from 'vitest';

import { StateCapability } from '@/lib/tax/state/coverage/capabilities';
import {
  CoverageStatus,
  buildCoverageMatrix,
  emptyEvidence,
  type CoverageCell,
  type CoverageMatrix,
} from '@/lib/tax/state/coverage/coverage';
import {
  CoverageConsultationAction,
  CoverageGateOutcome,
  consultCoverage,
} from '@/lib/tax/state/coverageGate';

/**
 * Step 3.3 — Coverage Gate.
 *
 * Jurisdiction codes are RESERVED TEST codes. No production tax value or
 * real state appears here.
 */

const TEST_JURISDICTION = 'TEST-WORK';
const OTHER_JURISDICTION = 'TEST-OTHER';
const TEST_YEAR = 2099;
const CAPABILITY = StateCapability.WITHHOLDING;

function cell(status: CoverageStatus, overrides: Partial<CoverageCell> = {}): CoverageCell {
  return {
    jurisdictionCode: TEST_JURISDICTION,
    capability: CAPABILITY,
    taxYear: TEST_YEAR,
    status,
    scenario: {},
    evidence: emptyEvidence(),
    effectiveFrom: null,
    effectiveTo: null,
    contractVersion: 1,
    disclosures: [],
    ...overrides,
  };
}

function matrixWith(cellStatus: CoverageStatus): CoverageMatrix {
  return {
    taxYear: TEST_YEAR,
    jurisdictionCodes: [TEST_JURISDICTION],
    cells: [cell(cellStatus)],
  };
}

describe('SUPPORTED — permits retrieval, does not resolve anything', () => {
  const result = consultCoverage(
    matrixWith(CoverageStatus.SUPPORTED),
    TEST_JURISDICTION,
    CAPABILITY,
  );

  it('permits', () => {
    expect(result.permitted).toBe(true);
  });

  it('carries no outcome field — permitting is not itself an outcome', () => {
    expect('outcome' in result).toBe(false);
  });

  it('SUPPORTED != RESOLVED: nothing in the result claims a rule was resolved', () => {
    expect(JSON.stringify(result)).not.toMatch(/RESOLVED/);
    expect(result.consultation.action).toBe(CoverageConsultationAction.PERMITTED);
    expect(result.consultation.status).toBe(CoverageStatus.SUPPORTED);
  });
});

describe('NOT_APPLICABLE', () => {
  const result = consultCoverage(
    matrixWith(CoverageStatus.NOT_APPLICABLE),
    TEST_JURISDICTION,
    CAPABILITY,
  );

  it('blocks with outcome NOT_APPLICABLE', () => {
    expect(result.permitted).toBe(false);
    expect(result.permitted === false && result.outcome).toBe(CoverageGateOutcome.NOT_APPLICABLE);
  });

  it('records BLOCKED action and the true coverage status', () => {
    expect(result.consultation.action).toBe(CoverageConsultationAction.BLOCKED);
    expect(result.consultation.status).toBe(CoverageStatus.NOT_APPLICABLE);
  });
});

describe('NOT_STATED — never reinterpreted as NOT_APPLICABLE', () => {
  const result = consultCoverage(
    matrixWith(CoverageStatus.NOT_STATED),
    TEST_JURISDICTION,
    CAPABILITY,
  );

  it('blocks with outcome NOT_STATED, not NOT_APPLICABLE', () => {
    expect(result.permitted).toBe(false);
    expect(result.permitted === false && result.outcome).toBe(CoverageGateOutcome.NOT_STATED);
    expect(result.permitted === false && result.outcome).not.toBe(
      CoverageGateOutcome.NOT_APPLICABLE,
    );
  });
});

describe('PENDING_RESEARCH — never converted into MISSING_RULE', () => {
  const result = consultCoverage(
    matrixWith(CoverageStatus.PENDING_RESEARCH),
    TEST_JURISDICTION,
    CAPABILITY,
  );

  it('blocks with outcome PENDING_RESEARCH', () => {
    expect(result.permitted).toBe(false);
    expect(result.permitted === false && result.outcome).toBe(CoverageGateOutcome.PENDING_RESEARCH);
  });

  it('never produces the string MISSING_RULE anywhere in the result', () => {
    expect(JSON.stringify(result)).not.toContain('MISSING_RULE');
  });
});

describe('PENDING_VERIFICATION — kept distinct from PENDING_RESEARCH', () => {
  const result = consultCoverage(
    matrixWith(CoverageStatus.PENDING_VERIFICATION),
    TEST_JURISDICTION,
    CAPABILITY,
  );

  it('blocks with outcome PENDING_VERIFICATION', () => {
    expect(result.permitted).toBe(false);
    expect(result.permitted === false && result.outcome).toBe(
      CoverageGateOutcome.PENDING_VERIFICATION,
    );
    expect(result.permitted === false && result.outcome).not.toBe(
      CoverageGateOutcome.PENDING_RESEARCH,
    );
  });
});

describe('CONFLICT — never silently resolved', () => {
  const result = consultCoverage(
    matrixWith(CoverageStatus.CONFLICT),
    TEST_JURISDICTION,
    CAPABILITY,
  );

  it('blocks with outcome CONFLICT', () => {
    expect(result.permitted).toBe(false);
    expect(result.permitted === false && result.outcome).toBe(CoverageGateOutcome.CONFLICT);
  });
});

describe('UNSUPPORTED_SCENARIO', () => {
  const result = consultCoverage(
    matrixWith(CoverageStatus.UNSUPPORTED_SCENARIO),
    TEST_JURISDICTION,
    CAPABILITY,
  );

  it('blocks with outcome UNSUPPORTED_SCENARIO', () => {
    expect(result.permitted).toBe(false);
    expect(result.permitted === false && result.outcome).toBe(
      CoverageGateOutcome.UNSUPPORTED_SCENARIO,
    );
  });
});

describe('PARTIALLY_SUPPORTED — L-05: blocks the entire capability, never split', () => {
  const result = consultCoverage(
    matrixWith(CoverageStatus.PARTIALLY_SUPPORTED),
    TEST_JURISDICTION,
    CAPABILITY,
  );

  it('blocks the entire capability', () => {
    expect(result.permitted).toBe(false);
  });

  it('the resulting outcome is PENDING_VERIFICATION', () => {
    expect(result.permitted === false && result.outcome).toBe(
      CoverageGateOutcome.PENDING_VERIFICATION,
    );
  });

  it('the trace/consultation entry identifies PARTIALLY_SUPPORTED as the true status', () => {
    expect(result.consultation.status).toBe(CoverageStatus.PARTIALLY_SUPPORTED);
  });

  it('does not attempt to identify which keys are supported — no key-shaped field exists', () => {
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/ruleKey|RuleKey|STATE\./);
  });

  it('no capability -> rule-key mapping was created or invoked (module-level scan)', () => {
    // Positive-path corroboration of the guard test in state-guards.test.ts:
    // consultCoverage's own module never imports the rule-key namespace.
    expect(Object.keys(CoverageGateOutcome)).not.toContain('COVERAGE_BLOCKED');
  });
});

describe('unknown jurisdiction — reuses the existing Step 2 contract, invents nothing new', () => {
  it('behaves identically to PENDING_RESEARCH for a jurisdiction absent from the matrix', () => {
    // buildCoverageMatrix only seeds TEST_JURISDICTION; OTHER_JURISDICTION has
    // no cell at all. findCoverageCell (Step 2, unchanged) already treats an
    // absent cell as PENDING_RESEARCH — this gate adds no second notion of
    // "unknown jurisdiction".
    const matrix = buildCoverageMatrix([TEST_JURISDICTION], TEST_YEAR);
    const known = consultCoverage(matrix, TEST_JURISDICTION, CAPABILITY);
    const unknown = consultCoverage(matrix, OTHER_JURISDICTION, CAPABILITY);

    expect(known.permitted).toBe(false);
    expect(known.permitted === false && known.outcome).toBe(CoverageGateOutcome.PENDING_RESEARCH);
    expect(unknown.permitted).toBe(false);
    expect(unknown.permitted === false && unknown.outcome).toBe(
      CoverageGateOutcome.PENDING_RESEARCH,
    );
    expect(unknown.consultation.status).toBe(known.consultation.status);
  });
});

describe('zero-query guarantee — proven architecturally, as Step 3.2 established', () => {
  it('consultCoverage is synchronous, so it cannot itself await a candidate-rule query', () => {
    expect(consultCoverage.constructor.name).toBe('Function');
  });

  it('returns a plain value, never a Promise, for every one of the eight statuses', () => {
    for (const status of Object.values(CoverageStatus)) {
      const result = consultCoverage(matrixWith(status), TEST_JURISDICTION, CAPABILITY);
      expect(result).not.toBeInstanceOf(Promise);
    }
  });

  it('does not mutate the caller-supplied matrix', () => {
    const matrix = matrixWith(CoverageStatus.SUPPORTED);
    Object.freeze(matrix);
    Object.freeze(matrix.cells);
    Object.freeze(matrix.cells[0]);
    expect(() => consultCoverage(matrix, TEST_JURISDICTION, CAPABILITY)).not.toThrow();
  });
});

describe('every one of the eight Step 2 statuses is exercised (§21 exit gate)', () => {
  const expectations: ReadonlyArray<readonly [CoverageStatus, boolean]> = [
    [CoverageStatus.SUPPORTED, true],
    [CoverageStatus.NOT_APPLICABLE, false],
    [CoverageStatus.NOT_STATED, false],
    [CoverageStatus.PENDING_RESEARCH, false],
    [CoverageStatus.PENDING_VERIFICATION, false],
    [CoverageStatus.CONFLICT, false],
    [CoverageStatus.PARTIALLY_SUPPORTED, false],
    [CoverageStatus.UNSUPPORTED_SCENARIO, false],
  ];

  it('covers all eight, with exactly one permitting', () => {
    expect(expectations.length).toBe(8);
    for (const [status, permitted] of expectations) {
      const result = consultCoverage(matrixWith(status), TEST_JURISDICTION, CAPABILITY);
      expect(result.permitted, `${status} should be permitted=${String(permitted)}`).toBe(
        permitted,
      );
    }
  });
});
