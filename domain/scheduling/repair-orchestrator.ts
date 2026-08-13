/**
 * Repair-before-warning orchestration.
 *
 * This pure domain layer coordinates legal automatic repairs before a caller
 * verifies and surfaces warnings. It does not replace the hard evaluator:
 * direct coverage relocation and reconcile candidates both pass the shared hard
 * evaluator. Source edits only remove offending components, so they cannot add
 * workload, a night, or an E/N assignment.
 *
 * Manual editing is intentionally outside this orchestrator. A protected manual
 * cell remains authoritative and is left for final verification to report.
 */

import type { JobGroup, Personnel, ShiftRequest, ShiftType, SystemSettings } from '../../lib/types';
import { isDayInRequestScope } from '../requests/request-scope-matcher';
import {
  COVERAGE_FILL_HARD_RULES,
  VERIFICATION_HARD_RULES,
  evaluateHardConstraintLegality,
  evaluateHardConstraintViolations,
} from './hard-constraints';
import {
  WORKLOAD_PERIODS,
  findConsecutiveCapViolations,
  isLeaveShift,
  shiftComponents,
  shiftContainsComponent,
  shiftFromComponents,
  type AssignmentMap,
  type WorkloadPeriod,
} from './workload';
import {
  reconcileStaffingCoverage,
  type StaffingCalendarDay,
} from './staffing-coverage';

export type RepairableViolationCode =
  | 'MAX_CONSECUTIVE'
  | 'NIGHT_REST_CONSECUTIVE_NIGHTS'
  | 'MORNING_ONLY'
  | 'UNKNOWN_SHIFT';

export interface DetectedRepairViolation {
  code: RepairableViolationCode;
  personnelId: string;
  day: number;
  endDay?: number;
  startPeriod?: WorkloadPeriod;
  endPeriod?: WorkloadPeriod;
  /** Components that make the current assignment repairable, when known. */
  periods?: WorkloadPeriod[];
}

export interface ScheduleRepairAction {
  code: Exclude<RepairableViolationCode, 'UNKNOWN_SHIFT'>;
  personnelId: string;
  day: number;
  fromShift: ShiftType;
  toShift: ShiftType;
  removedPeriods: WorkloadPeriod[];
  movedToPersonnelIds?: string[];
}

export interface RepairBeforeWarningInput {
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>;
  personnelList: readonly Personnel[];
  settings: SystemSettings;
  calendarDays: readonly StaffingCalendarDay[];
  requests?: readonly ShiftRequest[];
  targetJobGroups?: readonly JobGroup[];
  lockedRows?: readonly string[];
  protectedCells?: ReadonlySet<string>;
  /** Bounded by default so a malformed external schedule cannot loop forever. */
  maxPasses?: number;
}

export interface RepairBeforeWarningResult {
  assignments: Record<string, Record<number, ShiftType>>;
  repairs: ScheduleRepairAction[];
  unresolved: DetectedRepairViolation[];
}

const DEFAULT_MAX_REPAIR_PASSES = 24;

function cloneAssignments(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>
): Record<string, Record<number, ShiftType>> {
  const copy: Record<string, Record<number, ShiftType>> = {};
  for (const [personnelId, days] of Object.entries(assignments)) {
    copy[personnelId] = { ...days };
  }
  return copy;
}

function violationKey(violation: DetectedRepairViolation): string {
  return `${violation.code}:${violation.personnelId}:${violation.day}:${violation.endDay ?? ''}`;
}

function isExplicitComponentRequested(
  requests: readonly ShiftRequest[] | undefined,
  personnelId: string,
  day: number,
  dayOfWeek: number,
  period: WorkloadPeriod
): boolean {
  for (const request of requests ?? []) {
    if (request.personnelId !== personnelId) continue;

    if (request.requestType === 'shift' && request.preferredShift) {
      if (isDayInRequestScope(day, dayOfWeek, request)
        && shiftContainsComponent(request.preferredShift, period)) {
        return true;
      }
    }

    // Pattern application currently follows its step cadence for the month.
    if (request.requestType === 'pattern' && request.patternSteps?.length) {
      const step = request.patternSteps[(day - 1) % request.patternSteps.length];
      if (shiftContainsComponent(step, period)) return true;
    }
  }
  return false;
}

