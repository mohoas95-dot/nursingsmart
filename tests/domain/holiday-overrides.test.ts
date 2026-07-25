/**
 * Unit Tests — HolidayOverrides
 *
 * Run: tsx --test tests/domain/holiday-overrides.test.ts
 *
 * این تست‌ها تضمین می‌کنند که تغییرات تعطیلی سرپرستار روی تقویم رسمی فقط‌خواندنی
 * درست اعمال، درست ذخیره و پس از همگام‌سازی مجدد ماه حفظ می‌شوند.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_CUSTOM_HOLIDAY_TITLE,
  WORKING_DAY_OVERRIDE,
  clearHolidayOverride,
  diffHolidayOverrides,
  holidayOverrideTitle,
  holidaySource,
  isEffectiveHoliday,
  isWorkingDayOverride,
  mergeHolidayOverrides,
  setHolidayOverride,
  toggleHolidayOverride,
  type HolidayMap,
} from '../../domain/calendar/holiday-overrides';

const OFFICIAL: HolidayMap = { 3: 'عید سعید فطر', 12: 'رحلت امام خمینی' };

// ============================================================================
// mergeHolidayOverrides
// ============================================================================

test('mergeHolidayOverrides: بدون تغییر، خروجی همان تقویم رسمی است', () => {
  assert.deepEqual(mergeHolidayOverrides(OFFICIAL, {}), { 3: 'عید سعید فطر', 12: 'رحلت امام خمینی' });
});

test('mergeHolidayOverrides: افزودن تعطیل انتخابی به تعطیلات رسمی', () => {
  const merged = mergeHolidayOverrides(OFFICIAL, { 20: 'مناسبت داخلی بیمارستان' });
  assert.equal(merged[3], 'عید سعید فطر');
  assert.equal(merged[20], 'مناسبت داخلی بیمارستان');
});

test('mergeHolidayOverrides: نگهبان روز کاری، تعطیلی رسمی را برمی‌دارد', () => {
  const merged = mergeHolidayOverrides(OFFICIAL, { 3: WORKING_DAY_OVERRIDE });
  assert.equal(merged[3], undefined);
  assert.equal(merged[12], 'رحلت امام خمینی');
});

test('mergeHolidayOverrides: عنوان رسمی قابل بازنویسی توسط سرپرستار است', () => {
  const merged = mergeHolidayOverrides(OFFICIAL, { 12: 'تعطیل ویژه بخش' });
  assert.equal(merged[12], 'تعطیل ویژه بخش');
});

test('mergeHolidayOverrides: عنوان خالی روز را از حالت تعطیل خارج نمی‌کند', () => {
  const merged = mergeHolidayOverrides({}, { 8: '' });
  assert.equal(merged[8], DEFAULT_CUSTOM_HOLIDAY_TITLE);
});

test('mergeHolidayOverrides: کلیدهای رشته‌ای ذخیره‌سازی JSON به عدد نرمال می‌شوند', () => {
  const merged = mergeHolidayOverrides({ '5': 'رسمی' } as unknown as HolidayMap, { '9': 'انتخابی' } as unknown as HolidayMap);
  assert.equal(merged[5], 'رسمی');
  assert.equal(merged[9], 'انتخابی');
});

test('mergeHolidayOverrides: ورودی‌ها تغییر داده نمی‌شوند (immutability)', () => {
  const overrides: HolidayMap = { 20: 'الف' };
  mergeHolidayOverrides(OFFICIAL, overrides);
  assert.deepEqual(overrides, { 20: 'الف' });
  assert.deepEqual(OFFICIAL, { 3: 'عید سعید فطر', 12: 'رحلت امام خمینی' });
});

// ============================================================================
// isEffectiveHoliday / isWorkingDayOverride
// ============================================================================

test('isEffectiveHoliday: تعطیل رسمی بدون override تعطیل است', () => {
  assert.equal(isEffectiveHoliday(OFFICIAL, {}, 3), true);
  assert.equal(isEffectiveHoliday(OFFICIAL, {}, 4), false);
});

test('isEffectiveHoliday: override نگهبان اولویت دارد', () => {
  assert.equal(isEffectiveHoliday(OFFICIAL, { 3: WORKING_DAY_OVERRIDE }, 3), false);
  assert.equal(isEffectiveHoliday(OFFICIAL, { 4: 'تعطیل انتخابی' }, 4), true);
});

test('isWorkingDayOverride: فقط مقدار نگهبان را تشخیص می‌دهد', () => {
  assert.equal(isWorkingDayOverride(WORKING_DAY_OVERRIDE), true);
  assert.equal(isWorkingDayOverride('تعطیل'), false);
  assert.equal(isWorkingDayOverride(undefined), false);
});

// ============================================================================
// set / clear / toggle
// ============================================================================

test('setHolidayOverride: تعطیل کردن روز کاری با عنوان دلخواه', () => {
  const next = setHolidayOverride(OFFICIAL, {}, 18, 'مناسبت مذهبی');
  assert.equal(next[18], 'مناسبت مذهبی');
  assert.equal(isEffectiveHoliday(OFFICIAL, next, 18), true);
});

test('setHolidayOverride: بدون عنوان، عنوان پیش‌فرض ثبت می‌شود', () => {
  const next = setHolidayOverride(OFFICIAL, {}, 18);
  assert.equal(next[18], DEFAULT_CUSTOM_HOLIDAY_TITLE);
});

test('setHolidayOverride: بازگشت به عنوان رسمی، override اضافی نگه نمی‌دارد', () => {
  const withOverride = { 3: WORKING_DAY_OVERRIDE };
  const next = setHolidayOverride(OFFICIAL, withOverride, 3);
  assert.equal(next[3], undefined);
  assert.equal(isEffectiveHoliday(OFFICIAL, next, 3), true);
});

test('clearHolidayOverride: کاری کردن تعطیل رسمی نگهبان ثبت می‌کند', () => {
  const next = clearHolidayOverride(OFFICIAL, {}, 3);
  assert.equal(next[3], WORKING_DAY_OVERRIDE);
});

test('clearHolidayOverride: کاری کردن تعطیل انتخابی، رکورد را حذف می‌کند', () => {
  const next = clearHolidayOverride(OFFICIAL, { 18: 'انتخابی' }, 18);
  assert.equal(18 in next, false);
});

test('toggleHolidayOverride: رفت و برگشت وضعیت روز رسمی پایدار است', () => {
  const off = toggleHolidayOverride(OFFICIAL, {}, 3);
  assert.equal(isEffectiveHoliday(OFFICIAL, off, 3), false);
  const on = toggleHolidayOverride(OFFICIAL, off, 3);
  assert.equal(isEffectiveHoliday(OFFICIAL, on, 3), true);
  assert.deepEqual(mergeHolidayOverrides(OFFICIAL, on), mergeHolidayOverrides(OFFICIAL, {}));
});

test('toggleHolidayOverride: رفت و برگشت وضعیت روز عادی پایدار است', () => {
  const on = toggleHolidayOverride(OFFICIAL, {}, 22, 'تعطیل تست');
  assert.equal(isEffectiveHoliday(OFFICIAL, on, 22), true);
  const off = toggleHolidayOverride(OFFICIAL, on, 22);
  assert.equal(isEffectiveHoliday(OFFICIAL, off, 22), false);
  assert.deepEqual(off, {});
});

// ============================================================================
// Title & source helpers
// ============================================================================

test('holidayOverrideTitle: عنوان دست‌نویس بر عنوان رسمی اولویت دارد', () => {
  assert.equal(holidayOverrideTitle(OFFICIAL, {}, 3), 'عید سعید فطر');
  assert.equal(holidayOverrideTitle(OFFICIAL, { 3: 'عنوان بخش' }, 3), 'عنوان بخش');
  assert.equal(holidayOverrideTitle(OFFICIAL, { 3: WORKING_DAY_OVERRIDE }, 3), '');
  assert.equal(holidayOverrideTitle(OFFICIAL, {}, 25), '');
});

test('holidaySource: منشأ تعطیلی درست تشخیص داده می‌شود', () => {
  assert.equal(holidaySource(OFFICIAL, {}, 3), 'official');
  assert.equal(holidaySource(OFFICIAL, {}, 25), 'none');
  assert.equal(holidaySource(OFFICIAL, { 25: 'انتخابی' }, 25), 'custom');
  assert.equal(holidaySource(OFFICIAL, { 3: 'عنوان جدید' }, 3), 'official');
  assert.equal(holidaySource(OFFICIAL, { 3: WORKING_DAY_OVERRIDE }, 3), 'none');
});

// ============================================================================
// Persistence round-trip: بقای تغییرات پس از همگام‌سازی مجدد تقویم رسمی
// ============================================================================

test('تغییرات سرپرستار پس از دریافت دوباره تقویم رسمی از بین نمی‌روند', () => {
  // سرپرستار روز ۳ (رسمی) را کاری و روز ۲۰ را تعطیل می‌کند.
  let overrides: HolidayMap = {};
  overrides = toggleHolidayOverride(OFFICIAL, overrides, 3);
  overrides = toggleHolidayOverride(OFFICIAL, overrides, 20, 'مناسبت بخش');

  // شبیه‌سازی رفت و برگشت ذخیره‌سازی (فقط رشته، مطابق HolidaysSchema).
  const persisted = JSON.parse(JSON.stringify(overrides)) as HolidayMap;

  // تقویم رسمی دوباره از منبع کشور دریافت می‌شود (همان مقادیر).
  const merged = mergeHolidayOverrides(OFFICIAL, persisted);
  assert.equal(merged[3], undefined, 'روز کاری‌شده نباید دوباره تعطیل شود');
  assert.equal(merged[20], 'مناسبت بخش', 'تعطیل انتخابی باید باقی بماند');
  assert.equal(merged[12], 'رحلت امام خمینی', 'تعطیلات رسمی دست‌نخورده باقی می‌مانند');
});

test('افزوده‌شدن تعطیل رسمی جدید توسط منبع کشور، تغییرات بخش را خراب نمی‌کند', () => {
  const overrides: HolidayMap = { 20: 'مناسبت بخش' };
  const updatedOfficial: HolidayMap = { ...OFFICIAL, 28: 'تعطیل رسمی جدید' };
  const merged = mergeHolidayOverrides(updatedOfficial, overrides);
  assert.equal(merged[28], 'تعطیل رسمی جدید');
  assert.equal(merged[20], 'مناسبت بخش');
});

// ============================================================================
// diffHolidayOverrides — معکوس‌پذیری لایه‌ی تغییرات
// ============================================================================

test('diffHolidayOverrides: نقشه‌ی برابر با تقویم رسمی هیچ تغییری تولید نمی‌کند', () => {
  assert.deepEqual(diffHolidayOverrides(OFFICIAL, { ...OFFICIAL }), {});
});

test('diffHolidayOverrides: روز حذف‌شده به نگهبان روز کاری تبدیل می‌شود', () => {
  const effective: HolidayMap = { 12: 'رحلت امام خمینی' };
  assert.deepEqual(diffHolidayOverrides(OFFICIAL, effective), { 3: WORKING_DAY_OVERRIDE });
});

test('diffHolidayOverrides: روز افزوده‌شده و عنوان بازنویسی‌شده ثبت می‌شوند', () => {
  const effective: HolidayMap = { 3: 'عنوان بخش', 12: 'رحلت امام خمینی', 20: 'مناسبت بخش' };
  assert.deepEqual(diffHolidayOverrides(OFFICIAL, effective), { 3: 'عنوان بخش', 20: 'مناسبت بخش' });
});

test('diffHolidayOverrides: رفت و برگشت با mergeHolidayOverrides دقیقاً معکوس هم هستند', () => {
  const cases: HolidayMap[] = [
    {},
    { 3: 'عید سعید فطر', 12: 'رحلت امام خمینی' },
    { 12: 'رحلت امام خمینی' },
    { 3: 'عنوان جایگزین', 20: 'مناسبت بخش' },
    { 1: 'الف', 2: 'ب', 30: 'ج' },
  ];
  for (const effective of cases) {
    const overrides = diffHolidayOverrides(OFFICIAL, effective);
    assert.deepEqual(mergeHolidayOverrides(OFFICIAL, overrides), effective);
  }
});
