# Phase 5 — Read-Only Implementation Audit (before any code change)

Method: call-graph following (`grep` over all `.ts/.tsx`, then reading each consumer).
No behaviour was inferred from identifier names.

## 1. Dependency map (as of `2cd7172`, before Phase 5 edits)

### 1.1 Scenario quality definitions

| Symbol | Defined in | Meaning today | Consumers (real call graph) |
|---|---|---|---|
| `compareByObjective` | `domain/scenarios/objective.ts` | lexicographic: similarity ↓ → nonCriticalWarningCount ↑ → requestSatisfaction ↓ → routineMismatch ↑ | `lib/scenarioGenerator.ts` (`selectTopScenarios`, `finalizeScenarioResult`), `tests/domain/scenario-objective.test.ts`, `tests/phase2-policy-alignment.test.ts` |
| `ObjectiveRankable` | `domain/scenarios/objective.ts` | input shape of the comparator | same as above |
| `compareByBaselineSimilarity` | `domain/scenarios/objective.ts` | similarity ↓ → request ↓ | **tests only** (no production consumer) |
| `evaluateBaselineObjective` | `domain/scenarios/objective.ts` | critical count + locksPreserved + similarity + request | `lib/scenarioGenerator.ts#scoreCandidate`, `tests/domain/scenario-objective.test.ts`, `tests/domain/structured-warnings.test.ts` |
| `areLocksPreserved` | `domain/scenarios/objective.ts` | structural lock check | `evaluateBaselineObjective` only — **computed but never gated on** (audit finding A1) |
| `scoreCandidate` | `lib/scenarioGenerator.ts` (private) | builds `{schedule, scored, objective, rankable}`; **overwrites** `scored.totalScore = similarityPercent` | `runBaselineOrientedEngine` |
| `evaluateScenarioSchedule` | `lib/scoring.ts` | legacy weighted evaluation; sets `totalScore = weightedTotal` (type-weighted) | `lib/scenarioGenerator.ts#evaluateScenario`, `app/page.tsx#hydrateStoredScenario`, `app/page.tsx#reevaluateScenarioForGroup`, `lib/scoring.ts#evaluateSchedule`, tests |
| `evaluateSchedule` | `lib/scoring.ts` | thin wrapper over `evaluateScenarioSchedule` | `scripts/test_scoring.ts` only |

### 1.2 The dual-authority split (the defect Phase 5 must remove)

```
fresh generation      : scoreCandidate → totalScore = baselineSimilarityPercent
stored/legacy re-eval : evaluateScenarioSchedule → totalScore = metrics.weightedTotal
                        (weightedTotal depends on the *presentation label* REQUESTS/FAIRNESS/MIXED)
selection authority   : compareByObjective (similarity first)
repair authority      : repairCriticalAlerts (critical count, then *baseline difference*)
UI headline           : ScenarioWarningsModal `scenario.totalScore`
UI ranking            : ScenarioWorkspace sorts by `baselineSimilarityPercent`
event log             : app/page.tsx → buildSolverRunEvents({ totalScore }) → domain/logging/solver-report.ts
```

So after `reevaluateScenarioForGroup` runs (warning dismissal, manual edit, re-score) a scenario's
`totalScore` silently changes meaning from *similarity* to *type-weighted blend*, and
`baselineSimilarityPercent` is dropped from the object. Confirmed by reading
`app/page.tsx:3125-3151` and `lib/scenarioGenerator.ts:623-660`.

### 1.3 Component metrics

