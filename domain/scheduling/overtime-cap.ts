/**
 * Overtime cap — shared policy helper.
 *
 * The configured overtime cap is authoritative: automatic scheduling paths must
 * never intentionally create more overtime than the configured effective monthly
 * cap. The cap applies to personnel with `employmentType === 'overtime'` and is
 * measured against their total worked hours for the month.
 *
 * - The configured cap is read from the approved monthly override when present,
 *   falling back to `settings.dutyHours.overtime`.
 * - An unconfigured / non-positive cap preserves the historical 240-hour fallback.
 * - Manual editing may still create a violation; final verification reports it.
 */

import type { Personnel, ShiftType, SystemSettings } from '../../lib/types';
import { getShiftHours } from './shift-hours';
import type { AssignmentMap } from './workload';

/** Historical fallback when no positive overtime cap is configured. */
export const OVERTIME_CAP_FALLBACK = 240.0;

export interface OvertimeCapSource {
  settings: SystemSettings;
  monthlyDutyHours?: { overtime?: number } | null;
}

/**
 * The effective monthly overtime cap. Uses the approved monthly override when
 * present, otherwise the department settings value. Preserves the historical
 * 240-hour fallback when the value is unconfigured (missing) or non-positive.
 */
export function effectiveOvertimeCap(source: OvertimeCapSource): number {
  const configured = Number(
    source.monthlyDutyHours?.overtime ?? source.settings.dutyHours.overtime
  );
  return Number.isFinite(configured) && configured > 0
    ? configured
    : OVERTIME_CAP_FALLBACK;
}

/** Total worked hours for a person across the whole month (leave-aware). */
export function overtimeHoursForPerson(
  assignments: AssignmentMap,
  person: Personnel,
  totalDays: number
): number {
  let hours = 0;
  for (let day = 1; day <= totalDays; day++) {
    hours += getShiftHours(assignments[person.id]?.[day] ?? 'OFF', person.employmentType);
  }
  return hours;
}

/**
 * Would replacing `person`'s `day` assignment with `candidateShift` push their
 * monthly overtime above the given cap?
 *
 * Only `overtime`-type personnel are governed by an overtime cap. The total is
 * computed by replacing the current day's hours with the candidate's hours, so
 * callers may pass the full resulting shift (not just an incremental period).
 */
export function wouldExceedOvertimeCap(
  assignments: AssignmentMap,
  person: Personnel,
  day: number,
  candidateShift: ShiftType,
  totalDays: number,
  cap: number
): boolean {
  if (person.employmentType !== 'overtime') return false;
  const currentHours = getShiftHours(assignments[person.id]?.[day] ?? 'OFF', person.employmentType);
  const candidateHours = getShiftHours(candidateShift, person.employmentType);
  const total = overtimeHoursForPerson(assignments, person, totalDays) - currentHours + candidateHours;
  return total > cap;
}
