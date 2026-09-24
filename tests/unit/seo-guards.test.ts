import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Architectural guards for the SEO domain (SEO-04, SEO-03 contract §42, §AJ.3).
 *
 * Scanners, not unit tests — mirroring `tests/unit/state-guards.test.ts`'s own pattern. They
 * enforce the invariants SEO-04's correctness rests on: SEO never reads tax rule data, there
 * is exactly one of each emitter, no EAV table, no arbitrary-HTML block, no second
 * jurisdiction/tax-year registry, and the tax/SEO lifecycles stay separate — so a future
 * change cannot quietly break one of these and still pass a green suite.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SEO = join(ROOT, 'lib/seo');
const TAX_READINESS = join(ROOT, 'lib/tax/readiness');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return full.endsWith('.ts') ? [full] : [];
  });
}

function filesIn(dir: string): { rel: string; text: string }[] {
  return sourceFiles(dir).map((path) => ({
    rel: relative(ROOT, path),
    text: readFileSync(path, 'utf8'),
  }));
}

/** Strips comments so prose about a banned construct does not trip the scanner. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Strips only import-line comments/statements themselves, so scanners that must inspect
 * ACTUAL imports (not prose that merely mentions a forbidden module name) can do so precisely. */
function importLines(text: string): string {
  return code(text)
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line))
    .join('\n');
}

const seoFiles = (): { rel: string; text: string }[] => filesIn(SEO);

