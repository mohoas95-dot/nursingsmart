import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_SYSTEM_EVENT_LOGS,
  appendSystemEventLogs,
  createSystemEventLog,
  formatSystemEventTime,
  migrateLegacyChangeLogs,
  normalizeSystemEventLogs,
  orderEventLogsForDisplay,
  summarizeEventLogs,
  type SystemEventLog,
} from '../../domain/logging/system-events';

function eventAt(minutesFromEpoch: number, overrides: Partial<SystemEventLog> = {}): SystemEventLog {
  return createSystemEventLog({
    category: 'schedule',
    severity: 'info',
    title: `رویداد ${minutesFromEpoch}`,
    at: new Date(minutesFromEpoch * 60_000).toISOString(),
    ...overrides,
  });
}

// ============================================================================
// سقف نگهداری — قلب خواستهٔ کاربر: فقط ۳۰ رویداد اخیر بماند
// ============================================================================

test('سقف پیش‌فرض دقیقاً ۳۰ رویداد است', () => {
  assert.equal(MAX_SYSTEM_EVENT_LOGS, 30);
});

test('با عبور از ۳۰ رویداد، قدیمی‌ترها حذف و فقط ۳۰ رویداد آخر می‌ماند', () => {
  const incoming = Array.from({ length: 45 }, (_, index) => eventAt(index + 1));
  const kept = appendSystemEventLogs([], incoming);

  assert.equal(kept.length, MAX_SYSTEM_EVENT_LOGS);
  // رویداد شماره ۱ تا ۱۵ باید حذف شده باشند.
  assert.equal(kept[0].title, 'رویداد 16');
  assert.equal(kept[kept.length - 1].title, 'رویداد 45');
});

test('افزودن پیاپی رویدادها هرگز از سقف عبور نمی‌کند', () => {
  let logs: SystemEventLog[] = [];
  for (let index = 1; index <= 100; index += 1) {
    logs = appendSystemEventLogs(logs, [eventAt(index)]);
    assert.ok(logs.length <= MAX_SYSTEM_EVENT_LOGS, 'فهرست هرگز نباید از سقف عبور کند');
  }
  assert.equal(logs.length, MAX_SYSTEM_EVENT_LOGS);
  assert.equal(logs[logs.length - 1].title, 'رویداد 100');
});

test('سقف سفارشی هم رعایت می‌شود', () => {
  const incoming = Array.from({ length: 12 }, (_, index) => eventAt(index + 1));
  const kept = appendSystemEventLogs([], incoming, 5);
  assert.equal(kept.length, 5);
  assert.equal(kept[0].title, 'رویداد 8');
});

test('رویدادها همیشه بر اساس زمان مرتب می‌شوند حتی اگر بی‌ترتیب برسند', () => {
  const kept = appendSystemEventLogs([], [eventAt(30), eventAt(10), eventAt(20)]);
  assert.deepEqual(kept.map(event => event.title), ['رویداد 10', 'رویداد 20', 'رویداد 30']);
});

// ============================================================================
// جلوگیری از نویز و تکرار
// ============================================================================

test('رویداد کاملاً یکسان در بازه کوتاه فقط یک‌بار ثبت می‌شود', () => {
  const first = createSystemEventLog({
    category: 'solver',
    severity: 'success',
    title: 'موتور هوشمند ۳ برنامه تولید کرد',
    at: new Date(1_000_000).toISOString(),
  });
  const duplicate = createSystemEventLog({
    category: 'solver',
    severity: 'success',
    title: 'موتور هوشمند ۳ برنامه تولید کرد',
    at: new Date(1_000_500).toISOString(),
  });

  const kept = appendSystemEventLogs([first], [duplicate]);
  assert.equal(kept.length, 1);
});

test('رویداد یکسان با فاصله زمانی زیاد، رویداد مستقل است', () => {
  const first = createSystemEventLog({
    category: 'solver',
    severity: 'success',
    title: 'موتور هوشمند ۳ برنامه تولید کرد',
    at: new Date(1_000_000).toISOString(),
  });
  const later = createSystemEventLog({
    category: 'solver',
    severity: 'success',
    title: 'موتور هوشمند ۳ برنامه تولید کرد',
    at: new Date(1_000_000 + 60_000).toISOString(),
  });

  assert.equal(appendSystemEventLogs([first], [later]).length, 2);
});

