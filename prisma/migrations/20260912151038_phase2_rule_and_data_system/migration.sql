-- CreateEnum
CREATE TYPE "JurisdictionType" AS ENUM ('FEDERAL', 'STATE', 'COUNTY', 'CITY', 'LOCALITY', 'SCHOOL_DISTRICT', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxYearStatus" AS ENUM ('DRAFT', 'PREPARATION', 'ACTIVE', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RuleCategory" AS ENUM ('FEDERAL_INCOME_TAX', 'FEDERAL_WITHHOLDING', 'SOCIAL_SECURITY', 'MEDICARE', 'STATE_INCOME_TAX', 'STATE_WITHHOLDING', 'DISABILITY_SDI', 'PAID_LEAVE', 'SUTA', 'MINIMUM_WAGE', 'OVERTIME', 'RECIPROCITY', 'LOCAL_TAX');

-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'REJECTED', 'ROLLED_BACK', 'BLOCKED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED', 'NOT_APPLICABLE', 'PENDING', 'CONFLICT', 'PARTIALLY_VERIFIED', 'NOT_STATED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('STATUTE', 'REGULATION', 'PUBLICATION', 'FORM', 'INSTRUCTIONS', 'BULLETIN', 'NOTICE', 'WEBPAGE', 'DATASET', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ConflictStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'ACCEPTED_AMBIGUITY', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'EDIT', 'DUPLICATE', 'APPROVE', 'REJECT', 'PUBLISH', 'ROLLBACK', 'ARCHIVE', 'RESTORE', 'DELETE', 'RESET', 'IMPORT', 'EXPORT');

-- CreateEnum
CREATE TYPE "ValueType" AS ENUM ('RATE', 'PERCENT', 'MONEY', 'MULTIPLIER', 'COUNT', 'DURATION_DAYS', 'BOOLEAN', 'TEXT');

-- CreateTable
CREATE TABLE "Jurisdiction" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "JurisdictionType" NOT NULL,
    "parentId" TEXT,
    "stateCode" TEXT,
    "fipsCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Jurisdiction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxYear" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "TaxYearStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "url" TEXT,
    "publicationDate" TIMESTAMP(3),
    "effectiveDate" TIMESTAMP(3),
    "documentVersion" TEXT,
    "notes" TEXT,
    "status" "SourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRule" (
    "id" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "taxYearId" INTEGER NOT NULL,
    "jurisdictionId" TEXT NOT NULL,
    "category" "RuleCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "applicability" JSONB,
    "conditions" JSONB,
    "exceptions" JSONB,
    "payload" JSONB,
    "payloadSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" "RuleStatus" NOT NULL DEFAULT 'DRAFT',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "supersedesId" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRuleValue" (
    "id" TEXT NOT NULL,
    "taxRuleId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueType" "ValueType" NOT NULL,
    "groupKey" TEXT NOT NULL DEFAULT '',
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "numericValue" DECIMAL(28,12),
    "textValue" TEXT,
    "unit" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRuleValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRuleSource" (
    "id" TEXT NOT NULL,
    "taxRuleId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "page" TEXT,
    "section" TEXT,
    "subsection" TEXT,
    "table" TEXT,
    "heading" TEXT,
    "citation" TEXT,
    "excerpt" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRuleSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleConflict" (
    "id" TEXT NOT NULL,
    "taxRuleId" TEXT NOT NULL,
    "sourceAId" TEXT,
    "sourceBId" TEXT,
    "description" TEXT NOT NULL,
    "status" "ConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionNotes" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuleConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Jurisdiction_code_key" ON "Jurisdiction"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Jurisdiction_slug_key" ON "Jurisdiction"("slug");

-- CreateIndex
CREATE INDEX "Jurisdiction_type_idx" ON "Jurisdiction"("type");

-- CreateIndex
CREATE INDEX "Jurisdiction_parentId_idx" ON "Jurisdiction"("parentId");

-- CreateIndex
CREATE INDEX "Jurisdiction_stateCode_idx" ON "Jurisdiction"("stateCode");

-- CreateIndex
CREATE INDEX "Jurisdiction_isActive_idx" ON "Jurisdiction"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TaxYear_year_key" ON "TaxYear"("year");

-- CreateIndex
CREATE INDEX "TaxYear_status_idx" ON "TaxYear"("status");

-- CreateIndex
CREATE INDEX "TaxYear_isCurrent_idx" ON "TaxYear"("isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "Source_code_key" ON "Source"("code");

-- CreateIndex
CREATE INDEX "Source_organization_idx" ON "Source"("organization");

-- CreateIndex
CREATE INDEX "Source_sourceType_idx" ON "Source"("sourceType");

-- CreateIndex
CREATE INDEX "Source_status_idx" ON "Source"("status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRule_supersedesId_key" ON "TaxRule"("supersedesId");

-- CreateIndex
CREATE INDEX "TaxRule_taxYearId_idx" ON "TaxRule"("taxYearId");

-- CreateIndex
CREATE INDEX "TaxRule_jurisdictionId_idx" ON "TaxRule"("jurisdictionId");

-- CreateIndex
CREATE INDEX "TaxRule_category_idx" ON "TaxRule"("category");

-- CreateIndex
CREATE INDEX "TaxRule_status_idx" ON "TaxRule"("status");

-- CreateIndex
CREATE INDEX "TaxRule_ruleKey_idx" ON "TaxRule"("ruleKey");

-- CreateIndex
CREATE INDEX "TaxRule_effectiveFrom_effectiveTo_idx" ON "TaxRule"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "TaxRule_jurisdictionId_category_status_idx" ON "TaxRule"("jurisdictionId", "category", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRule_ruleKey_version_key" ON "TaxRule"("ruleKey", "version");

-- CreateIndex
CREATE INDEX "TaxRuleValue_taxRuleId_idx" ON "TaxRuleValue"("taxRuleId");

-- CreateIndex
CREATE INDEX "TaxRuleValue_key_idx" ON "TaxRuleValue"("key");

-- CreateIndex
CREATE INDEX "TaxRuleValue_verificationStatus_idx" ON "TaxRuleValue"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "TaxRuleValue_taxRuleId_groupKey_ordinal_key_key" ON "TaxRuleValue"("taxRuleId", "groupKey", "ordinal", "key");

-- CreateIndex
CREATE INDEX "TaxRuleSource_taxRuleId_idx" ON "TaxRuleSource"("taxRuleId");

-- CreateIndex
CREATE INDEX "TaxRuleSource_sourceId_idx" ON "TaxRuleSource"("sourceId");

-- CreateIndex
CREATE INDEX "TaxRuleSource_verificationStatus_idx" ON "TaxRuleSource"("verificationStatus");

-- CreateIndex
CREATE INDEX "RuleConflict_taxRuleId_idx" ON "RuleConflict"("taxRuleId");

-- CreateIndex
CREATE INDEX "RuleConflict_status_idx" ON "RuleConflict"("status");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Jurisdiction" ADD CONSTRAINT "Jurisdiction_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRule" ADD CONSTRAINT "TaxRule_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "TaxRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRuleValue" ADD CONSTRAINT "TaxRuleValue_taxRuleId_fkey" FOREIGN KEY ("taxRuleId") REFERENCES "TaxRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRuleSource" ADD CONSTRAINT "TaxRuleSource_taxRuleId_fkey" FOREIGN KEY ("taxRuleId") REFERENCES "TaxRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRuleSource" ADD CONSTRAINT "TaxRuleSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleConflict" ADD CONSTRAINT "RuleConflict_taxRuleId_fkey" FOREIGN KEY ("taxRuleId") REFERENCES "TaxRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleConflict" ADD CONSTRAINT "RuleConflict_sourceAId_fkey" FOREIGN KEY ("sourceAId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleConflict" ADD CONSTRAINT "RuleConflict_sourceBId_fkey" FOREIGN KEY ("sourceBId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- PHASE 2 — DATA INTEGRITY BEYOND THE PRISMA SCHEMA
--
-- Prisma cannot express CHECK constraints, partial unique indexes or exclusion
-- constraints. They are added here so the guarantees live in the DATABASE and hold
-- even if a future caller bypasses the ORM.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Date sanity: an end date, when present, must follow its start date.
-- ---------------------------------------------------------------------------
ALTER TABLE "TaxRule"
  ADD CONSTRAINT "TaxRule_effective_range_valid"
  CHECK ("effectiveTo" IS NULL OR "effectiveFrom" < "effectiveTo");

ALTER TABLE "TaxYear"
  ADD CONSTRAINT "TaxYear_period_valid"
  CHECK ("startDate" < "endDate");

ALTER TABLE "Jurisdiction"
  ADD CONSTRAINT "Jurisdiction_effective_range_valid"
  CHECK ("effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveFrom" < "effectiveTo");

-- ---------------------------------------------------------------------------
-- Version numbers start at 1.
-- ---------------------------------------------------------------------------
ALTER TABLE "TaxRule"
  ADD CONSTRAINT "TaxRule_version_positive" CHECK ("version" >= 1);

-- ---------------------------------------------------------------------------
-- A jurisdiction may not be its own parent.
-- ---------------------------------------------------------------------------
ALTER TABLE "Jurisdiction"
  ADD CONSTRAINT "Jurisdiction_not_self_parent"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- ---------------------------------------------------------------------------
-- At most ONE tax year may be flagged current.
-- A partial unique index expresses "only among rows where isCurrent is true".
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "TaxYear_single_current"
  ON "TaxYear" ("isCurrent") WHERE "isCurrent";

-- ---------------------------------------------------------------------------
-- NO OVERLAPPING ACTIVE VERSIONS OF THE SAME CONCEPTUAL RULE
--
-- This is the core Phase 2 correctness guarantee. Two ACTIVE versions of the same
-- `ruleKey` must never cover the same instant, or rule resolution would be ambiguous
-- and a paycheck calculation could silently pick the wrong law.
--
-- Adjacent ranges ARE allowed, which is the required behaviour:
--     Rule A  2026-01-01 -> 2026-07-01   (exclusive upper bound)
--     Rule B  2026-07-01 -> 2027-01-01
-- coexist, because '[)' bounds make them touch without overlapping.
--
-- Implemented as an exclusion constraint rather than application logic so the
-- guarantee cannot be bypassed. Requires btree_gist for the equality operator on the
-- scalar `ruleKey` column alongside the range overlap operator.
--
-- Scoped by WHERE status = 'ACTIVE': drafts, superseded and rejected versions may
-- freely overlap — only what is in force is constrained.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "TaxRule"
  ADD CONSTRAINT "TaxRule_no_overlapping_active_versions"
  EXCLUDE USING gist (
    "ruleKey" WITH =,
    tsrange("effectiveFrom", "effectiveTo", '[)') WITH &&
  ) WHERE ("status" = 'ACTIVE');

-- ---------------------------------------------------------------------------
-- AUDIT LOG IMMUTABILITY (spec §31: audit logs must never be deleted)
--
-- Enforced in the database with a trigger so no application path — ORM, raw SQL or
-- psql session — can rewrite or erase history.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dopaycheck_audit_log_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_no_update"
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION dopaycheck_audit_log_is_append_only();

CREATE TRIGGER "AuditLog_no_delete"
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION dopaycheck_audit_log_is_append_only();
