import { type Money, toStorageString } from '@/lib/core/money';

import type { RuleReference } from '../types/rules';
import { CalculationStatus } from '../types/status';

/**
 * Structured calculation trace (spec §17).
 *
 * Every calculation must be explainable from its own data. This records what each stage
 * received, what it produced and which rule authorised it — so "Why Is My Paycheck This
 * Amount?" (Phase 10) is rendered from ACTUAL calculation data rather than generic prose
 * that could contradict the arithmetic.
 *
 * This is the data foundation only. No user-facing text is generated in Phase 3.
 */

export const TraceStep = {
  VALIDATE_INPUT: 'VALIDATE_INPUT',
  NORMALIZE_INPUT: 'NORMALIZE_INPUT',
  RESOLVE_JURISDICTION: 'RESOLVE_JURISDICTION',
  RESOLVE_RULES: 'RESOLVE_RULES',
  GROSS_PAY: 'GROSS_PAY',
  PRE_TAX_DEDUCTIONS: 'PRE_TAX_DEDUCTIONS',
  TAXABLE_WAGES: 'TAXABLE_WAGES',
  FEDERAL: 'FEDERAL',
  FICA: 'FICA',
  STATE: 'STATE',
  LOCAL: 'LOCAL',
  POST_TAX_DEDUCTIONS: 'POST_TAX_DEDUCTIONS',
  EMPLOYER_TAXES: 'EMPLOYER_TAXES',
  VALIDATE_CALCULATION: 'VALIDATE_CALCULATION',
  NET_PAY: 'NET_PAY',
} as const;

export type TraceStep = (typeof TraceStep)[keyof typeof TraceStep];

/** Values are exact decimal strings so a trace can be serialized without precision loss. */
export type TraceValues = Readonly<Record<string, string | number | boolean | null>>;

/** Broad grouping a step belongs to, for consumers that render the trace by section. */
export const TraceCategory = {
  INPUT: 'INPUT',
  JURISDICTION: 'JURISDICTION',
  RULES: 'RULES',
  EARNINGS: 'EARNINGS',
  DEDUCTIONS: 'DEDUCTIONS',
  WAGES: 'WAGES',
  TAX: 'TAX',
  EMPLOYER: 'EMPLOYER',
  RESULT: 'RESULT',
} as const;

export type TraceCategory = (typeof TraceCategory)[keyof typeof TraceCategory];

/** Which category each step belongs to. */
const STEP_CATEGORY: Record<TraceStep, TraceCategory> = {
  VALIDATE_INPUT: TraceCategory.INPUT,
  NORMALIZE_INPUT: TraceCategory.INPUT,
  RESOLVE_JURISDICTION: TraceCategory.JURISDICTION,
  RESOLVE_RULES: TraceCategory.RULES,
  GROSS_PAY: TraceCategory.EARNINGS,
  PRE_TAX_DEDUCTIONS: TraceCategory.DEDUCTIONS,
  TAXABLE_WAGES: TraceCategory.WAGES,
  FEDERAL: TraceCategory.TAX,
  FICA: TraceCategory.TAX,
  STATE: TraceCategory.TAX,
  LOCAL: TraceCategory.TAX,
  POST_TAX_DEDUCTIONS: TraceCategory.DEDUCTIONS,
  EMPLOYER_TAXES: TraceCategory.EMPLOYER,
  VALIDATE_CALCULATION: TraceCategory.RESULT,
  NET_PAY: TraceCategory.RESULT,
};

export function categoryForStep(step: TraceStep): TraceCategory {
  return STEP_CATEGORY[step];
}

export interface TraceEntry {
  readonly step: TraceStep;
  /** Zero-based position in the pipeline, assigned on insertion. */
  readonly sequence: number;
  readonly category: TraceCategory;
  /** Short machine-readable description. Not user-facing copy. */
  readonly description: string;
  readonly inputs: TraceValues;
  readonly outputs: TraceValues;
  /** Rules that authorised this step, with version and source provenance. */
  readonly rules: readonly RuleReference[];
  /** Official source IDs behind those rules, flattened for convenience. */
  readonly sourceIds: readonly string[];
  /** Outcome of this step. Mirrors the component status where one applies. */
  readonly status: CalculationStatus;
  /** Why a step produced no value, when applicable. */
  readonly note?: string;
}

/** Converts `Money` to its exact string form for the trace. */
export function traceMoney(value: Money): string {
  return toStorageString(value);
}

/** Accumulates trace entries in pipeline order. */
export interface TraceEntryInput {
  readonly step: TraceStep;
  readonly description: string;
  readonly inputs: TraceValues;
  readonly outputs: TraceValues;
  readonly rules?: readonly RuleReference[];
  readonly status?: CalculationStatus;
  readonly note?: string;
}

export class TraceBuilder {
  private readonly entries: TraceEntry[] = [];

  /**
   * Appends an entry, assigning its sequence and category automatically so ordering and
   * grouping cannot drift from the pipeline.
   */
  public add(entry: TraceEntryInput): void {
    const rules = entry.rules ?? [];
    this.entries.push({
      step: entry.step,
      sequence: this.entries.length,
      category: categoryForStep(entry.step),
      description: entry.description,
      inputs: entry.inputs,
      outputs: entry.outputs,
      rules,
      sourceIds: [...new Set(rules.flatMap((rule) => rule.sourceIds))],
      status: entry.status ?? CalculationStatus.COMPLETE,
      ...(entry.note === undefined ? {} : { note: entry.note }),
    });
  }

  /** Convenience for steps with no rule dependency. */
  public addStep(
    step: TraceStep,
    description: string,
    inputs: TraceValues,
    outputs: TraceValues,
    note?: string,
  ): void {
    this.add({
      step,
      description,
      inputs,
      outputs,
      ...(note === undefined ? {} : { note }),
    });
  }

  public build(): readonly TraceEntry[] {
    return Object.freeze([...this.entries]);
  }
}
