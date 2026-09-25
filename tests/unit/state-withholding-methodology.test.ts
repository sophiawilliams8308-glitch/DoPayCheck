import { describe, expect, it } from 'vitest';

import {
  resolveWithholdingMethodology,
  type WithholdingMethodologyDecision,
} from '@/lib/tax/state/rules/withholdingMethodology';
import type { StateMethodDescriptorDetail } from '@/lib/tax/state/rules/detailSchemas';
import { StateRuleKey } from '@/lib/tax/state/ruleKeys';
import type { Read } from '@/lib/tax/state/rules/read-detail';

/**
 * State withholding methodology dispatcher (DM-03 Slice 17).
 *
 * ===========================================================================
 * SCOPE NOTE — this tests CLASSIFICATION ONLY.
 *
 * `resolveWithholdingMethodology()` never reads a rule set, never runs
 * `runStateWithholdingFormula()` or `selectStateWithholdingTableRow()`, and
 * never produces a withholding amount — see the module's own doc comment
 * for the repository evidence behind exactly which two `structure` values
 * are classified and why the other four are not. These tests cover exactly
 * what IS implemented: the six-way classification and its documented
 * reasoning, nothing downstream of it.
 * ===========================================================================
 */

function methodDetail(structure: string): StateMethodDescriptorDetail {
  return {
    shape: 'METHOD_DESCRIPTOR',
    structure: structure as StateMethodDescriptorDetail['structure'],
    methodName: `Synthetic ${structure} method`,
    usesAllowances: true,
    usesStandardDeduction: true,
    usesExemptions: false,
    startsFromFederalTaxableWages: false,
  };
}

describe('resolveWithholdingMethodology — established structures', () => {
  it('classifies FORMULA as the FORMULA mechanism', () => {
    const result = resolveWithholdingMethodology(methodDetail('FORMULA'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual({ kind: 'FORMULA' });
  });

  it('classifies TABLE as TABLE_SELECTION_ONLY, never as a complete calculation', () => {
    const result = resolveWithholdingMethodology(methodDetail('TABLE'));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual({ kind: 'TABLE_SELECTION_ONLY' });
    expect(result.value.kind).not.toBe('FORMULA');
  });
});

describe('resolveWithholdingMethodology — unresolved structures', () => {
  it.each(['NONE', 'FLAT', 'PROGRESSIVE', 'HYBRID'])(
    'reports SCENARIO_UNSUPPORTED for structure=%s, never a guessed mechanism',
    (structure) => {
      const result = resolveWithholdingMethodology(methodDetail(structure));

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('expected failure');
      expect(result.problem.reason).toBe('SCENARIO_UNSUPPORTED');
      expect(result.problem.ruleKey).toBe(StateRuleKey.WITHHOLDING_METHOD);
      expect(result.problem.detail).toContain(structure);
    },
  );

  it('never reports FLAT/PROGRESSIVE as an alias for FORMULA', () => {
    const flat = resolveWithholdingMethodology(methodDetail('FLAT'));
    const progressive = resolveWithholdingMethodology(methodDetail('PROGRESSIVE'));

    expect(flat.ok).toBe(false);
    expect(progressive.ok).toBe(false);
  });
});

describe('resolveWithholdingMethodology — purity', () => {
  it('does not mutate the supplied detail', () => {
    const detail = methodDetail('FORMULA');
    const before = { ...detail };

    resolveWithholdingMethodology(detail);

    expect(detail).toEqual(before);
  });

  it('is synchronous — no awaited call, no Promise return', () => {
    const result = resolveWithholdingMethodology(methodDetail('TABLE'));
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('is a total function across every schema-declared structure value', () => {
    const structures = ['NONE', 'FLAT', 'PROGRESSIVE', 'TABLE', 'FORMULA', 'HYBRID'];
    for (const structure of structures) {
      const result: Read<WithholdingMethodologyDecision> = resolveWithholdingMethodology(
        methodDetail(structure),
      );
      expect(typeof result.ok).toBe('boolean');
    }
  });
});

describe('resolveWithholdingMethodology — no forbidden responsibilities', () => {
  it('imports no rule-set, database, formula interpreter, or table selector', async () => {
    const fs = await import('node:fs');
    const source = fs.readFileSync(
      new URL('../../lib/tax/state/rules/withholdingMethodology.ts', import.meta.url),
      'utf8',
    );
    const importLines = source
      .split('\n')
      .filter((line) => /^import\b/.test(line.trim()))
      .join('\n');
    expect(importLines).not.toMatch(/getPrisma|PrismaClient|from '@\/lib\/db\//);
    expect(importLines).not.toMatch(/stateRuleSet|ResolvedStateRuleSet/);
    expect(importLines).not.toMatch(/withholdingFormulaInterpreter|runStateWithholdingFormula/);
    expect(importLines).not.toMatch(/withholdingTable|selectStateWithholdingTableRow/);
    expect(importLines).not.toMatch(/candidateRetrieval|resolveCandidates|assembleStateRuleSet/);
    expect(importLines).not.toMatch(/coverageGate/);
    expect(importLines).not.toMatch(/tax\/federal/);
    expect(importLines).not.toMatch(/lib\/calculator/);
    expect(importLines).not.toMatch(/from '@\/lib\/core\/money'/);
  });

  it('performs no arithmetic and reads no other withholding rule key', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(
        new URL('../../lib/tax/state/rules/withholdingMethodology.ts', import.meta.url),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/\bsubtract\(|\bsum\(|\bmultiply\(|\bmoney\(/);
    expect(source).not.toMatch(/WITHHOLDING_ROUNDING_POLICY|WITHHOLDING_PAY_PERIODS_PER_YEAR/);
  });
});
