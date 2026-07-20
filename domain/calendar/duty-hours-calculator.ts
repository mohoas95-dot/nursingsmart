/**
 * DutyHoursCalculator — Domain Layer (Pure Function)
 *
 * RESPONSIBILITY:
 *   Calculate monthly duty hours for official and contract personnel based on
 *   the working days and non-holiday Thursdays in a Jalali month.
 *
 * BUSINESS RULE (unchanged from legacy system):
 *   official_hours = (workingDays × 7) − (nonHolidayThursdays × 2)
 *   contract_hours = official_hours + 14
 *
 * PURE: Zero dependencies on React, Next.js, browser APIs, or I/O.
 * DETERMINISTIC: Same inputs always produce the same outputs.
 *
 * Extracted from: app/page.tsx (useEffect ~line 240) + lib/solver.ts (calculateAutoDutyHours)
 */

import type { CalendarDay, DutyHours } from '../types';

/**
 * Calculate duty hours from a pre-built calendar day array.
 *
 * @param days - Array of CalendarDay objects for the month (length = total days in month)
 * @returns DutyHours with official and contract hour values
 *
 * @example
 *   const days = [
 *     { dayOfWeek: 0, isHoliday: false }, // Saturday
 *     { dayOfWeek: 5, isHoliday: false }, // Thursday (working)
 *     { dayOfWeek: 6, isHoliday: true },  // Friday
 *   ];
 *   calculateDutyHoursFromDays(days);
 *   // => { official: (3 - 1) * 7 - 1 * 2 = 12, contract: 26 }
 */
export function calculateDutyHoursFromDays(days: ReadonlyArray<CalendarDay>): DutyHours {
  const workingDays = days.filter((d) => !d.isHoliday).length;
  const nonHolidayThursdays = days.filter((d) => d.dayOfWeek === 5 && !d.isHoliday).length;

  const official = workingDays * 7 - nonHolidayThursdays * 2;
  const contract = official + 14;

  return { official, contract };
}

/**
 * Calculate duty hours from raw month parameters.
 * This is a higher-level convenience function that builds the calendar days
 * from total days, holidays map, and first-day-of-week.
 *
 * @param totalDays - Number of days in the month (29-31 for Jalali)
 * @param holidays - Map of day number → holiday title
 * @param firstDayOfWeek - Day of week for day 1 (0=Saturday ... 6=Friday)
 * @returns DutyHours with official and contract hour values
 *
 * @pure - No side effects, no external dependencies
 */
export function calculateMonthlyDutyHours(
  totalDays: number,
  holidays: Readonly<Record<number, string>>,
  firstDayOfWeek: number
): DutyHours {
  const days: CalendarDay[] = [];

  for (let day = 1; day <= totalDays; day++) {
    const dayOfWeek = (firstDayOfWeek + (day - 1)) % 7;
    const isFriday = dayOfWeek === 6;
    const isHoliday = isFriday || Boolean(holidays[day]);

    days.push({ dayOfWeek, isHoliday });
  }

  return calculateDutyHoursFromDays(days);
}
