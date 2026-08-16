/**
 * Baseline-Oriented Scenario Objective — Domain Layer (Pure Functions)
 *
 * پاسخ‌گوی «اصل شماره ۲» و «تابع هدف» در بازطراحی معماری سناریوها:
 *   سناریوها دیگر از صفر ساخته نمی‌شوند؛ آن‌ها «پیشنهادهای بهینه‌شده بر پایهٔ
 *   برنامهٔ مبنا (Working Roster)» هستند. تنها منبع حقیقت، برنامهٔ مبنا است و
 *   هدف موتور، نزدیک‌ترین نسخهٔ ممکن به همان برنامه به‌اضافهٔ رفع واقعی
 *   هشدارهای بحرانی است.
 *
 * این ماژول قرارداد سطح A (Critical) و تابع هدف مبنامحور را به‌صورت کاملاً
 * خالص (بدون React/Next/I/O) تعریف می‌کند تا توسط موتور تولید سناریو، تست‌ها
 * و رابط کاربری به‌طور یکدست مصرف شود.
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
import {
  countCriticalScheduleWarnings,
  type ScheduleWarning,
} from '../warnings/schedule-warning';

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
//
// «Mandatory Rest» بحرانی نیست: یادآور مرزی پایان ماه دربارهٔ ماه آینده است و
// یک برنامهٔ قانونیِ ماه جاری (زنجیرهٔ وزنی دقیقاً ۵) را دروازهٔ سخت نمی‌کند.
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
 * COMPONENT METRIC (فاز ۵) — نه مرجع رتبه‌بندی.
 *
 * این ساختار «مؤلفه‌های مبنامحور» را محاسبه می‌کند: تعداد هشدار بحرانی، حفظ
 * قفل‌ها، و شباهت/فاصله از مبنا. تا فاز ۴ همین ساختار عملاً مرجع رتبه‌بندی هم بود
 * (شباهت در صدر). از فاز ۵، مرجع رتبه‌بندی `ScenarioObjective` است و این تابع
 * فقط مؤلفه‌های Tier 0 و Tier 7 را تأمین می‌کند.
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
  /**
   * هشدارهای ساخت‌یافتهٔ همان warnings (اختیاری). اگر ارائه شود، شمارش هشدارهای
   * بحرانی بر اساسِ کد ماشینی انجام می‌شود (نه پیشوندِ متن فارسی/نمایشی) — سیاست
   * یکسان است و نتیجه با شمارش رشته‌ای برابر است؛ این فقط بازنماایی است.
   */
  structuredWarnings?: ReadonlyArray<ScheduleWarning>;
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
  // طبقه‌بندی بحرانی: در مسیر canonical از کد ساخت‌یافته استفاده می‌شود؛
  // مسیر legacy (رشته‌محور) برای سازگاری حفظ شده و نتیجهٔ یکسانی می‌دهد.
  const criticalWarningCount = input.structuredWarnings
    ? countCriticalScheduleWarnings(input.structuredWarnings)
    : countCriticalWarnings(input.warnings);
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
 * ورودی ساختِ تابع هدف کانونی (فاز ۵).
 *
 * هیچ معیاری اینجا از نو اختراع نمی‌شود: تمام اعداد از سازوکارهای موجود می‌آیند
 * (`calculateRequestSatisfactionPercent`، امتیاز عدالت و بهره‌وریِ lib/scoring،
 * شمارش نقص هشداری، `countRoutineMismatches`، و شباهت مبنا در همین ماژول).
 */
export interface ScenarioObjectiveInput {
  /** مؤلفه‌های مبنامحور (بحرانی/قفل/شباهت). */
  baselineComponents: BaselineObjective;
  /** سقف مجاز فاصله از مبنا (٪) — همان آستانهٔ پذیرش موجود. */
  maxBaselineDifferencePercent: number;
  /** حداقل فاصلهٔ لازم از مبنا (٪) — همان آستانهٔ پذیرش موجود. */
  minBaselineDifferencePercent: number;
  /** Tier 3 — درصد رضایت درخواست‌ها. */
  requestSatisfactionPercent: number;
  /** Tier 4 — بهره‌وری عملیاتی خالص (بدون جریمهٔ هشدار). */
  operationalEfficiencyScore: number;
  /** Tier 5 — امتیاز عدالت. */
  fairnessScore: number;
  /** Tier 6 — تعداد نقص هشداری غیربحرانی (مرجع یکتا). */
  warningDefectCount: number;
  /** Tier 6 — ناسازگاری روتین. */
  routineMismatchCount: number;
}

