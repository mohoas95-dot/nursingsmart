import { generateJalaliMonthCalendar } from './jalali';
import {
  JobGroup,
  MonthlySchedule,
  Personnel,
  ShiftRequest,
  ShiftType,
  SystemSettings,
} from './types';
import { shiftViolatesRoutine } from '../domain/scheduling/smart-rules';
import { canonicalizeRequestDaysForMonth } from '../domain/requests/request-canonicalizer';
import { buildRequestOutcomeLedger } from '../domain/requests/request-outcome-ledger';
import { buildRequestQualityFromLedger } from '../domain/requests/request-quality';
import { buildRequestSetFingerprint } from '../domain/requests/request-set-fingerprint';
import { replaceRequestWarningsFromLedger } from '../domain/requests/request-warning-projection';
import { generatePersonnelReports } from './solver';
import {
  isCriticalWarningCode,
  isInformationalWarningCode,
  warningMessages,
  type ScheduleWarning,
} from '../domain/warnings/schedule-warning';
import type { ScenarioObjective } from '../domain/scenarios/objective';

export type ScenarioType = 'FAIRNESS' | 'REQUESTS' | 'MIXED';
export type ScenarioKey = 'A' | 'B' | 'C';

export interface ScenarioWeights {
  request: number;
  fairness: number;
  optimization: number;
}

export interface ScenarioMetrics {
  requestScore: number;
  fairnessScore: number;
  satisfactionScore: number;
  /**
   * LEGACY COMPONENT METRIC — `0.65*warningScore + 0.35*efficiencyScore`.
   *
   * این عدد «جریمهٔ هشدار» و «بهره‌وری» را با هم مخلوط می‌کند و به همین دلیل از
   * فاز ۵ دیگر در تابع هدف کانونی مصرف نمی‌شود. برای سازگاری نمایشی/گزارشی و
   * تست‌های مؤلفه‌ای حفظ شده است. رتبه‌بندی از `operationalEfficiencyScore`
   * (بهره‌وری خالص) و `nonCriticalWarningDefectCount` (نقص هشداری) استفاده می‌کند.
   */
  optimizationScore: number;
  /**
   * Tier 3 تابع هدف کانونی: کیفیت عملیاتی خالص — فقط نزدیکی ساعات کارکرد به
   * ساعت موظفی. هیچ جریمهٔ هشداری در آن نیست.
   */
  operationalEfficiencyScore: number;
  /**
   * سهم «پاکیزگی هشدار» در `optimizationScore` (فقط برای شفافیت و سازگاری).
   * در رتبه‌بندی مصرف نمی‌شود؛ لایهٔ هشدار با `nonCriticalWarningDefectCount`
   * شمرده می‌شود تا دو جریمهٔ رقیب وجود نداشته باشد.
   */
  warningQualityScore: number;
  /**
   * مرجع یکتای «نقص هشداریِ غیربحرانی»:
   * `warningCount (بدون اطلاع‌رسانی‌ها) − hardWarningCount (بحرانی‌ها)`.
   * هشدارهای بحرانی دروازهٔ سخت‌اند و نباید دوباره در رتبه‌بندی جریمه شوند.
   */
  nonCriticalWarningDefectCount: number;
  /**
   * LEGACY COMPATIBILITY FIELD — بلندِ وزن‌دارِ وابسته به برچسب سناریو
   * (`SCENARIO_WEIGHTS[type]`). از فاز ۵ هیچ تصمیم انتخاب/رتبه‌بندی‌ای بر پایهٔ آن
   * گرفته نمی‌شود؛ فقط برای گزارش‌های تاریخی و سازگاری نگه داشته شده است.
   */
  weightedTotal: number;
  requestSatisfiedWeight: number;
  requestTotalWeight: number;
  averageDutyDeviationHours: number;
  hourBalanceScore: number;
  shiftBalanceScore: number;
  holidayBalanceScore: number;
  warningCount: number;
  hardWarningCount: number;
}

