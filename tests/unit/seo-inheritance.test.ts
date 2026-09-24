import { describe, expect, it } from 'vitest';

import {
  RESET_TO_INHERITED,
  normalizeOverrideWrite,
  resolveInheritance,
} from '@/lib/seo/inheritance';

describe('SEO inheritance resolution (SEO-03 contract §H)', () => {
  it('a value at the Page level wins over every higher level', () => {
    const result = resolveInheritance({
      page: 'Page Title',
      context: 'Context Title',
      template: 'Template Title',
      pageType: 'PageType Title',
      global: 'Global Title',
    });
    expect(result).toEqual({ value: 'Page Title', source: 'PAGE' });
  });

  it('absence at the Page level inherits from Context', () => {
    const result = resolveInheritance({
      page: null,
      context: 'Context Title',
      template: 'Template Title',
      pageType: 'PageType Title',
      global: 'Global Title',
    });
    expect(result).toEqual({ value: 'Context Title', source: 'CONTEXT' });
  });

  it('absence at every level resolves to ABSENT, never a fabricated fallback', () => {
    const result = resolveInheritance({
      page: null,
      context: null,
      template: null,
      pageType: null,
      global: null,
    });
    expect(result).toEqual({ value: null, source: 'ABSENT' });
  });

  it('an explicit empty string at Template SUPPRESSES the field rather than inheriting from PageType/Global', () => {
    const result = resolveInheritance({
      page: null,
      context: null,
      template: '',
      pageType: 'PageType Title',
      global: 'Global Title',
    });
    expect(result).toEqual({ value: '', source: 'TEMPLATE' });
  });

  it('a nearer level with "" still wins over a farther level with a real value', () => {
    const result = resolveInheritance({
      page: '',
      context: 'Context Title',
      template: null,
      pageType: null,
      global: null,
    });
    expect(result).toEqual({ value: '', source: 'PAGE' });
  });
});

describe('write-time normalization (contract §H.2)', () => {
  it('normalizes whitespace-only input to an explicit empty string', () => {
    expect(normalizeOverrideWrite('   ')).toBe('');
    expect(normalizeOverrideWrite('\t\n')).toBe('');
  });

  it('leaves null (reset to inherited) unchanged', () => {
    expect(normalizeOverrideWrite(null)).toBeNull();
  });

  it('leaves a meaningful value unchanged, including its own internal spacing', () => {
    expect(normalizeOverrideWrite('California Paycheck Calculator')).toBe(
      'California Paycheck Calculator',
    );
    expect(normalizeOverrideWrite('  leading space kept in a real value  ')).toBe(
      '  leading space kept in a real value  ',
    );
  });

  it('RESET_TO_INHERITED is null — reset never copies the resolved value down', () => {
    expect(RESET_TO_INHERITED).toBeNull();
  });
});
