/**
 * Unit Tests — Boundary Continuity (lib/safetyConstraints.ts) — Task 4
 *
 * Run: tsx --test tests/safety-boundary.test.ts
 *
 * پوشش: extractPrevMonthTail و checkBoundaryContinuity برای مرز گذر ماه.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractPrevMonthTail,
  checkBoundaryContinuity,
} from '../lib/safetyConstraints';
import type { ShiftType } from '../lib/types';

// ============================================================================
// extractPrevMonthTail
// ============================================================================

test('extractPrevMonthTail: returns last N days oldest→newest', () => {
  const prev: Record<number, ShiftType> = { 1: 'M', 2: 'E', 3: 'N', 4: 'OFF' };
  assert.deepEqual(extractPrevMonthTail(prev, 2), ['N', 'OFF']);
  assert.deepEqual(extractPrevMonthTail(prev, 1), ['OFF']);
});

test('extractPrevMonthTail: missing tail days default to OFF', () => {
  const prev: Record<number, ShiftType> = { 30: 'M' };
  assert.deepEqual(extractPrevMonthTail(prev, 2), ['OFF', 'M']);
});

test('extractPrevMonthTail: edge cases (0 / empty)', () => {
  assert.deepEqual(extractPrevMonthTail({ 1: 'M' }, 0), []);
  assert.deepEqual(extractPrevMonthTail({}, 2), []);
});

// ============================================================================
// checkBoundaryContinuity — Sleep OFF across boundary
// ============================================================================

test('boundary night: night on last prev day + working day 1 → violation', () => {
  const cur: Record<number, ShiftType> = { 1: 'M', 2: 'OFF' };
  const r = checkBoundaryContinuity('p1', cur, ['OFF', 'N']);
  assert.equal(r.nightRecoveryViolations.length, 1);
  assert.equal(r.nightRecoveryViolations[0].nightShiftDay, 0); // 0 = آخرین روز ماه قبل
  assert.equal(r.nightRecoveryViolations[0].followingDay, 1);
});

test('boundary night: rest on day 1 → no violation', () => {
  const cur: Record<number, ShiftType> = { 1: 'OFF' };
  const r = checkBoundaryContinuity('p1', cur, ['OFF', 'N']);
  assert.equal(r.nightRecoveryViolations.length, 0);
});

test('boundary night: non-night last prev day → no violation', () => {
  const cur: Record<number, ShiftType> = { 1: 'M', 2: 'OFF' };
  const r = checkBoundaryContinuity('p1', cur, ['M', 'E']);
  assert.equal(r.nightRecoveryViolations.length, 0);
});

// ============================================================================
// checkBoundaryContinuity — Cumulative 32h across boundary
// ============================================================================

test('boundary cumulative: prev MEN+E (32) + current M (6.5) → violation on day 1', () => {
  // prevTail: MEN(25.5) + E(6.5) = 32.0 exactly; + current M(6.5) = 38.5 > 32
  const cur: Record<number, ShiftType> = { 1: 'M', 2: 'OFF' };
  const r = checkBoundaryContinuity('p1', cur, ['MEN', 'E']);
  assert.equal(r.cumulativeHourViolations.length, 1);
  const v = r.cumulativeHourViolations[0];
  assert.equal(v.mandatoryOffDay, 1);
  assert.equal(v.cumulativeHours, 38.5);
  assert.equal(v.excessHours, 6.5);
  assert.deepEqual(v.chainDays, [1]);
});

test('boundary cumulative: prev ends with OFF → no boundary violation', () => {
  // even a heavy current chain is not a boundary issue if prev ended in rest
  const cur: Record<number, ShiftType> = { 1: 'MEN', 2: 'MEN', 3: 'OFF' };
  const r = checkBoundaryContinuity('p1', cur, ['ME', 'OFF']);
  assert.equal(r.cumulativeHourViolations.length, 0);
});

test('boundary cumulative: within threshold → no violation', () => {
  // prev M+M = 13; current M = 6.5 → 19.5 ≤ 32
  const cur: Record<number, ShiftType> = { 1: 'M', 2: 'OFF' };
  const r = checkBoundaryContinuity('p1', cur, ['M', 'M']);
  assert.equal(r.cumulativeHourViolations.length, 0);
});

test('boundary cumulative: custom threshold respected', () => {
  // prev M(6.5)+M(6.5)=13, current M(6.5)=19.5; threshold 12 → violation day 1
  const cur: Record<number, ShiftType> = { 1: 'M', 2: 'OFF' };
  const r = checkBoundaryContinuity('p1', cur, ['M', 'M'], { cumulativeHoursThreshold: 12 });
  assert.equal(r.cumulativeHourViolations.length, 1);
  assert.equal(r.cumulativeHourViolations[0].mandatoryOffDay, 1);
});

// ============================================================================
// Combined / edge cases
// ============================================================================

test('boundary: both rules can fire together', () => {
  // prev last day N (night) and a long chain → night + cumulative
  const cur: Record<number, ShiftType> = { 1: 'MEN', 2: 'OFF' }; // current leading = MEN(25.5)
  // prevTail MEN(25.5) + N(12.5) = 38 prev chain; + current MEN 25.5 = 63.5
  const r = checkBoundaryContinuity('p1', cur, ['MEN', 'N']);
  assert.ok(r.nightRecoveryViolations.length >= 1);
  assert.equal(r.cumulativeHourViolations.length, 1);
});

test('boundary: empty prevTail → no violations', () => {
  const cur: Record<number, ShiftType> = { 1: 'MEN', 2: 'MEN', 3: 'OFF' };
  const r = checkBoundaryContinuity('p1', cur, []);
  assert.equal(r.nightRecoveryViolations.length, 0);
  assert.equal(r.cumulativeHourViolations.length, 0);
});

test('boundary: purity — same input yields same output', () => {
  const cur: Record<number, ShiftType> = { 1: 'M', 2: 'OFF' };
  const a = checkBoundaryContinuity('p1', cur, ['MEN', 'E']);
  const b = checkBoundaryContinuity('p1', cur, ['MEN', 'E']);
  assert.deepEqual(a, b);
});
