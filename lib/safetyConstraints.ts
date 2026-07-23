/**
 * SafetyConstraints — Schedule Safety Evaluation (Pure Domain Module)
 *
 * RESPONSIBILITY:
 *   ارزیابی امنیت یک برنامهٔ شیفت‌بندی بر اساس چهار قانون سخت‌گیرانه:
 *     1. قانون تجمعی ۳۲ ساعته (Cumulative 32-Hour Rule)
 *     2. قانون استراحت بعد از شب‌کار (Sleep OFF Rule)
 *     3. قانون ضد شیفت مجزا (Anti-Single Shift Rule)
 *     4. آشکارساز مرخصی جاری/قطعی (Ongoing Leave Detector)
 *
 * DESIGN:
 *   - کاملاً خالص (Pure): بدون هیچ اثر جانبی، بدون وابستگی به React/Next/Browser.
 *   - قطعی (Deterministic): ورودی یکسان ← خروجی یکسان.
 *   - ماژولار: هر قانون یک تابع مستقل با خروجی ساخت‌یافته است.
 *   - Solver-Ready: قابل مصرف توسط موتور بهینه‌سازی هوش مصنوعی.
 *
 * @module lib/safetyConstraints
 */

import type { ShiftType, ShiftRequest } from './types';

// ============================================================================
// Constants & Helpers
// ============================================================================

/** سقف پیش‌فرض ساعات کاری تجمعی مجاز در یک زنجیرهٔ بدون OFF. */
export const MAX_CUMULATIVE_HOURS = 32;

/**
 * نگاشت پیش‌فرض مدت‌زمان هر شیفت به ساعت.
 * این مقدار هماهنگ با `SHIFT_HOURS` در `lib/solver.ts` است؛ برای تست یا لایه‌بندی
 * می‌توان نگاشت دیگری را از طریق گزینه‌ها ارسال کرد.
 */
export const DEFAULT_SHIFT_DURATION_HOURS: Readonly<Record<string, number>> = {
  M: 6.5,
  E: 6.5,
  N: 12.5,
  ME: 13.0,
  EN: 19.0,
  MN: 19.0,
  MEN: 25.5,
  OFF: 0.0,
  UNFILLED: 0.0,
};

/** کدهای شیفت که نمایانگر کار واقعی هستند (تک‌نوبته یا ترکیبی). */
const WORKING_SHIFT_CODES = ['M', 'E', 'N', 'ME', 'EN', 'MN', 'MEN'] as const;
const WORKING_SHIFT_SET: ReadonlySet<string> = new Set(WORKING_SHIFT_CODES);

/** کدهای شیفت که بخش شب را پوشش می‌دهند (نیازمند استراحت بعد از آن). */
const NIGHT_SHIFT_CODES = ['N', 'EN', 'MN', 'MEN'] as const;
const NIGHT_SHIFT_SET: ReadonlySet<string> = new Set(NIGHT_SHIFT_CODES);

/** وضعیت طبقه‌بندی‌شدهٔ یک روز برای یک پرسنل. */
export type ShiftWorkStatus = 'work' | 'off' | 'leave' | 'gap';

/**
 * دسته‌بندی یک شیفت به وضعیت کاری.
 *
 *   - 'work'  : شیفت کاری واقعی (M/E/N/ME/EN/MN/MEN)
 *   - 'off'   : روز استراحت (OFF)
 *   - 'leave' : مرخصی (L*)
 *   - 'gap'   : خانهٔ خالی، UNFILLED یا کد ناشناخته (غیر کاری)
 *
 * @pure
 */
export function classifyShift(shift: ShiftType | undefined): ShiftWorkStatus {
  if (shift === undefined || shift === 'UNFILLED') return 'gap';
  if (shift === 'OFF') return 'off';
  if (shift.startsWith('L')) return 'leave';
  if (WORKING_SHIFT_SET.has(shift)) return 'work';
  return 'gap';
}

/** آیا این شیفت کاری واقعی است؟ */
export function isWorkingShift(shift: ShiftType | undefined): boolean {
  return shift !== undefined && WORKING_SHIFT_SET.has(shift);
}

