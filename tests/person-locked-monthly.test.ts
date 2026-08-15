/**
 * Phase 2 Final Fix — "person.locked" is a MONTHLY lock.
 *
 * The approved policy: `person.locked` means "this person is locked for the
 * CURRENT monthly schedule". A lock set in one month must not automatically
 * lock the same person in another month.
 *
 * These tests prove that the global `Personnel.locked` boolean does NOT leak
 * across monthly scheduling contexts: the monthly lock (the schedule's
 * `lockedRows` / the solver's `lockedPersonIds`) is the only lock source.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeOptimizerAssignments,
} from '../domain/scheduling/schedule-operations';
import {
  reconcileStaffingCoverage,
} from '../domain/scheduling/staffing-coverage';
import { applyManualShiftChangeFacade } from '../features/scheduling/facades/shift-write-facade';
import {
  generateAndScoreScenarios,
} from '../lib/scenarioGenerator';
import {
  solveNursingSchedule,
  verifyCoverageAndLeaders,
} from '../lib/solver';
import type { Personnel, ShiftType, SystemSettings } from '../lib/types';
import {
  CAL_MONTH,
  CAL_YEAR,
  makePerson,
  makeSettings,
} from './fixtures/realistic';

const YEAR = CAL_YEAR;
const AUGUST = CAL_MONTH;       // "month X"
const SEPTEMBER = CAL_MONTH + 1; // "month Y"

const ALL_PERIODS_DEMAND = makeSettings(
  { morningNurse: 1, afternoonNurse: 1, nightNurse: 1 },
  { morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }
);

function settingsMorningOne(): SystemSettings {
  return makeSettings({ morningNurse: 1 }, { morningNurse: 1 });
}

function oneDayCalendar(day = 1, isHoliday = false) {
  return [{ day, dayOfWeek: 0, isHoliday }];
}

function lockedPerson(id: string): Personnel {
  return makePerson(id, { locked: true });
}

function scheduleWith(assignments: Record<string, Record<number, ShiftType>>) {
  return {
    year: YEAR,
    month: AUGUST,
    assignments,
    shiftLeaders: {},
    warnings: [] as string[],
  };
}

// ============================================================================
// Test 1 — same-month protection: monthly lock blocks every path
// ============================================================================

test('same month: normal solver respects the monthly lock', () => {
  const a = makePerson('A');
  const solved = solveNursingSchedule(
    YEAR, AUGUST, [a], [], settingsMorningOne(), {}, undefined, null, ['A']
  );
  const rowA = solved.assignments[a.id] ?? {};
  assert.equal(
    Object.values(rowA).every(shift => shift === 'OFF'),
    true,
    'a person in the month lock set is not scheduled'
  );
});

test('same month: reconciliation respects the monthly lock', () => {
  const a = makePerson('A');
  const reconciled = reconcileStaffingCoverage(
    { A: { 1: 'OFF' } },
    [a],
    settingsMorningOne(),
    oneDayCalendar(1),
    ['nurse'],
    ['A'], // monthly lock
    []
  );
  assert.equal(reconciled.assignments.A[1], 'OFF', 'a locked person cannot be filled');
});

test('same month: optimizer merge respects the monthly lock', () => {
  const a = makePerson('A');
  const merged = mergeOptimizerAssignments(
    { A: { 1: 'OFF' } },
    { A: { 1: 'M' } },
    [a],
    'nurse',
    ['A'] // monthly lock
  );
  assert.equal(merged.A[1], 'OFF', 'a locked row is preserved, not overwritten');
});

test('same month: manual facade respects the monthly lock', async () => {
  const a = makePerson('A');
  const result = await applyManualShiftChangeFacade(
    {
      personnelId: 'A', day: 1, shift: 'M', year: YEAR, month: AUGUST,
      currentSchedule: scheduleWith({ A: { 1: 'OFF' } }),
      personnel: [a], requests: [], settings: settingsMorningOne(),
      holidays: {}, firstDayOfWeek: undefined,
      lockState: { finalizedNursesMonths: [], finalizedAssistantsMonths: [], lockedRows: ['A'] },
    },
    verifyCoverageAndLeaders,
    { saveSchedule: async () => undefined },
    'dept'
  );
  assert.equal(result.success, false, 'a locked row rejects a manual edit');
});

test('same month: scenario generation respects the monthly lock', () => {
  const a = makePerson('A');
  const b = makePerson('B');
  const baseline = solveNursingSchedule(
    YEAR, AUGUST, [a, b], [], ALL_PERIODS_DEMAND, {}, undefined, null, ['A']
  ).assignments;
  const result = generateAndScoreScenarios(
    YEAR, AUGUST, [a, b], [], ALL_PERIODS_DEMAND, {}, undefined, null, 'nurse', baseline, ['A']
  );
  // A's row must remain unchanged across every generated scenario.
  for (const scenario of result.top3) {
    assert.deepEqual(scenario.schedule.assignments.A, baseline.A);
  }
});

// ============================================================================
// Test 2 — next month is unlocked
// ============================================================================

test('next month: a globally-flagged person is NOT locked in an unlocked month', () => {
  const a = lockedPerson('A'); // legacy global flag
  // September has no monthly lock for A.
  const solved = solveNursingSchedule(
    YEAR, SEPTEMBER, [a], [], settingsMorningOne(), {}, undefined, null, []
  );
  const worked = Object.values(solved.assignments.A ?? {}).some(shift => shift !== 'OFF');
  assert.equal(worked, true, 'the global flag must not lock A in September');
});

test('next month: reconciliation does not treat a globally-flagged person as locked', () => {
  const a = lockedPerson('A');
  const reconciled = reconcileStaffingCoverage(
    { A: { 1: 'OFF' } },
    [a],
    settingsMorningOne(),
    oneDayCalendar(1),
    ['nurse'],
    [], // no monthly lock
    []
  );
  assert.notEqual(reconciled.assignments.A[1], 'OFF', 'A is fillable in an unlocked month');
});

test('next month: optimizer merge does not treat a globally-flagged person as locked', () => {
  const a = lockedPerson('A');
  const merged = mergeOptimizerAssignments(
    { A: { 1: 'OFF' } },
    { A: { 1: 'M' } },
    [a],
    'nurse',
    [] // no monthly lock
  );
  assert.equal(merged.A[1], 'M', 'A is optimizable in an unlocked month');
});

test('next month: manual facade does not reject a globally-flagged person in an unlocked month', async () => {
  const a = lockedPerson('A');
  const result = await applyManualShiftChangeFacade(
    {
      personnelId: 'A', day: 1, shift: 'M', year: YEAR, month: SEPTEMBER,
      currentSchedule: scheduleWith({ A: { 1: 'OFF' } }),
      personnel: [a], requests: [], settings: settingsMorningOne(),
      holidays: {}, firstDayOfWeek: undefined,
      lockState: { finalizedNursesMonths: [], finalizedAssistantsMonths: [], lockedRows: [] },
    },
    verifyCoverageAndLeaders,
    { saveSchedule: async () => undefined },
    'dept'
  );
  assert.equal(result.success, true, 'the global flag alone must not block a manual edit');
});

// ============================================================================
// Test 3 — independent monthly locks
// ============================================================================

test('independent locks: August and September lock sets are independent', () => {
  const a = makePerson('A');
  const augustLocked = solveNursingSchedule(
    YEAR, AUGUST, [a], [], settingsMorningOne(), {}, undefined, null, ['A']
  );
  const septemberLocked = solveNursingSchedule(
    YEAR, SEPTEMBER, [a], [], settingsMorningOne(), {}, undefined, null, ['A']
  );
  const septemberUnlocked = solveNursingSchedule(
    YEAR, SEPTEMBER, [a], [], settingsMorningOne(), {}, undefined, null, []
  );

  const locked = Object.values(augustLocked.assignments.A ?? {}).every(shift => shift === 'OFF');
  const lockedSep = Object.values(septemberLocked.assignments.A ?? {}).every(shift => shift === 'OFF');
  const unlockedSep = Object.values(septemberUnlocked.assignments.A ?? {}).some(shift => shift !== 'OFF');

  assert.equal(locked, true, 'August locked');
  assert.equal(lockedSep, true, 'September locked independently');
  assert.equal(unlockedSep, true, 'changing September does not change August');
});

// ============================================================================
// Test 4 — month switching
// ============================================================================

test('month switching: August lock survives an August→September→August round trip', () => {
  const a = makePerson('A');
  // August locked.
  const august1 = solveNursingSchedule(
    YEAR, AUGUST, [a], [], settingsMorningOne(), {}, undefined, null, ['A']
  );
  // September unlocked.
  const september = solveNursingSchedule(
    YEAR, SEPTEMBER, [a], [], settingsMorningOne(), {}, undefined, null, []
  );
  // Back to August (still locked).
  const august2 = solveNursingSchedule(
    YEAR, AUGUST, [a], [], settingsMorningOne(), {}, undefined, null, ['A']
  );

  assert.equal(
    Object.values(august1.assignments.A ?? {}).every(shift => shift === 'OFF'), true
  );
  assert.equal(
    Object.values(september.assignments.A ?? {}).some(shift => shift !== 'OFF'), true
  );
  assert.equal(
    Object.values(august2.assignments.A ?? {}).every(shift => shift === 'OFF'), true
  );
});

// ============================================================================
// Test 7 — scenario generation: August locked, September available
// ============================================================================

test('scenario: same person is available in an unlocked month even with a global flag', () => {
  const a = lockedPerson('A');
  const b = makePerson('B');
  const baseline = solveNursingSchedule(
    YEAR, SEPTEMBER, [a, b], [], ALL_PERIODS_DEMAND, {}, undefined, null, []
  ).assignments;
  const result = generateAndScoreScenarios(
    YEAR, SEPTEMBER, [a, b], [], ALL_PERIODS_DEMAND, {}, undefined, null, 'nurse', baseline, []
  );
  assert.ok(result.top3.length > 0);
  // A is a free target in September, so its row may differ from the baseline
  // (i.e. A is NOT frozen by the global flag).
  const aCanChange = result.top3.some(scenario =>
    Object.entries(scenario.schedule.assignments.A ?? {}).some(
      ([day, shift]) => (baseline.A?.[Number(day)] || 'OFF') !== shift
    )
  );
  assert.equal(aCanChange, true, 'A must be mutable in an unlocked month');
});
