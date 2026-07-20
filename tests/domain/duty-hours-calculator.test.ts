/**
 * Unit Tests — DutyHoursCalculator
 *
 * Run: tsx --test tests/domain/duty-hours-calculator.test.ts
 *
 * These tests verify the pure domain function that calculates monthly duty hours.
 * The business rule is: official = (workingDays × 7) − (nonHolidayThursdays × 2), contract = official + 14
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateDutyHoursFromDays,
  calculateMonthlyDutyHours,
} from '../../domain/calendar/duty-hours-calculator';
import type { CalendarDay } from '../../domain/types';

// ============================================================================
// calculateDutyHoursFromDays — Low-level (pre-built calendar)
// ============================================================================

test('calculateDutyHoursFromDays: all working days, no Thursdays', () => {
  // 5 days: Sat(0), Sun(1), Mon(2), Tue(3), Wed(4) — none are Thursday or Friday
  const days: CalendarDay[] = [
    { dayOfWeek: 0, isHoliday: false },
    { dayOfWeek: 1, isHoliday: false },
    { dayOfWeek: 2, isHoliday: false },
    { dayOfWeek: 3, isHoliday: false },
    { dayOfWeek: 4, isHoliday: false },
  ];
  const result = calculateDutyHoursFromDays(days);
  // official = 5 * 7 - 0 * 2 = 35, contract = 35 + 14 = 49
  assert.equal(result.official, 35);
  assert.equal(result.contract, 49);
});

test('calculateDutyHoursFromDays: subtracts 2 hours per non-holiday Thursday', () => {
  // 7 days: Sat–Fri, Friday is holiday (as usual), Thursday is NOT holiday
  const days: CalendarDay[] = [
    { dayOfWeek: 0, isHoliday: false }, // Sat
    { dayOfWeek: 1, isHoliday: false }, // Sun
    { dayOfWeek: 2, isHoliday: false }, // Mon
    { dayOfWeek: 3, isHoliday: false }, // Tue
    { dayOfWeek: 4, isHoliday: false }, // Wed
    { dayOfWeek: 5, isHoliday: false }, // Thu (working Thursday)
    { dayOfWeek: 6, isHoliday: true },  // Fri (holiday)
  ];
  const result = calculateDutyHoursFromDays(days);
  // workingDays = 6, nonHolidayThursdays = 1
  // official = 6 * 7 - 1 * 2 = 40, contract = 40 + 14 = 54
  assert.equal(result.official, 40);
  assert.equal(result.contract, 54);
});

test('calculateDutyHoursFromDays: Thursday that is also a holiday does not subtract', () => {
  // A Thursday that is a holiday: counts as neither working day nor working Thursday
  const days: CalendarDay[] = [
    { dayOfWeek: 5, isHoliday: true },  // Thu (holiday)
    { dayOfWeek: 6, isHoliday: true },  // Fri (holiday)
    { dayOfWeek: 0, isHoliday: false }, // Sat
  ];
  const result = calculateDutyHoursFromDays(days);
  // workingDays = 1, nonHolidayThursdays = 0
  // official = 1 * 7 - 0 * 2 = 7, contract = 7 + 14 = 21
  assert.equal(result.official, 7);
  assert.equal(result.contract, 21);
});

test('calculateDutyHoursFromDays: empty month returns zero', () => {
  const result = calculateDutyHoursFromDays([]);
  assert.equal(result.official, 0);
  assert.equal(result.contract, 14); // contract = 0 + 14
});

test('calculateDutyHoursFromDays: all holidays returns zero official', () => {
  const days: CalendarDay[] = [
    { dayOfWeek: 0, isHoliday: true },
    { dayOfWeek: 1, isHoliday: true },
    { dayOfWeek: 5, isHoliday: true },
    { dayOfWeek: 6, isHoliday: true },
  ];
  const result = calculateDutyHoursFromDays(days);
  assert.equal(result.official, 0);
  assert.equal(result.contract, 14);
});

// ============================================================================
// calculateMonthlyDutyHours — High-level (builds calendar from raw params)
// ============================================================================

test('calculateMonthlyDutyHours: 31-day month starting Saturday, no custom holidays', () => {
  // Simulates a 31-day Jalali month starting on Saturday (dayOfWeek=0)
  // Fridays (dayOfWeek=6) are automatic holidays
  // In 31 days starting Sat: Fridays fall on days 7, 14, 21, 28 → 4 Fridays
  // Thursdays fall on days 6, 13, 20, 27 → 4 Thursdays (all non-holiday)
  const result = calculateMonthlyDutyHours(31, {}, 0);
  // workingDays = 31 - 4 = 27, nonHolidayThursdays = 4
  // official = 27 * 7 - 4 * 2 = 189 - 8 = 181, contract = 181 + 14 = 195
  assert.equal(result.official, 181);
  assert.equal(result.contract, 195);
});

test('calculateMonthlyDutyHours: custom holidays reduce working days', () => {
  // 30-day month starting Saturday, with 2 custom holidays on non-Friday days
  const holidays: Record<number, string> = { 1: 'عید نوروز', 15: 'عید فطر' };
  // Day 1: Sat (now holiday due to custom), Day 15: Mon (now holiday due to custom)
  // Fridays: days 7, 14, 21, 28 → 4 automatic holidays
  // Custom holidays: day 1 (Sat), day 15 (Mon) → 2 more holidays
  // Total holidays = 6, workingDays = 30 - 6 = 24
  // Thursdays: days 6, 13, 20, 27 → all non-holiday → 4 working Thursdays
  const result = calculateMonthlyDutyHours(30, holidays, 0);
  // official = 24 * 7 - 4 * 2 = 168 - 8 = 160, contract = 160 + 14 = 174
  assert.equal(result.official, 160);
  assert.equal(result.contract, 174);
});

test('calculateMonthlyDutyHours: custom holiday on Thursday eliminates Thursday deduction', () => {
  // 7-day month starting Saturday, with a custom holiday on Thursday (day 6)
  const holidays: Record<number, string> = { 6: 'تعطیل رسمی' };
  // Day 6 is Thursday + custom holiday → isHoliday = true
  // Day 7 is Friday → isHoliday = true
  // workingDays = 5 (days 1-5), nonHolidayThursdays = 0
  const result = calculateMonthlyDutyHours(7, holidays, 0);
  // official = 5 * 7 - 0 * 2 = 35, contract = 35 + 14 = 49
  assert.equal(result.official, 35);
  assert.equal(result.contract, 49);
});

test('calculateMonthlyDutyHours: month starting on Thursday', () => {
  // 30-day month starting on Thursday (dayOfWeek=5)
  // Thursdays fall on: day 1, 8, 15, 22, 29 → 5 Thursdays
  // Fridays fall on: day 2, 9, 16, 23, 30 → 5 Fridays (holidays)
  // workingDays = 30 - 5 = 25, nonHolidayThursdays = 5
  const result = calculateMonthlyDutyHours(30, {}, 5);
  // official = 25 * 7 - 5 * 2 = 175 - 10 = 165, contract = 165 + 14 = 179
  assert.equal(result.official, 165);
  assert.equal(result.contract, 179);
});

test('calculateMonthlyDutyHours: 29-day month (Esfand non-leap)', () => {
  // 29-day month starting Wednesday (dayOfWeek=4)
  // Thursdays: day 2, 9, 16, 23 → 4
  // Fridays: day 3, 10, 17, 24 → 4
  const result = calculateMonthlyDutyHours(29, {}, 4);
  // workingDays = 29 - 4 = 25, nonHolidayThursdays = 4
  // official = 25 * 7 - 4 * 2 = 175 - 8 = 167, contract = 167 + 14 = 181
  assert.equal(result.official, 167);
  assert.equal(result.contract, 181);
});

test('calculateMonthlyDutyHours: contract is always official + 14', () => {
  // Spot-check across different configurations
  const configs: Array<{ totalDays: number; holidays: Record<number, string>; firstDay: number }> = [
    { totalDays: 31, holidays: {}, firstDay: 0 },
    { totalDays: 30, holidays: { 5: 'test' }, firstDay: 3 },
    { totalDays: 29, holidays: { 1: 'a', 2: 'b', 3: 'c' }, firstDay: 6 },
  ];

  for (const cfg of configs) {
    const result = calculateMonthlyDutyHours(cfg.totalDays, cfg.holidays, cfg.firstDay);
    assert.equal(
      result.contract,
      result.official + 14,
      `Contract should be official + 14 for totalDays=${cfg.totalDays}, firstDay=${cfg.firstDay}`
    );
  }
});
