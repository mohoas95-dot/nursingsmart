/**
 * Structured Warning Model — Domain Layer (Pure Types & Functions)
 *
 * چرا این مدل وجود دارد؟
 *   تا پیش از این، هشدارها فقط به‌صورت رشتهٔ نمایشی فارسی نگهداری می‌شدند و کدهای
 *   مصرف‌کنندهٔ ماشینی (طبقه‌بندی بحرانی، تعمیر سناریو، استخراج روز/شیفت/پرسنل)
 *   مجبور بودند با regex و جست‌وجوی نام از درون همان متن نمایشی داده استخراج کنند.
 *   این قرارداد شکننده بود: هر تغییر در «متن نمایش» می‌توانست منطق ماشینی را بشکند.
 *
 * اصل بنیادین این مدل:
 *   دادهٔ ماشینی از متن نمایشی استخراج نمی‌شود؛ هر دو از یک مبدأ ساخته می‌شوند:
 *
 *     ScheduleWarning
 *        ├── code / severity / day / shift / personnelId / jobGroup / metadata
 *        └── message  (متن فارسیِ قابل‌نمایش — دادهٔ نمایشیِ محض)
 *
 * جهتِ مجاز تبدیل فقط این است:
 *
 *     structured warning  ──►  human-readable message   (نمایش/لاگ)
 *
 * و هرگز برعکس نه:  message ──regex──► structured.
 *
 * PURE: بدون وابستگی به React، Next.js یا I/O.
 */

import type { JobGroup, ShiftType } from '../../lib/types';

// ---------------------------------------------------------------------------
// کد هشدار — شناسهٔ ماشینیِ نوع هشدار
// ---------------------------------------------------------------------------

/**
 * شناسهٔ ماشینیِ انواع هشداری که موتور زمان‌بندی امروز تولید می‌کند.
 *
 * نگاشت ۱:۱ با پیشوندهای تاریخیِ رشته‌ها (فقط برای سازگاری نمایشی نگه‌داشته می‌شود):
 *
 *   | code                  | پیشوند تاریخی متن         |
 *   |-----------------------|---------------------------|
 *   | COVERAGE_SHORTAGE     | `Coverage Shortage:`      |
 *   | OVERSTAFFING          | `Overstaffing:`           |
 *   | MISSING_SHIFT_LEADER  | `Missing Shift Leader:`   |
 *   | MAX_CONSECUTIVE       | `Max Consecutive:`        |
 *   | MANDATORY_REST        | `Mandatory Rest:`         |
 *   | NIGHT_REST            | `Night Rest:`             |
 *   | SUPERVISOR_STAFF_EN_RESTRICTION | `Supervisor/Staff E/N Restriction:` |
 *   | UNKNOWN_SHIFT         | `Unknown Shift:`          |
 *   | HARD_CONSTRAINT_VIOLATION | `Hard Constraint Violation:` |
 *   | MISMATCHED_REQUEST    | `Mismatched Request:`     |
 *   | CONSECUTIVE_OFFS      | `Consecutive OFFs:`       |
 *   | LEAVE_CONTINUITY      | `Leave Continuity:`       |
 *   | ISOLATED_SHIFT        | `Isolated Shift:`         |
 *   | ISOLATED_SHIFT_FIXED  | `Isolated Shift Fixed:`   |
 *   | OFF_REMOVED           | `OFF Removed:`            |
 *
 * کدِ `HARD_CONSTRAINT_CONFLICT` تازه است و پیشوند تاریخی ندارد: زمانی تولید
 * می‌شود که یک قاعدهٔ کم‌اولویت‌تر (شکستن آفِ متوالی، یا یک درخواست شیفت صریح)
 * به‌دلیل برخورد با یک محدودیت سخت اعمال نشده باشد. این هشدار «تعارض قوانین» را
 * صریح می‌کند تا هیچ محدودیت سختی در سکوت نقض یا نادیده گرفته نشود.
 */
export type ScheduleWarningCode =
  | 'COVERAGE_SHORTAGE'
  | 'OVERSTAFFING'
  | 'MISSING_SHIFT_LEADER'
  | 'MAX_CONSECUTIVE'
  | 'MANDATORY_REST'
  | 'NIGHT_REST'
  | 'SUPERVISOR_STAFF_EN_RESTRICTION'
  | 'UNKNOWN_SHIFT'
  | 'HARD_CONSTRAINT_VIOLATION'
  | 'MISMATCHED_REQUEST'
  | 'CONSECUTIVE_OFFS'
  | 'LEAVE_CONTINUITY'
  | 'ISOLATED_SHIFT'
  | 'ISOLATED_SHIFT_FIXED'
  | 'OFF_REMOVED'
  | 'HARD_CONSTRAINT_CONFLICT'
  | 'OVERTIME_CAP_EXCEEDED';

