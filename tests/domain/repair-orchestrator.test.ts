import assert from 'node:assert/strict';
import test from 'node:test';

import { repairScheduleBeforeWarnings } from '../../domain/scheduling/repair-orchestrator';
import { shiftCoversPeriod } from '../../domain/scheduling/staffing-coverage';
import { findConsecutiveCapViolations } from '../../domain/scheduling/workload';
import { solveNursingSchedule, verifyCoverageAndLeaders } from '../../lib/solver';
import { applyManualShiftChangeFacade } from '../../features/scheduling/facades/shift-write-facade';
import type { MonthlySchedule, Personnel, ShiftRequest, SystemSettings } from '../../lib/types';
import { CAL_MONTH, CAL_YEAR, makePerson, makeRequest, makeSettings } from '../fixtures/realistic';

const TOTAL_DAYS = 31;

function calendar(days: number) {
  return Array.from({ length: days }, (_, index) => ({
    day: index + 1,
    dayOfWeek: index % 7,
    isHoliday: false,
  }));
}

function zeroDemand(): SystemSettings {
  return makeSettings(
    { morningNurse: 0, afternoonNurse: 0, nightNurse: 0 },
    { morningNurse: 0, afternoonNurse: 0, nightNurse: 0 }
  );
}

function allPeriodsDemand(): SystemSettings {
  return makeSettings(
    { morningNurse: 1, afternoonNurse: 1, nightNurse: 1 },
    { morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }
  );
}

// ---------------------------------------------------------------------------
// Workload-cap repair before warning creation
// ---------------------------------------------------------------------------

test('repair orchestrator repairs a >5 workload run through a legal coverage alternative', () => {
  const p1 = makePerson('p1');
  const p2 = makePerson('p2');
  const result = repairScheduleBeforeWarnings({
    assignments: { p1: { 1: 'MEN', 2: 'ME' }, p2: { 1: 'OFF', 2: 'OFF' } },
    personnelList: [p1, p2],
    settings: allPeriodsDemand(),
    calendarDays: calendar(2),
    requests: [],
  });

  assert.ok(result.repairs.some(repair => repair.code === 'MAX_CONSECUTIVE'));
  assert.equal(result.assignments.p1[2], 'M', 'the trailing E is removed from MEN→ME');
  assert.ok(shiftCoversPeriod(result.assignments.p2[2], 'E'), 'reconcile supplies the removed coverage legally');
  assert.deepEqual(findConsecutiveCapViolations(result.assignments, 'p1', TOTAL_DAYS), []);
  assert.deepEqual(findConsecutiveCapViolations(result.assignments, 'p2', TOTAL_DAYS), [], 'repair must not move the cap violation to another person');
  assert.equal(result.unresolved.some(violation => violation.code === 'MAX_CONSECUTIVE'), false);
});

test('repair orchestrator leaves a protected workload breach unresolved for final warning', () => {
  const p1 = makePerson('p1');
  const result = repairScheduleBeforeWarnings({
    assignments: { p1: { 1: 'MEN', 2: 'ME' } },
    personnelList: [p1],
    settings: allPeriodsDemand(),
    calendarDays: calendar(2),
    requests: [],
    protectedCells: new Set(['p1:1', 'p1:2']),
  });

  assert.equal(result.repairs.length, 0);
  assert.equal(result.assignments.p1[2], 'ME');
  assert.ok(result.unresolved.some(violation => violation.code === 'MAX_CONSECUTIVE'));

  const verification = verifyCoverageAndLeaders(
    CAL_YEAR, CAL_MONTH, [p1], result.assignments, zeroDemand(), {}, undefined, []
  );
  assert.ok(verification.structuredWarnings.some(warning => warning.code === 'MAX_CONSECUTIVE'));
});

test('repair never treats legal N→M as a workload violation', () => {
  const p1 = makePerson('p1');
  const result = repairScheduleBeforeWarnings({
    assignments: { p1: { 1: 'N', 2: 'M' } },
    personnelList: [p1],
    settings: zeroDemand(),
    calendarDays: calendar(2),
    requests: [],
  });

  assert.equal(result.repairs.length, 0);
  assert.equal(result.assignments.p1[2], 'M');
  assert.equal(result.unresolved.some(violation => violation.code === 'MAX_CONSECUTIVE'), false);
  assert.equal(result.unresolved.some(violation => violation.code === 'NIGHT_REST_CONSECUTIVE_NIGHTS'), false);
});