/** آیا این شیفت مرخصی است (با کد L شروع می‌شود)؟ */
export function isLeaveShift(shift: ShiftType | undefined): boolean {
  return shift !== undefined && shift.length > 0 && shift.startsWith('L');
}

/** آیا این شیفت روز استراحت قطعی (OFF) است؟ */
export function isOffShift(shift: ShiftType | undefined): boolean {
  return shift === 'OFF';
}

/** آیا این شیفت شامل بخش شب است (N/EN/MN/MEN)؟ */
export function shiftIncludesNight(shift: ShiftType | undefined): boolean {
  return shift !== undefined && NIGHT_SHIFT_SET.has(shift);
}

/**
 * مدت‌زمان یک شیفت به ساعت.
 * مرخصی‌ها (L*) به‌عنوان کار محسوب نمی‌شوند و صفر برمی‌گردند.
 *
 * @pure
 */
export function getShiftDurationHours(
  shift: ShiftType,
  durations: Readonly<Record<string, number>> = DEFAULT_SHIFT_DURATION_HOURS
): number {
  if (isLeaveShift(shift)) return 0;
  return durations[shift] ?? 0;
}

/**
 * خواندن امن شیفت یک روز؛ خارج از بازه یا روز غایب → undefined.
 * @pure
 */
function getShift(
  assignments: Readonly<Record<number, ShiftType>>,
  day: number
): ShiftType | undefined {
  return assignments[day];
}

/**
 * تعیین دامنهٔ روزهای بررسی: ترجیحاً از گزینه، در غیر این صورت از داده استنباط می‌شود.
 * @pure
 */
function resolveTotalDays(
  assignments: Readonly<Record<number, ShiftType>>,
  option: number | undefined
): number {
  if (option !== undefined && option > 0) return option;
  const days = Object.keys(assignments)
    .map(Number)
    .filter((n) => Number.isInteger(n));
  return days.length ? Math.max(...days) : 0;
}

// ============================================================================
// Common Options
// ============================================================================

/** گزینه‌های مشترک قوانین امنیتی. */
export interface SafetyConstraintOptions {
  /** سقف ساعات تجمعی مجاز در یک زنجیرهٔ بدون OFF (پیش‌فرض: MAX_CUMULATIVE_HOURS). */
  cumulativeHoursThreshold?: number;
  /** تعداد روزهای ماه (مرز بررسی). */
  totalDays?: number;
  /** نگاشت مدت‌زمان شیفت‌ها برای بازنویسی/تست. */
  shiftDurations?: Readonly<Record<string, number>>;
}

// ============================================================================
// Rule 1 — Cumulative 32-Hour Rule
// ============================================================================

/**
 * قانون تجمعی ۳۲ ساعته:
 *   ساعات کاری پیوسته در زنجیره‌ای از شیفت‌های پشت‌سرهم (بدون OFF) محاسبه می‌شود.
 *   اگر جمع یک زنجیره از سقف مجاز فراتر رود، یک OFF اجباری پیشنهاد می‌شود.
 *
 * زنجیره = بیشینهٔ روزهای کاری متوالی که با روز غیرکاری (OFF/مرخصی/خلأ) قطع می‌شود.
 */
export interface CumulativeHoursViolation {
  personnelId: string;
  /** روزهای شرکت‌کننده در زنجیرهٔ بیش از حد. */
  chainDays: number[];
  /** جمع ساعات کاری زنجیره. */
  cumulativeHours: number;
  /** سقف مجاز اعمال‌شده. */
  thresholdHours: number;
  /** مازاد ساعات نسبت به سقف. */
  excessHours: number;
  /** نخستین روزی که زنجیره را از سقف فراتر برد (باید OFF می‌بود). */
  mandatoryOffDay: number;
  /** پیام توصیفی فارسی. */
  message: string;
}

/**
 * آیا افزودن این شیفت به زنجیرهٔ فعلی، سقف ساعات تجمعی را نقض می‌کند؟
 * بلوک سازنده برای موتور زمان‌بندی.
 *
 * @pure
 */
export function wouldExceedCumulativeThreshold(
  currentChainHours: number,
  shiftHours: number,
  threshold: number = MAX_CUMULATIVE_HOURS
): boolean {
  return currentChainHours + shiftHours > threshold;
}