describe('SEO must never read TaxRule (contract §F.2, §24)', () => {
  it('no lib/seo file imports TaxRule, verificationStatus, or state rule modules', () => {
    const offenders = seoFiles()
      .filter((file) =>
        /\bTaxRule\b|TaxRule\.verificationStatus|from '@\/lib\/tax\/state\/(?!readiness)/.test(
          importLines(file.text),
        ),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('no lib/seo file imports anything from lib/tax/* except lib/tax/readiness', () => {
    const offenders = seoFiles()
      .filter((file) => {
        const imports = importLines(file.text);
        const taxImports = imports.match(/from '@\/lib\/tax\/[^']+'/g) ?? [];
        return taxImports.some((line) => !line.startsWith("from '@/lib/tax/readiness"));
      })
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('no lib/seo file imports the Prisma-generated TaxRule model type directly', () => {
    const offenders = seoFiles()
      .filter((file) => /\bTaxRule\b/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('lib/tax/readiness has no import from lib/seo — the boundary is one-way (contract §F.4)', () => {
    const offenders = filesIn(TAX_READINESS)
      .filter((file) => /from '@\/lib\/seo\//.test(importLines(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('the only export lib/seo may reach in lib/tax/readiness is coverage.isPublishable', () => {
    const offenders = seoFiles()
      .filter((file) => /from '@\/lib\/tax\/readiness/.test(importLines(file.text)))
      .filter((file) => /repository|fingerprint/i.test(importLines(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});

describe('exactly one of each emitter (contract §19, §31, §AJ.3)', () => {
  it('only lib/seo/metadata.ts defines buildMetadata', () => {
    const offenders = seoFiles()
      .filter((file) => file.rel !== 'lib/seo/metadata.ts')
      .filter((file) => /export function buildMetadata\(/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('only lib/seo/metadata.ts defines canonicalUrl', () => {
    const offenders = seoFiles()
      .filter((file) => file.rel !== 'lib/seo/metadata.ts')
      .filter((file) => /export function canonicalUrl\(/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('only lib/seo/sitemap-eligibility.ts defines listEligibleSeoPages', () => {
    const offenders = seoFiles()
      .filter((file) => file.rel !== 'lib/seo/sitemap-eligibility.ts')
      .filter((file) => /export (async )?function listEligibleSeoPages\(/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('only lib/seo/structured-data.ts defines buildStructuredData', () => {
    const offenders = seoFiles()
      .filter((file) => file.rel !== 'lib/seo/structured-data.ts')
      .filter((file) => /export function buildStructuredData\(/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('only lib/seo/breadcrumbs.ts defines resolveBreadcrumbTrail — visible trail and JSON-LD share one source', () => {
    const offenders = seoFiles()
      .filter((file) => file.rel !== 'lib/seo/breadcrumbs.ts')
      .filter((file) => /export function resolveBreadcrumbTrail\(/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
    // And structured-data.ts must call it rather than reimplementing breadcrumb logic.
    const structuredData = code(readFileSync(join(SEO, 'structured-data.ts'), 'utf8'));
    expect(structuredData).toContain('resolveBreadcrumbTrail(');
  });

  it('app/robots.ts and app/sitemap.ts remain the sole robots/sitemap route files', () => {
    const appDir = join(ROOT, 'app');
    const robotsFiles = sourceFiles(appDir)
      .map((p) => relative(ROOT, p))
      .filter((p) => /robots\.ts$/.test(p));
    const sitemapFiles = sourceFiles(appDir)
      .map((p) => relative(ROOT, p))
      .filter((p) => /sitemap\.ts$/.test(p));
    expect(robotsFiles).toEqual(['app/robots.ts']);
    expect(sitemapFiles).toEqual(['app/sitemap.ts']);
  });
});

describe('no arbitrary-HTML block, no EAV (contract §AB, §43, §D.7)', () => {
  it('no lib/seo file declares a raw html field on a block payload schema', () => {
    const offenders = seoFiles()
      .filter((file) => /html\s*:\s*z\.string\(/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('the block schema registry names no "entity"/"key"/"value" EAV shape', () => {
    const schemas = code(readFileSync(join(SEO, 'blocks/schemas.ts'), 'utf8'));
    expect(schemas).not.toMatch(/\bentity\s*:/i);
    expect(schemas).not.toMatch(/z\.object\(\s*\{\s*key\s*:.*value\s*:/s);
  });

  it('the Prisma schema declares no generic entity/key/value table anywhere', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/model\s+\w*(Field|Eav|EntityValue)\w*\s*\{/i);
  });
});

describe('no second jurisdiction or tax-year registry (contract §C, §14, §AJ.3)', () => {
  it('no lib/seo file hardcodes a state/jurisdiction list', () => {
    const offenders = seoFiles()
      .filter((file) => /\bSTATES\s*[:=]\s*\[|'US-[A-Z]{2}'/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('no lib/seo file names a real US state or territory', () => {
    const realJurisdictions =
      /\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|Ohio|Oklahoma|Oregon|Pennsylvania|Tennessee|Texas|Utah|Vermont|Virginia|Washington|Wisconsin|Wyoming)\b/;
    const offenders = seoFiles()
      .filter((file) => realJurisdictions.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('lib/seo/routes.ts resolves state pages through the EXISTING jurisdiction repository', () => {
    const routes = code(readFileSync(join(SEO, 'routes.ts'), 'utf8'));
    expect(routes).toContain("from '@/lib/jurisdictions/repository'");
    expect(routes).not.toMatch(/SeoJurisdiction/);
  });

  it('no SeoJurisdiction or SeoTaxYear model is declared anywhere', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/model\s+SeoJurisdiction/);
    expect(schema).not.toMatch(/model\s+SeoTaxYear/);
  });

  it('SeoBlockType names no separate SeoFaq entity — FAQ is a block type only', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
    expect(schema).not.toMatch(/model\s+SeoFaq/);
    expect(schema).toMatch(/^\s*FAQ$/m);
  });
});

describe('tax and SEO lifecycles never merged (contract §I.2)', () => {
  it('no lib/seo file imports RuleStatus, VerificationStatus, or TaxYearStatus as its own lifecycle', () => {
    const offenders = seoFiles()
      .filter((file) => /\b(RuleStatus|VerificationStatus|TaxYearStatus)\b/.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('SeoLifecycleState is declared once, independent of the tax rule lifecycle enums', () => {
    const schema = readFileSync(join(ROOT, 'prisma/schema.prisma'), 'utf8');
    const seoLifecycle = /enum SeoLifecycleState \{[\s\S]*?\}/.exec(schema)?.[0] ?? '';
    expect(seoLifecycle).toContain('DRAFT');
    expect(seoLifecycle).toContain('PUBLISHED');
    // The tax RuleStatus enum's own distinctive member must not appear inside SeoLifecycleState.
    expect(seoLifecycle).not.toMatch(/BLOCKED|ROLLED_BACK/);
  });
});

describe('tax year never appears in a public URL (contract §36, §U)', () => {
  it('no lib/seo route/resolver builds a path segment from a tax year', () => {
    const offenders = seoFiles()
      .filter((file) => /\/\$\{.*[Tt]ax[Yy]ear.*\}\//.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  it('resolveBreadcrumbTrail never emits a year-shaped path segment', () => {
    const breadcrumbs = code(readFileSync(join(SEO, 'breadcrumbs.ts'), 'utf8'));
    expect(breadcrumbs).not.toMatch(/\/20\d\d\//);
  });
});

describe('no WordPress / PHP / Rank Math anywhere (contract §32, §42)', () => {
  it('package.json names no WordPress, PHP, or Rank Math dependency', () => {
    const packageJson = readFileSync(join(ROOT, 'package.json'), 'utf8');
    expect(packageJson).not.toMatch(/wordpress|rank-?math/i);
  });

  it('no lib/seo file mentions WordPress, PHP, or Rank Math as an implementation dependency', () => {
    const offenders = seoFiles()
      .filter((file) => /\bwp[-_]|wordpress|rank\s*math|<\?php/i.test(code(file.text)))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});

describe('no unbounded salary generation (contract §T, §35)', () => {
  it('lib/seo/routes.ts validates the salary amount rather than accepting any integer unchecked', () => {
    const routes = code(readFileSync(join(SEO, 'routes.ts'), 'utf8'));
    expect(routes).toMatch(/Number\.isInteger\(amount\)/);
  });
});

describe('coverage.isPublishable is the sole tax-readiness boundary SEO may call', () => {
  it('every lib/seo file that calls a readiness function calls isPublishable, never a repository function', () => {
    const offenders = seoFiles()
      .filter((file) =>
        /\b(grantReadinessApproval|revokeReadinessApproval|findCurrentApproval|findLatestApproval)\b/.test(
          code(file.text),
        ),
      )
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });
});
