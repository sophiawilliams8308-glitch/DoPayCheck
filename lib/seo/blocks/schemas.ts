import { z } from 'zod';

import { seoFail, seoOk, type SeoIssue, type SeoResult } from '../result';
import type { SeoBlockType } from '../types';
import { richTextPayloadSchema, type RichTextBlock, type RichTextInline } from './richText';

/**
 * SEO block payload schema registry (SEO-03 contract §D.7, §13).
 *
 * ===========================================================================
 * TYPED JSON, NOT EAV (§43).
 *
 * One row per block (`SeoBlock`), one schema per `blockType`, selected from this registry and
 * enforced on every write. Adding a block type means adding a schema here — never a column,
 * never a migration. There is no `entity/key/value` table, and no schema below accepts raw
 * HTML (`lib/seo/blocks/richText.ts`).
 *
 * Field-level shapes below are an implementation detail within a settled architecture: the
 * SEO-03 contract fixes the closed `SeoBlockType` vocabulary, the non-removable set, the FAQ
 * block's dual role (visible + `FAQPage` JSON-LD, §D.8/§O), and the "no raw HTML" rule — it
 * does not specify every field name. Several block types intentionally carry a minimal or
 * empty payload because their actual content is generated elsewhere, never stored twice:
 *   - RELATED_CALCULATORS/RELATED_STATES/RELATED_SALARIES/RELATED_GUIDES: targets come from
 *     the internal-link module (`lib/seo/internal-links.ts`), not this payload (§Q.2).
 *   - SOURCES: rendered from the calculation layer's `Source` records (§S.1 step 6), never a
 *     second, editable citation list.
 *   - CALCULATOR_EMBED/CALCULATOR_CTA/STATE_PROGRAM_SECTION: reference the EXISTING stable
 *     identity (`calculatorKey`, a Phase 5 capability/program key) — never a second registry.
 * ===========================================================================
 */

const bodySchema = z.object({ body: richTextPayloadSchema });

const heroPayloadSchema = z.object({
  heading: z.string().min(1),
  subheading: z.string().min(1).optional(),
  body: richTextPayloadSchema.optional(),
});

const keyFactsPayloadSchema = z.object({
  items: z.array(z.object({ label: z.string().min(1), value: z.string().min(1) })).min(1),
});

/** References the existing calculator identity — never a second calculator registry. */
const calculatorEmbedPayloadSchema = z.object({
  calculatorKey: z.string().min(1),
});

const calculatorCtaPayloadSchema = z.object({
  label: z.string().min(1),
  calculatorKey: z.string().min(1),
});

/** References an existing Phase 5 program/capability key — never a second state-program list. */
const stateProgramSectionPayloadSchema = z.object({
  programKey: z.string().min(1),
  body: richTextPayloadSchema,
});

/** Pay-frequency selection only — the figures themselves come from the calculation engine at
 * render time, never stored here (contract §S.1, §T: "No stored tax result is ever tax truth"). */
const payFrequencyTablePayloadSchema = z.object({
  frequencies: z.array(z.string().min(1)).min(1),
});

const salaryTablePayloadSchema = z.object({
  frequencies: z.array(z.string().min(1)).min(1),
});

const exampleMinItem = z.object({
  title: z.string().min(1).optional(),
  body: richTextPayloadSchema,
});

/**
 * FAQ — the single source for both the visible FAQ and `FAQPage` JSON-LD (contract §D.8,
 * §O). Plain text, not rich text: `FAQPage` answers are plain strings, and keeping this
 * plain avoids a second sanitization surface for the one block type that always emits schema.
 */
const faqPayloadSchema = z.object({
  items: z
    .array(
      z.object({
        question: z.string().min(1),
        answer: z.string().min(1),
      }),
    )
    .min(1),
});

/** Auto-generated relation blocks: targets come from `lib/seo/internal-links.ts`, never this
 * payload. `maxCount` is an optional editorial cap on an otherwise-computed list. */
const autoRelatedPayloadSchema = z.object({
  maxCount: z.number().int().positive().optional(),
});

/** Rendered from `Source` records at the calculation layer (§S.1 step 6) — no second list. */
const sourcesPayloadSchema = z.object({});

const ctaPayloadSchema = z.object({
  label: z.string().min(1),
  href: z.string().min(1),
});

