'use client';

import { useState, useTransition } from 'react';

import { FILING_STATUSES, type FilingStatus } from '@/lib/tax/federal/rule-keys';
import type { PayBasis } from '@/lib/calculator/types/input';
import type { PayFrequency } from '@/lib/db/generated/client';
import {
  CALCULATOR_UI_FREQUENCIES,
  getCalculatorDefinition,
  type CalculatorKey,
} from '@/lib/seo/calculators/registry';
import {
  runCalculator,
  type CalculatorFormFieldIssue,
  type CalculatorRunOutcome,
} from '@/lib/calculator/server/runCalculator';

/**
 * Shared calculator UI foundation (SEO-05 contract §13).
 *
 * ===========================================================================
 * ONE FORM COMPONENT, CONFIGURED BY THE CALCULATOR REGISTRY.
 *
 * Every calculator page (Slices 6-11) renders this same component with its own
 * `calculatorKey` — the registry entry (`lib/seo/calculators/registry.ts`) decides which
 * fields appear (pay basis lock, overtime, bonus). This is what contract §14 means by
 * "different calculator URLs must represent a meaningful calculator/page configuration, not
 * merely duplicate the same UI under different names": the shared engine and shared form are
 * one thing; the CONFIGURATION each page passes in is what varies.
 *
 * Submits to the `runCalculator` server action (`lib/calculator/server/runCalculator.ts`) —
 * the only place this component talks to the calculation engine or the database. No fetch(),
 * no route handler: calling a `'use server'` function directly from a client component is the
 * one App Router pattern that fits here (contract §14 — introduced only because the engine's
 * rule resolution genuinely requires server/database access, not out of familiarity).
 * ===========================================================================
 */

const FILING_STATUS_LABELS: Record<FilingStatus, string> = {
  SINGLE_OR_MFS: 'Single or Married Filing Separately',
  MARRIED_FILING_JOINTLY: 'Married Filing Jointly',
  HEAD_OF_HOUSEHOLD: 'Head of Household',
};

const FREQUENCY_LABELS: Record<PayFrequency, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every 2 weeks',
  SEMIMONTHLY: 'Twice a month',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  ANNUAL: 'Annual',
  DAILY: 'Daily',
};

interface FormState {
  payBasis: PayBasis;
  payFrequency: PayFrequency;
  filingStatus: FilingStatus;
  annualSalary: string;
  hourlyRate: string;
  regularHours: string;
  overtimeHours: string;
  overtimeMultiplier: string;
  bonus: string;
}

function initialState(defaultBasis: PayBasis): FormState {
  return {
    payBasis: defaultBasis,
    payFrequency: 'BIWEEKLY',
    filingStatus: 'SINGLE_OR_MFS',
    annualSalary: '',
    hourlyRate: '',
    regularHours: '',
    overtimeHours: '',
    overtimeMultiplier: '1.5',
    bonus: '',
  };
}

function fieldIssue(
  issues: readonly CalculatorFormFieldIssue[] | undefined,
  path: string,
): string | undefined {
  return issues?.find((issue) => issue.path === path)?.message;
}

export interface CalculatorFormProps {
  readonly calculatorKey: CalculatorKey;
}

