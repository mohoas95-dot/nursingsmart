import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeShiftRequest,
  normalizeShiftRequestList,
} from '../lib/ai/shift-request-normalizer';
import {
  WEEKLY_ODD_DAY_NAMES,
  WEEKLY_EVEN_DAY_NAMES,
} from '../lib/ai/persian-vocabulary';

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
  // شبیه‌سازی خروجی مدل برای درخواست پنجشنبه‌ها
  const raw = {
    requestType: 'shift',
    preferredShift: 'ME',
    scope: 'custom_days',
    selectedDays: [4, 11, 18, 25], // تاریخ‌های فرضی پنجشنبه‌های ماه
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

test('6. ورودی مبهم یا درد دل متنی بدون درخواست مشخص → آیتم معتبری تولید نمی‌کند', () => {
  const rawList = [
    { requestType: 'shift', preferredShift: '?', scope: 'none' },
  ];
  const { requests, droppedCount } = normalizeShiftRequestList(rawList, 31);
  assert.equal(requests.length, 0);
  assert.equal(droppedCount, 1);
});

test('7. ارقام فارسی در selectedDays به لاتین تبدیل می‌شوند و فیلتر می‌شوند', () => {
  const raw = {
    requestType: 'OFF',
    scope: 'custom_days',
    selectedDays: ['۵', '۱۲', 20],
  };
  const normalized = normalizeShiftRequest(raw, 31);
  assert.ok(normalized);
  assert.deepEqual(normalized.selectedDays, [5, 12, 20]);
});
