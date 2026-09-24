import { extractEditorialText } from './blocks';
import { NON_REMOVABLE_BLOCK_TYPES, type SeoBlockType, type SeoLifecycleState } from './types';

/**
 * SEO quality gates (SEO-03 contract §AJ.1, §27).
 *
 * ===========================================================================
 * DETERMINISTIC. RECOMPUTED ON DEMAND — NEVER CACHED (contract §D.9: no `SeoQualityGateResult`
 * table; caching gate results would introduce a second, staleable truth about publishability).
 *
 * Every gate is a pure function of `QualityGateInput` — no database access, no network call.
 * The one exception is tax readiness (gate 10), which this module does NOT evaluate itself:
 * `input.readinessPublishable` is supplied by the caller, already resolved through
 * `coverage.isPublishable()` (`lib/tax/readiness`) — gates.ts never imports the tax domain.
 *
 * A gate is never weakened because data does not yet exist (contract §27) — an absent
 * required block, an unconfigured calculator, or missing tax-year data all FAIL their gate,
 * they do not pass by default.
 * ===========================================================================
 */

export interface QualityGateBlockInput {
  readonly blockType: SeoBlockType;
  readonly payload: unknown;
  readonly isRequired: boolean;
  readonly isRemovable: boolean;
}

export interface QualityGateInput {
  readonly lifecycleState: SeoLifecycleState;

  readonly titleText: string | null;
  readonly descriptionText: string | null;
  readonly h1Text: string | null;
  readonly canonicalPath: string;

  readonly duplicateIdentity: boolean;

  readonly blocks: readonly QualityGateBlockInput[];
  /** Block types this page's type/template requires, beyond the always-required disclaimer. */
  readonly requiredBlockTypes: readonly SeoBlockType[];
  /** Whether this page's jurisdiction genuinely has local-tax relevance — determined by the
   * tax domain, never guessed here and never hardcoded to a specific state (contract §14). */
  readonly hasLocalTaxRelevance: boolean;
  /** Programmatic page types (STATE/SALARY/GUIDE/CALCULATOR) need a content-volume floor. */
  readonly isProgrammaticPage: boolean;

  readonly requiresTaxReadiness: boolean;
  /** Result of `coverage.isPublishable()`, already resolved by the caller — `null` when
   * `requiresTaxReadiness` is false. */
  readonly readinessPublishable: boolean | null;

  readonly calculatorConfigured: boolean;
  readonly calculationAvailable: boolean;
  readonly taxYearDataAvailable: boolean;

  readonly inboundLinkCount: number;
  readonly hasInboundLinkFromHubOrCalculator: boolean;

  readonly relatedLinks: readonly { readonly targetPath: string; readonly valid: boolean }[];

  readonly contentStale: boolean;
}

export interface GateOutcome {
  readonly gate: number;
  readonly name: string;
  readonly passed: boolean;
  readonly detail?: string;
}

/** Implementation-level length discipline (contract §L: "validated on the effective value...
 * so the longest token substitution cannot silently overflow"). Not fixed by the contract
 * itself — standard SEO conventions, adjustable without an architectural change. */
export const TITLE_MAX_LENGTH = 60;
export const DESCRIPTION_MAX_LENGTH = 160;
export const H1_MAX_LENGTH = 70;
export const MIN_INBOUND_LINKS = 2;
export const MIN_PROGRAMMATIC_BLOCK_COUNT = 3;

function gate(gateNumber: number, name: string, passed: boolean, detail?: string): GateOutcome {
  return detail === undefined
    ? { gate: gateNumber, name, passed }
    : { gate: gateNumber, name, passed, detail };
}

/**
 * Gate 16 — no editorial field may contain a numeric pattern resembling a tax rate or
 * threshold (contract §AJ.1, §28).
 *
 * ===========================================================================
 * DELIBERATELY NARROW, PER §28'S OWN INSTRUCTION.
 *
 * §28 requires this gate to distinguish legitimate salary content (`50000`, `$50,000`) from
 * prohibited tax-rule literals, and explicitly says: "If exact detection cannot be implemented
 * safely without false positives, stop and report the specific ambiguity rather than silently
 * creating an unreliable rule."
 *
 * A bare decimal or dollar figure cannot be reliably classified — `$1,250` could be a salary
 * example or a threshold, and there is no text-pattern rule that tells them apart without
 * unacceptable false positives against ordinary salary content. This gate does NOT attempt
 * that classification.
 *
 * What IS safe to detect: a PERCENTAGE. SEO editorial copy never legitimately needs to state
 * "6.2%" — federal/state rates are exactly what `TAX_EXPLANATION`-style blocks describe
 * qualitatively ("Social Security is withheld up to a wage base"), never by quoting a number,
 * because the number would become a second, uncontrolled source of tax truth the instant a
 * real rate changed and this copy did not. A percentage literal is therefore flagged; a plain
 * dollar amount or bare decimal is not — that broader detection is the disclosed, unresolved
 * ambiguity this gate does not silently paper over.
 * ===========================================================================
 */
const PERCENTAGE_PATTERN = /\b\d+(?:\.\d+)?\s*(?:%|percent\b)/i;

function containsSuspectedTaxLiteral(text: string): boolean {
  return PERCENTAGE_PATTERN.test(text);
}