test('final verification observes the repaired schedule, not an intermediate workload breach', () => {
  const p1 = makePerson('p1');
  const p2 = makePerson('p2');
  const before = verifyCoverageAndLeaders(
    CAL_YEAR, CAL_MONTH, [p1, p2],
    { p1: { 1: 'MEN', 2: 'ME' }, p2: { 1: 'OFF', 2: 'OFF' } },
    zeroDemand(), {}, undefined, []
  );
  assert.ok(before.structuredWarnings.some(warning => warning.code === 'MAX_CONSECUTIVE'));

  const repaired = repairScheduleBeforeWarnings({
    assignments: { p1: { 1: 'MEN', 2: 'ME' }, p2: { 1: 'OFF', 2: 'OFF' } },
    personnelList: [p1, p2],
    settings: allPeriodsDemand(),
    calendarDays: calendar(2),
    requests: [],
  });
  const after = verifyCoverageAndLeaders(
    CAL_YEAR, CAL_MONTH, [p1, p2], repaired.assignments, zeroDemand(), {}, undefined, []
  );
  assert.equal(after.structuredWarnings.some(warning => warning.code === 'MAX_CONSECUTIVE'), false);
});

// ---------------------------------------------------------------------------
// Intentional manual-edit bypass
// ---------------------------------------------------------------------------

test('manual edit remains protected and verification reports its workload breach', async () => {
  const p1 = makePerson('p1');
  const currentSchedule: MonthlySchedule = {
    year: CAL_YEAR,
    month: CAL_MONTH,
    assignments: { p1: { 1: 'MEN', 2: 'M' } },
    shiftLeaders: {},
    warnings: [],
  };
  const result = await applyManualShiftChangeFacade(
    {
      personnelId: 'p1',
      day: 2,
      shift: 'ME',
      year: CAL_YEAR,
      month: CAL_MONTH,
      currentSchedule,
      personnel: [p1],
      requests: [],
      settings: allPeriodsDemand(),
      holidays: {},
      firstDayOfWeek: undefined,
      lockState: {
        finalizedNursesMonths: [],
        finalizedAssistantsMonths: [],
        lockedRows: [],
      },
      protectedCells: ['p1:1'],
    },
    verifyCoverageAndLeaders,
    { saveSchedule: async () => undefined },
    'test-department'
  );

  assert.equal(result.success, true);
  assert.equal(result.schedule?.assignments.p1[2], 'ME');
  assert.ok(result.schedule?.warnings.some(warning => warning.startsWith('Max Consecutive:')));
});

// ---------------------------------------------------------------------------
// Independent third-night repair
// ---------------------------------------------------------------------------

test('repair orchestrator repairs a third N-bearing day through a legal alternative', () => {
  const p1 = makePerson('p1');
  const p2 = makePerson('p2');
  const result = repairScheduleBeforeWarnings({
    assignments: {
      p1: { 1: 'N', 2: 'N', 3: 'N' },
      p2: { 1: 'OFF', 2: 'OFF', 3: 'OFF' },
    },
    personnelList: [p1, p2],
    settings: makeSettings({ morningNurse: 0, afternoonNurse: 0, nightNurse: 1 }),
    calendarDays: calendar(3),
    requests: [],
  });

  assert.ok(result.repairs.some(repair => repair.code === 'NIGHT_REST_CONSECUTIVE_NIGHTS'));
  assert.ok(
    !(shiftCoversPeriod(result.assignments.p1[1], 'N')
      && shiftCoversPeriod(result.assignments.p1[2], 'N')
      && shiftCoversPeriod(result.assignments.p1[3], 'N')),
    'the N-bearing run is broken without creating another hard violation'
  );
  assert.ok(shiftCoversPeriod(result.assignments.p2[1], 'N'), 'coverage is moved to a legal alternative');
  assert.equal(result.unresolved.some(violation => violation.code === 'NIGHT_REST_CONSECUTIVE_NIGHTS'), false);
});

