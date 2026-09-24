import { seoFail, seoOk, type SeoIssue, type SeoResult } from './result';
import { SEO_TOKENS, type SeoToken, type TokenValues } from './types';

/**
 * Token substitution (SEO-03 contract §G.3).
 *
 * ===========================================================================
 * A FIXED VOCABULARY, NOT A SCRIPTING LANGUAGE.
 *
 * Only the seven tokens in `SEO_TOKENS` are ever valid: `{state}` `{state_abbr}` `{amount}`
 * `{amount_formatted}` `{tax_year}` `{calculator}` `{site}`. An unknown token is a VALIDATION
 * ERROR AT SAVE TIME (`validateTokenTemplate`) — it must never reach a page as a literal
 * `{unknown_token}` string.
 *
 * Conditional clauses are the one other construct this module understands:
 * `{?token}...{/token}` renders its contents only when `token` has a non-empty resolved
 * value, and renders empty otherwise (e.g. a state-program clause that only makes sense for
 * states with that program). There is no branching on anything but token presence, no loop,
 * no expression, no user-suppliable logic — deliberately not a general-purpose templating
 * language (contract §G.3: "Do not create a general-purpose scripting language").
 * ===========================================================================
 */

const SIMPLE_TOKEN_PATTERN = /\{([a-z_]+)\}/g;
const CONDITIONAL_TOKEN_PATTERN = /\{\?([a-z_]+)\}([\s\S]*?)\{\/\1\}/g;

const VALID_TOKENS: ReadonlySet<string> = new Set(SEO_TOKENS);

function isValidToken(name: string): name is SeoToken {
  return VALID_TOKENS.has(name);
}

/**
 * Validates every token reference in a template string — both simple `{token}` and
 * conditional `{?token}...{/token}` forms. Called at save time; a template that fails this
 * must never be persisted (contract §G.3).
 */
export function validateTokenTemplate(template: string): SeoResult<void> {
  const issues: SeoIssue[] = [];
  const seen = new Set<string>();

  for (const match of template.matchAll(CONDITIONAL_TOKEN_PATTERN)) {
    seen.add(match[1] ?? '');
  }
  // Strip conditional wrappers before scanning for simple tokens, so a conditional's own
  // `{?token}`/`{/token}` markers are not double-reported as unknown simple tokens.
  const withoutConditionals = template.replace(
    CONDITIONAL_TOKEN_PATTERN,
    (_full, _name, inner: string) => inner,
  );
  for (const match of withoutConditionals.matchAll(SIMPLE_TOKEN_PATTERN)) {
    seen.add(match[1] ?? '');
  }

  for (const name of seen) {
    if (!isValidToken(name)) {
      issues.push({ path: 'template', message: `Unknown token "{${name}}"` });
    }
  }

  return issues.length === 0 ? seoOk(undefined) : seoFail(issues);
}

/**
 * Substitutes tokens in an already-validated template. A conditional clause whose token has
 * no value (undefined or empty string) renders as empty; otherwise its contents render with
 * the token substituted inside them too. Any simple token with no supplied value renders as
 * empty rather than a literal `{token}` — the save-time validation is what prevents an
 * UNKNOWN token from ever reaching this function in the first place.
 */
export function substituteTokens(template: string, values: TokenValues): string {
  const withConditionalsResolved = template.replace(
    CONDITIONAL_TOKEN_PATTERN,
    (_full, name: string, inner: string) => {
      const value = isValidToken(name) ? values[name] : undefined;
      return value !== undefined && value !== '' ? inner : '';
    },
  );

  return withConditionalsResolved.replace(SIMPLE_TOKEN_PATTERN, (_full, name: string) => {
    if (!isValidToken(name)) {
      return '';
    }
    return values[name] ?? '';
  });
}