/**
 * شناسایی نقض‌های قانون تجمعی ۳۲ ساعته برای یک پرسنل.
 *
 * @pure
 */
export function detectCumulativeHourViolations(
  personnelId: string,
  assignments: Readonly<Record<number, ShiftType>>,
  options: SafetyConstraintOptions = {}
): CumulativeHoursViolation[] {
  const threshold = options.cumulativeHoursThreshold ?? MAX_CUMULATIVE_HOURS;
  const durations = options.shiftDurations ?? DEFAULT_SHIFT_DURATION_HOURS;
  const totalDays = resolveTotalDays(assignments, options.totalDays);

  const violations: CumulativeHoursViolation[] = [];
  let chainDays: number[] = [];
  let cumulative = 0;
  let mandatoryOffDay: number | null = null;

  const flush = () => {
    if (chainDays.length > 0 && cumulative > threshold && mandatoryOffDay !== null) {
      violations.push({
        personnelId,
        chainDays: [...chainDays],
        cumulativeHours: round1(cumulative),
        thresholdHours: threshold,
        excessHours: round1(cumulative - threshold),
        mandatoryOffDay,
        message:
          `نقض قانون تجمعی: زنجیرهٔ ${chainDays.length} روزه (روزهای ${chainDays[0]} تا ${chainDays[chainDays.length - 1]}) ` +
          `برای پرسنل ${personnelId} معادل ${round1(cumulative)} ساعت است ` +
          `(بیش از سقف ${threshold} ساعت). روز ${mandatoryOffDay} باید OFF اجباری باشد.`,
      });
    }
    chainDays = [];
    cumulative = 0;
    mandatoryOffDay = null;
  };

  for (let day = 1; day <= totalDays; day++) {
    const shift = getShift(assignments, day);
    if (!isWorkingShift(shift)) {
      flush();
      continue;
    }
    const hours = getShiftDurationHours(shift as ShiftType, durations);
    cumulative += hours;
    chainDays.push(day);
    // نخستین روزی که زنجیره از سقف فراتر می‌رود → کاندیدای OFF اجباری.
    if (cumulative > threshold && mandatoryOffDay === null) {
      mandatoryOffDay = day;
    }
  }
  flush();

  return violations;
}

// ============================================================================
// Rule 2 — Sleep OFF Rule (mandatory recovery after a Night shift)
// ============================================================================

/**
 * قانون استراحت بعد از شب‌کار:
 *   بلافاصله پس از هر شیفت دارای بخش شب (N/EN/MN/MEN)، روز بعد باید استراحت
 *   (OFF یا مرخصی/غیرکاری) باشد. کار در روز بعد = نقض.
 */
export interface NightRecoveryViolation {
  personnelId: string;
  /** روز شیفت شب. */
  nightShiftDay: number;
  nightShift: ShiftType;
  /** روز بعد که باید استراحت می‌بود. */
  followingDay: number;
  /** شیفت قرارگرفته در روز بعد (که نقض‌کننده است). */
  followingShift: ShiftType;
  message: string;
}

/**
 * شناسایی نقض‌های استراحت بعد از شب‌کار برای یک پرسنل.
 *
 * @pure
 */
export function detectNightRecoveryViolations(
  personnelId: string,
  assignments: Readonly<Record<number, ShiftType>>,
  options: Pick<SafetyConstraintOptions, 'totalDays'> = {}
): NightRecoveryViolation[] {
  const totalDays = resolveTotalDays(assignments, options.totalDays);
  const violations: NightRecoveryViolation[] = [];

  for (let day = 1; day <= totalDays; day++) {
    const shift = getShift(assignments, day);
    if (!shiftIncludesNight(shift)) continue;

    const nextShift = getShift(assignments, day + 1);
    // روز بعد باید غیرکاری باشد؛ کار در روز بعد نقض است.
    // مرخصی (L*) و OFF و خانهٔ خالی همگی به‌عنوان استراحت پذیرفته می‌شوند.
    if (isWorkingShift(nextShift)) {
      violations.push({
        personnelId,
        nightShiftDay: day,
        nightShift: shift as ShiftType,
        followingDay: day + 1,
        followingShift: nextShift as ShiftType,
        message:
          `نقض قانون استراحت بعد از شب‌کار: پرسنل ${personnelId} در روز ${day} شیفت شب ` +
          `(${shift}) داشته اما روز ${day + 1} شیفت کاری (${nextShift}) قرار گرفته است. ` +
          `بلافاصله بعد از شب‌کار باید OFF اجباری باشد.`,
      });
    }
  }

  return violations;
}

