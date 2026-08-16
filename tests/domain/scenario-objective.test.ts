import assert from 'node:assert/strict';
import test from 'node:test';

import {
  areLocksPreserved,
  areScenariosDistinctEnough,
  calculateBaselineDifferencePercent,
  calculateBaselineSimilarityPercent,
  compareByObjective,
  computeBaselineCellDiffs,
  countCriticalWarnings,
  buildScenarioObjective,
  evaluateBaselineObjective,
  hasCriticalWarning,
  isCriticalWarning,
  isScenarioAcceptable,
  SCENARIO_OBJECTIVE_VERSION,
  type ScenarioObjectiveGates,
  type ScenarioObjectiveQuality,
} from '../../domain/scenarios/objective';
import {
  MAX_BASELINE_DIFFERENCE_PERCENT,
  MIN_DIFFERENCE_FROM_BASELINE_PERCENT,
} from '../../domain/scenarios/scenario-quality';
import type { MonthlySchedule } from '../../lib/types';

/**
 * A neutral, fully-tied quality vector. Each test overrides only the tier under
 * examination, so the assertion isolates exactly one ranking dimension.
 */
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

function schedule(assignments: Record<string, Record<number, string>>): MonthlySchedule {
  return {
    year: 1404,
    month: 2,
    assignments: assignments as any,
    shiftLeaders: {},
    warnings: [],
  };
}

const baseline = schedule({
  n1: { 1: 'M', 2: 'OFF', 3: 'E' },
  n2: { 1: 'OFF', 2: 'M', 3: 'M' },
});

const ids = ['n1', 'n2'];
const totalDays = 3;

test('level-A classification matches the hard-constraint prefixes', () => {
  assert.equal(isCriticalWarning('Coverage Shortage: کمبود نیرو در روز 1 شیفت M'), true);
  assert.equal(isCriticalWarning('Overstaffing: نیروی مازاد در روز 2 شیفت M'), true);
  assert.equal(isCriticalWarning('Missing Shift Leader: نبود سرشیفت در نوبت عصر روز 2'), true);
  assert.equal(isCriticalWarning('Max Consecutive: ...'), true);
  // Mandatory Rest is a next-month boundary reminder, not a current-month hard gate.
  assert.equal(isCriticalWarning('Mandatory Rest: ...'), false);
  assert.equal(isCriticalWarning('Mismatched Request: ...'), false);
  assert.equal(isCriticalWarning('یک هشدار دلخواه'), false);
});

test('hasCriticalWarning and countCriticalWarnings aggregate correctly', () => {
  const warnings = [
    'Coverage Shortage: ...',
    'Mismatched Request: ...',
    'Max Consecutive: ...',
    'Mandatory Rest: ...',
  ];
  assert.equal(countCriticalWarnings(warnings), 2);
  assert.equal(hasCriticalWarning(warnings), true);
  assert.equal(hasCriticalWarning(['Mismatched Request: ...']), false);
  assert.equal(hasCriticalWarning(['Mandatory Rest: ...']), false);
});

test('a candidate identical to the baseline has 100% similarity', () => {
  const similarity = calculateBaselineSimilarityPercent(baseline, baseline, ids, totalDays);
  assert.equal(similarity, 100);
  assert.equal(calculateBaselineDifferencePercent(baseline, baseline, ids, totalDays), 0);
});

test('each changed cell lowers the similarity proportionally (2 personnel × 3 days = 6 cells)', () => {
  const oneChange = schedule({
    n1: { 1: 'E', 2: 'OFF', 3: 'E' }, // 1 cell changed
    n2: { 1: 'OFF', 2: 'M', 3: 'M' },
  });
  // 1/6 changed → ~16.67% difference → 83.33% similarity
  assert.equal(calculateBaselineSimilarityPercent(baseline, oneChange, ids, totalDays), 83.33);
});

test('evaluateBaselineObjective reports critical-resolution, locks and similarity correctly', () => {
  const cleanObjective = evaluateBaselineObjective({
    baseline,
    candidate: schedule({ n1: { 1: 'E', 2: 'OFF', 3: 'E' }, n2: { 1: 'OFF', 2: 'M', 3: 'M' } }),
    warnings: [],
    targetPersonnelIds: ids,
    totalDays,
    lockedRows: [],
    requestSatisfactionPercent: 50,
  });
  assert.equal(cleanObjective.criticalResolved, true);
  assert.equal(cleanObjective.locksPreserved, true);
  assert.equal(cleanObjective.criticalWarningCount, 0);
  assert.equal(cleanObjective.similarityPercent, 83.33);
  assert.equal(cleanObjective.baselineDifferencePercent, 16.67);

  const dirtyObjective = evaluateBaselineObjective({
    baseline,
    candidate: baseline,
    warnings: ['Coverage Shortage: ...', 'Max Consecutive: ...'],
    targetPersonnelIds: ids,
    totalDays,
    lockedRows: [],
    requestSatisfactionPercent: 99,
  });
  // سطح A حل‌نشده باید به‌صورت پرچم جدا گزارش شود؛ فیلتر کیفیت بالادست بر اساس
  // همین پرچم، سناریوی کثیف را حذف می‌کند و سپس comparator فقط روی پاک‌ها رتبه می‌بندد.
  assert.equal(dirtyObjective.criticalResolved, false);
  assert.equal(dirtyObjective.criticalWarningCount, 2);
});