/** Detail schema per `SeoBlockType`. Exhaustive by construction — `Record<SeoBlockType, ...>`
 * fails to compile if a member is missing, mirroring `STATE_DETAIL_SCHEMAS`. */
export const SEO_BLOCK_SCHEMAS: Record<SeoBlockType, z.ZodTypeAny> = {
  HERO: heroPayloadSchema,
  INTRO: bodySchema,
  RICH_TEXT: bodySchema,
  KEY_FACTS: keyFactsPayloadSchema,
  CALCULATOR_EMBED: calculatorEmbedPayloadSchema,
  CALCULATOR_CTA: calculatorCtaPayloadSchema,
  TAX_EXPLANATION: bodySchema,
  STATE_TAX_SECTION: bodySchema,
  NO_STATE_TAX_SECTION: bodySchema,
  STATE_PROGRAM_SECTION: stateProgramSectionPayloadSchema,
  LOCAL_TAX_NOTICE: bodySchema,
  PAY_FREQUENCY_TABLE: payFrequencyTablePayloadSchema,
  SALARY_TABLE: salaryTablePayloadSchema,
  SALARY_EXAMPLES: bodySchema,
  EXAMPLE: exampleMinItem,
  FAQ: faqPayloadSchema,
  RELATED_CALCULATORS: autoRelatedPayloadSchema,
  RELATED_STATES: autoRelatedPayloadSchema,
  RELATED_SALARIES: autoRelatedPayloadSchema,
  RELATED_GUIDES: autoRelatedPayloadSchema,
  SOURCES: sourcesPayloadSchema,
  CTA: ctaPayloadSchema,
  DISCLAIMER: bodySchema,
};

export type SeoBlockSchemas = typeof SEO_BLOCK_SCHEMAS;

/** Validates a block payload against its type's schema. Never throws. */
export function validateBlockPayload(
  blockType: SeoBlockType,
  payload: unknown,
): SeoResult<unknown> {
  const result = SEO_BLOCK_SCHEMAS[blockType].safeParse(payload);
  if (result.success) {
    return seoOk(result.data as unknown);
  }
  const issues: SeoIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  return seoFail(issues);
}

/** FAQ items, if this block is a populated FAQ block — used by both the visible FAQ renderer
 * and the structured-data emitter so they can never drift apart (contract §D.8, §O). */
export function faqItemsFromPayload(
  blockType: SeoBlockType,
  payload: unknown,
): readonly { question: string; answer: string }[] | null {
  if (blockType !== 'FAQ') {
    return null;
  }
  const result = faqPayloadSchema.safeParse(payload);
  return result.success ? result.data.items : null;
}

function plainTextOfInline(node: RichTextInline): string {
  return node.text;
}

function plainTextOfBlock(node: RichTextBlock): string {
  if (node.type === 'list') {
    return node.items.map((item) => item.map(plainTextOfInline).join(' ')).join(' ');
  }
  return node.children.map(plainTextOfInline).join(' ');
}

/**
 * Extracts every editorial text string from a validated block payload — used by quality gate
 * 16 (contract §AJ.1, §28) to scan for numeric patterns resembling a tax rate or threshold.
 * Returns raw strings only; it performs no tax-literal detection itself (see
 * `lib/seo/gates.ts`).
 */
export function extractEditorialText(blockType: SeoBlockType, payload: unknown): readonly string[] {
  const parsed = SEO_BLOCK_SCHEMAS[blockType].safeParse(payload);
  if (!parsed.success) {
    return [];
  }
  const data = parsed.data as Record<string, unknown>;
  const strings: string[] = [];

  const body = data['body'];
  if (body !== undefined) {
    const richText = richTextPayloadSchema.safeParse(body);
    if (richText.success) {
      strings.push(...richText.data.nodes.map(plainTextOfBlock));
    }
  }

  for (const key of ['heading', 'subheading', 'label', 'title', 'question', 'answer'] as const) {
    const value = data[key];
    if (typeof value === 'string') {
      strings.push(value);
    }
  }

  const items = data['items'];
  if (Array.isArray(items)) {
    for (const item of items as unknown[]) {
      if (item !== null && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        for (const key of ['label', 'value', 'question', 'answer'] as const) {
          const value = record[key];
          if (typeof value === 'string') {
            strings.push(value);
          }
        }
      }
    }
  }

  return strings;
}
