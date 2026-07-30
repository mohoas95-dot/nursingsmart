import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PERSIAN_VOCABULARY_LESSON,
  SCOPE_LABELS,
  SCOPE_LABELS_SHORT,
  SHIFT_LABELS,
  WEEKLY_EVEN_DAY_NAMES,
  WEEKLY_ODD_DAY_NAMES,
  formatDayList,
  formatDayOrdinal,
  getShiftLabel,
  toPersianDigits,
} from '../lib/ai/persian-vocabulary';
import {
  IMAGE_UNREADABLE_MESSAGE,
  isFileUnreadableError,
} from '../lib/image-file';

// ============================================================================
// «شیفت ۲۴» به‌جای «تمام روز»  (ایراد شمارهٔ ۳)
// ============================================================================

test('MEN همیشه «شیفت ۲۴» نامیده می‌شود، نه «تمام روز»', () => {
  const label = getShiftLabel('MEN');
  assert.ok(label.includes('شیفت ۲۴'), `انتظار «شیفت ۲۴» بود ولی «${label}» آمد`);
  assert.ok(!label.includes('تمام روز'));
  assert.ok(!label.includes('کل روز'));
  assert.ok(!label.includes('ترکیبی'));
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

// ============================================================================
// درس واژگانی که به هوش مصنوعی داده می‌شود
// ============================================================================

test('درس واژگانی هر چهار نگاشت فرد/زوج را صریح آموزش می‌دهد', () => {
  assert.ok(PERSIAN_VOCABULARY_LESSON.includes('«روزهای فرد»'));
  assert.ok(PERSIAN_VOCABULARY_LESSON.includes('weekly_odd'));
  assert.ok(PERSIAN_VOCABULARY_LESSON.includes('«تاریخ‌های فرد»'));
  assert.ok(/«تاریخ‌های فرد»[^\n]*scope="odd"/.test(PERSIAN_VOCABULARY_LESSON));
  assert.ok(/«روزهای زوج»[^\n]*weekly_even/.test(PERSIAN_VOCABULARY_LESSON));
});

test('درس واژگانی «شیفت ۲۴» را الزامی و «تمام روز» را ممنوع می‌کند', () => {
  assert.ok(PERSIAN_VOCABULARY_LESSON.includes('«شیفت ۲۴»'));
  assert.ok(PERSIAN_VOCABULARY_LESSON.includes('NEVER say «تمام روز»'));
});

test('درس واژگانی قالب «اُم» را الزامی می‌کند ولی JSON را لاتین نگه می‌دارد', () => {
  assert.ok(PERSIAN_VOCABULARY_LESSON.includes('«۵اُم»'));
  // این نکته حیاتی است: اگر مدل ارقام فارسی داخل selectedDays بگذارد، پارس خراب می‌شود.
  assert.ok(PERSIAN_VOCABULARY_LESSON.includes('selectedDays'));
  assert.ok(/Latin integers/i.test(PERSIAN_VOCABULARY_LESSON));
});

test('درس واژگانی تأکید می‌کند جمعه جزو زوج/فرد هفته نیست', () => {
  assert.ok(/جمعه NEVER/.test(PERSIAN_VOCABULARY_LESSON));
});

// ============================================================================
// خطای خواندن فایل تصویر  (ایراد شمارهٔ ۱)
// ============================================================================

test('خطای NotReadableError مرورگر تشخیص داده می‌شود', () => {
  const error = new Error('The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.');
  error.name = 'NotReadableError';
  assert.equal(isFileUnreadableError(error), true);
});

test('تشخیص خطا حتی بدون name فقط از روی متن هم کار می‌کند', () => {
  assert.equal(
    isFileUnreadableError(new Error('The requested file could not be read, typically due to permission problems')),
    true,
  );
});

test('NotFoundError (فایل حذف‌شده پس از انتخاب) هم پوشش دارد', () => {
  const error = new Error('A requested file or directory could not be found');
  error.name = 'NotFoundError';
  assert.equal(isFileUnreadableError(error), true);
});

test('خطاهای نامرتبط به‌اشتباه «غیرقابل خواندن» علامت نمی‌خورند', () => {
  assert.equal(isFileUnreadableError(new Error('network timeout')), false);
  assert.equal(isFileUnreadableError(null), false);
  assert.equal(isFileUnreadableError(undefined), false);
});

test('پیام راهنمای فارسی به کاربر می‌گوید دقیقاً چه کار کند', () => {
  assert.ok(!/[A-Za-z]{4,}/.test(IMAGE_UNREADABLE_MESSAGE.replace(/Google Photos/g, '')),
    'پیام باید فارسی باشد (جز نام سرویس)');
  assert.ok(IMAGE_UNREADABLE_MESSAGE.includes('گالری'), 'باید راه‌حل عملی پیشنهاد دهد');
});
