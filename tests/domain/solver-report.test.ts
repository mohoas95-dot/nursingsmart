import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSolverRunEvents, formatDuration } from '../../domain/logging/solver-report';

const THREE_SCENARIOS = [
  { scenarioKey: 'A', shortTitle: 'درخواست‌محور', totalScore: 88.4, relevantWarningCount: 0, relevantHardWarningCount: 0 },
  { scenarioKey: 'B', shortTitle: 'عدالت‌محور', totalScore: 85.1, relevantWarningCount: 0, relevantHardWarningCount: 0 },
  { scenarioKey: 'C', shortTitle: 'تلفیقی', totalScore: 86.9, relevantWarningCount: 0, relevantHardWarningCount: 0 },
];

// ============================================================================
// خواستهٔ اصلی کاربر: «وقتی solver پردازش کرده و ۳ برنامه تولید کرده،
// گزارشش را در لاگ‌ها و اتفاقات بنویسد»
// ============================================================================

test('تولید موفق ۳ برنامه، یک رویداد موفق با تعداد برنامه‌ها ثبت می‌کند', () => {
  const events = buildSolverRunEvents({
    jobGroup: 'nurse',
    year: 1403,
    month: 5,
    monthLabel: 'مرداد ۱۴۰۳',
    scenarios: THREE_SCENARIOS,
    durationMs: 7_400,
    targetPersonnelCount: 12,
  });

  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.category, 'solver');
  assert.equal(event.severity, 'success');
  assert.match(event.title, /۳/, 'تعداد برنامه‌های تولیدشده باید در عنوان بیاید');
  assert.match(event.title, /پرستاران/);
  assert.match(event.detail || '', /مرداد ۱۴۰۳/);
  assert.match(event.detail || '', /زمان پردازش/);
});

test('گزارش شامل امتیاز، وضعیت هشدارها و شناسه هر سناریو است', () => {
  const [event] = buildSolverRunEvents({
    jobGroup: 'assistant',
    year: 1403,
    month: 5,
    scenarios: THREE_SCENARIOS,
    durationMs: 5_000,
  });

  const detail = event.detail || '';
  assert.match(detail, /سناریو A/);
  assert.match(detail, /سناریو B/);
  assert.match(detail, /سناریو C/);
  assert.match(detail, /بهترین امتیاز/);
  assert.match(detail, /بدون هشدار/);
  assert.match(event.title, /کمک‌بهیاران/);
});

test('تولید کمتر از ۳ برنامه، شدت هشدار می‌گیرد', () => {
  const events = buildSolverRunEvents({
    jobGroup: 'nurse',
    year: 1403,
    month: 5,
    scenarios: THREE_SCENARIOS.slice(0, 2),
    durationMs: 3_000,
  });
  assert.equal(events[0].severity, 'warning');
  assert.match(events[0].title, /۲/);
});

test('تولید نشدن هیچ برنامه‌ای، رویداد خطا ثبت می‌کند', () => {
  const events = buildSolverRunEvents({
    jobGroup: 'nurse',
    year: 1403,
    month: 5,
    scenarios: [],
    durationMs: 2_000,
  });
  assert.equal(events[0].severity, 'error');
  assert.match(events[0].title, /هیچ برنامه‌ای تولید نکرد/);
});

test('وجود هشدار سخت، شدت را به هشدار تغییر می‌دهد', () => {
  const events = buildSolverRunEvents({
    jobGroup: 'nurse',
    year: 1403,
    month: 5,
    scenarios: [
      ...THREE_SCENARIOS.slice(0, 2),
      { scenarioKey: 'C', shortTitle: 'تلفیقی', totalScore: 70, relevantWarningCount: 4, relevantHardWarningCount: 2 },
    ],
    durationMs: 6_000,
  });
  assert.equal(events[0].severity, 'warning');
  assert.match(events[0].detail || '', /سخت/);
});

test('پیام‌های تشخیصی موتور در یک رویداد جداگانه ثبت می‌شوند', () => {
  const events = buildSolverRunEvents({
    jobGroup: 'nurse',
    year: 1403,
    month: 5,
    scenarios: THREE_SCENARIOS.slice(0, 2),
    generationLog: ['سناریوی C به بازه اختلاف نرسید.', 'فقط ۲ سناریو معتبر تولید شد.'],
    durationMs: 4_000,
  });

  assert.equal(events.length, 2);
  assert.match(events[1].title, /جزئیات تشخیصی/);
  assert.match(events[1].detail || '', /بازه اختلاف/);
  assert.equal(events[1].severity, 'warning');
});

test('پیام تشخیصی خالی، رویداد اضافه نمی‌سازد', () => {
  const events = buildSolverRunEvents({
    jobGroup: 'nurse',
    year: 1403,
    month: 5,
    scenarios: THREE_SCENARIOS,
    generationLog: ['', '   '],
    durationMs: 4_000,
  });
  assert.equal(events.length, 1);
});

test('تعداد پرسنل هدف و ردیف‌های قفل‌شده در گزارش می‌آید', () => {
  const [event] = buildSolverRunEvents({
    jobGroup: 'nurse',
    year: 1403,
    month: 5,
    scenarios: THREE_SCENARIOS,
    durationMs: 4_000,
    targetPersonnelCount: 14,
    lockedRowCount: 3,
  });
  assert.match(event.detail || '', /پرسنل هدف/);
  assert.match(event.detail || '', /قفل‌شده/);
});

test('ثبت‌کننده گزارش حفظ می‌شود', () => {
  const [event] = buildSolverRunEvents({
    jobGroup: 'nurse',
    year: 1403,
    month: 5,
    scenarios: THREE_SCENARIOS,
    actor: 'زهرا احمدی (سرپرستار بخش)',
  });
  assert.equal(event.actor, 'زهرا احمدی (سرپرستار بخش)');
});

test('هر رویداد گزارش، زمان معتبر ISO دارد', () => {
  const [event] = buildSolverRunEvents({
    jobGroup: 'nurse',
    year: 1403,
    month: 5,
    scenarios: THREE_SCENARIOS,
  });
  assert.ok(!Number.isNaN(Date.parse(event.at)));
});

// ============================================================================
// قالب‌بندی مدت
// ============================================================================

test('مدت کمتر از یک ثانیه با میلی‌ثانیه گزارش می‌شود', () => {
  assert.match(formatDuration(450) || '', /میلی‌ثانیه/);
});

test('مدت چند ثانیه‌ای با ثانیه گزارش می‌شود', () => {
  assert.match(formatDuration(7_400) || '', /ثانیه/);
});

test('مدت بیش از یک دقیقه با دقیقه و ثانیه گزارش می‌شود', () => {
  const formatted = formatDuration(95_000) || '';
  assert.match(formatted, /دقیقه/);
  assert.match(formatted, /ثانیه/);
});

test('مدت نامعتبر، مقدار null می‌دهد', () => {
  assert.equal(formatDuration(undefined), null);
  assert.equal(formatDuration(Number.NaN), null);
  assert.equal(formatDuration(-1), null);
});