export interface ScoredSchedule {
  id: number;
  scenarioKey: ScenarioKey;
  type: ScenarioType;
  title: string;
  shortTitle: string;
  schedule: MonthlySchedule;
  weights: ScenarioWeights;
  metrics: ScenarioMetrics;
  scoreA: number;
  scoreB: number;
  scoreC: number;
  /**
   * ⚠️ COMPATIBILITY / DISPLAY FIELD — **مرجع رتبه‌بندی نیست.**
   *
   * قرارداد فاز ۵ (تصمیم مستند):
   *   تابع هدف کانونی واژه‌نگاشتی (lexicographic) است و هیچ نرخ تبدیل مستندی میان
   *   «درصد رضایت درخواست»، «بهره‌وری»، «عدالت»، «شمارش نقص» و «شباهت به مبنا»
   *   در سیاست‌های تأییدشدهٔ فازهای ۱–۴ وجود ندارد. ساختن یک اسکالر یعنی اختراع
   *   وزنِ دلبخواه؛ پس ساخته نمی‌شود.
   *
   *   در نتیجه `totalScore` فقط «نمایهٔ نمایشیِ کیفیت» است و معنایش در هر دو مسیر
   *   (تولید تازه و ارزیابی مجدد) **یکسان** است: همان `metrics.weightedTotal`.
   *   پیش از فاز ۵، مسیر تولید تازه این فیلد را با «درصد شباهت به مبنا» بازنویسی
   *   می‌کرد و همین باعث تناقض معنایی می‌شد؛ آن بازنویسی حذف شده است.
   *
   *   مرجع رتبه‌بندی: `domain/scenarios/objective#compareByObjective` روی
   *   `objective.quality` (فیلد `objective` در همین ساختار).
   */
  totalScore: number;
  strengths: string[];
  weaknesses: string[];
  analysis: string;
  targetJobGroup?: JobGroup;
  relevantWarningCount: number;
  relevantHardWarningCount: number;
  pairwiseDifference?: Record<string, number>;
  /**
   * درصد شباهت به برنامهٔ مبنا (Working Roster) روی پرسنل هدف (۰ تا ۱۰۰).
   * از فاز ۵ این عدد «ترجیح پایانی» تابع هدف است، نه معیار نخست رتبه‌بندی.
   */
  baselineSimilarityPercent?: number;
  /** درصد فاصله از برنامهٔ مبنا (مکمل شباهت) — مرزهای پذیرش روی همین عدد اعمال می‌شوند. */
  baselineDifferencePercent?: number;
  /** تعداد هشدارهای سطح A (بحرانی) — همان relevantHardWarningCount با نام صریح. */
  criticalWarningCount?: number;
  /**
   * تابع هدف کانونیِ فاز ۵ — **تنها مرجع رتبه‌بندی و پذیرش**.
   *
   * روی سناریوهای تولیدشده همیشه پر می‌شود. روی سناریوهای ذخیره‌شدهٔ پیش از فاز ۵
   * وجود ندارد (undefined) و همین، نشانهٔ نسخهٔ قدیمی است؛ `objectiveVersion`
   * این تفکیک را صریح می‌کند.
   */
  objective?: ScenarioObjective;
  /**
   * شناسهٔ نسخهٔ تابع هدفی که این سناریو با آن ساخته/رتبه‌بندی شده است.
   * سناریوهای قدیمیِ ذخیره‌شده بازنویسی نمی‌شوند؛ هنگام هیدراسیون فقط با نسخهٔ
   * legacy برچسب می‌خورند تا معنای امتیازشان با فاز ۵ اشتباه گرفته نشود.
   */
  objectiveVersion?: string;
  /** Freshness of persisted RequestQuality against the current request fingerprint. */
  requestQualityStatus?: 'CURRENT' | 'STALE' | 'LEGACY' | 'INVALID';
}

// «Mandatory Rest:» دیگر پیشوند سطح A نیست: مدل بار کاری فقط زنجیرهٔ وزنیِ
// «بیش از ۵» را غیرقانونی می‌داند (Max Consecutive). یادآور مرز پایان ماه
// دربارهٔ ماه آینده است و برنامهٔ قانونیِ ماه جاری را بحرانی نمی‌کند.
// (هم‌راستا با CRITICAL_WARNING_CODES در domain/warnings/schedule-warning.)
export const HARD_WARNING_PREFIXES = [
  'Coverage Shortage:',
  'Overstaffing:',
  'Missing Shift Leader:',
  'Max Consecutive:',
  'Night Rest:',
  'Supervisor/Staff E/N Restriction:',
  'Unknown Shift:',
  'Hard Constraint Violation:',
] as const;

export const HARD_WARNING_LABELS: Record<(typeof HARD_WARNING_PREFIXES)[number], string> = {
  'Coverage Shortage:': 'کمبود نیرو',
  'Overstaffing:': 'نیروی مازاد',
  'Missing Shift Leader:': 'نبود سرشیفت',
  'Max Consecutive:': 'نقض سقف شیفت متوالی',
  'Night Rest:': 'نقض استراحت شب',
  'Supervisor/Staff E/N Restriction:': 'ممنوعیت عصر/شب سرپرستار یا استاف',
  'Unknown Shift:': 'شیفت ناشناخته',
  'Hard Constraint Violation:': 'نقض محدودیت سخت',
};

export const MAX_ALLOWED_HARD_WARNINGS_PER_SCENARIO = 4;

