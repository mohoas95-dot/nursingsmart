/**
 * Canonical Scenario Quality Evaluator — Phase 5
 * ==============================================
 *
 * ‼️ THE ONE PLACE WHERE "HOW GOOD IS THIS SCENARIO?" IS ANSWERED ‼️
 *
 * پیش از فاز ۵، دو مرجعِ ناهماهنگ وجود داشت:
 *
 *   • مولد سناریو (lib/scenarioGenerator#scoreCandidate)
 *       totalScore ← درصد شباهت به مبنا،  رتبه‌بندی ← شباهت‌محور
 *   • ارزیابی مستقیم/legacy (lib/scoring#evaluateScenarioSchedule)
 *       totalScore ← metrics.weightedTotal (وابسته به برچسب سناریو)
 *
 * یعنی یک سناریوی واحد پس از «ارزیابی مجدد» معنای امتیازش عوض می‌شد.
 *
 * از فاز ۵، هر دو مسیر از همین ماژول عبور می‌کنند:
 *
 *     schedule + baseline + context
 *            │
 *            ├─► lib/scoring#evaluateScenarioSchedule   (مؤلفه‌های سنجش: درخواست/عدالت/بهره‌وری/هشدار)
 *            ├─► domain/scenarios/objective             (مؤلفه‌های مبنا: بحرانی/قفل/شباهت)
 *            └─► buildScenarioObjective                 (دروازه‌های سخت + لایه‌های کیفیت)
 *                       │
 *                       └─► ScoredSchedule.objective  ← تنها مرجع رتبه‌بندی
 *
 * چرا اینجا و نه داخل lib/scoring؟
 *   `domain/scenarios/objective` از `lib/scoring` طبقه‌بندی هشدار را وارد می‌کند؛
 *   اگر `lib/scoring` هم سازندهٔ تابع هدف را وارد می‌کرد یک چرخهٔ وارداتیِ واقعی
 *   ساخته می‌شد. این ماژول بالای هر دو می‌نشیند و چرخه‌ای ایجاد نمی‌کند.
 *
 * PURE: بدون وابستگی به React، Next.js یا I/O.
 */

import type { JobGroup, MonthlySchedule, Personnel, ShiftRequest, SystemSettings } from '../../lib/types';
import {
  calculateRequestSatisfactionPercent,
  countRoutineMismatches,
  evaluateScenarioSchedule,
  type ScenarioType,
  type ScoredSchedule,
} from '../../lib/scoring';
import type { ScheduleWarning } from '../warnings/schedule-warning';
import {
  buildScenarioObjective,
  compareByObjective,
  evaluateBaselineObjective,
  SCENARIO_OBJECTIVE_VERSION,
  type ScenarioObjective,
} from './objective';

// ---------------------------------------------------------------------------
// آستانه‌های پذیرش — بدون تغییر نسبت به فاز ۴
// ---------------------------------------------------------------------------

/** بیشترین فاصلهٔ مجاز از مبنا برای پذیرش (٪). */
export const MAX_BASELINE_DIFFERENCE_PERCENT = 35;
/** کمترین فاصلهٔ لازم تا سناریو «بدیلِ واقعی» شمرده شود (٪). */
export const MIN_DIFFERENCE_FROM_BASELINE_PERCENT = 3;
/** کمترین فاصلهٔ لازم میان دو سناریوی منتخب (٪). */
export const MIN_DISTINCT_DIFFERENCE_PERCENT = 3;

// ---------------------------------------------------------------------------
// ورودی ارزیابی کانونی
// ---------------------------------------------------------------------------

export interface CanonicalScenarioEvaluationInput {
  id: number;
  type: ScenarioType;
  /** سناریوی موردارزیابی (پس از reconcile/تعمیر). */
  schedule: MonthlySchedule;
  /** برنامهٔ مبنا. اگر در دسترس نباشد، لایهٔ شباهت با خودِ سناریو سنجیده می‌شود. */
  baseline: MonthlySchedule;
  /** هشدارهای ساخت‌یافته (در صورت وجود) — طبقه‌بندی بحرانی با کد ماشینی. */
  structuredWarnings?: ReadonlyArray<ScheduleWarning>;
  personnelList: readonly Personnel[];
  requests: readonly ShiftRequest[];
  settings: SystemSettings;
  year: number;
  month: number;
  customHolidays: Readonly<Record<number, string>>;
  firstDayOfWeekIndex?: number;
  monthlyDutyHours?: unknown;
  targetJobGroup?: JobGroup;
  /** پرسنل هدف (آزاد + گروه کاری) — شباهت فقط روی این‌ها سنجیده می‌شود. */
  targetPersonnelIds: ReadonlyArray<string>;
  totalDays: number;
  /** ردیف‌های قفل‌شده — برای بازرسی صریح دروازهٔ حفظ قفل. */
  lockedRows: ReadonlyArray<string>;
  /** آستانه‌های پذیرش (پیش‌فرض: همان مقادیر تأییدشده). */
  maxBaselineDifferencePercent?: number;
  minBaselineDifferencePercent?: number;
}

/**
 * ارزیابی کانونی یک سناریو: مؤلفه‌های سنجش + تابع هدف.
 *
 * خروجی همان `ScoredSchedule` تاریخی است (سازگاریِ کامل با ذخیره‌سازی و UI) اما
 * با دو فیلد جدید که مرجع تصمیم‌گیری‌اند: `objective` و `objectiveVersion`.
 *
 * `totalScore` دیگر بازنویسی نمی‌شود: در هر دو مسیر تولید و ارزیابی مجدد،
 * دقیقاً `metrics.weightedTotal` است (فیلد نمایشی/سازگاری، نه مرجع رتبه‌بندی).
 *
 * @pure
 */
