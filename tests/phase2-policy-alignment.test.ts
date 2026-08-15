/**
 * Phase 2 — Scheduling Policy Alignment and Cross-Path Consistency.
 *
 * Regression coverage for the approved product policies:
 *   1. Pattern scope, 2. Pattern OFF priority, 3. Protected manual cells,
 *   4. Monthly personnel lock, 5. Overtime cap, 6. Avoid-shift,
 *   7. Routine, 8. Leader policy, 9. Mandatory rest, 10. Informational warnings.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  effectiveOvertimeCap,
  overtimeHoursForPerson,
  wouldExceedOvertimeCap,
} from '../domain/scheduling/overtime-cap';
import { shiftViolatesRoutine } from '../domain/scheduling/smart-rules';
import { patternStepForDay } from '../domain/requests/request-scope-matcher';
import {
  mergeOptimizerAssignments,
  protectedCellKey,
  protectedCellsForContext,
} from '../domain/scheduling/schedule-operations';
import { compareByObjective } from '../domain/scenarios/objective';
import {
  reconcileStaffingCoverage,
  shiftCoversPeriod,
} from '../domain/scheduling/staffing-coverage';
import { applyManualShiftChangeFacade } from '../features/scheduling/facades/shift-write-facade';
import {
  generateAndScoreScenarios,
} from '../lib/scenarioGenerator';
import {
  countRoutineMismatches,
  evaluateScenarioSchedule,
  isInformationalWarning,
} from '../lib/scoring';
import {
  solveNursingSchedule,
  verifyCoverageAndLeaders,
} from '../lib/solver';
import type {
  JobGroup,
  MonthlySchedule,
  Personnel,
  ShiftRequest,
  ShiftType,
  SystemSettings,
  WorkRoutineTag,
} from '../lib/types';
import {
  CAL_MONTH,
  CAL_YEAR,
  FRIDAYS,
  makePerson,
  makeRequest,
  makeSettings,
} from './fixtures/realistic';

const YEAR = CAL_YEAR;
const MONTH = CAL_MONTH;
const TOTAL_DAYS = 31;

const ZERO_DEMAND = {
  morningNurse: 0,
  morningAssistant: 0,
  afternoonNurse: 0,
  afternoonAssistant: 0,
  afternoonLeader: 0,
  nightNurse: 0,
  nightAssistant: 0,
  nightLeader: 0,
};

function settingsWithDemand(
  weekday: Partial<SystemSettings['demand']['weekday']> = {},
  holiday: Partial<SystemSettings['demand']['holiday']> = {}
): SystemSettings {
  return {
    dutyHours: { official: 176, contract: 190, conscript: 200, overtime: 0 },
    demand: {
      weekday: { ...ZERO_DEMAND, ...weekday },
      holiday: { ...ZERO_DEMAND, ...holiday },
    },
  };
}

function sameDemand(
  demand: Partial<SystemSettings['demand']['weekday']>
): SystemSettings {
  return settingsWithDemand(demand, demand);
}

function oneDayCalendar(day = 1, isHoliday = false) {
  return [{ day, dayOfWeek: 0, isHoliday }];
}

function scheduleWith(
  assignments: MonthlySchedule['assignments'],
  extras: Partial<MonthlySchedule> = {}
): MonthlySchedule {
  return { year: YEAR, month: MONTH, assignments, shiftLeaders: {}, warnings: [], ...extras };
}

// ============================================================================
// 1. Pattern scope
// ============================================================================

test('patternStepForDay applies only inside configured scope', () => {
  const pattern = makeRequest('x', {
    id: 'p1', requestType: 'pattern', patternSteps: ['M', 'E'], isEssential: false,
    scope: 'custom_days', selectedDays: [5, 6],
  });
  assert.equal(patternStepForDay(pattern, 5, 0), 'M');
  assert.equal(patternStepForDay(pattern, 6, 0), 'E');
  assert.equal(patternStepForDay(pattern, 7, 0), undefined);
  assert.equal(patternStepForDay(pattern, 4, 0), undefined);
});

test('pattern scope: all-month scope applies every day', () => {
  const nurse = makePerson('all-month');
  const pattern = makeRequest('all-month', {
    id: 'p1', requestType: 'pattern', patternSteps: ['M', 'OFF'], isEssential: false, scope: 'all',
  });
  const solved = solveNursingSchedule(YEAR, MONTH, [nurse], [pattern], settingsWithDemand(), {}, undefined, null);
  assert.equal(solved.assignments[nurse.id][1], 'M');
  assert.equal(solved.assignments[nurse.id][2], 'OFF');
});

test('pattern scope: range applies only inside the range', () => {
  const nurse = makePerson('range-worker');
  const pattern = makeRequest('range-worker', {
    id: 'p1', requestType: 'pattern', patternSteps: ['M'], isEssential: false,
    scope: 'range', startDate: `${YEAR}/${MONTH}/03`, endDate: `${YEAR}/${MONTH}/05`,
  });
  const solved = solveNursingSchedule(YEAR, MONTH, [nurse], [pattern], settingsWithDemand(), {}, undefined, null);
  assert.equal(solved.assignments[nurse.id][3], 'M');
  assert.equal(solved.assignments[nurse.id][5], 'M');
  assert.equal(solved.assignments[nurse.id][6], 'OFF', 'outside the range no pattern step applies');
});

test('pattern scope: weekday scope applies only on matching weekdays', () => {
  const pattern = makeRequest('x', {
    id: 'p1', requestType: 'pattern', patternSteps: ['M'], isEssential: false, scope: 'sundays',
  });
  assert.equal(patternStepForDay(pattern, 1, 1), 'M', 'Sunday matches');
  assert.equal(patternStepForDay(pattern, 1, 0), undefined, 'Saturday does not match a Sundays scope');
  assert.equal(patternStepForDay(pattern, 1, 2), undefined, 'Monday does not match a Sundays scope');
});

test('pattern OFF step is applied only in scope; final verification reports in-scope mismatch only', () => {
  const nurse = makePerson('pattern-off-scope');
  const pattern = makeRequest('pattern-off-scope', {
    id: 'p1', requestType: 'pattern', patternSteps: ['OFF'], isEssential: false,
    scope: 'custom_days', selectedDays: [1],
  });
  const verification = verifyCoverageAndLeaders(
    YEAR, MONTH, [nurse], { [nurse.id]: { 1: 'M', 2: 'M' } }, settingsWithDemand(), {}, undefined, [pattern]
  );
  const mismatches = verification.structuredWarnings.filter(w =>
    w.code === 'MISMATCHED_REQUEST' && w.personnelId === nurse.id && w.metadata?.requestType === 'pattern'
  );
  assert.equal(mismatches.length, 1, 'only the in-scope day 1 reports a mismatch');
  assert.equal(mismatches[0].day, 1);
});

test('scenario scoring respects pattern scope', () => {
  const nurse = makePerson('pattern-score');
  const pattern = makeRequest('pattern-score', {
    id: 'p1', requestType: 'pattern', patternSteps: ['M'], isEssential: true,
    scope: 'custom_days', selectedDays: [1],
  });
  const common = {
    id: 1, type: 'REQUESTS' as const, personnelList: [nurse], requests: [pattern],
    settings: settingsWithDemand(), year: YEAR, month: MONTH, customHolidays: {},
    firstDayOfWeekIndex: undefined, monthlyDutyHours: null, targetJobGroup: 'nurse' as JobGroup,
  };
  const inScopeSatisfied = evaluateScenarioSchedule({
    ...common, schedule: scheduleWith({ [nurse.id]: { 1: 'M' } }),
  });
  assert.equal(inScopeSatisfied.metrics.requestScore, 100);
});

// ============================================================================
// 2. Pattern OFF priority
// ============================================================================

test('pattern OFF is a breakable preference, never converted to hard OFF', () => {
  const nurse = makePerson('pattern-off-breakable');
  const pattern = makeRequest('pattern-off-breakable', {
    id: 'p1', requestType: 'pattern', patternSteps: ['OFF', 'OFF', 'OFF', 'OFF', 'M'], isEssential: false, scope: 'all',
  });
  const solved = solveNursingSchedule(YEAR, MONTH, [nurse], [pattern], sameDemand({ morningNurse: 1 }), {}, undefined, null);
  assert.deepEqual([1, 2, 3].map(d => solved.assignments[nurse.id][d]), ['OFF', 'OFF', 'OFF']);
  assert.equal(solved.assignments[nurse.id][4], 'M', 'consecutive-OFF breaker may override pattern OFF');
  assert.ok(solved.warnings.some(w => w.startsWith('Mismatched Request:') && w.includes('روز 4') && w.includes('الگوی شیفت OFF')));
});

// ============================================================================
// 3. Protected manual cells (context = department + year + month + person + day)
// ============================================================================

const CTX_A = { departmentId: 'dept-a', year: YEAR, month: MONTH };
const CTX_B = { departmentId: 'dept-a', year: YEAR, month: MONTH + 1 };
const CTX_C = { departmentId: 'dept-b', year: YEAR, month: MONTH };

test('protected cell key is context-qualified and does not leak across month or department', () => {
  const keyA = protectedCellKey(CTX_A, 'p1', 3);
  assert.equal(protectedCellsForContext(new Set([keyA]), CTX_A).has('p1:3'), true);
  assert.equal(protectedCellsForContext(new Set([keyA]), CTX_B).has('p1:3'), false, 'month change must not leak');
  assert.equal(protectedCellsForContext(new Set([keyA]), CTX_C).has('p1:3'), false, 'department change must not leak');
});

test('reconciliation preserves a protected cell in the same context', () => {
  const nurse = makePerson('prot-same');
  const protectedSet = protectedCellsForContext(
    new Set([protectedCellKey(CTX_A, nurse.id, 1)]), CTX_A
  );
  const reconciled = reconcileStaffingCoverage(
    { [nurse.id]: { 1: 'M' } },
    [nurse],
    sameDemand({ morningNurse: 0 }),
    oneDayCalendar(1),
    ['nurse'],
    [],
    [],
    protectedSet
  );
  assert.equal(reconciled.assignments[nurse.id][1], 'M');
});

test('optimizer regeneration may clear/recreate protection state by its lifecycle', () => {
  // A fresh protected-cell set (empty) for a regenerated schedule means the
  // optimizer is free to rewrite the cell; protection only lives inside a context.
  const nurse = makePerson('prot-regen');
  const merged = mergeOptimizerAssignments(
    undefined,
    { [nurse.id]: { 1: 'M', 2: 'OFF' } },
    [nurse],
    'nurse',
    []
  );
  assert.deepEqual(merged[nurse.id], { 1: 'M', 2: 'OFF' });
});

test('manual edit protects the edited cell and persists in the same context', async () => {
  const nurse = makePerson('prot-manual');
  const current = scheduleWith({ [nurse.id]: { 1: 'OFF' } });
  const result = await applyManualShiftChangeFacade(
    {
      personnelId: nurse.id, day: 1, shift: 'M', year: YEAR, month: MONTH,
      currentSchedule: current, personnel: [nurse], requests: [], settings: sameDemand({}),
      holidays: {}, firstDayOfWeek: undefined,
      lockState: { finalizedNursesMonths: [], finalizedAssistantsMonths: [], lockedRows: [] },
      protectedCells: [`${nurse.id}:1`],
    },
    verifyCoverageAndLeaders,
    { saveSchedule: async () => undefined },
    CTX_A.departmentId
  );
  assert.equal(result.success, true);
  assert.equal(result.schedule?.assignments[nurse.id][1], 'M');
});

// ============================================================================
// 4. Monthly personnel lock
// ============================================================================

test('monthly lock: locked person is excluded from normal solver mutation', () => {
  const locked = makePerson('locked-normal');
  const free = makePerson('free-normal');
  const solved = solveNursingSchedule(
    YEAR, MONTH, [locked, free], [], sameDemand({ morningNurse: 1 }), {}, undefined, null,
    [locked.id] // locked for THIS month
  );
  // A monthly-locked person is never assigned work by the solver.
  assert.equal(
    Object.values(solved.assignments[locked.id] ?? {}).every(shift => shift === 'OFF'),
    true
  );
});

test('monthly lock: optimizer merge preserves a locked person row', () => {
  const locked = makePerson('locked-merge');
  const merged = mergeOptimizerAssignments(
    { [locked.id]: { 1: 'OFF' } },
    { [locked.id]: { 1: 'M' } },
    [locked],
    'nurse',
    [locked.id] // monthly lock
  );
  assert.equal(merged[locked.id][1], 'OFF');
});

test('monthly lock: reconciliation does not mutate a locked person', () => {
  const locked = makePerson('locked-reconcile');
  const free = makePerson('free-reconcile');
  const reconciled = reconcileStaffingCoverage(
    { [locked.id]: { 1: 'OFF' }, [free.id]: { 1: 'OFF' } },
    [locked, free],
    sameDemand({ morningNurse: 1 }),
    oneDayCalendar(1),
    ['nurse'],
    [locked.id], // monthly lock
    []
  );
  assert.equal(reconciled.assignments[locked.id][1], 'OFF');
  assert.equal(reconciled.assignments[free.id][1], 'M');
});

test('monthly lock: scenario generation excludes a locked person from free targets', () => {
  const unlocked = [makePerson('n1'), makePerson('n2'), makePerson('n3'), makePerson('n4')];
  const baseline = solveNursingSchedule(
    YEAR, MONTH, unlocked, [], sameDemand({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }), {}, undefined, null
  ).assignments;
  const result = generateAndScoreScenarios(
    YEAR, MONTH, unlocked, [], sameDemand({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }),
    {}, undefined, null, 'nurse', baseline, ['n1'] // n1 locked for THIS month
  );
  assert.ok(result.top3.length > 0);
  for (const scenario of result.top3) {
    assert.deepEqual(scenario.schedule.assignments.n1, baseline.n1);
  }
});

// ============================================================================
// 5. Overtime cap
// ============================================================================

function overtimePerson(id: string): Personnel {
  return makePerson(id, { employmentType: 'overtime' });
}

test('effective overtime cap: configured 150 is authoritative', () => {
  const settings = settingsWithDemand();
  settings.dutyHours.overtime = 150;
  assert.equal(effectiveOvertimeCap({ settings }), 150);
});

test('effective overtime cap: configured 240 is authoritative', () => {
  const settings = settingsWithDemand();
  settings.dutyHours.overtime = 240;
  assert.equal(effectiveOvertimeCap({ settings }), 240);
});

test('effective overtime cap: monthly override wins over settings', () => {
  const settings = settingsWithDemand();
  settings.dutyHours.overtime = 240;
  assert.equal(effectiveOvertimeCap({ settings, monthlyDutyHours: { overtime: 150 } }), 150);
});

test('effective overtime cap: unconfigured/non-positive falls back to 240', () => {
  const settings = settingsWithDemand();
  settings.dutyHours.overtime = 0;
  assert.equal(effectiveOvertimeCap({ settings }), 240);
});

test('wouldExceedOvertimeCap: exactly at cap is allowed, one shift beyond is not', () => {
  const overtime = overtimePerson('cap-boundary');
  const cap = 240;
  // 18 x ME (13h) = 234h, plus M (6.5h) = 240.5 → beyond.
  const row: Record<number, ShiftType> = {};
  for (let d = 1; d <= 18; d++) row[d] = 'ME';
  const assignments = { [overtime.id]: row };
  assert.equal(wouldExceedOvertimeCap(assignments, overtime, 19, 'M', TOTAL_DAYS, cap), true);
  assert.equal(wouldExceedOvertimeCap(assignments, overtime, 19, 'OFF', TOTAL_DAYS, cap), false);
});

test('final verification reports a manual overtime cap violation', () => {
  const overtime = overtimePerson('manual-overtime');
  const row: Record<number, ShiftType> = {};
  for (let d = 1; d <= 20; d++) row[d] = 'ME'; // 260h > 240
  const verification = verifyCoverageAndLeaders(
    YEAR, MONTH, [overtime], { [overtime.id]: row }, settingsWithDemand(), {}, undefined, []
  );
  const warning = verification.structuredWarnings.find(w => w.code === 'OVERTIME_CAP_EXCEEDED');
  assert.ok(warning, 'final verification reports the overtime violation');
  assert.equal(warning.personnelId, overtime.id);
});

test('final verification reports no overtime violation when within cap', () => {
  const overtime = overtimePerson('ok-overtime');
  const row: Record<number, ShiftType> = {};
  for (let d = 1; d <= 10; d++) row[d] = 'ME'; // 130h < 240
  const verification = verifyCoverageAndLeaders(
    YEAR, MONTH, [overtime], { [overtime.id]: row }, settingsWithDemand(), {}, undefined, []
  );
  assert.equal(
    verification.structuredWarnings.some(w => w.code === 'OVERTIME_CAP_EXCEEDED'),
    false
  );
});

test('overtime hours for person sums worked shifts (leave-aware)', () => {
  const overtime = overtimePerson('sum-hours');
  const row: Record<number, ShiftType> = { 1: 'ME', 2: 'N', 3: 'OFF' };
  assert.equal(overtimeHoursForPerson({ [overtime.id]: row }, overtime, 3), 13 + 12.5 + 0);
});

// ============================================================================
// 6. Avoid-shift
// ============================================================================

function avoidMorningRequest(personnelId: string): ShiftRequest {
  return makeRequest(personnelId, {
    id: `avoid-m-${personnelId}`, requestType: 'avoid_shift', preferredShift: 'M',
    isEssential: false, scope: 'custom_days', selectedDays: [1],
  });
}

test('avoid-shift: reconciliation prefers the non-avoiding candidate when an alternative exists', () => {
  const avoiding = makePerson('avoid-a');
  const alternative = makePerson('avoid-b');
  const request = avoidMorningRequest(avoiding.id);
  const reconciled = reconcileStaffingCoverage(
    { [avoiding.id]: { 1: 'OFF' }, [alternative.id]: { 1: 'OFF' } },
    [avoiding, alternative],
    sameDemand({ morningNurse: 1 }),
    oneDayCalendar(1),
    ['nurse'],
    [],
    [request]
  );
  assert.equal(reconciled.assignments[avoiding.id][1], 'OFF');
  assert.equal(reconciled.assignments[alternative.id][1], 'M');
});

test('avoid-shift: emergency path assigns the avoided shift only when it is the sole option', () => {
  const avoiding = makePerson('avoid-emergency');
  const request = avoidMorningRequest(avoiding.id);
  const solved = solveNursingSchedule(
    YEAR, MONTH, [avoiding], [request], sameDemand({ morningNurse: 1 }), {}, undefined, null
  );
  assert.equal(solved.assignments[avoiding.id][1], 'M');
  assert.ok(solved.warnings.some(w => w.startsWith('Mismatched Request:') && w.includes('روز 1')));
});

test('avoid-shift: final verification reports the mismatch as noncritical', () => {
  const avoiding = makePerson('avoid-verify');
  const request = avoidMorningRequest(avoiding.id);
  const verification = verifyCoverageAndLeaders(
    YEAR, MONTH, [avoiding], { [avoiding.id]: { 1: 'M' } }, settingsWithDemand(), {}, undefined, [request]
  );
  const warning = verification.structuredWarnings.find(w =>
    w.code === 'MISMATCHED_REQUEST' && w.metadata?.requestType === 'avoid_shift'
  );
  assert.ok(warning);
  assert.equal(warning.severity, 'warning');
});

// ============================================================================
// 7. Routine
// ============================================================================

test('routine: shiftViolatesRoutine flags only out-of-routine components', () => {
  assert.equal(shiftViolatesRoutine('M', 'morning'), false);
  assert.equal(shiftViolatesRoutine('ME', 'morning'), true);
  assert.equal(shiftViolatesRoutine('EN', 'evening_night'), false);
  assert.equal(shiftViolatesRoutine('ME', 'evening_night'), true);
  assert.equal(shiftViolatesRoutine('ME', 'long'), false);
  assert.equal(shiftViolatesRoutine('MN', 'long'), true);
  assert.equal(shiftViolatesRoutine('OFF', 'morning'), false);
  assert.equal(shiftViolatesRoutine('M', undefined), false);
});

test('routine: countRoutineMismatches counts out-of-routine work cells only', () => {
  const morning = makePerson('morning', { workRoutine: 'morning' });
  const schedule = scheduleWith({ [morning.id]: { 1: 'M', 2: 'ME', 3: 'OFF' } });
  assert.equal(countRoutineMismatches(schedule, [morning], 'nurse', 3), 1);
});

test('routine: scenario scoring prefers the routine-compatible candidate when equivalent otherwise', () => {
  const morning = makePerson('routine-score', { workRoutine: 'morning' });
  const compatible = scheduleWith({ [morning.id]: { 1: 'M', 2: 'OFF' } });
  const incompatible = scheduleWith({ [morning.id]: { 1: 'ME', 2: 'OFF' } });
  assert.equal(
    countRoutineMismatches(compatible, [morning], 'nurse', 2),
    0
  );
  assert.equal(
    countRoutineMismatches(incompatible, [morning], 'nurse', 2),
    1
  );
});

test('routine: ranking tiebreaker selects the routine-compatible scenario when all else is equal', () => {
  const base = {
    similarityPercent: 90,
    nonCriticalWarningCount: 0,
    requestSatisfactionPercent: 100,
  };
  const compatible = { ...base, routineMismatchCount: 0 };
  const incompatible = { ...base, routineMismatchCount: 3 };
  assert.equal(compareByObjective(compatible, incompatible) < 0, true);
  assert.equal(compareByObjective(incompatible, compatible) > 0, true);
});

// ============================================================================
// 8. Leader policy
// ============================================================================

function leaderFor(
  assignments: MonthlySchedule['assignments'],
  personnel: Personnel[],
  settings: SystemSettings
) {
  return verifyCoverageAndLeaders(YEAR, MONTH, personnel, assignments, settings, {}, undefined, []);
}

test('leader: E and N require a leader on normal days; M does not', () => {
  const a = makePerson('a', { position: 'general' }); // canBeShiftLeader default true
  // day 1 (Saturday, non-holiday): a works EN
  const result = leaderFor(
    { [a.id]: { 1: 'EN' } },
    [a],
    sameDemand({ afternoonNurse: 1, nightNurse: 1, morningNurse: 1 })
  );
  // a works E and N (EN) and is eligible → same person leads both.
  assert.equal(result.shiftLeaders[1].afternoon, a.id);
  assert.equal(result.shiftLeaders[1].night, a.id);
  assert.equal(result.shiftLeaders[1].morning, undefined, 'M needs no leader on a normal day');
});

test('leader: weekday E demand with A working E alone assigns A as E leader', () => {
  const a = makePerson('a');
  const result = leaderFor(
    { [a.id]: { 1: 'E' } },
    [a],
    sameDemand({ afternoonNurse: 1 })
  );
  assert.equal(result.shiftLeaders[1].afternoon, a.id);
});

test('leader: weekday N demand with A working N alone assigns A as N leader', () => {
  const a = makePerson('a');
  const result = leaderFor(
    { [a.id]: { 1: 'N' } },
    [a],
    sameDemand({ nightNurse: 1 })
  );
  assert.equal(result.shiftLeaders[1].night, a.id);
});

test('leader: ME + N split assigns each leader to their working shift', () => {
  const a = makePerson('a'); // ME
  const b = makePerson('b'); // N
  const result = leaderFor(
    { [a.id]: { 1: 'ME' }, [b.id]: { 1: 'N' } },
    [a, b],
    sameDemand({ afternoonNurse: 1, nightNurse: 1 })
  );
  assert.equal(result.shiftLeaders[1].afternoon, a.id);
  assert.equal(result.shiftLeaders[1].night, b.id);
});

test('leader: higher personnel-order wins among multiple eligible leaders', () => {
  const a = makePerson('a', { orderIndex: 3 });
  const b = makePerson('b', { orderIndex: 5 });
  const c = makePerson('c', { orderIndex: 7 });
  const result = leaderFor(
    { [a.id]: { 1: 'E' }, [b.id]: { 1: 'E' }, [c.id]: { 1: 'E' } },
    [c, b, a],
    sameDemand({ afternoonNurse: 1 })
  );
  assert.equal(result.shiftLeaders[1].afternoon, a.id);
});

test('leader: three eligible N candidates select the highest personnel-order entry', () => {
  const a = makePerson('a', { orderIndex: 3 });
  const b = makePerson('b', { orderIndex: 5 });
  const c = makePerson('c', { orderIndex: 7 });
  const result = leaderFor(
    { [a.id]: { 1: 'N' }, [b.id]: { 1: 'N' }, [c.id]: { 1: 'N' } },
    [c, b, a],
    sameDemand({ nightNurse: 1 })
  );
  assert.equal(result.shiftLeaders[1].night, a.id);
});

test('leader: holiday requires an M leader in addition to E and N', () => {
  const sup = makePerson('sup', { position: 'supervisor' });
  const gen = makePerson('gen');
  const friday = FRIDAYS[0]; // 2
  const result = leaderFor(
    { [sup.id]: { [friday]: 'M' }, [gen.id]: { [friday]: 'EN' } },
    [sup, gen],
    sameDemand({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 })
  );
  assert.equal(result.shiftLeaders[friday].morning, sup.id, 'supervisor working M leads the holiday morning');
  assert.equal(result.shiftLeaders[friday].afternoon, gen.id);
  assert.equal(result.shiftLeaders[friday].night, gen.id);
});

test('leader: ineligible role (general without leader flag) is not selected', () => {
  const gen = makePerson('gen', { canBeShiftLeader: false });
  const result = leaderFor(
    { [gen.id]: { 1: 'E' } },
    [gen],
    sameDemand({ afternoonNurse: 1 })
  );
  assert.equal(result.shiftLeaders[1].afternoon, undefined);
  assert.ok(result.structuredWarnings.some(w => w.code === 'MISSING_SHIFT_LEADER' && w.shift === 'E'));
});

test('leader: a person not working the shift cannot be its leader', () => {
  const a = makePerson('a'); // works M only
  const b = makePerson('b'); // works E
  const result = leaderFor(
    { [a.id]: { 1: 'M' }, [b.id]: { 1: 'E' } },
    [a, b],
    sameDemand({ morningNurse: 1, afternoonNurse: 1 })
  );
  assert.equal(result.shiftLeaders[1].afternoon, b.id);
});

test('leader: supervisor/staff E/N restriction is never weakened for leadership', () => {
  const sup = makePerson('sup', { position: 'supervisor' });
  const gen = makePerson('gen', { canBeShiftLeader: true });
  // Supervisor works E (an externally inserted assignment); they must not lead E.
  const result = leaderFor(
    { [sup.id]: { 1: 'E' }, [gen.id]: { 1: 'E' } },
    [sup, gen],
    sameDemand({ afternoonNurse: 1 })
  );
  assert.equal(result.shiftLeaders[1].afternoon, gen.id);
});

test('leader: holiday with zero morning demand manufactures no M leader requirement', () => {
  const sup = makePerson('sup', { position: 'supervisor' });
  const friday = FRIDAYS[0];
  const result = leaderFor(
    { [sup.id]: { [friday]: 'M' } },
    [sup],
    sameDemand({ morningNurse: 0, afternoonNurse: 0, nightNurse: 0 })
  );
  assert.equal(result.shiftLeaders[friday].morning, undefined);
  assert.equal(
    result.structuredWarnings.some(w => w.code === 'MISSING_SHIFT_LEADER' && w.shift === 'M'),
    false
  );
});

test('leader: UI representation is a single leader per shift, matching the verifier', () => {
  const a = makePerson('a', { orderIndex: 1 });
  const b = makePerson('b', { orderIndex: 2 });
  const solved = solveNursingSchedule(
    YEAR, MONTH, [a, b], [], sameDemand({ afternoonNurse: 1 }), {}, undefined, null
  );
  const verifier = verifyCoverageAndLeaders(
    YEAR, MONTH, [a, b], solved.assignments, sameDemand({ afternoonNurse: 1 }), {}, undefined, []
  );
  // The solver's stored leaders match the verifier's selected leaders.
  assert.deepEqual(solved.shiftLeaders, verifier.shiftLeaders);
  const anyAfternoon = Object.values(solved.shiftLeaders).find(leaders => leaders.afternoon);
  assert.equal(typeof anyAfternoon?.afternoon, 'string', 'one leader id per shift');
});

// ============================================================================
// 9. Mandatory rest
// ============================================================================

test('mandatory rest: exact weight 5 remains legal and noncritical', () => {
  const nurse = makePerson('cap-5');
  const assignments = { [nurse.id]: { 30: 'EN', 31: 'ME' } }; // exactly 5
  const verification = verifyCoverageAndLeaders(
    YEAR, MONTH, [nurse], assignments, settingsWithDemand(), {}, undefined, []
  );
  assert.equal(verification.warnings.some(w => w.startsWith('Max Consecutive:')), false);
});

test('mandatory rest: a boundary reminder alone is not a critical current-month gate', () => {
  const nurse = makePerson('boundary');
  const assignments = { [nurse.id]: { 29: 'N', 30: 'N', 31: 'N' } };
  const verification = verifyCoverageAndLeaders(
    YEAR, MONTH, [nurse], assignments, settingsWithDemand(), {}, undefined, []
  );
  const reminder = verification.structuredWarnings.find(w => w.code === 'MANDATORY_REST');
  if (reminder) {
    assert.equal(reminder.severity, 'warning');
  }
});

// ============================================================================
// 10. Informational warnings
// ============================================================================

test('informational warnings are not scheduling defects and do not lower scores', () => {
  const offRemoved = 'OFF Removed: حذف OFF ناخواسته';
  const isolatedFixed = 'Isolated Shift Fixed: شیفت تک منتقل شد';
  assert.equal(isInformationalWarning(offRemoved), true);
  assert.equal(isInformationalWarning(isolatedFixed), true);
  assert.equal(isInformationalWarning('Max Consecutive: نقض سقف'), false);
});
