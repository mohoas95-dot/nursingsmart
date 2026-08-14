/**
 * Scheduling rule characterization and focused regression suite.
 *
 * `characterizes_…` tests still pin policy-ambiguous current behavior. `regression_…`
 * tests cover the confirmed correctness gaps fixed after the characterization phase.
 * No assertion in this file should be read as a broader business-policy redesign.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_HARD_RULES,
  VERIFICATION_HARD_RULES,
  evaluateHardConstraintViolations,
} from '../domain/scheduling/hard-constraints';
import {
  getUnfinalizedJobGroups,
  mergeOptimizerAssignments,
  protectedCellKey,
  protectedCellsForContext,
  updateScheduleCell,
} from '../domain/scheduling/schedule-operations';
import {
  reconcileStaffingCoverage,
  shiftCoversPeriod,
} from '../domain/scheduling/staffing-coverage';
import {
  countCriticalScheduleWarnings,
  isCriticalScheduleWarning,
} from '../domain/warnings/schedule-warning';
import { evaluateBaselineObjective } from '../domain/scenarios/objective';
import { applyManualShiftChangeFacade } from '../features/scheduling/facades/shift-write-facade';
import {
  generateAndScoreScenarios,
  generateCriticalRepairEdits,
  type VerifiedSchedule,
} from '../lib/scenarioGenerator';
import { evaluateScenarioSchedule } from '../lib/scoring';
import {
  getShiftHours,
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

const YEAR = 1404;
const MONTH = 2;
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

function person(
  id: string,
  overrides: Partial<Personnel> = {}
): Personnel {
  return {
    id,
    firstName: id,
    lastName: 'characterization',
    personalCode: id,
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'official',
    experienceYears: 1,
    active: true,
    canBeShiftLeader: true,
    orderIndex: Number(id.replace(/\D/g, '')) || 0,
    ...overrides,
  };
}

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

function shiftRequest(
  id: string,
  personnelId: string,
  preferredShift: NonNullable<ShiftRequest['preferredShift']>,
  selectedDays: number[]
): ShiftRequest {
  return {
    id,
    personnelId,
    requestType: 'shift',
    preferredShift,
    isEssential: false,
    scope: 'custom_days',
    selectedDays,
  };
}

function scheduleWith(
  assignments: MonthlySchedule['assignments'],
  extras: Partial<MonthlySchedule> = {}
): MonthlySchedule {
  return {
    year: YEAR,
    month: MONTH,
    assignments,
    shiftLeaders: {},
    warnings: [],
    ...extras,
  };
}

function oneDayCalendar(day = 1, isHoliday = false) {
  return [{ day, dayOfWeek: 0, isHoliday }];
}

function rowsDiffer(
  left: Readonly<Record<number, ShiftType>> | undefined,
  right: Readonly<Record<number, ShiftType>> | undefined
): boolean {
  for (let day = 1; day <= TOTAL_DAYS; day += 1) {
    if ((left?.[day] || 'OFF') !== (right?.[day] || 'OFF')) return true;
  }
  return false;
}

async function applyProtectedManualEdit(options: {
  person: Personnel;
  currentShift: ShiftType;
  newShift: ShiftType;
  requests?: ShiftRequest[];
  lockedRows?: string[];
}) {
  const currentSchedule = scheduleWith({
    [options.person.id]: { 1: options.currentShift },
  });

  return applyManualShiftChangeFacade(
    {
      personnelId: options.person.id,
      day: 1,
      shift: options.newShift,
      year: YEAR,
      month: MONTH,
      currentSchedule,
      personnel: [options.person],
      requests: options.requests ?? [],
      settings: settingsWithDemand(),
      holidays: {},
      firstDayOfWeek: undefined,
      lockState: {
        finalizedNursesMonths: [],
        finalizedAssistantsMonths: [],
        lockedRows: options.lockedRows ?? [],
      },
      protectedCells: [`${options.person.id}:1`],
    },
    verifyCoverageAndLeaders,
    { saveSchedule: async () => undefined },
    'characterization-department'
  );
}

// ---------------------------------------------------------------------------
// Pattern scope and pattern verification
// ---------------------------------------------------------------------------

test('characterizes_current_pattern_scope_behavior_as_all_month_cadence', () => {
  const nurse = person('pattern-worker');
  const pattern: ShiftRequest = {
    id: 'limited-pattern',
    personnelId: nurse.id,
    requestType: 'pattern',
    patternSteps: ['EN', 'OFF'],
    isEssential: false,
    scope: 'custom_days',
    selectedDays: [1],
  };

  const solved = solveNursingSchedule(
    YEAR,
    MONTH,
    [nurse],
    [pattern],
    settingsWithDemand(),
    {},
    undefined,
    null
  );

  assert.equal(solved.assignments[nurse.id][1], 'EN', 'day 1 is inside the declared scope');
  assert.equal(solved.assignments[nurse.id][2], 'OFF', 'the second cadence step is applied outside scope');
  assert.equal(solved.assignments[nurse.id][3], 'EN', 'the repeating work step is also applied outside scope');
});

test('regression_reports_current_all_month_pattern_cadence_mismatch', () => {
  const nurse = person('pattern-mismatch');
  const pattern: ShiftRequest = {
    id: 'expected-evening',
    personnelId: nurse.id,
    requestType: 'pattern',
    patternSteps: ['E'],
    isEssential: true,
    scope: 'custom_days',
    selectedDays: [1],
  };

  const verification = verifyCoverageAndLeaders(
    YEAR,
    MONTH,
    [nurse],
    { [nurse.id]: { 1: 'M' } },
    settingsWithDemand(),
    {},
    undefined,
    [pattern]
  );
  const patternMismatchWarnings = verification.structuredWarnings.filter(warning =>
    warning.code === 'MISMATCHED_REQUEST'
    && warning.personnelId === nurse.id
    && warning.day === 1
  );

  assert.equal(patternMismatchWarnings.length, 1);
  assert.equal(patternMismatchWarnings[0].severity, 'warning');
  assert.equal(patternMismatchWarnings[0].metadata?.requestType, 'pattern');
  assert.equal(patternMismatchWarnings[0].metadata?.requestedShift, 'E');
  assert.equal(patternMismatchWarnings[0].metadata?.assignedShift, 'M');
  assert.equal(countCriticalScheduleWarnings(patternMismatchWarnings), 0);
  assert.ok(verification.structuredWarnings.some(warning =>
    warning.code === 'MISMATCHED_REQUEST'
    && warning.personnelId === nurse.id
    && warning.day === 2
    && warning.metadata?.requestType === 'pattern'
  ), 'verification follows the existing all-month cadence outside the declared scope');
});

test('regression_makes_pattern_OFF_overwrite_visible_without_changing_OFF_breaker_priority', () => {
  const nurse = person('pattern-off');
  const pattern: ShiftRequest = {
    id: 'four-offs-then-morning',
    personnelId: nurse.id,
    requestType: 'pattern',
    patternSteps: ['OFF', 'OFF', 'OFF', 'OFF', 'M'],
    isEssential: false,
    scope: 'all',
  };

  const solved = solveNursingSchedule(
    YEAR,
    MONTH,
    [nurse],
    [pattern],
    sameDemand({ morningNurse: 1 }),
    {},
    undefined,
    null
  );

  assert.equal(pattern.requestType, 'pattern');
  assert.equal(pattern.offHardness, undefined, 'a pattern OFF is neither a hard-OFF nor soft-OFF request');
  assert.deepEqual(
    [1, 2, 3].map(day => solved.assignments[nurse.id][day]),
    ['OFF', 'OFF', 'OFF']
  );
  assert.equal(solved.assignments[nurse.id][4], 'M', 'the fourth pattern OFF is replaced by the OFF breaker');
  assert.ok(solved.warnings.some(warning =>
    warning.startsWith('OFF Removed:')
    && warning.includes('روز 4')
    && warning.includes('سقف ۳ روز متوالی')
  ));
  assert.equal(
    solved.warnings.some(warning =>
      warning.startsWith('Mismatched Request:')
      && warning.includes('روز 4')
      && warning.includes('الگوی شیفت OFF')
    ),
    true,
    'the existing overwrite remains allowed but is no longer silent'
  );
});

// ---------------------------------------------------------------------------
// Manual/protected hard-OFF and leave warning severity
// ---------------------------------------------------------------------------

test('regression_surfaces_manual_hard_OFF_violation_as_structured_critical_warning', async () => {
  const nurse = person('manual-hard-off');
  const hardOff: ShiftRequest = {
    id: 'hard-off-day-1',
    personnelId: nurse.id,
    requestType: 'OFF',
    preferredShift: 'OFF',
    offHardness: 'hard',
    isEssential: true,
    scope: 'custom_days',
    selectedDays: [1],
  };

  const result = await applyProtectedManualEdit({
    person: nurse,
    currentShift: 'OFF',
    newShift: 'M',
    requests: [hardOff],
  });
  assert.equal(result.success, true);
  assert.equal(result.schedule?.assignments[nurse.id][1], 'M');

  const assignments = result.schedule!.assignments;
  const internalViolations = evaluateHardConstraintViolations(
    {
      person: nurse,
      day: 1,
      dayOfWeek: 0,
      isHoliday: false,
      candidateShift: 'M',
      assignments,
      totalDays: TOTAL_DAYS,
      requests: [hardOff],
    },
    VERIFICATION_HARD_RULES
  );
  assert.ok(internalViolations.includes('HARD_OFF'));

  const verification = verifyCoverageAndLeaders(
    YEAR, MONTH, [nurse], assignments, settingsWithDemand(), {}, undefined, [hardOff]
  );
  const surfaced = verification.structuredWarnings.filter(warning =>
    warning.personnelId === nurse.id && warning.day === 1
  );

  assert.deepEqual(surfaced.map(warning => warning.code), ['HARD_CONSTRAINT_VIOLATION']);
  assert.equal(surfaced[0].severity, 'critical');
  assert.equal(surfaced[0].metadata?.violation, 'HARD_OFF');
  assert.equal(countCriticalScheduleWarnings(surfaced), 1);
  assert.equal(
    surfaced.some(warning => warning.code === 'MISMATCHED_REQUEST'),
    false,
    'a hard OFF breach is no longer surfaced only as a generic request mismatch'
  );
});

test('regression_surfaces_manual_leave_violation_as_structured_critical_warning', async () => {
  const nurse = person('manual-leave');
  const leave: ShiftRequest = {
    id: 'leave-day-1',
    personnelId: nurse.id,
    requestType: 'leave',
    preferredShift: 'L',
    isEssential: false,
    scope: 'custom_days',
    selectedDays: [1],
  };

  const beforeViolations = evaluateHardConstraintViolations(
    {
      person: nurse,
      day: 1,
      dayOfWeek: 0,
      isHoliday: false,
      candidateShift: 'M',
      assignments: { [nurse.id]: { 1: 'L1' } },
      totalDays: TOTAL_DAYS,
      requests: [leave],
    },
    ALL_HARD_RULES
  );
  assert.ok(beforeViolations.includes('LEAVE_CELL'));
  assert.ok(beforeViolations.includes('LEAVE_REQUEST'));

  const result = await applyProtectedManualEdit({
    person: nurse,
    currentShift: 'L1',
    newShift: 'M',
    requests: [leave],
  });
  assert.equal(result.success, true);
  assert.equal(result.schedule?.assignments[nurse.id][1], 'M');

  const assignments = result.schedule!.assignments;
  const finalInternalViolations = evaluateHardConstraintViolations(
    {
      person: nurse,
      day: 1,
      dayOfWeek: 0,
      isHoliday: false,
      candidateShift: 'M',
      assignments,
      totalDays: TOTAL_DAYS,
      requests: [leave],
    },
    VERIFICATION_HARD_RULES
  );
  assert.deepEqual(finalInternalViolations, ['LEAVE_REQUEST']);

  const verification = verifyCoverageAndLeaders(
    YEAR, MONTH, [nurse], assignments, settingsWithDemand(), {}, undefined, [leave]
  );
  const surfaced = verification.structuredWarnings.filter(warning =>
    warning.personnelId === nurse.id && warning.day === 1
  );

  assert.deepEqual(surfaced.map(warning => warning.code), ['HARD_CONSTRAINT_VIOLATION']);
  assert.equal(surfaced[0].severity, 'critical');
  assert.equal(surfaced[0].metadata?.violation, 'LEAVE_REQUEST');
  assert.equal(countCriticalScheduleWarnings(surfaced), 1);
  assert.equal(
    surfaced.some(warning => warning.code === 'MISMATCHED_REQUEST'),
    false,
    'a work assignment on approved leave is no longer surfaced only as a generic mismatch'
  );
});

// ---------------------------------------------------------------------------
// Finalization and protected-cell lifecycle boundaries
// ---------------------------------------------------------------------------

test('regression_continuous_reconciliation_excludes_finalized_job_groups', () => {
  const nurse = person('finalized-nurse');
  const assistant = person('mutated-assistant', {
    jobGroup: 'assistant',
    position: 'none',
    canBeShiftLeader: false,
  });
  const schedule = scheduleWith(
    {
      [nurse.id]: { 1: 'M' },
      [assistant.id]: { 1: 'E' },
    },
    { finalizedNurses: true, finalizedAssistants: false }
  );

  // This mirrors the last automatic writer: finalized metadata is translated to
  // mutable target groups before reconciliation begins.
  const targetJobGroups = getUnfinalizedJobGroups(schedule);
  const reconciled = reconcileStaffingCoverage(
    schedule.assignments,
    [nurse, assistant],
    settingsWithDemand(),
    oneDayCalendar(),
    targetJobGroups,
    [],
    []
  );
  const effectStyleResult: MonthlySchedule = {
    ...schedule,
    assignments: reconciled.assignments,
  };

  assert.deepEqual(targetJobGroups, ['assistant']);
  assert.equal(effectStyleResult.finalizedNurses, true);
  assert.equal(
    effectStyleResult.assignments[nurse.id][1],
    'M',
    'the finalized nurse row remains immutable'
  );
  assert.equal(effectStyleResult.assignments[assistant.id][1], 'OFF');
});

const PROTECTED_CONTEXT = {
  departmentId: 'department-a',
  year: YEAR,
  month: MONTH,
};

function reconcileProtectedContext(
  allProtectedCells: ReadonlySet<string>,
  context = PROTECTED_CONTEXT
) {
  const nurse = person('protected-person');
  const localProtectedCells = protectedCellsForContext(allProtectedCells, context);
  return reconcileStaffingCoverage(
    { [nurse.id]: { 1: 'M' } },
    [nurse],
    settingsWithDemand(),
    oneDayCalendar(),
    ['nurse'],
    [],
    [],
    localProtectedCells
  );
}

test('regression_preserves_protected_cell_within_same_context', () => {
  const protectedCells = new Set([
    protectedCellKey(PROTECTED_CONTEXT, 'protected-person', 1),
  ]);
  const localProtectedCells = protectedCellsForContext(protectedCells, PROTECTED_CONTEXT);
  const firstPass = reconcileProtectedContext(protectedCells);
  const secondPass = reconcileStaffingCoverage(
    firstPass.assignments,
    [person('protected-person')],
    settingsWithDemand(),
    oneDayCalendar(),
    ['nurse'],
    [],
    [],
    localProtectedCells
  );

  assert.deepEqual([...localProtectedCells], ['protected-person:1']);
  assert.equal(firstPass.assignments['protected-person'][1], 'M');
  assert.equal(secondPass.assignments['protected-person'][1], 'M');
});

test('regression_does_not_reuse_protected_cell_across_month_change', () => {
  const sessionProtectedCells = new Set([
    protectedCellKey(PROTECTED_CONTEXT, 'protected-person', 1),
  ]);

  const monthOne = reconcileProtectedContext(sessionProtectedCells, PROTECTED_CONTEXT);
  const monthTwo = reconcileProtectedContext(sessionProtectedCells, {
    ...PROTECTED_CONTEXT,
    month: MONTH + 1,
  });

  assert.equal(monthOne.assignments['protected-person'][1], 'M');
  assert.equal(monthTwo.assignments['protected-person'][1], 'OFF');
});

test('regression_does_not_reuse_protected_cell_across_department_change', () => {
  const sessionProtectedCells = new Set([
    protectedCellKey(PROTECTED_CONTEXT, 'protected-person', 1),
  ]);

  const departmentOne = reconcileProtectedContext(sessionProtectedCells, PROTECTED_CONTEXT);
  const departmentTwo = reconcileProtectedContext(sessionProtectedCells, {
    ...PROTECTED_CONTEXT,
    departmentId: 'department-b',
  });

  assert.equal(departmentOne.assignments['protected-person'][1], 'M');
  assert.equal(departmentTwo.assignments['protected-person'][1], 'OFF');
});

// ---------------------------------------------------------------------------
// OFF-after-leave postprocessing
// ---------------------------------------------------------------------------

test('characterizes_current_OFF_after_leave_postprocessor_as_choosing_M_when_coverage_retains_it', () => {
  const nurse = person('leave-then-work');
  const leave: ShiftRequest = {
    id: 'leave-first-day',
    personnelId: nurse.id,
    requestType: 'leave',
    preferredShift: 'L',
    isEssential: false,
    scope: 'custom_days',
    selectedDays: [1],
  };

  const blockingPattern: ShiftRequest = {
    id: 'pattern-keeps-day-2-off-until-postprocessing',
    personnelId: nurse.id,
    requestType: 'pattern',
    patternSteps: ['OFF'],
    isEssential: false,
    scope: 'all',
  };

  const solved = solveNursingSchedule(
    YEAR,
    MONTH,
    [nurse],
    [leave, blockingPattern],
    sameDemand({ morningNurse: 1 }),
    {},
    undefined,
    null
  );

  assert.equal(solved.assignments[nurse.id][1], 'L1');
  assert.equal(solved.assignments[nurse.id][2], 'M');
  assert.ok(solved.warnings.some(warning =>
    warning.startsWith('OFF Removed:')
    && warning.includes('روز 2')
    && warning.includes('ممنوعیت آف بعد از مرخصی')
  ));
});

test('regression_removes_stale_OFF_REMOVED_notice_after_final_reconciliation_restores_OFF', () => {
  const nurse = person('leave-then-final-off');
  const leave: ShiftRequest = {
    id: 'leave-first-day-zero-demand',
    personnelId: nurse.id,
    requestType: 'leave',
    preferredShift: 'L',
    isEssential: false,
    scope: 'custom_days',
    selectedDays: [1],
  };

  const directReconcile = reconcileStaffingCoverage(
    { [nurse.id]: { 1: 'L1', 2: 'M' } },
    [nurse],
    settingsWithDemand(),
    [
      { day: 1, dayOfWeek: 0, isHoliday: false },
      { day: 2, dayOfWeek: 1, isHoliday: false },
    ],
    ['nurse'],
    [],
    [leave]
  );
  assert.equal(directReconcile.assignments[nurse.id][2], 'OFF');

  const solved = solveNursingSchedule(
    YEAR,
    MONTH,
    [nurse],
    [leave],
    settingsWithDemand(),
    {},
    undefined,
    null
  );
  const offRemoved = solved.warnings.find(warning =>
    warning.startsWith('OFF Removed:')
    && warning.includes('روز 2')
    && warning.includes('ممنوعیت آف بعد از مرخصی')
  );

  assert.equal(solved.assignments[nurse.id][1], 'L1');
  assert.equal(solved.assignments[nurse.id][2], 'OFF');
  assert.equal(
    offRemoved,
    undefined,
    'an intermediate OFF removal is not reported when the final cell is OFF again'
  );
});

// ---------------------------------------------------------------------------
// Leader settings and scenario critical-gate parity
// ---------------------------------------------------------------------------

function leaderWarningFor(
  shift: 'E' | 'N',
  assignments: MonthlySchedule['assignments'],
  settings: SystemSettings,
  personnel: Personnel[]
) {
  const verification = verifyCoverageAndLeaders(
    YEAR, MONTH, personnel, assignments, settings, {}, undefined, []
  );
  return verification.structuredWarnings.find(warning =>
    warning.code === 'MISSING_SHIFT_LEADER'
    && warning.day === 1
    && warning.shift === shift
  );
}

test('characterizes_afternoonLeader_zero_as_still_requiring_an_E_leader_when_E_demand_is_positive', () => {
  const unqualified = person('unqualified-evening', { canBeShiftLeader: false });
  const warning = leaderWarningFor(
    'E',
    { [unqualified.id]: { 1: 'E' } },
    sameDemand({ afternoonNurse: 1, afternoonLeader: 0 }),
    [unqualified]
  );

  assert.ok(warning);
  assert.equal(warning!.severity, 'critical');
});

test('characterizes_nightLeader_zero_as_still_requiring_an_N_leader_when_N_demand_is_positive', () => {
  const unqualified = person('unqualified-night', { canBeShiftLeader: false });
  const warning = leaderWarningFor(
    'N',
    { [unqualified.id]: { 1: 'N' } },
    sameDemand({ nightNurse: 1, nightLeader: 0 }),
    [unqualified]
  );

  assert.ok(warning);
  assert.equal(warning!.severity, 'critical');
});

test('characterizes_zero_E_demand_as_still_producing_a_missing_E_leader_warning_and_scenario_gate', () => {
  const nurse = person('zero-evening-demand');
  const assignments = { [nurse.id]: { 1: 'OFF' } };
  const settings = sameDemand({ afternoonNurse: 0, afternoonLeader: 0 });
  const warning = leaderWarningFor('E', assignments, settings, [nurse]);

  assert.ok(warning);
  assert.equal(warning!.severity, 'critical');
  assert.equal(isCriticalScheduleWarning(warning!), true);

  const plainSchedule = scheduleWith(assignments, { warnings: [warning!.message] });
  const objective = evaluateBaselineObjective({
    baseline: plainSchedule,
    candidate: plainSchedule,
    warnings: plainSchedule.warnings,
    structuredWarnings: [warning!],
    targetPersonnelIds: [nurse.id],
    totalDays: TOTAL_DAYS,
    lockedRows: [],
    requestSatisfactionPercent: 100,
  });
  assert.equal(objective.criticalResolved, false, 'the normal verifier warning is a scenario hard gate');
  assert.equal(objective.criticalWarningCount, 1);
});

test('characterizes_zero_N_demand_as_still_producing_a_missing_N_leader_warning', () => {
  const nurse = person('zero-night-demand');
  const warning = leaderWarningFor(
    'N',
    { [nurse.id]: { 1: 'OFF' } },
    sameDemand({ nightNurse: 0, nightLeader: 0 }),
    [nurse]
  );

  assert.ok(warning);
  assert.equal(warning!.severity, 'critical');
});

// ---------------------------------------------------------------------------
// person.locked versus lockedRows
// ---------------------------------------------------------------------------

const ALL_PERIODS_DEMAND = sameDemand({
  morningNurse: 1,
  afternoonNurse: 1,
  nightNurse: 1,
});

function scenarioPersonnel(): Personnel[] {
  return [person('n1'), person('n2'), person('n3'), person('n4')];
}

test('regression_scenario_generation_preserves_both_person_locked_and_lockedRows', () => {
  const unlockedPersonnel = scenarioPersonnel();
  const baseline = solveNursingSchedule(
    YEAR, MONTH, unlockedPersonnel, [], ALL_PERIODS_DEMAND, {}, undefined, null
  ).assignments;

  const personLockedPersonnel = scenarioPersonnel().map(item =>
    item.id === 'n1' ? { ...item, locked: true } : item
  );
  const personLockedResult = generateAndScoreScenarios(
    YEAR,
    MONTH,
    personLockedPersonnel,
    [],
    ALL_PERIODS_DEMAND,
    {},
    undefined,
    null,
    'nurse',
    baseline,
    []
  );
  assert.ok(personLockedResult.top3.length > 0);
  for (const scenario of personLockedResult.top3) {
    assert.equal(
      rowsDiffer(baseline.n1, scenario.schedule.assignments.n1),
      false,
      'person.locked is excluded from the free scenario target set'
    );
  }

  const rowLockedResult = generateAndScoreScenarios(
    YEAR,
    MONTH,
    unlockedPersonnel,
    [],
    ALL_PERIODS_DEMAND,
    {},
    undefined,
    null,
    'nurse',
    baseline,
    ['n1']
  );
  assert.ok(rowLockedResult.top3.length > 0);
  for (const scenario of rowLockedResult.top3) {
    assert.equal(rowsDiffer(baseline.n1, scenario.schedule.assignments.n1), false);
  }
});

test('regression_optimizer_merge_preserves_both_person_locked_and_lockedRows', () => {
  const lockedPerson = person('merge-locked-person', { locked: true });
  const current = { [lockedPerson.id]: { 1: 'OFF' } };
  const optimized = { [lockedPerson.id]: { 1: 'M' } };

  const withoutRowLock = mergeOptimizerAssignments(
    current,
    optimized,
    [lockedPerson],
    'nurse',
    []
  );
  const withRowLock = mergeOptimizerAssignments(
    current,
    optimized,
    [lockedPerson],
    'nurse',
    [lockedPerson.id]
  );
  const withoutCurrentSchedule = mergeOptimizerAssignments(
    undefined,
    optimized,
    [lockedPerson],
    'nurse',
    []
  );

  assert.equal(withoutRowLock[lockedPerson.id][1], 'OFF');
  assert.equal(withRowLock[lockedPerson.id][1], 'OFF');
  assert.deepEqual(withoutCurrentSchedule[lockedPerson.id], {});
});

// ---------------------------------------------------------------------------
// Manual facade write boundary: finalized groups and lockedRows are enforced
// at the facade itself (not only in the UI). person.locked semantics remain
// policy-pending and are intentionally NOT enforced here.
// ---------------------------------------------------------------------------

async function applyDirectFacadeEdit(options: {
  person: Personnel;
  finalizedNursesMonths?: string[];
  finalizedAssistantsMonths?: string[];
  lockedRows?: string[];
  onSave?: () => void;
}) {
  const currentSchedule = scheduleWith({
    [options.person.id]: { 1: 'OFF' },
  });

  return applyManualShiftChangeFacade(
    {
      personnelId: options.person.id,
      day: 1,
      shift: 'M',
      year: YEAR,
      month: MONTH,
      currentSchedule,
      personnel: [options.person],
      requests: [],
      settings: settingsWithDemand(),
      holidays: {},
      firstDayOfWeek: undefined,
      lockState: {
        finalizedNursesMonths: options.finalizedNursesMonths ?? [],
        finalizedAssistantsMonths: options.finalizedAssistantsMonths ?? [],
        lockedRows: options.lockedRows ?? [],
      },
      protectedCells: [`${options.person.id}:1`],
    },
    verifyCoverageAndLeaders,
    {
      saveSchedule: async () => {
        options.onSave?.();
      },
    },
    'characterization-department'
  );
}

test('regression_manual_facade_rejects_write_for_finalized_nurse_group', async () => {
  let persisted = 0;
  const nurse = person('facade-finalized-nurse');
  const result = await applyDirectFacadeEdit({
    person: nurse,
    finalizedNursesMonths: [`${YEAR}_${MONTH}`],
    onSave: () => { persisted += 1; },
  });

  assert.equal(result.success, false);
  assert.equal(result.schedule, null);
  assert.ok(result.error, 'a rejection reason is returned');
  assert.equal(persisted, 0, 'a rejected mutation never reaches persistence');
});

test('regression_manual_facade_rejects_write_for_finalized_assistant_group', async () => {
  let persisted = 0;
  const assistant = person('facade-finalized-assistant', { jobGroup: 'assistant', position: 'none', canBeShiftLeader: false });
  const result = await applyDirectFacadeEdit({
    person: assistant,
    finalizedAssistantsMonths: [`${YEAR}_${MONTH}`],
    onSave: () => { persisted += 1; },
  });

  assert.equal(result.success, false);
  assert.equal(result.schedule, null);
  assert.equal(persisted, 0, 'a rejected mutation never reaches persistence');
});

test('regression_manual_facade_rejects_write_for_locked_row', async () => {
  let persisted = 0;
  const nurse = person('facade-locked-row');
  const result = await applyDirectFacadeEdit({
    person: nurse,
    lockedRows: [nurse.id],
    onSave: () => { persisted += 1; },
  });

  assert.equal(result.success, false);
  assert.equal(result.schedule, null);
  assert.equal(persisted, 0, 'a rejected mutation never reaches persistence');
});

test('regression_manual_facade_accepts_write_for_unlocked_row_and_group', async () => {
  let persisted = 0;
  const nurse = person('facade-unlocked');
  const result = await applyDirectFacadeEdit({
    person: nurse,
    // Finalized months for OTHER months / the other group do not block this cell.
    finalizedNursesMonths: [`${YEAR}_${MONTH + 1}`],
    finalizedAssistantsMonths: [`${YEAR}_${MONTH}`],
    lockedRows: ['someone-else'],
    onSave: () => { persisted += 1; },
  });

  assert.equal(result.success, true);
  assert.equal(result.schedule?.assignments[nurse.id][1], 'M');
  assert.equal(persisted, 1, 'the accepted mutation is persisted exactly once');
});

test('characterizes_manual_facade_as_not_enforcing_person_locked_alone', async () => {
  // person.locked semantics remain policy-pending: the facade only enforces the
  // finalized-group and lockedRows promises that the UI already makes.
  const personLockedOnly = person('manual-locked-person', { locked: true });
  const result = await applyProtectedManualEdit({
    person: personLockedOnly,
    currentShift: 'OFF',
    newShift: 'M',
  });

  assert.equal(result.success, true);
  assert.equal(
    result.schedule?.assignments[personLockedOnly.id][1],
    'M',
    'person.locked alone does not block the facade write (policy-pending)'
  );
});

// ---------------------------------------------------------------------------
// avoid_shift divergence
// ---------------------------------------------------------------------------

function avoidMorningRequest(personnelId: string): ShiftRequest {
  return {
    id: `avoid-m-${personnelId}`,
    personnelId,
    requestType: 'avoid_shift',
    preferredShift: 'M',
    isEssential: false,
    scope: 'custom_days',
    selectedDays: [1],
  };
}

test('characterizes_normal_fill_as_respecting_avoid_shift_when_an_alternative_exists', () => {
  const avoiding = person('avoid-normal');
  const alternative = person('normal-alternative');
  const request = avoidMorningRequest(avoiding.id);

  const solved = solveNursingSchedule(
    YEAR,
    MONTH,
    [avoiding, alternative],
    [request],
    sameDemand({ morningNurse: 1 }),
    {},
    undefined,
    null
  );

  assert.equal(solved.assignments[avoiding.id][1], 'OFF');
  assert.equal(solved.assignments[alternative.id][1], 'M');
});

test('characterizes_emergency_fill_as_bypassing_avoid_shift_when_it_is_the_only_coverage_option', () => {
  const avoiding = person('avoid-emergency');
  const request = avoidMorningRequest(avoiding.id);

  const solved = solveNursingSchedule(
    YEAR,
    MONTH,
    [avoiding],
    [request],
    sameDemand({ morningNurse: 1 }),
    {},
    undefined,
    null
  );

  assert.equal(solved.assignments[avoiding.id][1], 'M');
  assert.ok(solved.warnings.some(warning =>
    warning.startsWith('Mismatched Request:')
    && warning.includes('روز 1')
    && warning.includes('عدم تخصیص شیفت M')
  ));
});

test('characterizes_reconciliation_as_ignoring_avoid_shift', () => {
  const avoiding = person('avoid-reconcile');
  const request = avoidMorningRequest(avoiding.id);

  const reconciled = reconcileStaffingCoverage(
    { [avoiding.id]: { 1: 'OFF' } },
    [avoiding],
    sameDemand({ morningNurse: 1 }),
    oneDayCalendar(),
    ['nurse'],
    [],
    [request]
  );

  assert.equal(reconciled.assignments[avoiding.id][1], 'M');
});

test('characterizes_scenario_scoring_as_penalizing_avoid_shift_mismatch', () => {
  const avoiding = person('avoid-score');
  const request = avoidMorningRequest(avoiding.id);
  const settings = settingsWithDemand();
  const common = {
    id: 1,
    type: 'REQUESTS' as const,
    personnelList: [avoiding],
    requests: [request],
    settings,
    year: YEAR,
    month: MONTH,
    customHolidays: {},
    firstDayOfWeekIndex: undefined,
    monthlyDutyHours: null,
    targetJobGroup: 'nurse' as JobGroup,
  };

  const violated = evaluateScenarioSchedule({
    ...common,
    schedule: scheduleWith({ [avoiding.id]: { 1: 'M' } }),
  });
  const satisfied = evaluateScenarioSchedule({
    ...common,
    schedule: scheduleWith({ [avoiding.id]: { 1: 'OFF' } }),
  });

  assert.equal(violated.metrics.requestScore, 0);
  assert.equal(satisfied.metrics.requestScore, 100);
});

// ---------------------------------------------------------------------------
// workRoutine divergence
// ---------------------------------------------------------------------------

function routineScenarioPersonnel(): Personnel[] {
  return [
    person('n1', { workRoutine: 'morning' }),
    person('n2', { workRoutine: 'long' }),
    person('n3'),
    person('n4', { workRoutine: 'evening_night' }),
  ];
}

function routineMismatch(shift: ShiftType, routine: WorkRoutineTag): boolean {
  if (shift === 'OFF' || shift.startsWith('L')) return false;
  if (routine === 'morning') return shift.includes('E') || shift.includes('N');
  if (routine === 'evening_night') return shift.includes('M');
  return shift.includes('N');
}

test('characterizes_normal_solver_as_routine_compatible_but_scenario_row_swaps_as_routine_agnostic', () => {
  const personnel = routineScenarioPersonnel();
  const baseline = solveNursingSchedule(
    YEAR, MONTH, personnel, [], ALL_PERIODS_DEMAND, {}, undefined, null
  ).assignments;

  for (const worker of personnel.filter(item => item.workRoutine)) {
    const shifts = Object.values(baseline[worker.id]);
    assert.equal(
      shifts.some(shift => routineMismatch(shift, worker.workRoutine!)),
      false,
      `normal baseline should be routine-compatible for ${worker.workRoutine}`
    );
  }

  const generated = generateAndScoreScenarios(
    YEAR,
    MONTH,
    personnel,
    [],
    ALL_PERIODS_DEMAND,
    {},
    undefined,
    null,
    'nurse',
    baseline,
    []
  );
  assert.ok(generated.top3.length > 0);

  for (const routine of ['morning', 'long', 'evening_night'] as const) {
    const worker = personnel.find(item => item.workRoutine === routine)!;
    assert.ok(
      generated.top3.some(scenario =>
        Object.values(scenario.schedule.assignments[worker.id] || {})
          .some(shift => routineMismatch(shift, routine))
      ),
      `current scenario row swaps should be able to introduce a ${routine} mismatch`
    );
  }
});

test('characterizes_reconciliation_as_treating_all_routines_as_preferences_not_hard_restrictions', () => {
  const cases: Array<{
    routine: WorkRoutineTag;
    period: 'M' | 'E' | 'N';
    demand: Partial<SystemSettings['demand']['weekday']>;
  }> = [
    { routine: 'morning', period: 'E', demand: { afternoonNurse: 1 } },
    { routine: 'evening_night', period: 'M', demand: { morningNurse: 1 } },
    { routine: 'long', period: 'N', demand: { nightNurse: 1 } },
  ];

  for (const current of cases) {
    const worker = person(`only-${current.routine}`, { workRoutine: current.routine });
    const reconciled = reconcileStaffingCoverage(
      { [worker.id]: { 1: 'OFF' } },
      [worker],
      sameDemand(current.demand),
      oneDayCalendar(),
      ['nurse'],
      [],
      []
    );

    assert.equal(
      shiftCoversPeriod(reconciled.assignments[worker.id][1], current.period),
      true,
      `${current.routine} must remain a legal last-resort candidate for ${current.period}`
    );
  }
});

// ---------------------------------------------------------------------------
// Hidden normal-only heuristics
// ---------------------------------------------------------------------------

test('characterizes_max_two_nonexplicit_MN_as_normal_candidate_filter_only', () => {
  const primary = person('mn-primary');
  const alternative = person('mn-alternative');
  const requests = [
    shiftRequest('two-mn', primary.id, 'MN', [1, 3]),
    shiftRequest('morning-target', primary.id, 'M', [5]),
  ];

  const normal = solveNursingSchedule(
    YEAR,
    MONTH,
    [primary, alternative],
    requests,
    settingsWithDemand({}, { nightNurse: 1 }),
    { 5: 'characterization holiday' },
    undefined,
    null
  );
  assert.equal(normal.assignments[primary.id][5], 'M');
  assert.equal(normal.assignments[alternative.id][5], 'N');
  assert.equal(
    Object.values(normal.assignments[primary.id]).filter(shift => shift === 'MN').length,
    2
  );

  const reconciled = reconcileStaffingCoverage(
    { [primary.id]: { 1: 'MN', 3: 'MN', 5: 'M' } },
    [primary],
    sameDemand({ morningNurse: 1, nightNurse: 1 }),
    oneDayCalendar(5),
    ['nurse'],
    [],
    requests
  );
  assert.equal(reconciled.assignments[primary.id][5], 'MN');
});

test('characterizes_max_one_nonexplicit_E_only_as_normal_candidate_filter_only', () => {
  const primary = person('e-primary');
  const alternative = person('e-alternative');
  const requests = [shiftRequest('existing-e', primary.id, 'E', [1])];

  const normal = solveNursingSchedule(
    YEAR,
    MONTH,
    [primary, alternative],
    requests,
    settingsWithDemand({}, { afternoonNurse: 1 }),
    { 5: 'characterization holiday' },
    undefined,
    null
  );
  assert.equal(normal.assignments[primary.id][5], 'OFF');
  assert.equal(normal.assignments[alternative.id][5], 'E');

  const reconciled = reconcileStaffingCoverage(
    { [primary.id]: { 1: 'E', 5: 'OFF' } },
    [primary],
    sameDemand({ afternoonNurse: 1 }),
    oneDayCalendar(5),
    ['nurse'],
    [],
    requests
  );
  assert.equal(reconciled.assignments[primary.id][5], 'E');
});

test('characterizes_max_two_unrequested_extras_as_normal_candidate_filter_only', () => {
  const planned = person('planned-worker');
  const alternative = person('extra-alternative');
  const requests: ShiftRequest[] = [
    shiftRequest('future-plan', planned.id, 'M', [31]),
    {
      id: 'alternative-hard-off',
      personnelId: alternative.id,
      requestType: 'OFF',
      preferredShift: 'OFF',
      offHardness: 'hard',
      isEssential: false,
      scope: 'custom_days',
      selectedDays: [1, 2],
    },
  ];

  const normal = solveNursingSchedule(
    YEAR,
    MONTH,
    [planned, alternative],
    requests,
    sameDemand({ morningNurse: 1 }),
    {},
    undefined,
    null
  );
  assert.equal(normal.assignments[planned.id][1], 'M');
  assert.equal(normal.assignments[planned.id][2], 'M');
  assert.equal(normal.assignments[planned.id][3], 'OFF');
  assert.equal(normal.assignments[alternative.id][3], 'M');

  const reconciled = reconcileStaffingCoverage(
    { [planned.id]: { 1: 'M', 2: 'M', 3: 'OFF' } },
    [planned],
    sameDemand({ morningNurse: 1 }),
    oneDayCalendar(3),
    ['nurse'],
    [],
    requests
  );
  assert.equal(reconciled.assignments[planned.id][3], 'M');
});

test('characterizes_240_hour_overtime_filter_as_normal_candidate_filter_only', () => {
  const overtime = person('overtime-primary', { employmentType: 'overtime' });
  const alternative = person('overtime-alternative');
  const firstEighteenDays = Array.from({ length: 18 }, (_, index) => index + 1);
  const requests = [shiftRequest('eighteen-long-shifts', overtime.id, 'ME', firstEighteenDays)];

  const normal = solveNursingSchedule(
    YEAR,
    MONTH,
    [overtime, alternative],
    requests,
    settingsWithDemand({}, { morningNurse: 1 }),
    { 19: 'characterization holiday' },
    undefined,
    null
  );
  const normalHours = Object.values(normal.assignments[overtime.id])
    .reduce((sum, shift) => sum + getShiftHours(shift, overtime.employmentType), 0);
  assert.equal(normalHours, 234);
  assert.ok(normalHours + getShiftHours('M', overtime.employmentType) > 240);
  assert.equal(normal.assignments[overtime.id][19], 'OFF');
  assert.equal(normal.assignments[alternative.id][19], 'M');

  const overtimeRow: Record<number, ShiftType> = Object.fromEntries(
    firstEighteenDays.map(day => [day, 'ME'])
  );
  overtimeRow[19] = 'OFF';
  const reconciled = reconcileStaffingCoverage(
    { [overtime.id]: overtimeRow },
    [overtime],
    sameDemand({ morningNurse: 1 }),
    oneDayCalendar(19),
    ['nurse'],
    [],
    requests
  );
  assert.equal(reconciled.assignments[overtime.id][19], 'M');
});

// ---------------------------------------------------------------------------
// Mandatory Rest is a next-month boundary reminder, not a current-month gate
// ---------------------------------------------------------------------------

test('regression_legal_end_of_month_run_at_exactly_weight_5_is_not_gated_or_repaired_as_mandatory_rest', () => {
  const nurse = person('boundary-cap-nurse');
  // EN (day 30) + ME (day 31) = 1+2+1+1 = exactly 5 weighted units — legal.
  const assignments = { [nurse.id]: { 30: 'EN', 31: 'ME' } };

  const verification = verifyCoverageAndLeaders(
    YEAR, MONTH, [nurse], assignments, settingsWithDemand(), {}, undefined, []
  );

  // 1) No MAX_CONSECUTIVE violation: the workload arithmetic (>5 illegal) is untouched.
  assert.equal(
    verification.warnings.some(warning => warning.startsWith('Max Consecutive:')),
    false,
    'a weighted run of exactly 5 is legal for the current month'
  );

  // 2) The run stays scenario-eligible: neither the workload run nor the
  //    boundary reminder is critical. (Unrelated shift-leader warnings from the
  //    minimal one-person roster are excluded — they are not under test.)
  const runWarnings = verification.structuredWarnings.filter(
    warning => warning.code === 'MAX_CONSECUTIVE' || warning.code === 'MANDATORY_REST'
  );
  assert.equal(countCriticalScheduleWarnings(runWarnings), 0);
  const plainSchedule = scheduleWith(assignments, { warnings: runWarnings.map(w => w.message) });
  const objective = evaluateBaselineObjective({
    baseline: plainSchedule,
    candidate: plainSchedule,
    warnings: plainSchedule.warnings,
    structuredWarnings: runWarnings,
    targetPersonnelIds: [nurse.id],
    totalDays: TOTAL_DAYS,
    lockedRows: [],
    requestSatisfactionPercent: 100,
  });
  assert.equal(objective.criticalResolved, true, 'the legal boundary run is not a scenario hard gate');

  // 3) Critical repair never deletes a current-month work cell solely because of
  //    the boundary reminder — even if a MANDATORY_REST warning is present.
  const reminderOnly: VerifiedSchedule = {
    year: YEAR,
    month: MONTH,
    assignments: assignments as MonthlySchedule['assignments'],
    shiftLeaders: {},
    warnings: ['Mandatory Rest: synthetic reminder'],
    structuredWarnings: [{
      code: 'MANDATORY_REST',
      severity: 'warning',
      message: 'Mandatory Rest: synthetic reminder',
      personnelId: nurse.id,
    }],
  };
  const edits = generateCriticalRepairEdits(reminderOnly, {
    freeTargetPersonnel: [nurse],
    totalDays: TOTAL_DAYS,
    requests: [],
    calendarDays: [{ day: 30, dayOfWeek: 0, isHoliday: false }, { day: 31, dayOfWeek: 1, isHoliday: false }],
  });
  assert.deepEqual(edits, [], 'no repair edit deletes a legal current-month work cell for the reminder');
});

test('regression_actual_weight_over_5_violation_still_reports_max_consecutive_and_keeps_the_boundary_reminder', () => {
  const nurse = person('boundary-breach-nurse');
  // N (day 30) + MEN (day 31) = 2+1+1+2 = 6 weighted units — a genuine breach
  // whose run also reaches the month boundary at the final night.
  const verification = verifyCoverageAndLeaders(
    YEAR, MONTH, [nurse], { [nurse.id]: { 30: 'N', 31: 'MEN' } }, settingsWithDemand(), {}, undefined, []
  );

  const maxConsecutive = verification.structuredWarnings.find(w => w.code === 'MAX_CONSECUTIVE');
  assert.ok(maxConsecutive, 'the actual weight > 5 violation is still reported');
  assert.equal(isCriticalScheduleWarning(maxConsecutive!), true, 'MAX_CONSECUTIVE remains critical');

  const reminder = verification.structuredWarnings.find(w => w.code === 'MANDATORY_REST');
  assert.ok(reminder, 'the boundary reminder is preserved for reporting');
  assert.equal(isCriticalScheduleWarning(reminder!), false, 'the reminder itself is not a level-A gate');
});

test('regression_normal_candidate_filter_honors_the_configured_overtime_cap', () => {
  // Same roster for every configured cap. The overtime person accumulates
  // 156h (12 × ME) before the first uncovered holiday (day 19, Friday), where
  // holiday demand asks for one extra morning nurse (M = +6.5h → 162.5h).
  const buildRoster = () => {
    const overtime = person('overtime-capped', { employmentType: 'overtime' });
    const alternative = person('overtime-cap-alternative');
    const requests = [
      shiftRequest('cap-overtime-plan', overtime.id, 'ME', Array.from({ length: 12 }, (_, index) => index + 1)),
      shiftRequest('cap-alternative-plan', alternative.id, 'ME', Array.from({ length: 14 }, (_, index) => index + 1)),
    ];
    return { overtime, alternative, requests };
  };

  const solveWithCap = (overtimeCap: number) => {
    const { overtime, alternative, requests } = buildRoster();
    const settings: SystemSettings = {
      dutyHours: { official: 176, contract: 190, conscript: 200, overtime: overtimeCap },
      demand: {
        weekday: { ...ZERO_DEMAND },
        holiday: { ...ZERO_DEMAND, morningNurse: 1 },
      },
    };
    const solved = solveNursingSchedule(
      YEAR, MONTH, [overtime, alternative], requests, settings, {}, undefined, null
    );
    return { solved, overtime, alternative };
  };

  // Configured cap 240: 156 + 6.5 = 162.5 ≤ 240 → the overtime person stays eligible.
  const highCap = solveWithCap(240);
  assert.equal(highCap.solved.assignments[highCap.overtime.id][19], 'M');
  assert.equal(highCap.solved.assignments[highCap.alternative.id][19], 'OFF');

  // Configured cap 150: 156 + 6.5 > 150 → filtered out; the alternative covers the gap.
  const lowCap = solveWithCap(150);
  assert.equal(lowCap.solved.assignments[lowCap.overtime.id][19], 'OFF');
  assert.equal(lowCap.solved.assignments[lowCap.alternative.id][19], 'M');

  // Exact boundary: 156 + 6.5 = 162.5 is NOT beyond the cap → still eligible.
  const exactCap = solveWithCap(162.5);
  assert.equal(exactCap.solved.assignments[exactCap.overtime.id][19], 'M');

  // One shift beyond the cap: 162.5 > 162 → rejected.
  const beyondCap = solveWithCap(162);
  assert.equal(beyondCap.solved.assignments[beyondCap.overtime.id][19], 'OFF');
  assert.equal(beyondCap.solved.assignments[beyondCap.alternative.id][19], 'M');

  // Unconfigured (0) keeps the historical 240 fallback, so pre-existing rosters
  // built with overtime: 0 behave exactly as before.
  const unconfigured = solveWithCap(0);
  assert.equal(unconfigured.solved.assignments[unconfigured.overtime.id][19], 'M');

  // Behavior unrelated to the overtime cap is unchanged: day 26 (the following
  // Friday) is covered by the official nurse in every configuration.
  for (const { solved, alternative } of [highCap, lowCap, exactCap, beyondCap, unconfigured]) {
    assert.equal(solved.assignments[alternative.id][26], 'M');
  }
});

test('characterizes_scenario_generation_as_not_enforcing_MN_E_only_or_extra_shift_heuristics', () => {
  const personnel = [person('n1'), person('n2'), person('n3'), person('n4'), person('n5')];
  const assignments: MonthlySchedule['assignments'] = Object.fromEntries(
    personnel.map(item => [item.id, {}])
  );

  for (let day = 1; day <= TOTAL_DAYS; day += 1) {
    const specialMNDay = [1, 3, 5].includes(day);
    assignments.n1[day] = specialMNDay ? 'MN' : 'OFF';
    assignments.n2[day] = specialMNDay ? 'OFF' : 'M';
    assignments.n5[day] = 'E';
    if (specialMNDay) {
      assignments.n3[day] = 'OFF';
      assignments.n4[day] = 'OFF';
    } else if (day % 2 === 0) {
      assignments.n3[day] = 'N';
      assignments.n4[day] = 'OFF';
    } else {
      assignments.n3[day] = 'OFF';
      assignments.n4[day] = 'N';
    }
  }
  assignments.n1[31] = 'M';
  assignments.n2[31] = 'OFF';

  const plan = [shiftRequest('n1-day-31-plan', 'n1', 'M', [31])];
  const verification = verifyCoverageAndLeaders(
    YEAR, MONTH, personnel, assignments, ALL_PERIODS_DEMAND, {}, undefined, plan
  );
  assert.equal(countCriticalScheduleWarnings(verification.structuredWarnings), 0);

  const generated = generateAndScoreScenarios(
    YEAR,
    MONTH,
    personnel,
    plan,
    ALL_PERIODS_DEMAND,
    {},
    undefined,
    null,
    'nurse',
    assignments,
    []
  );
  assert.ok(generated.top3.length > 0);
  for (const scenario of generated.top3) {
    assert.equal(
      Object.values(scenario.schedule.assignments.n1).filter(shift => shift === 'MN').length,
      3,
      'three non-explicit MN shifts survive scenario generation'
    );
    assert.equal(scenario.schedule.assignments.n1[31], 'M');
    assert.equal(scenario.criticalWarningCount, 0);
  }
  assert.ok(
    generated.top3.some(scenario =>
      Object.values(scenario.schedule.assignments.n5).filter(shift => shift === 'E').length > 1
    ),
    'more than one non-explicit E-only shift survives scenario generation'
  );
});

test('characterizes_scenario_generation_as_not_enforcing_the_240_hour_overtime_filter', () => {
  const overtime = person('overtime-scenario', { employmentType: 'overtime' });
  const personnel = [overtime, person('n1'), person('n2'), person('n3')];
  const assignments: MonthlySchedule['assignments'] = Object.fromEntries(
    personnel.map(item => [item.id, {}])
  );

  for (let day = 1; day <= TOTAL_DAYS; day += 1) {
    assignments[overtime.id][day] = 'ME';
    assignments.n1[day] = day % 2 === 1 ? 'N' : 'OFF';
    assignments.n2[day] = day % 2 === 0 ? 'N' : 'OFF';
    assignments.n3[day] = 'OFF';
  }

  const generated = generateAndScoreScenarios(
    YEAR,
    MONTH,
    personnel,
    [],
    ALL_PERIODS_DEMAND,
    {},
    undefined,
    null,
    'nurse',
    assignments,
    []
  );
  assert.ok(generated.top3.length > 0);
  for (const scenario of generated.top3) {
    const overtimeHours = Object.values(scenario.schedule.assignments[overtime.id])
      .reduce((sum, shift) => sum + getShiftHours(shift, overtime.employmentType), 0);
    assert.ok(overtimeHours > 240, `scenario ${scenario.scenarioKey} has ${overtimeHours} overtime hours`);
    assert.equal(scenario.criticalWarningCount, 0);
  }
});

test('characterizes_manual_cell_writer_as_not_applying_normal_only_heuristics', () => {
  const thirdMN = updateScheduleCell(
    { p: { 1: 'MN', 3: 'MN', 5: 'M' } },
    'p',
    5,
    'MN'
  );
  const secondE = updateScheduleCell(
    { p: { 1: 'E', 5: 'OFF' } },
    'p',
    5,
    'E'
  );
  const overtimeBeyondCap = updateScheduleCell(
    { p: { 19: 'OFF' } },
    'p',
    19,
    'M'
  );

  assert.equal(thirdMN.p[5], 'MN');
  assert.equal(secondE.p[5], 'E');
  assert.equal(overtimeBeyondCap.p[19], 'M');
});