// ============================================================================
// Rule 3 — Anti-Single Shift Rule (detect isolated shifts)
// ============================================================================

/**
 * قانون ضد شیفت مجزا:
 *   شیفت‌های منزوی (یک روز کاری تک‌واحد میان روزهای غیرکاری) ناکارآمد هستند و
 *   تنها باید به‌عنوان راهکار آخر (fallback) در نظر گرفته شوند.
 */
export interface IsolatedShift {
  personnelId: string;
  /** روز شیفت مجزا. */
  day: number;
  shift: ShiftType;
  message: string;
}

/**
 * شناسایی شیفت‌های مجزا برای یک پرسنل.
 * یک شیفت مجزا = روز کاری که هم روز قبل و هم روز بعد غیرکاری است.
 *
 * @pure
 */
export function detectIsolatedShifts(
  personnelId: string,
  assignments: Readonly<Record<number, ShiftType>>,
  options: Pick<SafetyConstraintOptions, 'totalDays'> = {}
): IsolatedShift[] {
  const totalDays = resolveTotalDays(assignments, options.totalDays);
  const isolated: IsolatedShift[] = [];

  for (let day = 1; day <= totalDays; day++) {
    const shift = getShift(assignments, day);
    if (!isWorkingShift(shift)) continue;

    const prevIsRest = !isWorkingShift(getShift(assignments, day - 1));
    const nextIsRest = !isWorkingShift(getShift(assignments, day + 1));
    if (prevIsRest && nextIsRest) {
      isolated.push({
        personnelId,
        day,
        shift: shift as ShiftType,
        message:
          `شیفت مجزا: پرسنل ${personnelId} در روز ${day} تنها یک شیفت (${shift}) دارد که ` +
          `بین روزهای غیرکاری قرار گرفته است. این حالت باید صرفاً به‌عنوان راهکار آخر استفاده شود.`,
      });
    }
  }

  return isolated;
}

// ============================================================================
// Rule 4 — Ongoing Leave Detector
// ============================================================================

/**
 * آشکارساز مرخصی جاری/قطعی:
 *   مرخصی‌های تأییدشده و منتشرشده (حاضر در برنامه) «خط قرمز» سخت‌اند؛
 *   درخواست‌های مرخصی هنوزِ اعمال‌نشده «پیش‌نویس قابل‌تعدیل» محسوب می‌شوند.
 */

/** یک مرخصی قطعی/منتشرشده در برنامه (L* در تخصیص‌ها). */
export interface ConfirmedLeave {
  personnelId: string;
  day: number;
  /** کد مرخصی (مثلاً L1). */
  leaveCode: ShiftType;
  message: string;
}

/**
 * آشکارسازی مرخصی‌های قطعی/منتشرشده برای یک پرسنل.
 * این مرخصی‌ها از قبل در برنامه اعمال شده‌اند و خط قرمز سخت محسوب می‌شوند.
 *
 * @pure
 */
export function detectOngoingLeaves(
  personnelId: string,
  assignments: Readonly<Record<number, ShiftType>>
): ConfirmedLeave[] {
  const confirmed: ConfirmedLeave[] = [];
  for (const [dayStr, shift] of Object.entries(assignments)) {
    if (!isLeaveShift(shift)) continue;
    const day = Number(dayStr);
    if (!Number.isInteger(day)) continue;
    confirmed.push({
      personnelId,
      day,
      leaveCode: shift,
      message:
        `مرخصی قطعی: پرسنل ${personnelId} در روز ${day} مرخصی (${shift}) منتشرشده دارد ` +
        `که یک خط قرمز سخت است و نباید جابه‌جا شود.`,
    });
  }
  // ترتیب بر اساس روز برای خروجی پایدار و قطعی.
  confirmed.sort((a, b) => a.day - b.day);
  return confirmed;
}

