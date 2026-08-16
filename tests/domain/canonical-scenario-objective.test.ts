/**
 * Phase 5 — Canonical Scenario Objective (focused behavioural tests)
 * ==================================================================
 *
 * These tests assert *policy*, not implementation shape:
 *
 *   1.  a materially better request result outranks a slightly more similar baseline
 *   2.  fairness can affect ranking
 *   3.  productivity can affect ranking
 *   4.  noncritical warning defects are handled consistently (one authoritative count)
 *   5.  baseline similarity acts only at the intended late tier
 *   6.  critical violations still reject scenarios
 *   7.  lock preservation remains mandatory
 *   8.  acceptance thresholds remain unchanged
 *   9.  generated and re-evaluated scenarios use the same canonical semantics
 *  10.  informational warnings do not affect objective quality
 *  11.  the new objective is deterministic
 *  12.  scenario distinctness remains intact
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  areScenariosDistinctEnough,
  buildScenarioObjective,
  compareByObjective,
  isScenarioAcceptable,
  SCENARIO_OBJECTIVE_VERSION,
  type ScenarioObjectiveQuality,
} from '../../domain/scenarios/objective';
import {
  evaluateScenarioQuality,
  MAX_BASELINE_DIFFERENCE_PERCENT,
  MIN_DIFFERENCE_FROM_BASELINE_PERCENT,
  MIN_DISTINCT_DIFFERENCE_PERCENT,
} from '../../domain/scenarios/scenario-quality';
import { generateAndScoreScenarios } from '../../lib/scenarioGenerator';
import { solveNursingSchedule } from '../../lib/solver';
import type { MonthlySchedule, Personnel, ShiftRequest, ShiftType, SystemSettings } from '../../lib/types';
import { CAL_MONTH, CAL_YEAR, makePerson, makeRequest, makeSettings } from '../fixtures/realistic';

const TOTAL_DAYS = 31;

function quality(overrides: Partial<ScenarioObjectiveQuality>): ScenarioObjectiveQuality {
  return {
    requestSatisfactionPercent: 80,
    operationalEfficiencyScore: 80,
    fairnessScore: 80,
    warningDefectCount: 0,
    routineMismatchCount: 0,
    baselineSimilarityPercent: 80,
    ...overrides,
  };
}

function scheduleOf(
  assignments: Record<string, Record<number, ShiftType>>,
  warnings: string[] = []
): MonthlySchedule {
  return { year: CAL_YEAR, month: CAL_MONTH, assignments, shiftLeaders: {}, warnings };
}

function evaluate(
  schedule: MonthlySchedule,
  baseline: MonthlySchedule,
  personnel: Personnel[],
  requests: ShiftRequest[],
  settings: SystemSettings,
  lockedRows: string[] = []
) {
  return evaluateScenarioQuality({
    id: 1,
    type: 'MIXED',
    schedule,
    baseline,
    personnelList: personnel,
    requests,
    settings,
    year: CAL_YEAR,
    month: CAL_MONTH,
    customHolidays: {},
    firstDayOfWeekIndex: undefined,
    monthlyDutyHours: null,
    targetJobGroup: 'nurse',
    targetPersonnelIds: personnel.filter(p => !lockedRows.includes(p.id)).map(p => p.id),
    totalDays: TOTAL_DAYS,
    lockedRows,
  });
}

// ---------------------------------------------------------------------------
// 1 & 5. Similarity no longer dominates; it is the final preference
// ---------------------------------------------------------------------------

test('1. a materially better request result outranks a slightly more similar baseline', () => {
  const betterRequests = quality({ requestSatisfactionPercent: 92, baselineSimilarityPercent: 84 });
  const moreSimilar = quality({ requestSatisfactionPercent: 71, baselineSimilarityPercent: 97 });
  assert.ok(compareByObjective(betterRequests, moreSimilar) < 0);
});

test('5. baseline similarity only decides when every higher tier is tied', () => {
  // Any single higher-tier advantage beats a 39-point similarity advantage.
  const higherTierWins = [
    quality({ requestSatisfactionPercent: 81, baselineSimilarityPercent: 60 }),
    quality({ operationalEfficiencyScore: 81, baselineSimilarityPercent: 60 }),
    quality({ fairnessScore: 81, baselineSimilarityPercent: 60 }),
    quality({ warningDefectCount: 0, baselineSimilarityPercent: 60 }),
    quality({ routineMismatchCount: 0, baselineSimilarityPercent: 60 }),
  ];
  const verySimilarButWorse = [
    quality({ requestSatisfactionPercent: 80, baselineSimilarityPercent: 99 }),
    quality({ operationalEfficiencyScore: 80, baselineSimilarityPercent: 99 }),
    quality({ fairnessScore: 80, baselineSimilarityPercent: 99 }),
    quality({ warningDefectCount: 2, baselineSimilarityPercent: 99 }),
    quality({ routineMismatchCount: 2, baselineSimilarityPercent: 99 }),
  ];
  for (let i = 0; i < higherTierWins.length; i += 1) {
    assert.ok(
      compareByObjective(higherTierWins[i], verySimilarButWorse[i]) < 0,
      `tier ${i} must outrank baseline similarity`
    );
  }

  // But with every other tier tied, similarity does decide.
  assert.ok(compareByObjective(
    quality({ baselineSimilarityPercent: 91 }),
    quality({ baselineSimilarityPercent: 90 })
  ) < 0);
});

// ---------------------------------------------------------------------------
// 2 & 3. Fairness and productivity can actually affect ranking
// ---------------------------------------------------------------------------

test('2. fairness affects ranking when requests and productivity are tied', () => {
  const fairer = quality({ fairnessScore: 88, baselineSimilarityPercent: 70 });
  const lessFair = quality({ fairnessScore: 62, baselineSimilarityPercent: 99 });
  assert.ok(compareByObjective(fairer, lessFair) < 0);
  // …but fairness never overrides request satisfaction.
  assert.ok(compareByObjective(
    quality({ requestSatisfactionPercent: 95, fairnessScore: 40 }),
    quality({ requestSatisfactionPercent: 70, fairnessScore: 99 })
  ) < 0);
});

test('3. productivity affects ranking and outranks fairness but not requests', () => {
  assert.ok(compareByObjective(
    quality({ operationalEfficiencyScore: 90, fairnessScore: 40 }),
    quality({ operationalEfficiencyScore: 70, fairnessScore: 99 })
  ) < 0);
  assert.ok(compareByObjective(
    quality({ requestSatisfactionPercent: 95, operationalEfficiencyScore: 30 }),
    quality({ requestSatisfactionPercent: 70, operationalEfficiencyScore: 99 })
  ) < 0);
});

test('3b. productivity is measured without warning penalties mixed in', () => {
  const nurse = makePerson('prod-1');
  const other = makePerson('prod-2');
  const settings = makeSettings({ morningNurse: 1, afternoonNurse: 0, nightNurse: 0 });
  const assignments = { [nurse.id]: { 1: 'M' as ShiftType }, [other.id]: { 1: 'OFF' as ShiftType } };
  const clean = evaluate(scheduleOf(assignments), scheduleOf(assignments), [nurse, other], [], settings);
  const withDefect = evaluate(
    scheduleOf(assignments, ['Mismatched Request: نمونهٔ تخلف غیربحرانی']),
    scheduleOf(assignments), [nurse, other], [], settings
  );

  // A noncritical warning must move the defect count, never the productivity score.
  assert.equal(
    withDefect.objective!.quality.operationalEfficiencyScore,
    clean.objective!.quality.operationalEfficiencyScore
  );
  assert.equal(withDefect.objective!.quality.warningDefectCount, 1);
  assert.equal(clean.objective!.quality.warningDefectCount, 0);
  // The legacy blended metric still mixes them — which is exactly why it is no
  // longer the productivity input for the canonical objective.
  assert.ok(withDefect.metrics.optimizationScore < clean.metrics.optimizationScore);
});

// ---------------------------------------------------------------------------
// 4 & 10. Warning defects: one authoritative count, informational excluded
// ---------------------------------------------------------------------------

test('4. the noncritical defect count is authoritative and excludes critical warnings', () => {
  const nurse = makePerson('warn-1');
  const settings = makeSettings({ morningNurse: 1, afternoonNurse: 0, nightNurse: 0 });
  const assignments = { [nurse.id]: { 1: 'M' as ShiftType } };
  const base = scheduleOf(assignments);

  const evaluated = evaluate(
    scheduleOf(assignments, [
      'Mismatched Request: تخلف غیربحرانی ۱',
      'Mandatory Rest: یادآور مرزی',
      'Coverage Shortage: کمبود نیرو (پرستار) در روز 9 شیفت N',
    ]),
    base, [nurse], [], settings
  );

  // 3 defect warnings − 1 critical = 2 noncritical defects, counted exactly once.
  assert.equal(evaluated.metrics.warningCount, 3);
  assert.equal(evaluated.metrics.hardWarningCount, 1);
  assert.equal(evaluated.metrics.nonCriticalWarningDefectCount, 2);
  assert.equal(evaluated.objective!.quality.warningDefectCount, 2);
  // The critical warning is a gate, not a second penalty in the quality vector.
  assert.equal(evaluated.objective!.gates.criticalWarningCount, 1);
  assert.equal(evaluated.objective!.gates.criticalResolved, false);
});

test('10. informational auto-fix notices do not affect objective quality', () => {
  const nurse = makePerson('info-1');
  const settings = makeSettings({ morningNurse: 1, afternoonNurse: 0, nightNurse: 0 });
  const assignments = { [nurse.id]: { 1: 'M' as ShiftType } };
  const base = scheduleOf(assignments);

  const clean = evaluate(scheduleOf(assignments), base, [nurse], [], settings);
  const informational = evaluate(
    scheduleOf(assignments, [
      'OFF Removed: حذف OFF ناخواسته پرسنل info-1 T در روز 2',
      'Isolated Shift Fixed: شیفت تک پرسنل info-1 T در روز 3 منتقل شد',
    ]),
    base, [nurse], [], settings
  );

  assert.deepEqual(informational.objective!.quality, clean.objective!.quality);
  assert.equal(compareByObjective(informational.objective!.quality, clean.objective!.quality), 0);
  assert.equal(informational.objective!.gates.criticalWarningCount, 0);
});

// ---------------------------------------------------------------------------
// 6, 7, 8. Hard acceptance gates
// ---------------------------------------------------------------------------

test('6. a candidate with a remaining critical violation is rejected regardless of quality', () => {
  const perfectQuality = {
    requestSatisfactionPercent: 100,
    operationalEfficiencyScore: 100,
    fairnessScore: 100,
    warningDefectCount: 0,
    routineMismatchCount: 0,
  };
  const objective = buildScenarioObjective({
    baselineComponents: {
      criticalResolved: false,
      criticalWarningCount: 1,
      locksPreserved: true,
      similarityPercent: 90,
      baselineDifferencePercent: 10,
      requestSatisfactionPercent: 100,
    },
    maxBaselineDifferencePercent: MAX_BASELINE_DIFFERENCE_PERCENT,
    minBaselineDifferencePercent: MIN_DIFFERENCE_FROM_BASELINE_PERCENT,
    ...perfectQuality,
  });
  assert.equal(isScenarioAcceptable(objective.gates), false);
});

test('7. lock preservation is a mandatory acceptance gate, not just a computed flag', () => {
  const locked = makePerson('locked-1');
  const free = makePerson('free-1');
  const settings = makeSettings({ morningNurse: 1, afternoonNurse: 0, nightNurse: 0 });
  const baseline = scheduleOf({
    [locked.id]: { 1: 'M' as ShiftType },
    [free.id]: { 1: 'OFF' as ShiftType },
  });
  const violating = scheduleOf({
    [locked.id]: { 1: 'OFF' as ShiftType }, // locked row changed
    [free.id]: { 1: 'M' as ShiftType },
  });

  const evaluated = evaluate(violating, baseline, [locked, free], [], settings, [locked.id]);
  assert.equal(evaluated.objective!.gates.locksPreserved, false);
  assert.equal(isScenarioAcceptable(evaluated.objective!.gates), false);

  const preserving = scheduleOf({
    [locked.id]: { 1: 'M' as ShiftType },
    [free.id]: { 1: 'M' as ShiftType },
  });
  const ok = evaluate(preserving, baseline, [locked, free], [], settings, [locked.id]);
  assert.equal(ok.objective!.gates.locksPreserved, true);
});

test('8. acceptance thresholds are unchanged by the new objective', () => {
  assert.equal(MAX_BASELINE_DIFFERENCE_PERCENT, 35);
  assert.equal(MIN_DIFFERENCE_FROM_BASELINE_PERCENT, 3);
  assert.equal(MIN_DISTINCT_DIFFERENCE_PERCENT, 3);
});

// ---------------------------------------------------------------------------
// 9, 11, 12. End-to-end: shared semantics, determinism, distinctness
// ---------------------------------------------------------------------------

function requestScenario() {
  const personnel = [
    makePerson('r1', { orderIndex: 0 }),
    makePerson('r2', { orderIndex: 1 }),
    makePerson('r3', { orderIndex: 2 }),
    makePerson('r4', { orderIndex: 3 }),
  ];
  const requests = [
    makeRequest('r1', { id: 'q1', requestType: 'OFF', scope: 'custom_days', selectedDays: [5, 6, 7], isEssential: false }),
    makeRequest('r2', { id: 'q2', requestType: 'shift', preferredShift: 'M', scope: 'custom_days', selectedDays: [10, 11], isEssential: false }),
  ];
  const settings = makeSettings({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 });
  return { personnel, requests, settings };
}

test('9. generated scenarios carry the canonical objective and a stable totalScore contract', () => {
  const { personnel, requests, settings } = requestScenario();
  const baseline = solveNursingSchedule(CAL_YEAR, CAL_MONTH, personnel, requests, settings, {}, undefined, null);
  const result = generateAndScoreScenarios(
    CAL_YEAR, CAL_MONTH, personnel, requests, settings, {}, undefined, null,
    'nurse', baseline.assignments as any, []
  );

  for (const scenario of result.top3) {
    assert.equal(scenario.objectiveVersion, SCENARIO_OBJECTIVE_VERSION);
    assert.ok(scenario.objective);
    // totalScore has one documented meaning in every path.
    assert.equal(scenario.totalScore, scenario.metrics.weightedTotal);
    // Hard gates all passed for anything that reached the user.
    assert.equal(isScenarioAcceptable(scenario.objective!.gates), true);
    assert.equal(scenario.criticalWarningCount, 0);
  }
});

test('11. repeated generation produces an identical objective (deterministic)', () => {
  const { personnel, requests, settings } = requestScenario();
  const baseline = solveNursingSchedule(CAL_YEAR, CAL_MONTH, personnel, requests, settings, {}, undefined, null);
  const run = () => generateAndScoreScenarios(
    CAL_YEAR, CAL_MONTH, personnel, requests, settings, {}, undefined, null,
    'nurse', baseline.assignments as any, []
  ).top3.map(scenario => ({
    quality: scenario.objective!.quality,
    gates: scenario.objective!.gates,
    totalScore: scenario.totalScore,
  }));
  assert.deepEqual(run(), run());
});

test('12. displayed scenarios stay mutually distinct and distinct from the baseline', () => {
  const { personnel, requests, settings } = requestScenario();
  const baseline = solveNursingSchedule(CAL_YEAR, CAL_MONTH, personnel, requests, settings, {}, undefined, null);
  const result = generateAndScoreScenarios(
    CAL_YEAR, CAL_MONTH, personnel, requests, settings, {}, undefined, null,
    'nurse', baseline.assignments as any, []
  );
  const ids = personnel.map(person => person.id);

  for (const scenario of result.top3) {
    const difference = scenario.baselineDifferencePercent ?? 0;
    assert.ok(difference >= MIN_DIFFERENCE_FROM_BASELINE_PERCENT, 'must be a real alternative to the baseline');
    assert.ok(difference <= MAX_BASELINE_DIFFERENCE_PERCENT, 'must stay within the max baseline distance');
  }
  for (let i = 0; i < result.top3.length; i += 1) {
    for (let j = i + 1; j < result.top3.length; j += 1) {
      assert.ok(
        areScenariosDistinctEnough(
          result.top3[i].schedule, result.top3[j].schedule, ids, TOTAL_DAYS, MIN_DISTINCT_DIFFERENCE_PERCENT
        ),
        `scenarios ${i} and ${j} must stay distinct`
      );
    }
  }
});
