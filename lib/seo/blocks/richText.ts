import { z } from 'zod';

/**
 * Constrained, safe rich text (SEO-03 contract §AB: "No raw-HTML block in the initial model.
 * Rich text is a constrained structured format, sanitized on write and on render.").
 *
 * There is no `html: z.string()` field anywhere in this file, and never may be — that is
 * exactly the escape hatch §AB forbids, since it would let an editor inject an unverified tax
 * claim past every other safeguard this project has. A renderer maps these node types onto
 * markup itself; this schema never accepts markup as input.
 */

const richTextInlineSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1) }),
  z.object({ type: z.literal('link'), text: z.string().min(1), href: z.string().min(1) }),
]);

export type RichTextInline = z.infer<typeof richTextInlineSchema>;

const richTextBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), children: z.array(richTextInlineSchema).min(1) }),
  z.object({
    type: z.literal('heading'),
    level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    children: z.array(richTextInlineSchema).min(1),
  }),
  z.object({
    type: z.literal('list'),
    ordered: z.boolean(),
    items: z.array(z.array(richTextInlineSchema).min(1)).min(1),
  }),
]);

export type RichTextBlock = z.infer<typeof richTextBlockSchema>;

export const richTextPayloadSchema = z.object({
  nodes: z.array(richTextBlockSchema).min(1),
});

export type RichTextPayload = z.infer<typeof richTextPayloadSchema>;