// ---------------------------------------------------------------------------
// شدت هشدار
// ---------------------------------------------------------------------------

/**
 * شدت هشدار:
 *  - `critical`: هشدار سطح A (بحرانی/سخت) — دقیقاً همان مجموعه‌ای که امروز با
 *    `HARD_WARNING_PREFIXES` در lib/scoring شناخته می‌شود. سیاست «کدام هشدارها
 *    بحرانی‌اند» در این بازنماایی تغییر نکرده است.
 *  - `warning`:  تخلفِ قابل‌توجه اما غیربحرانی (مثلاً ناهماهنگی با درخواست).
 *  - `info`:     صرفاً اطلاع‌رسانیِ اصلاح خودکارِ solver (مثل حذف OFF یا جابه‌جایی
 *    شیفت تک)؛ تخلفی گزارش نمی‌کند.
 */
export type ScheduleWarningSeverity = 'critical' | 'warning' | 'info';

// ---------------------------------------------------------------------------
// هشدار ساخت‌یافته
// ---------------------------------------------------------------------------

/**
 * یک هشدار زمان‌بندی با دادهٔ ماشینیِ صریح.
 *
 * فیلدهای ساخت‌یافته (day / shift / personnelId / ...) «منبع حقیقت» برای منطق
 * ماشینی‌اند. `message` فقط برای نمایش به کاربر و سازگاری با ذخیره‌سازی فعلی
 * (MonthlySchedule.warnings: string[]) نگه‌داری می‌شود.
 */