export const SCENARIO_WEIGHTS: Record<ScenarioType, ScenarioWeights> = {
  REQUESTS: { request: 70, fairness: 20, optimization: 10 },
  FAIRNESS: { fairness: 70, request: 20, optimization: 10 },
  MIXED: { fairness: 45, request: 45, optimization: 10 },
};

export const SCENARIO_KEYS: Record<ScenarioType, ScenarioKey> = {
  REQUESTS: 'A',
  FAIRNESS: 'B',
  MIXED: 'C',
};

export const SCENARIO_TITLES: Record<ScenarioType, { title: string; shortTitle: string }> = {
  REQUESTS: { title: 'سناریو A · نزدیک‌ترین به مبنا', shortTitle: 'نزدیک‌ترین به مبنا' },
  FAIRNESS: { title: 'سناریو B · نزدیک به مبنا', shortTitle: 'نزدیک به مبنا' },
  MIXED: { title: 'سناریو C · گسترده‌تر', shortTitle: 'گسترده‌تر' },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const average = (values: number[]) => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const standardDeviation = (values: number[]) => {
  if (values.length <= 1) return 0;
  const mean = average(values);
  const variance = average(values.map(value => (value - mean) ** 2));
  return Math.sqrt(variance);
};

function balanceScore(values: number[], multiplier: number): number {
  if (values.length <= 1) return 100;
  const mean = average(values);
  const deviation = standardDeviation(values);
  if (mean === 0) {
    return deviation === 0 ? 100 : 0;
  }
  const normalized = deviation / Math.max(1, mean);
  return Number((100 * (1 - clamp(normalized * multiplier, 0, 1))).toFixed(2));
}

function targetGroupPersonnel(
  personnelList: readonly Personnel[],
  targetJobGroup?: JobGroup
): Personnel[] {
  return personnelList.filter(person => person.active && (!targetJobGroup || person.jobGroup === targetJobGroup));
}

function buildPersonnelNameMap(personnelList: readonly Personnel[]): Map<string, Personnel> {
  const nameMap = new Map<string, Personnel>();
  for (const person of personnelList) {
    nameMap.set(`${person.firstName} ${person.lastName}`, person);
  }
  return nameMap;
}

function warningTargetsGroup(
  warning: string,
  personnelList: readonly Personnel[],
  targetJobGroup: JobGroup
): boolean {
  const normalizedWarning = warning.replace('کمک بهیار', 'کمک‌بهیار');
  const mentionsAssistant = normalizedWarning.includes('کمک‌بهیار') || normalizedWarning.includes('بهیار');
  const mentionsNurse = normalizedWarning.includes('پرستار');
  const mentionsLeader = normalizedWarning.includes('سرشیفت');

  if (mentionsAssistant && !mentionsNurse) return targetJobGroup === 'assistant';
  if ((mentionsNurse || mentionsLeader) && !mentionsAssistant) return targetJobGroup === 'nurse';

  for (const person of personnelList) {
    const fullName = `${person.firstName} ${person.lastName}`;
    if (warning.includes(fullName)) {
      return person.jobGroup === targetJobGroup;
    }
  }

  return false;
}

function warningTargetsLockedPersonnel(
  warning: string,
  personnelList: readonly Personnel[],
  lockedRows?: ReadonlyArray<string> | ReadonlySet<string>
): boolean {
  if (!lockedRows) return false;
  const isLocked = (id: string) => 'has' in lockedRows ? lockedRows.has(id) : lockedRows.includes(id);
  for (const person of personnelList) {
    if (!isLocked(person.id)) continue;
    const fullName = `${person.firstName} ${person.lastName}`;
    if (warning.includes(fullName)) return true;
  }
  return false;
}

export function filterWarningsForScenarioGroup(
  warnings: readonly string[],
  personnelList: readonly Personnel[],
  targetJobGroup?: JobGroup,
  lockedRows?: ReadonlyArray<string> | ReadonlySet<string>
): string[] {
  return warnings.filter(warning => {
    // هشدارهای سناریویی که به پرسنل قفل‌شده اشاره دارند پنهان می‌شوند؛
    // برنامهٔ این نفرات از مبنا ارث‌بری می‌شود و در سناریو نباید دوباره مسئله‌ساز شود.
    if (warningTargetsLockedPersonnel(warning, personnelList, lockedRows)) return false;
    if (!targetJobGroup) return true;
    return warningTargetsGroup(warning, personnelList, targetJobGroup);
  });
}

/**
 * نسخهٔ ساخت‌یافتهٔ filterWarningsForScenarioGroup: همان گزارهٔ تاریخی روی
 * `warning.message` اعمال می‌شود تا نتیجهٔ فیلتر دقیقاً با نسخهٔ رشته‌ای یکی بماند،
 * اما هشدارهایی که جان می‌سپارند «فرادادهٔ ساخت‌یافتهٔ خود» را حفظ می‌کنند تا
 * مصرف‌کننده‌های پایین‌دستی (تعمیر هشدار بحرانی، طبقه‌بندی) دیگر متن را تجزیه
 * نکنند.
 *
 * NOTE / بازماندهٔ legacy: نسبت‌دادن هشدار به گروه کاری/پرسنلِ قفل‌شده در این
 * نسخهٔ میانی همچنان از روی متن نمایشی انجام می‌شود (پل سازگاری) — انتقال کامل
 * آن به فیلدهای ساخت‌یافته به جلسهٔ بعدی موکول شده است.
 */
export function filterStructuredWarningsForScenarioGroup(
  warnings: readonly ScheduleWarning[],
  personnelList: readonly Personnel[],
  targetJobGroup?: JobGroup,
  lockedRows?: ReadonlyArray<string> | ReadonlySet<string>
): ScheduleWarning[] {
  return warnings.filter(warning => {
    const locked = lockedRows
      ? ('has' in lockedRows
          ? (warning.personnelId ? lockedRows.has(warning.personnelId) : false)
          : (warning.personnelId ? lockedRows.includes(warning.personnelId) : false))
      : false;
    if (locked || warningTargetsLockedPersonnel(warning.message, personnelList, lockedRows)) return false;
    if (!targetJobGroup) return true;
    if (warning.jobGroup) return warning.jobGroup === targetJobGroup;
    if (warning.personnelId) {
      return personnelList.find(person => person.id === warning.personnelId)?.jobGroup === targetJobGroup;
    }
    return warningTargetsGroup(warning.message, personnelList, targetJobGroup);
  });
}

/**
 * طبقه‌بندی «هشدار سخت (سطح A)».
 *
 * - ورودی ساخت‌یافته (ScheduleWarning): بر اساس کد ماشینی — مسیر canonical.
 * - ورودی رشته‌ای (LEGACY): بر اساس پیشوندهای تاریخی — فقط برای سازگاری با
 *   مصرف‌کننده‌هایی که هنوز رشته در دست دارند (UI، ذخیره‌سازی، موارد قدیمی).
 *
 * هر دو مسیر همان مجموعهٔ هشدارهای سخت را بحرانی می‌دانند.
 */
export function isHardConstraintWarning(warning: string | ScheduleWarning): boolean {
  if (typeof warning !== 'string') {
    return isCriticalWarningCode(warning.code);
  }
  return HARD_WARNING_PREFIXES.some(prefix => warning.startsWith(prefix));
}

/**
 * پیشوندهای تاریخیِ هشدارهای صرفاً اطلاع‌رسانی (اصلاح‌های خودکار solver).
 *
 * قالب رشته‌ایِ ذخیره‌شده (MonthlySchedule.warnings: string[]) همان قرارداد
 * پیشوندیِ HARD_WARNING_PREFIXES را دارد: `OFF Removed: …` و
 * `Isolated Shift Fixed: …`. مدل ساخت‌یافته این دو را `info` می‌داند؛ این
 * فهرست همان طبقه‌بندی را برای رشته‌های legacy فراهم می‌کند.
 */
export const INFORMATIONAL_WARNING_PREFIXES = [
  'OFF Removed:',
  'Isolated Shift Fixed:',
] as const;

/**
 * طبقه‌بندی «هشدار صرفاً اطلاع‌رسانی».
 *
 * - ورودی ساخت‌یافته: بر اساس کد ماشینی (OFF_REMOVED / ISOLATED_SHIFT_FIXED).
 * - ورودی رشته‌ای (LEGACY): بر اساس پیشوند تاریخی متن.
 *
 * هر دو مسیر همان مجموعه را اطلاع‌رسانی می‌دانند؛ این هشدارها برای نمایش و
 * حسابرسی می‌مانند اما «نقص» نیستند و نباید در جریمهٔ امتیازدهی شمرده شوند.
 */
export function isInformationalWarning(warning: string | ScheduleWarning): boolean {
  if (typeof warning !== 'string') {
    return isInformationalWarningCode(warning.code);
  }
  return INFORMATIONAL_WARNING_PREFIXES.some(prefix => warning.startsWith(prefix));
}

/**
 * تعداد هشدارهایی که در امتیازدهی «نقص» به‌حساب می‌آیند: همهٔ هشدارها منهای
 * اطلاع‌رسانی‌های خودکار. هشدارهای بحرانی و تخلف‌های غیربحرانیِ واقعی همچنان
 * شمرده می‌شوند.
 */
export function countScoringDefectWarnings(warnings: readonly string[]): number {
  return warnings.filter(warning => !isInformationalWarning(warning)).length;
}

export function getHardConstraintWarnings(warnings: readonly string[]): string[] {
  return warnings.filter(isHardConstraintWarning);
}

export function countHardConstraintWarnings(warnings: readonly string[]): number {
  return getHardConstraintWarnings(warnings).length;
}

export function isHardWarningCountAcceptable(hardWarningCount: number): boolean {
  return hardWarningCount <= MAX_ALLOWED_HARD_WARNINGS_PER_SCENARIO;
}

function calculateRequestScore(
  schedule: MonthlySchedule
): Pick<ScenarioMetrics, 'requestScore' | 'requestSatisfiedWeight' | 'requestTotalWeight'> {
  // The ledger is the sole current authority. Missing artifacts mean
  // "not evaluated", never permission to reinterpret raw requests here.
  if (!schedule.requestQuality || !schedule.requestOutcomeLedger) {
    return { requestScore: 0, requestSatisfiedWeight: 0, requestTotalWeight: 0 };
  }
  const total = schedule.requestOutcomeLedger.outcomes.length;
  const requestScore = schedule.requestQuality.requestSatisfactionPercent;
  return {
    requestScore,
    requestSatisfiedWeight: Number(((requestScore / 100) * total).toFixed(2)),
    requestTotalWeight: total,
  };
}

/**
 * درصد رضایت از درخواست‌های پرسنل را به‌صورت خالص محاسبه می‌کند.
 *
 * در معماری مبنامحور، این عدد فقط به‌عنوان «tiebreaker پس‌زمینه» (اولویت ۴ تابع
 * هدف) استفاده می‌شود و هرگز در رابط کاربری نمایش داده نمی‌شود. تابع خالص است تا
 * توسط لایهٔ domain/scenarios/objective قابل مصرف باشد.
 */
export function calculateRequestSatisfactionPercent(
  schedule: MonthlySchedule,
  personnelList: readonly Personnel[],
  requests: readonly ShiftRequest[],
  year: number,
  month: number,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex: number | undefined,
  targetJobGroup?: JobGroup
): number {
  // Parameters are retained for API compatibility only; raw request structures
  // are intentionally not interpreted at this boundary.
  void personnelList;
  void requests;
  void year;
  void month;
  void customHolidays;
  void firstDayOfWeekIndex;
  void targetJobGroup;
  return calculateRequestScore(schedule).requestScore;
}

/**
 * تعداد سلول‌های کاری‌ای که با تگ روتین پرسنل هدف ناسازگارند. فقط پرسنل دارای
 * `workRoutine` شمارش می‌شوند؛ شیفت‌های OFF/مرخصی هرگز ناسازگاری روتین نیستند.
 */
export function countRoutineMismatches(
  schedule: MonthlySchedule,
  personnelList: readonly Personnel[],
  targetJobGroup?: JobGroup,
  totalDays?: number
): number {
  const relevant = targetGroupPersonnel(personnelList, targetJobGroup);
  let count = 0;
  for (const person of relevant) {
    if (!person.workRoutine) continue;
    const row = schedule.assignments[person.id] || {};
    const days = totalDays ?? Math.max(0, ...Object.keys(row).map(Number));
    for (let day = 1; day <= days; day++) {
      if (shiftViolatesRoutine(row[day], person.workRoutine)) count += 1;
    }
  }
  return count;
}

function calculateFairnessScore(
  schedule: MonthlySchedule,
  personnelList: readonly Personnel[],
  settings: SystemSettings,
  year: number,
  month: number,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex: number | undefined,
  monthlyDutyHours: any,
  targetJobGroup?: JobGroup
): Pick<ScenarioMetrics, 'fairnessScore' | 'averageDutyDeviationHours' | 'hourBalanceScore' | 'shiftBalanceScore' | 'holidayBalanceScore'> {
  const relevantPersonnel = targetGroupPersonnel(personnelList, targetJobGroup);
  if (relevantPersonnel.length <= 1) {
    return {
      fairnessScore: 100,
      averageDutyDeviationHours: 0,
      hourBalanceScore: 100,
      shiftBalanceScore: 100,
      holidayBalanceScore: 100,
    };
  }

  const reports = generatePersonnelReports(
    year,
    month,
    relevantPersonnel,
    schedule,
    settings,
    { ...customHolidays },
    firstDayOfWeekIndex,
    monthlyDutyHours
  );

  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const workedHours = reports.map(report => report.workedHours);
  const averageWorked = average(workedHours);
  const referenceDeviations = reports.map(report => {
    const reference = report.dutyHours > 0 ? report.dutyHours : averageWorked;
    return Math.abs(report.workedHours - reference);
  });

  const hourSpreadScore = balanceScore(workedHours, 1.45);
  const dutyClosenessScore = Number((100 * (1 - clamp(average(referenceDeviations) / 36, 0, 1))).toFixed(2));
  const hourBalanceScore = Number(((hourSpreadScore * 0.7) + (dutyClosenessScore * 0.3)).toFixed(2));

  const shiftBalanceScore = Number(([
    balanceScore(reports.map(report => report.mCount), 1.7),
    balanceScore(reports.map(report => report.eCount), 1.7),
    balanceScore(reports.map(report => report.nCount), 1.7),
  ].reduce((sum, score) => sum + score, 0) / 3).toFixed(2));

  const holidayBurdenCounts = relevantPersonnel.map(person => {
    let count = 0;
    const assignments = schedule.assignments[person.id] || {};
    for (let day = 1; day <= calendar.length; day++) {
      const assigned = assignments[day] || 'OFF';
      if ((calendar[day - 1].isHoliday || calendar[day - 1].isFriday) && assigned !== 'OFF' && !assigned.startsWith('L')) {
        count += 1;
      }
    }
    return count;
  });

  const holidayBalanceScore = balanceScore(holidayBurdenCounts, 1.9);
  const fairnessScore = Number((
    (hourBalanceScore * 0.45) +
    (shiftBalanceScore * 0.35) +
    (holidayBalanceScore * 0.2)
  ).toFixed(2));

  return {
    fairnessScore,
    averageDutyDeviationHours: Number(average(referenceDeviations).toFixed(2)),
    hourBalanceScore,
    shiftBalanceScore,
    holidayBalanceScore,
  };
}

function calculateOptimizationScore(
  schedule: MonthlySchedule,
  personnelList: readonly Personnel[],
  settings: SystemSettings,
  year: number,
  month: number,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex: number | undefined,
  monthlyDutyHours: any,
  targetJobGroup?: JobGroup
): Pick<
  ScenarioMetrics,
  | 'optimizationScore'
  | 'operationalEfficiencyScore'
  | 'warningQualityScore'
  | 'nonCriticalWarningDefectCount'
  | 'warningCount'
  | 'hardWarningCount'
> {
  const reports = generatePersonnelReports(
    year,
    month,
    targetGroupPersonnel(personnelList, targetJobGroup),
    schedule,
    settings,
    { ...customHolidays },
    firstDayOfWeekIndex,
    monthlyDutyHours
  );

  const meanDeviation = average(reports.map(report => {
    const reference = report.dutyHours > 0 ? report.dutyHours : average(reports.map(inner => inner.workedHours));
    return Math.abs(report.workedHours - reference);
  }));

  // اطلاع‌رسانی‌های خودکار (OFF Removed / Isolated Shift Fixed) تخلف نیستند و
  // در جریمهٔ امتیازدهی شمرده نمی‌شوند؛ خودشان برای نمایش/حسابرسی می‌مانند.
  const warningCount = countScoringDefectWarnings(schedule.warnings);
  const hardWarningCount = countHardConstraintWarnings(schedule.warnings);
  const warningScore = clamp(100 - ((warningCount * 6) + (hardWarningCount * 18)), 0, 100);
  const efficiencyScore = clamp(100 * (1 - clamp(meanDeviation / 28, 0, 1)), 0, 100);
  // LEGACY: ترکیب جریمهٔ هشدار و بهره‌وری. فرمول عیناً حفظ شده تا مقادیر تاریخی و
  // گزارش‌ها تغییر نکنند، اما تابع هدف کانونی فاز ۵ آن را مصرف نمی‌کند.
  const optimizationScore = Number(((warningScore * 0.65) + (efficiencyScore * 0.35)).toFixed(2));

  return {
    optimizationScore,
    // Tier 3 کانونی: بهره‌وری خالص، جدا شده از جریمهٔ هشدار.
    operationalEfficiencyScore: Number(efficiencyScore.toFixed(2)),
    warningQualityScore: Number(warningScore.toFixed(2)),
    // مرجع یکتای نقص هشداری غیربحرانی: نه اطلاع‌رسانی‌ها، نه بحرانی‌ها.
    nonCriticalWarningDefectCount: Math.max(0, warningCount - hardWarningCount),
    warningCount,
    hardWarningCount,
  };
}

function buildStrengthsAndWeaknesses(
  scenarioType: ScenarioType,
  requestScore: number,
  fairnessScore: number,
  optimizationScore: number,
  averageDutyDeviationHours: number,
  warningCount: number
): { strengths: string[]; weaknesses: string[]; analysis: string } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (requestScore >= 90) strengths.push('اجرای بسیار خوب درخواست‌های ثبت‌شده پرسنل');
  else if (requestScore >= 80) strengths.push('پوشش مناسب بخش عمده‌ای از درخواست‌های پرسنل');
  else weaknesses.push('در اجرای درخواست‌های ثبت‌شده هنوز ظرفیت بهبود وجود دارد');

  if (fairnessScore >= 90) strengths.push('توزیع بسیار متوازن شیفت‌ها و ساعات کاری بین افراد');
  else if (fairnessScore >= 80) strengths.push('عدالت قابل قبول در پخش شیفت‌ها و بار کاری');
  else weaknesses.push('اختلاف بار کاری یا توزیع شیفت‌ها هنوز محسوس است');

  if (optimizationScore >= 90) strengths.push('پاکیزگی عملیاتی بالا و کمترین اصطکاک در اجرای برنامه');
  else if (warningCount > 0) weaknesses.push('پیش از ورود به مقایسه نهایی باید هشدارهای باقی‌مانده رفع شوند');

  if (averageDutyDeviationHours > 18) {
    weaknesses.push('میانگین فاصله از ساعت موظفی بالاست و می‌تواند نارضایتی ایجاد کند');
  }

  const analysis = scenarioType === 'REQUESTS'
    ? 'این سناریو به‌صورت هدفمند رضایت از درخواست‌ها را در اولویت می‌گذارد و برای ماه‌هایی که خواسته‌های فردی اهمیت بیشتری دارند مناسب‌تر است.'
    : scenarioType === 'FAIRNESS'
      ? 'این سناریو بیشترین وزن را به عدالت در توزیع شیفت‌ها و ساعات می‌دهد و برای حفظ توازن تیمی گزینه‌ی مناسبی است.'
      : 'این سناریو تلاش می‌کند بین عدالت و اجرای درخواست‌ها تعادل برقرار کند و معمولاً برای تصمیم نهایی دید متوازن‌تری می‌دهد.';

  return { strengths, weaknesses, analysis };
}