| Metric | Defined in | Composition | Notes |
|---|---|---|---|
| `metrics.requestScore` | `lib/scoring.ts#calculateRequestScore` | weighted satisfied/total over request scope (`isDayInRequestScope`, `requestDayWeight`) | also exposed pure as `calculateRequestSatisfactionPercent` |
| `metrics.fairnessScore` | `#calculateFairnessScore` | `0.45*hourBalance + 0.35*shiftBalance + 0.20*holidayBalance`; hourBalance itself `0.7*spread + 0.3*dutyCloseness` | components also exposed individually |
| `metrics.optimizationScore` | `#calculateOptimizationScore` | `0.65*warningScore + 0.35*efficiencyScore` — **mixes warning penalties with productivity** (audit finding A2) |
| `metrics.satisfactionScore` | `evaluateScenarioSchedule` | `(requestScore+fairnessScore)/2` | display only |
| `metrics.weightedTotal` | `evaluateScenarioSchedule` | `SCENARIO_WEIGHTS[type]` blend of request/fairness/optimization | **type-label dependent** (audit finding A3) |
| `metrics.warningCount` | `countScoringDefectWarnings` | all warnings minus informational | includes criticals |
| `metrics.hardWarningCount` | `countHardConstraintWarnings` | critical only (string prefixes) | |
| non-critical defect count | *inlined in* `scoreCandidate` | `countScoringDefectWarnings - criticalWarningCount` | **second, private copy** of the warning count (audit finding A4) |
| `baselineSimilarityPercent` / `baselineDifferencePercent` | `domain/scenarios/objective.ts` | changed target cells / (targets × days) | acceptance thresholds live in `lib/scenarioGenerator.ts` |
| `countRoutineMismatches` | `lib/scoring.ts` | out-of-routine work cells | last tiebreaker |

### 1.4 Acceptance / filtering / repair / persistence

* Acceptance (`applyQualityFilter`, `lib/scenarioGenerator.ts`): `criticalResolved` **and**
  `difference ≤ MAX_BASELINE_DIFFERENCE_PERCENT (35)` **and** `difference ≥ MIN_DIFFERENCE_FROM_BASELINE_PERCENT (3)`.
  Locks are *not* verified here — only computed inside the objective (finding A1).
* Distinctness (`areScenariosDistinctEnough`, `MIN_DISTINCT_DIFFERENCE_PERCENT = 3`) in `selectTopScenarios`.
* Critical repair (`repairCriticalAlerts`): structured-code driven edits; tie on critical count is broken by
  **smallest baseline difference** → similarity bias inside repair (finding A5).
* Critical classification: `domain/warnings/schedule-warning.ts#CRITICAL_WARNING_CODES`
  (`COVERAGE_SHORTAGE, OVERSTAFFING, MISSING_SHIFT_LEADER, MAX_CONSECUTIVE, NIGHT_REST,
  SUPERVISOR_STAFF_EN_RESTRICTION, UNKNOWN_SHIFT, HARD_CONSTRAINT_VIOLATION`), mirrored by
  `HARD_WARNING_PREFIXES` for persisted strings. `MANDATORY_REST`, `CONSECUTIVE_OFFS`,
  `MISMATCHED_REQUEST`, `LEAVE_CONTINUITY`, `ISOLATED_SHIFT`, `HARD_CONSTRAINT_CONFLICT`,
  `OVERTIME_CAP_EXCEEDED` are non-critical; `OFF_REMOVED`, `ISOLATED_SHIFT_FIXED` are informational.
* Persistence: `deptData.activeScenarios[monthKey][group].scenarios` — validated by
  `lib/storageSchemas.ts` as `z.any()` / `ActiveScenariosSchema = z.record(monthKey, z.any())`.
  **No Prisma model or column describes the scenario payload** (`prisma/schema.prisma` has no scenario
  field) → an objective-version marker can be added with **no schema migration**.
* Hydration: `app/page.tsx#hydrateStoredScenario` — if the stored object already has
  `metrics/scenarioKey/title/shortTitle`, it is passed through untouched (only warnings refiltered);
  otherwise it is re-evaluated with `evaluateScenarioSchedule`.

### 1.5 Coverage-quality feasibility (Tier 1 of the requested hierarchy)

Coverage is evaluated in `lib/solver.ts#verifyCoverageAndLeaders`: `assigned < demand → COVERAGE_SHORTAGE`
and `assigned > demand → OVERSTAFFING`, **both critical**. There is therefore no data-supported band of
"reasonable surplus" — any surplus is already a hard violation, and every accepted scenario has exactly
`assigned == demand` on every (day, shift, group). A graded coverage score would require inventing a new
clinical policy ("how much surplus is acceptable"), which §5 forbids. **Decision: coverage stays a pure
hard gate; no fake coverage quality score is invented.** (Explicitly allowed fallback in §5.)

