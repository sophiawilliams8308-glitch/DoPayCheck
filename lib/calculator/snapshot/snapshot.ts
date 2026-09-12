import type { CalculationInput } from '../types/input';
import type { CalculationResult } from '../types/result';
import type { RuleReference } from '../types/rules';

/**
 * Calculation snapshot (spec §40).
 *
 * ===========================================================================
 * WHY SNAPSHOTS EXIST
 *
 * A report issued today must remain explainable years later, after the tax rules it used have
 * been superseded. Re-running the engine against current rules would produce a DIFFERENT
 * answer and silently rewrite history.
 *
 * The snapshot therefore stores everything needed to reproduce the original: the input, the
 * normalized input, the full result including its trace, the exact rule IDs and versions, the
 * source IDs, and the engine version — because methodology changes too.
 * ===========================================================================
 *
 * Rule references are DENORMALIZED into the snapshot on purpose. Pointing at live rule rows
 * would leave the snapshot at the mercy of later archival; copying the identity keeps it
 * self-contained (spec §40).
 *
 * Monetary values inside the payloads are exact decimal STRINGS, so JSON serialization cannot
 * reintroduce floating-point error (spec §4).
 */

export interface CalculationSnapshotPayload {
  readonly engineVersion: string;
  readonly taxYear: number;
  readonly effectiveDate: Date;
  readonly federalCode: string;
  readonly stateCode: string | null;
  readonly localCodes: readonly string[];
  readonly status: string;
  readonly originalInput: unknown;
  readonly normalizedInput: unknown;
  readonly result: unknown;
  readonly ruleReferences: readonly RuleReference[];
  readonly sourceIds: readonly string[];
}

/** Serializes dates so the stored JSON is stable and comparable across runs. */
function serializeReference(reference: RuleReference): Record<string, unknown> {
  return {
    ruleId: reference.ruleId,
    ruleKey: reference.ruleKey,
    version: reference.version,
    category: reference.category,
    taxYear: reference.taxYear,
    jurisdictionId: reference.jurisdictionId,
    jurisdictionCode: reference.jurisdictionCode,
    effectiveFrom: reference.effectiveFrom.toISOString(),
    effectiveTo: reference.effectiveTo === null ? null : reference.effectiveTo.toISOString(),
    sourceIds: [...reference.sourceIds],
    verified: reference.verified,
  };
}

/**
 * Builds the snapshot payload from a completed calculation.
 *
 * Pure: it performs no I/O, so it is testable without a database. Persisting the payload is a
 * separate concern.
 */
export function buildSnapshot(
  input: CalculationInput,
  result: CalculationResult,
): CalculationSnapshotPayload {
  return {
    engineVersion: result.engineVersion,
    taxYear: result.taxYear,
    effectiveDate: new Date(result.effectiveDate),
    federalCode: result.jurisdiction.federalCode,
    stateCode: result.jurisdiction.stateCode,
    localCodes: [...result.jurisdiction.localCodes],
    status: result.status,
    // Dates are serialized so the stored input round-trips deterministically.
    originalInput: JSON.parse(JSON.stringify(input)) as unknown,
    normalizedInput: {
      taxYear: input.taxYear,
      effectiveDate: input.effectiveDate.toISOString(),
      payFrequency: input.pay.payFrequency,
      payBasis: input.pay.basis,
      preTaxDeductionCount: input.preTaxDeductions?.length ?? 0,
      postTaxDeductionCount: input.postTaxDeductions?.length ?? 0,
    },
    result: JSON.parse(JSON.stringify(result)) as unknown,
    ruleReferences: result.ruleReferences,
    sourceIds: [...result.sourceIds],
  };
}

/** Shape written to the database, with references already serialized. */
export function toPersistablePayload(
  snapshot: CalculationSnapshotPayload,
): Record<string, unknown> {
  return {
    engineVersion: snapshot.engineVersion,
    taxYear: snapshot.taxYear,
    effectiveDate: snapshot.effectiveDate,
    federalCode: snapshot.federalCode,
    stateCode: snapshot.stateCode,
    localCodes: [...snapshot.localCodes],
    status: snapshot.status,
    originalInput: snapshot.originalInput,
    normalizedInput: snapshot.normalizedInput,
    result: snapshot.result,
    ruleReferences: snapshot.ruleReferences.map(serializeReference),
    sourceIds: [...snapshot.sourceIds],
  };
}

/**
 * Checks whether a stored snapshot reproduces a freshly computed result.
 *
 * Used to prove historical reproducibility: the engine is deterministic, so replaying a
 * snapshot's input against its recorded rules must yield an identical result.
 */
export function resultsMatch(a: CalculationResult, b: CalculationResult): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