export interface EvaluateScenarioOptions {
  id: number;
  type: ScenarioType;
  schedule: MonthlySchedule;
  personnelList: readonly Personnel[];
  requests: readonly ShiftRequest[];
  settings: SystemSettings;
  year: number;
  month: number;
  customHolidays: Readonly<Record<number, string>>;
  firstDayOfWeekIndex?: number;
  monthlyDutyHours?: any;
  targetJobGroup?: JobGroup;
}

export function evaluateScenarioSchedule(options: EvaluateScenarioOptions): ScoredSchedule {
  const {
    id,
    type,
    schedule,
    personnelList,
    requests,
    settings,
    year,
    month,
    customHolidays,
    firstDayOfWeekIndex,
    monthlyDutyHours,
    targetJobGroup,
  } = options;

  const canonicalMonth = canonicalizeRequestDaysForMonth(requests, {
    year,
    month,
    calendarDays: generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex),
    personnel: personnelList,
  });
  const requestSetFingerprint = buildRequestSetFingerprint(canonicalMonth);
  const requestOutcomeLedger = buildRequestOutcomeLedger({
    canonicalMonth,
    assignments: schedule.assignments,
    provenance: schedule.requestResolutionProvenance,
    requestSetFingerprint,
  });
  const requestQuality = buildRequestQualityFromLedger(requestOutcomeLedger);
  const requestWarnings = replaceRequestWarningsFromLedger(
    [],
    requestOutcomeLedger,
    new Map(personnelList.map(person => [person.id, `${person.firstName} ${person.lastName}`]))
  );
  const qualitySchedule: MonthlySchedule = {
    ...schedule,
    warnings: [
      ...schedule.warnings.filter(message => !message.startsWith('Mismatched Request:')),
      ...warningMessages(requestWarnings),
    ],
    requestOutcomeLedger,
    requestQuality,
    requestSetFingerprint,
  };

  const weights = SCENARIO_WEIGHTS[type];
  const requestMetrics = calculateRequestScore(qualitySchedule);
  const fairnessMetrics = calculateFairnessScore(
    qualitySchedule,
    personnelList,
    settings,
    year,
    month,
    customHolidays,
    firstDayOfWeekIndex,
    monthlyDutyHours,
    targetJobGroup
  );
  const optimizationMetrics = calculateOptimizationScore(
    qualitySchedule,
    personnelList,
    settings,
    year,
    month,
    customHolidays,
    firstDayOfWeekIndex,
    monthlyDutyHours,
    targetJobGroup
  );

  const satisfactionScore = Number(((requestMetrics.requestScore + fairnessMetrics.fairnessScore) / 2).toFixed(2));
  const weightedTotal = Number((
    (requestMetrics.requestScore * (weights.request / 100)) +
    (fairnessMetrics.fairnessScore * (weights.fairness / 100)) +
    (optimizationMetrics.optimizationScore * (weights.optimization / 100))
  ).toFixed(2));

  const insights = buildStrengthsAndWeaknesses(
    type,
    requestMetrics.requestScore,
    fairnessMetrics.fairnessScore,
    optimizationMetrics.optimizationScore,
    fairnessMetrics.averageDutyDeviationHours,
    optimizationMetrics.warningCount
  );

  const labels = SCENARIO_TITLES[type];

  return {
    id,
    scenarioKey: SCENARIO_KEYS[type],
    type,
    title: labels.title,
    shortTitle: labels.shortTitle,
    schedule: qualitySchedule,
    weights,
    metrics: {
      requestScore: requestMetrics.requestScore,
      fairnessScore: fairnessMetrics.fairnessScore,
      satisfactionScore,
      optimizationScore: optimizationMetrics.optimizationScore,
      operationalEfficiencyScore: optimizationMetrics.operationalEfficiencyScore,
      warningQualityScore: optimizationMetrics.warningQualityScore,
      nonCriticalWarningDefectCount: optimizationMetrics.nonCriticalWarningDefectCount,
      weightedTotal,
      requestSatisfiedWeight: requestMetrics.requestSatisfiedWeight,
      requestTotalWeight: requestMetrics.requestTotalWeight,
      averageDutyDeviationHours: fairnessMetrics.averageDutyDeviationHours,
      hourBalanceScore: fairnessMetrics.hourBalanceScore,
      shiftBalanceScore: fairnessMetrics.shiftBalanceScore,
      holidayBalanceScore: fairnessMetrics.holidayBalanceScore,
      warningCount: optimizationMetrics.warningCount,
      hardWarningCount: optimizationMetrics.hardWarningCount,
    },
    scoreA: optimizationMetrics.optimizationScore,
    scoreB: requestMetrics.requestScore,
    scoreC: fairnessMetrics.fairnessScore,
    totalScore: weightedTotal,
    strengths: insights.strengths,
    weaknesses: insights.weaknesses,
    analysis: insights.analysis,
    targetJobGroup,
    relevantWarningCount: schedule.warnings.length,
    relevantHardWarningCount: optimizationMetrics.hardWarningCount,
  };
}

