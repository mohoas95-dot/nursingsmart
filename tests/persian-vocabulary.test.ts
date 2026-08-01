import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCOPE_LABELS,
  SCOPE_LABELS_SHORT,
  SHIFT_LABELS,
  WEEKLY_EVEN_DAY_NAMES,
  WEEKLY_ODD_DAY_NAMES,
  formatDayList,
  formatDayOrdinal,
  getShiftLabel,
  toPersianDigits,
} from '../lib/persian-vocabulary';

// ============================================================================
// «۲۴» به‌جای «شیفت ۲۴ / تمام روز» و «لانگ» به‌جای «صبح-عصر»  (ایراد شمارهٔ ۳)
// ============================================================================

test('MEN همیشه «۲۴» نامیده می‌شود، نه «شیفت ۲۴» یا «تمام روز»', () => {
  const label = getShiftLabel('MEN');
  assert.equal(label, '۲۴ (MEN)');
  assert.ok(!label.includes('شیفت ۲۴'));
  assert.ok(!label.includes('تمام روز'));
  assert.ok(!label.includes('کل روز'));
  assert.ok(!label.includes('ترکیبی'));
});

test('ME همیشه «لانگ» نامیده می‌شود، نه «صبح-عصر»', () => {
  const label = getShiftLabel('ME');
  assert.equal(label, 'لانگ (ME)');
  assert.ok(!label.includes('صبح-عصر'));
  assert.ok(!label.includes('عصر-صبح'));
});

test('هیچ برچسب شیفتی عبارت «صبح-عصر» یا «شیفت ۲۴» ندارد', () => {
  for (const [code, label] of Object.entries(SHIFT_LABELS)) {
    assert.ok(!/صبح-عصر|عصر-صبح|شیفت ۲۴|شیفت 24/.test(label), `برچسب ${code} واژگان قدیمی دارد: ${label}`);
  }
});

test('هیچ برچسب شیفتی عبارت «تمام روز» یا «کل روز» ندارد', () => {
  for (const [code, label] of Object.entries(SHIFT_LABELS)) {
    assert.ok(!/تمام روز|کل روز/.test(label), `برچسب ${code} نباید «تمام روز» داشته باشد: ${label}`);
  }
});

test('برچسب شیفت‌های پایه درست است', () => {
  assert.equal(getShiftLabel('M'), 'صبح (M)');
  assert.equal(getShiftLabel('E'), 'عصر (E)');
  assert.equal(getShiftLabel('N'), 'شب (N)');
  assert.equal(getShiftLabel('OFF'), 'آف');
  assert.equal(getShiftLabel('L'), 'مرخصی');
});

test('کد ناشناخته بدون خطا برگردانده می‌شود', () => {
  assert.equal(getShiftLabel('XYZ'), 'XYZ');
  assert.equal(getShiftLabel(undefined), '');
});

// ============================================================================
// «تاریخ‌های ۵اُم، ۷اُم» به‌جای «روزهای 5، 7»  (ایراد شمارهٔ ۳)
// ============================================================================

test('ارقام لاتین به فارسی تبدیل می‌شوند', () => {
  assert.equal(toPersianDigits(5), '۵');
  assert.equal(toPersianDigits(12), '۱۲');
  assert.equal(toPersianDigits('2026/07/31'), '۲۰۲۶/۰۷/۳۱');
});

test('شمارهٔ روز با پسوند «اُم» قالب‌بندی می‌شود', () => {
  assert.equal(formatDayOrdinal(5), '۵اُم');
  assert.equal(formatDayOrdinal(7), '۷اُم');
  assert.equal(formatDayOrdinal(31), '۳۱اُم');
});

test('فهرست روزها به شکل «۵اُم، ۷اُم، ۹اُم» درمی‌آید', () => {
  assert.equal(formatDayList([5, 7, 9]), '۵اُم، ۷اُم، ۹اُم');
});