export interface ScheduleWarning {
  /** شناسهٔ ماشینیِ نوع هشدار. */
  code: ScheduleWarningCode;
  /** شدت هشدار (بحرانی/عادی/اطلاع‌رسانی). */
  severity: ScheduleWarningSeverity;
  /**
   * متن نمایشی (فارسی) — دادهٔ نمایشیِ محض.
   * هیچ منطق ماشینی حق ندارد از این رشته داده استخراج کند.
   */
  message: string;
  /** روز ماه که هشدار به آن مربوط است (در صورت وجود). */
  day?: number;
  /**
   * روز پایانی برای هشدارهای بازه‌ای مثل Consecutive OFFs و Max Consecutive
   * (day = شروع بازه، endDay = پایان بازه).
   */
  endDay?: number;
  /** شیفت/مؤلفهٔ مرتبط — مثل 'M' | 'E' | 'N' یا ShiftType ترکیبی (در صورت وجود). */
  shift?: ShiftType;
  /** پرسنل مرتبط — با شناسه، نه با نامِ داخل متن (در صورت وجود). */
  personnelId?: string;
  /** گروه کاری مرتبط — برای هشدارهای پوشش (در صورت وجود). */
  jobGroup?: JobGroup;
  /** فرادادهٔ تکمیلیِ ماشین‌خوان (تعداد کمبود، طول بازه، نوبت و ...). */
  metadata?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// طبقه‌بندی بحرانی — بر اساس کد، نه پیشوند متن
// ---------------------------------------------------------------------------

/**
 * کدهای سطح A (بحرانی) — دقیقاً معادل مجموعهٔ HARD_WARNING_PREFIXES در lib/scoring.
 *
 * این فهرست با `HARD_WARNING_PREFIXES` هم‌راستا است. نقض‌های جدیدی که همان
 * shared hard evaluator تشخیص می‌دهد نیز بحرانی‌اند تا سناریوها آن‌ها را نادیده نگیرند.
 *
 * `MANDATORY_REST` عمداً بحرانی نیست: مدل بار کاری فقط زنجیرهٔ وزنیِ «بیش از ۵»
 * را غیرقانونی می‌داند و آن تخلف با `MAX_CONSECUTIVE` گزارش می‌شود. یادآورِ مرز
 * پایان ماه (endsMonthAtCapWithoutRest) دربارهٔ «ابتدای ماه آینده» است و یک
 * برنامهٔ قانونیِ ماه جاری را نباید critical-invalid کند؛ به‌عنوان هشدار
 * غیربحرانی برای گزارش‌دهی حفظ می‌شود.
 */
export const CRITICAL_WARNING_CODES: readonly ScheduleWarningCode[] = [
  'COVERAGE_SHORTAGE',
  'OVERSTAFFING',
  'MISSING_SHIFT_LEADER',
  'MAX_CONSECUTIVE',
  'NIGHT_REST',
  'SUPERVISOR_STAFF_EN_RESTRICTION',
  'UNKNOWN_SHIFT',
  'HARD_CONSTRAINT_VIOLATION',
];

/** آیا این کد، هشدار سطح A (بحرانی) است؟ — معیار ماشینی، بدون نگاه به متن. */
export function isCriticalWarningCode(code: ScheduleWarningCode): boolean {
  return CRITICAL_WARNING_CODES.includes(code);
}

/**
 * کدهای صرفاً اطلاع‌رسانی (severity = info): اصلاح‌های خودکار solver که هیچ
 * تخلفی گزارش نمی‌کنند. برای نمایش/حسابرسی حفظ می‌شوند اما نباید به‌عنوان
 * «نقص» در امتیازدهی/رتبه‌بندی شمرده شوند.
 */
export const INFORMATIONAL_WARNING_CODES: readonly ScheduleWarningCode[] = [
  'ISOLATED_SHIFT_FIXED',
  'OFF_REMOVED',
];

/** آیا این کد صرفاً اطلاع‌رسانی است؟ */
export function isInformationalWarningCode(code: ScheduleWarningCode): boolean {
  return INFORMATIONAL_WARNING_CODES.includes(code);
}

/** شدتِ پیش‌فرضِ هر کد (نگهداری متمرکز نگاشت code → severity). */
export function defaultSeverityForCode(code: ScheduleWarningCode): ScheduleWarningSeverity {
  if (isCriticalWarningCode(code)) return 'critical';
  if (isInformationalWarningCode(code)) return 'info';
  // HARD_CONSTRAINT_CONFLICT عمداً بحرانی نیست: محدودیت سخت رعایت شده و چیزی
  // نقض نشده؛ فقط یک قاعدهٔ کم‌اولویت‌تر اعمال‌نشدنی بوده است. بحرانی‌کردن آن
  // سیاست طبقه‌بندی سطح A و رتبه‌بندی سناریوها را تغییر می‌داد.
  return 'warning';
}

// ---------------------------------------------------------------------------
// سازندهٔ هشدار
// ---------------------------------------------------------------------------

/**
 * ساخت یک هشدار ساخت‌یافته. اگر severity داده نشود، از نگاشتِ پیش‌فرضِ کد
 * استفاده می‌شود (کدهای hard-rule → critical؛ اصلاح‌های خودکار solver → info).
 */
export function createScheduleWarning(
  input: Omit<ScheduleWarning, 'severity'> & { severity?: ScheduleWarningSeverity }
): ScheduleWarning {
  const { severity, ...rest } = input;
  return { severity: severity ?? defaultSeverityForCode(rest.code), ...rest };
}

// ---------------------------------------------------------------------------
// طبقه‌بندی روی هشدارهای ساخت‌یافته (مسیر canonical)
// ---------------------------------------------------------------------------

/** آیا این هشدار سطح A (بحرانی) است؟ — فقط بر اساس code. */
export function isCriticalScheduleWarning(warning: ScheduleWarning): boolean {
  return isCriticalWarningCode(warning.code);
}

/** فهرست هشدارهای سطح A از میان هشدارهای ساخت‌یافته. */
export function getCriticalScheduleWarnings(
  warnings: ReadonlyArray<ScheduleWarning>
): ScheduleWarning[] {
  return warnings.filter(isCriticalScheduleWarning);
}

/** تعداد هشدارهای سطح A از میان هشدارهای ساخت‌یافته. */
export function countCriticalScheduleWarnings(
  warnings: ReadonlyArray<ScheduleWarning>
): number {
  return getCriticalScheduleWarnings(warnings).length;
}

/** آیا حداقل یک هشدار سطح A در میان هشدارهای ساخت‌یافته وجود دارد؟ */
export function hasCriticalScheduleWarning(
  warnings: ReadonlyArray<ScheduleWarning>
): boolean {
  return countCriticalScheduleWarnings(warnings) > 0;
}

// ---------------------------------------------------------------------------
// جهتِ سازگاری: structured ──► message  (تنها جهتِ مجاز)
// ---------------------------------------------------------------------------

/**
 * استخراج متن‌های نمایشی از هشدارهای ساخت‌یافته — برای نمایش در UI و نگهداشت در
 * قالب ذخیره‌سازی فعلی (string[]). جهتِ معکوس (استخراج داده از متن) غیرمجاز است.
 */
export function warningMessages(warnings: ReadonlyArray<ScheduleWarning>): string[] {
  return warnings.map(warning => warning.message);
}

/**
 * حذف تکراری‌ها بر اساس متن نمایشی (اولین وقوع نگه داشته می‌شود) — معادلِ
 * رفتار تاریخیِ `Array.from(new Set(warnings))` روی رشته‌ها، با این تضمین که
 * خروجیِ structured با خروجیِ رشته‌ای ۱:۱ و هم‌تراز می‌ماند.
 */
export function dedupeScheduleWarningsByMessage(
  warnings: ReadonlyArray<ScheduleWarning>
): ScheduleWarning[] {
  const seen = new Set<string>();
  const result: ScheduleWarning[] = [];
  for (const warning of warnings) {
    if (seen.has(warning.message)) continue;
    seen.add(warning.message);
    result.push(warning);
  }
  return result;
}