export function evaluateScenarioQuality(
  input: CanonicalScenarioEvaluationInput
): ScoredSchedule {
  const scored = evaluateScenarioSchedule({
    id: input.id,
    type: input.type,
    schedule: input.schedule,
    personnelList: input.personnelList,
    requests: input.requests,
    settings: input.settings,
    year: input.year,
    month: input.month,
    customHolidays: input.customHolidays,
    firstDayOfWeekIndex: input.firstDayOfWeekIndex,
    monthlyDutyHours: input.monthlyDutyHours,
    targetJobGroup: input.targetJobGroup,
  });

  const requestSatisfactionPercent = calculateRequestSatisfactionPercent(
    input.schedule,
    input.personnelList,
    input.requests,
    input.year,
    input.month,
    input.customHolidays,
    input.firstDayOfWeekIndex,
    input.targetJobGroup
  );

  const baselineComponents = evaluateBaselineObjective({
    baseline: input.baseline,
    candidate: input.schedule,
    warnings: input.schedule.warnings,
    structuredWarnings: input.structuredWarnings,
    targetPersonnelIds: input.targetPersonnelIds,
    totalDays: input.totalDays,
    lockedRows: input.lockedRows,
    requestSatisfactionPercent,
  });

  const objective: ScenarioObjective = buildScenarioObjective({
    baselineComponents,
    maxBaselineDifferencePercent:
      input.maxBaselineDifferencePercent ?? MAX_BASELINE_DIFFERENCE_PERCENT,
    minBaselineDifferencePercent:
      input.minBaselineDifferencePercent ?? MIN_DIFFERENCE_FROM_BASELINE_PERCENT,
    requestSatisfactionPercent,
    operationalEfficiencyScore: scored.metrics.operationalEfficiencyScore,
    fairnessScore: scored.metrics.fairnessScore,
    // مرجع یکتای نقص هشداری: از lib/scoring می‌آید، نه از یک شمارش موازی.
    warningDefectCount: scored.metrics.nonCriticalWarningDefectCount,
    routineMismatchCount: countRoutineMismatches(
      input.schedule,
      input.personnelList,
      input.targetJobGroup,
      input.totalDays
    ),
  });

  return {
    ...scored,
    baselineSimilarityPercent: baselineComponents.similarityPercent,
    baselineDifferencePercent: baselineComponents.baselineDifferencePercent,
    criticalWarningCount: baselineComponents.criticalWarningCount,
    objective,
    objectiveVersion: SCENARIO_OBJECTIVE_VERSION,
  };
}

// ---------------------------------------------------------------------------
// رتبهٔ نمایشی سناریوها — همان ترتیبِ مرجعِ موتور
// ---------------------------------------------------------------------------

/**
 * ترتیبِ نمایشیِ سناریوها را بر اساس **تابع هدف کانونی** برمی‌گرداند.
 *
 * چرا اینجا و نه داخل کامپوننت؟
 *   تا پیش از این، `ScenarioWorkspace` سناریوها را مستقلاً و بر اساس «درصد
 *   شباهت به مبنا» مرتب می‌کرد و رتبهٔ نمایشی را از همان می‌ساخت. این یک
 *   «مرجع دومِ رتبه‌بندی» بود: موتور بر اساس درخواست→بهره‌وری→عدالت→نقص→
 *   روتین→شباهت انتخاب می‌کرد، اما کاربر رتبه‌ای شباهت‌محور می‌دید و این دو
 *   می‌توانستند دقیقاً برعکس هم باشند. رتبه‌بندی نمایشی اکنون از همین تابع
 *   خالص و قابل‌تست می‌آید تا با مسیر انتخابِ موتور یکی بماند.
 *
 * سازگاری با سناریوهای legacy:
 *   سناریوهای ذخیره‌شدهٔ پیش از فاز ۵ فیلد `objective` ندارند. برای آن‌ها
 *   **هیچ تابع هدفی ساخته یا حدس زده نمی‌شود** و کیفیتشان صفر فرض نمی‌شود؛
 *   ترتیب ذخیره‌شدهٔ خودشان (که همان ترتیب انتخابِ زمانِ تولید است) حفظ
 *   می‌شود. اگر حتی یک سناریو در فهرست فاقد `objective` باشد، کل فهرست
 *   دست‌نخورده برمی‌گردد: مقایسهٔ سناریوهای دو نسخهٔ متفاوتِ تابع هدف با هم
 *   بی‌معناست و امن‌ترین رفتار، حفظ ترتیب تاریخی است.
 *
 * مرتب‌سازی پایدار است (`Array.prototype.sort` در ES2019 به بعد)، پس در
 * برابریِ کاملِ تابع هدف، ترتیب ورودی حفظ می‌شود.
 *
 * @pure
 */
export function orderScenariosByObjective<T extends Pick<ScoredSchedule, 'objective'>>(
  scenarios: ReadonlyArray<T>
): T[] {
  const everyScenarioHasObjective = scenarios.every(scenario => !!scenario.objective);
  if (!everyScenarioHasObjective) return [...scenarios];
  return [...scenarios].sort((left, right) =>
    compareByObjective(left.objective!.quality, right.objective!.quality)
  );
}

/**
 * نگاشتِ «شناسهٔ گزینه → رتبهٔ نمایشی (۱-مبنا)» بر اساس تابع هدف کانونی.
 *
 * @pure
 */
export function buildObjectiveRankMap<T extends Pick<ScoredSchedule, 'objective'>>(
  scenarios: ReadonlyArray<T>,
  keyOf: (scenario: T) => string
): Map<string, number> {
  const ranked = orderScenariosByObjective(scenarios);
  const rankByKey = new Map<string, number>();
  ranked.forEach((scenario, index) => rankByKey.set(keyOf(scenario), index + 1));
  return rankByKey;
}
