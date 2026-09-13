import { type Money, toStorageString } from '@/lib/core/money';

import type { CalculationStatus } from '@/lib/calculator/types/status';
import type { RuleReference } from '@/lib/calculator/types/rules';

/**
 * Federal calculation trace (Phase 4).
 *
 * Every federal figure must be explainable from the calculation's own data, down to the
 * worksheet line. "Why is my paycheck this amount?" is answered from these entries, never
 * from prose written alongside the code that could drift from the arithmetic.
 */

export const FederalTraceStage = {
  RULE_RESOLUTION: 'RULE_RESOLUTION',
  WAGE_BUCKETS: 'WAGE_BUCKETS',
  W4_NORMALIZATION: 'W4_NORMALIZATION',
  WORKSHEET_1A: 'WORKSHEET_1A',
  SUPPLEMENTAL: 'SUPPLEMENTAL',
  NRA_ADJUSTMENT: 'NRA_ADJUSTMENT',
  WITHHOLDING_TOTAL: 'WITHHOLDING_TOTAL',
  SOCIAL_SECURITY: 'SOCIAL_SECURITY',
  MEDICARE: 'MEDICARE',
  ADDITIONAL_MEDICARE: 'ADDITIONAL_MEDICARE',
  EMPLOYER_TAXES: 'EMPLOYER_TAXES',
  FUTA: 'FUTA',
  ANNUAL_ESTIMATE: 'ANNUAL_ESTIMATE',
  ROUNDING: 'ROUNDING',
  DISCLOSURES: 'DISCLOSURES',
} as const;

export type FederalTraceStage = (typeof FederalTraceStage)[keyof typeof FederalTraceStage];

/** Values are exact strings, so a trace serializes without precision loss. */
export type TraceValues = Readonly<Record<string, string | number | boolean | null>>;

export interface FederalTraceEntry {
  readonly stage: FederalTraceStage;
  readonly sequence: number;
  readonly description: string;
  readonly inputs: TraceValues;
  readonly outputs: TraceValues;
  /** Rule identities and versions that authorised this stage. */
  readonly rules: readonly RuleReference[];
  readonly sourceIds: readonly string[];
  readonly status: CalculationStatus;
  /** Rounding applied at this stage, when any was. */
  readonly rounding?: string;
  readonly note?: string;
}

export interface FederalTraceEntryInput {
  readonly stage: FederalTraceStage;
  readonly description: string;
  readonly inputs: TraceValues;
  readonly outputs: TraceValues;
  readonly rules?: readonly RuleReference[];
  readonly status?: CalculationStatus;
  readonly rounding?: string;
  readonly note?: string;
}

export function traceMoney(value: Money): string {
  return toStorageString(value);
}

export class FederalTraceBuilder {
  private readonly entries: FederalTraceEntry[] = [];

  /** Appends an entry, assigning sequence and source IDs so they cannot drift. */
  public add(entry: FederalTraceEntryInput): void {
    const rules = entry.rules ?? [];
    this.entries.push({
      stage: entry.stage,
      sequence: this.entries.length,
      description: entry.description,
      inputs: entry.inputs,
      outputs: entry.outputs,
      rules,
      sourceIds: [...new Set(rules.flatMap((rule) => rule.sourceIds))],
      status: entry.status ?? 'COMPLETE',
      ...(entry.rounding === undefined ? {} : { rounding: entry.rounding }),
      ...(entry.note === undefined ? {} : { note: entry.note }),
    });
  }

  public build(): readonly FederalTraceEntry[] {
    return Object.freeze([...this.entries]);
  }
}