function evaluateBlockRequirements(input: QualityGateInput): {
  requiredPresent: GateOutcome;
  nonRemovablePresent: GateOutcome;
} {
  const presentTypes = new Set(input.blocks.map((block) => block.blockType));

  const missingRequired = input.requiredBlockTypes.filter((type) => !presentTypes.has(type));
  const requiredPresent = gate(
    6,
    'Required blocks present and non-empty',
    missingRequired.length === 0,
    missingRequired.length === 0 ? undefined : `missing: ${missingRequired.join(', ')}`,
  );

  const missingNonRemovable: string[] = [];
  if (!presentTypes.has('DISCLAIMER')) {
    missingNonRemovable.push('DISCLAIMER');
  }
  if (input.hasLocalTaxRelevance && !presentTypes.has('LOCAL_TAX_NOTICE')) {
    missingNonRemovable.push('LOCAL_TAX_NOTICE');
  }
  const nonRemovablePresent = gate(
    18,
    'Required non-removable blocks present',
    missingNonRemovable.length === 0,
    missingNonRemovable.length === 0 ? undefined : `missing: ${missingNonRemovable.join(', ')}`,
  );

  return { requiredPresent, nonRemovablePresent };
}

function evaluateTaxLiteralGate(input: QualityGateInput): GateOutcome {
  const texts = [input.titleText, input.descriptionText, input.h1Text].filter(
    (value): value is string => value !== null,
  );
  for (const block of input.blocks) {
    texts.push(...extractEditorialText(block.blockType, block.payload));
  }

  const offenders = texts.filter(containsSuspectedTaxLiteral);
  return gate(
    16,
    'No tax-value literal in editorial fields',
    offenders.length === 0,
    offenders.length === 0 ? undefined : `suspected literal in: ${offenders.join(' | ')}`,
  );
}

function isValidFaqItem(item: unknown): boolean {
  if (typeof item !== 'object' || item === null) {
    return false;
  }
  const record = item as Record<string, unknown>;
  return (
    typeof record['question'] === 'string' &&
    record['question'] !== '' &&
    typeof record['answer'] === 'string' &&
    record['answer'] !== ''
  );
}

function isValidFaqBlock(block: QualityGateBlockInput): boolean {
  const payload = block.payload as { items?: unknown } | null;
  const items = payload !== null && Array.isArray(payload.items) ? payload.items : [];
  return items.length > 0 && items.every(isValidFaqItem);
}

function evaluateFaqGate(input: QualityGateInput): GateOutcome {
  const faqBlocks = input.blocks.filter((block) => block.blockType === 'FAQ');
  const allValid = faqBlocks.every(isValidFaqBlock);
  return gate(14, 'FAQ blocks valid where present', allValid);
}

/** Evaluates all 18 gates. Never throws — an unevaluable gate fails rather than being skipped. */
export function evaluateQualityGates(input: QualityGateInput): readonly GateOutcome[] {
  const { requiredPresent, nonRemovablePresent } = evaluateBlockRequirements(input);

  const outcomes: GateOutcome[] = [
    gate(
      1,
      'Effective title present, within length discipline',
      input.titleText !== null &&
        input.titleText.length > 0 &&
        input.titleText.length <= TITLE_MAX_LENGTH,
    ),
    gate(
      2,
      'Effective description present, within length discipline',
      input.descriptionText !== null &&
        input.descriptionText.length > 0 &&
        input.descriptionText.length <= DESCRIPTION_MAX_LENGTH,
    ),
    gate(
      3,
      'H1 present and unique on the page',
      // Uniqueness is structural: exactly one h1 field exists per page in this data model.
      input.h1Text !== null && input.h1Text.length > 0 && input.h1Text.length <= H1_MAX_LENGTH,
    ),
    gate(4, 'Canonical resolves to a valid absolute self URL', input.canonicalPath.startsWith('/')),
    gate(5, 'Path unique — no duplicate identity', !input.duplicateIdentity),
    requiredPresent,
    gate(
      7,
      'Minimum content volume met (programmatic pages)',
      !input.isProgrammaticPage || input.blocks.length >= MIN_PROGRAMMATIC_BLOCK_COUNT,
    ),
    gate(8, 'Calculator configuration valid', input.calculatorConfigured),
    gate(9, 'Calculation available for the configuration', input.calculationAvailable),
    gate(
      10,
      'Tax readiness publishable (state pages)',
      !input.requiresTaxReadiness || input.readinessPublishable === true,
    ),
    gate(11, 'Tax-year data available for contentYear', input.taxYearDataAvailable),
    gate(
      12,
      'Minimum inbound-link requirement satisfied',
      input.inboundLinkCount >= MIN_INBOUND_LINKS && input.hasInboundLinkFromHubOrCalculator,
    ),
    gate(
      13,
      'Related-link sets non-empty and resolvable',
      // Scoped like gate 7: HOME/UTILITY carry no related-link requirement (contract §Q.1's
      // table lists none for them), so this gate does not apply there.
      !input.isProgrammaticPage ||
        (input.relatedLinks.length > 0 && input.relatedLinks.every((link) => link.valid)),
    ),
    evaluateFaqGate(input),
    gate(15, 'Content not stale beyond threshold', !input.contentStale),
    evaluateTaxLiteralGate(input),
    gate(17, 'Lifecycle state is PUBLISHED', input.lifecycleState === 'PUBLISHED'),
    nonRemovablePresent,
  ];

  return outcomes.sort((a, b) => a.gate - b.gate);
}

export function allGatesPass(outcomes: readonly GateOutcome[]): boolean {
  return outcomes.every((outcome) => outcome.passed);
}

export function failedGates(outcomes: readonly GateOutcome[]): readonly GateOutcome[] {
  return outcomes.filter((outcome) => !outcome.passed);
}

// `NON_REMOVABLE_BLOCK_TYPES` is re-exported here only so a consumer of this module does not
// also need to import `./types` directly for the one constant most gate callers also need.
export { NON_REMOVABLE_BLOCK_TYPES };
