-- DoPayCheck — Phase 4: federal snapshot block
--
-- ADDITIVE ONLY. Adds one nullable JSONB column to CalculationSnapshot.
-- No existing table, column, index or migration is altered or removed, and no existing row
-- is rewritten: pre-Phase-4 snapshots keep NULL and stay exactly as they were.
--
-- WHY A COLUMN RATHER THAN REUSING `result`:
-- `result` holds the engine's OUTPUT. The federal block additionally embeds the RESOLVED RULE
-- DETAIL that produced that output (rates, wage bases, thresholds, schedule rows), so a
-- historical calculation can be replayed without reading the live rule tables (spec §40,
-- Phase 4 D-SNAP-1). That is different data with a different purpose, and the Phase 8 federal
-- audit screens query it directly.

-- AddColumn
ALTER TABLE "CalculationSnapshot" ADD COLUMN IF NOT EXISTS "federal" JSONB;
