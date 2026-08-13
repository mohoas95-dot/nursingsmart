# SESSION 1 — Solver Baseline, Safety & Regression Audit

> **Scope:** Repository inspection + test environment + characterization baseline (no product changes).
> **Branch:** `arena/019ff9e5-nursingsmart`
> **Rule applied:** the real code is the source of truth; every claim below is traced to code, or marked as an assumption.

---

## 1. CURRENT EXECUTION FLOW

### 1.1 The real call graph (UI → schedule production → persistence)

```
UI button "بازتولید هوشمند" (app/page.tsx:6319 / 6328)
  └─ handleRunOptimizer(jobGroup)                      (app/page.tsx:3235)
       ├─ protectedCellsRef.clear()
       ├─ (guards: isLoadingDb / storageWriteBlocked / calendar loading)
       └─ generateAndScoreScenariosWithProgress(...)    (lib/scenarioGenerator.ts)
            └─ runBaselineOrientedEngine(...)
                 ├─ buildBaselineSchedule(currentAssignments)   ← Working Roster = مبنا
                 ├─ for seed 1..budget(36):
                 │    buildDiversityCandidate (row-swap) | buildRequestBiasedCandidate
                 │    → repairCriticalAlerts (regex → cell edits) → scoreCandidate
                 ├─ applyQualityFilter (drop level-A / distance>35% / identical<3%)
                 ├─ selectTopScenarios (compareByObjective: similarity ↓ → warnings ↓ → requests ↓)
                 └─ top3
       └─ persistScenarioWorkflow(...)  →  stored under dept.activeScenarios[monthKey]

Scenario "اعمال" (apply):
  handleApplyScenario(selectedScenario)                  (app/page.tsx)
    └─ mockSolver = () => solveWithPriority(...)  ← ONLY used to compute warnings; its
         assignments are discarded (selectedScenario.schedule.assignments is used)
    └─ runOptimizerFacade(...)                           (features/scheduling/facades/shift-write-facade.ts)
         ├─ mergeOptimizerAssignments(current, optimized, personnel, jobGroup, lockedRows)
         ├─ reconcileStaffingCoverage(merged, ..., [jobGroup], lockedRows, requests)   ← re-fix counts
         ├─ verifyCoverageAndLeaders(...)
         └─ persistence.saveSchedule(newSchedule, deptId)  (finalizedNurses/Assistants=true)

Initial load / month with no stored schedule:
  syncLocalStateFromDb / loadDatabase (app/page.tsx)
    └─ solveNursingSchedule(year, month, personnel, requests, settings, ...)   ← THE real producer

Manual cell edit:
  handleManualShiftChange → applyManualShiftChangeFacade(...)
    ├─ updateScheduleCell
    ├─ reconcileStaffingCoverage (up to 3 passes, protectedCells honored)
    └─ verifyCoverageAndLeaders → save

Settings/calendar/personnel save:
  saveState(..., { mode: 'full_resolve' | 'refresh_personnel' | 'refresh_group' | 'preserve_current' })
    └─ (full_resolve) solveNursingSchedule(...) → merge (respect finalized/locked) → verify → save

Continuous auto-pilot (runs AFTER everything above, on every schedule change):
  useEffect in app/page.tsx (~line 2390, "پایش پیوسته")
    ├─ reconcileStaffingCoverage (['nurse','assistant'], up to 3 passes, protectedCells)
    ├─ verifyCoverageAndLeaders
    └─ saveDbState
```

### 1.2 Which function does what

| Function | Role | Mutates assignments? |
|---|---|---|
| `solveNursingSchedule` (lib/solver.ts) | **The actual schedule producer** (greedy day-by-day + post-process + reconcile + verify) | yes (builds them) |
| `solveWithPriority` (lib/solver.ts) | Priority pass on top of `solveNursingSchedule`. **In production its `assignments` are discarded** (only used in `mockSolver` to compute warnings). | yes (internal, unused output) |
| `verifyCoverageAndLeaders` (lib/solver.ts) | **Warnings + shift leaders only** | no (verified read-only) |
| `reconcileStaffingCoverage` (domain/scheduling/staffing-coverage.ts) | **Post-solver coverage fixer** (adds/removes M/E/N components) | **yes** |
| `generateAndScoreScenarios` (lib/scenarioGenerator.ts) | Candidate scenario producer (baseline row-swaps + reconcile), NOT a fresh solve | yes (candidates) |
| `evaluateBaselineObjective` + `compareByObjective` (domain/scenarios/objective.ts) | **The production Objective** (similarity-first ranking) | no |
| `evaluateScenarioSchedule` / `SCENARIO_WEIGHTS` / `weightedTotal` (lib/scoring.ts) | Legacy weighted Objective — consumed only when re-hydrating old stored scenarios that lack `metrics` (app/page.tsx `hydrateStoredScenario`) | no |

