import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeShiftRequest,
  normalizeShiftRequestList,
} from '../lib/ai/shift-request-normalizer';

// ============================================================================
// تست‌های واحد و یکپارچه‌سازی برای پردازش درخواست‌های چت و نرمال‌ساز (Section 4)
// ============================================================================

test('1. نرمال‌ساز درخواست‌های ناقص/نامعتبر را فیلتر می‌کند و شمارش droppedCount را برمی‌گرداند', () => {
  const rawList = [
    { requestType: 'shift', preferredShift: 'M', scope: 'odd' }, // معتبر
    { requestType: 'shift', preferredShift: 'UNKNOWN', scope: 'odd' }, // شیفت نامعتبر → حذف
    { requestType: 'OFF', scope: 'custom_days', selectedDays: [] }, // custom_days بدون روز → حذف
    { requestType: 'invalid_type', preferredShift: 'E', scope: 'all' }, // نوع درخواست نامعتبر → حذف
  ];

  const { requests, droppedCount } = normalizeShiftRequestList(rawList, 31);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].requestType, 'shift');
  assert.equal(requests[0].preferredShift, 'M');
  assert.equal(droppedCount, 3);
});

test('2. درخواست‌های کاملاً نامعتبر یا خالی منجر به لیست خالی می‌شوند', () => {
  const rawList = [
    { requestType: 'shift', preferredShift: '?', scope: 'all' },
    { requestType: 'OFF', scope: 'custom_days', selectedDays: [99] }, // خارج از محدوده ماه
  ];
  const { requests, droppedCount } = normalizeShiftRequestList(rawList, 31);
  assert.equal(requests.length, 0);
  assert.equal(droppedCount, 2);
});

test('3. «پنجشنبه‌ها لانگ می‌خوام» → باید به عنوان custom_days با تاریخ‌های استخراج‌شده از calendarDays استخراج شود', () => {
  const raw = {
    requestType: 'shift',
    preferredShift: 'ME',
    scope: 'custom_days',
    selectedDays: [4, 11, 18, 25],
    description: 'پنجشنبه‌ها لانگ می‌خواهم',
  };

  const normalized = normalizeShiftRequest(raw, 31);
  assert.ok(normalized);
  assert.equal(normalized.scope, 'custom_days');
  assert.deepEqual(normalized.selectedDays, [4, 11, 18, 25]);
  assert.equal(normalized.preferredShift, 'ME');
});

test('4. «روزهای فرد هفته شب نباشم» → weekly_odd و avoid_shift', () => {
  const raw = {
    requestType: 'avoid_shift',
    preferredShift: 'N',
    scope: 'weekly_odd',
    description: 'روزهای فرد هفته شب نباشم',
  };

  const normalized = normalizeShiftRequest(raw, 31);
  assert.ok(normalized);
  assert.equal(normalized.requestType, 'avoid_shift');
  assert.equal(normalized.preferredShift, 'N');
  assert.equal(normalized.scope, 'weekly_odd');
});

test('5. «تاریخ‌های فرد ماه آف» → odd و OFF', () => {
  const raw = {
    requestType: 'OFF',
    preferredShift: 'OFF',
    scope: 'odd',
    offHardness: 'hard',
    description: 'تاریخ‌های فرد ماه آف',
  };

  const normalized = normalizeShiftRequest(raw, 31);
  assert.ok(normalized);
  assert.equal(normalized.requestType, 'OFF');
  assert.equal(normalized.preferredShift, 'OFF');
  assert.equal(normalized.scope, 'odd');
  assert.equal(normalized.offHardness, 'hard');
});

test('6. «یک ۲۴ روز تعطیل» به عنوان شیفت کاری MEN ثبت می‌شود، نه مرخصی یا آف سراسری', () => {
  const raw = {
    requestType: 'shift',
    preferredShift: 'MEN',
    scope: 'custom_days',
    selectedDays: [7], // روز تعطیل فرضی
    description: 'یک ۲۴ روز تعطیل',
  };

  const normalized = normalizeShiftRequest(raw, 31);
  assert.ok(normalized);
  assert.equal(normalized.requestType, 'shift');
  assert.equal(normalized.preferredShift, 'MEN');
  assert.notEqual(normalized.requestType, 'leave');
  assert.notEqual(normalized.requestType, 'OFF');
  assert.deepEqual(normalized.selectedDays, [7]);
});

test('7. «شیفت‌های صبح به جز تعطیلات» به عنوان شیفت M روی روزهای کاری استخراج می‌شود', () => {
  const raw = {
    requestType: 'shift',
    preferredShift: 'M',
    scope: 'custom_days',
    selectedDays: [1, 2, 3, 4, 5, 8, 9, 10, 11, 12], // روزهای غیرتعطیل فرضی
    description: 'شیفت‌های صبح به جز تعطیلات',
  };

  const normalized = normalizeShiftRequest(raw, 31);
  assert.ok(normalized);
  assert.equal(normalized.requestType, 'shift');
  assert.equal(normalized.preferredShift, 'M');
  assert.equal(normalized.scope, 'custom_days');
  assert.ok(normalized.selectedDays && normalized.selectedDays.length > 0);
});

test('8. ارقام فارسی در selectedDays به لاتین تبدیل می‌شوند و فیلتر می‌شوند', () => {
  const raw = {
    requestType: 'OFF',
    scope: 'custom_days',
    selectedDays: ['۵', '۱۲', 20],
  };
  const normalized = normalizeShiftRequest(raw, 31);
  assert.ok(normalized);
  assert.deepEqual(normalized.selectedDays, [5, 12, 20]);
});