// [PHASE-5 OBJECTIVE POLICY] The similarity-first comparator was removed. Baseline
// similarity is now the *final* preference, so a materially better request result
// outranks a slightly more similar candidate.
test('a materially better request result outranks a more baseline-similar candidate', () => {
  const closerButWorseRequests = quality({ baselineSimilarityPercent: 95, requestSatisfactionPercent: 40 });
  const fartherButBetterRequests = quality({ baselineSimilarityPercent: 80, requestSatisfactionPercent: 99 });
  assert.ok(compareByObjective(fartherButBetterRequests, closerButWorseRequests) < 0);
  assert.ok(compareByObjective(closerButWorseRequests, fartherButBetterRequests) > 0);
});

test('areLocksPreserved detects any change on a locked row', () => {
  const preserved = schedule({
    n1: { 1: 'M', 2: 'OFF', 3: 'E' },
    n2: { 1: 'OFF', 2: 'M', 3: 'N' }, // n2 changed but not locked
  });
  assert.equal(areLocksPreserved(baseline, preserved, ['n1']), true);

  const violated = schedule({
    n1: { 1: 'N', 2: 'OFF', 3: 'E' }, // n1 is locked but changed
    n2: { 1: 'OFF', 2: 'M', 3: 'M' },
  });
  assert.equal(areLocksPreserved(baseline, violated, ['n1']), false);
});

test('compareByObjective applies the canonical tiers in order: requests → productivity → fairness → defects → routine → similarity', () => {
  const base = quality({});

  // Tier 3 — requests beat everything below them.
  assert.ok(compareByObjective(
    quality({ requestSatisfactionPercent: 90, operationalEfficiencyScore: 10, fairnessScore: 10, warningDefectCount: 9, baselineSimilarityPercent: 10 }),
    quality({ requestSatisfactionPercent: 80, operationalEfficiencyScore: 99, fairnessScore: 99, warningDefectCount: 0, baselineSimilarityPercent: 99 })
  ) < 0);

  // Tier 4 — productivity decides when requests tie.
  assert.ok(compareByObjective(
    quality({ operationalEfficiencyScore: 90, fairnessScore: 10, baselineSimilarityPercent: 10 }),
    quality({ operationalEfficiencyScore: 80, fairnessScore: 99, baselineSimilarityPercent: 99 })
  ) < 0);

  // Tier 5 — fairness decides when requests and productivity tie.
  assert.ok(compareByObjective(
    quality({ fairnessScore: 90, warningDefectCount: 3, baselineSimilarityPercent: 10 }),
    quality({ fairnessScore: 80, warningDefectCount: 0, baselineSimilarityPercent: 99 })
  ) < 0);

  // Tier 6 — fewer noncritical defects, then fewer routine mismatches.
  assert.ok(compareByObjective(
    quality({ warningDefectCount: 1, baselineSimilarityPercent: 10 }),
    quality({ warningDefectCount: 2, baselineSimilarityPercent: 99 })
  ) < 0);
  assert.ok(compareByObjective(
    quality({ routineMismatchCount: 0, baselineSimilarityPercent: 10 }),
    quality({ routineMismatchCount: 3, baselineSimilarityPercent: 99 })
  ) < 0);

  // Tier 7 — similarity only breaks an otherwise perfect tie.
  assert.ok(compareByObjective(quality({ baselineSimilarityPercent: 95 }), quality({ baselineSimilarityPercent: 80 })) < 0);
  assert.equal(compareByObjective(base, quality({})), 0);
});

test('the objective is deterministic and is a total order over a fixed candidate set', () => {
  const candidates = [
    quality({ requestSatisfactionPercent: 80, fairnessScore: 70, baselineSimilarityPercent: 99 }),
    quality({ requestSatisfactionPercent: 95, fairnessScore: 50, baselineSimilarityPercent: 70 }),
    quality({ requestSatisfactionPercent: 80, fairnessScore: 90, baselineSimilarityPercent: 60 }),
  ];
  const first = [...candidates].sort(compareByObjective).map(c => c.baselineSimilarityPercent);
  const second = [...candidates].reverse().sort(compareByObjective).map(c => c.baselineSimilarityPercent);
  assert.deepEqual(first, second);
  assert.deepEqual(first, [70, 60, 99]);
});

