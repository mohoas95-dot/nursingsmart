/**
 * Baseline-Oriented Scenario Objective — Domain Layer (Pure Functions)
 *
 * این ماژول بخش مبنامحور تابع هدف را نگه می‌دارد: سنجش فاصله، حفظ قفل‌ها و
 * تشخیص تخلف مسدودکننده. انتخاب نهایی A/B/C در مولد با سه تابع هدف مستقل
 * (درخواست، عدالت و تلفیقی) انجام می‌شود؛ بنابراین شباهت به مبنا دیگر معیار
 * غالب هر سه سناریو نیست و فقط مرز ایمنی/tie-breaker است.
 *
 * توابع این فایل کاملاً خالص‌اند (بدون React/Next/I/O) تا موتور، تست‌ها و UI
 * بتوانند یک محاسبهٔ یکسان از تفاوت و قفل‌ها داشته باشند.
 *
 * PURE: بدون وابستگی به React، Next.js یا I/O.
 */

import type { JobGroup, MonthlySchedule, Personnel, ShiftRequest, ShiftType } from '../../lib/types';
import {
  countHardConstraintWarnings,
  getHardConstraintWarnings,
  isHardConstraintWarning,
  HARD_WARNING_PREFIXES,
} from '../../lib/scoring';

// ---------------------------------------------------------------------------
// سطح A (Critical) — تعریف یکپارچهٔ هشدارهای بحرانی
// ---------------------------------------------------------------------------
//
// «هشدار سطح A» دقیقاً همان هشدارهای سختِ موجود (Hard Constraint) است که موتور
// solver تولید می‌کند. این‌ها تخلف‌های ساختاری‌اند که سناریو تا زمان رفع واقعیِ
// آن‌ها نباید به کاربر نمایش داده شود:
//   • Coverage Shortage   — کمبود نیرو
//   • Overstaffing        — نیروی مازاد
//   • Missing Shift Leader — نبود سرشیفت
//   • Max Consecutive     — نقض سقف شیفت متوالی
//   • Mandatory Rest      — لزوم استراحت اجباری
//
// این شناسه‌ها مستقیماً از lib/scoring می‌آیند تا هرگز از قوانین موجود موتور
// جدا نشوند (اصل: حفظ کامل منطق موتور بدون تغییر).

/** پیشوندهای هشدار سطح A (بحرانی). */
export const CRITICAL_WARNING_PREFIXES = HARD_WARNING_PREFIXES;

/** آیا این هشدار از نوع سطح A (بحرانی) است؟ */
export const isCriticalWarning = isHardConstraintWarning;

/** فهرست هشدارهای سطح A را برمی‌گرداند. */
export const getCriticalWarnings = getHardConstraintWarnings;

/** تعداد هشدارهای سطح A را برمی‌گرداند. */
export const countCriticalWarnings = countHardConstraintWarnings;

/** آیا حداقل یک هشدار سطح A وجود دارد؟ */
export function hasCriticalWarning(warnings: ReadonlyArray<string>): boolean {
  return countCriticalWarnings(warnings) > 0;
}

// ---------------------------------------------------------------------------
// شباهت به برنامهٔ مبنا — معیار اصلی رتبه‌بندی سناریوها
// ---------------------------------------------------------------------------

/**
 * درصد شباهت یک سناریو به برنامهٔ مبنا (Working Roster).
 *
 *   ۱۰۰ = کاملاً مشابه مبنا (هیچ سلولی از پرسنل هدف تغییر نکرده)
 *   ۰   = کاملاً متفاوت از مبنا
 *
 * فقط روی سلول‌های «پرسنل هدف» (آزاد + گروه کاری موردنظر) محاسبه می‌شود؛
 * پرسنل قفل‌شده و گروه کاری دیگر ارثی‌اند و در شمارش نمی‌آیند. این دقیقاً
 * معیار «حفظ ساختار برنامهٔ مبنا» است که اصل ۳ تابع هدف خواستار آن است.
 *
 * @pure
 */
