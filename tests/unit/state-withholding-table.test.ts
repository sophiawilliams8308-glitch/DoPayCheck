import { describe, expect, it } from 'vitest';

import { money } from '@/lib/core/money';
import {
  selectStateWithholdingTableRow,
  type StateWithholdingTableRow,
} from '@/lib/tax/state/rules/withholdingTable';
import type { StateWithholdingTableDetail } from '@/lib/tax/state/rules/detailSchemas';

/**
 * State withholding table row selector (Task 4N-R).
 *
 * ===========================================================================
 * SCOPE NOTE — this tests SELECTION ONLY.
 *
 * `readWithholdingTable()` does not exist yet — this module operates on an
 * already-validated `StateWithholdingTableDetail` directly, exactly as its
 * own locked function contract specifies. Arithmetic
 * (`baseWithholding + rate × excess`), rounding, standard deduction,
 * allowances, and supplemental treatment are NOT implemented and therefore
 * not tested here.
 *
 * Fixtures use no real tax value — wage/rate numbers are arbitrary ordering
 * fixtures, not published thresholds.
 * ===========================================================================
 */

function row(overrides: Partial<StateWithholdingTableRow> = {}): StateWithholdingTableRow {
  return {
    ordinal: 0,
    filingStatus: 'SINGLE',
    payFrequency: 'BIWEEKLY',
    wageFrom: '0',
    wageTo: null,
    baseWithholding: '0',
    rate: '0.05',
    unit: 'DECIMAL_FRACTION',
    ...overrides,
  };
}

function table(rows: readonly StateWithholdingTableRow[]): StateWithholdingTableDetail {
  return {
    shape: 'WITHHOLDING_TABLE',
    tableCode: 'TEST-TABLE',
    method: 'Synthetic',
    rows: [...rows],
  };
}

const THREE_BRACKETS: readonly StateWithholdingTableRow[] = [
  row({ ordinal: 0, wageFrom: '0', wageTo: '1000' }),
  row({ ordinal: 1, wageFrom: '1000', wageTo: '2000' }),
  row({ ordinal: 2, wageFrom: '2000', wageTo: null }),
];

describe('selectStateWithholdingTableRow — basic matching', () => {
  it('matches on exact filing status, pay frequency, and wage', () => {
    const t = table([row()]);
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('500'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.filingStatus).toBe('SINGLE');
  });

  it('does not match a different filing status', () => {
    const t = table([row({ filingStatus: 'SINGLE' })]);
    const result = selectStateWithholdingTableRow(t, 'MARRIED', 'BIWEEKLY', money('500'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });

  it('does not match a different pay frequency', () => {
    const t = table([row({ payFrequency: 'BIWEEKLY' })]);
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'WEEKLY', money('500'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });
});

describe('selectStateWithholdingTableRow — wage boundaries', () => {
  it('matches when wage equals wageFrom (inclusive lower bound)', () => {
    const t = table(THREE_BRACKETS);
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('1000'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.ordinal).toBe(1);
  });

  it('does not match the lower row when wage equals its wageTo (exclusive upper bound)', () => {
    const t = table(THREE_BRACKETS);
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('1000'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.ordinal).not.toBe(0);
  });

  it('a wage exactly on a shared boundary matches only the next row', () => {
    const t = table(THREE_BRACKETS);
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('2000'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.ordinal).toBe(2);
  });

  it('open-ended wageTo === null matches any wage at or above wageFrom', () => {
    const t = table(THREE_BRACKETS);
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('999999'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.ordinal).toBe(2);
  });

  it('a wage below the first row wageFrom does not match', () => {
    const t = table([row({ wageFrom: '500', wageTo: null })]);
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('100'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });
});

describe('selectStateWithholdingTableRow — filing status', () => {
  it('returns SCENARIO_UNSUPPORTED when filing status is null', () => {
    const t = table([row()]);
    const result = selectStateWithholdingTableRow(t, null, 'BIWEEKLY', money('500'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
  });

  it('matches a state-native filing status directly, with no mapping', () => {
    const t = table([row({ filingStatus: 'S' })]);
    const result = selectStateWithholdingTableRow(t, 'S', 'BIWEEKLY', money('500'));

    expect(result.ok).toBe(true);
  });

  it('never imports or invokes the filing-status map', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingTable.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/withholdingFilingStatusMap|FilingStatusMap|federalFilingStatus/);
  });
});

describe('selectStateWithholdingTableRow — match cardinality', () => {
  it('returns RULE_CONFLICT for zero matches', () => {
    const t = table([row({ wageFrom: '0', wageTo: '100' })]);
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('500'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });

  it('returns RULE_CONFLICT for overlapping (multiple) matches', () => {
    const overlapping = [
      row({ ordinal: 0, wageFrom: '0', wageTo: '1000' }),
      row({ ordinal: 1, wageFrom: '400', wageTo: null }),
    ];
    const t = table(overlapping);
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('500'));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.problem.reason).toBe('RULE_CONFLICT');
  });

  it('does not resolve multiple matches by ordinal', () => {
    const overlapping = [
      row({ ordinal: 5, wageFrom: '0', wageTo: null }),
      row({ ordinal: 1, wageFrom: '0', wageTo: null }),
    ];
    const t = table(overlapping);
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('500'));

    expect(result.ok).toBe(false);
  });

  it('does not resolve multiple matches by array order', () => {
    const overlapping = [
      row({ wageFrom: '0', wageTo: null }),
      row({ wageFrom: '0', wageTo: null }),
    ];
    const t = table([...overlapping].reverse());
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('500'));

    expect(result.ok).toBe(false);
  });
});

describe('selectStateWithholdingTableRow — pay periods', () => {
  it('does not annualize the supplied wage', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingTable.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/\bmultiply\(/);
    expect(source).not.toMatch(/\b52\b|\b26\b|\b24\b|\b12\b/);
  });

  it('never imports periodsPerYear or WITHHOLDING_PAY_PERIODS_PER_YEAR', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingTable.ts', import.meta.url),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/periodsPerYear|PAY_PERIODS_PER_YEAR|withholdingPayPeriods/);
  });
});