test('رویداد با شناسه تکراری دوباره اضافه نمی‌شود', () => {
  const event = eventAt(5);
  const kept = appendSystemEventLogs([event], [event, event]);
  assert.equal(kept.length, 1);
});

// ============================================================================
// مهاجرت رکوردهای متنی قدیمی (changeLogs)
// ============================================================================

test('رکوردهای متنی قدیمی بدون از دست رفتن اطلاعات مهاجرت می‌کنند', () => {
  const migrated = migrateLegacyChangeLogs([
    'تغییر وضعیت قفل پرستاران: قفل شد در تاریخ ۱۴۰۳/۰۵/۰۱',
    'تغییر وضعیت مهلت درخواست‌ها: بسته شد در تاریخ ۱۴۰۳/۰۵/۰۲',
  ]);

  assert.equal(migrated.length, 2);
  assert.equal(migrated[0].category, 'lock');
  assert.equal(migrated[1].category, 'requests');
  // زمان دقیق قابل بازیابی نیست، پس خالی می‌ماند.
  assert.equal(migrated[0].at, '');
});

test('رکوردهای متنی تکراری در مهاجرت یکی می‌شوند', () => {
  const migrated = migrateLegacyChangeLogs(['یک رویداد', 'یک رویداد']);
  assert.equal(migrated.length, 1);
});

test('normalize رکوردهای قدیمی و جدید را با هم و زیر سقف ادغام می‌کند', () => {
  const legacy = Array.from({ length: 10 }, (_, index) => `رویداد قدیمی ${index}`);
  const structured = Array.from({ length: 25 }, (_, index) => eventAt(index + 1));

  const normalized = normalizeSystemEventLogs(structured, legacy);
  assert.equal(normalized.length, MAX_SYSTEM_EVENT_LOGS);
  // رویدادهای بدون زمان (قدیمی) قدیمی‌ترین شمرده می‌شوند و اول حذف می‌گردند.
  assert.equal(normalized[normalized.length - 1].title, 'رویداد 25');
});

test('normalize در برابر دادهٔ خراب مقاوم است', () => {
  const normalized = normalizeSystemEventLogs(
    [null, 'رشته', { title: '' }, { title: 'رویداد سالم', category: 'ناشناخته', severity: 'x' }],
    undefined
  );
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].title, 'رویداد سالم');
  // مقادیر نامعتبر به پیش‌فرض امن برمی‌گردند.
  assert.equal(normalized[0].category, 'schedule');
  assert.equal(normalized[0].severity, 'info');
});

test('normalize روی ورودی خالی، فهرست خالی می‌دهد', () => {
  assert.deepEqual(normalizeSystemEventLogs(undefined, undefined), []);
});

// ============================================================================
// نمایش
// ============================================================================

test('برای نمایش، جدیدترین رویداد اول فهرست است', () => {
  const ordered = orderEventLogsForDisplay([eventAt(10), eventAt(30), eventAt(20)]);
  assert.deepEqual(ordered.map(event => event.title), ['رویداد 30', 'رویداد 20', 'رویداد 10']);
});

test('خلاصه شمارش بر اساس شدت درست است', () => {
  const summary = summarizeEventLogs([
    eventAt(1, { severity: 'error' }),
    eventAt(2, { severity: 'warning' }),
    eventAt(3, { severity: 'warning' }),
    eventAt(4, { severity: 'success' }),
  ]);
  assert.deepEqual(summary, { info: 0, success: 1, warning: 2, error: 1 });
});

test('زمان خالی به‌عنوان رویداد بایگانی‌شده نمایش داده می‌شود', () => {
  assert.match(formatSystemEventTime(''), /بایگانی/);
});

test('زمان نامعتبر باعث خطا نمی‌شود', () => {
  assert.equal(formatSystemEventTime('not-a-date'), 'زمان نامعتبر');
});

// ============================================================================
// نرمال‌سازی ورودی
// ============================================================================

test('عنوان و جزئیات بیش از حد بلند بریده می‌شوند', () => {
  const event = createSystemEventLog({
    category: 'solver',
    title: 'الف'.repeat(1_000),
    detail: 'ب'.repeat(5_000),
  });
  assert.ok(event.title.length <= 300);
  assert.ok((event.detail || '').length <= 1_500);
});

test('هر رویداد شناسه یکتا می‌گیرد', () => {
  const ids = new Set(
    Array.from({ length: 500 }, () => createSystemEventLog({ category: 'solver', title: 'x' }).id)
  );
  assert.equal(ids.size, 500);
});
