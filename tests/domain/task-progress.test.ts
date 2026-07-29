import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_RUNNING_PERCENT,
  applyLearnedEstimates,
  blendDurationEstimate,
  computeProgressPercent,
  estimateRemainingMs,
  findPhaseIndex,
  formatRemainingTime,
  resolvePhaseBounds,
  smoothPercent,
  timeBasedPhaseFraction,
  type ProgressPhase,
} from '../../domain/progress/task-progress';

const PHASES: ProgressPhase[] = [
  { id: 'a', label: 'مرحله اول', weight: 1, estimateMs: 1_000 },
  { id: 'b', label: 'مرحله دوم', weight: 2, estimateMs: 2_000 },
  { id: 'c', label: 'مرحله سوم', weight: 1, estimateMs: 1_000 },
];

// ============================================================================
// مرزهای مراحل — درصد باید با سهم واقعی هر مرحله بخواند
// ============================================================================

test('وزن‌ها به بازه ۰ تا ۱۰۰ نرمال می‌شوند', () => {
  const bounds = resolvePhaseBounds(PHASES);
  assert.equal(bounds[0].start, 0);
  assert.equal(bounds[0].end, 25);
  assert.equal(bounds[1].start, 25);
  assert.equal(bounds[1].end, 75);
  assert.equal(bounds[2].start, 75);
  assert.equal(bounds[2].end, 100);
});

test('مرحله آخر همیشه دقیقاً به ۱۰۰ می‌رسد (بدون خطای ممیز شناور)', () => {
  const bounds = resolvePhaseBounds([
    { id: 'x', label: 'x', weight: 1, estimateMs: 1 },
    { id: 'y', label: 'y', weight: 1, estimateMs: 1 },
    { id: 'z', label: 'z', weight: 1, estimateMs: 1 },
  ]);
  assert.equal(bounds[bounds.length - 1].end, 100);
});

test('مراحل بدون وزن، سهم مساوی می‌گیرند', () => {
  const bounds = resolvePhaseBounds([
    { id: 'a', label: 'a' },
    { id: 'b', label: 'b' },
  ]);
  assert.equal(bounds[0].end, 50);
});

test('فهرست خالی به یک مرحله پیش‌فرض تبدیل می‌شود', () => {
  const bounds = resolvePhaseBounds([]);
  assert.equal(bounds.length, 1);
  assert.equal(bounds[0].end, 100);
});

test('پیدا کردن مرحله بر اساس شناسه؛ شناسه ناشناس به مرحله اول برمی‌گردد', () => {
  const bounds = resolvePhaseBounds(PHASES);
  assert.equal(findPhaseIndex(bounds, 'b'), 1);
  assert.equal(findPhaseIndex(bounds, 'unknown'), 0);
  assert.equal(findPhaseIndex(bounds, null), 0);
});

// ============================================================================
// هم‌گامی درصد با مراحل واقعی
// ============================================================================

test('در آغاز هر مرحله، درصد دقیقاً روی نقطه شروع همان مرحله است', () => {
  const bounds = resolvePhaseBounds(PHASES);
  const percent = computeProgressPercent({ bounds, phaseIndex: 1, elapsedInPhaseMs: 0 });
  assert.equal(percent, 25);
});

test('درصد هرگز از سقف مرحله جاری عبور نمی‌کند', () => {
  const bounds = resolvePhaseBounds(PHASES);
  // زمان بسیار طولانی‌تر از برآورد
  const percent = computeProgressPercent({ bounds, phaseIndex: 0, elapsedInPhaseMs: 600_000 });
  assert.ok(percent < bounds[0].end, 'درصد باید زیر سقف مرحله بماند');
});

test('تا وقتی کار تمام نشده، درصد به ۱۰۰ نمی‌رسد', () => {
  const bounds = resolvePhaseBounds(PHASES);
  const percent = computeProgressPercent({
    bounds,
    phaseIndex: bounds.length - 1,
    elapsedInPhaseMs: 10_000_000,
  });
  assert.ok(percent <= MAX_RUNNING_PERCENT);
  assert.ok(percent < 100);
});