describe('selectStateWithholdingTableRow — separation of concerns', () => {
  it('does not compute a withholding amount', () => {
    const t = table([row({ baseWithholding: '100', rate: '0.1' })]);
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('500'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    // The row is returned verbatim; no arithmetic result appears anywhere.
    expect(result.value).toEqual(expect.objectContaining({ baseWithholding: '100', rate: '0.1' }));
    expect(Object.keys(result.value)).not.toContain('withholding');
    expect(Object.keys(result.value)).not.toContain('amount');
  });

  it('imports no rounding, database, resolver, or federal module', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingTable.ts', import.meta.url),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/withholdingRoundingPolicy|RoundingPolicy/);
    expect(importLines).not.toMatch(/getPrisma|PrismaClient|from '@\/lib\/db\//);
    expect(importLines).not.toMatch(/candidateRetrieval|resolveCandidates|assembleStateRuleSet/);
    expect(importLines).not.toMatch(/coverageGate/);
    expect(importLines).not.toMatch(/tax\/federal/);
    expect(importLines).not.toMatch(/lib\/calculator/);
    expect(importLines).not.toMatch(/from '@\/lib\/rules\/resolution'/);
    expect(importLines).not.toMatch(/from '@\/lib\/jurisdictions\/repository'/);
  });

  it('does not mutate the supplied table', () => {
    const t = table(THREE_BRACKETS);
    const before = JSON.stringify(t);

    selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('1500'));

    expect(JSON.stringify(t)).toBe(before);
  });
});

describe('selectStateWithholdingTableRow — money precision', () => {
  it('uses Decimal-safe comparison, not floating-point conversion', () => {
    const t = table([
      row({ wageFrom: '0', wageTo: '0.3' }),
      row({ ordinal: 1, wageFrom: '0.3', wageTo: null }),
    ]);
    // 0.1 + 0.2 === 0.30000000000000004 in IEEE754 float64; if this module ever
    // routed the comparison through Number(), this exact boundary would expose it.
    const wage = money('0.1').plus(money('0.2'));
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', wage);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.ordinal).toBe(1);
  });

  it('never imports Number() or parseFloat for comparison', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingTable.ts', import.meta.url),
      'utf8',
    );
    expect(source).not.toMatch(/Number\(|parseFloat\(/);
  });
});

describe('purity', () => {
  it('is synchronous — no awaited call, no Promise return', () => {
    const t = table([row()]);
    const result = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('500'));
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('produces the same result on repeated calls with identical inputs', () => {
    const t = table(THREE_BRACKETS);
    const first = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('1500'));
    const second = selectStateWithholdingTableRow(t, 'SINGLE', 'BIWEEKLY', money('1500'));
    expect(second).toEqual(first);
  });
});
