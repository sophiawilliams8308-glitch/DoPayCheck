-- DoPayCheck — Phase 2 extension: structured rule detail tables
--
-- ADDITIVE AND IDEMPOTENT. Creates TaxBracket, WithholdingTable, WithholdingTableRow,
-- ReciprocityRule and LocalTaxRule; adds fields to Source and TaxRule; and renames
-- TaxYear.isCurrent to TaxYear.isDefault IN PLACE.
--
-- No table is dropped and no row is deleted. The only column change is a RENAME, so no
-- existing data is lost.
--
-- Every statement is guarded (IF NOT EXISTS / EXCEPTION WHEN duplicate_object) so the
-- migration is safe to re-apply over a partially applied state.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "PayFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'DAILY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Rename the supporting index alongside the column (guarded: no-op if already renamed).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'TaxYear_isCurrent_idx') THEN
    ALTER INDEX "TaxYear_isCurrent_idx" RENAME TO "TaxYear_isDefault_idx";
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Source" ADD COLUMN IF NOT EXISTS "jurisdictionId" TEXT,
ADD COLUMN IF NOT EXISTS "taxYearId" INTEGER,
ADD COLUMN IF NOT EXISTS "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "TaxRule" ADD COLUMN IF NOT EXISTS "subcategory" TEXT,
ADD COLUMN IF NOT EXISTS "valueType" "ValueType";

