-- DoPayCheck — Phase 3: calculation snapshot
--
-- ADDITIVE ONLY. Creates the CalculationSnapshot table and its indexes.
-- No existing table, column, index or migration is altered or removed.
--
-- Snapshots exist so a historical calculation stays reproducible after the underlying tax
-- rules change (spec §40): the input, normalized input, result, rule versions, source IDs and
-- engine version are all preserved together.

-- CreateTable
CREATE TABLE "CalculationSnapshot" (
    "id" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "federalCode" TEXT NOT NULL,
    "stateCode" TEXT,
    "localCodes" TEXT[],
    "status" TEXT NOT NULL,
    "originalInput" JSONB NOT NULL,
    "normalizedInput" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "ruleReferences" JSONB NOT NULL,
    "sourceIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalculationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalculationSnapshot_taxYear_idx" ON "CalculationSnapshot"("taxYear");

-- CreateIndex
CREATE INDEX "CalculationSnapshot_status_idx" ON "CalculationSnapshot"("status");

-- CreateIndex
CREATE INDEX "CalculationSnapshot_createdAt_idx" ON "CalculationSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "CalculationSnapshot_engineVersion_idx" ON "CalculationSnapshot"("engineVersion");