Same reasoning for rest/workload: `MAX_CONSECUTIVE`, `NIGHT_REST`, the shared hard evaluator and the
overtime cap are hard/critical; the only remaining non-hard rest signal is the `MANDATORY_REST` reminder,
which is already counted exactly once by the single authoritative non-critical defect count. No new rest
mathematics is invented, and the Phase 4 `CONSECUTIVE_OFFS` policy is untouched.

## 2. Findings that Phase 5 fixes

* **A1** locks computed, never gated → add explicit acceptance verification.
* **A2** `optimizationScore` mixes warning penalties with productivity → split out
  `operationalEfficiencyScore` (productivity) and `warningQualityScore` (warning defects).
* **A3/A4** two `totalScore` meanings and two non-critical warning counts → one canonical objective,
  one authoritative count, one documented `totalScore` contract.
* **A5** similarity bias inside `repairCriticalAlerts` → secondary preference becomes the canonical
  non-hard quality comparison, with baseline difference retained as the *last* preference.

## 3. No stop condition triggered

* coverage quality → resolved by the §5 fallback (hard gate, documented) — no product policy invented;
* fairness vs productivity → no semantic conflict: fairness measures *dispersion between people*,
  productivity measures *mean absolute deviation from contractual duty hours*; they share inputs but
  answer different questions, and productivity is ranked strictly above fairness;
* persistence → `z.any()` storage, no Prisma involvement → no migration;
* hard policies → unchanged (see final report scope section);
* scenario types → remain presentation labels assigned after ranking;
* scalar `totalScore` → cannot be derived from a lexicographic objective without inventing weights,
  so §6's fallback is used: `totalScore` is a documented compatibility/display field and the structured
  objective is the ranking authority.

---

# Phase 5 — Implementation Decisions (post-audit)

## Canonical objective (the single authority)

**Tier 0 — hard acceptance** (`ScenarioObjectiveGates` / `isScenarioAcceptable`), unchanged policy:
`criticalResolved` ∧ `locksPreserved` ∧ `withinMaxBaselineDifference (≤35%)` ∧ `meetsMinBaselineDifference (≥3%)`.

**Ranking (lexicographic, accepted candidates only)** — `compareByObjective`:
1. Coverage quality → **hard gate only** (documented: no graded metric derivable without inventing policy)
2. Rest/workload → **hard gate only** (same reason; `MANDATORY_REST` stays noncritical and is counted once in tier 6)
3. `requestSatisfactionPercent` ↓
4. `operationalEfficiencyScore` ↓ (productivity, newly separated from warning penalties)
5. `fairnessScore` ↓ (existing hour/shift/holiday/duty-deviation composition, untouched)
6. `warningDefectCount` ↑ then `routineMismatchCount` ↑
7. `baselineSimilarityPercent` ↓ — final preference

Continuous percentage tiers compare with `OBJECTIVE_MATERIAL_DIFFERENCE = 0.5` so that `toFixed(2)`
rounding noise cannot jump a lower tier. This is a comparison epsilon, not a weight: it never converts
one metric into another.

## `totalScore` contract

A scalar cannot be derived from a lexicographic objective without inventing weights, so §6's documented
fallback applies: `totalScore` is a **compatibility/display field** equal to `metrics.weightedTotal` in
**every** code path (generation and re-evaluation). The similarity overwrite in the generator is gone.
The ranking authority is the structured `ScoredSchedule.objective`.

Because `weightedTotal` depends on `SCENARIO_WEIGHTS[type]` and the type label is assigned *after*
ranking, `finalizeScenarioResult` now re-derives the label-dependent compatibility fields with the final
label. Objective tiers are label-independent, so no ranking moves.

## Persistence / versioning

No Prisma change. `SCENARIO_OBJECTIVE_VERSION = 'scenario-objective/2'` is stored on generated scenarios
inside the existing `z.any()` scenario payload. Historical scores are never rewritten; pre-Phase-5 stored
scenarios are tagged `LEGACY_SCENARIO_OBJECTIVE_VERSION` on hydration so their scores are not mistaken
for Phase 5 semantics.