function collectRepairableViolations(
  assignments: AssignmentMap,
  personnelList: readonly Personnel[],
  calendarDays: readonly StaffingCalendarDay[],
  requests: readonly ShiftRequest[] | undefined
): DetectedRepairViolation[] {
  const totalDays = calendarDays.reduce((max, calendarDay) => Math.max(max, calendarDay.day), 0);
  const violations: DetectedRepairViolation[] = [];

  for (const person of personnelList) {
    if (!person.active) continue;
    for (const calendarDay of calendarDays) {
      const shift = assignments[person.id]?.[calendarDay.day] || 'OFF';
      const hardViolations = evaluateHardConstraintViolations(
        {
          person,
          day: calendarDay.day,
          dayOfWeek: calendarDay.dayOfWeek,
          isHoliday: calendarDay.isHoliday,
          candidateShift: shift,
          assignments,
          totalDays,
          requests,
        },
        VERIFICATION_HARD_RULES
      );

      if (hardViolations.includes('MORNING_ONLY')) {
        const periods = shiftComponents(shift).filter(period => period === 'E' || period === 'N');
        violations.push({ code: 'MORNING_ONLY', personnelId: person.id, day: calendarDay.day, periods });
      }
      if (hardViolations.includes('NIGHT_REST_CONSECUTIVE_NIGHTS')) {
        violations.push({ code: 'NIGHT_REST_CONSECUTIVE_NIGHTS', personnelId: person.id, day: calendarDay.day, periods: ['N'] });
      }
      if (hardViolations.includes('UNKNOWN_SHIFT')) {
        violations.push({ code: 'UNKNOWN_SHIFT', personnelId: person.id, day: calendarDay.day });
      }
    }

    for (const run of findConsecutiveCapViolations(assignments, person.id, totalDays)) {
      violations.push({
        code: 'MAX_CONSECUTIVE',
        personnelId: person.id,
        day: run.startDay,
        endDay: run.endDay,
        startPeriod: run.startPeriod,
        endPeriod: run.endPeriod,
      });
    }
  }

  // Stable, useful order: role/nights first, then workload cap, then unknown.
  const rank: Record<RepairableViolationCode, number> = {
    MORNING_ONLY: 0,
    NIGHT_REST_CONSECUTIVE_NIGHTS: 1,
    MAX_CONSECUTIVE: 2,
    UNKNOWN_SHIFT: 3,
  };
  return violations.sort((left, right) =>
    rank[left.code] - rank[right.code]
    || left.day - right.day
    || (left.endDay ?? left.day) - (right.endDay ?? right.day)
    || left.personnelId.localeCompare(right.personnelId)
  );
}

function isSourceMutable(
  assignments: AssignmentMap,
  personnel: Personnel | undefined,
  personnelId: string,
  day: number,
  lockedRows: ReadonlySet<string>,
  protectedCells: ReadonlySet<string>
): boolean {
  if (!personnel || personnel.locked || lockedRows.has(personnelId)) return false;
  if (protectedCells.has(`${personnelId}:${day}`)) return false;
  const shift = assignments[personnelId]?.[day];
  return !!shift && !isLeaveShift(shift) && shift !== 'OFF';
}

function removePeriods(
  assignments: Record<string, Record<number, ShiftType>>,
  personnelId: string,
  day: number,
  periods: readonly WorkloadPeriod[]
): ScheduleRepairAction | null {
  const fromShift = assignments[personnelId]?.[day];
  if (!fromShift) return null;
  const remaining = shiftComponents(fromShift).filter(period => !periods.includes(period));
  const toShift = shiftFromComponents(remaining);
  if (!toShift || toShift === fromShift) return null;
  assignments[personnelId][day] = toShift;
  return {
    code: 'MAX_CONSECUTIVE',
    personnelId,
    day,
    fromShift,
    toShift,
    removedPeriods: [...periods],
  };
}

function periodFromSlot(slot: number): WorkloadPeriod {
  return WORKLOAD_PERIODS[slot % WORKLOAD_PERIODS.length];
}

function slotFromDayPeriod(day: number, period: WorkloadPeriod): number {
  return (day - 1) * WORKLOAD_PERIODS.length + WORKLOAD_PERIODS.indexOf(period);
}

