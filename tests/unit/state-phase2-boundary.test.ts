import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RuleStatus } from '@/lib/db/generated/index';
import { ResolutionStatus, isEffectiveAt, resolveApplicableRules } from '@/lib/rules/resolution';

/**
 * The Phase 2 boundary Step 3 must not cross (§ Phase 2 boundary, F-09).
 *
 * Phase 2 owns lifecycle status, effective-window applicability and the
 * effective-date predicate. Step 3 documents that ownership and relies on it;
 * a second implementation of any of the three would be a second source of
 * truth about which rule governs a paycheck.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIGRATION = join(
  ROOT,
  'prisma/migrations/20260912151038_phase2_rule_and_data_system/migration.sql',
);

const TEST_JURISDICTION = 'test-jurisdiction';

function rule(overrides: Partial<Parameters<typeof isEffectiveAt>[0]> = {}) {
  return {
    id: 'synthetic-rule',
    ruleKey: 'STATE.SYNTHETIC.KEY',
    version: 1,
    category: 'STATE_WITHHOLDING' as const,
    jurisdictionId: TEST_JURISDICTION,
    taxYear: 2099,
    status: RuleStatus.ACTIVE,
    effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
    effectiveTo: null as Date | null,
    ...overrides,
  };
}

describe('taxYear is an explicit but non-deciding criterion', () => {
  it('is an optional filter on the Phase 2 query, not the deciding factor', () => {
    const source = readFileSync(join(ROOT, 'lib/rules/resolution.ts'), 'utf8');
    expect(source).toContain('readonly taxYear?: number;');
    // The contract says so in the code, not only in a report.
    expect(source).toContain(
      'Optional administrative filter. Never the deciding factor on its own',
    );
    expect(source).toContain('This, not `taxYear`, decides applicability');
  });

  it('narrows when supplied and is ignored when omitted', () => {
    const candidates = [rule({ taxYear: 2099 })];
    const query = {
      category: 'STATE_WITHHOLDING' as const,
      jurisdictionId: TEST_JURISDICTION,
      effectiveDate: new Date('2099-06-15T00:00:00.000Z'),
    };

    expect(resolveApplicableRules(candidates, query).status).toBe(ResolutionStatus.RESOLVED);
    expect(resolveApplicableRules(candidates, { ...query, taxYear: 2099 }).status).toBe(
      ResolutionStatus.RESOLVED,
    );
    expect(resolveApplicableRules(candidates, { ...query, taxYear: 2098 }).status).toBe(
      ResolutionStatus.NOT_FOUND,
    );
  });

  it('applies effective dates, not the tax year, to decide applicability', () => {
    // Same tax year, outside the window: not applicable.
    const candidates = [
      rule({ effectiveFrom: new Date('2099-07-01T00:00:00.000Z'), taxYear: 2099 }),
    ];
    const result = resolveApplicableRules(candidates, {
      category: 'STATE_WITHHOLDING',
      jurisdictionId: TEST_JURISDICTION,
      effectiveDate: new Date('2099-06-15T00:00:00.000Z'),
      taxYear: 2099,
    });
    expect(result.status).toBe(ResolutionStatus.NOT_FOUND);
  });
});

describe('F-09 — the effective window is half-open, and Phase 2 owns the predicate', () => {
  it('treats effectiveTo as EXCLUSIVE', () => {
    const bounded = rule({ effectiveTo: new Date('2099-10-01T00:00:00.000Z') });
    expect(isEffectiveAt(bounded, new Date('2098-12-31T23:59:59.999Z'))).toBe(false);
    expect(isEffectiveAt(bounded, new Date('2099-01-01T00:00:00.000Z'))).toBe(true);
    expect(isEffectiveAt(bounded, new Date('2099-09-30T23:59:59.999Z'))).toBe(true);
    // The instant the next window opens belongs to the next rule, not this one.
    expect(isEffectiveAt(bounded, new Date('2099-10-01T00:00:00.000Z'))).toBe(false);
  });

  it('treats a null effectiveTo as open-ended', () => {
    expect(isEffectiveAt(rule(), new Date('2999-01-01T00:00:00.000Z'))).toBe(true);
  });

  it('is backed by a database exclusion constraint with the same half-open bound', () => {
    // F-09: the guarantee is in the schema, not only in application code, so it
    // cannot be bypassed by a writer that skips the repository layer.
    const migration = readFileSync(MIGRATION, 'utf8');
    expect(migration).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist');
    expect(migration).toContain('TaxRule_no_overlapping_active_versions');
    expect(migration).toContain('"ruleKey" WITH =');
    expect(migration).toContain(`tsrange("effectiveFrom", "effectiveTo", '[)') WITH &&`);
    expect(migration).toContain(`WHERE ("status" = 'ACTIVE')`);
  });

  it('scopes the constraint to ruleKey and ACTIVE only', () => {
    // Documented scope: not jurisdiction, not category, not tax year; drafts and
    // superseded versions may overlap freely.
    const migration = readFileSync(MIGRATION, 'utf8');
    const constraint =
      /ADD CONSTRAINT "TaxRule_no_overlapping_active_versions"[\s\S]*?WHERE \("status" = 'ACTIVE'\);/.exec(
        migration,
      )?.[0] ?? '';
    expect(constraint.length).toBeGreaterThan(0);
    expect(constraint).not.toMatch(/jurisdictionId|category|taxYearId/);
  });
});

describe('Phase 2 remains the sole owner of lifecycle and status decisions', () => {
  it('consumes only ACTIVE rules', () => {
    const query = {
      category: 'STATE_WITHHOLDING' as const,
      jurisdictionId: TEST_JURISDICTION,
      effectiveDate: new Date('2099-06-15T00:00:00.000Z'),
    };
    for (const status of [
      RuleStatus.DRAFT,
      RuleStatus.PENDING_REVIEW,
      RuleStatus.APPROVED,
      RuleStatus.SUPERSEDED,
      RuleStatus.REJECTED,
      RuleStatus.ROLLED_BACK,
      RuleStatus.BLOCKED,
    ]) {
      expect(
        resolveApplicableRules([rule({ status })], query).status,
        `${status} must not be consumable`,
      ).toBe(ResolutionStatus.NOT_FOUND);
    }
    expect(resolveApplicableRules([rule()], query).status).toBe(ResolutionStatus.RESOLVED);
  });

  it('surfaces two applicable ACTIVE rules rather than arbitrating', () => {
    const result = resolveApplicableRules([rule({ id: 'a' }), rule({ id: 'b', version: 2 })], {
      category: 'STATE_WITHHOLDING',
      jurisdictionId: TEST_JURISDICTION,
      effectiveDate: new Date('2099-06-15T00:00:00.000Z'),
    });
    expect(result.status).toBe(ResolutionStatus.AMBIGUOUS);
  });
});