### 1.3 Dead / legacy code (verified)

| Code | Status | Evidence |
|---|---|---|
| `lib/balanceChecker.ts` — `applyDefaultOffRule`, `findBestSubstitute`, `checkAndApplyAutoSubstitution` | **dead** (imported in app/page.tsx, never called) | `grep -rn` shows no call sites anywhere |
| `lib/scoring-stub.ts` | dead stub | only file content is an unused interface |
| `evaluateSchedule` (lib/scoring.ts) | legacy | only called from `scripts/test_scoring.ts` |
| `lib/smartSuggestion.ts` | live but shallow | single caller app/page.tsx:2486; suggests only "shift one step lighter" |
| `scripts/test_scoring.ts` | scratch script (not part of npm test) | — |

---

## 2. ACTUAL DECISION HIERARCHY

### 2.1 Inside `solveNursingSchedule` (the producer)

1. **Leave** → assigned first (`L1..Ln`, holiday→`LH`). Effectively the strongest input.
2. **Pattern** (`patternSteps`) spread over the month (never over leave).
3. **Explicit OFF / shift requests** → written verbatim onto cells (shift request **bypasses all hard rules** — see bugs). On conflicting same-day requests, `isEssential` wins.
4. **Supervisor / Staff** → default `M` on working days, `OFF` on holidays (unless explicit request/avoid-M).
5. **Greedy day-by-day fill** of demand: assistants first (M→E→N), then nurses (M→E→N). Candidate selection order (the *de facto* objective):
   1. numeric "penalty" comparator (magic numbers 200000/100000/50000/40000/25000/20000, routine match −25000/−10000/+30000),
   2. productivity floor tie-breaker (`qualifiesForProdSecRow`: M/E/N minimums),
   3. "has routine but not requested today" penalty,
   4. closeness to duty hours,
   5. employment-type order (conscript < contract < official < overtime).
6. **Emergency fill** (`forceAvailable`) when a gap remains: Hard OFF & essential leave still protected; **Soft OFF** and routine-incompatible persons pushed to the back; consecutive-cap breach pushed to the back. If still short → `Coverage Shortage:` warning.
7. **Isolated-shift repair** — moves single-component shifts to keep patterns continuous.
8. **OFF post-process** — (a) no OFF directly after leave, (b) break runs of >3 consecutive OFF by inserting M (or E).
9. **`reconcileStaffingCoverage`** — re-impose exact M/E/N counts (its own priority: component-count first, then cap-breach +40/100, routine +10/−10/+60, soft-OFF +80).
10. **`verifyCoverageAndLeaders`** — emit warnings, choose shift leaders.

### 2.2 Scenario ranking (what the Optimizer button actually produces)

1. **No level-A warning** (hard gate — a candidate with any `Coverage Shortage / Overstaffing / Missing Shift Leader / Max Consecutive / Mandatory Rest` is dropped).
2. **Locks preserved** (structural).
3. **Highest similarity to the Working Roster** (`totalScore = similarityPercent`).
4. Fewer non-critical warnings.
5. Higher request satisfaction (tie-breaker only).

> **Key fact for planning:** in the production path, `Request Satisfaction` is priority **5 of 5**, and `Fairness` is computed but **never** used in selection/UI.

---

## 3. POST-SOLVER MUTATIONS

Every place where `assignments` can change **after** the solver has produced them:

| # | Location | When | Can it break solver decisions? |
|---|---|---|---|
| 1 | `solveNursingSchedule` step 6 (OFF breaker) | inside the producer | **yes — violates hard OFF** (see bug B1) |
| 2 | `solveNursingSchedule` step 5+ (isolated-shift repair) | inside the producer | yes — moves shifts between persons |
| 3 | `solveNursingSchedule` step 9 → `reconcileStaffingCoverage` | inside the producer | **yes — overrides night guard & supervisor morning-only, violates hard OFF on shortage** (B2/B3) |
| 4 | `runOptimizerFacade` → `reconcileStaffingCoverage` (after merge) | apply-scenario / optimizer | yes (same reconcile rules) |
| 5 | `applyManualShiftChangeFacade` → `reconcileStaffingCoverage` ×3 | manual edit | yes (same reconcile rules) |
| 6 | `app/page.tsx` continuous `useEffect` → `reconcileStaffingCoverage` ×3 | after *any* schedule change (incl. month switch) | **yes — runs last, over every mutation, on both groups** |
| 7 | `saveState` (full_resolve / refresh_personnel / refresh_group) | personnel/calendar/settings change | replaces whole rows (respecting finalized/locked) |
| 8 | `generateAndScoreScenarios` `verifyScenarioSchedule` → reconcile | scenario candidates | yes (reconcile re-fixes each candidate) |

