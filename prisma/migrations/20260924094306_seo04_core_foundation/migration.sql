-- CreateEnum
CREATE TYPE "SeoPageTypeKey" AS ENUM ('HOME', 'CALCULATOR', 'STATE', 'SALARY', 'GUIDE', 'HUB', 'UTILITY');

-- CreateEnum
CREATE TYPE "SeoLifecycleState" AS ENUM ('DRAFT', 'REVIEW', 'VERIFIED', 'PUBLISHED', 'NEEDS_UPDATE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SeoBlockType" AS ENUM ('HERO', 'INTRO', 'RICH_TEXT', 'KEY_FACTS', 'CALCULATOR_EMBED', 'CALCULATOR_CTA', 'TAX_EXPLANATION', 'STATE_TAX_SECTION', 'NO_STATE_TAX_SECTION', 'STATE_PROGRAM_SECTION', 'LOCAL_TAX_NOTICE', 'PAY_FREQUENCY_TABLE', 'SALARY_TABLE', 'SALARY_EXAMPLES', 'EXAMPLE', 'FAQ', 'RELATED_CALCULATORS', 'RELATED_STATES', 'RELATED_SALARIES', 'RELATED_GUIDES', 'SOURCES', 'CTA', 'DISCLAIMER');

-- CreateEnum
CREATE TYPE "SeoIndexabilityReason" AS ENUM ('OK', 'NOT_PUBLISHED', 'QUALITY_GATE_FAILED', 'TAX_READINESS_MISSING', 'TAX_READINESS_STALE', 'TAX_CAPABILITY_INSUFFICIENT', 'CONTENT_STALE', 'DUPLICATE_IDENTITY', 'MANUAL_NOINDEX', 'ARCHIVED');

-- CreateTable
CREATE TABLE "SeoSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "siteName" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "defaultDescription" TEXT NOT NULL,
    "defaultOgImagePath" TEXT,
    "defaultTwitterCard" TEXT,
    "organizationName" TEXT,
    "organizationLogoPath" TEXT,
    "organizationSameAs" TEXT[],
    "defaultRobotsIndex" BOOLEAN NOT NULL DEFAULT true,
    "defaultRobotsFollow" BOOLEAN NOT NULL DEFAULT true,
    "titleTokenDefaults" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoPageTypeConfig" (
    "id" TEXT NOT NULL,
    "pageType" "SeoPageTypeKey" NOT NULL,
    "titleTemplate" TEXT,
    "descriptionTemplate" TEXT,
    "h1Template" TEXT,
    "defaultIndexable" BOOLEAN NOT NULL DEFAULT true,
    "defaultBlockStructure" JSONB,
    "defaultStructuredDataTypes" TEXT[],
    "defaultTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoPageTypeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pageType" "SeoPageTypeKey" NOT NULL,
    "titleTemplate" TEXT,
    "descriptionTemplate" TEXT,
    "h1Template" TEXT,
    "internalLinkRules" JSONB,
    "isDefaultForType" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoPage" (
    "id" TEXT NOT NULL,
    "pageType" "SeoPageTypeKey" NOT NULL,
    "path" TEXT NOT NULL,
    "templateId" TEXT,
    "jurisdictionId" TEXT,
    "salaryAmount" INTEGER,
    "calculatorKey" TEXT,
    "guideSlug" TEXT,
    "lifecycleState" "SeoLifecycleState" NOT NULL DEFAULT 'DRAFT',
    "manualIndexable" BOOLEAN NOT NULL DEFAULT false,
    "titleOverride" TEXT,
    "descriptionOverride" TEXT,
    "h1Override" TEXT,
    "ogImagePathOverride" TEXT,
    "canonicalOverride" TEXT,
    "canonicalOverrideReason" TEXT,
    "contentYear" INTEGER,
    "requiredCapabilities" TEXT[],
    "relatedLinksCache" JSONB,
    "lastReviewedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoBlock" (
    "id" TEXT NOT NULL,
    "pageId" TEXT,
    "templateId" TEXT,
    "blockType" "SeoBlockType" NOT NULL,
    "position" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isRemovable" BOOLEAN NOT NULL DEFAULT true,
    "condition" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxDataReadinessApproval" (
    "id" TEXT NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "taxYearId" INTEGER NOT NULL,
    "capabilities" TEXT[],
    "evidenceFingerprint" TEXT NOT NULL,
    "approvedByUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxDataReadinessApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeoPageTypeConfig_pageType_key" ON "SeoPageTypeConfig"("pageType");

-- CreateIndex
CREATE UNIQUE INDEX "SeoTemplate_key_key" ON "SeoTemplate"("key");

-- CreateIndex
CREATE INDEX "SeoTemplate_pageType_idx" ON "SeoTemplate"("pageType");

-- CreateIndex
CREATE INDEX "SeoTemplate_isDefaultForType_idx" ON "SeoTemplate"("isDefaultForType");

-- CreateIndex
CREATE UNIQUE INDEX "SeoPage_path_key" ON "SeoPage"("path");

-- CreateIndex
CREATE INDEX "SeoPage_pageType_lifecycleState_idx" ON "SeoPage"("pageType", "lifecycleState");

-- CreateIndex
CREATE INDEX "SeoPage_lifecycleState_idx" ON "SeoPage"("lifecycleState");

-- CreateIndex
CREATE INDEX "SeoPage_jurisdictionId_idx" ON "SeoPage"("jurisdictionId");

-- CreateIndex
CREATE INDEX "SeoPage_salaryAmount_idx" ON "SeoPage"("salaryAmount");

-- CreateIndex
CREATE INDEX "SeoPage_contentYear_idx" ON "SeoPage"("contentYear");

-- CreateIndex
CREATE INDEX "SeoBlock_blockType_idx" ON "SeoBlock"("blockType");

-- CreateIndex
CREATE UNIQUE INDEX "SeoBlock_pageId_position_key" ON "SeoBlock"("pageId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SeoBlock_templateId_position_key" ON "SeoBlock"("templateId", "position");

-- CreateIndex
CREATE INDEX "TaxDataReadinessApproval_jurisdictionId_taxYearId_approvedA_idx" ON "TaxDataReadinessApproval"("jurisdictionId", "taxYearId", "approvedAt" DESC);

-- CreateIndex
CREATE INDEX "TaxDataReadinessApproval_revokedAt_idx" ON "TaxDataReadinessApproval"("revokedAt");

-- AddForeignKey
ALTER TABLE "SeoPageTypeConfig" ADD CONSTRAINT "SeoPageTypeConfig_defaultTemplateId_fkey" FOREIGN KEY ("defaultTemplateId") REFERENCES "SeoTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoPage" ADD CONSTRAINT "SeoPage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SeoTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoPage" ADD CONSTRAINT "SeoPage_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoBlock" ADD CONSTRAINT "SeoBlock_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "SeoPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeoBlock" ADD CONSTRAINT "SeoBlock_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SeoTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxDataReadinessApproval" ADD CONSTRAINT "TaxDataReadinessApproval_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxDataReadinessApproval" ADD CONSTRAINT "TaxDataReadinessApproval_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- SEO-04 — DATA INTEGRITY BEYOND THE PRISMA SCHEMA
--
-- Prisma cannot express CHECK constraints, partial unique indexes or triggers
-- (the same limitation noted in the Phase 2 migration). Everything below is
-- purely additive: new constraints, new indexes and new triggers on the six
-- tables this migration just created. Nothing here touches an existing table,
-- column, index, constraint, trigger or enum value.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- SeoSettings is a genuine singleton: the fixed `id` default keeps a second
-- row from colliding on the primary key, and this CHECK keeps a caller from
-- working around that by inserting a different id value.
-- ---------------------------------------------------------------------------
ALTER TABLE "SeoSettings"
  ADD CONSTRAINT "SeoSettings_singleton" CHECK ("id" = 'singleton');

-- ---------------------------------------------------------------------------
-- SeoBlock has exactly one parent: pageId XOR templateId (SEO-03 contract
-- §D.7, §13). Never both, never neither.
-- ---------------------------------------------------------------------------
ALTER TABLE "SeoBlock"
  ADD CONSTRAINT "SeoBlock_exactly_one_parent"
  CHECK (
    ("pageId" IS NOT NULL AND "templateId" IS NULL) OR
    ("pageId" IS NULL AND "templateId" IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- At most ONE SeoTemplate may be the default for a given pageType.
-- Same partial-unique-index pattern as TaxYear_single_current.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "SeoTemplate_one_default_per_type"
  ON "SeoTemplate" ("pageType") WHERE "isDefaultForType";

-- ---------------------------------------------------------------------------
-- SeoPage's four type-specific identity fields (contract §D.6, §12):
-- each is REQUIRED for its own pageType (a CHECK, since Prisma has no
-- conditional NOT NULL) and, where required, UNIQUE among pages of that
-- type (a partial unique index, since Postgres unique constraints treat
-- NULLs as distinct and a plain unique column would not by itself enforce
-- "one STATE page per jurisdiction").
-- ---------------------------------------------------------------------------
ALTER TABLE "SeoPage"
  ADD CONSTRAINT "SeoPage_jurisdictionId_required_for_state"
  CHECK ("pageType" <> 'STATE' OR "jurisdictionId" IS NOT NULL);

ALTER TABLE "SeoPage"
  ADD CONSTRAINT "SeoPage_salaryAmount_required_for_salary"
  CHECK ("pageType" <> 'SALARY' OR "salaryAmount" IS NOT NULL);

ALTER TABLE "SeoPage"
  ADD CONSTRAINT "SeoPage_calculatorKey_required_for_calculator"
  CHECK ("pageType" <> 'CALCULATOR' OR "calculatorKey" IS NOT NULL);

ALTER TABLE "SeoPage"
  ADD CONSTRAINT "SeoPage_guideSlug_required_for_guide"
  CHECK ("pageType" <> 'GUIDE' OR "guideSlug" IS NOT NULL);

CREATE UNIQUE INDEX "SeoPage_one_state_page_per_jurisdiction"
  ON "SeoPage" ("jurisdictionId") WHERE "pageType" = 'STATE';

CREATE UNIQUE INDEX "SeoPage_one_salary_page_per_amount"
  ON "SeoPage" ("salaryAmount") WHERE "pageType" = 'SALARY';

CREATE UNIQUE INDEX "SeoPage_one_calculator_page_per_key"
  ON "SeoPage" ("calculatorKey") WHERE "pageType" = 'CALCULATOR';

CREATE UNIQUE INDEX "SeoPage_one_guide_page_per_slug"
  ON "SeoPage" ("guideSlug") WHERE "pageType" = 'GUIDE';

-- ---------------------------------------------------------------------------
-- SeoPage.canonicalOverride requires SeoPage.canonicalOverrideReason
-- (contract §K: "Manual override requires: explicit reason, auditability,
-- validation").
-- ---------------------------------------------------------------------------
ALTER TABLE "SeoPage"
  ADD CONSTRAINT "SeoPage_canonical_override_requires_reason"
  CHECK ("canonicalOverride" IS NULL OR "canonicalOverrideReason" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- TAX DATA READINESS APPROVAL — NEVER DELETED, EFFECTIVELY IMMUTABLE
--
-- Contract §E.1: "Rows are effectively immutable — only the revocation
-- fields are ever written after creation... Deletion: never." Enforced in
-- the database, mirroring AuditLog's own append-only trigger, so no
-- application path — ORM, raw SQL or a psql session — can rewrite or erase
-- an approval decision.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dopaycheck_tax_readiness_approval_no_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'TaxDataReadinessApproval rows are never deleted; revoke instead'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TaxDataReadinessApproval_no_delete"
  BEFORE DELETE ON "TaxDataReadinessApproval"
  FOR EACH ROW EXECUTE FUNCTION dopaycheck_tax_readiness_approval_no_delete();

CREATE OR REPLACE FUNCTION dopaycheck_tax_readiness_approval_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."jurisdictionId" IS DISTINCT FROM OLD."jurisdictionId"
     OR NEW."taxYearId" IS DISTINCT FROM OLD."taxYearId"
     OR NEW."capabilities" IS DISTINCT FROM OLD."capabilities"
     OR NEW."evidenceFingerprint" IS DISTINCT FROM OLD."evidenceFingerprint"
     OR NEW."approvedByUserId" IS DISTINCT FROM OLD."approvedByUserId"
     OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'TaxDataReadinessApproval is immutable except revokedAt/revokedByUserId/revocationReason'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TaxDataReadinessApproval_immutable_except_revocation"
  BEFORE UPDATE ON "TaxDataReadinessApproval"
  FOR EACH ROW EXECUTE FUNCTION dopaycheck_tax_readiness_approval_immutable();