export function evaluateSchedule(
  id: number,
  type: ScenarioType,
  schedule: MonthlySchedule,
  personnelList: readonly Personnel[],
  requests: readonly ShiftRequest[],
  settings: SystemSettings,
  warnings: string[],
  year: number,
  month: number,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex?: number,
  monthlyDutyHours?: any,
  targetJobGroup?: JobGroup
): ScoredSchedule {
  return evaluateScenarioSchedule({
    id,
    type,
    schedule: { ...schedule, warnings },
    personnelList,
    requests,
    settings,
    year,
    month,
    customHolidays,
    firstDayOfWeekIndex,
    monthlyDutyHours,
    targetJobGroup,
  });
}

export function calculateScenarioDifferencePercent(
  left: MonthlySchedule,
  right: MonthlySchedule,
  personnelIds: readonly string[],
  totalDays: number
): number {
  const totalCells = Math.max(1, personnelIds.length * totalDays);
  let changed = 0;

  for (const personnelId of personnelIds) {
    const leftAssignments = left.assignments[personnelId] || {};
    const rightAssignments = right.assignments[personnelId] || {};
    for (let day = 1; day <= totalDays; day++) {
      if ((leftAssignments[day] || 'OFF') !== (rightAssignments[day] || 'OFF')) {
        changed += 1;
      }
    }
  }

  return Number(((changed / totalCells) * 100).toFixed(2));
}

