/**
 * Unit Tests — SafetyConstraints (lib/safetyConstraints.ts)
 *
 * Run: tsx --test tests/safety-constraints.test.ts
 *
 * پوشش قوانین:
 *   1. قانون تجمعی ۳۲ ساعته
 *   2. قانون استراحت بعد از شب‌کار
 *   3. قانون ضد شیفت مجزا
 *   4. آشکارساز مرخصی جاری/قطعی
 * به‌علاوهٔ توابع کمکی و تجمیع‌کننده‌ها.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_CUMULATIVE_HOURS,
  DEFAULT_SHIFT_DURATION_HOURS,
  classifyShift,
  isWorkingShift,
  isLeaveShift,
  isOffShift,
  shiftIncludesNight,
  getShiftDurationHours,
  wouldExceedCumulativeThreshold,
  detectCumulativeHourViolations,
  detectNightRecoveryViolations,
  detectIsolatedShifts,
  detectOngoingLeaves,
  detectConfirmedLeaves,
  classifyLeaveRequest,
  isLeaveHardConstraint,
  evaluatePersonnelSafety,
  evaluateScheduleSafety,
} from '../lib/safetyConstraints';
import type { ShiftType } from '../lib/types';

const id = 'p1';

// ============================================================================
// Helpers
// ============================================================================

test('classifyShift: maps every shift kind to its status', () => {
  assert.equal(classifyShift('M'), 'work');
  assert.equal(classifyShift('MEN'), 'work');
  assert.equal(classifyShift('OFF'), 'off');
  assert.equal(classifyShift('L1'), 'leave');
  assert.equal(classifyShift('UNFILLED'), 'gap');
  assert.equal(classifyShift(undefined), 'gap');
  assert.equal(classifyShift('WEIRD' as ShiftType), 'gap');
});

test('isWorkingShift / isLeaveShift / isOffShift predicates', () => {
  assert.equal(isWorkingShift('E'), true);
  assert.equal(isWorkingShift('OFF'), false);
  assert.equal(isWorkingShift('L2'), false);
  assert.equal(isWorkingShift('UNFILLED'), false);
  assert.equal(isWorkingShift(undefined), false);

  assert.equal(isLeaveShift('L1'), true);
  assert.equal(isLeaveShift('OFF'), false);

  assert.equal(isOffShift('OFF'), true);
  assert.equal(isOffShift('M'), false);
});

test('shiftIncludesNight: only N/EN/MN/MEN', () => {
  for (const s of ['N', 'EN', 'MN', 'MEN'] as ShiftType[]) assert.equal(shiftIncludesNight(s), true);
  for (const s of ['M', 'E', 'ME', 'OFF', 'L1', 'UNFILLED'] as ShiftType[]) assert.equal(shiftIncludesNight(s), false);
});

test('getShiftDurationHours: canonical hours + leave/unknown are zero', () => {
  assert.equal(getShiftDurationHours('MEN'), 25.5);
  assert.equal(getShiftDurationHours('EN'), 19);
  assert.equal(getShiftDurationHours('N'), 12.5);
  assert.equal(getShiftDurationHours('M'), 6.5);
  assert.equal(getShiftDurationHours('OFF'), 0);
  assert.equal(getShiftDurationHours('L1'), 0);
  assert.equal(getShiftDurationHours('UNFILLED'), 0);
});

test('getShiftDurationHours: accepts a custom durations map', () => {
  assert.equal(getShiftDurationHours('M', { M: 8 }), 8);
  assert.equal(getShiftDurationHours('X' as ShiftType, { X: 3 }), 3);
});

// ============================================================================
// Rule 1 — Cumulative 32-Hour Rule
// ============================================================================

test('cumulative: chain at exactly 32 hours is allowed (no violation)', () => {
  // MEN(25.5) + E(6.5) = 32.0 → not strictly exceeding
  const a: Record<number, ShiftType> = { 1: 'MEN', 2: 'E', 3: 'OFF' };
  const v = detectCumulativeHourViolations(id, a, { totalDays: 3 });
  assert.equal(v.length, 0);
});

test('cumulative: chain exceeding 32 triggers a violation with mandatory OFF day', () => {
  // MEN(25.5) + E(6.5) + M(6.5) = 38.5 → exceeds at day 3
  const a: Record<number, ShiftType> = { 1: 'MEN', 2: 'E', 3: 'M', 4: 'OFF' };
  const v = detectCumulativeHourViolations(id, a, { totalDays: 4 });
  assert.equal(v.length, 1);
  assert.deepEqual(v[0].chainDays, [1, 2, 3]);
  assert.equal(v[0].cumulativeHours, 38.5);
  assert.equal(v[0].thresholdHours, 32);
  assert.equal(v[0].excessHours, 6.5);
  assert.equal(v[0].mandatoryOffDay, 3);
  assert.ok(v[0].message.includes('روز 3'));
});

test('cumulative: two long shifts (EN+EN) exceed 32', () => {
  const a: Record<number, ShiftType> = { 1: 'EN', 2: 'EN', 3: 'OFF' };
  const v = detectCumulativeHourViolations(id, a, { totalDays: 3 });
  assert.equal(v.length, 1);
  assert.equal(v[0].mandatoryOffDay, 2);
  assert.equal(v[0].cumulativeHours, 38);
});

test('cumulative: OFF breaks the chain', () => {
  // EN(19) + OFF + EN(19): two separate chains, each 19 → no violation
  const a: Record<number, ShiftType> = { 1: 'EN', 2: 'OFF', 3: 'EN', 4: 'OFF' };
  const v = detectCumulativeHourViolations(id, a, { totalDays: 4 });
  assert.equal(v.length, 0);
});

test('cumulative: leave also breaks the chain', () => {
  // MEN(25.5) + L1 + M(6.5): chains are [25.5] and [6.5] → no violation
  const a: Record<number, ShiftType> = { 1: 'MEN', 2: 'L1', 3: 'M', 4: 'OFF' };
  const v = detectCumulativeHourViolations(id, a, { totalDays: 4 });
  assert.equal(v.length, 0);
});

test('cumulative: custom threshold respected', () => {
  // With threshold 12: N(12.5) alone already exceeds → day 1 mandatory OFF
  const a: Record<number, ShiftType> = { 1: 'N', 2: 'OFF' };
  const v = detectCumulativeHourViolations(id, a, { totalDays: 2, cumulativeHoursThreshold: 12 });
  assert.equal(v.length, 1);
  assert.equal(v[0].mandatoryOffDay, 1);
  assert.equal(v[0].thresholdHours, 12);
});

test('cumulative: totalDays inferred from data when omitted', () => {
  const a: Record<number, ShiftType> = { 1: 'EN', 2: 'EN' }; // no totalDays
  const v = detectCumulativeHourViolations(id, a);
  assert.equal(v.length, 1);
});

test('wouldExceedCumulativeThreshold: pure building block', () => {
  assert.equal(wouldExceedCumulativeThreshold(25, 6.5, 32), false); // 31.5, not exceeding
  assert.equal(wouldExceedCumulativeThreshold(26, 6.5, 32), true); // 32.5 > 32
  assert.equal(wouldExceedCumulativeThreshold(25.5, 6.5, 32), false); // exactly 32, allowed
  assert.equal(wouldExceedCumulativeThreshold(0, 12.5), false); // default threshold 32
});

test('MAX_CUMULATIVE_HOURS and DEFAULT_SHIFT_DURATION_HOURS integrity', () => {
  assert.equal(MAX_CUMULATIVE_HOURS, 32);
  assert.equal(DEFAULT_SHIFT_DURATION_HOURS.MEN, 25.5);
});

// ============================================================================
// Rule 2 — Sleep OFF Rule
// ============================================================================

test('night recovery: OFF after night is OK', () => {
  const a: Record<number, ShiftType> = { 1: 'N', 2: 'OFF' };
  assert.equal(detectNightRecoveryViolations(id, a, { totalDays: 2 }).length, 0);
});

test('night recovery: working shift after night is a violation', () => {
  const a: Record<number, ShiftType> = { 1: 'N', 2: 'M' };
  const v = detectNightRecoveryViolations(id, a, { totalDays: 2 });
  assert.equal(v.length, 1);
  assert.equal(v[0].nightShiftDay, 1);
  assert.equal(v[0].followingDay, 2);
  assert.equal(v[0].nightShift, 'N');
  assert.equal(v[0].followingShift, 'M');
});

test('night recovery: leave after night counts as rest (no violation)', () => {
  const a: Record<number, ShiftType> = { 1: 'EN', 2: 'L1' };
  assert.equal(detectNightRecoveryViolations(id, a, { totalDays: 2 }).length, 0);
});

test('night recovery: night on the last day is OK (no following day)', () => {
  const a: Record<number, ShiftType> = { 1: 'OFF', 2: 'N' };
  assert.equal(detectNightRecoveryViolations(id, a, { totalDays: 2 }).length, 0);
});

test('night recovery: non-night shifts are not flagged', () => {
  const a: Record<number, ShiftType> = { 1: 'M', 2: 'E' };
  assert.equal(detectNightRecoveryViolations(id, a, { totalDays: 2 }).length, 0);
});

// ============================================================================
// Rule 3 — Anti-Single Shift Rule
// ============================================================================

test('isolated: standalone E between OFFs is isolated', () => {
  const a: Record<number, ShiftType> = { 1: 'OFF', 2: 'E', 3: 'OFF' };
  const v = detectIsolatedShifts(id, a, { totalDays: 3 });
  assert.equal(v.length, 1);
  assert.equal(v[0].day, 2);
  assert.equal(v[0].shift, 'E');
});

test('isolated: consecutive working days are not isolated', () => {
  const a: Record<number, ShiftType> = { 1: 'E', 2: 'E', 3: 'OFF' };
  assert.equal(detectIsolatedShifts(id, a, { totalDays: 3 }).length, 0);
});

test('isolated: working day at month start with rest after is isolated', () => {
  const a: Record<number, ShiftType> = { 1: 'M', 2: 'OFF' };
  const v = detectIsolatedShifts(id, a, { totalDays: 2 });
  assert.equal(v.length, 1);
  assert.equal(v[0].day, 1);
});

test('isolated: chain of three is not isolated', () => {
  const a: Record<number, ShiftType> = { 1: 'OFF', 2: 'M', 3: 'M', 4: 'M', 5: 'OFF' };
  assert.equal(detectIsolatedShifts(id, a, { totalDays: 5 }).length, 0);
});

// ============================================================================
// Rule 4 — Ongoing Leave Detector
// ============================================================================

test('ongoing leaves: detects L* shifts sorted by day', () => {
  const a: Record<number, ShiftType> = { 3: 'L1', 1: 'M', 5: 'L2', 7: 'OFF' };
  const v = detectOngoingLeaves(id, a);
  assert.deepEqual(
    v.map((c) => ({ day: c.day, code: c.leaveCode })),
    [
      { day: 3, code: 'L1' },
      { day: 5, code: 'L2' },
    ]
  );
  assert.equal(detectConfirmedLeaves, detectOngoingLeaves); // alias
});

test('ongoing leaves: ignores non-leave shifts', () => {
  const a: Record<number, ShiftType> = { 1: 'M', 2: 'OFF', 3: 'UNFILLED' };
  assert.equal(detectOngoingLeaves(id, a).length, 0);
});

test('classifyLeaveRequest: essential request is a hard constraint', () => {
  const req = makeLeaveRequest('r1', true);
  const c = classifyLeaveRequest(req, { isScheduleLocked: false });
  assert.equal(c.isHardConstraint, true);
  assert.equal(c.reason, 'essential_request');
});

test('classifyLeaveRequest: locked schedule makes any leave hard', () => {
  const req = makeLeaveRequest('r2', false);
  const c = classifyLeaveRequest(req, { isScheduleLocked: true });
  assert.equal(c.isHardConstraint, true);
  assert.equal(c.reason, 'locked_schedule');
});

test('classifyLeaveRequest: non-essential open leave is an adjustable draft', () => {
  const req = makeLeaveRequest('r3', false);
  const c = classifyLeaveRequest(req, { isScheduleLocked: false });
  assert.equal(c.isHardConstraint, false);
  assert.equal(c.reason, 'adjustable_draft');
});

test('isLeaveHardConstraint: boolean convenience', () => {
  assert.equal(isLeaveHardConstraint(makeLeaveRequest('r4', true), {}), true);
  assert.equal(isLeaveHardConstraint(makeLeaveRequest('r5', false), {}), false);
  assert.equal(isLeaveHardConstraint(makeLeaveRequest('r6', false), { isScheduleLocked: true }), true);
});

test('classifyLeaveRequest: materialized leave is the strongest red-line', () => {
  // حتی یک درخواست غیرضروری، اگر منتشرشده باشد، سخت است.
  const c = classifyLeaveRequest(makeLeaveRequest('r7', false), { isMaterialized: true });
  assert.equal(c.isHardConstraint, true);
  assert.equal(c.reason, 'materialized_in_schedule');
  // ماده‌شده بر ضروری بودن تقدم دارد.
  const c2 = classifyLeaveRequest(makeLeaveRequest('r8', true), { isMaterialized: true });
  assert.equal(c2.reason, 'materialized_in_schedule');
});

// ============================================================================
// Aggregators
// ============================================================================

test('evaluatePersonnelSafety: combines all rules', () => {
  // N(day1) + M(day2): night recovery violation + 2-day chain (12.5+6.5=19 ≤ 32, OK)
  // day3 OFF, day4 E isolated between rests
  const a: Record<number, ShiftType> = { 1: 'N', 2: 'M', 3: 'OFF', 4: 'E', 5: 'OFF', 6: 'L1' };
  const r = evaluatePersonnelSafety(id, a, { totalDays: 6 });

  assert.equal(r.nightRecoveryViolations.length, 1);
  assert.equal(r.isolatedShifts.length, 1);
  assert.equal(r.isolatedShifts[0].day, 4);
  assert.equal(r.cumulativeHourViolations.length, 0);
  assert.equal(r.confirmedLeaves.length, 1);
  assert.equal(r.confirmedLeaves[0].day, 6);
  assert.equal(r.totalHardViolations, 2); // 1 night + 1 confirmed leave
  assert.equal(r.totalSoftWarnings, 1);
});

test('evaluateScheduleSafety: iterates all personnel', () => {
  const byPersonnel: Record<string, Record<number, ShiftType>> = {
    p1: { 1: 'N', 2: 'M' }, // night recovery violation
    p2: { 1: 'OFF', 2: 'E', 3: 'OFF' }, // isolated shift
  };
  const reports = evaluateScheduleSafety(byPersonnel, { totalDays: 3 });
  assert.equal(reports.length, 2);
  const ids = reports.map((r) => r.personnelId).sort();
  assert.deepEqual(ids, ['p1', 'p2']);
  const p1 = reports.find((r) => r.personnelId === 'p1')!;
  assert.equal(p1.nightRecoveryViolations.length, 1);
  const p2 = reports.find((r) => r.personnelId === 'p2')!;
  assert.equal(p2.isolatedShifts.length, 1);
});

test('purity: same input always yields same output', () => {
  const a: Record<number, ShiftType> = { 1: 'EN', 2: 'EN', 3: 'OFF' };
  const r1 = evaluatePersonnelSafety(id, a, { totalDays: 3 });
  const r2 = evaluatePersonnelSafety(id, a, { totalDays: 3 });
  assert.deepEqual(r1, r2);
});

test('purity: input assignments are not mutated', () => {
  const a: Record<number, ShiftType> = { 1: 'N', 2: 'M', 3: 'OFF' };
  const snapshot = JSON.stringify(a);
  evaluatePersonnelSafety(id, a, { totalDays: 3 });
  assert.equal(JSON.stringify(a), snapshot);
});

// ============================================================================
// Helpers (fixtures)
// ============================================================================

function makeLeaveRequest(id: string, isEssential: boolean) {
  return {
    id,
    personnelId: 'p1',
    requestType: 'leave' as const,
    isEssential,
    scope: 'range' as const,
    startDate: '1405/03/10',
    endDate: '1405/03/14',
  };
}
