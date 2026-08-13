import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_CONSECUTIVE_SHIFTS,
  evaluatePostHeavyOffPreference,
  findConsecutiveRuns,
  getShiftWorkload,
  wouldBreachConsecutiveCap,
  wouldViolateNightRest,
} from '../domain/scheduling/workload';
import {
  ALL_HARD_RULES,
  COVERAGE_FILL_HARD_RULES,
  evaluateHardConstraintLegality,
  resolveLegalShiftForRequest,
} from '../domain/scheduling/hard-constraints';
import { reconcileStaffingCoverage, shiftCoversPeriod } from '../domain/scheduling/staffing-coverage';
import { solveNursingSchedule, verifyCoverageAndLeaders } from '../lib/solver';
import { generateCriticalRepairEdits, type VerifiedSchedule } from '../lib/scenarioGenerator';
import { createScheduleWarning } from '../domain/warnings/schedule-warning';
import type { Personnel, ShiftRequest, SystemSettings } from '../lib/types';
import { CAL_MONTH, CAL_YEAR, makePerson, makeRequest, makeSettings } from './fixtures/realistic';

const TOTAL_DAYS = 31;

function decision(person: Personnel, assignments: Record<string, Record<number, string>>, day: number, candidateShift: string) {
  return {
    person,
    day,
    dayOfWeek: 0,
    isHoliday: false,
    candidateShift,
    assignments,
    totalDays: TOTAL_DAYS,
    requests: [] as ShiftRequest[],
  };
}

function noDemand(): SystemSettings {
  return makeSettings(
    { morningNurse: 0, afternoonNurse: 0, nightNurse: 0 },
    { morningNurse: 0, afternoonNurse: 0, nightNurse: 0 }
  );
}

// ---------------------------------------------------------------------------
// Authoritative workload model
// ---------------------------------------------------------------------------

test('workload engine: M-only calendar days remain separate runs; a true six-unit run is illegal', () => {
  assert.equal(MAX_CONSECUTIVE_SHIFTS, 5);
  const mOnly = { p: { 1: 'M', 2: 'M', 3: 'M', 4: 'M', 5: 'M' } };
  assert.equal(wouldBreachConsecutiveCap(mOnly, 'p', 6, 'M', TOTAL_DAYS), false, 'M-only days are split by empty E/N slots');

  // Session 5 clarification: M×6 remains legal under the preserved slot model;
  // MEN→ME is the canonical contiguous six-unit case.
  assert.equal(wouldBreachConsecutiveCap({ p: { 1: 'MEN' } }, 'p', 2, 'ME', TOTAL_DAYS), true);
});

test('workload engine: MEN→M is legal and MEN→ME is illegal', () => {
  const assignments = { p: { 1: 'MEN' } };
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p', 2, 'M', TOTAL_DAYS), false);
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p', 2, 'ME', TOTAL_DAYS), true);
});

test('workload engine: requested N combinations obey only the cap arithmetic', () => {
  const legal: Array<[string, Record<number, string>, string]> = [
    ['N→M', { 1: 'N' }, 'M'],
    ['N→E', { 1: 'N' }, 'E'],
    ['EN→M', { 1: 'EN' }, 'M'],
    ['N→EN', { 1: 'N' }, 'EN'],
    ['EN→E', { 1: 'EN' }, 'E'],
    ['MEN→M', { 1: 'MEN' }, 'M'],
  ];
  for (const [label, assignments, candidate] of legal) {
    assert.equal(wouldBreachConsecutiveCap({ p: assignments }, 'p', 2, candidate, TOTAL_DAYS), false, `${label} must stay legal at or below the cap`);
  }

  const illegal: Array<[string, Record<number, string>, string]> = [
    ['MEN→ME', { 1: 'MEN' }, 'ME'],
    ['N→MEN', { 1: 'N' }, 'MEN'],
  ];
  for (const [label, assignments, candidate] of illegal) {
    assert.equal(wouldBreachConsecutiveCap({ p: assignments }, 'p', 2, candidate, TOTAL_DAYS), true, `${label} must exceed the cap`);
  }
});