export function calculateBaselineSimilarityPercent(
  baseline: MonthlySchedule,
  candidate: MonthlySchedule,
  personnelIds: ReadonlyArray<string>,
  totalDays: number
): number {
  const totalCells = Math.max(1, personnelIds.length * totalDays);
  let changed = 0;

  for (const personnelId of personnelIds) {
    const baselineRow = baseline.assignments[personnelId] || {};
    const candidateRow = candidate.assignments[personnelId] || {};
    for (let day = 1; day <= totalDays; day += 1) {
      if ((baselineRow[day] || 'OFF') !== (candidateRow[day] || 'OFF')) {
        changed += 1;
      }
    }
  }

  const differencePercent = (changed / totalCells) * 100;
  return Number(Math.max(0, 100 - differencePercent).toFixed(2));
}

/**
 * درصد فاصلهٔ سناریو از برنامهٔ مبنا (مکمل شباهت). برای فیلتر کیفیت و نمایش
 * «میزان تغییر نسبت به مبنا» به‌کار می‌رود.
 */
export function calculateBaselineDifferencePercent(
  baseline: MonthlySchedule,
  candidate: MonthlySchedule,
  personnelIds: ReadonlyArray<string>,
  totalDays: number
): number {
  return Number(
    (100 - calculateBaselineSimilarityPercent(baseline, candidate, personnelIds, totalDays)).toFixed(2)
  );
}

// ---------------------------------------------------------------------------
// تفاوت‌های سلول‌به‌سلول با برنامهٔ مبنا — برای نمایش به سرپرستار
// ---------------------------------------------------------------------------

/** یک سلولِ تغییر یافتهٔ سناریو نسبت به برنامهٔ مبنا. */
export interface BaselineCellDiff {
  personnelId: string;
  day: number;
  /** شیفت در برنامهٔ مبنا. */
  baselineShift: ShiftType;
  /** شیفت در سناریوی پیشنهادی. */
  candidateShift: ShiftType;
}

/**
 * فهرست سلول‌هایی که سناریو نسبت به برنامهٔ مبنا تغییر کرده است.
 *
 * فقط روی «پرسنل هدف» بررسی می‌شود؛ پرسنل قفل‌شده و گروه کاری دیگر ارثی‌اند و
 * تغییری ندارند. خروجی برای نمایش «تفاوت‌های برنامهٔ تولیدی با برنامهٔ مبنا» در
 * یک پنجرهٔ جداگانه به سرپرستار به‌کار می‌رود.
 *
 * @pure
 */
