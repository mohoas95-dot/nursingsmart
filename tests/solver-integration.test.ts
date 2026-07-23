/**
 * Integration Tests — Solver wiring of Phase 3 features (lib/solver.ts)
 *
 * Run: tsx --test tests/solver-integration.test.ts
 *
 * این تست‌ها موتور واقعی solver را با ترکیب قابلیت‌های فاز ۳ اجرا می‌کنند:
 *   - Task 1 & 2: routineTag guidance + no-request staff → solveNursingSchedule.
 *   - Task 3: holiday leave hours crediting → generatePersonnelReports.
 *   - Task 4: boundary continuity warnings → verifyCoverageAndLeaders.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  solveNursingSchedule,
  generatePersonnelReports,
  verifyCoverageAndLeaders,
} from '../lib/solver';
import { INITIAL_SETTINGS } from '../lib/mockData';
import type { Personnel, MonthlySchedule, ShiftType } from '../lib/types';

const YEAR = 1405;
const MONTH = 3; // 31 روزه
const HOLIDAYS: Record<number, string> = { 14: 'تعطیلی آزمایشی' };

function person(id: string, routineTag: Personnel['routineTag']): Personnel {
  return {
    id,
    firstName: 'T',
    lastName: id,
    personalCode: id,
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'contract',
    experienceYears: 5,
    active: true,
    canBeShiftLeader: true,
    routineTag,
  };
}

function emptyShiftLeaders(days: number): MonthlySchedule['shiftLeaders'] {
  const out: MonthlySchedule['shiftLeaders'] = {};
  for (let d = 1; d <= days; d++) out[d] = {};
  return out;
}

// ============================================================================
// Task 1 & 2 — routineTag guidance + no-request staff in the real solver
// ============================================================================

test('solveNursingSchedule: runs with mixed routineTags and no-request staff', () => {
  const personnel = [
    person('morning', 'MORNING_ONLY'),
    person('long', 'LONG_SHIFT'),
    person('rotate', 'ROTATING_GENERAL'), // no requests → balanced rotating
    person('noreq', 'FULL_ROTATION_MEN'), // no requests → effectively ROTATING_GENERAL
  ];

  const schedule = solveNursingSchedule(YEAR, MONTH, personnel, [], INITIAL_SETTINGS, HOLIDAYS);

  assert.equal(schedule.year, YEAR);
  assert.equal(schedule.month, MONTH);
  // هر پرسنل فعال باید نگاشت شیفت داشته باشد.
  for (const p of personnel) {
    assert.ok(schedule.assignments[p.id], `assignments missing for ${p.id}`);
  }
});

test('solveNursingSchedule: no-request staff receive a balanced (non-empty) schedule', () => {
  const p = person('solo', 'MORNING_ONLY'); // هیچ درخواستی ندارد
  const schedule = solveNursingSchedule(YEAR, MONTH, [p], [], INITIAL_SETTINGS, HOLIDAYS);
  const days = Object.keys(schedule.assignments['solo']).map(Number);
  assert.ok(days.length > 0, 'no-request staff should still get assignments');
});

test('solveNursingSchedule: accepts optional prevMonthAssignments without error', () => {
  const p = person('p', 'ROTATING_GENERAL');
  const prev: Record<string, Record<number, ShiftType>> = {
    p: { 30: 'MEN', 31: 'E' }, // 32h tail ending the previous month
  };
  // نباید خطا بدهد؛ صرفاً امضای جدید بررسی می‌شود.
  const schedule = solveNursingSchedule(
    YEAR,
    MONTH,
    [p],
    [],
    INITIAL_SETTINGS,
    HOLIDAYS,
    undefined,
    undefined,
    prev
  );
  assert.ok(schedule.assignments['p']);
});

// ============================================================================
// Task 3 — Holiday leave hours crediting in reports
// ============================================================================

test('generatePersonnelReports: holiday leave credits exactly 7, non-holiday uses rate', () => {
  // contract leave rate = 7.5; holiday leave must override to exactly 7.
  // در ۱۴۰۵/۰۳: روز ۱۴ تعطیلی سفارشی است؛ روز ۲ کاری (غیر تعطیلی) است.
  const p: Personnel = { ...person('p', null), employmentType: 'contract' };
  const days = 31;
  const assignments: Record<number, ShiftType> = {};
  for (let d = 1; d <= days; d++) assignments[d] = 'OFF';
  assignments[14] = 'L1'; // holiday (day 14) → must credit 7
  assignments[2] = 'L1'; // non-holiday → must credit 7.5 (contract)

  const schedule: MonthlySchedule = {
    year: YEAR,
    month: MONTH,
    assignments: { p: assignments },
    shiftLeaders: emptyShiftLeaders(days),
    warnings: [],
  };

  const reports = generatePersonnelReports(YEAR, MONTH, [p], schedule, INITIAL_SETTINGS, HOLIDAYS);
  const r = reports[0];

  assert.equal(r.leaveCount, 2);
  // workedHours = 7 (holiday leave) + 7.5 (non-holiday contract leave) = 14.5
  assert.equal(r.workedHours, 14.5);
});

test('generatePersonnelReports: without holiday override, contract leaves would differ (sanity)', () => {
  // Two non-holiday contract leaves (days 2 & 3) → 2 * 7.5 = 15
  const p: Personnel = { ...person('p', null), employmentType: 'contract' };
  const days = 31;
  const assignments: Record<number, ShiftType> = {};
  for (let d = 1; d <= days; d++) assignments[d] = 'OFF';
  assignments[2] = 'L1';
  assignments[3] = 'L1';

  const schedule: MonthlySchedule = {
    year: YEAR,
    month: MONTH,
    assignments: { p: assignments },
    shiftLeaders: emptyShiftLeaders(days),
    warnings: [],
  };

  const r = generatePersonnelReports(YEAR, MONTH, [p], schedule, INITIAL_SETTINGS, HOLIDAYS)[0];
  assert.equal(r.workedHours, 15);
});

// ============================================================================
// Task 4 — Boundary continuity warnings via verifyCoverageAndLeaders
// ============================================================================

test('verifyCoverageAndLeaders: emits boundary warnings when prevMonth provided', () => {
  const p = person('p', 'ROTATING_GENERAL');
  const assignments = {
    p: { 1: 'M', 2: 'OFF' } as Record<number, ShiftType>,
  };
  const prevMonth = {
    p: { 30: 'MEN', 31: 'E' } as Record<number, ShiftType>, // tail MEN+E = 32h
  };

  const result = verifyCoverageAndLeaders(
    YEAR,
    MONTH,
    [p],
    assignments,
    INITIAL_SETTINGS,
    HOLIDAYS,
    undefined,
    [],
    prevMonth
  );

  const boundaryWarnings = result.warnings.filter((w) => w.includes('مرز ماه'));
  assert.ok(boundaryWarnings.length >= 1, 'expected at least one boundary warning');
});

test('verifyCoverageAndLeaders: no boundary warnings when prevMonth omitted', () => {
  const p = person('p', 'ROTATING_GENERAL');
  const assignments = { p: { 1: 'M', 2: 'OFF' } as Record<number, ShiftType> };

  const result = verifyCoverageAndLeaders(
    YEAR,
    MONTH,
    [p],
    assignments,
    INITIAL_SETTINGS,
    HOLIDAYS,
    undefined,
    []
    // prevMonthAssignments intentionally omitted (backward compatible)
  );

  const boundaryWarnings = result.warnings.filter((w) => w.includes('مرز ماه'));
  assert.equal(boundaryWarnings.length, 0);
});