test('workload engine: N weighs two and MN has separated runs', () => {
  assert.equal(getShiftWorkload('N'), 2);
  assert.equal(getShiftWorkload('MEN'), 4);
  assert.equal(getShiftWorkload('unknown-shift'), null, 'unknown shifts never receive an invented workload');
  const unknown = evaluateHardConstraintLegality(
    decision(makePerson('p'), { p: { 1: 'OFF' } }, 1, 'unknown-shift'),
    ALL_HARD_RULES
  );
  assert.equal(unknown.legal, false);
  assert.ok(unknown.violations.includes('UNKNOWN_SHIFT'));
  assert.deepEqual(findConsecutiveRuns({ p: { 1: 'MN' } }, 'p', TOTAL_DAYS), [
    { startDay: 1, endDay: 1, startPeriod: 'M', endPeriod: 'M', length: 1, slotCount: 1 },
    { startDay: 1, endDay: 1, startPeriod: 'N', endPeriod: 'N', length: 2, slotCount: 1 },
  ]);
});

test('workload engine: candidate cap checks both backward and forward workload', () => {
  assert.equal(
    wouldBreachConsecutiveCap({ p: { 1: 'MEN' } }, 'p', 2, 'ME', TOTAL_DAYS),
    true,
    'backward contiguous workload is included'
  );
  assert.equal(
    wouldBreachConsecutiveCap({ p: { 1: 'N', 3: 'M' } }, 'p', 2, 'MEN', TOTAL_DAYS),
    true,
    'already-filled forward workload is included'
  );
});

// ---------------------------------------------------------------------------
// Shared night-rest evaluator
// ---------------------------------------------------------------------------

test('reconcile leaves coverage unresolved rather than breaching the workload cap', () => {
  const person = makePerson('p');
  const settings = makeSettings(
    { morningNurse: 1, afternoonNurse: 1, nightNurse: 0 },
    { morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }
  );
  const result = reconcileStaffingCoverage(
    { p: { 1: 'MEN', 2: 'M' } },
    [person],
    settings,
    [
      { day: 1, dayOfWeek: 0, isHoliday: true },
      { day: 2, dayOfWeek: 1, isHoliday: false },
    ],
    ['nurse'], [], []
  );
  assert.equal(result.assignments.p[2], 'M');
  assert.ok(result.unresolvedGaps.some(gap => gap.day === 2 && gap.shift === 'E'), 'MEN→ME would be six units and must remain unresolved');
});

test('hard evaluator: third N-bearing day is illegal, but M after N is legal', () => {
  const person = makePerson('p');
  const nightAssignments = { p: { 1: 'N', 2: 'EN', 3: 'OFF' } };
  assert.equal(wouldViolateNightRest(nightAssignments, 'p', 3, 'MN'), 'CONSECUTIVE_NIGHTS');
  const threeNights = evaluateHardConstraintLegality(
    decision(person, nightAssignments, 3, 'MN'),
    ALL_HARD_RULES
  );
  assert.equal(threeNights.legal, false);
  assert.ok(threeNights.violations.includes('NIGHT_REST_CONSECUTIVE_NIGHTS'));

  const afterEN = evaluateHardConstraintLegality(
    decision(person, { p: { 1: 'EN', 2: 'OFF' } }, 2, 'M'),
    ALL_HARD_RULES
  );
  assert.equal(afterEN.legal, true, 'EN→M is legal when the workload cap is not exceeded');
  assert.ok(!afterEN.violations.includes('MAX_CONSECUTIVE'));
  assert.ok(!afterEN.violations.some(violation => violation.startsWith('NIGHT_REST')));

  const explicitM = resolveLegalShiftForRequest(
    { person, day: 2, dayOfWeek: 0, isHoliday: false, assignments: { p: { 1: 'N', 2: 'OFF' } }, totalDays: TOTAL_DAYS, requests: [] },
    'M'
  );
  assert.equal(explicitM.shift, 'M', 'explicit M after N is legal under the shared evaluator');
});

