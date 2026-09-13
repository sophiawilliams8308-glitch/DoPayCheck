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

/** The 15 required trace stages — spec §27.1, in worksheet order. */
export const FederalTraceStage = {
  WAGE_BUCKETS: 'WAGE_BUCKETS',
  TAX_YEAR_RESOLUTION: 'TAX_YEAR_RESOLUTION',
  RULE_RESOLUTION: 'RULE_RESOLUTION',
  PAY_FREQUENCY: 'PAY_FREQUENCY',
  W4_NORMALIZATION: 'W4_NORMALIZATION',
  WORKSHEET_1A: 'WORKSHEET_1A',
  SCHEDULE_ROW: 'SCHEDULE_ROW',
  SUPPLEMENTAL: 'SUPPLEMENTAL',
  NRA_ADJUSTMENT: 'NRA_ADJUSTMENT',
  SOCIAL_SECURITY: 'SOCIAL_SECURITY',
  MEDICARE: 'MEDICARE',
  ADDITIONAL_MEDICARE: 'ADDITIONAL_MEDICARE',
  FUTA: 'FUTA',
  EMPLOYER_TAXES: 'EMPLOYER_TAXES',
  ROUNDING: 'ROUNDING',
  ANNUAL_ESTIMATE: 'ANNUAL_ESTIMATE',
  DISCLOSURES: 'DISCLOSURES',
} as const;

export type FederalTraceStage = (typeof FederalTraceStage)[keyof typeof FederalTraceStage];

/** Values are exact strings, so a trace serializes without precision loss. */
export type TraceValues = Readonly<Record<string, string | number | boolean | null>>;

export interface FederalTraceEntry {
  readonly stage: FederalTraceStage;
  readonly sequence: number;
  /** Plain-language label for the user-facing projection (§27.2). */
  readonly label: string;
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
  readonly label?: string;
  readonly inputs: TraceValues;
  readonly outputs: TraceValues;
  readonly rules?: readonly RuleReference[];
  readonly status?: CalculationStatus;
  readonly rounding?: string;
  readonly note?: string;
}

/** Plain-language stage labels for the user-facing projection (§27.4). */
const STAGE_LABELS: Record<FederalTraceStage, string> = {
  WAGE_BUCKETS: 'What part of your pay is taxed',
  TAX_YEAR_RESOLUTION: 'Which tax year applies',
  RULE_RESOLUTION: 'Which official rules were used',
  PAY_FREQUENCY: 'How often you are paid',
  W4_NORMALIZATION: 'What your W-4 says',
  WORKSHEET_1A: 'How your federal income tax withholding was worked out',
  SCHEDULE_ROW: 'Which withholding rate band you fall in',
  SUPPLEMENTAL: 'Withholding on bonuses and other supplemental pay',
  NRA_ADJUSTMENT: 'Nonresident alien adjustment',
  SOCIAL_SECURITY: 'Social Security',
  MEDICARE: 'Medicare',
  ADDITIONAL_MEDICARE: 'Additional Medicare',
  FUTA: 'Federal unemployment tax (paid by your employer)',
  EMPLOYER_TAXES: 'What your employer pays',
  ROUNDING: 'Rounding',
  ANNUAL_ESTIMATE: 'Estimated tax for the year',
  DISCLOSURES: 'Assumptions and limits',
};

/**
 * Stages that exist for administrators and are withheld from the user projection.
 *
 * `RULE_RESOLUTION` is the whole point of the admin trace and has no place in a
 * user's explanation: its outputs are rule keys, counts and source identifiers.
 */
const ADMIN_ONLY_STAGES: ReadonlySet<string> = new Set([FederalTraceStage.RULE_RESOLUTION]);

/**
 * User-facing projection (§27.4): plain language, no internal identifiers.
 *
 * The same trace object serves both audiences. Structurally, this drops `rules`
 * and `sourceIds` rather than filtering their contents — a projection that tried
 * to redact identifiers field by field would leak the first one someone added.
 */
export function toUserTrace(
  entries: readonly FederalTraceEntry[],
): readonly { stage: string; label: string; outputs: TraceValues }[] {
  return entries
    .filter((entry) => !ADMIN_ONLY_STAGES.has(entry.stage))
    .map((entry) => ({
      stage: entry.stage,
      label: entry.label,
      outputs: entry.outputs,
    }));
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
      label: entry.label ?? STAGE_LABELS[entry.stage],
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
