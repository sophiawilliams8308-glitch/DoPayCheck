import { describe, expect, it, vi } from 'vitest';

/**
 * Isolated resolver-level RULE_CONFLICT test — DM-03 Slice 2 code-review
 * follow-up (optional item, code review §2 finding #2).
 *
 * ===========================================================================
 * WHY THIS FILE IS SEPARATE FROM `state-taxability-resolver.test.ts`.
 *
 * The code review found that `resolveTaxability()`'s own `matched.length > 1`
 * conflict-detection branch (contract §12 step 6) is correct, defense-in-
 * depth code, but is UNREACHABLE through the real pipeline with schema-valid
 * `TAXABILITY_PROFILE_SET` data: Slice 1's own mutual-exclusivity check
 * (`stateProgramTreatmentSchema`'s `superRefine` in `detailSchemas.ts`) uses
 * the identical closed-set arithmetic the resolver's own condition matching
 * does, so any two variants that could both match one `DELIVERY_MECHANISM`
 * value are already rejected as `RULE_DETAIL_INVALID` before the resolver
 * ever sees them.
 *
 * To exercise the resolver's OWN matching logic in true isolation from that
 * schema gate — proving the defense-in-depth code actually works, not just
 * that it exists — this file mocks `readDetail()` (the one seam between
 * `readTaxabilityProfileSet()` and `validateStateDetail()`) to hand back an
 * intentionally ambiguous, schema-illegal payload directly. This is a TEST-
 * ONLY technique: no production file is modified, no schema is weakened, and
 * `resolveTaxability()`'s own behavior is completely unchanged. The mock is
 * scoped to this file alone (`vi.mock` at module scope) precisely so it
 * cannot affect `state-taxability-resolver.test.ts`'s other 60 tests, which
 * continue to exercise the real, unmocked schema-validation path.
 * ===========================================================================
 */

vi.mock('@/lib/tax/state/rules/read-detail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tax/state/rules/read-detail')>();
  return {
    ...actual,
    readDetail: vi.fn(actual.readDetail),
  };
});

describe('resolveTaxability — isolated RULE_CONFLICT defense-in-depth (schema bypassed)', () => {
  it('reports RULE_CONFLICT when two non-default variants both match, independent of schema validation', async () => {
    const { readDetail } = await import('@/lib/tax/state/rules/read-detail');
    const { resolveTaxability } = await import('@/lib/tax/state/rules/resolveTaxability');
    const { freezeStateRuleSet } = await import('@/lib/tax/state/rules/stateRuleSet');
    const { StateRuleKey } = await import('@/lib/tax/state/ruleKeys');
    const { money } = await import('@/lib/core/money');

    // An intentionally schema-illegal payload: two non-default variants with
    // IDENTICAL DELIVERY_MECHANISM conditions -- Slice 1's schema would
    // reject this outright (not mutually exclusive). Handed directly to the
    // resolver via the mocked `readDetail()`, bypassing that check entirely.
    const ambiguousDetail = {
      shape: 'TAXABILITY_PROFILE_SET',
      profiles: [
        {
          deductionTypeKey: 'CONFLICT_PROBE',
          programTreatments: {
            INCOME_TAX_WITHHOLDING: {
              variants: [
                {
                  conditions: [
                    {
                      dimension: 'DELIVERY_MECHANISM',
                      operator: 'EQUALS',
                      values: ['CAFETERIA_PLAN'],
                    },
                  ],
                  effect: 'REDUCE_WAGES',
                  limit: null,
                },
                {
                  conditions: [
                    {
                      dimension: 'DELIVERY_MECHANISM',
                      operator: 'EQUALS',
                      values: ['CAFETERIA_PLAN'],
                    },
                  ],
                  effect: 'NO_CHANGE',
                  limit: null,
                },
              ],
            },
          },
        },
      ],
    };

    vi.mocked(readDetail).mockReturnValueOnce({
      ok: true,
      value: {
        detail: ambiguousDetail,
        ruleKey: StateRuleKey.TAXABILITY_PROFILE,
        verificationStatus: 'VERIFIED',
      },
    });

    const ruleSet = freezeStateRuleSet({
      taxYear: 2099,
      effectiveDate: '2099-06-15T00:00:00.000Z',
      jurisdictionCode: 'TEST-DM03-CONFLICT',
      engineVersion: 'test-engine',
      resolvedAt: '2099-06-15T00:00:00.000Z',
      missing: [],
      // Content is irrelevant here -- `readDetail` is mocked and never
      // actually reads through this entry -- but `stateRuleReference()`
      // (used for successful-outcome provenance only) does read it directly,
      // so an entry is supplied for structural completeness.
      entries: {
        [StateRuleKey.TAXABILITY_PROFILE]: {
          available: true,
          rule: {
            key: StateRuleKey.TAXABILITY_PROFILE,
            reference: {
              ruleId: 'synthetic-conflict-probe',
              ruleKey: StateRuleKey.TAXABILITY_PROFILE,
              version: 1,
              category: 'STATE_WITHHOLDING',
              taxYear: 2099,
              jurisdictionId: 'test-dm03-conflict-id',
              jurisdictionCode: 'TEST-DM03-CONFLICT',
              effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
              effectiveTo: null,
              sourceIds: ['synthetic-source'],
              verified: true,
            },
            detail: ambiguousDetail,
            verificationStatus: 'VERIFIED',
          },
        },
      },
      ruleReferences: [],
      sourceIds: [],
    });

    const outcome = resolveTaxability({
      ruleSet,
      deductionTypeKey: 'CONFLICT_PROBE',
      program: 'INCOME_TAX_WITHHOLDING',
      applicableAmount: money('100'),
      context: { deliveryMechanism: 'CAFETERIA_PLAN' },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.problem.reason).toBe('RULE_CONFLICT');
  });
});
