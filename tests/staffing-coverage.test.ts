import assert from 'node:assert/strict';
import test from 'node:test';

import { repairScheduleBeforeWarnings } from '../domain/scheduling/repair-orchestrator';
import { reconcileStaffingCoverage, shiftCoversPeriod } from '../domain/scheduling/staffing-coverage';
import { runOptimizerFacade } from '../features/scheduling/facades/shift-write-facade';
import { solveNursingSchedule, solveWithPriority, verifyCoverageAndLeaders } from '../lib/solver';
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

test('optimizer facade preserves a non-target cap violation while hardening its target group', async () => {
  const nurse = person('n1', 'nurse');
  const assistant = person('a1', 'assistant');
  const preservedAssistantRow = { 1: 'MEN', 2: 'ME' };
  let persisted: MonthlySchedule | null = null;

  const result = await runOptimizerFacade(
    {
      jobGroup: 'nurse',
      year: 1404,
      month: 2,
      personnel: [nurse, assistant],
      requests: [],
      settings: settingsWithDemand({}),
      holidays: {},
      firstDayOfWeek: undefined,
      monthlyDutyHours: null,
      currentSchedule: {
        year: 1404,
        month: 2,
        assignments: {
          n1: { 1: 'OFF', 2: 'OFF' },
          a1: preservedAssistantRow,
        },
        shiftLeaders: {},
        warnings: [],
      },
      lockState: {
        finalizedNursesMonths: [],
        finalizedAssistantsMonths: [],
        lockedRows: [],
      },
      dismissedWarnings: [],
    },
    () => ({
      assignments: {
        n1: Object.fromEntries(Array.from({ length: 31 }, (_, index) => [index + 1, 'OFF'])),
      },
      warnings: [],
    }),
    () => ({ shiftLeaders: {}, warnings: [] }),
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
  assert.deepEqual((persisted as MonthlySchedule).assignments.a1, preservedAssistantRow);
});

test('reconciliation never treats an unknown shift as empty coverage capacity', () => {
  const nurse = person('n1', 'nurse');
  const result = reconcileStaffingCoverage(
    { n1: { 1: 'X' } },
    [nurse],
    settingsWithDemand({ morningNurse: 1 }),
    [{ day: 1, isHoliday: false, dayOfWeek: 0 }],
    ['nurse']
  );

  assert.equal(result.assignments.n1[1], 'X');
  assert.deepEqual(result.unresolvedGaps, [{
    day: 1,
    jobGroup: 'nurse',
    shift: 'M',
    required: 1,
    assigned: 0,
  }]);
});

test('reconciliation preserves exact composite requests while allowing single-component compatibility', () => {
  const p1 = person('p1', 'nurse');
  const p2 = person('p2', 'nurse');
  const compositeRequest: ShiftRequest = {
    id: 'p1-me',
    personnelId: 'p1',
    requestType: 'shift',
    preferredShift: 'ME',
    isEssential: true,
    scope: 'custom_days',
    selectedDays: [1],
  };
  const composite = reconcileStaffingCoverage(
    { p1: { 1: 'ME' }, p2: { 1: 'OFF' } },
    [p1, p2],
    settingsWithDemand({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }),
    [{ day: 1, isHoliday: false, dayOfWeek: 0 }],
    ['nurse'],
    [],
    [compositeRequest]
  );

  assert.equal(composite.assignments.p1[1], 'ME', 'ME must not be expanded to MEN');
  assert.equal(composite.assignments.p2[1], 'N', 'a compatible alternative fills the N gap');
  assert.deepEqual(composite.unresolvedGaps, []);

  const componentRequest: ShiftRequest = {
    ...compositeRequest,
    id: 'p1-m',
    preferredShift: 'M',
  };
  const component = reconcileStaffingCoverage(
    { p1: { 1: 'M' } },
    [p1],
    settingsWithDemand({ morningNurse: 1, afternoonNurse: 1 }),
    [{ day: 1, isHoliday: false, dayOfWeek: 0 }],
    ['nurse'],
    [],
    [componentRequest]
  );

  assert.equal(component.assignments.p1[1], 'ME', 'single-M requests remain component-compatible');
  assert.deepEqual(component.unresolvedGaps, []);
});

test('reconciliation honors exact pattern steps and leaves incompatible excess unresolved', () => {
  const p1 = person('p1', 'nurse');
  const p2 = person('p2', 'nurse');
  const pattern: ShiftRequest = {
    id: 'p1-pattern',
    personnelId: 'p1',
    requestType: 'pattern',
    patternSteps: ['ME'],
    isEssential: true,
    scope: 'all',
  };
  const covered = reconcileStaffingCoverage(
    { p1: { 1: 'ME' }, p2: { 1: 'OFF' } },
    [p1, p2],
    settingsWithDemand({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }),
    [{ day: 1, isHoliday: false, dayOfWeek: 0 }],
    ['nurse'],
    [],
    [pattern]
  );
  assert.equal(covered.assignments.p1[1], 'ME');
  assert.equal(covered.assignments.p2[1], 'N');

  const excess = reconcileStaffingCoverage(
    { p1: { 1: 'ME' } },
    [p1],
    settingsWithDemand({ morningNurse: 1, afternoonNurse: 0 }),
    [{ day: 1, isHoliday: false, dayOfWeek: 0 }],
    ['nurse'],
    [],
    [pattern]
  );
  assert.equal(excess.assignments.p1[1], 'ME', 'removing E would violate the exact pattern step');
  assert.ok(excess.unresolvedGaps.some(gap => gap.shift === 'E' && gap.required === 0 && gap.assigned === 1));
});

test('optimizer facade preserves an unknown target cell through reconciliation and final verification', async () => {
  const nurse = person('n1', 'nurse');
  const settings = settingsWithDemand({ morningNurse: 1 });
  let persisted: MonthlySchedule | null = null;

  const result = await runOptimizerFacade(
    {
      jobGroup: 'nurse',
      year: 1404,
      month: 2,
      personnel: [nurse],
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
      assignments: {
        n1: Object.fromEntries(Array.from({ length: 31 }, (_, index) => [index + 1, index === 0 ? 'X' : 'OFF'])),
      },
      warnings: [],
    }),
    verifyCoverageAndLeaders,
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
  assert.equal(saved.assignments.n1[1], 'X');
  assert.ok(saved.warnings.some(warning => warning.startsWith('Unknown Shift:')));
  assert.ok(saved.warnings.some(warning => warning.startsWith('Coverage Shortage:') && warning.includes('روز 1 شیفت M')));
});

test('final reconciliation leaves an exact composite request intact before cap repair', () => {
  const p1 = person('p1', 'nurse');
  const p2 = person('p2', 'nurse');
  const p3 = person('p3', 'nurse');
  const q1 = person('q1', 'nurse');
  const q2 = person('q2', 'nurse');
  const q3 = person('q3', 'nurse');
  const personnel = [p1, p2, p3, q1, q2, q3];
  const calendarDays = [
    { day: 1, dayOfWeek: 0, isHoliday: false },
    { day: 2, dayOfWeek: 1, isHoliday: false },
    { day: 3, dayOfWeek: 2, isHoliday: false },
  ];
  const settings = settingsWithDemand({ morningNurse: 2, afternoonNurse: 2, nightNurse: 2 });
  const requests: ShiftRequest[] = [
    {
      id: 'p2-me', personnelId: 'p2', requestType: 'shift', preferredShift: 'ME',
      isEssential: true, scope: 'custom_days', selectedDays: [3],
    },
    {
      id: 'q1-leave', personnelId: 'q1', requestType: 'leave',
      isEssential: true, scope: 'custom_days', selectedDays: [3],
    },
    {
      id: 'q2-leave', personnelId: 'q2', requestType: 'leave',
      isEssential: true, scope: 'custom_days', selectedDays: [3],
    },
  ];
  const initial = {
    p1: { 1: 'OFF', 2: 'MEN', 3: 'ME' },
    p2: { 1: 'OFF', 2: 'OFF', 3: 'ME' },
    p3: { 1: 'N', 2: 'N', 3: 'OFF' },
    q1: { 1: 'ME', 2: 'ME', 3: 'L1' },
    q2: { 1: 'ME', 2: 'OFF', 3: 'L1' },
    q3: { 1: 'N', 2: 'OFF', 3: 'N' },
  };

  const preRepair = reconcileStaffingCoverage(initial, personnel, settings, calendarDays, ['nurse'], [], requests);
  assert.equal(preRepair.assignments.p2[3], 'ME', 'pre-repair reconciliation must not turn ME into MEN');
  assert.ok(preRepair.unresolvedGaps.some(gap =>
    gap.day === 3 && gap.shift === 'N' && gap.required === 2 && gap.assigned === 1
  ));

  const repaired = repairScheduleBeforeWarnings({
    assignments: preRepair.assignments,
    personnelList: personnel,
    settings,
    calendarDays,
    requests,
    targetJobGroups: ['nurse'],
  });
  assert.equal(repaired.assignments.p2[3], 'ME');
  assert.ok(repaired.repairs.some(repair => repair.personnelId === 'p1' && repair.code === 'MAX_CONSECUTIVE'));

  const verification = verifyCoverageAndLeaders(
    1404,
    2,
    personnel,
    repaired.assignments,
    settingsWithDemand({}),
    {},
    undefined,
    requests
  );
  assert.equal(verification.structuredWarnings.some(warning =>
    warning.code === 'MISMATCHED_REQUEST' && warning.personnelId === 'p2' && warning.day === 3
  ), false);
});

test('solver coverage fill does not expand an exact ME request to MEN in an emergency shortage', () => {
  const nurse = person('n1', 'nurse');
  const request: ShiftRequest = {
    id: 'n1-me',
    personnelId: 'n1',
    requestType: 'shift',
    preferredShift: 'ME',
    isEssential: true,
    scope: 'custom_days',
    selectedDays: [1],
  };
  const result = solveNursingSchedule(
    1404,
    2,
    [nurse],
    [request],
    settingsWithDemand({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }),
    {},
    undefined,
    null
  );

  assert.equal(result.assignments.n1[1], 'ME');
  assert.equal(result.warnings.some(warning =>
    warning.startsWith('Mismatched Request:') && warning.includes('روز 1 درخواست شیفت ME')
  ), false);
});

// ---------------------------------------------------------------------------
// Regression (Phase 3, Fix 1): Soft-OFF weekday scope in reconcile.
//
// A Soft OFF scoped to a weekday (e.g. 'thursdays') must be recognized during
// reconcile candidate ranking, exactly like 'avoid_shift' already is, because
// `calendarDay.dayOfWeek` is available. Before the fix, the simplified scope
// matcher returned false for weekday scopes, so the Soft-OFF person received no
// preference penalty and could be picked ahead of an equally-legal candidate.
// ---------------------------------------------------------------------------

test('reconcile respects a Soft-OFF scoped to a weekday (thursdays) when ranking candidates', () => {
  // Two equally-legal OFF nurses; the E period needs one more.
  // n_soft has a Soft OFF scoped to Thursdays; n_free has no request.
  // The reconcile must prefer n_free (no Soft-OFF penalty) on the Thursday.
  const personnel = [person('n_soft', 'nurse'), person('n_free', 'nurse')];
  const assignments = {
    n_soft: { 5: 'OFF' },
    n_free: { 5: 'OFF' },
  };
  const softOffThursdays: ShiftRequest = {
    id: 'soft-thu',
    personnelId: 'n_soft',
    requestType: 'OFF',
    offHardness: 'soft',
    scope: 'thursdays',
    isEssential: false,
  };

  // Day 5 is declared a Thursday (dayOfWeek === 5) via the calendar input.
  const result = reconcileStaffingCoverage(
    assignments,
    personnel,
    settingsWithDemand({ afternoonNurse: 1 }),
    [{ day: 5, isHoliday: false, dayOfWeek: 5 }],
    ['nurse'],
    [],
    [softOffThursdays],
  );

  // The free nurse (no Soft-OFF on Thursday) is the one moved onto E.
  assert.ok(shiftCoversPeriod(result.assignments.n_free?.[5], 'E'),
    'n_free should be assigned E because they carry no Soft-OFF penalty on Thursday');
  assert.equal(shiftCoversPeriod(result.assignments.n_soft?.[5], 'E'), false,
    'n_soft should be spared because their Soft OFF is scoped to Thursdays and day 5 is a Thursday');
});

test('reconcile does not apply a thursdays Soft-OFF penalty on a non-Thursday day', () => {
  // Same setup, but day 5 is NOT a Thursday (dayOfWeek === 0 = Saturday), so the
  // 'thursdays' Soft OFF is out of scope and must NOT deprioritize n_soft.
  // With the Soft-OFF out of scope, both candidates are equal; tie-break falls to
  // definition order, so n_soft (first in the group) is picked.
  const personnel = [person('n_soft', 'nurse'), person('n_free', 'nurse')];
  const assignments = {
    n_soft: { 5: 'OFF' },
    n_free: { 5: 'OFF' },
  };
  const softOffThursdays: ShiftRequest = {
    id: 'soft-thu',
    personnelId: 'n_soft',
    requestType: 'OFF',
    offHardness: 'soft',
    scope: 'thursdays',
    isEssential: false,
  };

  const result = reconcileStaffingCoverage(
    assignments,
    personnel,
    settingsWithDemand({ afternoonNurse: 1 }),
    [{ day: 5, isHoliday: false, dayOfWeek: 0 }], // Saturday, not Thursday
    ['nurse'],
    [],
    [softOffThursdays],
  );

  assert.ok(shiftCoversPeriod(result.assignments.n_soft?.[5], 'E'),
    'n_soft may be assigned E on a non-Thursday because the thursdays Soft-OFF is out of scope');
});

test('reconcile still honors a day-of-month Soft-OFF scope (custom_days) after the fix', () => {
  // Guardrail: the fix must not break non-weekday scopes. A custom_days Soft OFF
  // on day 5 must still deprioritize its owner.
  const personnel = [person('n_soft', 'nurse'), person('n_free', 'nurse')];
  const assignments = {
    n_soft: { 5: 'OFF' },
    n_free: { 5: 'OFF' },
  };
  const softOffCustom: ShiftRequest = {
    id: 'soft-custom',
    personnelId: 'n_soft',
    requestType: 'OFF',
    offHardness: 'soft',
    scope: 'custom_days',
    selectedDays: [5],
    isEssential: false,
  };

  const result = reconcileStaffingCoverage(
    assignments,
    personnel,
    settingsWithDemand({ afternoonNurse: 1 }),
    [{ day: 5, isHoliday: false, dayOfWeek: 5 }],
    ['nurse'],
    [],
    [softOffCustom],
  );

  assert.ok(shiftCoversPeriod(result.assignments.n_free?.[5], 'E'),
    'n_free should be preferred because n_soft has a custom_days Soft-OFF on day 5');
  assert.equal(shiftCoversPeriod(result.assignments.n_soft?.[5], 'E'), false);
});