`verifyCoverageAndLeaders` was verified read-only (test 21).

---

## 4. TEST STATUS

### 4.1 Environment

- Node v22.22.3, npm 10.9.8. `node_modules` was missing in the sandbox.
- `npm ci` **completed dependency install** but its `postinstall` (`prisma generate`) failed because `https://binaries.prisma.sh` dropped the TLS connection. This is **environment-only** and does **not** affect the Solver tests (the generated Prisma client was already present; the 4 db-* test files import `@prisma/client` and pass).
- Network to registry.npmjs.org is available.

### 4.2 Results

| Command | Files matched | Tests | Pass | Fail | Notes |
|---|---|---|---|---|---|
| `npm test` (`tsx --test tests/*.test.ts`) | 19 top-level files | **225** | 225 | 0 | now includes 26 new characterization tests |
| `npx tsx --test tests/domain/*.test.ts` (manual) | 10 files | **174** | 174 | 0 | **NOT run by `npm test`** |
| `npm run test:auth` | 1 | subset | ✓ | 0 | included in npm test |
| `npm run test:storage` | 1 | subset | ✓ | 0 | included in npm test |
| `npm run storage:test-conditional` | script | — | not run | — | performs real S3 writes; requires S3 env (environment-dependent) |

### 4.3 Key finding (infra gap)

`package.json` `"test": "tsx --test tests/*.test.ts"` only globs the **top-level** `tests/`. The 10 files under `tests/domain/` (174 tests) are **excluded** from `npm test` and from CI. This was reported in the prior audit as a hypothesis — **now confirmed**.

---

## 5. BASELINE TESTS CREATED

Two new files (no product code changed):

- `tests/fixtures/realistic.ts` — builders + named fixtures:
  - `realisticPersonnel()` (supervisor + staff + morning/evening_night/long routines + flexible general)
  - `realisticRequests()` (hard OFF, explicit EN, soft OFF, essential leave, avoid_shift)
  - `scenarioFeasible()`, `scenarioNearInfeasible()`, `scenarioInfeasible()`
- `tests/solver-baseline.test.ts` — 26 characterization tests:

| # | Behavior pinned |
|---|---|
| 1 | exact M/E/N coverage on a feasible roster |
| 2 | leave numbered L1..Ln and preserved |
| 3 | [CURRENT-BEHAVIOR] 4-day leave → "Consecutive OFFs" warning |
| 4 | [CURRENT-BEHAVIOR] explicit MEN-all-month → Max Consecutive + Mandatory Rest (not repaired) |
| 5 | [CURRENT-BEHAVIOR] explicit N-all-month → **no** Max Consecutive (slot-model asymmetry) |
| 6 | no N on two consecutive days in a comfortable roster |
| 7 | [CURRENT-BEHAVIOR] reconcile forces 3+ consecutive nights on a night gap |
| 8 | routine tags restrict M/E/N placement |
| 9 | explicit EN request honored every day |
| 10 | [CURRENT-BEHAVIOR] 5-day hard OFF violated on day 4 |
| 11 | [CURRENT-BEHAVIOR] soft OFF broken identically to hard OFF |
| 12 | [CURRENT-BEHAVIOR] `personnel.locked` ignored by `solveNursingSchedule` |
| 13 | reconcile never modifies a locked row |
| 14 | `mergeOptimizerAssignments` keeps locked rows |
| 15 | [CURRENT-BEHAVIOR] reconcile violates hard OFF on a coverage gap |
| 16 | reconcile never modifies a protected cell |
| 17 | supervisor/staff never work E/N (morning-only) |
| 18 | supervisor/staff OFF on every Friday |
| 19 | [CURRENT-BEHAVIOR] supervisor loses one morning (day 7) to reconcile |
| 20 | [CURRENT-BEHAVIOR] reconcile assigns a night to a supervisor |
| 21 | productivity eligibility thresholds (pure) |
| 22 | productivity holiday/non-holiday weights (pure) |
| 23 | reconcile fills unmet coverage after the greedy pass |
| 24 | `verifyCoverageAndLeaders` is read-only |
| 25 | [CURRENT-BEHAVIOR] scenario `totalScore === baselineSimilarityPercent` |
| 26 | [CURRENT-BEHAVIOR] infeasible coverage → 31 per-day shortages + best-effort assignments |