/**
 * ساخت تابع هدف کانونیِ یک سناریو: دروازه‌های سخت + لایه‌های کیفیت.
 *
 * @pure
 */
export function buildScenarioObjective(input: ScenarioObjectiveInput): ScenarioObjective {
  const difference = input.baselineComponents.baselineDifferencePercent;
  return {
    version: SCENARIO_OBJECTIVE_VERSION,
    gates: {
      criticalResolved: input.baselineComponents.criticalResolved,
      criticalWarningCount: input.baselineComponents.criticalWarningCount,
      locksPreserved: input.baselineComponents.locksPreserved,
      withinMaxBaselineDifference: difference <= input.maxBaselineDifferencePercent,
      meetsMinBaselineDifference: difference >= input.minBaselineDifferencePercent,
    },
    quality: {
      requestSatisfactionPercent: input.requestSatisfactionPercent,
      operationalEfficiencyScore: input.operationalEfficiencyScore,
      fairnessScore: input.fairnessScore,
      warningDefectCount: input.warningDefectCount,
      routineMismatchCount: input.routineMismatchCount,
      baselineSimilarityPercent: input.baselineComponents.similarityPercent,
    },
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

/**
 * LEGACY / COMPATIBILITY SHAPE — no longer a ranking authority.
 *
 * تا فاز ۴، رتبه‌بندی سناریوها با یک مقایسه‌کنندهٔ «شباهت‌محور» انجام می‌شد که
 * ورودی‌اش همین شکل بود. از فاز ۵ تنها مرجع رتبه‌بندی `compareByObjective` روی
 * `ScenarioObjective` است. این نوع فقط برای مصرف‌کننده‌های نمایشی که هنوز
 * «درصد شباهت» را در دست دارند نگه داشته شده و هیچ مقایسه‌کننده‌ای ندارد.
 */
export interface RankableScenario {
  baselineSimilarityPercent: number;
  requestSatisfactionPercent?: number;
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

// ===========================================================================
// فاز ۵ — تابع هدف کانونیِ کیفیت سناریو (تنها مرجع رتبه‌بندی)
// ===========================================================================
//
// ‼️ THE SINGLE AUTHORITY FOR SCENARIO QUALITY ‼️
//
// پیش از فاز ۵ سه مرجع موازی وجود داشت:
//   • مولد تازه:    totalScore = درصد شباهت به مبنا
//   • مسیر legacy:  totalScore = metrics.weightedTotal (وابسته به برچسب سناریو)
//   • تعمیر بحرانی: ترجیح ثانویه = کمترین فاصله از مبنا
// این‌ها می‌توانستند دربارهٔ «کیفیت یک سناریو» با هم اختلاف داشته باشند.
//
// از فاز ۵، «کیفیت سناریو» دقیقاً و فقط با همین ماژول تعریف می‌شود:
//
//   ۱) دروازه‌های سخت (Tier 0)  → `ScenarioObjectiveGates` / `isScenarioAcceptable`
//   ۲) رتبه‌بندی واژه‌نگاشتی    → `ScenarioObjectiveQuality` / `compareByObjective`
//
// چرا واژه‌نگاشتی (lexicographic) و نه وزن‌دار؟
//   معیارهای موجود (درصد رضایت درخواست، درصد بهره‌وری، درصد عدالت، شمارش نقص،
//   درصد شباهت) واحدِ مشترک ندارند و هیچ نرخ تبدیلِ مستندی میان آن‌ها در سیاست‌های
//   تأییدشدهٔ فازهای ۱ تا ۴ وجود ندارد. ساختن وزن برای رسیدن به یک عدد اسکالر،
//   «اختراع سیاست محصول» بود؛ پس ترتیب اولویت صریح پیاده شده است.

/**
 * شناسهٔ نسخهٔ تابع هدف — روی هر سناریوی تولیدشده ثبت می‌شود تا سناریوهای
 * ذخیره‌شدهٔ قدیمی (که با مرجع شباهت‌محور رتبه گرفته‌اند) از سناریوهای فاز ۵
 * قابل تفکیک باشند. هیچ تغییری در schema لازم نیست (payload سناریو در
 * lib/storageSchemas به‌صورت `z.any()` ذخیره می‌شود).
 */
export const SCENARIO_OBJECTIVE_VERSION = 'scenario-objective/2';

/** نسخهٔ ضمنیِ سناریوهای ذخیره‌شدهٔ پیش از فاز ۵ (شباهت‌محور). */
export const LEGACY_SCENARIO_OBJECTIVE_VERSION = 'scenario-objective/1-similarity-first';

/**
 * آستانهٔ «معناداری» برای مقایسهٔ لایه‌های درصدیِ پیوسته (درخواست/بهره‌وری/عدالت).
 *
 * این یک وزن نیست و هیچ معیاری را به معیار دیگر تبدیل نمی‌کند؛ فقط تعیین می‌کند
 * که یک اختلافِ درصدی چه زمانی «واقعی» است و چه زمانی نوسانِ گردکردن (همهٔ این
 * معیارها با `toFixed(2)` تولید می‌شوند). بدون آن، اختلاف ۰٫۰۱ درصدیِ عدالت بر
 * هر معیار پایین‌دستی غلبه می‌کرد.
 */
export const OBJECTIVE_MATERIAL_DIFFERENCE = 0.5;

/**
 * سطلِ (bucket) معناداریِ یک معیار درصدی.
 *
 * چرا سطل‌بندی و نه مقایسهٔ اپسیلونیِ دوتایی؟
 *   نسخهٔ نخستِ فاز ۵ از «|a − b| < ε» استفاده می‌کرد. برابریِ اپسیلونی **متعدی
 *   (transitive) نیست**: با ε = ۰٫۵ داریم ۹۰٫۰ ≈ ۹۰٫۴ و ۹۰٫۴ ≈ ۹۰٫۸، اما
 *   ۹۰٫۰ ≉ ۹۰٫۸. در نتیجه مقایسه‌کننده می‌توانست A > B و B > C و C > A بدهد و
 *   ترتیب نهایی به ترتیبِ ورودیِ آرایه وابسته می‌شد (نقض قطعیت، و رفتار
 *   تعریف‌نشده برای Array.prototype.sort).
 *
 *   سطل‌بندی همان «تحملِ ۰٫۵ درصدی» را حفظ می‌کند اما چون هر مقدار **یک‌بار و
 *   مستقل از طرفِ مقابل** به یک عدد صحیح نگاشته می‌شود، رابطهٔ برابری متعدی و
 *   ترتیب کاملاً قطعی می‌شود.
 *
 * این نه یک وزن است و نه معنای هیچ معیاری را عوض می‌کند؛ فقط دقتِ مقایسه را به
 * پلهٔ مستندشدهٔ ۰٫۵ محدود می‌کند (همهٔ این درصدها با `toFixed(2)` تولید می‌شوند).
 *
 * @pure
 */
export function materialBucket(value: number): number {
  return Math.round(value / OBJECTIVE_MATERIAL_DIFFERENCE);
}

/**
 * آیا دو درصد در همان سطلِ معناداری قرار می‌گیرند؟
 *
 * برخلاف نسخهٔ اپسیلونیِ پیشین، این رابطه متعدی است: `bucket(a) === bucket(b)`
 * و `bucket(b) === bucket(c)` ⇒ `bucket(a) === bucket(c)`.
 *
 * @pure
 */
export function isMateriallyEqual(left: number, right: number): boolean {
  return materialBucket(left) === materialBucket(right);
}

/**
 * Tier 0 — دروازه‌های سختِ پذیرش. اگر هر کدام نقض شود سناریو «غیرقابل‌قبول» است و
 * هیچ امتیاز نرمی نمی‌تواند آن را جبران کند.
 *
 * سیاست هیچ‌کدام از این دروازه‌ها در فاز ۵ تغییر نکرده است؛ فقط در یک‌جا و به‌صورت
 * صریح جمع شده‌اند (پیش‌تر `locksPreserved` محاسبه می‌شد اما هرگز به‌عنوان دروازه
 * بررسی نمی‌شد).
 */
export interface ScenarioObjectiveGates {
  /** هیچ هشدار سطح A (بحرانی) پس از تعمیر باقی نمانده باشد. */
  criticalResolved: boolean;
  /** تعداد هشدارهای سطح A (مرجع یکتا). */
  criticalWarningCount: number;
  /** تمام ردیف‌های قفل‌شده عیناً مانند مبنا مانده باشند. */
  locksPreserved: boolean;
  /** فاصله از مبنا از سقف مجاز بیشتر نباشد. */
  withinMaxBaselineDifference: boolean;
  /** فاصله از مبنا از حداقلِ «بدیل واقعی بودن» کمتر نباشد. */
  meetsMinBaselineDifference: boolean;
}

/** آیا سناریو تمام دروازه‌های سخت را رد کرده است؟ @pure */
export function isScenarioAcceptable(gates: ScenarioObjectiveGates): boolean {
  return (
    gates.criticalResolved
    && gates.locksPreserved
    && gates.withinMaxBaselineDifference
    && gates.meetsMinBaselineDifference
  );
}

/**
 * لایه‌های کیفیتِ رتبه‌بندی (فقط میان نامزدهای پذیرفته‌شده).
 *
 * ترتیب اولویت — دقیقاً همان ترتیب مقایسه در `compareByObjective`:
 *
 *   Tier 1 — کیفیت پوشش:
 *       دروازهٔ سخت است، نه معیار رتبه‌بندی. موتور فعلی هر کمبود را
 *       `COVERAGE_SHORTAGE` و هر مازاد را `OVERSTAFFING` می‌داند و هر دو بحرانی‌اند؛
 *       بنابراین هر سناریوی پذیرفته‌شده دقیقاً «پوشش برابر تقاضا» دارد و هیچ
 *       دادهٔ موجودی «مازادِ معقول» را از «مازادِ غیرضروری» تفکیک نمی‌کند. ساختن
 *       چنین طیفی یعنی اختراع سیاست بالینی؛ پس عمداً امتیاز پوششِ ساختگی نمی‌سازیم.
 *
 *   Tier 2 — کیفیت استراحت/بار کاری:
 *       نیز دروازهٔ سخت است (MAX_CONSECUTIVE، NIGHT_REST، ارزیاب مشترک محدودیت
 *       سخت، سقف اضافه‌کار). تنها سیگنال غیرسختِ باقیمانده (`MANDATORY_REST`)
 *       دقیقاً یک بار و فقط در `warningDefectCount` شمرده می‌شود تا دو جریمهٔ
 *       رقیب برای یک پدیده وجود نداشته باشد. سیاست فاز ۴ (`CONSECUTIVE_OFFS`)
 *       دست‌نخورده است.
 *
 *   Tier 3 — رضایت درخواست‌ها (نزولی)
 *   Tier 4 — بهره‌وری/کیفیت عملیاتی (نزولی)
 *   Tier 5 — عدالت (نزولی)
 *   Tier 6 — نقص‌های هشداری غیربحرانی (صعودی) + ناسازگاری روتین (صعودی)
 *   Tier 7 — شباهت به مبنا (نزولی) — ترجیح پایانی، نه معیار نخست
 */
export interface ScenarioObjectiveQuality {
  /** Tier 3: درصد رعایت درخواست‌های پرسنل (سازوکار موجودِ ارزیابی درخواست). */
  requestSatisfactionPercent: number;
  /**
   * Tier 4: کیفیت عملیاتی خالص — فقط انحراف از ساعت موظفی، بدون جریمهٔ هشدار.
   * (تا فاز ۴، `optimizationScore` این دو را با هم مخلوط می‌کرد.)
   */
  operationalEfficiencyScore: number;
  /** Tier 5: امتیاز عدالت موجود (ساعت/شیفت/تعطیلات/انحراف موظفی). */
  fairnessScore: number;
  /**
   * Tier 6: تعداد نقص‌های هشداریِ غیربحرانی — مرجع یکتا.
   * هشدارهای صرفاً اطلاع‌رسانی هرگز در آن شمرده نمی‌شوند و هشدارهای بحرانی هم
   * نه (آن‌ها دروازهٔ سخت‌اند و نباید دوبار جریمه شوند).
   */
  warningDefectCount: number;
  /** Tier 6: سلول‌های کاریِ ناسازگار با تگ روتین (ترجیح، نه قاعدهٔ سخت). */
  routineMismatchCount: number;
  /** Tier 7: درصد شباهت به مبنا — ترجیح پایانی. */
  baselineSimilarityPercent: number;
}

/**
 * نمایِ کاملِ تابع هدف کانونی: دروازه‌های سخت + لایه‌های کیفیت.
 * این ساختار (نه هیچ عدد اسکالری) مرجع رتبه‌بندی است.
 */
export interface ScenarioObjective {
  version: typeof SCENARIO_OBJECTIVE_VERSION;
  gates: ScenarioObjectiveGates;
  quality: ScenarioObjectiveQuality;
}

/**
 * نامِ سازگارِ ورودی مقایسه‌کننده. از فاز ۵ دقیقاً همان `ScenarioObjectiveQuality`
 * است تا هیچ نمایش موازی‌ای از «کیفیت» باقی نماند.
 */
export type ObjectiveRankable = ScenarioObjectiveQuality;

/**
 * مقایسهٔ واژه‌نگاشتیِ دو نامزدِ پذیرفته‌شده بر اساس تابع هدف کانونی.
 *
 * خروجی منفی ⇒ `left` بهتر است. کاملاً قطعی (deterministic) و بدون تصادف.
 *
 * @pure
 */
export function compareByObjective(
  left: ScenarioObjectiveQuality,
  right: ScenarioObjectiveQuality
): number {
  // لایه‌های درصدیِ پیوسته با «سطل معناداری» مقایسه می‌شوند تا هم تحملِ ۰٫۵
  // درصدی حفظ شود و هم مقایسه‌کننده متعدی و قطعی بماند (نه اپسیلونِ دوتایی).

  // Tier 3 — رضایت درخواست‌ها
  const requestBucket = materialBucket(right.requestSatisfactionPercent)
    - materialBucket(left.requestSatisfactionPercent);
  if (requestBucket !== 0) return requestBucket;

  // Tier 4 — بهره‌وری عملیاتی
  const efficiencyBucket = materialBucket(right.operationalEfficiencyScore)
    - materialBucket(left.operationalEfficiencyScore);
  if (efficiencyBucket !== 0) return efficiencyBucket;

  // Tier 5 — عدالت
  const fairnessBucket = materialBucket(right.fairnessScore) - materialBucket(left.fairnessScore);
  if (fairnessBucket !== 0) return fairnessBucket;

  // Tier 6 — نقص‌های هشداری غیربحرانی، سپس ناسازگاری روتین
  // (شمارش‌های صحیح‌اند؛ تحملِ درصدی برایشان بی‌معناست.)
  if (left.warningDefectCount !== right.warningDefectCount) {
    return left.warningDefectCount - right.warningDefectCount;
  }
  if (left.routineMismatchCount !== right.routineMismatchCount) {
    return left.routineMismatchCount - right.routineMismatchCount;
  }
  // Tier 7 — شباهت به مبنا (ترجیح پایانی)
  if (left.baselineSimilarityPercent !== right.baselineSimilarityPercent) {
    return right.baselineSimilarityPercent - left.baselineSimilarityPercent;
  }
  return 0;
}

/**
 * مقایسهٔ کیفیتِ غیرسختِ دو نامزد در حین «تعمیر هشدار بحرانی».
 *
 * تا فاز ۴، وقتی دو تعمیر تعداد هشدار بحرانی یکسانی داشتند، «کمترین فاصله از
 * مبنا» برنده می‌شد؛ یعنی خودِ تعمیر هم سوگیریِ شباهت‌محور داشت. اکنون ترتیب
 * همان تابع هدف کانونی است و شباهت فقط در آخرین لایه اثر می‌گذارد.
 *
 * @pure
 */
export const compareRepairQuality = compareByObjective;

// ---------------------------------------------------------------------------
// انواع کمکی
// ---------------------------------------------------------------------------

export type { JobGroup, Personnel, ShiftRequest };
