# SESSION 2 — Test Harness Completion + Structured Warning Model

> **Scope:** test-harness glob fix + introducing a structured `ScheduleWarning` model and
> migrating the verification → scenario-repair boundary to it. No Solver/scheduling/
> ranking/reconcile/UI/schema/persistence behavior was intentionally changed.
> **Branch:** `arena/019ffafd-nursingsmart` (from `main` @ `8a0f4a1`, i.e. after Session 1 PR #93).

---

## A. Files changed

| File | Change |
|---|---|
| `package.json` | `test` script: `tsx --test "tests/**/*.test.ts"` (was `tests/*.test.ts`, top-level only). No test added/removed by hand. |
| `domain/warnings/schedule-warning.ts` | **NEW** — the structured Warning model (codes, severity, factory, critical classification, `structured → message` helpers). |
| `domain/index.ts` | Barrel re-export of the new warnings module (additive). |
| `lib/solver.ts` | All 22 warning production sites emit `ScheduleWarning` via `createScheduleWarning` (identical Persian display strings). `verifyCoverageAndLeaders()` returns `{ warnings, structuredWarnings, shiftLeaders }` (additive field; string output unchanged, parallel 1:1). The mid-solve "stale coverage" filter now matches by **code** instead of `startsWith('Coverage Shortage:')`. |
| `lib/scoring.ts` | `isHardConstraintWarning` widened to `string \| ScheduleWarning` (string path = legacy prefix check, unchanged; structured path = code check). New `filterStructuredWarningsForScenarioGroup` bridge (same legacy predicate applied to `warning.message`). |
| `domain/scenarios/objective.ts` | `BaselineObjectiveInput` gains optional `structuredWarnings`; when present, critical counting is code-based (string path retained for callers that only have strings). No policy change. |
| `lib/scenarioGenerator.ts` | Internal pipeline carries `VerifiedSchedule` (=`MonthlySchedule` + `structuredWarnings`; stripped before reaching `ScoredSchedule`/persistence). `generateCriticalRepairEdits` consumes `warning.code/day/shift/personnelId/endDay` instead of regexing Persian text (exported for tests, along with `CriticalRepairContext`/`CriticalRepairEdit`). `repairCriticalAlerts` counts criticals by code. `PERIOD_SHIFT_CODE` and `findPersonnelByFullName` (orphaned by the migration) removed. |
| `tests/domain/structured-warnings.test.ts` | **NEW** — 23 focused tests (model, producer metadata, classification parity & text-independence, repair consumption, filter bridge parity, objective path). |
| `tests/concurrency-scenarios.test.ts` | Stabilized a **pre-existing flaky test** (jitter pinned via the supported `random` injection; assertion & exercised code path unchanged). See section I. |

`node_modules`, generated files, scratch scripts: none committed. The A/B harness used for
behavior comparison lived in `/tmp` and was never in the repository.

---

## B. Test count before/after

| Command | Files | Tests |
|---|---|---|
| **Before** `npm test` (`tests/*.test.ts`) | 19 (top-level only) | **225** |
| `tests/domain/*.test.ts` (excluded from `npm test`) | 10 | 174 |
| **After** `npm test` (`"tests/**/*.test.ts"`) | 30 (top-level + nested, incl. the new file) | **422** (399 pre-existing + 23 new) |

## C. Exact `npm test` result

```
# tests 422
# pass 422
# fail 0
```

25 consecutive full-suite runs: 25× green (after the flake stabilization in section I).
`npx tsc --noEmit` is clean for every changed file (the only reported errors are the
pre-existing Prisma-client environment issue documented in Session 1:
`binaries.prisma.sh` is unreachable from this sandbox, so `prisma generate` cannot run;
`lib/db/client.ts` / `prisma/seed.ts` fail type-check for that reason on `main` as well).
`eslint` is clean on all changed files.

## D. Warning producers/consumers map (verified against the code)

### Producers

| # | Site | Warning text | Structured metadata now attached |
|---|---|---|---|
| P1 | `solveNursingSchedule` emergency fill (lib/solver.ts) | `Coverage Shortage: کمبود نیرو (…) در روز D شیفت X` | `code, day, shift, jobGroup, metadata.remainingShortage` — *(pre-existing note: these are dropped at the final combine as "stale"; the verifier re-derives coverage truth after reconcile)* |
| P2 | `solveNursingSchedule` isolated-shift repair | `Isolated Shift Fixed: …` | `code, day, shift, personnelId, metadata.movedToPersonnelId` |
| P3 | `solveNursingSchedule` OFF post-process (×4 sites) | `OFF Removed: …` | `code, day, shift, personnelId, metadata.reason` |
| P4 | `solveNursingSchedule` leader selection (×3) | `Missing Shift Leader: …` | `code, day, shift('M'/'E'/'N'), jobGroup, metadata.period/isHoliday` |
| P5 | `verifyCoverageAndLeaders` coverage (×12 sites) | `Coverage Shortage:` / `Overstaffing: …` | `code, day, shift, jobGroup, metadata.assigned/demanded/delta` |
| P6 | `verifyCoverageAndLeaders` leaders (×3) | `Missing Shift Leader: …` | same as P4 |
| P7 | `verifyCoverageAndLeaders` request checks (×4) | `Mismatched Request: …` | `code, day, personnelId, metadata.requestType/requestedShift/assignedShift` |
| P8 | `verifyCoverageAndLeaders` | `Consecutive OFFs: …` | `code, personnelId, day(start), endDay, metadata.length` |
| P9 | `verifyCoverageAndLeaders` | `Leave Continuity: …` | `code, day, personnelId, metadata.current/previous/nextShift` |
| P10 | `verifyCoverageAndLeaders` | `Max Consecutive: …` | `code, personnelId, day(start), endDay, metadata.length/startPeriod/endPeriod` |
| P11 | `verifyCoverageAndLeaders` | `Mandatory Rest: …` | `code, personnelId` (no day — same as legacy text) |
| P12 | `verifyCoverageAndLeaders` | `Isolated Shift: …` | `code, day, shift, personnelId` |
| P13 | `solveWithPriority` (lib/solver.ts:432) | `کمبود نیرو (…) در روز D شیفت X - N نفر باقی ماند` | **legacy, unprefixed, left as string** — see section G |

### Producer → Warning structure → Consumer

```
solveNursingSchedule (P1–P4, structured) ──code-filter──► + verify.warnings (strings)
        └► MonthlySchedule.warnings: string[]  ──► persistence (storageSchemas: warnings: string[]) — UNCHANGED
                                                  ──► UI display & dismissal keys (string identity) — UNCHANGED

verifyCoverageAndLeaders (P5–P12, structured) ──► { warnings: string[], structuredWarnings, shiftLeaders }
        ├─► scenarioGenerator.verifyScenarioSchedule ──► filterStructuredWarningsForScenarioGroup
        │        (legacy predicate on .message — bridge) ──► VerifiedSchedule{ warnings(string[]), structuredWarnings }
        │        ├─► generateCriticalRepairEdits ── uses code/day/shift/personnelId/endDay (NO regex)   ← migrated
        │        ├─► repairCriticalAlerts critical counting ── countCriticalScheduleWarnings (codes)    ← migrated
        │        ├─► evaluateBaselineObjective(..., structuredWarnings) ── code-based critical count    ← migrated (optional input)
        │        └─► ScoredSchedule.schedule = plain MonthlySchedule (structured view stripped)         ← persisted shape unchanged
        ├─► app/page.tsx / shift-write-facade / useScheduleState ── .warnings, .shiftLeaders (unchanged consumers)
        └─► UI (AlertCenter, ScenarioWarningsModal) ── strings, unchanged
```

### Every place that currently depends on parsing warning strings (status)

| Site | Parses what | Status in Session 2 |
|---|---|---|
| `lib/scenarioGenerator.ts` `generateCriticalRepairEdits` | `/روز (\d+)/`, `/شیفت ([A-Z]+)/`, `/نوبت (صبح)/`, `/از روز …/تا روز …/`, full-name search | **REMOVED** — consumes structured fields |
| `lib/solver.ts` stale-coverage combine filter | `startsWith('Coverage Shortage:' / 'Overstaffing:')` | **REMOVED** — code-based filter |
| `lib/scenarioGenerator.ts` `repairCriticalAlerts` loop counts | prefix-based `countCriticalWarnings` | **REMOVED** — code-based counting |
| `domain/scenarios/objective.ts` `evaluateBaselineObjective` | prefix-based critical count | **migrated** when `structuredWarnings` provided (legacy string path kept for string-only callers) |
| `lib/scoring.ts` `isHardConstraintWarning` | `HARD_WARNING_PREFIXES` | legacy fn preserved; accepts structured input via code now; string callers unchanged |
| `lib/scoring.ts` `warningTargetsGroup` / `warningTargetsLockedPersonnel` | Persian labels (`بهیار/پرستار/سرشیفت`), full-name search | **REMAINING** (legacy bridge; used via `filterStructuredWarningsForScenarioGroup` on `.message`) |
| `app/page.tsx` `extractWarningDay` | `/روز (\d+)/` for calendar navigation | **REMAINING** (UI path; UI behavior change is out of scope) |
| `lib/alertAggregator.ts` `aggregateWarnings`, `categorizeRemainingWarnings` | full-name search, `includes('کمبود نیرو')`, `/(\w+\s+\w+)/` | **REMAINING** (UI presentation; requires warning → UI plumbing, out of scope) |
| `lib/smartSuggestion.ts` | full-name search | **REMAINING** (legacy helper; shallow consumer) |
| `domain/scheduling/alert-lifecycle.ts` (dismissal) | warning text as identity key | **REMAINING intentionally** — persistence identity is defined as the message text; schema change is out of scope |
| `ScenarioWarningsModal` (UI badge) | `isHardConstraintWarning(string)` | **REMAINING** (display only) |

## E. Structured Warning model introduced

`domain/warnings/schedule-warning.ts` (pure, zero React/Next/I/O; re-exported from `domain/index.ts`):

```ts
interface ScheduleWarning {
  code: ScheduleWarningCode;          // COVERAGE_SHORTAGE | OVERSTAFFING | MISSING_SHIFT_LEADER
                                      // | MAX_CONSECUTIVE | MANDATORY_REST | MISMATCHED_REQUEST
                                      // | CONSECUTIVE_OFFS | LEAVE_CONTINUITY | ISOLATED_SHIFT
                                      // | ISOLATED_SHIFT_FIXED | OFF_REMOVED   (1:1 with legacy prefixes)
  severity: 'critical' | 'warning' | 'info';  // derived from code; 'critical' = exactly the legacy HARD set
  message: string;                    // existing Persian display text — presentation data
  day?: number; endDay?: number;      // day / range
  shift?: ShiftType; personnelId?: string; jobGroup?: JobGroup;
  metadata?: Record<string, string | number | boolean>;
}
```

Canonical direction: `ScheduleWarning` → `message` (via `warningMessages`). Never the reverse.
Critical set: `CRITICAL_WARNING_CODES` = the same five types as `HARD_WARNING_PREFIXES`
(policy unchanged; representation changed). Classification helpers:
`isCriticalWarningCode`, `is-critical/get/count/has*ScheduleWarning`.

Migrated boundary (smallest coherent): **verifier → scenario engine → repair/classification**,
plus the solver-internal stale-coverage filter. `MonthlySchedule.warnings: string[]` (persisted
schema, storageSchemas.ts:166) is untouched.

## F. Legacy string-parsing paths removed

1. `generateCriticalRepairEdits` — all five regexes + the full-name search; now switches on
   `warning.code` and reads `day`/`shift`/`personnelId`/`endDay`. Parity quirk preserved and
   documented in code: holiday-morning `Missing Shift Leader` produced no edit before (the
   old `روز (\d+)` regex never matched `روز تعطیل D`) and still produces none.
2. `repairCriticalAlerts` critical counting — `countCriticalScheduleWarnings` (codes).
3. `solveNursingSchedule` stale-coverage filter — `warning.code`-based.
4. `evaluateBaselineObjective` — code-based critical count when structured warnings are passed
   (the production path passes them).
5. `verifyScenarioSchedule` — keeps metadata through filtering instead of re-deriving strings.

## G. Legacy paths still remaining (explicitly documented, not silently guessed)

1. **Stored/persisted warnings are strings** (`MonthlySchedule.warnings`). Dismissal identity is
   the message text. Schema/persistence change is a Session-2 non-goal → machine consumers of
   *stored* warnings still see strings.
2. **`filterWarningsForScenarioGroup` predicate internals** still read Persian labels/names —
   preserved 1:1 as the group-attribution bridge; moving it to `jobGroup`/`personnelId` would
   change which warnings survive in corner cases (e.g. warnings mentioning two names) and is
   deferred to a dedicated migration.
3. **`solveWithPriority` line-432 warning** is an unprefixed coverage-shortage string; left as a
   legacy string (its classification surface is string-based today; tagging it critical by code
   would *change* classification of `OptimizationResult.warnings` — a policy change, not allowed).
4. **UI paths** (`AlertCenter`, `ScenarioWarningsModal`, `extractWarningDay`,
   `alertAggregator`, `smartSuggestion`) still parse strings; they only receive the persisted
   `warnings: string[]`. Migrating them requires extending the UI boundary — out of scope.
5. `lib/scoring.ts` `calculateOptimizationScore` counts hard warnings from strings (legacy
   weighted Objective used only for re-hydration of old stored scenarios) — untouched (B10).

## H. Solver/scheduling behavior — not intentionally changed

Evidence:

1. **A/B byte-level equivalence:** a standalone harness hashed the *entire observable output*
   of `solveNursingSchedule`, `solveWithPriority`, `verifyCoverageAndLeaders`
   (warnings+leaders) and `generateAndScoreScenarios` (all/top3, logs, scores, assignments)
   for the feasible/near-infeasible/infeasible presets and the realistic fixture with requests
   and locked rows, on `main` vs this branch: **all 10 SHA-256 digests identical**
   (only volatile `durationMs` excluded).
2. The 26 Session-1 `[CURRENT-BEHAVIOR]` characterization tests pass unchanged (including the
   ones pinning exact warning strings and the 31-per-day-shortage infeasible case).
3. No algorithm, comparator, weight, ranking, reconcile, lock, or UI code path was edited;
   the repair loop's cell-selection logic is line-for-line identical, only its inputs changed
   from regex-captured text to structured fields.

## I. Newly discovered issues (documented; fixed only where strictly required by the session goal)

1. **Pre-existing flaky test** — `tests/concurrency-scenarios.test.ts` "قفل شدن دیتابیس زیر بار…"
   used default full-jitter backoff (`random() * exponential`), so all 4 retries can complete in
   <15 ms, *before* the test's own 15 ms unlock timer fires → intermittent `database is locked`
   failure (observed ~2/15 full-suite runs; reproducible on the unmodified suite as well).
   **Fixed (test-only, required for a reliably-green npm test, which is this session's first
   deliverable):** pinned jitter via the supported `random: () => 0.99` injection → delays are
   10/20/40 ms wall-clock, the unlock always lands first. Assertion and exercised production
   path (`withDbRetry` with real sleeps) unchanged; no test weakened or deleted.
2. **`isHardConstraintWarning` never sees the `solveWithPriority` shortage warning** (no
   legacy prefix) — recorded for Session 3+; representation only noted in section G.3.
3. **B11 holiday-morning leader gap** — the old regex could not extract a day from
   `روز تعطیل D` and silently skipped those repairs; preserved verbatim this session (parity
   test added), to be decided in a repair-policy session.
4. Remaining string-parsing consumers listed in section G (UI/scoring-legacy) — deferred
   deliberately, no behavior risk this session.

---

### Validation checklist

- [x] `npm test` runs top-level **and** `tests/domain/**` (glob `tests/**/*.test.ts`) — 422 tests.
- [x] All tests pass (25/25 consecutive green runs after flake stabilization).
- [x] `git diff` reviewed — no Solver algorithm/reconcile/UI/schema/Objective/weight changes.
- [x] `git status` — only the files in section A; no node_modules/generated/scratch files.
- [x] No product behavior intentionally changed (A/B digest proof + characterization suite).
