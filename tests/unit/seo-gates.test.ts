import { describe, expect, it } from 'vitest';

import {
  DESCRIPTION_MAX_LENGTH,
  MIN_INBOUND_LINKS,
  TITLE_MAX_LENGTH,
  allGatesPass,
  evaluateQualityGates,
  failedGates,
  type QualityGateInput,
} from '@/lib/seo/gates';

function baseInput(overrides: Partial<QualityGateInput> = {}): QualityGateInput {
  return {
    lifecycleState: 'PUBLISHED',
    titleText: 'California Paycheck Calculator',
    descriptionText: 'Estimate your California take-home pay.',
    h1Text: 'California Paycheck Calculator',
    canonicalPath: '/paycheck-calculator/california/',
    duplicateIdentity: false,
    blocks: [
      { blockType: 'HERO', payload: { heading: 'Hero' }, isRequired: true, isRemovable: false },
      {
        blockType: 'DISCLAIMER',
        payload: {
          body: {
            nodes: [{ type: 'paragraph', children: [{ type: 'text', text: 'Estimate only.' }] }],
          },
        },
        isRequired: true,
        isRemovable: false,
      },
      {
        blockType: 'FAQ',
        payload: {
          items: [{ question: 'How is this calculated?', answer: 'Using the calculation engine.' }],
        },
        isRequired: false,
        isRemovable: true,
      },
    ],
    requiredBlockTypes: ['HERO'],
    hasLocalTaxRelevance: false,
    isProgrammaticPage: true,
    requiresTaxReadiness: false,
    readinessPublishable: null,
    calculatorConfigured: true,
    calculationAvailable: true,
    taxYearDataAvailable: true,
    inboundLinkCount: 2,
    hasInboundLinkFromHubOrCalculator: true,
    relatedLinks: [{ targetPath: '/paycheck-calculator/texas/', valid: true }],
    contentStale: false,
    ...overrides,
  };
}