All 26 pass under `npm test`.

---

## 6. DISCOVERED BUGS

### CRITICAL

- **B1 — Hard OFF is violated by the consecutive-OFF breaker.**
  - **Where:** `lib/solver.ts`, post-process step 6 (`OFF Removed: … سقف ۳ روز متوالی`).
  - **Cause:** the "no more than 3 consecutive OFF" rule inserts `M` (or `E`) into the middle of any OFF run, with **no check for `offHardness: 'hard'` / `isEssential`**.
  - **Effect:** a hard OFF (promised as "Solver حق نقض ندارد") is silently overwritten; the only trace is a `Mismatched Request` warning, which is **not** in `HARD_WARNING_PREFIXES`, so it is not even shown as a level-A/critical alert.
  - **Proof:** test 10 (`solver-baseline.test.ts`), and manual reproduction `[OFF,OFF,OFF,OFF,OFF] → OFF,OFF,OFF,M,OFF`.
  - **Fix before refactor?** **Yes — must be decided first.** Any new Solver must define whether "hard OFF" can ever be broken by rest rules, and if so how it is surfaced.

### HIGH

- **B2 — `reconcileStaffingCoverage` violates hard OFF when filling a shortage.**
  - **Where:** `domain/scheduling/staffing-coverage.ts`, shortage path `available` filter checks locked/protected/leave only — **it never inspects requests** (hard OFF / shift / avoid_shift).
  - **Effect:** the final coverage fixer (which runs last, see §3) can place a shift onto a hard-OFF day.
  - **Proof:** test 15.
- **B3 — `reconcileStaffingCoverage` ignores the supervisor/staff morning-only rule.**
  - **Where:** same file, no `position === 'supervisor'|'staff'` guard in the candidate filter (unlike the greedy fill).
  - **Effect:** a supervisor can end up with `MN`/`N` when a night gap exists.
  - **Proof:** test 20.
- **B4 — `reconcileStaffingCoverage` ignores the "no 3 nights in a row" guard.**
  - **Where:** same file — the greedy fill's `workedN1 && workedN2` check does not exist in reconcile.
  - **Effect:** reconcile "succeeds" by overworking one nurse with long night runs instead of reporting a shortage.
  - **Proof:** test 7 (near-infeasible fixture).
- **B5 — Explicit shift requests bypass every hard rule.**
  - **Where:** `lib/solver.ts` step 3 writes `preferredShift` verbatim; no consecutive-cap/night/heavy check is applied to pre-assigned request cells (the checks only run when the greedy fill *adds* a shift).
  - **Effect:** `MEN` all month is produced (and only surfaced as a `Max Consecutive` warning), and `N` all month is produced **without any warning at all** (slot model treats lone Ns as separate runs).
  - **Proof:** tests 4 and 5.

### MEDIUM

- **B6 — `personnel.locked` is ignored by `solveNursingSchedule`.**
  - **Where:** `lib/solver.ts` filters only `p.active`; `p.locked` is referenced solely in the isolated-shift repair candidate filter.
  - **Effect:** a locked person still receives a full generated schedule; protection is applied only later via merge/reconcile (which can then create new shortages). `solveWithPriority` *does* filter `!p.locked`, so the two solver functions disagree.
  - **Proof:** test 12.
- **B7 — Soft OFF and Hard OFF behave identically in the normal path.**
  - **Where:** the greedy fill's `available` filter excludes both; the OFF-breaker violates both. Only the emergency `forceAvailable` path distinguishes them.
  - **Effect:** the `offHardness` knob has no user-visible effect except in infeasible situations.
  - **Proof:** tests 10 & 11.
- **B8 — A 4-day approved leave is reported as a "Consecutive OFFs" violation.**
  - **Where:** `verifyCoverageAndLeaders` counts `OFF` **and** `L#` days together as "absence" and warns on >3.
  - **Effect:** a legitimate 4-day leave is flagged like a scheduling error.
  - **Proof:** test 3.
- **B9 — `npm test` / CI do not run `tests/domain/*` (174 tests).**
  - **Where:** `package.json` test glob.
  - **Effect:** regression coverage for the domain layer is effectively out of the default test run.

### LOW