test('hard evaluator: MEN→M is legal in both workload and shared hard evaluation', () => {
  const person = makePerson('p');
  const assignments = { p: { 1: 'MEN', 2: 'OFF' } };
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p', 2, 'M', TOTAL_DAYS), false);
  const result = evaluateHardConstraintLegality(decision(person, assignments, 2, 'M'), ALL_HARD_RULES);
  assert.equal(result.legal, true);
  assert.deepEqual(result.violations, []);
});

// ---------------------------------------------------------------------------
// Supervisor/Staff E/N hard rule across writers
// ---------------------------------------------------------------------------

test('hard evaluator: supervisor and staff cannot receive E or N', () => {
  for (const position of ['supervisor', 'staff'] as const) {
    const person = makePerson(position, { position });
    for (const shift of ['E', 'N'] as const) {
      const result = evaluateHardConstraintLegality(decision(person, { [person.id]: { 1: 'OFF' } }, 1, shift), ALL_HARD_RULES);
      assert.equal(result.legal, false, `${position} ${shift}`);
      assert.ok(result.violations.includes('MORNING_ONLY'));
    }
  }
});

test('explicit request cannot bypass Supervisor/Staff E/N hard restriction', () => {
  const supervisor = makePerson('sup', { position: 'supervisor' });
  const requests = [makeRequest('sup', {
    id: 'sup-e', requestType: 'shift', preferredShift: 'E', isEssential: true,
    scope: 'custom_days', selectedDays: [1],
  })];
  const solved = solveNursingSchedule(CAL_YEAR, CAL_MONTH, [supervisor], requests, noDemand(), {}, undefined, null);
  assert.equal(shiftCoversPeriod(solved.assignments.sup?.[1], 'E'), false);
  assert.ok(solved.warnings.some(w => w.startsWith('Hard Constraint Conflict:')));
});

test('pattern request cannot bypass Supervisor/Staff E/N hard restriction', () => {
  const staff = makePerson('staff', { position: 'staff' });
  const requests = [makeRequest('staff', {
    id: 'staff-pattern', requestType: 'pattern', patternSteps: ['EN'], isEssential: true, scope: 'all',
  })];
  const solved = solveNursingSchedule(CAL_YEAR, CAL_MONTH, [staff], requests, noDemand(), {}, undefined, null);
  for (let day = 1; day <= TOTAL_DAYS; day++) {
    assert.equal(shiftCoversPeriod(solved.assignments.staff?.[day], 'E'), false, `pattern E day ${day}`);
    assert.equal(shiftCoversPeriod(solved.assignments.staff?.[day], 'N'), false, `pattern N day ${day}`);
  }
  assert.ok(solved.warnings.some(w => w.startsWith('Hard Constraint Conflict:')));
});

test('reconcile and emergency fill cannot bypass Supervisor/Staff E/N hard restriction', () => {
  const staff = makePerson('staff', { position: 'staff' });
  const reconciled = reconcileStaffingCoverage(
    { staff: { 1: 'OFF' } },
    [staff],
    makeSettings({ morningNurse: 0, afternoonNurse: 1, nightNurse: 1 }, { morningNurse: 0, afternoonNurse: 1, nightNurse: 1 }),
    [{ day: 1, dayOfWeek: 0, isHoliday: false }],
    ['nurse'], [], []
  );
  assert.equal(reconciled.assignments.staff[1], 'OFF');
  assert.equal(reconciled.unresolvedGaps.length, 2);

  const supervisor = makePerson('sup', { position: 'supervisor' });
  const emergency = solveNursingSchedule(
    CAL_YEAR,
    CAL_MONTH,
    [supervisor],
    [],
    makeSettings({ morningNurse: 0, afternoonNurse: 0, nightNurse: 1 }, { morningNurse: 0, afternoonNurse: 0, nightNurse: 1 }),
    {},
    undefined,
    null
  );
  for (let day = 1; day <= TOTAL_DAYS; day++) {
    assert.equal(shiftCoversPeriod(emergency.assignments.sup?.[day], 'N'), false, `emergency day ${day}`);
  }
  assert.ok(emergency.warnings.some(w => w.startsWith('Coverage Shortage:')));
});

