import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dismissedWarningsChanged,
  findResolvedWarnings,
  pruneDismissedWarningMap,
  pruneDismissedWarnings,
} from '../../domain/scheduling/alert-lifecycle';

const WARN_A = 'Max Consecutive: عدم رعایت سقف ۵ شیفت متوالی برای علی رضایی از روز 1 (M) تا روز 2 (M)';
const WARN_B = 'Coverage Shortage: کمبود نیرو در شیفت صبح روز 5';
const WARN_C = 'Isolated Shift: شیفت تک (E) برای زهرا محمدی در روز 9';

// ============================================================================
// pruneDismissedWarnings — هشدار رفع‌شده باید کاملاً از سیستم برود
// ============================================================================

test('a dismissed warning that is no longer produced is dropped entirely', () => {
  // سرپرستار WARN_A را نادیده گرفته بود و سپس مشکلش را واقعاً اصلاح کرد.
  const active = [WARN_B];
  assert.deepEqual(pruneDismissedWarnings(active, [WARN_A, WARN_B]), [WARN_B]);
});

test('dismissals of still-active warnings survive pruning', () => {
  const active = [WARN_A, WARN_B, WARN_C];
  assert.deepEqual(pruneDismissedWarnings(active, [WARN_A, WARN_C]), [WARN_A, WARN_C]);
});

test('pruning an empty dismissal list is a no-op', () => {
  assert.deepEqual(pruneDismissedWarnings([WARN_A], []), []);
});

test('when every problem is fixed, no dismissal record remains', () => {
  assert.deepEqual(pruneDismissedWarnings([], [WARN_A, WARN_B, WARN_C]), []);
});

test('duplicate dismissal entries are collapsed', () => {
  assert.deepEqual(pruneDismissedWarnings([WARN_A], [WARN_A, WARN_A]), [WARN_A]);
});

test('a re-created violation is NOT silently hidden by an old dismissal record', () => {
  // ۱) تخلف وجود دارد و سرپرستار آن را نادیده می‌گیرد.
  const afterDismiss: string[] = pruneDismissedWarnings([WARN_A], [WARN_A]);
  assert.deepEqual(afterDismiss, [WARN_A]);

  // ۲) سرپرستار شیفت را اصلاح می‌کند؛ هشدار دیگر تولید نمی‌شود → رکورد پاک می‌شود.
  const dismissed: string[] = pruneDismissedWarnings([], afterDismiss);
  assert.equal(dismissed.length, 0);

  // ۳) بعداً پس از بازتولید، دقیقاً همان تخلف دوباره ساخته می‌شود.
  //    چون رکورد قدیمی پاک شده بود، این‌بار هشدار باید دیده شود (نه پنهان).
  const visible = [WARN_A].filter(w => !dismissed.includes(w));
  assert.deepEqual(visible, [WARN_A], 'تخلف دوبارهٔ ساخته‌شده باید دوباره هشدار بدهد');
});

// ============================================================================
// pruneDismissedWarningMap — همان منطق روی نگاشت رابط کاربری
// ============================================================================

test('the UI dismissal map keeps only entries backed by an active warning', () => {
  const map = { [WARN_A]: true, [WARN_B]: true };
  assert.deepEqual(pruneDismissedWarningMap([WARN_B], map), { [WARN_B]: true });
});

test('falsy entries in the UI dismissal map are discarded', () => {
  const map = { [WARN_A]: false, [WARN_B]: true };
  assert.deepEqual(pruneDismissedWarningMap([WARN_A, WARN_B], map), { [WARN_B]: true });
});

// ============================================================================
// findResolvedWarnings / dismissedWarningsChanged
// ============================================================================

test('findResolvedWarnings reports exactly the warnings that disappeared', () => {
  assert.deepEqual(findResolvedWarnings([WARN_A, WARN_B], [WARN_B]), [WARN_A]);
  assert.deepEqual(findResolvedWarnings([WARN_A], [WARN_A]), []);
  assert.deepEqual(findResolvedWarnings([], [WARN_A]), []);
});

test('dismissedWarningsChanged detects additions, removals, and reordering', () => {
  assert.equal(dismissedWarningsChanged([WARN_A], [WARN_A]), false);
  assert.equal(dismissedWarningsChanged([], []), false);
  assert.equal(dismissedWarningsChanged([WARN_A], []), true);
  assert.equal(dismissedWarningsChanged([WARN_A], [WARN_B]), true);
  assert.equal(dismissedWarningsChanged([WARN_A, WARN_B], [WARN_B, WARN_A]), true);
});