test('sub-rounding differences do not let a lower tier be jumped by numeric noise', () => {
  // All percentage metrics are produced with toFixed(2); a 0.01 wobble must not
  // outrank a real improvement in the next tier down.
  const noisyButWorseDefects = quality({ fairnessScore: 90.01, warningDefectCount: 5 });
  const cleanDefects = quality({ fairnessScore: 90, warningDefectCount: 0 });
  assert.ok(compareByObjective(cleanDefects, noisyButWorseDefects) < 0);
});

test('hard gates are evaluated separately from ranking and cannot be offset by quality', () => {
  const perfectQualityButCritical: ScenarioObjectiveGates = {
    criticalResolved: false, criticalWarningCount: 2, locksPreserved: true,
    withinMaxBaselineDifference: true, meetsMinBaselineDifference: true,
  };
  assert.equal(isScenarioAcceptable(perfectQualityButCritical), false);

  const lockViolation: ScenarioObjectiveGates = {
    criticalResolved: true, criticalWarningCount: 0, locksPreserved: false,
    withinMaxBaselineDifference: true, meetsMinBaselineDifference: true,
  };
  assert.equal(isScenarioAcceptable(lockViolation), false);

  const tooFar: ScenarioObjectiveGates = {
    criticalResolved: true, criticalWarningCount: 0, locksPreserved: true,
    withinMaxBaselineDifference: false, meetsMinBaselineDifference: true,
  };
  assert.equal(isScenarioAcceptable(tooFar), false);

  const tooClose: ScenarioObjectiveGates = {
    criticalResolved: true, criticalWarningCount: 0, locksPreserved: true,
    withinMaxBaselineDifference: true, meetsMinBaselineDifference: false,
  };
  assert.equal(isScenarioAcceptable(tooClose), false);

  assert.equal(isScenarioAcceptable({ ...tooClose, meetsMinBaselineDifference: true }), true);
});

test('buildScenarioObjective derives the hard gates from the unchanged acceptance thresholds', () => {
  const build = (differencePercent: number) => buildScenarioObjective({
    baselineComponents: {
      criticalResolved: true,
      criticalWarningCount: 0,
      locksPreserved: true,
      similarityPercent: Number((100 - differencePercent).toFixed(2)),
      baselineDifferencePercent: differencePercent,
      requestSatisfactionPercent: 100,
    },
    maxBaselineDifferencePercent: MAX_BASELINE_DIFFERENCE_PERCENT,
    minBaselineDifferencePercent: MIN_DIFFERENCE_FROM_BASELINE_PERCENT,
    requestSatisfactionPercent: 100,
    operationalEfficiencyScore: 100,
    fairnessScore: 100,
    warningDefectCount: 0,
    routineMismatchCount: 0,
  });

  assert.equal(MAX_BASELINE_DIFFERENCE_PERCENT, 35, 'max baseline difference threshold is unchanged');
  assert.equal(MIN_DIFFERENCE_FROM_BASELINE_PERCENT, 3, 'min baseline difference threshold is unchanged');
  assert.equal(isScenarioAcceptable(build(10).gates), true);
  assert.equal(build(2).gates.meetsMinBaselineDifference, false);
  assert.equal(build(36).gates.withinMaxBaselineDifference, false);
  assert.equal(build(10).version, SCENARIO_OBJECTIVE_VERSION);
});

test('areScenariosDistinctEnough honours the minimum difference threshold', () => {
  const near = schedule({ n1: { 1: 'E', 2: 'OFF', 3: 'E' }, n2: { 1: 'OFF', 2: 'M', 3: 'M' } });
  const far = schedule({ n1: { 1: 'N', 2: 'N', 3: 'N' }, n2: { 1: 'N', 2: 'N', 3: 'N' } });
  assert.equal(areScenariosDistinctEnough(baseline, near, ids, totalDays, 30), false);
  assert.equal(areScenariosDistinctEnough(baseline, far, ids, totalDays, 30), true);
});

test('computeBaselineCellDiffs lists exactly the changed cells', () => {
  const candidate = schedule({
    n1: { 1: 'E', 2: 'OFF', 3: 'E' }, // day1 M→E changed; day3 E→E same
    n2: { 1: 'OFF', 2: 'E', 3: 'M' }, // day2 M→E changed
  });
  const diffs = computeBaselineCellDiffs(baseline, candidate, ids, totalDays);
  assert.equal(diffs.length, 2);
  assert.deepEqual(diffs[0], { personnelId: 'n1', day: 1, baselineShift: 'M', candidateShift: 'E' });
  assert.deepEqual(diffs[1], { personnelId: 'n2', day: 2, baselineShift: 'M', candidateShift: 'E' });
});
