/**
 * Unit Tests — RequestScopeMatcher
 *
 * Run: tsx --test tests/domain/request-scope-matcher.test.ts
 *
 * These tests verify the pure function that determines whether a given day
 * falls within the scope of a shift request, covering all 14 scope types.
 *
 * Day-of-week convention: 0=Saturday, 1=Sunday, 2=Monday, 3=Tuesday,
 *                         4=Wednesday, 5=Thursday, 6=Friday
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { isDayInRequestScope } from '../../domain/requests/request-scope-matcher';

// ============================================================================
// Scope: 'all'
// ============================================================================

test('scope "all": matches every day', () => {
  const req = { scope: 'all' as const };
  assert.equal(isDayInRequestScope(1, 0, req), true);
  assert.equal(isDayInRequestScope(15, 3, req), true);
  assert.equal(isDayInRequestScope(31, 6, req), true);
});

// ============================================================================
// Scope: 'even' / 'odd'
// ============================================================================

test('scope "even": matches even-numbered days only', () => {
  const req = { scope: 'even' as const };
  assert.equal(isDayInRequestScope(2, 1, req), true);
  assert.equal(isDayInRequestScope(4, 3, req), true);
  assert.equal(isDayInRequestScope(30, 5, req), true);
  assert.equal(isDayInRequestScope(1, 0, req), false);
  assert.equal(isDayInRequestScope(15, 2, req), false);
});

test('scope "odd": matches odd-numbered days only', () => {
  const req = { scope: 'odd' as const };
  assert.equal(isDayInRequestScope(1, 0, req), true);
  assert.equal(isDayInRequestScope(15, 2, req), true);
  assert.equal(isDayInRequestScope(31, 4, req), true);
  assert.equal(isDayInRequestScope(2, 1, req), false);
  assert.equal(isDayInRequestScope(20, 6, req), false);
});

// ============================================================================
// Scope: weekday-specific (saturdays through fridays)
// ============================================================================

test('scope "saturdays": matches only dayOfWeek=0', () => {
  const req = { scope: 'saturdays' as const };
  assert.equal(isDayInRequestScope(1, 0, req), true);   // Saturday
  assert.equal(isDayInRequestScope(8, 0, req), true);   // Another Saturday
  assert.equal(isDayInRequestScope(2, 1, req), false);   // Sunday
  assert.equal(isDayInRequestScope(7, 6, req), false);   // Friday
});

test('scope "sundays": matches only dayOfWeek=1', () => {
  const req = { scope: 'sundays' as const };
  assert.equal(isDayInRequestScope(2, 1, req), true);
  assert.equal(isDayInRequestScope(1, 0, req), false);
});

test('scope "mondays": matches only dayOfWeek=2', () => {
  const req = { scope: 'mondays' as const };
  assert.equal(isDayInRequestScope(3, 2, req), true);
  assert.equal(isDayInRequestScope(2, 1, req), false);
});

test('scope "tuesdays": matches only dayOfWeek=3', () => {
  const req = { scope: 'tuesdays' as const };
  assert.equal(isDayInRequestScope(4, 3, req), true);
  assert.equal(isDayInRequestScope(3, 2, req), false);
});

test('scope "wednesdays": matches only dayOfWeek=4', () => {
  const req = { scope: 'wednesdays' as const };
  assert.equal(isDayInRequestScope(5, 4, req), true);
  assert.equal(isDayInRequestScope(4, 3, req), false);
});

test('scope "thursdays": matches only dayOfWeek=5', () => {
  const req = { scope: 'thursdays' as const };
  assert.equal(isDayInRequestScope(6, 5, req), true);
  assert.equal(isDayInRequestScope(5, 4, req), false);
});

test('scope "fridays": matches only dayOfWeek=6', () => {
  const req = { scope: 'fridays' as const };
  assert.equal(isDayInRequestScope(7, 6, req), true);
  assert.equal(isDayInRequestScope(6, 5, req), false);
});

// ============================================================================
// Scope: 'weekly_even' / 'weekly_odd'
// ============================================================================

test('scope "weekly_even": matches Sat(0), Mon(2), Wed(4)', () => {
  const req = { scope: 'weekly_even' as const };
  assert.equal(isDayInRequestScope(1, 0, req), true);   // Saturday
  assert.equal(isDayInRequestScope(3, 2, req), true);   // Monday
  assert.equal(isDayInRequestScope(5, 4, req), true);   // Wednesday
  assert.equal(isDayInRequestScope(2, 1, req), false);   // Sunday
  assert.equal(isDayInRequestScope(4, 3, req), false);   // Tuesday
  assert.equal(isDayInRequestScope(6, 5, req), false);   // Thursday
  assert.equal(isDayInRequestScope(7, 6, req), false);   // Friday
});

test('scope "weekly_odd": matches Sun(1), Tue(3), Thu(5)', () => {
  const req = { scope: 'weekly_odd' as const };
  assert.equal(isDayInRequestScope(2, 1, req), true);   // Sunday
  assert.equal(isDayInRequestScope(4, 3, req), true);   // Tuesday
  assert.equal(isDayInRequestScope(6, 5, req), true);   // Thursday
  assert.equal(isDayInRequestScope(1, 0, req), false);   // Saturday
  assert.equal(isDayInRequestScope(3, 2, req), false);   // Monday
  assert.equal(isDayInRequestScope(5, 4, req), false);   // Wednesday
  assert.equal(isDayInRequestScope(7, 6, req), false);   // Friday
});

// ============================================================================
// Scope: 'range'
// ============================================================================

test('scope "range": matches days within start/end day-of-month', () => {
  const req = {
    scope: 'range' as const,
    startDate: '1404/03/10',
    endDate: '1404/03/20',
  };
  assert.equal(isDayInRequestScope(10, 0, req), true);
  assert.equal(isDayInRequestScope(15, 3, req), true);
  assert.equal(isDayInRequestScope(20, 5, req), true);
  assert.equal(isDayInRequestScope(9, 6, req), false);
  assert.equal(isDayInRequestScope(21, 0, req), false);
});

test('scope "range": returns false when dates are missing', () => {
  assert.equal(isDayInRequestScope(15, 0, { scope: 'range' }), false);
  assert.equal(
    isDayInRequestScope(15, 0, { scope: 'range', startDate: '1404/03/10' }),
    false
  );
  assert.equal(
    isDayInRequestScope(15, 0, { scope: 'range', endDate: '1404/03/20' }),
    false
  );
});

test('scope "range": single-day range matches exactly that day', () => {
  const req = {
    scope: 'range' as const,
    startDate: '1404/03/15',
    endDate: '1404/03/15',
  };
  assert.equal(isDayInRequestScope(15, 0, req), true);
  assert.equal(isDayInRequestScope(14, 6, req), false);
  assert.equal(isDayInRequestScope(16, 1, req), false);
});

// ============================================================================
// Scope: 'custom_days'
// ============================================================================

test('scope "custom_days": matches only explicitly listed days', () => {
  const req = { scope: 'custom_days' as const, selectedDays: [1, 5, 10, 15, 20] };
  assert.equal(isDayInRequestScope(1, 0, req), true);
  assert.equal(isDayInRequestScope(10, 3, req), true);
  assert.equal(isDayInRequestScope(20, 5, req), true);
  assert.equal(isDayInRequestScope(2, 1, req), false);
  assert.equal(isDayInRequestScope(11, 4, req), false);
});

test('scope "custom_days": returns false when selectedDays is undefined', () => {
  assert.equal(isDayInRequestScope(5, 0, { scope: 'custom_days' }), false);
});

test('scope "custom_days": returns false when selectedDays is empty', () => {
  assert.equal(
    isDayInRequestScope(5, 0, { scope: 'custom_days', selectedDays: [] }),
    false
  );
});

// ============================================================================
// Edge cases
// ============================================================================

test('unknown scope returns false', () => {
  // Simulate a future scope that doesn't exist yet
  const req = { scope: 'nonexistent' as any };
  assert.equal(isDayInRequestScope(1, 0, req), false);
});

test('day 1 boundary: even scope excludes, odd scope includes', () => {
  assert.equal(isDayInRequestScope(1, 0, { scope: 'even' }), false);
  assert.equal(isDayInRequestScope(1, 0, { scope: 'odd' }), true);
});

test('day 31 boundary: odd scope includes', () => {
  assert.equal(isDayInRequestScope(31, 0, { scope: 'odd' }), true);
  assert.equal(isDayInRequestScope(31, 0, { scope: 'even' }), false);
});