/** نام مستعار برای هم‌خوانی با نام قانون. */
export const detectConfirmedLeaves = detectOngoingLeaves;

/** گزینه‌های طبقه‌بندی درخواست مرخصی. */
export interface LeaveClassificationOptions {
  /** آیا برنامه قفل شده است (requestsLocked یا finalized)؟ در این حالت درخواست‌ها سخت می‌شوند. */
  isScheduleLocked?: boolean;
  /** آیا این مرخصی از قبل در برنامه منتشر/اعمال شده است؟ قوی‌ترین خط قرمز. */
  isMaterialized?: boolean;
}

/** دلیل سخت یا نرم بودن یک درخواست مرخصی. */
export type LeaveConstraintReason =
  | 'materialized_in_schedule'
  | 'locked_schedule'
  | 'essential_request'
  | 'adjustable_draft';

/** نتیجهٔ طبقه‌بندی یک درخواست مرخصی به سخت/نرم. */
export interface LeaveRequestClassification {
  requestId: string;
  personnelId: string;
  isEssential: boolean;
  /** آیا این مرخصی خط قرمز سخت (غیرقابل تعدیل) است؟ */
  isHardConstraint: boolean;
  /** دلیل سخت/نرم بودن. */
  reason: LeaveConstraintReason;
  message: string;
}

/**
 * طبقه‌بندی یک درخواست مرخصی به‌عنوان «خط قرمز سخت» یا «پیش‌نویس قابل‌تعدیل».
 *
 *   تقدم (از سخت‌ترین): منتشرشده در برنامه ← قفل بودن برنامه ← ضروری بودن ← پیش‌نویس.
 *   هر موردی به‌جز «پیش‌نویس» یک خط قرمز سخت محسوب می‌شود.
 *
 * @pure
 */
export function classifyLeaveRequest(
  request: ShiftRequest,
  options: LeaveClassificationOptions = {}
): LeaveRequestClassification {
  const isEssential = request.isEssential === true;
  const isScheduleLocked = options.isScheduleLocked === true;
  const isMaterialized = options.isMaterialized === true;

  let reason: LeaveConstraintReason;
  if (isMaterialized) {
    reason = 'materialized_in_schedule';
  } else if (isScheduleLocked) {
    reason = 'locked_schedule';
  } else if (isEssential) {
    reason = 'essential_request';
  } else {
    reason = 'adjustable_draft';
  }

  const isHardConstraint = reason !== 'adjustable_draft';

  const message = isHardConstraint
    ? `مرخصی پرسنل ${request.personnelId} یک خط قرمز سخت است (${reasonLabel(reason)}) و قابل تعدیل نیست.`
    : `مرخصی پرسنل ${request.personnelId} یک پیش‌نویس قابل‌تعدیل است.`;

  return {
    requestId: request.id,
    personnelId: request.personnelId,
    isEssential,
    isHardConstraint,
    reason,
    message,
  };
}

/**
 * آیا یک درخواست مرخصی خط قرمز سخت است؟ (نسخهٔ بولی برای راحتی.)
 *
 * @pure
 */
export function isLeaveHardConstraint(
  request: ShiftRequest,
  options: LeaveClassificationOptions = {}
): boolean {
  return classifyLeaveRequest(request, options).isHardConstraint;
}

// ============================================================================
// Aggregators
// ============================================================================

/** گزارش ترکیبی امنیت یک پرسنل از همهٔ قوانین. */
export interface PersonnelSafetyReport {
  personnelId: string;
  cumulativeHourViolations: CumulativeHoursViolation[];
  nightRecoveryViolations: NightRecoveryViolation[];
  isolatedShifts: IsolatedShift[];
  confirmedLeaves: ConfirmedLeave[];
  /** مجموع نقض‌های سخت (قانون ۱، ۲ و مرخصی قطعی). */
  totalHardViolations: number;
  /** تعداد هشدارهای نرم (شیفت مجزا). */
  totalSoftWarnings: number;
}

/**
 * ارزیابی کامل امنیت برنامهٔ یک پرسنل با همهٔ قوانین.
 *
 * @pure
 */
