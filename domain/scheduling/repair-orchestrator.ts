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
import { isDayInRequestScope, patternStepForDay } from '../requests/request-scope-matcher';
import {
  COVERAGE_FILL_HARD_RULES,
  VERIFICATION_HARD_RULES,
  evaluateHardConstraintLegality,
  evaluateHardConstraintViolations,
} from './hard-constraints';
import {
  effectiveOvertimeCap,
  wouldExceedOvertimeCap,
} from './overtime-cap';
import {
  WORKLOAD_PERIODS,
  findConsecutiveCapViolations,
  isLeaveShift,
  isUnknownShift,
  shiftComponents,
  shiftContainsComponent,
  shiftFromComponents,
  shiftSatisfiesRequestedShift,
  type AssignmentMap,
  type WorkloadPeriod,
} from './workload';
import {
  reconcileStaffingCoverage,
  type StaffingCalendarDay,
  type StaffingCoverageGap,
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
  /**
   * Monthly overtime-cap override (approved monthly config). When present it is
   * the authoritative cap for candidate selection here; otherwise the configured
   * department value applies. Threaded through so repair shares the same effective
   * cap as the normal solver and reconciliation.
   */
  monthlyDutyHours?: { overtime?: number } | null;
}

export interface RepairBeforeWarningResult {
  assignments: Record<string, Record<number, ShiftType>>;
  repairs: ScheduleRepairAction[];
  unresolved: DetectedRepairViolation[];
}

const DEFAULT_MAX_REPAIR_PASSES = 24;
const DEFAULT_TARGET_JOB_GROUPS: readonly JobGroup[] = ['nurse', 'assistant'];

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

function cellKey(personnelId: string, day: number): string {
  return `${personnelId}:${day}`;
}

function targetGroupSet(targetJobGroups: readonly JobGroup[] | undefined): ReadonlySet<JobGroup> {
  return new Set(targetJobGroups ?? DEFAULT_TARGET_JOB_GROUPS);
}

function isInTargetGroup(person: Personnel, targetJobGroups: ReadonlySet<JobGroup>): boolean {
  return targetJobGroups.has(person.jobGroup);
}

function explicitRequestedShiftsForDay(
  requests: readonly ShiftRequest[] | undefined,
  personnelId: string,
  day: number,
  dayOfWeek: number
): ShiftType[] {
  const requested: ShiftType[] = [];
  for (const request of requests ?? []) {
    if (request.personnelId !== personnelId) continue;

    if (request.requestType === 'shift' && request.preferredShift
      && isDayInRequestScope(day, dayOfWeek, request)) {
      requested.push(request.preferredShift);
    }

    // A pattern only contributes an explicit instruction inside its scope.
    if (request.requestType === 'pattern' && request.patternSteps?.length) {
      const step = patternStepForDay(request, day, dayOfWeek);
      if (step) requested.push(step);
    }
  }
  return requested;
}

/**
 * A repair may add a component only when it still satisfies every explicit work
 * request that applies to the destination cell. This deliberately treats a
 * pattern as an explicit plan too: an automatic coverage repair must not turn a
 * requested pattern step into a different shift.
 */
function isExplicitRequestCompatible(
  requests: readonly ShiftRequest[] | undefined,
  personnelId: string,
  day: number,
  dayOfWeek: number,
  candidateShift: ShiftType
): boolean {
  return explicitRequestedShiftsForDay(requests, personnelId, day, dayOfWeek)
    .every(requestedShift => shiftSatisfiesRequestedShift(candidateShift, requestedShift));
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

    // A pattern only contributes an explicit component inside its scope.
    if (request.requestType === 'pattern' && request.patternSteps?.length) {
      const step = patternStepForDay(request, day, dayOfWeek);
      if (step && shiftContainsComponent(step, period)) return true;
    }
  }
  return false;
}

