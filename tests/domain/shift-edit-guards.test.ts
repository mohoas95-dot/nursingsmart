/**
 * Unit Tests — ShiftEditGuards
 *
 * Run: tsx --test tests/domain/shift-edit-guards.test.ts
 *
 * These tests verify the pure guard predicates that determine editability
 * of schedule cells and rows, without any UI side effects.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isScheduleLocked,
  isPersonnelRowLocked,
  canEditShiftCell,
  isPersonnelOptimizationTarget,
} from '../../domain/guards/shift-edit-guards';

// ============================================================================
// isScheduleLocked
// ============================================================================

test('isScheduleLocked: returns true when monthKey is in finalizedMonths', () => {
  assert.equal(isScheduleLocked('nurse', ['1404_3', '1404_5'], '1404_3'), true);
});

test('isScheduleLocked: returns false when monthKey is NOT in finalizedMonths', () => {
  assert.equal(isScheduleLocked('nurse', ['1404_3', '1404_5'], '1404_4'), false);
});

test('isScheduleLocked: returns false for empty finalizedMonths', () => {
  assert.equal(isScheduleLocked('nurse', [], '1404_3'), false);
});

test('isScheduleLocked: exact string match required', () => {
  assert.equal(isScheduleLocked('nurse', ['1404_3'], '1404_30'), false);
  assert.equal(isScheduleLocked('nurse', ['1404_3'], '1404_3'), true);
});

// ============================================================================
// isPersonnelRowLocked
// ============================================================================

test('isPersonnelRowLocked: returns true when personnelId is in lockedRows', () => {
  assert.equal(isPersonnelRowLocked('p1', ['p1', 'p2', 'p3']), true);
});

test('isPersonnelRowLocked: returns false when personnelId is NOT in lockedRows', () => {
  assert.equal(isPersonnelRowLocked('p4', ['p1', 'p2', 'p3']), false);
});

test('isPersonnelRowLocked: returns false for empty lockedRows', () => {
  assert.equal(isPersonnelRowLocked('p1', []), false);
});

// ============================================================================
// canEditShiftCell
// ============================================================================

test('canEditShiftCell: allowed when nothing is locked', () => {
  const result = canEditShiftCell({
    jobGroup: 'nurse',
    personnelId: 'p1',
    finalizedMonths: [],
    lockedRows: [],
    monthKey: '1404_3',
  });
  assert.equal(result.allowed, true);
  assert.equal(result.reason, 'valid');
  assert.equal(result.message, undefined);
});

test('canEditShiftCell: denied with schedule_locked for nurse', () => {
  const result = canEditShiftCell({
    jobGroup: 'nurse',
    personnelId: 'p1',
    finalizedMonths: ['1404_3'],
    lockedRows: [],
    monthKey: '1404_3',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'schedule_locked');
  assert.ok(result.message?.includes('پرستاران'));
});

test('canEditShiftCell: denied with schedule_locked for assistant', () => {
  const result = canEditShiftCell({
    jobGroup: 'assistant',
    personnelId: 'p1',
    finalizedMonths: ['1404_3'],
    lockedRows: [],
    monthKey: '1404_3',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'schedule_locked');
  assert.ok(result.message?.includes('کمک‌بهیاران'));
});

test('canEditShiftCell: denied with row_locked when row is locked', () => {
  const result = canEditShiftCell({
    jobGroup: 'nurse',
    personnelId: 'p1',
    finalizedMonths: [],
    lockedRows: ['p1', 'p2'],
    monthKey: '1404_3',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'row_locked');
  assert.ok(result.message?.includes('ردیف'));
});

test('canEditShiftCell: schedule_locked takes precedence over row_locked', () => {
  const result = canEditShiftCell({
    jobGroup: 'nurse',
    personnelId: 'p1',
    finalizedMonths: ['1404_3'],
    lockedRows: ['p1'],
    monthKey: '1404_3',
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'schedule_locked');
});

test('canEditShiftCell: allowed when different month is locked', () => {
  const result = canEditShiftCell({
    jobGroup: 'nurse',
    personnelId: 'p1',
    finalizedMonths: ['1404_4'],
    lockedRows: [],
    monthKey: '1404_3',
  });
  assert.equal(result.allowed, true);
});

test('canEditShiftCell: allowed when different personnel row is locked', () => {
  const result = canEditShiftCell({
    jobGroup: 'nurse',
    personnelId: 'p1',
    finalizedMonths: [],
    lockedRows: ['p2', 'p3'],
    monthKey: '1404_3',
  });
  assert.equal(result.allowed, true);
});

// ============================================================================
// isPersonnelOptimizationTarget
// ============================================================================

test('isPersonnelOptimizationTarget: true when job group matches and row not locked', () => {
  assert.equal(
    isPersonnelOptimizationTarget('nurse', 'nurse', 'p1', ['p2']),
    true
  );
});

test('isPersonnelOptimizationTarget: false when job group does not match', () => {
  assert.equal(
    isPersonnelOptimizationTarget('assistant', 'nurse', 'p1', []),
    false
  );
});

test('isPersonnelOptimizationTarget: false when row is locked', () => {
  assert.equal(
    isPersonnelOptimizationTarget('nurse', 'nurse', 'p1', ['p1']),
    false
  );
});

test('isPersonnelOptimizationTarget: false when both mismatched and locked', () => {
  assert.equal(
    isPersonnelOptimizationTarget('assistant', 'nurse', 'p1', ['p1']),
    false
  );
});
