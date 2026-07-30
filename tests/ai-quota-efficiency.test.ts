import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiKeyPool, classifyFailure, parseRetryAfterMs } from '../lib/ai/key-pool';
import { buildQuotaMessage } from '../lib/ai/errors';
import {
  buildCompactContext,
  encodeCalendar,
  encodeExistingRequests,
  encodeScheduleHistory,
} from '../lib/ai/compact-context';

/**
 * این فایل رگرسیون‌های «سوختن زودهنگام سهمیه» را قفل می‌کند.
 *
 * پیشینه: کاربر با تعداد کمی پیام، خطای «سهمیهٔ هر سه کلید تمام شد» می‌گرفت.
 * علت واقعی سه اشکال در کد خودمان بود، نه اتمام سهمیه:
 *   ۱. قرنطینهٔ ۱۰ دقیقه‌ای برای محدودیتی که فقط چند ثانیه طول می‌کشید
 *   ۲. تکرار درخواست در کلاینت که یک پیام را به ۲۷ فراخوانی API تبدیل می‌کرد
 *   ۳. زمینهٔ JSON خام + رزرو ۴۰۹۶ توکن خروجی که سقف دقیقه‌ای را می‌ترکاند
 */

const ENV_NAMES = ['TEST_Q_KEY', 'TEST_Q_KEY_2', 'TEST_Q_KEY_3'];

function poolWith(...keys: string[]) {
  ENV_NAMES.forEach((name, index) => {
    if (keys[index]) process.env[name] = keys[index];
    else delete process.env[name];
  });
  return new ApiKeyPool({ provider: 'test', envNames: ENV_NAMES });
}

function cleanup() {
  ENV_NAMES.forEach(name => delete process.env[name]);
}

// ============================================================================
// اشکال ۱ — قرنطینه باید به retry-after احترام بگذارد
// ============================================================================

test('وقتی سرویس می‌گوید ۷ ثانیه، کلید ۷ ثانیه کنار می‌رود نه ۱۰ دقیقه', () => {
  const pool = poolWith('k1', 'k2', 'k3');
  try {
    pool.reportFailure('k1', 'quota', 7_000);
    const state = pool.snapshot().find(item => item.label.includes('#1'));
    assert.ok(state);
    assert.ok(
      state.cooldownSeconds <= 10,
      `انتظار ~۷ ثانیه بود ولی ${state.cooldownSeconds} ثانیه شد — همان باگ قدیمی برگشته است.`,
    );
  } finally {
    cleanup();
  }
});

test('بدون retry-after، قرنطینهٔ پیش‌فرض سهمیه کوتاه است (حداکثر یک دقیقه)', () => {
  const pool = poolWith('k1');
  try {
    pool.reportFailure('k1', 'quota');
    const state = pool.snapshot()[0];
    assert.ok(
      state.cooldownSeconds <= 60,
      `قرنطینهٔ پیش‌فرض سهمیه نباید بیش از ۶۰ ثانیه باشد؛ الان ${state.cooldownSeconds} ثانیه است.`,
    );
  } finally {
    cleanup();
  }
});

test('سقف روزانه (daily_quota) قرنطینهٔ به‌مراتب بلندتری می‌گیرد', () => {
  const pool = poolWith('k1');
  try {
    pool.reportFailure('k1', 'daily_quota');
    assert.ok(pool.snapshot()[0].cooldownSeconds > 300);
  } finally {
    cleanup();
  }
});

test('پیشنهاد غیرمنطقیِ بزرگ سرویس به سقف محدود می‌شود', () => {
  const pool = poolWith('k1');
  try {
    pool.reportFailure('k1', 'quota', 60 * 60_000); // یک ساعت
    assert.ok(
      pool.snapshot()[0].cooldownSeconds <= 5 * 60,
      'قرنطینهٔ سهمیهٔ دقیقه‌ای هرگز نباید از ۵ دقیقه بیشتر شود.',
    );
  } finally {
    cleanup();
  }
});

// ============================================================================
// تفکیک محدودیت دقیقه‌ای از محدودیت روزانه
// ============================================================================

test('پیام «per day» به عنوان سهمیهٔ روزانه شناخته می‌شود', () => {
  assert.equal(
    classifyFailure(429, 'Rate limit reached: 1000 requests per day'),
    'daily_quota',
  );
  assert.equal(classifyFailure(429, 'You exceeded your TPD limit'), 'daily_quota');
});

test('محدودیت دقیقه‌ای همچنان quota عادی می‌ماند (قرنطینهٔ کوتاه)', () => {
  assert.equal(classifyFailure(429, 'Rate limit reached for tokens per minute'), 'quota');
  assert.equal(classifyFailure(429, 'Too Many Requests'), 'quota');
});

// ============================================================================
// خواندن retry-after در قالب‌های واقعی هر دو سرویس
// ============================================================================

test('هدر کسری Groq («7.66s») درست خوانده می‌شود', () => {
  assert.equal(parseRetryAfterMs('7.66s'), 7_660);
});

test('متن «Please try again in 2.5s» درست خوانده می‌شود', () => {
  assert.equal(parseRetryAfterMs(null, 'Please try again in 2.5s'), 2_500);
});

test('قالب retryDelay گوگل («retryDelay":"13s"») درست خوانده می‌شود', () => {
  assert.equal(parseRetryAfterMs(null, '{"retryDelay":"13s"}'), 13_000);
});

test('واحد دقیقه با میلی‌ثانیه اشتباه گرفته نمی‌شود', () => {
  assert.equal(parseRetryAfterMs(null, 'try again in 2 minutes'), 120_000);
  assert.equal(parseRetryAfterMs(null, 'try again in 500ms'), 500);
});

