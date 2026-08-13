/**
 * Smart regeneration rules that are not part of the authoritative workload model.
 *
 * Workload components, weighted consecutive runs, the cap, and post-heavy OFF
 * preference live in `workload.ts`. This module retains routine/isolated-shift and
 * holiday-leave behavior for backwards-compatible callers.
 */

import type { Personnel, ShiftType, WorkRoutineTag } from '../../lib/types';
import {
  isWorkShift as workloadIsWorkShift,
  shiftContainsComponent as workloadShiftContainsComponent,
  type AssignmentMap,
} from './workload';

// Re-export the former public workload API so existing domain consumers retain a
// stable import path while all implementation lives in workload.ts.
export {
  HEAVY_SHIFT_WORKLOAD_THRESHOLD,
  MAX_CONSECUTIVE_SHIFTS,
  PERIOD_WORKLOAD_WEIGHTS,
  WORKLOAD_PERIODS,
  endsMonthAtCapWithoutRest,
  evaluatePostHeavyOffPreference,
  findConsecutiveCapViolations,
  findConsecutiveRuns,
  getAdjacentWorkload,
  getCandidateWorkloadContext,
  getShiftWorkload,
  isHeavyShift,
  isKnownNonWorkShift,
  isKnownShift,
  isKnownWorkShift,
  isUnknownShift,
  isWorkShift,
  shiftComponents,
  shiftContainsComponent,
  shiftContainsNight,
  shiftFromComponents,
  shiftSatisfiesRequestedShift,
  wouldBreachConsecutiveCap,
} from './workload';

export type {
  AdjacentWorkload,
  AssignmentMap,
  CandidateWorkloadContext,
  ConsecutiveRunSummary,
  PostHeavyOffPreference,
  WorkloadPeriod,
} from './workload';

// ============================================================================
// Routine compatibility and isolated single shifts
// ============================================================================

/** Preferred completed shifts for each work-routine tag. */
export const ROUTINE_PREFERRED_SHIFTS: Readonly<Record<WorkRoutineTag, readonly ShiftType[]>> = {
  morning: ['M'],
  evening_night: ['EN', 'MEN', 'N', 'MN'],
  long: ['ME'],
};

/** Periods that may be gradually added by the solver for each routine. */
export const ROUTINE_PERIOD_ACCESS: Readonly<Record<WorkRoutineTag, readonly ('M' | 'E' | 'N')[]>> = {
  morning: ['M'],
  long: ['M', 'E'],
  evening_night: ['E', 'N'],
};

export function routineAllowsPeriodAdd(
  routine: WorkRoutineTag | undefined,
  period: 'M' | 'E' | 'N'
): boolean {
  if (!routine) return true;
  return (ROUTINE_PERIOD_ACCESS[routine] as readonly string[]).includes(period);
}

export function shiftMatchesRoutine(
  shift: ShiftType | undefined,
  routine: WorkRoutineTag | undefined
): boolean {
  if (!routine || !shift) return false;
  return (ROUTINE_PREFERRED_SHIFTS[routine] as readonly ShiftType[]).includes(shift);
}

const SINGLE_COMPONENT_SHIFTS: ReadonlySet<string> = new Set(['M', 'E', 'N']);

/**
 * Finds the nearest worked day in one direction, allowing one non-work day so
 * isolated-shift checks can preserve local patterns.
 */
function nearestWorkShift(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  direction: -1 | 1,
  totalDays: number
): ShiftType | null {
  let skipped = 0;
  for (let d = day + direction; d >= 1 && d <= totalDays; d += direction) {
    const shift = assignments[personnelId]?.[d];
    if (workloadIsWorkShift(shift)) return shift;
    skipped += 1;
    if (skipped > 1) return null;
  }
  return null;
}

/**
 * A single M/E/N shift is isolated only when both nearest work-day neighbours
 * exist and neither contains that component. Month boundaries are conservative.
 */
export function isIsolatedSingleShiftAt(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  totalDays: number,
  overrideShift?: ShiftType
): boolean {
  const shift = overrideShift ?? assignments[personnelId]?.[day];
  if (!shift || !SINGLE_COMPONENT_SHIFTS.has(shift as string)) return false;
  const component = shift as 'M' | 'E' | 'N';

  const previous = nearestWorkShift(assignments, personnelId, day, -1, totalDays);
  const next = nearestWorkShift(assignments, personnelId, day, 1, totalDays);
  if (!previous || !next) return false;
  return !workloadShiftContainsComponent(previous, component) && !workloadShiftContainsComponent(next, component);
}

/** Predictive isolated-shift check used only for candidate ranking. */
export function wouldCreateIsolatedShift(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  totalDays: number,
  overrideShift: ShiftType
): boolean {
  const shift = overrideShift;
  if (!shift || !SINGLE_COMPONENT_SHIFTS.has(shift as string)) return false;
  const component = shift as 'M' | 'E' | 'N';

  const previous = nearestWorkShift(assignments, personnelId, day, -1, totalDays);
  if (!previous || workloadShiftContainsComponent(previous, component)) return false;

  const next = nearestWorkShift(assignments, personnelId, day, 1, totalDays);
  return !next || !workloadShiftContainsComponent(next, component);
}

/** Morning workers are allowed to have an M-only pattern. */
export function isRoutineAllowedSingleShift(
  shift: ShiftType | undefined,
  routine: WorkRoutineTag | undefined
): boolean {
  return shift === 'M' && routine === 'morning';
}

export function findIsolatedSingleShiftDays(
  assignments: AssignmentMap,
  personnelId: string,
  totalDays: number,
  routine?: WorkRoutineTag
): number[] {
  const days: number[] = [];
  for (let d = 1; d <= totalDays; d++) {
    const shift = assignments[personnelId]?.[d];
    if (isRoutineAllowedSingleShift(shift, routine)) continue;
    if (isIsolatedSingleShiftAt(assignments, personnelId, d, totalDays)) days.push(d);
  }
  return days;
}

export function personnelDisplayName(person: Pick<Personnel, 'firstName' | 'lastName'>): string {
  return `${person.firstName} ${person.lastName}`;
}

// ============================================================================
// Holiday leave
// ============================================================================

export const HOLIDAY_LEAVE_SHIFT: ShiftType = 'LH';
export const HOLIDAY_LEAVE_HOURS = 7.0;

export function isHolidayLeaveShift(shift: ShiftType | undefined): boolean {
  return shift === HOLIDAY_LEAVE_SHIFT;
}

/** Number a manually-entered leave after adjacent numbered leave days. */
export function resolveLeaveShiftAssignment(
  assignments: AssignmentMap,
  personnelId: string,
  day: number
): ShiftType {
  let streak = 0;
  for (let d = day - 1; d >= 1; d--) {
    const previous = assignments[personnelId]?.[d];
    if (previous && /^L\d+$/.test(previous)) streak += 1;
    else break;
  }
  return `L${streak + 1}`;
}