test('final verification detects externally inserted Supervisor/Staff E/N assignments', () => {
  const supervisor = makePerson('sup', { position: 'supervisor' });
  const staff = makePerson('staff', { position: 'staff' });
  const verified = verifyCoverageAndLeaders(
    CAL_YEAR,
    CAL_MONTH,
    [supervisor, staff],
    { sup: { 1: 'E' }, staff: { 1: 'N' } },
    noDemand(),
    {},
    undefined,
    []
  );
  const violations = verified.structuredWarnings.filter(w => w.code === 'SUPERVISOR_STAFF_EN_RESTRICTION');
  assert.equal(violations.length, 2);
  assert.deepEqual(violations.map(w => w.personnelId).sort(), ['staff', 'sup']);
});

test('final verification detects a third N-bearing day but not M after N', () => {
  const person = makePerson('p');
  const verified = verifyCoverageAndLeaders(
    CAL_YEAR,
    CAL_MONTH,
    [person],
    { p: { 1: 'N', 2: 'EN', 3: 'MN', 5: 'N', 6: 'M' } },
    noDemand(),
    {},
    undefined,
    []
  );
  const nightWarnings = verified.structuredWarnings.filter(w => w.code === 'NIGHT_REST');
  assert.ok(nightWarnings.some(w => w.day === 3), 'third N-bearing day is reported');
  assert.ok(!nightWarnings.some(w => w.day === 6), 'M after N must not produce a night-rest warning');
});

// ---------------------------------------------------------------------------
// Post-heavy OFF is a preference, never legality
// ---------------------------------------------------------------------------

test('post-heavy OFF preference is workload-derived and does not make work illegal', () => {
  const person = makePerson('p');
  const assignments = { p: { 1: 'N', 2: 'OFF' } };
  const preference = evaluatePostHeavyOffPreference(assignments, 'p', 2);
  assert.equal(preference.preferOff, true);
  assert.equal(preference.previousWorkload, 2);
  assert.equal(evaluatePostHeavyOffPreference({ p: { 1: 'MN' } }, 'p', 2).preferOff, true, 'MN is heavy from authoritative component workload');

  const legalE = evaluateHardConstraintLegality(decision(person, assignments, 2, 'E'), ALL_HARD_RULES);
  const legalM = evaluateHardConstraintLegality(decision(person, assignments, 2, 'M'), ALL_HARD_RULES);
  assert.equal(legalE.legal, true, 'E after N is legal');
  assert.equal(legalM.legal, true, 'post-heavy preference must not make N→M illegal');
});

test('coverage and explicit request may legally override post-heavy OFF preference', () => {
  const person = makePerson('p');
  const settings = makeSettings(
    { morningNurse: 0, afternoonNurse: 1, nightNurse: 0 },
    { morningNurse: 0, afternoonNurse: 0, nightNurse: 1 }
  );
  const alternate = makePerson('alternate');
  const preferredOff = reconcileStaffingCoverage(
    { p: { 1: 'N', 2: 'OFF' }, alternate: { 1: 'OFF', 2: 'OFF' } },
    [person, alternate],
    settings,
    [
      { day: 1, dayOfWeek: 0, isHoliday: true },
      { day: 2, dayOfWeek: 1, isHoliday: false },
    ],
    ['nurse'], [], []
  );
  assert.ok(shiftCoversPeriod(preferredOff.assignments.alternate[2], 'E'), 'a non-post-heavy legal candidate ranks ahead of the post-heavy one');

  const reconciled = reconcileStaffingCoverage(
    { p: { 1: 'N', 2: 'OFF' } },
    [person],
    settings,
    [
      { day: 1, dayOfWeek: 0, isHoliday: true },
      { day: 2, dayOfWeek: 1, isHoliday: false },
    ],
    ['nurse'], [], []
  );
  assert.ok(shiftCoversPeriod(reconciled.assignments.p[2], 'E'), 'coverage may choose the only legal post-heavy candidate');

  const explicit = resolveLegalShiftForRequest(
    {
      person,
      day: 2,
      dayOfWeek: 1,
      isHoliday: false,
      assignments: { p: { 1: 'N', 2: 'OFF' } },
      totalDays: TOTAL_DAYS,
      requests: [],
    },
    'E'
  );
  assert.equal(explicit.shift, 'E', 'explicit E request is not rejected for post-heavy preference');
});

