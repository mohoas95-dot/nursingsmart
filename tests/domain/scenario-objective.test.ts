import assert from 'node:assert/strict';
import test from 'node:test';

import {
  areLocksPreserved,
  areScenariosDistinctEnough,
  calculateBaselineDifferencePercent,
  calculateBaselineSimilarityPercent,
  compareByBaselineSimilarity,
  compareByObjective,
  computeBaselineCellDiffs,
  countCriticalWarnings,
  evaluateBaselineObjective,
  hasCriticalWarning,
  isCriticalWarning,
} from '../../domain/scenarios/objective';
import type { MonthlySchedule } from '../../lib/types';

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

test('compareByBaselineSimilarity ranks already-clean scenarios by closeness to baseline', () => {
  // هر دو سناریو پاک‌اند (فیلتر کیفیت رد شده‌اند)؛ رتبه‌بندی فقط بر اساس شباهت است.
  const closer = { baselineSimilarityPercent: 95, requestSatisfactionPercent: 40 };
  const farther = { baselineSimilarityPercent: 80, requestSatisfactionPercent: 99 };
  assert.ok(compareByBaselineSimilarity(closer, farther) < 0); // closer first
  assert.ok(compareByBaselineSimilarity(farther, closer) > 0);
  // در برابری شباهت، رضایت درخواست (پس‌زمینه) تعیین‌کننده است.
  assert.ok(compareByBaselineSimilarity(
    { baselineSimilarityPercent: 90, requestSatisfactionPercent: 80 },
    { baselineSimilarityPercent: 90, requestSatisfactionPercent: 60 }
  ) < 0);
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

test('compareByObjective ranks by similarity, then fewer warnings, then more requests', () => {
  const a = { similarityPercent: 95, nonCriticalWarningCount: 2, requestSatisfactionPercent: 60 };
  const b = { similarityPercent: 95, nonCriticalWarningCount: 1, requestSatisfactionPercent: 60 };
  const c = { similarityPercent: 95, nonCriticalWarningCount: 1, requestSatisfactionPercent: 80 };
  const d = { similarityPercent: 90, nonCriticalWarningCount: 0, requestSatisfactionPercent: 99 };
  assert.ok(compareByObjective(a, d) < 0); // similarity dominates
  assert.ok(compareByObjective(b, a) < 0); // tie similarity → fewer warnings
  assert.ok(compareByObjective(c, b) < 0); // tie similarity+warnings → more requests
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