export function evaluatePersonnelSafety(
  personnelId: string,
  assignments: Readonly<Record<number, ShiftType>>,
  options: SafetyConstraintOptions = {}
): PersonnelSafetyReport {
  const cumulativeHourViolations = detectCumulativeHourViolations(personnelId, assignments, options);
  const nightRecoveryViolations = detectNightRecoveryViolations(personnelId, assignments, options);
  const isolatedShifts = detectIsolatedShifts(personnelId, assignments, options);
  const confirmedLeaves = detectOngoingLeaves(personnelId, assignments);

  return {
    personnelId,
    cumulativeHourViolations,
    nightRecoveryViolations,
    isolatedShifts,
    confirmedLeaves,
    totalHardViolations:
      cumulativeHourViolations.length + nightRecoveryViolations.length + confirmedLeaves.length,
    totalSoftWarnings: isolatedShifts.length,
  };
}

/**
 * ارزیابی کامل امنیت کل برنامه (همهٔ پرسنل).
 *
 * @pure
 */
export function evaluateScheduleSafety(
  assignmentsByPersonnel: Readonly<Record<string, Record<number, ShiftType>>>,
  options: SafetyConstraintOptions = {}
): PersonnelSafetyReport[] {
  return Object.keys(assignmentsByPersonnel).map((personnelId) =>
    evaluatePersonnelSafety(personnelId, assignmentsByPersonnel[personnelId], options)
  );
}

// ============================================================================
// Boundary Continuity — cross-month transitions (Task 4)
// ============================================================================

/**
 * پیوستگی در مرز ماه‌ها:
 *   با ادغام ۱ تا ۲ روز انتهای ماه قبل (از prevMonthKey در S3)، قوانین تجمعی ۳۲ ساعت
 *   و استراحت بعد از شب‌کار در مرز گذر ماه بررسی می‌شوند.
 */

/** نتیجهٔ بررسی پیوستگی مرز ماه برای یک پرسنل. */
export interface BoundaryContinuityResult {
  personnelId: string;
  /** نقض‌های قانون تجمعی ۳۲ ساعت که از ماه قبل ادامه پیدا کرده‌اند. */
  cumulativeHourViolations: CumulativeHoursViolation[];
  /** نقض‌های قانون استراحت بعد از شب‌کار در مرز ماه. */
  nightRecoveryViolations: NightRecoveryViolation[];
}

/**
 * استخراج N روز انتهای ماه قبل (قدیمی‌ترین ← جدیدترین) از تخصیص‌های ماه قبل.
 * روزهای غایب به‌عنوان OFF در نظر گرفته می‌شوند.
 *
 * @pure
 */
export function extractPrevMonthTail(
  prevAssignments: Readonly<Record<number, ShiftType>>,
  tailDays: number = 2
): ShiftType[] {
  if (tailDays <= 0) return [];
  const days = Object.keys(prevAssignments)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (!days.length) return [];
  const maxDay = Math.max(...days);
  const start = Math.max(1, maxDay - tailDays + 1);
  const tail: ShiftType[] = [];
  for (let d = start; d <= maxDay; d++) {
    tail.push(prevAssignments[d] ?? 'OFF');
  }
  return tail;
}

/**
 * بررسی قوانین تجمعی ۳۲ ساعت و استراحت بعد از شب‌کار در مرز گذر دو ماه.
 *
 * @param personnelId شناسه پرسنل
 * @param currentAssignments تخصیص‌های ماه جاری
 * @param prevTail ۱ تا ۲ روز انتهای ماه قبل (قدیمی‌ترین ← جدیدترین) — از extractPrevMonthTail
 *
 * @pure
 */