test('فهرست روزها همیشه مرتب می‌شود', () => {
  assert.equal(formatDayList([9, 5, 7]), '۵اُم، ۷اُم، ۹اُم');
});

test('فهرست خالی رشتهٔ خالی می‌دهد (بدون خطا)', () => {
  assert.equal(formatDayList([]), '');
  assert.equal(formatDayList(undefined), '');
});

test('خروجی فهرست روز هیچ رقم لاتینی ندارد', () => {
  assert.ok(!/[0-9]/.test(formatDayList([1, 10, 25])));
});

// ============================================================================
// تفکیک «روز فرد/زوج» از «تاریخ فرد/زوج»  (ایراد شمارهٔ ۴)
// ============================================================================

test('روزهای فرد هفته دقیقاً یکشنبه، سه‌شنبه، پنج‌شنبه است', () => {
  assert.deepEqual([...WEEKLY_ODD_DAY_NAMES], ['یکشنبه', 'سه‌شنبه', 'پنج‌شنبه']);
});

test('روزهای زوج هفته دقیقاً شنبه، دوشنبه، چهارشنبه است', () => {
  assert.deepEqual([...WEEKLY_EVEN_DAY_NAMES], ['شنبه', 'دوشنبه', 'چهارشنبه']);
});

test('جمعه در هیچ‌کدام از روزهای زوج/فرد هفته نیست', () => {
  assert.ok(!WEEKLY_ODD_DAY_NAMES.includes('جمعه' as never));
  assert.ok(!WEEKLY_EVEN_DAY_NAMES.includes('جمعه' as never));
});

test('برچسب weekly_odd نام هر سه روز هفته را دارد', () => {
  const label = SCOPE_LABELS.weekly_odd;
  for (const day of WEEKLY_ODD_DAY_NAMES) {
    assert.ok(label.includes(day), `«${day}» باید در برچسب باشد: ${label}`);
  }
});

test('برچسب weekly_even نام هر سه روز هفته را دارد', () => {
  const label = SCOPE_LABELS.weekly_even;
  for (const day of WEEKLY_EVEN_DAY_NAMES) {
    assert.ok(label.includes(day), `«${day}» باید در برچسب باشد: ${label}`);
  }
});

test('odd/even دربارهٔ «تاریخ» حرف می‌زنند و weekly_* دربارهٔ «روز»', () => {
  // تاریخ = شمارهٔ روز ماه
  assert.ok(SCOPE_LABELS.odd.includes('تاریخ'), SCOPE_LABELS.odd);
  assert.ok(SCOPE_LABELS.even.includes('تاریخ'), SCOPE_LABELS.even);
  // روز = روز هفته
  assert.ok(SCOPE_LABELS.weekly_odd.includes('روزهای فرد هفته'), SCOPE_LABELS.weekly_odd);
  assert.ok(SCOPE_LABELS.weekly_even.includes('روزهای زوج هفته'), SCOPE_LABELS.weekly_even);
});

test('برچسب تاریخ فرد مثال ۱اُم/۳اُم/۵اُم دارد و زوج مثال ۲اُم/۴اُم/۶اُم', () => {
  assert.ok(SCOPE_LABELS.odd.includes('۱اُم'), SCOPE_LABELS.odd);
  assert.ok(SCOPE_LABELS.odd.includes('۳اُم'), SCOPE_LABELS.odd);
  assert.ok(SCOPE_LABELS.even.includes('۲اُم'), SCOPE_LABELS.even);
  assert.ok(SCOPE_LABELS.even.includes('۴اُم'), SCOPE_LABELS.even);
});

test('نسخهٔ کوتاه برچسب‌ها هم تفکیک روز/تاریخ را حفظ می‌کند', () => {
  assert.ok(SCOPE_LABELS_SHORT.odd.includes('تاریخ'), SCOPE_LABELS_SHORT.odd);
  assert.ok(SCOPE_LABELS_SHORT.weekly_odd.includes('روزهای فرد هفته'), SCOPE_LABELS_SHORT.weekly_odd);
});
