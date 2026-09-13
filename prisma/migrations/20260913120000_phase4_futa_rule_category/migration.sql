-- DoPayCheck — Phase 4: dedicated FUTA rule category
--
-- ADDITIVE ONLY. Adds one member to the RuleCategory enum.
-- No existing row changes; no table, column, index or migration is altered.
--
-- WHY (spec §18.4, decision D-FUTA-1):
-- FUTA's structure — a gross rate reduced by a credit, over its own wage base —
-- has no analogue in FIT (rate schedules) or FICA (symmetric rate + base). It is
-- also the only federal tax whose effective rate depends on the state of
-- employment, a cross-cutting dimension that needs its own category to model
-- cleanly. Filing FUTA under SOCIAL_SECURITY, as Phase 3 did as a placeholder,
-- buries it for the administrators who perform the annual update.
--
-- Adding a Postgres enum member is additive and non-breaking.

-- AlterEnum
ALTER TYPE "RuleCategory" ADD VALUE IF NOT EXISTS 'FUTA';