function collectRepairableViolations(
  assignments: AssignmentMap,
  personnelList: readonly Personnel[],
  calendarDays: readonly StaffingCalendarDay[],
  requests: readonly ShiftRequest[] | undefined,
  targetJobGroups: ReadonlySet<JobGroup>
): DetectedRepairViolation[] {
  const totalDays = calendarDays.reduce((max, calendarDay) => Math.max(max, calendarDay.day), 0);
  const violations: DetectedRepairViolation[] = [];

  for (const person of personnelList) {
    if (!person.active || !isInTargetGroup(person, targetJobGroups)) continue;
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
  if (!personnel || lockedRows.has(personnelId)) return false;
  if (protectedCells.has(cellKey(personnelId, day))) return false;
  const shift = assignments[personnelId]?.[day];
  return !!shift && !isLeaveShift(shift) && !isUnknownShift(shift) && shift !== 'OFF';
}

function removePeriods(
  assignments: Record<string, Record<number, ShiftType>>,
  personnelId: string,
  day: number,
  periods: readonly WorkloadPeriod[]
): ScheduleRepairAction | null {
  const fromShift = assignments[personnelId]?.[day];
  if (!fromShift || isUnknownShift(fromShift)) return null;
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
  if (!person.active || lockedRows.has(person.id)) return false;
  if (protectedCells.has(cellKey(person.id, day))) return false;
  const shift = assignments[person.id]?.[day] || 'OFF';
  // An unknown string is itself a verifier-visible hard problem. It must never
  // be normalized away as a side effect of trying to repair another person.
  return !isLeaveShift(shift) && !isUnknownShift(shift);
}

function relocateRemovedPeriods(
  assignments: Record<string, Record<number, ShiftType>>,
  action: ScheduleRepairAction,
  personnelList: readonly Personnel[],
  calendarByDay: ReadonlyMap<number, StaffingCalendarDay>,
  requests: readonly ShiftRequest[] | undefined,
  targetJobGroups: ReadonlySet<JobGroup>,
  lockedRows: ReadonlySet<string>,
  protectedCells: ReadonlySet<string>,
  totalDays: number,
  overtimeCap: number
): void {
  const source = personnelList.find(person => person.id === action.personnelId);
  const calendarDay = calendarByDay.get(action.day);
  if (!source || !calendarDay || !isInTargetGroup(source, targetJobGroups)) return;

  const movedTo: string[] = [];
  for (const period of action.removedPeriods) {
    const recipient = personnelList.find(person => {
      if (person.id === source.id
        || !isInTargetGroup(person, targetJobGroups)
        || person.jobGroup !== source.jobGroup) {
        return false;
      }
      if (!isRecipientAvailable(assignments, person, action.day, lockedRows, protectedCells)) return false;
      const currentShift = assignments[person.id]?.[action.day] || 'OFF';
      if (shiftContainsComponent(currentShift, period)) return false;
      const candidateShift = shiftFromComponents([...shiftComponents(currentShift), period]);
      if (!candidateShift) return false;
      if (!isExplicitRequestCompatible(
        requests,
        person.id,
        action.day,
        calendarDay.dayOfWeek ?? -1,
        candidateShift
      )) {
        return false;
      }
      // سقف اضافه‌کار: گیرنده‌ای که سقف را رد کند پذیرفته نمی‌شود.
      if (wouldExceedOvertimeCap(assignments, person, action.day, candidateShift, totalDays, overtimeCap)) {
        return false;
      }
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
    if (!assignments[recipient.id]) assignments[recipient.id] = {};
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
  targetJobGroups: ReadonlySet<JobGroup>,
  lockedRows: ReadonlySet<string>,
  protectedCells: ReadonlySet<string>
): ScheduleRepairAction | null {
  if (violation.code === 'UNKNOWN_SHIFT') return null;
  const person = personnelById.get(violation.personnelId);
  if (!person || !isInTargetGroup(person, targetJobGroups)) return null;

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

function collectUnknownShiftCellKeys(
  assignments: AssignmentMap,
  personnelList: readonly Personnel[],
  calendarDays: readonly StaffingCalendarDay[],
  targetJobGroups: ReadonlySet<JobGroup>
): Set<string> {
  const unknownCells = new Set<string>();
  for (const person of personnelList) {
    if (!isInTargetGroup(person, targetJobGroups)) continue;
    for (const calendarDay of calendarDays) {
      if (isUnknownShift(assignments[person.id]?.[calendarDay.day])) {
        unknownCells.add(cellKey(person.id, calendarDay.day));
      }
    }
  }
  return unknownCells;
}

/**
 * Reconciliation does not understand request satisfaction as a hard rule. Keep
 * explicitly planned cells stable while it fills the residual gaps; compatible
 * direct relocation above is still allowed to add the removed component.
 */
function collectExplicitPlanCellKeys(
  personnelList: readonly Personnel[],
  calendarDays: readonly StaffingCalendarDay[],
  requests: readonly ShiftRequest[] | undefined,
  targetJobGroups: ReadonlySet<JobGroup>
): Set<string> {
  const explicitPlanCells = new Set<string>();
  for (const person of personnelList) {
    if (!person.active || !isInTargetGroup(person, targetJobGroups)) continue;
    for (const calendarDay of calendarDays) {
      if (explicitRequestedShiftsForDay(
        requests,
        person.id,
        calendarDay.day,
        calendarDay.dayOfWeek ?? -1
      ).length > 0) {
        explicitPlanCells.add(cellKey(person.id, calendarDay.day));
      }
    }
  }
  return explicitPlanCells;
}

function reconciliationProtectedCells(
  assignments: AssignmentMap,
  input: Readonly<RepairBeforeWarningInput>,
  targetJobGroups: ReadonlySet<JobGroup>,
  protectedCells: ReadonlySet<string>
): ReadonlySet<string> {
  const reconcilerProtected = new Set(protectedCells);
  for (const key of collectUnknownShiftCellKeys(
    assignments,
    input.personnelList,
    input.calendarDays,
    targetJobGroups
  )) {
    reconcilerProtected.add(key);
  }
  for (const key of collectExplicitPlanCellKeys(
    input.personnelList,
    input.calendarDays,
    input.requests,
    targetJobGroups
  )) {
    reconcilerProtected.add(key);
  }
  return reconcilerProtected;
}

function coverageGapKey(gap: StaffingCoverageGap): string {
  return `${gap.jobGroup}:${gap.day}:${gap.shift}`;
}

function coverageMismatchMagnitude(gap: StaffingCoverageGap): number {
  return Math.abs(gap.required - gap.assigned);
}

/** A repair may not make any exact-coverage mismatch worse than the prior state. */
function worsensCoverage(
  before: readonly StaffingCoverageGap[],
  after: readonly StaffingCoverageGap[]
): boolean {
  const beforeMagnitude = new Map<string, number>();
  for (const gap of before) {
    const key = coverageGapKey(gap);
    beforeMagnitude.set(key, Math.max(beforeMagnitude.get(key) ?? 0, coverageMismatchMagnitude(gap)));
  }
  for (const gap of after) {
    const key = coverageGapKey(gap);
    if (coverageMismatchMagnitude(gap) > (beforeMagnitude.get(key) ?? 0)) return true;
  }
  return false;
}

function rangesOverlap(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number
): boolean {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function originalViolationPersists(
  original: DetectedRepairViolation,
  currentViolations: readonly DetectedRepairViolation[]
): boolean {
  return currentViolations.some(current => {
    if (current.code !== original.code || current.personnelId !== original.personnelId) return false;
    if (original.code === 'MAX_CONSECUTIVE') {
      return rangesOverlap(
        original.day,
        original.endDay ?? original.day,
        current.day,
        current.endDay ?? current.day
      );
    }
    return current.day === original.day;
  });
}

function introducesRepairableViolation(
  before: readonly DetectedRepairViolation[],
  after: readonly DetectedRepairViolation[]
): boolean {
  const beforeKeys = new Set(before.map(violationKey));
  return after.some(violation => !beforeKeys.has(violationKey(violation)));
}

/**
 * The direct relocation filter protects destination requests. This guard also
 * rejects an attempt if reconciliation would subsequently alter another explicit
 * request cell into a mismatching shift.
 */
function changesExplicitRequestToConflict(
  before: AssignmentMap,
  after: AssignmentMap,
  action: ScheduleRepairAction,
  personnelList: readonly Personnel[],
  calendarDays: readonly StaffingCalendarDay[],
  requests: readonly ShiftRequest[] | undefined,
  targetJobGroups: ReadonlySet<JobGroup>
): boolean {
  for (const person of personnelList) {
    if (!isInTargetGroup(person, targetJobGroups)) continue;
    for (const calendarDay of calendarDays) {
      const beforeShift = before[person.id]?.[calendarDay.day] || 'OFF';
      const afterShift = after[person.id]?.[calendarDay.day] || 'OFF';
      if (beforeShift === afterShift) continue;
      // A hard repair may deliberately remove a source component when no other
      // source is mutable (for example, an all-explicit third-night sequence).
      if (person.id === action.personnelId && calendarDay.day === action.day) continue;
      if (!isExplicitRequestCompatible(
        requests,
        person.id,
        calendarDay.day,
        calendarDay.dayOfWeek ?? -1,
        afterShift
      )) {
        return true;
      }
    }
  }
  return false;
}

function rowsAreEqual(
  left: Readonly<Record<number, ShiftType>> | undefined,
  right: Readonly<Record<number, ShiftType>> | undefined
): boolean {
  const days = new Set<number>([
    ...Object.keys(left ?? {}).map(Number),
    ...Object.keys(right ?? {}).map(Number),
  ]);
  return [...days].every(day => left?.[day] === right?.[day]);
}

/** Guard target-group isolation even if a future reconcile implementation changes. */
function changesOutsideTargetScope(
  before: AssignmentMap,
  after: AssignmentMap,
  personnelList: readonly Personnel[],
  targetJobGroups: ReadonlySet<JobGroup>
): boolean {
  const knownPersonnelIds = new Set(personnelList.map(person => person.id));
  for (const person of personnelList) {
    if (!isInTargetGroup(person, targetJobGroups)
      && !rowsAreEqual(before[person.id], after[person.id])) {
      return true;
    }
  }

  const assignmentIds = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const personnelId of assignmentIds) {
    if (!knownPersonnelIds.has(personnelId)
      && !rowsAreEqual(before[personnelId], after[personnelId])) {
      return true;
    }
  }
  return false;
}

/**
 * Attempts bounded automatic repairs before final warning generation. A repair
 * removes only violating source components, attempts a shared-evaluator-validated
 * coverage relocation, then reconciles remaining gaps through the same evaluator.
 *
 * An attempt is committed only when it resolves its original violation without
 * worsening coverage, reintroducing that violation, creating another repairable
 * hard violation, or changing an explicit request into a mismatch. Failed
 * attempts are rolled back and blocked, so reconciliation cannot cause churn.
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
  const targetJobGroups = targetGroupSet(input.targetJobGroups);
  const targetJobGroupList = [...targetJobGroups];
  const totalDays = input.calendarDays.reduce((max, day) => Math.max(max, day.day), 0);
  const maxPasses = Math.max(0, input.maxPasses ?? DEFAULT_MAX_REPAIR_PASSES);
  const blocked = new Set<string>();

  for (let pass = 0; pass < maxPasses; pass++) {
    const violations = collectRepairableViolations(
      assignments,
      input.personnelList,
      input.calendarDays,
      input.requests,
      targetJobGroups
    );
    const target = violations.find(violation => !blocked.has(violationKey(violation)));
    if (!target) break;

    const beforeAssignments = cloneAssignments(assignments);
    const reconcileProtected = reconciliationProtectedCells(
      beforeAssignments,
      input,
      targetJobGroups,
      protectedCells
    );
    // Compare the legal coverage state before and after the repair rather than
    // treating an unrelated, pre-existing shortage as a reason to mutate/undo it.
    const beforeCoverage = reconcileStaffingCoverage(
      beforeAssignments,
      input.personnelList,
      input.settings,
      input.calendarDays,
      targetJobGroupList,
      input.lockedRows ?? [],
      input.requests,
      reconcileProtected,
      input.monthlyDutyHours
    ).unresolvedGaps;

    const action = repairOneViolation(
      assignments,
      target,
      personnelById,
      calendarByDay,
      input.requests,
      targetJobGroups,
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
      targetJobGroups,
      lockedRows,
      protectedCells,
      totalDays,
      effectiveOvertimeCap({ settings: input.settings, monthlyDutyHours: input.monthlyDutyHours })
    );

    const reconciled = reconcileStaffingCoverage(
      assignments,
      input.personnelList,
      input.settings,
      input.calendarDays,
      targetJobGroupList,
      input.lockedRows ?? [],
      input.requests,
      reconcileProtected,
      input.monthlyDutyHours
    );
    const afterAssignments = reconciled.assignments;
    const afterViolations = collectRepairableViolations(
      afterAssignments,
      input.personnelList,
      input.calendarDays,
      input.requests,
      targetJobGroups
    );

    const successful = !worsensCoverage(beforeCoverage, reconciled.unresolvedGaps)
      && !originalViolationPersists(target, afterViolations)
      && !introducesRepairableViolation(violations, afterViolations)
      && !changesExplicitRequestToConflict(
        beforeAssignments,
        afterAssignments,
        action,
        input.personnelList,
        input.calendarDays,
        input.requests,
        targetJobGroups
      )
      && !changesOutsideTargetScope(
        beforeAssignments,
        afterAssignments,
        input.personnelList,
        targetJobGroups
      );

    if (!successful) {
      // Do not erase a real warning merely because an intermediate assignment
      // looked repaired. The previous state is the last known non-worse state.
      assignments = beforeAssignments;
      blocked.add(violationKey(target));
      continue;
    }

    assignments = afterAssignments;
    repairs.push(action);
  }

  return {
    assignments,
    repairs,
    unresolved: collectRepairableViolations(
      assignments,
      input.personnelList,
      input.calendarDays,
      input.requests,
      targetJobGroups
    ),
  };
}
