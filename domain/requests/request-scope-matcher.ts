/**
 * RequestScopeMatcher — Domain Layer (Pure Function)
 *
 * RESPONSIBILITY:
 *   Determine whether a given day number falls within the scope of a shift request.
 *   Handles all 14 scope types defined in the business domain.
 *
 * SCOPE TYPES:
 *   - 'all':          Every day matches
 *   - 'even':         Even-numbered days (2, 4, 6, ...)
 *   - 'odd':          Odd-numbered days (1, 3, 5, ...)
 *   - 'saturdays':    Days where dayOfWeek === 0
 *   - 'sundays':      Days where dayOfWeek === 1
 *   - 'mondays':      Days where dayOfWeek === 2
 *   - 'tuesdays':     Days where dayOfWeek === 3
 *   - 'wednesdays':   Days where dayOfWeek === 4
 *   - 'thursdays':    Days where dayOfWeek === 5
 *   - 'fridays':      Days where dayOfWeek === 6
 *   - 'weekly_even':  Even days of the week (Sat=0, Mon=2, Wed=4)
 *   - 'weekly_odd':   Odd days of the week (Sun=1, Tue=3, Thu=5)
 *   - 'range':        Days within [startDate.day, endDate.day] (day-of-month comparison)
 *   - 'custom_days':  Days explicitly listed in selectedDays[]
 *
 * Extracted from: lib/balanceChecker.ts (checkIfDayInRequestScope) + lib/solver.ts (scope matching)
 *
 * IMPROVEMENT OVER LEGACY:
 *   The legacy checkIfDayInRequestScope in balanceChecker.ts did NOT handle weekday-specific
 *   scopes (saturdays–fridays, weekly_even, weekly_odd). This version is complete and correct.
 */

import type { ShiftRequestScope } from '../types';

/**
 * Mapping from weekday-name scopes to their dayOfWeek number.
 * Day-of-week convention: 0=Saturday, 1=Sunday, ..., 6=Friday (Iranian week).
 */
const WEEKDAY_SCOPE_MAP: Record<string, number> = {
  saturdays: 0,
  sundays: 1,
  mondays: 2,
  tuesdays: 3,
  wednesdays: 4,
  thursdays: 5,
  fridays: 6,
};

/**
 * Check whether a given day of the month falls within the scope of a shift request.
 *
 * @param day - Day number in the month (1–31)
 * @param dayOfWeek - Day of week for this day (0=Saturday … 6=Friday)
 * @param request - The shift request scope parameters
 * @returns true if the day matches the request scope
 *
 * @pure - No side effects, no external dependencies
 * @deterministic - Same inputs always produce the same output
 */
export function isDayInRequestScope(
  day: number,
  dayOfWeek: number,
  request: Readonly<ShiftRequestScope>
): boolean {
  switch (request.scope) {
    case 'all':
      return true;

    case 'even':
      return day % 2 === 0;

    case 'odd':
      return day % 2 === 1;

    // Weekday-specific scopes: match by dayOfWeek
    case 'saturdays':
    case 'sundays':
    case 'mondays':
    case 'tuesdays':
    case 'wednesdays':
    case 'thursdays':
    case 'fridays':
      return dayOfWeek === WEEKDAY_SCOPE_MAP[request.scope];

    // Weekly even/odd: based on dayOfWeek, NOT day-of-month
    // weekly_even: Saturday(0), Monday(2), Wednesday(4)
    // weekly_odd:  Sunday(1), Tuesday(3), Thursday(5)
    case 'weekly_even':
      return dayOfWeek === 0 || dayOfWeek === 2 || dayOfWeek === 4;

    case 'weekly_odd':
      return dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;

    // Date range: compare day-of-month against start/end day numbers
    case 'range': {
      if (!request.startDate || !request.endDate) return false;
      const startDay = parseDayFromDate(request.startDate);
      const endDay = parseDayFromDate(request.endDate);
      return day >= startDay && day <= endDay;
    }

    // Explicit day selection
    case 'custom_days':
      return request.selectedDays?.includes(day) ?? false;

    default:
      return false;
  }
}

/**
 * Extract the day number from a Jalali date string in 'YYYY/MM/DD' format.
 *
 * @param dateString - Date string like '1404/03/15'
 * @returns The day number (e.g., 15)
 *
 * @pure
 */
function parseDayFromDate(dateString: string): number {
  const parts = dateString.split('/').map(Number);
  return parts[2] ?? 0;
}