// ============================================================================
// اشکال ۳ — فشرده‌سازی زمینه
// ============================================================================

const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];
const sampleCalendar = Array.from({ length: 31 }, (_, index) => ({
  day: index + 1,
  dayOfWeek: index % 7,
  weekdayName: WEEKDAYS[index % 7],
  isHoliday: index % 7 === 6,
}));

test('تقویم فشرده دست‌کم ۸۰٪ کوچک‌تر از JSON خام است', () => {
  const raw = JSON.stringify(sampleCalendar);
  const compact = encodeCalendar(sampleCalendar);
  const reduction = 1 - compact.length / raw.length;
  assert.ok(reduction >= 0.8, `کاهش فقط ${Math.round(reduction * 100)}٪ بود`);
});

test('تقویم فشرده همهٔ روزها و تعطیلات را حفظ می‌کند', () => {
  const compact = encodeCalendar(sampleCalendar);
  const tokens = compact.split(' ');
  assert.equal(tokens.length, 31, 'هر ۳۱ روز باید حاضر باشد');
  assert.equal(tokens[0], '1ش');
  assert.equal(tokens[6], '7ج*', 'جمعه باید با * علامت تعطیل بخورد');
  // تعداد تعطیلات باید با ورودی بخواند
  const holidays = sampleCalendar.filter(day => day.isHoliday).length;
  assert.equal(compact.split('*').length - 1, holidays);
});

test('درخواست‌های قبلی فشرده می‌شوند و نشان ضروری بودن حفظ می‌شود', () => {
  const encoded = encodeExistingRequests([
    { requestType: 'OFF', preferredShift: 'OFF', scope: 'custom_days', selectedDays: [10, 12] },
    { requestType: 'shift', preferredShift: 'ME', scope: 'weekly_odd', isEssential: true },
  ]);
  assert.ok(encoded.includes('OFF:OFF@custom_days[10,12]'), encoded);
  assert.ok(encoded.includes('shift:ME@weekly_odd!'), encoded);
});

test('تاریخچهٔ برنامه به شمارش خلاصه می‌شود، نه فهرست کامل روزها', () => {
  const history = [{
    monthKey: '1405_4',
    assignments: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i + 1), i % 2 ? 'M' : 'OFF'])),
  }];
  const encoded = encodeScheduleHistory(history);
  assert.ok(encoded.includes('1405_4'));
  assert.ok(/M×\d+/.test(encoded), encoded);
  assert.ok(encoded.length < JSON.stringify(history).length / 4, 'باید دست‌کم ۴ برابر کوچک‌تر باشد');
});

test('تاریخچه حداکثر ۳ ماه اخیر را می‌فرستد', () => {
  const history = Array.from({ length: 8 }, (_, m) => ({
    monthKey: `1405_${m + 1}`,
    assignments: { '1': 'M' },
  }));
  const encoded = encodeScheduleHistory(history);
  assert.equal(encoded.split('|').length, 3);
  assert.ok(encoded.includes('1405_8'), 'باید جدیدترین ماه‌ها را نگه دارد');
  assert.ok(!encoded.includes('1405_1'), 'ماه‌های خیلی قدیمی باید حذف شوند');
});

test('کل زمینهٔ فشرده برای یک ماه واقعی زیر ۸۰۰ کاراکتر می‌ماند', () => {
  const context = buildCompactContext({
    year: 1405,
    month: 5,
    totalDays: 31,
    personnel: { firstName: 'مریم', lastName: 'احمدی', jobGroup: 'پرستار', workRoutine: 'در گردش' },
    calendarDays: sampleCalendar,
    existingRequests: Array.from({ length: 6 }, (_, i) => ({
      requestType: 'shift', preferredShift: 'ME', scope: 'custom_days', selectedDays: [i + 1],
    })),
    scheduleHistory: Array.from({ length: 4 }, (_, m) => ({
      monthKey: `1405_${m + 1}`,
      assignments: Object.fromEntries(Array.from({ length: 31 }, (_, d) => [String(d + 1), 'M'])),
    })),
  });
  assert.ok(context.length < 800, `زمینه ${context.length} کاراکتر شد؛ خیلی بزرگ است.`);
});

test('زمینهٔ فشرده هنگام نبود داده خراب نمی‌شود', () => {
  const context = buildCompactContext({ year: 1405, month: 5, totalDays: 31 });
  assert.ok(context.includes('1405/5'));
  assert.ok(!context.includes('undefined'));
});

// ============================================================================
// پیام خطای صادقانه به کاربر
// ============================================================================

test('وقتی انتظار کوتاه است، پیام ثانیهٔ واقعی را می‌گوید (نه «چند دقیقه»)', () => {
  const message = buildQuotaMessage('گفت‌وگوی متنی', 8_000);
  assert.ok(message.includes('۸') || message.includes('8'), message);
  assert.ok(!message.includes('دقیقه'), 'برای انتظار ۸ ثانیه‌ای نباید «دقیقه» بگوید');
});

test('وقتی انتظار طولانی است، به دقیقه گزارش می‌دهد', () => {
  assert.ok(buildQuotaMessage('گفت‌وگوی متنی', 5 * 60_000).includes('دقیقه'));
});

test('پیام سهمیه دیگر ادعا نمی‌کند «هر سه کلید تمام شده»', () => {
  for (const wait of [undefined, 5_000, 300_000]) {
    const message = buildQuotaMessage('گفت‌وگوی متنی', wait);
    assert.ok(!message.includes('هر سه کلید'), `پیام نباید کاربر را بترساند: ${message}`);
    assert.ok(!message.includes('تمام شده است؛'), message);
  }
});