test('scenario repair does not propose a hard-illegal Supervisor/Staff E/N edit', () => {
  const supervisor = makePerson('sup', { position: 'supervisor', canBeShiftLeader: true });
  const warning = createScheduleWarning({
    code: 'COVERAGE_SHORTAGE',
    message: 'Coverage Shortage: synthetic',
    day: 1,
    shift: 'E',
    jobGroup: 'nurse',
  });
  const schedule: VerifiedSchedule = {
    year: CAL_YEAR,
    month: CAL_MONTH,
    assignments: { sup: { 1: 'OFF' } },
    shiftLeaders: {},
    warnings: [warning.message],
    structuredWarnings: [warning],
  };
  const edits = generateCriticalRepairEdits(schedule, {
    freeTargetPersonnel: [supervisor],
    totalDays: TOTAL_DAYS,
    requests: [],
    calendarDays: [{ day: 1, dayOfWeek: 0, isHoliday: false }],
  });
  assert.deepEqual(edits, []);
});

// ---------------------------------------------------------------------------
// Cross-path consistency for one hard-illegal candidate
// ---------------------------------------------------------------------------

test('shared hard result is consistent across normal, reconcile, emergency, and explicit paths', () => {
  const supervisor = makePerson('sup', { position: 'supervisor' });
  const direct = evaluateHardConstraintLegality(
    decision(supervisor, { sup: { 1: 'OFF' } }, 1, 'E'),
    COVERAGE_FILL_HARD_RULES
  );
  assert.deepEqual(direct.violations, ['MORNING_ONLY']);

  const reconciled = reconcileStaffingCoverage(
    { sup: { 1: 'OFF' } },
    [supervisor],
    makeSettings({ morningNurse: 0, afternoonNurse: 1, nightNurse: 0 }, { morningNurse: 0, afternoonNurse: 1, nightNurse: 0 }),
    [{ day: 1, dayOfWeek: 0, isHoliday: false }],
    ['nurse'], [], []
  );
  assert.equal(reconciled.assignments.sup[1], 'OFF');

  const explicit = resolveLegalShiftForRequest(
    { person: supervisor, day: 1, dayOfWeek: 0, isHoliday: false, assignments: { sup: { 1: 'OFF' } }, totalDays: TOTAL_DAYS, requests: [] },
    'E'
  );
  assert.equal(explicit.shift, null);
  assert.equal(explicit.blockedBy, 'MORNING_ONLY');

  const normalAndEmergency = solveNursingSchedule(
    CAL_YEAR,
    CAL_MONTH,
    [supervisor],
    [],
    makeSettings({ morningNurse: 0, afternoonNurse: 1, nightNurse: 0 }, { morningNurse: 0, afternoonNurse: 1, nightNurse: 0 }),
    {},
    undefined,
    null
  );
  for (let day = 1; day <= TOTAL_DAYS; day++) {
    assert.equal(shiftCoversPeriod(normalAndEmergency.assignments.sup?.[day], 'E'), false, `normal/emergency day ${day}`);
  }
});
