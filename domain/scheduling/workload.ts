/**
 * Workload model — the authoritative shift-component and sequential-work model.
 *
 * A calendar day has three ordered slots: M, E, N. A workload run is a maximal
 * uninterrupted sequence of worked slots across the whole month. M/E weigh one
 * unit each and N weighs two units. Empty components break a run, including the
 * empty E component inside MN.
 *
 * This module deliberately knows only canonical scheduling shifts. Unknown strings
 * have no inferred components or workload; callers can reject them safely instead
 * of silently treating them as valid work.
 */

import type { ShiftType } from '../../lib/types';

export const WORKLOAD_PERIODS = ['M', 'E', 'N'] as const;
export type WorkloadPeriod = (typeof WORKLOAD_PERIODS)[number];

/** Maximum legal weighted workload in one contiguous M/E/N slot run. */
export const MAX_CONSECUTIVE_SHIFTS = 5;

/** A shift with at least two workload units is heavy for the post-heavy OFF preference. */
export const HEAVY_SHIFT_WORKLOAD_THRESHOLD = 2;

/** Maximum consecutive N-bearing calendar days permitted by the current model. */
export const MAX_CONSECUTIVE_NIGHTS = 2;

export type NightRestViolation = 'CONSECUTIVE_NIGHTS' | 'MORNING_AFTER_NIGHT';

/** Small ranking cost for legal work on a post-heavy day with no explicit plan. */
export const POST_HEAVY_OFF_PREFERENCE_PENALTY = 25;

/** Authoritative workload weight for every worked period. */
export const PERIOD_WORKLOAD_WEIGHTS: Readonly<Record<WorkloadPeriod, number>> = {
  M: 1,
  E: 1,
  N: 2,
};

const SHIFT_COMPONENTS: Readonly<Record<string, readonly WorkloadPeriod[]>> = {
  M: ['M'],
  E: ['E'],
  N: ['N'],
  ME: ['M', 'E'],
  EN: ['E', 'N'],
  MN: ['M', 'N'],
  MEN: ['M', 'E', 'N'],
  OFF: [],
};

const SHIFT_BY_COMPONENT_KEY: Readonly<Record<string, ShiftType>> = {
  '': 'OFF',
  M: 'M',
  E: 'E',
  N: 'N',
  ME: 'ME',
  EN: 'EN',
  MN: 'MN',
  MEN: 'MEN',
};

export type AssignmentMap = Readonly<Record<string, Readonly<Record<number, ShiftType>>>>;

/** A leave marker (L1…Ln or LH) is non-work for workload purposes. */
export function isLeaveShift(shift: ShiftType | undefined): boolean {
  return !!shift && shift.startsWith('L');
}

/** Whether a shift is one of the canonical worked component combinations. */
export function isKnownWorkShift(shift: ShiftType | undefined): boolean {
  return !!shift && Object.prototype.hasOwnProperty.call(SHIFT_COMPONENTS, shift) && shift !== 'OFF';
}

/** Whether a shift is a known non-work marker. */
export function isKnownNonWorkShift(shift: ShiftType | undefined): boolean {
  return !shift || shift === 'OFF' || isLeaveShift(shift);
}

/** Whether the workload model understands this shift value. */
export function isKnownShift(shift: ShiftType | undefined): boolean {
  return isKnownWorkShift(shift) || isKnownNonWorkShift(shift);
}

/** Unknown strings are never assumed to have a safe workload. */
export function isUnknownShift(shift: ShiftType | undefined): boolean {
  return !!shift && !isKnownShift(shift);
}

/**
 * Canonical M/E/N components for a shift. Unknown and non-work shifts have no
 * inferred components.
 */
export function shiftComponents(shift: ShiftType | undefined): readonly WorkloadPeriod[] {
  if (!shift || isLeaveShift(shift)) return [];
  return SHIFT_COMPONENTS[shift] ?? [];
}

/** Whether a shift contains one component. */
export function shiftContainsComponent(
  shift: ShiftType | undefined,
  component: WorkloadPeriod
): boolean {
  return shiftComponents(shift).includes(component);
}

/** Whether a shift covers the night period. */
export function shiftContainsNight(shift: ShiftType | undefined): boolean {
  return shiftContainsComponent(shift, 'N');
}

/**
 * Authoritative current night-rest check. It is intentionally calendar-day based,
 * unlike weighted workload runs: no third consecutive N-bearing day and no M on
 * the day immediately following any N-bearing shift.
 */
export function wouldViolateNightRest(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  candidateShift: ShiftType
): NightRestViolation | null {
  if (shiftContainsNight(candidateShift)) {
    let consecutive = 0;
    for (let previous = day - 1; previous >= 1; previous--) {
      if (!shiftContainsNight(assignments[personnelId]?.[previous])) break;
      consecutive += 1;
      if (consecutive >= MAX_CONSECUTIVE_NIGHTS) return 'CONSECUTIVE_NIGHTS';
    }
  }

  if (shiftContainsComponent(candidateShift, 'M') && day > 1
    && shiftContainsNight(assignments[personnelId]?.[day - 1])) {
    return 'MORNING_AFTER_NIGHT';
  }

  return null;
}