describe('SEO quality gates (SEO-03 contract §AJ.1)', () => {
  it('produces exactly 18 gate outcomes, numbered 1-18', () => {
    const outcomes = evaluateQualityGates(baseInput());
    expect(outcomes).toHaveLength(18);
    expect(outcomes.map((o) => o.gate)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it('a well-formed page passes every gate', () => {
    const outcomes = evaluateQualityGates(baseInput());
    expect(allGatesPass(outcomes)).toBe(true);
    expect(failedGates(outcomes)).toEqual([]);
  });

  it('gate 1 fails when the title is absent', () => {
    const outcomes = evaluateQualityGates(baseInput({ titleText: null }));
    expect(outcomes.find((o) => o.gate === 1)?.passed).toBe(false);
  });

  it('gate 1 fails when the title exceeds the length discipline', () => {
    const outcomes = evaluateQualityGates(
      baseInput({ titleText: 'x'.repeat(TITLE_MAX_LENGTH + 1) }),
    );
    expect(outcomes.find((o) => o.gate === 1)?.passed).toBe(false);
  });

  it('gate 2 fails when the description exceeds the length discipline', () => {
    const outcomes = evaluateQualityGates(
      baseInput({ descriptionText: 'x'.repeat(DESCRIPTION_MAX_LENGTH + 1) }),
    );
    expect(outcomes.find((o) => o.gate === 2)?.passed).toBe(false);
  });

  it('gate 5 fails on a duplicate identity', () => {
    const outcomes = evaluateQualityGates(baseInput({ duplicateIdentity: true }));
    expect(outcomes.find((o) => o.gate === 5)?.passed).toBe(false);
  });

  it('gate 6 fails when a required block type is missing', () => {
    const outcomes = evaluateQualityGates(baseInput({ requiredBlockTypes: ['HERO', 'KEY_FACTS'] }));
    expect(outcomes.find((o) => o.gate === 6)?.passed).toBe(false);
  });

  it('gate 7 fails a programmatic page below the minimum block count', () => {
    const outcomes = evaluateQualityGates(
      baseInput({
        blocks: [
          { blockType: 'HERO', payload: { heading: 'Hero' }, isRequired: true, isRemovable: false },
        ],
        requiredBlockTypes: ['HERO'],
      }),
    );
    expect(outcomes.find((o) => o.gate === 7)?.passed).toBe(false);
  });

  it('gate 7 does not apply to a non-programmatic page', () => {
    const outcomes = evaluateQualityGates(
      baseInput({
        isProgrammaticPage: false,
        blocks: [
          { blockType: 'HERO', payload: { heading: 'Hero' }, isRequired: true, isRemovable: false },
        ],
        requiredBlockTypes: ['HERO'],
      }),
    );
    expect(outcomes.find((o) => o.gate === 7)?.passed).toBe(true);
  });

  it('gate 10 fails when tax readiness is required and not publishable', () => {
    const outcomes = evaluateQualityGates(
      baseInput({ requiresTaxReadiness: true, readinessPublishable: false }),
    );
    expect(outcomes.find((o) => o.gate === 10)?.passed).toBe(false);
  });

  it('gate 10 passes when tax readiness is required and publishable', () => {
    const outcomes = evaluateQualityGates(
      baseInput({ requiresTaxReadiness: true, readinessPublishable: true }),
    );
    expect(outcomes.find((o) => o.gate === 10)?.passed).toBe(true);
  });

  it('gate 10 does not apply when tax readiness is not required', () => {
    const outcomes = evaluateQualityGates(
      baseInput({ requiresTaxReadiness: false, readinessPublishable: null }),
    );
    expect(outcomes.find((o) => o.gate === 10)?.passed).toBe(true);
  });

  it(`gate 12 fails with fewer than ${String(MIN_INBOUND_LINKS)} inbound links`, () => {
    const outcomes = evaluateQualityGates(baseInput({ inboundLinkCount: 1 }));
    expect(outcomes.find((o) => o.gate === 12)?.passed).toBe(false);
  });

  it('gate 12 fails without an inbound link from a hub or calculator page', () => {
    const outcomes = evaluateQualityGates(baseInput({ hasInboundLinkFromHubOrCalculator: false }));
    expect(outcomes.find((o) => o.gate === 12)?.passed).toBe(false);
  });

  it('gate 13 fails when a related link is invalid', () => {
    const outcomes = evaluateQualityGates(
      baseInput({ relatedLinks: [{ targetPath: '/paycheck-calculator/texas/', valid: false }] }),
    );
    expect(outcomes.find((o) => o.gate === 13)?.passed).toBe(false);
  });

  it('gate 14 fails on an empty FAQ block', () => {
    const outcomes = evaluateQualityGates(
      baseInput({
        blocks: [
          ...baseInput().blocks.filter((b) => b.blockType !== 'FAQ'),
          { blockType: 'FAQ', payload: { items: [] }, isRequired: false, isRemovable: true },
        ],
      }),
    );
    expect(outcomes.find((o) => o.gate === 14)?.passed).toBe(false);
  });

  it('gate 15 fails when content is stale', () => {
    const outcomes = evaluateQualityGates(baseInput({ contentStale: true }));
    expect(outcomes.find((o) => o.gate === 15)?.passed).toBe(false);
  });

  it('gate 16 fails on a suspected tax-rate percentage in editorial text', () => {
    const outcomes = evaluateQualityGates(
      baseInput({ descriptionText: 'Social Security withholds 6.2% of wages.' }),
    );
    expect(outcomes.find((o) => o.gate === 16)?.passed).toBe(false);
  });

  it('gate 16 does NOT flag an ordinary salary figure — the documented, deliberate limit', () => {
    const outcomes = evaluateQualityGates(
      baseInput({ descriptionText: 'See what $50,000 a year looks like after taxes.' }),
    );
    expect(outcomes.find((o) => o.gate === 16)?.passed).toBe(true);
  });

  it('gate 16 scans block payload text too, not just title/description/h1', () => {
    const outcomes = evaluateQualityGates(
      baseInput({
        blocks: [
          ...baseInput().blocks,
          {
            blockType: 'RICH_TEXT',
            payload: {
              body: {
                nodes: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', text: 'The rate is 4.5 percent here.' }],
                  },
                ],
              },
            },
            isRequired: false,
            isRemovable: true,
          },
        ],
      }),
    );
    expect(outcomes.find((o) => o.gate === 16)?.passed).toBe(false);
  });

  it('gate 17 fails when lifecycle state is not PUBLISHED', () => {
    const outcomes = evaluateQualityGates(baseInput({ lifecycleState: 'DRAFT' }));
    expect(outcomes.find((o) => o.gate === 17)?.passed).toBe(false);
  });

  it('gate 18 fails when DISCLAIMER is missing', () => {
    const outcomes = evaluateQualityGates(
      baseInput({ blocks: baseInput().blocks.filter((b) => b.blockType !== 'DISCLAIMER') }),
    );
    expect(outcomes.find((o) => o.gate === 18)?.passed).toBe(false);
  });

  it('gate 18 requires LOCAL_TAX_NOTICE only when the jurisdiction has local-tax relevance', () => {
    const withoutRelevance = evaluateQualityGates(baseInput({ hasLocalTaxRelevance: false }));
    expect(withoutRelevance.find((o) => o.gate === 18)?.passed).toBe(true);

    const withRelevance = evaluateQualityGates(baseInput({ hasLocalTaxRelevance: true }));
    expect(withRelevance.find((o) => o.gate === 18)?.passed).toBe(false);

    const withRelevanceAndNotice = evaluateQualityGates(
      baseInput({
        hasLocalTaxRelevance: true,
        blocks: [
          ...baseInput().blocks,
          {
            blockType: 'LOCAL_TAX_NOTICE',
            payload: {
              body: {
                nodes: [
                  { type: 'paragraph', children: [{ type: 'text', text: 'Local tax applies.' }] },
                ],
              },
            },
            isRequired: true,
            isRemovable: false,
          },
        ],
      }),
    );
    expect(withRelevanceAndNotice.find((o) => o.gate === 18)?.passed).toBe(true);
  });
});