export function checkBoundaryContinuity(
  personnelId: string,
  currentAssignments: Readonly<Record<number, ShiftType>>,
  prevTail: ReadonlyArray<ShiftType>,
  options: SafetyConstraintOptions = {}
): BoundaryContinuityResult {
  const threshold = options.cumulativeHoursThreshold ?? MAX_CUMULATIVE_HOURS;
  const durations = options.shiftDurations ?? DEFAULT_SHIFT_DURATION_HOURS;

  // ---- Sleep OFF across boundary: آخرین روز ماه قبل شب‌کار بود؟ ----
  const nightRecoveryViolations: NightRecoveryViolation[] = [];
  const lastPrevShift = prevTail.length ? prevTail[prevTail.length - 1] : undefined;
  if (shiftIncludesNight(lastPrevShift)) {
    const firstShift = getShift(currentAssignments, 1);
    if (isWorkingShift(firstShift)) {
      nightRecoveryViolations.push({
        personnelId,
        // روز 0 به‌معنای «آخرین روز ماه قبل» است.
        nightShiftDay: 0,
        nightShift: lastPrevShift as ShiftType,
        followingDay: 1,
        followingShift: firstShift as ShiftType,
        message:
          `نقض استراحت بعد از شب‌کار در مرز ماه: پرسنل ${personnelId} آخرین روز ماه قبل ` +
          `شیفت شب (${lastPrevShift}) داشته اما روز ۱ ماه جاری شیفت کاری (${firstShift}) قرار گرفته است.`,
      });
    }
  }

  // ---- Cumulative 32h across boundary: زنجیرهٔ کاری پیوسته از ماه قبل ----
  const cumulativeHourViolations: CumulativeHoursViolation[] = [];

  // زنجیرهٔ انتهایی ماه قبل (روزهای کاری متوالی که به روز آخر ختم می‌شوند).
  let prevChainHours = 0;
  let prevChainLen = 0;
  for (let i = prevTail.length - 1; i >= 0; i--) {
    if (!isWorkingShift(prevTail[i])) break;
    prevChainHours += getShiftDurationHours(prevTail[i] as ShiftType, durations);
    prevChainLen++;
  }

  // زنجیرهٔ ابتدایی ماه جاری (روزهای کاری متوالی از روز ۱).
  const currentTotalDays = resolveTotalDays(currentAssignments, options.totalDays);
  const leadingDays: number[] = [];
  for (let d = 1; d <= currentTotalDays; d++) {
    const s = getShift(currentAssignments, d);
    if (!isWorkingShift(s)) break;
    leadingDays.push(d);
  }

  // تنها زمانی یک زنجیرهٔ مرزی شکل می‌گیرد که ماه قبل به کار ختم شود و روز ۱ هم کاری باشد.
  if (prevChainLen > 0 && leadingDays.length > 0) {
    let totalHours = prevChainHours;
    for (const day of leadingDays) {
      totalHours += getShiftDurationHours(getShift(currentAssignments, day) as ShiftType, durations);
    }
    if (totalHours > threshold) {
      // نخستین روز ماه جاری که تجمع (ماه قبل + تا این روز) را از سقف فراتر می‌برد.
      let acc = prevChainHours;
      let mandatoryOffDay = leadingDays[0];
      for (const day of leadingDays) {
        acc += getShiftDurationHours(getShift(currentAssignments, day) as ShiftType, durations);
        if (acc > threshold) {
          mandatoryOffDay = day;
          break;
        }
      }
      cumulativeHourViolations.push({
        personnelId,
        chainDays: [...leadingDays],
        cumulativeHours: round1(totalHours),
        thresholdHours: threshold,
        excessHours: round1(totalHours - threshold),
        mandatoryOffDay,
        message:
          `نقض قانون تجمعی در مرز ماه: ${prevChainLen} روز انتهای ماه قبل + ${leadingDays.length} روز ` +
          `ابتدای ماه جاری برای پرسنل ${personnelId} در مجموع ${round1(totalHours)} ساعت است ` +
          `(بیش از سقف ${threshold}). روز ${mandatoryOffDay} ماه جاری باید OFF اجباری باشد.`,
      });
    }
  }

  return { personnelId, cumulativeHourViolations, nightRecoveryViolations };
}

// ============================================================================
// Internal utilities
// ============================================================================

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function reasonLabel(reason: LeaveConstraintReason): string {
  switch (reason) {
    case 'materialized_in_schedule':
      return 'منتشرشده در برنامه';
    case 'locked_schedule':
      return 'قفل بودن برنامه';
    case 'essential_request':
      return 'ضروری بودن درخواست';
    case 'adjustable_draft':
      return 'پیش‌نویس قابل‌تعدیل';
  }
}
