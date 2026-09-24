import { describe, expect, it } from 'vitest';

import {
  SEO_BLOCK_SCHEMAS,
  extractEditorialText,
  faqItemsFromPayload,
  validateBlockPayload,
} from '@/lib/seo/blocks';
import { NON_REMOVABLE_BLOCK_TYPES, type SeoBlockType } from '@/lib/seo/types';

const ALL_BLOCK_TYPES = Object.keys(SEO_BLOCK_SCHEMAS) as SeoBlockType[];

describe('SEO block schema registry', () => {
  it('has a schema for every SeoBlockType member (23 types)', () => {
    expect(ALL_BLOCK_TYPES).toHaveLength(23);
  });

  it('never accepts a raw-HTML field on any block type', () => {
    // No schema anywhere in the registry may define a plain `html` string field — the one
    // escape hatch contract §AB forbids.
    for (const blockType of ALL_BLOCK_TYPES) {
      const result = SEO_BLOCK_SCHEMAS[blockType].safeParse({ html: '<script>alert(1)</script>' });
      // Every schema is either .strict()/object-shaped and will reject the unknown `html` key,
      // or will fail for missing required fields — either way, `html` must never be accepted
      // as-is into a stored payload.
      if (result.success) {
        expect(JSON.stringify(result.data)).not.toContain('<script>');
      }
    }
  });

  it('rejects an unknown block payload shape', () => {
    const result = validateBlockPayload('HERO', { notAField: true });
    expect(result.ok).toBe(false);
  });

  it('validates a well-formed HERO payload', () => {
    const result = validateBlockPayload('HERO', { heading: 'Paycheck Calculator' });
    expect(result.ok).toBe(true);
  });

  it('validates a well-formed FAQ payload with at least one Q&A pair', () => {
    const result = validateBlockPayload('FAQ', {
      items: [{ question: 'How is this calculated?', answer: 'Using the calculation engine.' }],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects an empty FAQ items array', () => {
    const result = validateBlockPayload('FAQ', { items: [] });
    expect(result.ok).toBe(false);
  });

  it('DISCLAIMER and LOCAL_TAX_NOTICE are the only non-removable block types', () => {
    expect(NON_REMOVABLE_BLOCK_TYPES.size).toBe(2);
    expect(NON_REMOVABLE_BLOCK_TYPES.has('DISCLAIMER')).toBe(true);
    expect(NON_REMOVABLE_BLOCK_TYPES.has('LOCAL_TAX_NOTICE')).toBe(true);
    expect(NON_REMOVABLE_BLOCK_TYPES.has('HERO')).toBe(false);
  });
});

describe('FAQ block drives both visible FAQ and structured data from one payload', () => {
  it('extracts FAQ items only from an actual FAQ block', () => {
    const payload = { items: [{ question: 'Q1', answer: 'A1' }] };
    expect(faqItemsFromPayload('FAQ', payload)).toEqual([{ question: 'Q1', answer: 'A1' }]);
    expect(faqItemsFromPayload('RICH_TEXT', payload)).toBeNull();
  });

  it('returns null for an invalid FAQ payload rather than fabricating items', () => {
    expect(faqItemsFromPayload('FAQ', { items: [] })).toBeNull();
    expect(faqItemsFromPayload('FAQ', { wrong: true })).toBeNull();
  });
});

describe('editorial text extraction (feeds quality gate 16)', () => {
  it('extracts rich-text body content as plain strings', () => {
    const payload = {
      body: {
        nodes: [
          { type: 'paragraph', children: [{ type: 'text', text: 'Take-home pay explained.' }] },
        ],
      },
    };
    expect(extractEditorialText('RICH_TEXT', payload)).toContain('Take-home pay explained.');
  });

  it('extracts FAQ question/answer text', () => {
    const payload = { items: [{ question: 'How much tax?', answer: 'It depends on your state.' }] };
    expect(extractEditorialText('FAQ', payload)).toEqual(
      expect.arrayContaining(['How much tax?', 'It depends on your state.']),
    );
  });

  it('returns an empty array for an invalid payload rather than throwing', () => {
    expect(extractEditorialText('HERO', { notAField: true })).toEqual([]);
  });
});