-- AlterTable
--
-- NON-DESTRUCTIVE RENAME (hand-edited).
--
-- Prisma generated "DROP COLUMN isCurrent, ADD COLUMN isDefault", which would discard every
-- existing flag value. RENAME COLUMN preserves them and keeps the partial unique index that
-- enforces "at most one default tax year" working unchanged.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'TaxYear' AND column_name = 'isCurrent'
  ) THEN
    ALTER TABLE "TaxYear" RENAME COLUMN "isCurrent" TO "isDefault";
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'TaxYear_single_current') THEN
    ALTER INDEX "TaxYear_single_current" RENAME TO "TaxYear_single_default";
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "TaxBracket" (
    "id" TEXT NOT NULL,
    "taxRuleId" TEXT NOT NULL,
    "filingStatus" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "lowerBound" DECIMAL(28,12),
    "upperBound" DECIMAL(28,12),
    "rate" DECIMAL(28,12),
    "baseTax" DECIMAL(28,12),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "sourceId" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxBracket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WithholdingTable" (
    "id" TEXT NOT NULL,
    "taxRuleId" TEXT NOT NULL,
    "tableCode" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "filingStatus" TEXT NOT NULL,
    "payFrequency" "PayFrequency" NOT NULL,
    "allowanceAmount" DECIMAL(28,12),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "sourceId" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WithholdingTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WithholdingTableRow" (
    "id" TEXT NOT NULL,
    "withholdingTableId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "wageFrom" DECIMAL(28,12),
    "wageTo" DECIMAL(28,12),
    "baseWithholding" DECIMAL(28,12),
    "percentage" DECIMAL(28,12),
    "adjustment" DECIMAL(28,12),
    "additionalWithholding" DECIMAL(28,12),
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WithholdingTableRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReciprocityRule" (
    "id" TEXT NOT NULL,
    "taxRuleId" TEXT NOT NULL,
    "fromJurisdictionId" TEXT NOT NULL,
    "toJurisdictionId" TEXT NOT NULL,
    "withholdingTreatment" TEXT NOT NULL,
    "requiredForm" TEXT,
    "conditions" JSONB,
    "exceptions" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReciprocityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LocalTaxRule" (
    "id" TEXT NOT NULL,
    "taxRuleId" TEXT NOT NULL,
    "localJurisdictionId" TEXT NOT NULL,
    "taxType" TEXT NOT NULL,
    "appliesToEmployee" BOOLEAN NOT NULL DEFAULT true,
    "appliesToEmployer" BOOLEAN NOT NULL DEFAULT false,
    "employeeRate" DECIMAL(28,12),
    "employerRate" DECIMAL(28,12),
    "wageBase" DECIMAL(28,12),
    "threshold" DECIMAL(28,12),
    "residentTreatment" TEXT,
    "nonResidentTreatment" TEXT,
    "conditions" JSONB,
    "exceptions" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalTaxRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TaxBracket_taxRuleId_idx" ON "TaxBracket"("taxRuleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TaxBracket_filingStatus_idx" ON "TaxBracket"("filingStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TaxBracket_verificationStatus_idx" ON "TaxBracket"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TaxBracket_taxRuleId_filingStatus_ordinal_key" ON "TaxBracket"("taxRuleId", "filingStatus", "ordinal");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WithholdingTable_taxRuleId_idx" ON "WithholdingTable"("taxRuleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WithholdingTable_payFrequency_idx" ON "WithholdingTable"("payFrequency");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WithholdingTable_verificationStatus_idx" ON "WithholdingTable"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WithholdingTable_taxRuleId_tableCode_filingStatus_payFreque_key" ON "WithholdingTable"("taxRuleId", "tableCode", "filingStatus", "payFrequency");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WithholdingTableRow_withholdingTableId_idx" ON "WithholdingTableRow"("withholdingTableId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WithholdingTableRow_withholdingTableId_ordinal_key" ON "WithholdingTableRow"("withholdingTableId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReciprocityRule_taxRuleId_key" ON "ReciprocityRule"("taxRuleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReciprocityRule_fromJurisdictionId_idx" ON "ReciprocityRule"("fromJurisdictionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReciprocityRule_toJurisdictionId_idx" ON "ReciprocityRule"("toJurisdictionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReciprocityRule_fromJurisdictionId_toJurisdictionId_taxRule_key" ON "ReciprocityRule"("fromJurisdictionId", "toJurisdictionId", "taxRuleId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LocalTaxRule_taxRuleId_key" ON "LocalTaxRule"("taxRuleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LocalTaxRule_localJurisdictionId_idx" ON "LocalTaxRule"("localJurisdictionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LocalTaxRule_taxType_idx" ON "LocalTaxRule"("taxType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Source_jurisdictionId_idx" ON "Source"("jurisdictionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Source_taxYearId_idx" ON "Source"("taxYearId");


-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Source" ADD CONSTRAINT "Source_jurisdictionId_fkey" FOREIGN KEY ("jurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Source" ADD CONSTRAINT "Source_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TaxBracket" ADD CONSTRAINT "TaxBracket_taxRuleId_fkey" FOREIGN KEY ("taxRuleId") REFERENCES "TaxRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TaxBracket" ADD CONSTRAINT "TaxBracket_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WithholdingTable" ADD CONSTRAINT "WithholdingTable_taxRuleId_fkey" FOREIGN KEY ("taxRuleId") REFERENCES "TaxRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WithholdingTable" ADD CONSTRAINT "WithholdingTable_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WithholdingTableRow" ADD CONSTRAINT "WithholdingTableRow_withholdingTableId_fkey" FOREIGN KEY ("withholdingTableId") REFERENCES "WithholdingTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ReciprocityRule" ADD CONSTRAINT "ReciprocityRule_taxRuleId_fkey" FOREIGN KEY ("taxRuleId") REFERENCES "TaxRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ReciprocityRule" ADD CONSTRAINT "ReciprocityRule_fromJurisdictionId_fkey" FOREIGN KEY ("fromJurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ReciprocityRule" ADD CONSTRAINT "ReciprocityRule_toJurisdictionId_fkey" FOREIGN KEY ("toJurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LocalTaxRule" ADD CONSTRAINT "LocalTaxRule_taxRuleId_fkey" FOREIGN KEY ("taxRuleId") REFERENCES "TaxRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LocalTaxRule" ADD CONSTRAINT "LocalTaxRule_localJurisdictionId_fkey" FOREIGN KEY ("localJurisdictionId") REFERENCES "Jurisdiction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