export function computeBaselineCellDiffs(
  baseline: MonthlySchedule,
  candidate: MonthlySchedule,
  personnelIds: ReadonlyArray<string>,
  totalDays: number
): BaselineCellDiff[] {
  const diffs: BaselineCellDiff[] = [];
  for (const personnelId of personnelIds) {
    const baselineRow = baseline.assignments[personnelId] || {};
    const candidateRow = candidate.assignments[personnelId] || {};
    for (let day = 1; day <= totalDays; day += 1) {
      const baselineShift = (baselineRow[day] || 'OFF') as ShiftType;
      const candidateShift = (candidateRow[day] || 'OFF') as ShiftType;
      if (baselineShift !== candidateShift) {
        diffs.push({ personnelId, day, baselineShift, candidateShift });
      }
    }
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// تابع هدف مبنامحور (Objective Function)
// ---------------------------------------------------------------------------

/**
 * ارزیابی یک سناریو بر اساس تابع هدفِ اولویت‌دارِ بازطراحی‌شده.
 *
 * اولویت‌ها (به‌ترتیب) — دقیقاً مطابق «تابع هدف» در پرامپت:
 *   ۱. رفع کامل تمام هشدارهای سطح A        → criticalResolved (hard gate)
 *   ۲. حفظ کامل قفل‌ها                       → locksPreserved (تضمین ساختاری)
 *   ۳. بیشترین شباهت ممکن به برنامهٔ مبنا   → similarityPercent (معیار رتبه‌بندی)
 *   ۴. رعایت درخواست‌های پرسنل (فقط پس‌زمینه) → requestSatisfactionPercent (tiebreaker)
 *
 * عدالت دیگر معیار انتخاب یا رتبه‌بندی نیست و در اینجا محاسبه نمی‌شود.
 */
export interface BaselineObjective {
  /** اولویت ۱: آیا هیچ هشدار سطح A باقی نمانده؟ */
  criticalResolved: boolean;
  /** اولویت ۱: تعداد هشدارهای سطح A. */
  criticalWarningCount: number;
  /** اولویت ۲: آیا همهٔ ردیف‌های قفل‌شده دست‌نخورده مانده‌اند؟ */
  locksPreserved: boolean;
  /** اولویت ۳: درصد شباهت به برنامهٔ مبنا (کلید رتبه‌بندی). */
  similarityPercent: number;
  /** اولویت ۳: درصد فاصله از برنامهٔ مبنا. */
  baselineDifferencePercent: number;
  /**
   * اولویت ۴: درصد رعایت درخواست‌های پرسنل. فقط به‌عنوان tiebreaker پس‌زمینه
   * استفاده می‌شود و هرگز در رابط کاربری نمایش داده نمی‌شود.
   */
  requestSatisfactionPercent: number;
}

export interface BaselineObjectiveInput {
  baseline: MonthlySchedule;
  candidate: MonthlySchedule;
  warnings: ReadonlyArray<string>;
  /** شناسهٔ پرسنل هدف (آزاد + گروه کاری). شباهت فقط روی این‌ها سنجیده می‌شود. */
  targetPersonnelIds: ReadonlyArray<string>;
  totalDays: number;
  /** ردیف‌های قفل‌شده (برای تأیید ساختاری حفظ قفل‌ها). */
  lockedRows: ReadonlyArray<string>;
  /** محاسبهٔ درصد رضایت درخواست‌ها (پس‌زمینه). تابع خالص بیرونی. */
  requestSatisfactionPercent: number;
}

/**
 * محاسبهٔ تابع هدف مبنامحور.
 *
 * @pure
 */
export function evaluateBaselineObjective(input: BaselineObjectiveInput): BaselineObjective {
  const criticalWarningCount = countCriticalWarnings(input.warnings);
  const similarityPercent = calculateBaselineSimilarityPercent(
    input.baseline,
    input.candidate,
    input.targetPersonnelIds,
    input.totalDays
  );

  return {
    criticalResolved: criticalWarningCount === 0,
    criticalWarningCount,
    locksPreserved: areLocksPreserved(input.baseline, input.candidate, input.lockedRows),
    similarityPercent,
    baselineDifferencePercent: Number((100 - similarityPercent).toFixed(2)),
    requestSatisfactionPercent: input.requestSatisfactionPercent,
  };
}

/**
 * آیا همهٔ ردیف‌های قفل‌شده در سناریو دقیقاً مانند برنامهٔ مبنا مانده‌اند؟
 *
 * این یک «تضمین ساختاری» است: مولد سناریو هرگز سلول‌های قفل‌شده را تغییر
 * نمی‌دهد، اما این تابع آن را به‌صورت یک قوانینِ قابل‌اتکا بازرسی می‌کند.
 *
 * @pure
 */
export function areLocksPreserved(
  baseline: MonthlySchedule,
  candidate: MonthlySchedule,
  lockedRows: ReadonlyArray<string>
): boolean {
  for (const personnelId of lockedRows) {
    const baselineRow = baseline.assignments[personnelId] || {};
    const candidateRow = candidate.assignments[personnelId] || {};
    const allDays = new Set<number>([
      ...Object.keys(baselineRow).map(Number),
      ...Object.keys(candidateRow).map(Number),
    ]);
    for (const day of allDays) {
      if ((baselineRow[day] || 'OFF') !== (candidateRow[day] || 'OFF')) {
        return false;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// رتبه‌بندی و انتخاب بر اساس شباهت به مبنا
// ---------------------------------------------------------------------------

export interface RankableScenario {
  baselineSimilarityPercent: number;
  /** tiebreaker پس‌زمینه: رضایت درخواست‌ها. */
  requestSatisfactionPercent?: number;
}

/**
 * مقایسه‌کنندهٔ رتبه‌بندی سناریوها بر اساس «نزدیک‌بودن به برنامهٔ مبنا».
 *
 * نه بر اساس عدالت. نه بر اساس تعداد درخواست‌های رعایت‌شده.
 * ترتیب: شباهتِ بیشتر اول؛ در برابری، رضایت درخواستِ بیشتر (پس‌زمینه) اول.
 *
 * @pure
 */
export function compareByBaselineSimilarity(
  left: RankableScenario,
  right: RankableScenario
): number {
  if (left.baselineSimilarityPercent !== right.baselineSimilarityPercent) {
    return right.baselineSimilarityPercent - left.baselineSimilarityPercent;
  }
  const leftReq = left.requestSatisfactionPercent ?? 0;
  const rightReq = right.requestSatisfactionPercent ?? 0;
  return rightReq - leftReq;
}

// ---------------------------------------------------------------------------
// معیار تمایز سناریوها از یکدیگر (برای جلوگیری از نسخه‌های تقریباً یکسان)
// ---------------------------------------------------------------------------

/**
 * آیا دو سناریو به‌اندازهٔ کافی متمایزند تا هر دو به کاربر نمایش داده شوند؟
 * هدف: ارائهٔ کمترین تغییر ممکن نسبت به مبناست، پس دو سناریوی بسیار نزدیک به
 * هم ارزش نمایش جداگانه ندارند. این تابع فقط برای «انتخاب نهایی تا ۳ سناریو»
 * به‌کار می‌رود، نه برای فیلتر کیفیت.
 *
 * @pure
 */
export function areScenariosDistinctEnough(
  left: MonthlySchedule,
  right: MonthlySchedule,
  personnelIds: ReadonlyArray<string>,
  totalDays: number,
  minDifferencePercent: number
): boolean {
  return (
    calculateBaselineDifferencePercent(left, right, personnelIds, totalDays) >= minDifferencePercent
  );
}

// ---------------------------------------------------------------------------
// مقایسه‌کنندهٔ تابع هدف کامل (شباهت ← هشدار ← درخواست)
// ---------------------------------------------------------------------------
//
// در میان سناریوهای پاکِ سطح A، رتبه‌بندی نهایی بر اساس اولویت‌های کاربر است:
//   ۱) شبیه‌تر به مبنا (نزدیک‌تر اول)
//   ۲) کمتر هشدار غیربحرانی (کمتر اول)
//   ۳) بیشتر رعایت درخواست پرسنل (بیشتر اول)

export interface ObjectiveRankable {
  /** درصد شباهت به برنامهٔ مبنا (اولویت ۱، نزولی). */
  similarityPercent: number;
  /** تعداد هشدارهای غیربحرانیِ باقیمانده (اولویت ۲، صعودی). */
  nonCriticalWarningCount: number;
  /** درصد رعایت درخواست‌های پرسنل در پس‌زمینه (اولویت ۳، نزولی). */
  requestSatisfactionPercent: number;
}

/**
 * مقایسهٔ دو سناریوی پاک بر اساس تابع هدفِ اولویت‌دار.
 *
 * @pure
 */
export function compareByObjective(left: ObjectiveRankable, right: ObjectiveRankable): number {
  if (left.similarityPercent !== right.similarityPercent) {
    return right.similarityPercent - left.similarityPercent;
  }
  if (left.nonCriticalWarningCount !== right.nonCriticalWarningCount) {
    return left.nonCriticalWarningCount - right.nonCriticalWarningCount;
  }
  return right.requestSatisfactionPercent - left.requestSatisfactionPercent;
}

// ---------------------------------------------------------------------------
// انواع کمکی
// ---------------------------------------------------------------------------

export type { JobGroup, Personnel, ShiftRequest };
