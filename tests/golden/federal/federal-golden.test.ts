import { describe, expect, it } from 'vitest';

import { calculateFederalTaxes } from '@/lib/tax/federal';

import { OFFICIAL_GOLDEN_CASES } from './cases';

/**
 * Golden tests for the federal engine (Phase 4).
 *
 * The runner is complete; the CASES are not, because official worked examples are
 * PENDING_DATA. Rather than invent expected amounts, the suite skips and says so — a skipped
 * honest test is worth more than a green fabricated one.
 *
 * Each case is checked against the engine version it was verified on, so a methodology change
 * cannot silently keep passing an old expectation.
 */

describe('federal golden cases', () => {
  it('registers only cases carrying a real source citation', () => {
    for (const testCase of OFFICIAL_GOLDEN_CASES) {
      expect(testCase.source.organization).not.toBe('');
      expect(testCase.source.document).not.toBe('');
      expect(testCase.source.location).not.toBe('');
    }
  });

  it.skipIf(OFFICIAL_GOLDEN_CASES.length === 0)(
    'reproduces every official worked example exactly',
    () => {
      for (const testCase of OFFICIAL_GOLDEN_CASES) {
        const result = calculateFederalTaxes(testCase.context);

        expect(
          result.engineVersion,
          `${testCase.id} was verified against a different engine version`,
        ).toBe(testCase.engineVersion);

        const checks: [string | undefined, string | null, string][] = [
          [testCase.expected.withholdingTotal, result.withholding.total.amount, 'withholding'],
          [
            testCase.expected.socialSecurityEmployee,
            result.fica.socialSecurityEmployee.amount,
            'social security',
          ],
          [testCase.expected.medicareEmployee, result.fica.medicareEmployee.amount, 'medicare'],
          [
            testCase.expected.additionalMedicareEmployee,
            result.fica.additionalMedicareEmployee.amount,
            'additional medicare',
          ],
          [testCase.expected.futaEmployer, result.employer?.futa.amount ?? null, 'futa'],
        ];

        for (const [expected, actual, label] of checks) {
          if (expected !== undefined) {
            expect(actual, `${testCase.id}: ${label}`).toBe(expected);
          }
        }
      }
    },
  );

  it('states plainly that official cases are still pending', () => {
    // This assertion is intended to FAIL once official data lands — that is the signal to
    // populate the registry and delete this test.
    expect(OFFICIAL_GOLDEN_CASES.length).toBe(0);
  });
});