test('repair orchestrator preserves a protected third-night violation for final warning', () => {
  const p1 = makePerson('p1');
  const result = repairScheduleBeforeWarnings({
    assignments: { p1: { 1: 'N', 2: 'N', 3: 'N' } },
    personnelList: [p1],
    settings: makeSettings({ morningNurse: 0, afternoonNurse: 0, nightNurse: 1 }),
    calendarDays: calendar(3),
    requests: [],
    protectedCells: new Set(['p1:3']),
  });

  assert.ok(result.unresolved.some(violation => violation.code === 'NIGHT_REST_CONSECUTIVE_NIGHTS'));
  const verification = verifyCoverageAndLeaders(
    CAL_YEAR, CAL_MONTH, [p1], result.assignments, zeroDemand(), {}, undefined, []
  );
  assert.ok(verification.structuredWarnings.some(warning => warning.code === 'NIGHT_REST'));
});

// ---------------------------------------------------------------------------
// Role restriction and explicit-request behavior
// ---------------------------------------------------------------------------

test('repair orchestrator repairs an automatically introduced Supervisor/Staff E/N assignment', () => {
  const supervisor = makePerson('sup', { position: 'supervisor' });
  const general = makePerson('general');
  const result = repairScheduleBeforeWarnings({
    assignments: { sup: { 1: 'E' }, general: { 1: 'OFF' } },
    personnelList: [supervisor, general],
    settings: makeSettings({ morningNurse: 0, afternoonNurse: 1, nightNurse: 0 }),
    calendarDays: calendar(1),
    requests: [],
  });

  assert.ok(result.repairs.some(repair => repair.code === 'MORNING_ONLY'));
  assert.equal(result.assignments.sup[1], 'OFF');
  assert.ok(shiftCoversPeriod(result.assignments.general[1], 'E'));
  assert.equal(result.unresolved.some(violation => violation.code === 'MORNING_ONLY'), false);
});

test('repair preserves a protected Supervisor/Staff E/N violation for the final critical warning', () => {
  const supervisor = makePerson('sup', { position: 'supervisor' });
  const result = repairScheduleBeforeWarnings({
    assignments: { sup: { 1: 'E' } },
    personnelList: [supervisor],
    settings: zeroDemand(),
    calendarDays: calendar(1),
    requests: [],
    protectedCells: new Set(['sup:1']),
  });

  assert.ok(result.unresolved.some(violation => violation.code === 'MORNING_ONLY'));
  const verification = verifyCoverageAndLeaders(
    CAL_YEAR, CAL_MONTH, [supervisor], result.assignments, zeroDemand(), {}, undefined, []
  );
  assert.ok(verification.structuredWarnings.some(warning => warning.code === 'SUPERVISOR_STAFF_EN_RESTRICTION'));
});

test('repair preserves an explicit requested shift when a non-requested cap component can move', () => {
  const p1 = makePerson('p1');
  const p2 = makePerson('p2');
  const requests: ShiftRequest[] = [
    makeRequest('p1', {
      id: 'requested-men', requestType: 'shift', preferredShift: 'MEN', isEssential: true,
      scope: 'custom_days', selectedDays: [2],
    }),
  ];
  const result = repairScheduleBeforeWarnings({
    assignments: { p1: { 1: 'N', 2: 'MEN' }, p2: { 1: 'OFF', 2: 'OFF' } },
    personnelList: [p1, p2],
    settings: allPeriodsDemand(),
    calendarDays: calendar(2),
    requests,
  });

  assert.ok(result.repairs.some(repair => repair.code === 'MAX_CONSECUTIVE' && repair.day === 1));
  assert.equal(result.assignments.p1[2], 'MEN', 'the requested composite shift remains intact');
  assert.equal(result.unresolved.some(violation => violation.code === 'MAX_CONSECUTIVE'), false);
});

test('solver warns about an explicit cap conflict only after final repair/retry work', () => {
  const p1 = makePerson('p1');
  const requests: ShiftRequest[] = [
    makeRequest('p1', {
      id: 'day-1', requestType: 'shift', preferredShift: 'MEN', isEssential: true,
      scope: 'custom_days', selectedDays: [1],
    }),
    makeRequest('p1', {
      id: 'day-2', requestType: 'shift', preferredShift: 'ME', isEssential: true,
      scope: 'custom_days', selectedDays: [2],
    }),
  ];
  const result = solveNursingSchedule(CAL_YEAR, CAL_MONTH, [p1], requests, allPeriodsDemand(), {}, undefined, null);

  assert.equal(result.assignments.p1[1], 'MEN');
  assert.notEqual(result.assignments.p1[2], 'ME');
  assert.ok(result.warnings.some(warning => warning.startsWith('Hard Constraint Conflict:') && warning.includes('روز 2')));
});
