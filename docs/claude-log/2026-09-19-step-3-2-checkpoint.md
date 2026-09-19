# Activity

Date: 2026-09-19
Phase: 5 — 50-State Engine
Step: 3.2 (Context Validation) + Amendment 3 (Explicit Capability Request Source)
Status: COMPLETE, committed and pushed

## Objective

Implement structural validation for `StateRuleResolutionContext` (Step 3.2), then replace the
placeholder empty `capabilitiesRequested` set in `projectResolutionContext()` with an explicit,
caller-supplied argument (Amendment 3), per contract text pasted directly into the session
(no committed specification file exists for Phase 5 Step 3 — see CLAUDE.md §10).

## What Was Done

- Added `validateResolutionContext()` to `lib/tax/state/resolutionContext.ts`: checks taxYear
  plausibility, calculationDate format/year-consistency, jurisdiction non-blank (structural
  only — Amendment 2), and capability non-empty/membership. Returns `INVALID_CONTEXT` issues;
  never throws. Zero database/provider access (proven architecturally: synchronous, no DB
  import).
- Amendment 3: changed `projectResolutionContext(calcContext)` to
  `projectResolutionContext(calcContext, capabilitiesRequested: ReadonlySet<CapabilityCode>)`.
  The set is now defensively copied from the caller, never derived, never defaulted.
- Updated the two other tests/call sites that depended on the old 1-argument signature and the
  old "always empty" behavior it implied.
- Added negative-control scanner tests (in `tests/unit/state-guards.test.ts`) proving: no
  capability→rule-key mapping exists, no required-key list is built, `capabilitiesRequested` is
  read from neither `StateCalculationContext` nor `CalculationInput`, and there is no internal
  fallback/default empty-set production path.

## Files Changed

- `lib/tax/state/resolutionContext.ts` (modified)
- `tests/unit/state-resolution-context.test.ts` (modified — Step 3.1's own test file, caller
  updates + rewritten capability tests)
- `tests/unit/state-guards.test.ts` (modified — new Amendment 3 guard tests)
- `tests/unit/state-resolution-context-validation.test.ts` (new — Step 3.2's own test file, 36+
  tests)

## Tests / Verification

- Focused (3 files): 118/118 passed
- All Phase 5 state suites (9 files): 226/226 passed
- Full suite (`npm test`): 720 passed, 81 skipped (DB integration), 0 failed
- `npx tsc --noEmit`, `npm run lint`, `npm run format:check`, `npm run build`,
  `npx prisma validate`: all clean

## Decisions

- Amendment 2 (structural-only jurisdiction validation) and Amendment 3 (explicit capability
  source) — see CLAUDE.md §9 for the durable summary. Full rationale lives in this log entry
  and the session transcript only; not duplicated elsewhere.

## Blockers

- F-02 (capability → rule-key mapping) remains untouched and blocking — see CLAUDE.md §8.

## Git

- Commit: `8f7952a` — `feat(state): implement explicit capability request source`
- Branch: `claude/upbeat-dirac-qqhuye`
- Pushed: yes

## Next Action

Step 3.3 (Coverage Gate) — see `2026-09-19-step-3-3-blocked.md`.