test('اعلام پایان واقعی، درصد را دقیقاً ۱۰۰ می‌کند', () => {
  const bounds = resolvePhaseBounds(PHASES);
  const percent = computeProgressPercent({
    bounds,
    phaseIndex: 0,
    elapsedInPhaseMs: 10,
    completed: true,
  });
  assert.equal(percent, 100);
});

test('گزارش پیشرفت واقعی موتور، درصد را داخل مرزهای همان مرحله می‌نشاند', () => {
  const bounds = resolvePhaseBounds(PHASES);
  const percent = computeProgressPercent({
    bounds,
    phaseIndex: 1,
    elapsedInPhaseMs: 0,
    reportedFraction: 0.5,
  });
  // مرحله دوم بین ۲۵ و ۷۵ است، پس نیمهٔ آن حدود ۵۰ می‌شود.
  assert.ok(percent >= 49 && percent <= 51, `انتظار حدود ۵۰ بود، ${percent} دریافت شد`);
});

test('درصد با گذشت زمان در همان مرحله همیشه صعودی است', () => {
  const bounds = resolvePhaseBounds(PHASES);
  let previous = -1;
  for (const elapsed of [0, 100, 250, 500, 900, 1_000, 1_500, 3_000, 8_000]) {
    const percent = computeProgressPercent({ bounds, phaseIndex: 1, elapsedInPhaseMs: elapsed });
    assert.ok(percent >= previous, `درصد نباید عقب برود (${previous} → ${percent})`);
    previous = percent;
  }
});

test('منحنی زمانی در پایان برآورد به حدود ۸۵٪ مرحله می‌رسد', () => {
  const fraction = timeBasedPhaseFraction(1_000, 1_000);
  assert.ok(fraction > 0.8 && fraction <= 0.86, `مقدار دریافتی: ${fraction}`);
});

test('منحنی زمانی هرگز به ۱ نمی‌رسد حتی با تأخیر بسیار زیاد', () => {
  assert.ok(timeBasedPhaseFraction(10_000_000, 1_000) < 1);
});

test('زمان سپری‌شده صفر یا منفی، پیشرفت صفر می‌دهد', () => {
  assert.equal(timeBasedPhaseFraction(0, 1_000), 0);
  assert.equal(timeBasedPhaseFraction(-50, 1_000), 0);
});

// ============================================================================
// تخمین زمان باقی‌مانده
// ============================================================================

test('در شروع کار، تخمین باقی‌مانده تقریباً برابر مجموع برآورد همه مراحل است', () => {
  const bounds = resolvePhaseBounds(PHASES);
  const remaining = estimateRemainingMs({ bounds, phaseIndex: 0, elapsedInPhaseMs: 0 });
  // ۱۰۰۰ + ۲۰۰۰ + ۱۰۰۰ = ۴۰۰۰
  assert.ok(remaining >= 3_500 && remaining <= 4_500, `مقدار دریافتی: ${remaining}`);
});

test('هرچه جلوتر می‌رویم، تخمین باقی‌مانده کوچک‌تر می‌شود', () => {
  const bounds = resolvePhaseBounds(PHASES);
  const early = estimateRemainingMs({ bounds, phaseIndex: 0, elapsedInPhaseMs: 100 });
  const later = estimateRemainingMs({ bounds, phaseIndex: 2, elapsedInPhaseMs: 500 });
  assert.ok(later < early);
});

test('پس از اعلام پایان، زمان باقی‌مانده صفر است', () => {
  const bounds = resolvePhaseBounds(PHASES);
  assert.equal(estimateRemainingMs({ bounds, phaseIndex: 1, elapsedInPhaseMs: 10, completed: true }), 0);
});

