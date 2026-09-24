import { describe, expect, it } from 'vitest';

import {
  adjacentSalariesForSalary,
  calculatorsForGuide,
  checkOrphanPrevention,
  childrenForHub,
  mainCalculatorForState,
  relatedCalculatorsForCalculator,
  relatedCalculatorsForState,
  relatedStatesForState,
  salaryCalculatorForSalary,
  selectRelatedLinks,
  statesForCalculatorHub,
  validateLinkTargets,
  type LinkCandidate,
} from '@/lib/seo/internal-links';

function candidates(count: number): LinkCandidate[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `/x/${String(i)}/`,
    label: `X ${String(i)}`,
  }));
}

describe('selectRelatedLinks — deterministic, bounded selection', () => {
  it('never selects more than max', () => {
    expect(selectRelatedLinks(candidates(20), 6)).toHaveLength(6);
  });

  it('selects fewer than max when fewer candidates exist', () => {
    expect(selectRelatedLinks(candidates(2), 6)).toHaveLength(2);
  });

  it('preserves the candidate pool order (selection rule lives at the call site)', () => {
    const pool = candidates(5);
    expect(selectRelatedLinks(pool, 3)).toEqual(pool.slice(0, 3));
  });

  it('is deterministic — same input, same output', () => {
    const pool = candidates(10);
    expect(selectRelatedLinks(pool, 4)).toEqual(selectRelatedLinks(pool, 4));
  });
});

describe('per-relation wrappers pin the contract §Q.1 counts', () => {
  it('CALCULATOR → related calculators caps at 6', () => {
    expect(relatedCalculatorsForCalculator(candidates(20))).toHaveLength(6);
  });

  it('CALCULATOR (paycheck) → states caps at 10', () => {
    expect(statesForCalculatorHub(candidates(51))).toHaveLength(10);
  });

  it('STATE → main calculator is always exactly 1', () => {
    expect(
      mainCalculatorForState({ path: '/paycheck-calculator/', label: 'Paycheck Calculator' }),
    ).toHaveLength(1);
  });

  it('STATE → related states caps at 8', () => {
    expect(relatedStatesForState(candidates(50))).toHaveLength(8);
  });

  it('STATE → related calculators caps at 5', () => {
    expect(relatedCalculatorsForState(candidates(20))).toHaveLength(5);
  });

  it('SALARY → salary calculator is always exactly 1', () => {
    expect(
      salaryCalculatorForSalary({
        path: '/salary-paycheck-calculator/',
        label: 'Salary Calculator',
      }),
    ).toHaveLength(1);
  });

  it('SALARY → adjacent salaries caps at 4', () => {
    expect(adjacentSalariesForSalary(candidates(20))).toHaveLength(4);
  });

  it('GUIDE → calculators caps at 3', () => {
    expect(calculatorsForGuide(candidates(20))).toHaveLength(3);
  });

  it('HUB → children returns every candidate ("All" per the contract table)', () => {
    expect(childrenForHub(candidates(37))).toHaveLength(37);
  });
});

describe('validateLinkTargets — drops non-published/non-indexable targets', () => {
  it('keeps only targets present in the published+indexable set', () => {
    const targets = [
      { path: '/a/', label: 'A' },
      { path: '/b/', label: 'B' },
      { path: '/c/', label: 'C' },
    ];
    const published = new Set(['/a/', '/c/']);
    expect(validateLinkTargets(targets, published)).toEqual([
      { path: '/a/', label: 'A' },
      { path: '/c/', label: 'C' },
    ]);
  });

  it('drops every target when none are published', () => {
    expect(validateLinkTargets([{ path: '/a/', label: 'A' }], new Set())).toEqual([]);
  });
});

describe('checkOrphanPrevention (contract §Q.2)', () => {
  it('fails with fewer than 2 distinct inbound sources', () => {
    const result = checkOrphanPrevention([{ fromPath: '/a/', fromIsHubOrCalculator: true }]);
    expect(result.ok).toBe(false);
    expect(result.inboundCount).toBe(1);
  });

  it('fails with 2+ sources but none from a hub or calculator page', () => {
    const result = checkOrphanPrevention([
      { fromPath: '/a/', fromIsHubOrCalculator: false },
      { fromPath: '/b/', fromIsHubOrCalculator: false },
    ]);
    expect(result.ok).toBe(false);
    expect(result.hasHubOrCalculatorSource).toBe(false);
  });

  it('passes with 2+ distinct sources, at least one from a hub or calculator page', () => {
    const result = checkOrphanPrevention([
      { fromPath: '/a/', fromIsHubOrCalculator: true },
      { fromPath: '/b/', fromIsHubOrCalculator: false },
    ]);
    expect(result.ok).toBe(true);
  });

  it('counts distinct sources only — a duplicate source path does not inflate the count', () => {
    const result = checkOrphanPrevention([
      { fromPath: '/a/', fromIsHubOrCalculator: true },
      { fromPath: '/a/', fromIsHubOrCalculator: true },
    ]);
    expect(result.inboundCount).toBe(1);
    expect(result.ok).toBe(false);
  });
});