function findCapRemoval(
  assignments: AssignmentMap,
  violation: DetectedRepairViolation,
  personnelById: ReadonlyMap<string, Personnel>,
  calendarByDay: ReadonlyMap<number, StaffingCalendarDay>,
  requests: readonly ShiftRequest[] | undefined,
  lockedRows: ReadonlySet<string>,
  protectedCells: ReadonlySet<string>
): { day: number; periods: WorkloadPeriod[] } | null {
  if (violation.endDay === undefined) return null;
  const person = personnelById.get(violation.personnelId);
  if (!person) return null;

  // Repair the trailing component first: that minimally shortens the run and
  // preserves the largest legal subset of any composite shift. Explicitly
  // requested components are skipped when a non-requested source is available.
  const startPeriod = violation.startPeriod;
  const endPeriod = violation.endPeriod;
  if (!startPeriod || !endPeriod) return null;

  const startSlot = slotFromDayPeriod(violation.day, startPeriod);
  const endSlot = slotFromDayPeriod(violation.endDay, endPeriod);
  for (let slot = endSlot; slot >= startSlot; slot--) {
    const day = Math.floor(slot / WORKLOAD_PERIODS.length) + 1;
    const period = periodFromSlot(slot);
    const shift = assignments[violation.personnelId]?.[day];
    const calendarDay = calendarByDay.get(day);
    if (!shift || !calendarDay || !shiftContainsComponent(shift, period)) continue;
    if (!isSourceMutable(assignments, person, violation.personnelId, day, lockedRows, protectedCells)) continue;
    if (isExplicitComponentRequested(requests, violation.personnelId, day, calendarDay.dayOfWeek ?? -1, period)) continue;
    return { day, periods: [period] };
  }
  return null;
}

function findNightRemoval(
  assignments: AssignmentMap,
  violation: DetectedRepairViolation,
  personnelById: ReadonlyMap<string, Personnel>,
  calendarByDay: ReadonlyMap<number, StaffingCalendarDay>,
  requests: readonly ShiftRequest[] | undefined,
  lockedRows: ReadonlySet<string>,
  protectedCells: ReadonlySet<string>
): { day: number; periods: WorkloadPeriod[] } | null {
  const person = personnelById.get(violation.personnelId);
  if (!person) return null;

  let runStart = violation.day;
  while (runStart > 1 && shiftContainsComponent(assignments[violation.personnelId]?.[runStart - 1], 'N')) {
    runStart -= 1;
  }

  // Preserve requested nights when possible by first moving a non-requested
  // component from the offending N-bearing run.
  for (let day = runStart; day <= violation.day; day++) {
    const calendarDay = calendarByDay.get(day);
    if (!calendarDay || !shiftContainsComponent(assignments[violation.personnelId]?.[day], 'N')) continue;
    if (!isSourceMutable(assignments, person, violation.personnelId, day, lockedRows, protectedCells)) continue;
    if (!isExplicitComponentRequested(requests, violation.personnelId, day, calendarDay.dayOfWeek ?? -1, 'N')) {
      return { day, periods: ['N'] };
    }
  }

  // A hard third-night violation still outranks an all-requested sequence, but a
  // protected/locked cell remains immutable and will be reported unresolved.
  if (isSourceMutable(assignments, person, violation.personnelId, violation.day, lockedRows, protectedCells)) {
    return { day: violation.day, periods: ['N'] };
  }
  return null;
}

function isRecipientAvailable(
  assignments: AssignmentMap,
  person: Personnel,
  day: number,
  lockedRows: ReadonlySet<string>,
  protectedCells: ReadonlySet<string>
): boolean {
  if (!person.active || person.locked || lockedRows.has(person.id)) return false;
  if (protectedCells.has(`${person.id}:${day}`)) return false;
  const shift = assignments[person.id]?.[day] || 'OFF';
  return !isLeaveShift(shift);
}

function relocateRemovedPeriods(
  assignments: Record<string, Record<number, ShiftType>>,
  action: ScheduleRepairAction,
  personnelList: readonly Personnel[],
  calendarByDay: ReadonlyMap<number, StaffingCalendarDay>,
  requests: readonly ShiftRequest[] | undefined,
  lockedRows: ReadonlySet<string>,
  protectedCells: ReadonlySet<string>,
  totalDays: number
): void {
  const source = personnelList.find(person => person.id === action.personnelId);
  const calendarDay = calendarByDay.get(action.day);
  if (!source || !calendarDay) return;

  const movedTo: string[] = [];
  for (const period of action.removedPeriods) {
    const recipient = personnelList.find(person => {
      if (person.id === source.id || person.jobGroup !== source.jobGroup) return false;
      if (!isRecipientAvailable(assignments, person, action.day, lockedRows, protectedCells)) return false;
      const currentShift = assignments[person.id]?.[action.day] || 'OFF';
      if (shiftContainsComponent(currentShift, period)) return false;
      const candidateShift = shiftFromComponents([...shiftComponents(currentShift), period]);
      if (!candidateShift) return false;
      return evaluateHardConstraintLegality(
        {
          person,
          day: action.day,
          dayOfWeek: calendarDay.dayOfWeek,
          isHoliday: calendarDay.isHoliday,
          period,
          candidateShift,
          assignments,
          totalDays,
          requests,
          lockedRowIds: lockedRows,
          protectedCells,
        },
        COVERAGE_FILL_HARD_RULES
      ).legal;
    });
    if (!recipient) continue;

    const currentShift = assignments[recipient.id]?.[action.day] || 'OFF';
    const candidateShift = shiftFromComponents([...shiftComponents(currentShift), period]);
    if (!candidateShift) continue;
    assignments[recipient.id][action.day] = candidateShift;
    movedTo.push(recipient.id);
  }
  if (movedTo.length > 0) action.movedToPersonnelIds = movedTo;
}