/** True only for canonical worked shifts. */
export function isWorkShift(shift: ShiftType | undefined): boolean {
  return isKnownWorkShift(shift);
}

/**
 * Total workload units in one shift. Unknown shifts return null rather than an
 * invented weight. OFF/leave/undefined return zero.
 */
export function getShiftWorkload(shift: ShiftType | undefined): number | null {
  if (isUnknownShift(shift)) return null;
  return shiftComponents(shift).reduce((sum, component) => sum + PERIOD_WORKLOAD_WEIGHTS[component], 0);
}

/** Canonically compose a shift from a set of M/E/N components. */
export function shiftFromComponents(components: Iterable<WorkloadPeriod>): ShiftType | null {
  const selected = new Set(components);
  const key = WORKLOAD_PERIODS.filter(period => selected.has(period)).join('');
  return SHIFT_BY_COMPONENT_KEY[key] ?? null;
}

/**
 * A component-aware request match. Single-period requests accept a combined shift
 * containing that period; combined requests require the exact canonical shift.
 */
export function shiftSatisfiesRequestedShift(
  assigned: ShiftType | undefined,
  requested: string | undefined
): boolean {
  if (!assigned || !requested) return false;
  if (requested === 'M' || requested === 'E' || requested === 'N') {
    return shiftContainsComponent(assigned, requested);
  }
  return assigned === requested;
}

/** Whether the shift is heavy according to the authoritative workload threshold. */
export function isHeavyShift(shift: ShiftType | undefined): boolean {
  const workload = getShiftWorkload(shift);
  return workload !== null && workload >= HEAVY_SHIFT_WORKLOAD_THRESHOLD;
}

function slotIndex(day: number, periodIndex: number): number {
  return (day - 1) * WORKLOAD_PERIODS.length + periodIndex;
}

function periodWeight(periodIndex: number): number {
  return PERIOD_WORKLOAD_WEIGHTS[WORKLOAD_PERIODS[periodIndex]];
}

function isSlotWorked(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  periodIndex: number,
  overrideDay?: number,
  overrideShift?: ShiftType
): boolean {
  const shift = day === overrideDay && overrideShift !== undefined
    ? overrideShift
    : assignments[personnelId]?.[day];
  return shiftContainsComponent(shift, WORKLOAD_PERIODS[periodIndex]);
}

export interface ConsecutiveRunSummary {
  startDay: number;
  endDay: number;
  startPeriod: WorkloadPeriod;
  endPeriod: WorkloadPeriod;
  /** Weighted workload units in this contiguous run. */
  length: number;
  /** Number of occupied M/E/N slots before weighting. */
  slotCount: number;
}

function buildRunSummary(startSlot: number, endSlot: number): ConsecutiveRunSummary {
  let weighted = 0;
  for (let slot = startSlot; slot <= endSlot; slot++) {
    weighted += periodWeight(slot % WORKLOAD_PERIODS.length);
  }
  return {
    startDay: Math.floor(startSlot / WORKLOAD_PERIODS.length) + 1,
    endDay: Math.floor(endSlot / WORKLOAD_PERIODS.length) + 1,
    startPeriod: WORKLOAD_PERIODS[startSlot % WORKLOAD_PERIODS.length],
    endPeriod: WORKLOAD_PERIODS[endSlot % WORKLOAD_PERIODS.length],
    length: weighted,
    slotCount: endSlot - startSlot + 1,
  };
}

/** All contiguous weighted workload runs for one person. */
export function findConsecutiveRuns(
  assignments: AssignmentMap,
  personnelId: string,
  totalDays: number,
  overrideDay?: number,
  overrideShift?: ShiftType
): ConsecutiveRunSummary[] {
  const runs: ConsecutiveRunSummary[] = [];
  const totalSlots = totalDays * WORKLOAD_PERIODS.length;
  let runStart = -1;

  for (let slot = 0; slot < totalSlots; slot++) {
    const day = Math.floor(slot / WORKLOAD_PERIODS.length) + 1;
    const periodIndex = slot % WORKLOAD_PERIODS.length;
    if (isSlotWorked(assignments, personnelId, day, periodIndex, overrideDay, overrideShift)) {
      if (runStart === -1) runStart = slot;
    } else if (runStart !== -1) {
      runs.push(buildRunSummary(runStart, slot - 1));
      runStart = -1;
    }
  }

  if (runStart !== -1) runs.push(buildRunSummary(runStart, totalSlots - 1));
  return runs;
}