export function CalculatorForm({ calculatorKey }: CalculatorFormProps): React.ReactElement {
  const definition = getCalculatorDefinition(calculatorKey);
  const lockedBasis =
    definition !== null && definition.supportedPayBases.length === 1
      ? definition.supportedPayBases[0]
      : null;

  // Hooks run unconditionally (Rules of Hooks) even for an unconfigured `calculatorKey` — not
  // reachable through the route today (Slice 3/4 only ever render a known calculator), but the
  // component must degrade safely rather than assume its prop is always valid.
  const [state, setState] = useState<FormState>(() => initialState(lockedBasis ?? 'SALARY'));
  const [outcome, setOutcome] = useState<CalculatorRunOutcome | null>(null);
  const [isPending, startTransition] = useTransition();

  function update<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setState((previous) => ({ ...previous, [key]: value }));
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (definition === null) {
      return;
    }
    startTransition(() => {
      void (async () => {
        const result = await runCalculator({
          calculatorKey,
          payBasis: state.payBasis,
          payFrequency: state.payFrequency,
          filingStatus: state.filingStatus,
          ...(state.payBasis === 'SALARY' && state.annualSalary !== ''
            ? { annualSalary: state.annualSalary }
            : {}),
          ...(state.payBasis === 'HOURLY' && state.hourlyRate !== ''
            ? { hourlyRate: state.hourlyRate }
            : {}),
          ...(state.payBasis === 'HOURLY' && state.regularHours !== ''
            ? { regularHours: state.regularHours }
            : {}),
          ...(definition.supportsOvertime && state.overtimeHours !== ''
            ? { overtimeHours: state.overtimeHours, overtimeMultiplier: state.overtimeMultiplier }
            : {}),
          ...(definition.supportsBonus && state.bonus !== '' ? { bonus: state.bonus } : {}),
        });
        setOutcome(result);
      })();
    });
  }

  const issues = outcome !== null && !outcome.ok ? outcome.issues : undefined;

  if (definition === null) {
    return <p role="alert">This calculator is not configured.</p>;
  }

  return (
    <div>
      {definition.scopeDisclosure !== undefined ? (
        <p role="note">{definition.scopeDisclosure}</p>
      ) : null}

      <form onSubmit={onSubmit} aria-busy={isPending}>
        {lockedBasis === null ? (
          <fieldset>
            <legend>Pay type</legend>
            {definition.supportedPayBases.map((basis) => (
              <label key={basis}>
                <input
                  type="radio"
                  name="payBasis"
                  value={basis}
                  checked={state.payBasis === basis}
                  onChange={() => {
                    update('payBasis', basis);
                  }}
                />
                {basis === 'SALARY' ? 'Salary' : 'Hourly'}
              </label>
            ))}
          </fieldset>
        ) : null}

        {state.payBasis === 'SALARY' ? (
          <div>
            <label htmlFor="annualSalary">Annual salary ($)</label>
            <input
              id="annualSalary"
              inputMode="decimal"
              value={state.annualSalary}
              onChange={(event) => {
                update('annualSalary', event.target.value);
              }}
              aria-invalid={fieldIssue(issues, 'annualSalary') !== undefined}
              required
            />
            {fieldIssue(issues, 'annualSalary') !== undefined ? (
              <p role="alert">{fieldIssue(issues, 'annualSalary')}</p>
            ) : null}
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="hourlyRate">Hourly rate ($)</label>
              <input
                id="hourlyRate"
                inputMode="decimal"
                value={state.hourlyRate}
                onChange={(event) => {
                  update('hourlyRate', event.target.value);
                }}
                aria-invalid={fieldIssue(issues, 'hourlyRate') !== undefined}
                required
              />
            </div>
            <div>
              <label htmlFor="regularHours">Hours per pay period</label>
              <input
                id="regularHours"
                inputMode="decimal"
                value={state.regularHours}
                onChange={(event) => {
                  update('regularHours', event.target.value);
                }}
                aria-invalid={fieldIssue(issues, 'regularHours') !== undefined}
                required
              />
            </div>
          </>
        )}

        <div>
          <label htmlFor="payFrequency">Pay frequency</label>
          <select
            id="payFrequency"
            value={state.payFrequency}
            onChange={(event) => {
              update('payFrequency', event.target.value as PayFrequency);
            }}
          >
            {CALCULATOR_UI_FREQUENCIES.map((frequency) => (
              <option key={frequency} value={frequency}>
                {FREQUENCY_LABELS[frequency]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="filingStatus">Federal filing status</label>
          <select
            id="filingStatus"
            value={state.filingStatus}
            onChange={(event) => {
              update('filingStatus', event.target.value as FilingStatus);
            }}
          >
            {FILING_STATUSES.map((status) => (
              <option key={status} value={status}>
                {FILING_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        {definition.supportsOvertime ? (
          <div>
            <label htmlFor="overtimeHours">Overtime hours (optional)</label>
            <input
              id="overtimeHours"
              inputMode="decimal"
              value={state.overtimeHours}
              onChange={(event) => {
                update('overtimeHours', event.target.value);
              }}
            />
            <label htmlFor="overtimeMultiplier">Overtime multiplier</label>
            <input
              id="overtimeMultiplier"
              inputMode="decimal"
              value={state.overtimeMultiplier}
              onChange={(event) => {
                update('overtimeMultiplier', event.target.value);
              }}
            />
          </div>
        ) : null}

        {definition.supportsBonus ? (
          <div>
            <label htmlFor="bonus">Bonus this pay period (optional)</label>
            <input
              id="bonus"
              inputMode="decimal"
              value={state.bonus}
              onChange={(event) => {
                update('bonus', event.target.value);
              }}
            />
          </div>
        ) : null}

        <button type="submit" disabled={isPending}>
          {isPending ? 'Calculating…' : 'Calculate'}
        </button>
      </form>

      {outcome !== null ? <CalculatorResult outcome={outcome} /> : null}
    </div>
  );
}

function CalculatorResult({
  outcome,
}: {
  readonly outcome: CalculatorRunOutcome;
}): React.ReactElement {
  if (!outcome.ok) {
    const message =
      outcome.reason === 'NO_DEFAULT_TAX_YEAR'
        ? 'No current tax year is configured yet, so this calculator cannot run.'
        : outcome.reason === 'UNKNOWN_CALCULATOR'
          ? 'This calculator is not available.'
          : 'Please check the highlighted fields.';
    return (
      <div role="alert">
        <p>{message}</p>
        {outcome.issues !== undefined ? (
          <ul>
            {outcome.issues.map((issue) => (
              <li key={issue.path}>{issue.message}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  const { result } = outcome;

  if (result.status !== 'COMPLETE') {
    return (
      <div role="status">
        <p>
          This calculation is incomplete for tax year {outcome.taxYear}: the tax data needed to
          finish it is not yet available. Nothing below is a final figure.
        </p>
        <dl>
          <dt>Gross pay (this period)</dt>
          <dd>${result.grossPay.total}</dd>
        </dl>
      </div>
    );
  }

  return (
    <div role="status">
      <dl>
        <dt>Gross pay (this period)</dt>
        <dd>${result.grossPay.total}</dd>
        <dt>Total taxes withheld</dt>
        <dd>${result.totalEmployeeTaxes}</dd>
        <dt>Net (take-home) pay</dt>
        <dd>${result.netPay}</dd>
      </dl>
    </div>
  );
}