export function generateScoringReportText(scoredSchedules: ScoredSchedule[]): string {
  if (scoredSchedules.length === 0) {
    return 'هیچ سناریوی معتبری برای مقایسه تولید نشده است.';
  }

  const ranked = [...scoredSchedules].sort((left, right) => right.totalScore - left.totalScore);
  let report = '';

  for (const scenario of ranked) {
    report += `📋 ${scenario.title}\n`;
    report += `- امتیاز کل سیستم: ${scenario.totalScore.toFixed(2)}٪\n`;
    report += `- اجرای درخواست‌ها: ${scenario.metrics.requestScore.toFixed(2)}٪\n`;
    report += `- عدالت: ${scenario.metrics.fairnessScore.toFixed(2)}٪\n`;
    report += `- رضایت پرسنل: ${scenario.metrics.satisfactionScore.toFixed(2)}٪\n`;
    report += `- بهره‌وری داخلی: ${scenario.metrics.optimizationScore.toFixed(2)}٪\n`;
    if (scenario.strengths.length > 0) {
      report += `- نقاط قوت: ${scenario.strengths.join('، ')}\n`;
    }
    if (scenario.weaknesses.length > 0) {
      report += `- نقاط قابل بهبود: ${scenario.weaknesses.join('، ')}\n`;
    }
    report += `- تحلیل: ${scenario.analysis}\n\n`;
  }

  report += `🏆 پیشنهاد فعلی سیستم: ${ranked[0].title} با امتیاز ${ranked[0].totalScore.toFixed(2)}٪`;
  return report;
}