test('تخمین با سیگنال واقعی موتور به سرعت مشاهده‌شده نزدیک می‌شود', () => {
  const bounds = resolvePhaseBounds([{ id: 'solo', label: 'تنها', weight: 1, estimateMs: 10_000 }]);
  // ۵۰٪ کار در ۱ ثانیه انجام شده، پس تقریباً ۱ ثانیه دیگر مانده — نه ۹ ثانیه.
  const remaining = estimateRemainingMs({
    bounds,
    phaseIndex: 0,
    elapsedInPhaseMs: 1_000,
    reportedFraction: 0.5,
  });
  assert.ok(remaining < 4_000, `تخمین باید به مشاهده واقعی نزدیک باشد، ${remaining} دریافت شد`);
});

test('قالب‌بندی زمان باقی‌مانده کوتاه و خوانا است', () => {
  assert.equal(formatRemainingTime(0), 'کمتر از ۱ ثانیه');
  assert.match(formatRemainingTime(5_000), /ثانیه/);
  assert.match(formatRemainingTime(125_000), /دقیقه/);
});

test('اعداد زمان باقی‌مانده لاتین‌اند تا با عدد درصد هماهنگ بمانند', () => {
  // ارقام فارسی نباید در خروجی عددی ظاهر شوند (به‌جز واژهٔ ثابت «کمتر از ۱ ثانیه»).
  const persianDigits = /[۰-۹]/;
  assert.equal(persianDigits.test(formatRemainingTime(5_000)), false);
  assert.equal(persianDigits.test(formatRemainingTime(45_000)), false);
  assert.equal(persianDigits.test(formatRemainingTime(125_000)), false);
  assert.match(formatRemainingTime(5_000), /5/);
  assert.match(formatRemainingTime(125_000), /2:05/);
});

test('متن زمان باقی‌مانده کوتاه می‌ماند تا کارت لودینگ بزرگ نشود', () => {
  for (const ms of [0, 5_000, 45_000, 125_000, 3_600_000]) {
    assert.ok(
      formatRemainingTime(ms).length <= 22,
      `متن «${formatRemainingTime(ms)}» برای کارت فشرده بلند است`
    );
  }
});

// ============================================================================
// یادگیری مدت مراحل
// ============================================================================

test('نخستین اندازه‌گیری مستقیماً به‌عنوان تخمین ذخیره می‌شود', () => {
  assert.equal(blendDurationEstimate(undefined, 2_400), 2_400);
});

test('میانگین متحرک بین تخمین قبلی و اندازه‌گیری تازه قرار می‌گیرد', () => {
  const blended = blendDurationEstimate(1_000, 2_000);
  assert.ok(blended > 1_000 && blended < 2_000, `مقدار دریافتی: ${blended}`);
});

test('یک اجرای پرت، تخمین را برای همیشه خراب نمی‌کند', () => {
  const blended = blendDurationEstimate(1_000, 900_000);
  assert.ok(blended <= 900_000 * 5);
  assert.ok(blended >= 900_000 * 0.2);
});

test('تخمین‌های یادگرفته‌شده روی تعریف مراحل اعمال می‌شوند', () => {
  const applied = applyLearnedEstimates(PHASES, { b: 5_000 });
  assert.equal(applied[1].estimateMs, 5_000);
  assert.equal(applied[0].estimateMs, 1_000);
});

test('مقدار یادگرفته‌شده نامعتبر نادیده گرفته می‌شود', () => {
  const applied = applyLearnedEstimates(PHASES, { a: 0, b: Number.NaN });
  assert.equal(applied[0].estimateMs, 1_000);
  assert.equal(applied[1].estimateMs, 2_000);
});

// ============================================================================
// نرمی نمایش
// ============================================================================

test('درصد نمایشی هرگز عقب نمی‌رود', () => {
  assert.equal(smoothPercent(60, 40), 60);
});

test('پرش بزرگ به گام‌های محدود شکسته می‌شود', () => {
  const next = smoothPercent(10, 90, 6);
  assert.ok(next > 10 && next <= 16);
});

test('درصد نمایشی از ۱۰۰ عبور نمی‌کند', () => {
  assert.ok(smoothPercent(99.9, 100, 50) <= 100);
});
