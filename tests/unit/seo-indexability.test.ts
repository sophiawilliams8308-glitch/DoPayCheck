import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tax/readiness', () => ({
  coverage: { isPublishable: vi.fn() },
}));

import { coverage } from '@/lib/tax/readiness';
import { resolveIndexability, type IndexabilityInput } from '@/lib/seo/indexability';

const isPublishableMock = vi.mocked(coverage.isPublishable);

function baseInput(overrides: Partial<IndexabilityInput> = {}): IndexabilityInput {
  return {
    lifecycleState: 'PUBLISHED',
    manualIndexable: true,
    routeValid: true,
    jurisdictionId: null,
    taxYearId: null,
    requiredCapabilities: [],

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
        blockType: 'CTA',
        payload: { label: 'Calculate', href: '/paycheck-calculator/' },
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

describe('resolveIndexability — fail-closed derivation (SEO-03 contract §J)', () => {
  it('a fully valid, non-tax-readiness page is indexable', async () => {
    const result = await resolveIndexability(baseInput());
    expect(result).toMatchObject({ indexable: true, reason: 'OK' });
    expect(isPublishableMock).not.toHaveBeenCalled();
  });

  it('ARCHIVED lifecycle ⇒ not indexable, reason ARCHIVED', async () => {
    const result = await resolveIndexability(baseInput({ lifecycleState: 'ARCHIVED' }));
    expect(result.indexable).toBe(false);
    expect(result.reason).toBe('ARCHIVED');
  });

  it('DRAFT lifecycle ⇒ not indexable, reason NOT_PUBLISHED', async () => {
    const result = await resolveIndexability(baseInput({ lifecycleState: 'DRAFT' }));
    expect(result.indexable).toBe(false);
    expect(result.reason).toBe('NOT_PUBLISHED');
  });

  it('manualIndexable=false ⇒ not indexable, reason MANUAL_NOINDEX, even though everything else is valid', async () => {
    const result = await resolveIndexability(baseInput({ manualIndexable: false }));
    expect(result.indexable).toBe(false);
    expect(result.reason).toBe('MANUAL_NOINDEX');
  });

  it('manualIndexable=true alone can never grant indexability past a failed gate', async () => {
    const result = await resolveIndexability(
      baseInput({ manualIndexable: true, contentStale: false, titleText: null }),
    );
    expect(result.indexable).toBe(false);
    expect(result.reason).toBe('QUALITY_GATE_FAILED');
  });

  it('duplicate identity ⇒ not indexable, reason DUPLICATE_IDENTITY', async () => {
    const result = await resolveIndexability(baseInput({ duplicateIdentity: true }));
    expect(result.indexable).toBe(false);
    expect(result.reason).toBe('DUPLICATE_IDENTITY');
  });

  it('stale content ⇒ not indexable, reason CONTENT_STALE', async () => {
    const result = await resolveIndexability(baseInput({ contentStale: true }));
    expect(result.indexable).toBe(false);
    expect(result.reason).toBe('CONTENT_STALE');
  });

  it('a failing quality gate ⇒ not indexable, reason QUALITY_GATE_FAILED, with the failures listed', async () => {
    const result = await resolveIndexability(baseInput({ calculatorConfigured: false }));
    expect(result.indexable).toBe(false);
    expect(result.reason).toBe('QUALITY_GATE_FAILED');
    expect(result.gateOutcomes.some((o) => o.gate === 8)).toBe(true);
  });

  it('calls coverage.isPublishable only when tax readiness is required', async () => {
    isPublishableMock.mockResolvedValueOnce({
      publishable: true,
      reason: 'OK: fine',
      stale: false,
    });
    const result = await resolveIndexability(
      baseInput({
        requiresTaxReadiness: true,
        jurisdictionId: 'jurisdiction-1',
        taxYearId: 2026,
        requiredCapabilities: ['WITHHOLDING'],
      }),
    );
    expect(isPublishableMock).toHaveBeenCalledWith('jurisdiction-1', 2026, ['WITHHOLDING']);
    expect(result.indexable).toBe(true);
  });

  it('readiness not publishable (missing approval) ⇒ TAX_READINESS_MISSING', async () => {
    isPublishableMock.mockResolvedValueOnce({
      publishable: false,
      reason: 'NO_APPROVAL: none ever granted',
      stale: false,
    });
    const result = await resolveIndexability(
      baseInput({
        requiresTaxReadiness: true,
        jurisdictionId: 'jurisdiction-1',
        taxYearId: 2026,
        requiredCapabilities: ['WITHHOLDING'],
      }),
    );
    expect(result.indexable).toBe(false);
    expect(result.reason).toBe('TAX_READINESS_MISSING');
  });

  it('readiness stale ⇒ TAX_READINESS_STALE', async () => {
    isPublishableMock.mockResolvedValueOnce({
      publishable: false,
      reason: 'STALE_EVIDENCE: evidence changed',
      stale: true,
    });
    const result = await resolveIndexability(
      baseInput({
        requiresTaxReadiness: true,
        jurisdictionId: 'jurisdiction-1',
        taxYearId: 2026,
        requiredCapabilities: ['WITHHOLDING'],
      }),
    );
    expect(result.indexable).toBe(false);
    expect(result.reason).toBe('TAX_READINESS_STALE');
  });

  it('readiness insufficient capability ⇒ TAX_CAPABILITY_INSUFFICIENT', async () => {
    isPublishableMock.mockResolvedValueOnce({
      publishable: false,
      reason: 'INSUFFICIENT_CAPABILITY: missing INCOME_TAX',
      stale: false,
    });
    const result = await resolveIndexability(
      baseInput({
        requiresTaxReadiness: true,
        jurisdictionId: 'jurisdiction-1',
        taxYearId: 2026,
        requiredCapabilities: ['WITHHOLDING', 'INCOME_TAX'],
      }),
    );
    expect(result.indexable).toBe(false);
    expect(result.reason).toBe('TAX_CAPABILITY_INSUFFICIENT');
  });

  it('readiness required but no jurisdiction/tax year supplied ⇒ fails closed, never calls the boundary', async () => {
    const result = await resolveIndexability(
      baseInput({ requiresTaxReadiness: true, jurisdictionId: null, taxYearId: null }),
    );
    expect(result.indexable).toBe(false);
    expect(result.reason).toBe('TAX_READINESS_MISSING');
    expect(isPublishableMock).not.toHaveBeenCalled();
  });

  it('an error thrown by the readiness call itself still fails closed here (defense in depth)', async () => {
    isPublishableMock.mockRejectedValueOnce(new Error('unexpected'));
    const result = await resolveIndexability(
      baseInput({
        requiresTaxReadiness: true,
        jurisdictionId: 'jurisdiction-1',
        taxYearId: 2026,
        requiredCapabilities: ['WITHHOLDING'],
      }),
    );
    expect(result.indexable).toBe(false);
  });

  it('an invalid route ⇒ not indexable', async () => {
    const result = await resolveIndexability(baseInput({ routeValid: false }));
    expect(result.indexable).toBe(false);
  });
});
