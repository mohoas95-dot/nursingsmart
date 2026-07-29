import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_STORED_EVENT_LOGS, MonthlyScheduleSchema } from '../lib/storageSchemas';
import {
  MAX_SYSTEM_EVENT_LOGS,
  appendSystemEventLogs,
  createSystemEventLog,
  normalizeSystemEventLogs,
} from '../domain/logging/system-events';

function baseSchedule(extra: Record<string, unknown> = {}) {
  return {
    year: 1403,
    month: 5,
    assignments: {},
    shiftLeaders: {},
    warnings: [],
    ...extra,
  };
}

function makeEvents(count: number) {
  return Array.from({ length: count }, (_, index) => createSystemEventLog({
    category: 'solver',
    severity: 'info',
    title: `رویداد ${index}`,
    at: new Date(1_000_000 + index * 60_000).toISOString(),
  }));
}

test('سقف ذخیره‌سازی و سقف دامنه یکی هستند', () => {
  assert.equal(MAX_STORED_EVENT_LOGS, MAX_SYSTEM_EVENT_LOGS);
});

test('برنامه ماهانه با ۳۰ رویداد معتبر است', () => {
  const parsed = MonthlyScheduleSchema.safeParse(baseSchedule({ eventLogs: makeEvents(30) }));
  assert.equal(parsed.success, true);
});

test('ذخیره‌سازی بیش از ۳۰ رویداد در سطح schema رد می‌شود', () => {
  // این محافظ سمت سرور تضمین می‌کند حتی کلاینت دستکاری‌شده هم نتواند
  // سند ماهانه را با لاگ بی‌پایان پر کند.
  const parsed = MonthlyScheduleSchema.safeParse(baseSchedule({ eventLogs: makeEvents(31) }));
  assert.equal(parsed.success, false);
});

test('خروجی appendSystemEventLogs همیشه از فیلتر schema رد می‌شود', () => {
  const trimmed = appendSystemEventLogs([], makeEvents(120));
  const parsed = MonthlyScheduleSchema.safeParse(baseSchedule({ eventLogs: trimmed }));
  assert.equal(parsed.success, true, 'دامنه باید همیشه خروجی سازگار با ذخیره‌سازی بدهد');
});

test('برنامه بدون eventLogs همچنان معتبر است (سازگاری با داده قدیمی)', () => {
  const parsed = MonthlyScheduleSchema.safeParse(baseSchedule());
  assert.equal(parsed.success, true);
});

test('برنامه قدیمی با changeLogs متنی هنوز خوانده می‌شود و مهاجرت آن معتبر است', () => {
  const legacyChangeLogs = ['قفل شد', 'مهلت بسته شد'];
  const parsed = MonthlyScheduleSchema.safeParse(baseSchedule({ changeLogs: legacyChangeLogs }));
  assert.equal(parsed.success, true);

  const migrated = normalizeSystemEventLogs(undefined, legacyChangeLogs);
  const reparsed = MonthlyScheduleSchema.safeParse(baseSchedule({ eventLogs: migrated }));
  assert.equal(reparsed.success, true);
});

test('رویداد با شدت یا دسته نامعتبر در ذخیره‌سازی پذیرفته نمی‌شود', () => {
  const invalid = MonthlyScheduleSchema.safeParse(baseSchedule({
    eventLogs: [{ id: 'x', at: '', category: 'unknown', severity: 'info', title: 'x' }],
  }));
  assert.equal(invalid.success, false);
});

test('عنوان خالی در ذخیره‌سازی پذیرفته نمی‌شود', () => {
  const invalid = MonthlyScheduleSchema.safeParse(baseSchedule({
    eventLogs: [{ id: 'x', at: '', category: 'solver', severity: 'info', title: '' }],
  }));
  assert.equal(invalid.success, false);
});