function repairOneViolation(
  assignments: Record<string, Record<number, ShiftType>>,
  violation: DetectedRepairViolation,
  personnelById: ReadonlyMap<string, Personnel>,
  calendarByDay: ReadonlyMap<number, StaffingCalendarDay>,
  requests: readonly ShiftRequest[] | undefined,
  lockedRows: ReadonlySet<string>,
  protectedCells: ReadonlySet<string>
): ScheduleRepairAction | null {
  if (violation.code === 'UNKNOWN_SHIFT') return null;
  const person = personnelById.get(violation.personnelId);
  if (!person) return null;

  let removal: { day: number; periods: WorkloadPeriod[] } | null = null;
  if (violation.code === 'MAX_CONSECUTIVE') {
    removal = findCapRemoval(assignments, violation, personnelById, calendarByDay, requests, lockedRows, protectedCells);
  } else if (violation.code === 'MORNING_ONLY') {
    if (isSourceMutable(assignments, person, violation.personnelId, violation.day, lockedRows, protectedCells)) {
      removal = { day: violation.day, periods: violation.periods ?? [] };
    }
  } else if (violation.code === 'NIGHT_REST_CONSECUTIVE_NIGHTS') {
    removal = findNightRemoval(assignments, violation, personnelById, calendarByDay, requests, lockedRows, protectedCells);
  }
  if (!removal || removal.periods.length === 0) return null;

  const action = removePeriods(assignments, violation.personnelId, removal.day, removal.periods);
  if (!action) return null;
  action.code = violation.code;
  return action;
}

/**
 * Attempts bounded automatic repairs before final warning generation. A repair
 * removes only violating source components, attempts a shared-evaluator-validated
 * coverage relocation, then reconciles remaining gaps through the same evaluator.
 */
export function repairScheduleBeforeWarnings(
  input: Readonly<RepairBeforeWarningInput>
): RepairBeforeWarningResult {
  let assignments = cloneAssignments(input.assignments);
  const repairs: ScheduleRepairAction[] = [];
  const personnelById = new Map(input.personnelList.map(person => [person.id, person]));
  const calendarByDay = new Map(input.calendarDays.map(day => [day.day, day]));
  const lockedRows = new Set(input.lockedRows ?? []);
  const protectedCells = input.protectedCells ?? new Set<string>();
  const maxPasses = Math.max(0, input.maxPasses ?? DEFAULT_MAX_REPAIR_PASSES);
  const blocked = new Set<string>();

  for (let pass = 0; pass < maxPasses; pass++) {
    const violations = collectRepairableViolations(assignments, input.personnelList, input.calendarDays, input.requests);
    const target = violations.find(violation => !blocked.has(violationKey(violation)));
    if (!target) break;

    const action = repairOneViolation(
      assignments,
      target,
      personnelById,
      calendarByDay,
      input.requests,
      lockedRows,
      protectedCells
    );
    if (!action) {
      blocked.add(violationKey(target));
      continue;
    }

    relocateRemovedPeriods(
      assignments,
      action,
      input.personnelList,
      calendarByDay,
      input.requests,
      lockedRows,
      protectedCells,
      input.calendarDays.reduce((max, day) => Math.max(max, day.day), 0)
    );

    const reconciled = reconcileStaffingCoverage(
      assignments,
      input.personnelList,
      input.settings,
      input.calendarDays,
      input.targetJobGroups ?? ['nurse', 'assistant'],
      input.lockedRows ?? [],
      input.requests,
      protectedCells
    );
    assignments = reconciled.assignments;
    repairs.push(action);
  }

  return {
    assignments,
    repairs,
    unresolved: collectRepairableViolations(assignments, input.personnelList, input.calendarDays, input.requests),
  };
}
