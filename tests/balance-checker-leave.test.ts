/**
 * Unit Tests — Holiday Leave Hours Crediting (lib/balanceChecker.ts) — Task 3
 *
 * Run: tsx --test tests/balance-checker-leave.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { HOLIDAY_LEAVE_CREDIT_HOURS, computeLeaveHours } from '../lib/balanceChecker';

test('HOLIDAY_LEAVE_CREDIT_HOURS is exactly 7', () => {
  assert.equal(HOLIDAY_LEAVE_CREDIT_HOURS, 7);
});

test('computeLeaveHours: all non-holiday leaves use the base rate', () => {
  // 3 leave days, 0 holiday → 3 * 7.5
  assert.equal(computeLeaveHours({ totalLeaveDays: 3, holidayLeaveDays: 0, baseLeaveRate: 7.5 }), 22.5);
});

test('computeLeaveHours: all holiday leaves credit exactly 7 each', () => {
  // 2 leave days, both on holidays → 2 * 7 (base rate ignored)
  assert.equal(computeLeaveHours({ totalLeaveDays: 2, holidayLeaveDays: 2, baseLeaveRate: 7.5 }), 14);
});

test('computeLeaveHours: mixed holiday/non-holiday leaves', () => {
  // 4 total: 1 holiday (7) + 3 non-holiday (3 * 7.5 = 22.5) = 29.5
  assert.equal(computeLeaveHours({ totalLeaveDays: 4, holidayLeaveDays: 1, baseLeaveRate: 7.5 }), 29.5);
});

test('computeLeaveHours: holiday count clamped to total leave days', () => {
  // defensively: holidayLeaveDays > totalLeaveDays → treat all as holiday
  assert.equal(computeLeaveHours({ totalLeaveDays: 1, holidayLeaveDays: 5, baseLeaveRate: 7.5 }), 7);
});

test('computeLeaveHours: zero leaves → 0', () => {
  assert.equal(computeLeaveHours({ totalLeaveDays: 0, holidayLeaveDays: 0, baseLeaveRate: 7 }), 0);
});