/** Runs above the authoritative maximum workload cap. */
export function findConsecutiveCapViolations(
  assignments: AssignmentMap,
  personnelId: string,
  totalDays: number
): ConsecutiveRunSummary[] {
  return findConsecutiveRuns(assignments, personnelId, totalDays)
    .filter(run => run.length > MAX_CONSECUTIVE_SHIFTS);
}

/**
 * Does replacing this person's day with candidateShift breach the workload cap?
 * Both previously assigned and already-filled future slots are considered.
 * Unknown candidates are conservatively treated as invalid by returning true.
 */
export function wouldBreachConsecutiveCap(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  candidateShift: ShiftType,
  totalDays: number
): boolean {
  if (isUnknownShift(candidateShift)) return true;
  if (!isWorkShift(candidateShift)) return false;

  const dayStartSlot = slotIndex(day, 0);
  const dayEndSlot = slotIndex(day, WORKLOAD_PERIODS.length - 1);
  const runs = findConsecutiveRuns(assignments, personnelId, totalDays, day, candidateShift);

  return runs.some(run => {
    const runStartSlot = slotIndex(run.startDay, WORKLOAD_PERIODS.indexOf(run.startPeriod));
    const runEndSlot = slotIndex(run.endDay, WORKLOAD_PERIODS.indexOf(run.endPeriod));
    const overlapsCandidateDay = runStartSlot <= dayEndSlot && runEndSlot >= dayStartSlot;
    return overlapsCandidateDay && run.length > MAX_CONSECUTIVE_SHIFTS;
  });
}

/**
 * A final-night workload run at or over the cap requires rest in the next month.
 * This is a read-only boundary reminder; it cannot mutate the next month.
 */
export function endsMonthAtCapWithoutRest(
  assignments: AssignmentMap,
  personnelId: string,
  totalDays: number
): boolean {
  const runs = findConsecutiveRuns(assignments, personnelId, totalDays);
  const lastRun = runs[runs.length - 1];
  return !!lastRun
    && lastRun.endDay === totalDays
    && lastRun.endPeriod === 'N'
    && lastRun.length >= MAX_CONSECUTIVE_SHIFTS;
}

export interface AdjacentWorkload {
  previousShift: ShiftType | undefined;
  nextShift: ShiftType | undefined;
  /** Null means the stored shift was unknown to the workload model. */
  previousWorkload: number | null;
  /** Null means the stored shift was unknown to the workload model. */
  nextWorkload: number | null;
}

/** Workload of the immediately preceding/following calendar-day shifts. */
export function getAdjacentWorkload(
  assignments: AssignmentMap,
  personnelId: string,
  day: number
): AdjacentWorkload {
  const previousShift = day > 1 ? assignments[personnelId]?.[day - 1] : undefined;
  const nextShift = assignments[personnelId]?.[day + 1];
  return {
    previousShift,
    nextShift,
    previousWorkload: getShiftWorkload(previousShift),
    nextWorkload: getShiftWorkload(nextShift),
  };
}

export interface CandidateWorkloadContext extends AdjacentWorkload {
  candidateWorkload: number | null;
  affectedRuns: ConsecutiveRunSummary[];
}

/**
 * Workload context around a prospective assignment, including every contiguous run
 * touched by that day after the candidate is applied.
 */
export function getCandidateWorkloadContext(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  candidateShift: ShiftType,
  totalDays: number
): CandidateWorkloadContext {
  const dayStartSlot = slotIndex(day, 0);
  const dayEndSlot = slotIndex(day, WORKLOAD_PERIODS.length - 1);
  const affectedRuns = findConsecutiveRuns(assignments, personnelId, totalDays, day, candidateShift)
    .filter(run => {
      const start = slotIndex(run.startDay, WORKLOAD_PERIODS.indexOf(run.startPeriod));
      const end = slotIndex(run.endDay, WORKLOAD_PERIODS.indexOf(run.endPeriod));
      return start <= dayEndSlot && end >= dayStartSlot;
    });

  return {
    ...getAdjacentWorkload(assignments, personnelId, day),
    candidateWorkload: getShiftWorkload(candidateShift),
    affectedRuns,
  };
}

export interface PostHeavyOffPreference {
  preferOff: boolean;
  previousShift: ShiftType | undefined;
  previousWorkload: number | null;
}

/**
 * A soft preference only: when yesterday's canonical workload was heavy, OFF is
 * preferred today. Callers may rank work lower, but must not reject legal coverage
 * or explicit requests solely because of this result.
 */
export function evaluatePostHeavyOffPreference(
  assignments: AssignmentMap,
  personnelId: string,
  day: number
): PostHeavyOffPreference {
  const { previousShift, previousWorkload } = getAdjacentWorkload(assignments, personnelId, day);
  return {
    preferOff: day > 1 && isHeavyShift(previousShift),
    previousShift,
    previousWorkload,
  };
}
