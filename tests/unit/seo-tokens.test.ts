import { describe, expect, it } from 'vitest';

import { substituteTokens, validateTokenTemplate } from '@/lib/seo/tokens';

describe('SEO token validation (SEO-03 contract §G.3)', () => {
  it('accepts a template using only approved tokens', () => {
    const result = validateTokenTemplate('{state} Paycheck Calculator — {tax_year}');
    expect(result.ok).toBe(true);
  });

  it('accepts a template with no tokens at all', () => {
    expect(validateTokenTemplate('Paycheck Calculator').ok).toBe(true);
  });

  it('rejects an unknown token at save time', () => {
    const result = validateTokenTemplate('{state} — {unknown_token}');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.message).toContain('unknown_token');
    }
  });

  it('accepts a conditional clause using an approved token', () => {
    const result = validateTokenTemplate('{?state}Includes {state} program details{/state}');
    expect(result.ok).toBe(true);
  });

  it('rejects a conditional clause using an unknown token', () => {
    const result = validateTokenTemplate('{?bogus}text{/bogus}');
    expect(result.ok).toBe(false);
  });

  it('accepts every member of the fixed vocabulary', () => {
    const template =
      '{state} {state_abbr} {amount} {amount_formatted} {tax_year} {calculator} {site}';
    expect(validateTokenTemplate(template).ok).toBe(true);
  });
});

describe('SEO token substitution', () => {
  it('substitutes every supplied token', () => {
    const output = substituteTokens('{state} Paycheck Calculator — {tax_year}', {
      state: 'California',
      tax_year: '2026',
    });
    expect(output).toBe('California Paycheck Calculator — 2026');
  });

  it('renders a missing token value as empty, never as a literal brace', () => {
    const output = substituteTokens('{state} Calculator', {});
    expect(output).toBe(' Calculator');
    expect(output).not.toContain('{');
    expect(output).not.toContain('}');
  });

  it('renders a conditional clause when its token has a value', () => {
    const output = substituteTokens('Intro. {?state}Also serves {state} residents.{/state}', {
      state: 'Texas',
    });
    expect(output).toBe('Intro. Also serves Texas residents.');
  });

  it('renders a conditional clause as empty when its token is absent', () => {
    const output = substituteTokens('Intro. {?state}Also serves {state} residents.{/state}', {});
    expect(output).toBe('Intro. ');
  });

  it('renders a conditional clause as empty when its token value is an explicit empty string', () => {
    const output = substituteTokens('{?calculator}Calculator: {calculator}{/calculator}', {
      calculator: '',
    });
    expect(output).toBe('');
  });

  it('never renders a literal brace for any input, including an unvalidated unknown token', () => {
    // Defense in depth: even if validation were bypassed, substitution must not leak `{...}`.
    const output = substituteTokens('{unknown_token}', {});
    expect(output).not.toContain('{');
    expect(output).not.toContain('}');
  });
});
