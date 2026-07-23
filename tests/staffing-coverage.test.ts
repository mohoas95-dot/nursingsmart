import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileStaffingCoverage, shiftCoversPeriod } from '../domain/scheduling/staffing-coverage';
import { runOptimizerFacade } from '../features/scheduling/facades/shift-write-facade';
import { solveNursingSchedule, solveWithPriority } from '../lib/solver';
import type { MonthlySchedule, Personnel, ShiftRequest, SystemSettings } from '../lib/types';

function person(id: string, jobGroup: 'nurse' | 'assistant'): Personnel {
  return {
    id,
    firstName: id,
    lastName: 'test',
    personalCode: id,
    jobGroup,
    position: jobGroup === 'nurse' ? 'general' : 'none',
    employmentType: 'official',
    experienceYears: 1,
    active: true,
    canBeShiftLeader: jobGroup === 'nurse',
  };
}

function settingsWithDemand(values: {
  morningNurse?: number;
  afternoonNurse?: number;
  nightNurse?: number;
  morningAssistant?: number;
  afternoonAssistant?: number;
  nightAssistant?: number;
}): SystemSettings {
  const demand = {
    morningNurse: values.morningNurse ?? 0,
    morningAssistant: values.morningAssistant ?? 0,
    afternoonNurse: values.afternoonNurse ?? 0,
    afternoonAssistant: values.afternoonAssistant ?? 0,
    afternoonLeader: 0,
    nightNurse: values.nightNurse ?? 0,
    nightAssistant: values.nightAssistant ?? 0,
    nightLeader: 0,
  };
  return {
    dutyHours: { official: 160, contract: 174, conscript: 180, overtime: 150 },
    demand: { weekday: { ...demand }, holiday: { ...demand } },
  };
}

test('staffing reconciliation enforces exact counts without changing the other job group', () => {
  const personnel = [person('n1', 'nurse'), person('n2', 'nurse'), person('n3', 'nurse'), person('a1', 'assistant')];
  const assignments = {
    n1: { 1: 'M' },
    n2: { 1: 'M' },
    n3: { 1: 'OFF' },
    a1: { 1: 'E' },
  };

  const result = reconcileStaffingCoverage(
    assignments,
    personnel,
    settingsWithDemand({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }),
    [{ day: 1, isHoliday: false }],
    ['nurse']
  );

  const nurses = personnel.filter(item => item.jobGroup === 'nurse');
  for (const shift of ['M', 'E', 'N'] as const) {
    assert.equal(
      nurses.filter(item => shiftCoversPeriod(result.assignments[item.id][1], shift)).length,
      1
    );
  }
  assert.equal(result.assignments.a1[1], 'E');
  assert.deepEqual(result.unresolvedGaps, []);
});

test('staffing reconciliation accounts for locked rows when a regenerated group is merged', () => {
  const personnel = [person('n1', 'nurse'), person('n2', 'nurse')];
  const result = reconcileStaffingCoverage(
    { n1: { 1: 'M' }, n2: { 1: 'M' } },
    personnel,
    settingsWithDemand({ morningNurse: 1 }),
    [{ day: 1, isHoliday: false }],
    ['nurse'],
    ['n1']
  );

  assert.equal(result.assignments.n1[1], 'M', 'the locked row must remain unchanged');
  assert.equal(result.assignments.n2[1], 'OFF', 'the unlocked excess must be removed');
  assert.deepEqual(result.unresolvedGaps, []);
});

test('base solver rechecks staffing after lower-priority OFF post-processing', () => {
  const result = solveNursingSchedule(
    1404,
    2,
    [person('n1', 'nurse')],
    [],
    settingsWithDemand({}),
    {},
    undefined,
    null
  );

  assert.ok(Object.values(result.assignments.n1).every(shift => shift === 'OFF'));
  assert.equal(result.warnings.some(warning => warning.startsWith('Overstaffing:')), false);
});

test('priority solver never uses nurses to satisfy an assistant shortage', () => {
  const personnel = [person('n1', 'nurse'), person('a1', 'assistant')];
  const result = solveWithPriority(
    1404,
    2,
    personnel,
    [],
    settingsWithDemand({ morningAssistant: 2 }),
    {},
    undefined,
    null
  );

  for (const dayAssignments of Object.values(result.assignments.n1)) {
    assert.equal(
      shiftCoversPeriod(dayAssignments, 'M'),
      false,
      'a shortage in the assistant group must not add a nurse shift'
    );
  }
});

test('optimizer facade re-applies persisted staffing counts after target-group merge', async () => {
  const personnel = [person('n1', 'nurse'), person('n2', 'nurse'), person('n3', 'nurse')];
  const settings = settingsWithDemand({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 });
  let persisted: MonthlySchedule | null = null;

  const result = await runOptimizerFacade(
    {
      jobGroup: 'nurse',
      year: 1404,
      month: 2,
      personnel,
      requests: [],
      settings,
      holidays: {},
      firstDayOfWeek: undefined,
      monthlyDutyHours: null,
      currentSchedule: null,
      lockState: {
        finalizedNursesMonths: [],
        finalizedAssistantsMonths: [],
        lockedRows: [],
      },
      dismissedWarnings: [],
    },
    () => ({
      // Deliberately invalid optimizer output: every nurse is OFF.
      assignments: Object.fromEntries(personnel.map(item => [
        item.id,
        Object.fromEntries(Array.from({ length: 31 }, (_, index) => [index + 1, 'OFF'])),
      ])),
      warnings: [],
    }),
    (_year, _month, _personnel, assignments) => ({
      shiftLeaders: {},
      warnings: Object.keys(assignments).length > 0 ? [] : ['missing assignments'],
    }),
    {
      saveSchedule: async schedule => {
        persisted = schedule as MonthlySchedule;
      },
    },
    {
      setSolvingTarget: () => undefined,
      showConfirmation: () => true,
      showError: message => assert.fail(message),
    },
    'test-department',
    { delayMs: 0 }
  );

  assert.equal(result.success, true);
  assert.ok(persisted);
  const saved = persisted as MonthlySchedule;
  for (let day = 1; day <= 31; day += 1) {
    for (const shift of ['M', 'E', 'N'] as const) {
      const count = personnel.filter(item => shiftCoversPeriod(saved.assignments[item.id][day], shift)).length;
      assert.equal(count, 1, `day ${day}, shift ${shift} must match persisted demand`);
    }
  }
});