- **B10 — Two Objective systems coexist** (`SCENARIO_WEIGHTS`/`weightedTotal` vs baseline `similarityPercent`), with `weightedTotal` surviving only in the legacy scenario-hydration path.
- **B11 — `repairCriticalAlerts` parses Persian warning text with regex** (`/روز (\d+)/`, `/شیفت ([A-Z]+)/`, full-name search) — fragile coupling between data and its display text.
- **B12 — Dead code** (`lib/balanceChecker.ts`, `lib/scoring-stub.ts`, `evaluateSchedule`) — leave for a future cleanup session, not now.

---

## 7. ARCHITECTURAL RISKS

1. **reconcile is the last writer and re-implements (incompletely) the solver's rules.** Any new Solver will still be post-processed by reconcile, which today can break hard OFF, morning-only, and night-rest. *Solver and reconcile must be fixed together.*
2. **Baseline is the production objective.** `totalScore = similarityPercent`; changing the objective later will invalidate scenario-baseline tests (which assert `similarity >= 60` and `totalScore === similarity`).
3. **Behavior is scattered across 4 decision sites** (greedy fill comparator, `forceAvailable`, `solveWithPriority`, reconcile) with non-comparable magic numbers. "Correctness" cannot currently be stated as a single objective.
4. **Two parallel lock systems** (`personnel.locked` vs `lockedRows`) with inconsistent semantics between `solveNursingSchedule` and `solveWithPriority`.
5. **Rules are string-based.** Warning text is the only structure crossing the solver↔scenario↔UI boundary; level-A classification and repair both regex the Persian strings.
6. **The continuous `useEffect` auto-reconcile** means no assignment is ever "final" — small edits cascade (reconcile → verify → save → sync → re-render → reconcile…), making change attribution hard.
7. **All solving runs in the browser.** A future search-based optimizer will need a Web Worker / server path.
8. **`npm test` gap** — the 174 domain tests are effectively invisible in CI.

---

## 8. RECOMMENDED ORDER FOR SESSION 2

1. **Fix the test harness first (safety net):** change the `test` glob to include `tests/domain/*` (and any `tests/**/*.test.ts`), so all 399 tests run in one command before any refactor.
2. **Extract a single, structured `Warning` model** (type + code + day + shift + personnelId) so that level-A classification and `repairCriticalAlerts` stop parsing Persian strings. This is the prerequisite for every later change.
3. **Reconcile & Solver rule unification** — define one shared constraint/priority model and make `reconcileStaffingCoverage` respect hard OFF, morning-only, and night-rest (resolving B1–B5 as a batch).
4. Only after 1–3: introduce the **real Objective** (Hard → Lock → Coverage → Rest → Request → Productivity → Fairness → low-weight Baseline), replacing `similarityPercent` as the ranking key and updating the affected scenario-baseline tests.

> Deliberately **not** in this session: any change to Objective, Solver algorithm, ranking, weights, lock/flexibility model, reconcile behavior, UI, or schema.

---

## 9. Discrepancies vs the prior audit report

The prior audit (SOLVER_AUDIT_REPORT.md) was **re-verified against the code**. All its core findings were **confirmed**; three were refined with new evidence:

| Prior finding | Verdict | Refinement |
|---|---|---|
| reconcile may violate Hard OFF after solver | **Confirmed** | Also found a *more direct* violation: the OFF-breaker (B1), which fires even before reconcile. |
| Baseline = ranking key; requests = weak tiebreaker; fairness unused | **Confirmed** | Pinned with a test: `totalScore === baselineSimilarityPercent`. |
| `personnel.locked` ignored by solver | **Confirmed** | Added exact proof (locked person still works 21 days). |
| night/heavy rules hard vs soft mixing | **Confirmed + extended** | reconcile overrides the night-after-night guard (B4) and morning-only (B3). |
| `tests/domain` not in `npm test` | **Confirmed** | 174 tests excluded. |
| `applyDefaultOffRule` unused | **Confirmed** | No call sites exist. |

No finding of the prior audit was contradicted by the code.

---

## 10. Files changed in this session

| File | Change |
|---|---|
| `tests/fixtures/realistic.ts` | **New** — realistic-but-small fixtures + builders (roster, requests, three coverage presets). Test infrastructure only. |
| `tests/solver-baseline.test.ts` | **New** — 26 characterization tests pinning current solver behavior (no logic change). |
| `node_modules/` (untracked, gitignored) | Installed via `npm ci` to run the tests; not part of any commit. |

No product file, schema, API, or script was modified. `package.json` (including the `test` glob) was intentionally left untouched this session.
