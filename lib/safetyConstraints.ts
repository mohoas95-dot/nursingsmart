// lib/safetyConstraints.ts - ارزیابی محدودیت‌های ایمنی برنامه‌ریزی شیفت
//
// این ماژول خالص TypeScript است و هیچ وابستگی به React، Next.js یا مرورگر ندارد.
// می‌تواند توسط هر موتور بهینه‌سازی یا سرور مستقل فراخوانده شود.

import type { Personnel, ShiftType, MonthlySchedule, ShiftRequest } from './types';

// ============================================================================
// Public Types
// ============================================================================

/** شناسه قانون ایمنی */
export type SafetyRule =
  | 'CUMULATIVE_32H'        // قانون ۳۲ ساعت تجمعی متوالی
  | 'SLEEP_OFF_AFTER_NIGHT' // استراحت اجباری بعد از شیفت شب
  | 'SINGLE_SHIFT_ISOLATED' // شیفت تک‌تنها بین دو آف (آخرین گزینه)
  | 'ONGOING_LEAVE';        // مرخصی در حال اجرا

/** یک نقض ایمنی شناسایی‌شده */
export interface SafetyViolation {
  personnelId: string;
  /** روز اصلی نقض (از ۱) */
  day: number;
  rule: SafetyRule;
  /** hard = خط قرمز / soft = هشدار قابل مذاکره */
  severity: 'hard' | 'soft';
  /** پیام فارسی برای نمایش به کاربر */
  message: string;
  /** تمام روزهایی که این نقض را تشکیل می‌دهند */
  affectedDays: number[];
}

/** آف اجباری ناشی از نقض ایمنی */
export interface MandatoryOff {
  personnelId: string;
  day: number;
  reason: string;
}

/** شیفت تک‌تنها ایزوله */
export interface SingleShiftFlag {
  personnelId: string;
  day: number;
  shift: ShiftType;
}

/** طبقه‌بندی مرخصی */
export interface LeaveClassification {
  personnelId: string;
  day: number;
  shift: ShiftType;
  /** confirmed = تایید شده / قرمز — draft = درخواست قابل تنظیم */
  type: 'confirmed' | 'draft';
}

/** خروجی بررسی ایمنی یک پرسنل */
export interface SafetyCheckResult {
  violations: SafetyViolation[];
  mandatoryOffs: MandatoryOff[];
  singleShiftFlags: SingleShiftFlag[];
  leaveClassifications: LeaveClassification[];
  isClean: boolean;
  hardViolationCount: number;
  softViolationCount: number;
}

/** خلاصه ایمنی کل برنامه */
export interface ScheduleSafetySummary {
  totalHardViolations: number;
  totalSoftViolations: number;
  personnelWithHardViolations: string[];
  allMandatoryOffs: MandatoryOff[];
  allSingleShiftFlags: SingleShiftFlag[];
  confirmedLeaveCount: number;
  draftLeaveCount: number;
  isFullyClean: boolean;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/** ساعات کاری هر نوع شیفت */
function getShiftHours(shift: ShiftType): number {
  if (!shift || shift === 'OFF' || shift === 'UNFILLED' || shift.startsWith('L')) return 0;
  if (shift === 'M' || shift === 'E' || shift === 'N') return 8;
  if (shift === 'ME' || shift === 'EN' || shift === 'MN') return 16;
  if (shift === 'MEN') return 24;
  return 0;
}

/** آیا این شیفت شامل نوبت شب است؟ */
function includesNightShift(shift: ShiftType): boolean {
  return shift === 'N' || shift === 'EN' || shift === 'MN' || shift === 'MEN';
}

/** آیا این شیفت یک شیفت کاری تک‌بخشی است؟ */
function isSinglePartShift(shift: ShiftType): boolean {
  return shift === 'M' || shift === 'E' || shift === 'N';
}

/** آیا این شیفت یک روز آف یا خالی است؟ */
function isOff(shift: ShiftType | undefined): boolean {
  return !shift || shift === 'OFF' || shift === 'UNFILLED' || shift.startsWith('L');
}

/** آیا این شیفت مرخصی است؟ */
function isLeave(shift: ShiftType | undefined): boolean {
  return !!shift && shift.startsWith('L');
}

/** حذف آف‌های تکراری برای همان پرسنل و همان روز */
function deduplicateMandatoryOffs(offs: MandatoryOff[]): MandatoryOff[] {
  const seen = new Set<string>();
  return offs.filter((o) => {
    const key = `${o.personnelId}:${o.day}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================================
// Rule 1: Cumulative 32-Hour Rule (قانون ۳۲ ساعت تجمعی متوالی)
// ============================================================================

/**
 * بررسی قانون ۳۲ ساعت تجمعی متوالی
 *
 * اگر یک پرسنل بدون آف بیش از ۳۲ ساعت پشت‌سرهم کار کند،
 * یک نقض سخت ثبت می‌شود و روز بعد به عنوان آف اجباری علامت می‌خورد.
 *
 * @param personnelId  شناسه پرسنل
 * @param assignments  دیکشنری روز → شیفت (۱-indexed)
 * @param totalDays    تعداد روزهای ماه
 */
export function checkCumulative32HourRule(
  personnelId: string,
  assignments: Record<number, ShiftType>,
  totalDays: number
): { violations: SafetyViolation[]; mandatoryOffs: MandatoryOff[] } {
  const violations: SafetyViolation[] = [];
  const mandatoryOffs: MandatoryOff[] = [];

  let runStart = 0;
  let runHours = 0;
  let runDays: number[] = [];
  // ردیابی روزهایی که قبلاً نقض ثبت شده تا نقض تکراری نزنیم
  const violatedDays = new Set<number>();

  for (let day = 1; day <= totalDays + 1; day++) {
    const shift: ShiftType = assignments[day] ?? 'OFF';
    const hours = getShiftHours(shift);

    if (hours > 0) {
      if (runStart === 0) runStart = day;
      runHours += hours;
      runDays.push(day);

      if (runHours > 32 && !violatedDays.has(runStart)) {
        violatedDays.add(runStart);
        violations.push({
          personnelId,
          day,
          rule: 'CUMULATIVE_32H',
          severity: 'hard',
          message: `از روز ${runStart} تا ${day} بدون آف ${runHours} ساعت متوالی کار — حداکثر مجاز ۳۲ ساعت است`,
          affectedDays: [...runDays],
        });

        const forcedOffDay = day + 1;
        if (forcedOffDay <= totalDays) {
          mandatoryOffs.push({
            personnelId,
            day: forcedOffDay,
            reason: `آف اجباری پس از ${runHours} ساعت کار متوالی (قانون ۳۲ ساعت)`,
          });
        }
      }
    } else {
      // ریست زنجیره با رسیدن به آف یا مرخصی
      runStart = 0;
      runHours = 0;
      runDays = [];
    }
  }

  return { violations, mandatoryOffs };
}

// ============================================================================
// Rule 2: Sleep OFF After Night Shift (استراحت اجباری بعد از شیفت شب)
// ============================================================================

/**
 * بررسی قانون استراحت اجباری بعد از شیفت شب
 *
 * بعد از هر شیفت شامل نوبت شب (N, EN, MN, MEN)،
 * روز بعد باید آف باشد.
 *
 * @param personnelId  شناسه پرسنل
 * @param assignments  دیکشنری روز → شیفت
 * @param totalDays    تعداد روزهای ماه
 */
export function checkSleepOffAfterNight(
  personnelId: string,
  assignments: Record<number, ShiftType>,
  totalDays: number
): { violations: SafetyViolation[]; mandatoryOffs: MandatoryOff[] } {
  const violations: SafetyViolation[] = [];
  const mandatoryOffs: MandatoryOff[] = [];

  for (let day = 1; day < totalDays; day++) {
    const shift: ShiftType = assignments[day] ?? 'OFF';
    const nextShift: ShiftType = assignments[day + 1] ?? 'OFF';

    if (includesNightShift(shift) && !isOff(nextShift)) {
      violations.push({
        personnelId,
        day: day + 1,
        rule: 'SLEEP_OFF_AFTER_NIGHT',
        severity: 'hard',
        message: `روز ${day + 1} باید آف باشد — شیفت '${shift}' در روز ${day} نیاز به استراحت دارد`,
        affectedDays: [day, day + 1],
      });

      mandatoryOffs.push({
        personnelId,
        day: day + 1,
        reason: `آف اجباری پس از شیفت شب '${shift}' در روز ${day}`,
      });
    }
  }

  return { violations, mandatoryOffs };
}

// ============================================================================
// Rule 3: Anti-Single Shift Rule (شیفت تک‌تنها بین دو آف)
// ============================================================================

/**
 * تشخیص شیفت‌های تک‌تنها (ایزوله)
 *
 * اگر یک پرسنل فقط یک روز کاری بین دو آف داشته باشد،
 * این شیفت به عنوان «آخرین گزینه» علامت‌گذاری می‌شود.
 *
 * @param personnelId  شناسه پرسنل
 * @param assignments  دیکشنری روز → شیفت
 * @param totalDays    تعداد روزهای ماه
 */
export function checkAntiSingleShiftRule(
  personnelId: string,
  assignments: Record<number, ShiftType>,
  totalDays: number
): { violations: SafetyViolation[]; singleShiftFlags: SingleShiftFlag[] } {
  const violations: SafetyViolation[] = [];
  const singleShiftFlags: SingleShiftFlag[] = [];

  for (let day = 2; day < totalDays; day++) {
    const prevShift: ShiftType = assignments[day - 1] ?? 'OFF';
    const currShift: ShiftType = assignments[day] ?? 'OFF';
    const nextShift: ShiftType = assignments[day + 1] ?? 'OFF';

    if (isSinglePartShift(currShift) && isOff(prevShift) && isOff(nextShift)) {
      singleShiftFlags.push({ personnelId, day, shift: currShift });

      violations.push({
        personnelId,
        day,
        rule: 'SINGLE_SHIFT_ISOLATED',
        severity: 'soft',
        message: `روز ${day}: شیفت '${currShift}' بین دو آف ایزوله شده — آخرین گزینه (Last Resort)`,
        affectedDays: [day - 1, day, day + 1],
      });
    }
  }

  return { violations, singleShiftFlags };
}

// ============================================================================
// Rule 4: Ongoing Leave Detector (تشخیص و طبقه‌بندی مرخصی‌ها)
// ============================================================================

/**
 * تشخیص و طبقه‌بندی مرخصی‌های پرسنل
 *
 * - **confirmed**: مرخصی در برنامه قطعی‌شده → محدودیت سخت (خط قرمز)
 * - **draft**: درخواست مرخصی در برنامه پیش‌نویس → قابل تنظیم
 *
 * @param personnelId  شناسه پرسنل
 * @param assignments  دیکشنری روز → شیفت
 * @param totalDays    تعداد روزهای ماه
 * @param isFinalized  آیا برنامه برای این پرسنل نهایی شده است؟
 * @param requests     درخواست‌های ثبت‌شده این پرسنل
 */
export function classifyLeaves(
  personnelId: string,
  assignments: Record<number, ShiftType>,
  totalDays: number,
  isFinalized: boolean,
  requests: ShiftRequest[]
): { leaveClassifications: LeaveClassification[] } {
  const leaveClassifications: LeaveClassification[] = [];

  // درخواست‌های مرخصی فعال این پرسنل
  const leaveRequests = requests.filter(
    (r) => r.personnelId === personnelId && r.requestType === 'leave'
  );

  for (let day = 1; day <= totalDays; day++) {
    const shift: ShiftType = assignments[day] ?? 'OFF';
    if (!isLeave(shift)) continue;

    // مرخصی در برنامه نهایی‌شده → همیشه تایید‌شده (خط قرمز)
    if (isFinalized) {
      leaveClassifications.push({ personnelId, day, shift, type: 'confirmed' });
      continue;
    }

    // بررسی آیا یک درخواست رنج‌دار این روز را پوشش می‌دهد
    const coveredByRequest = leaveRequests.some((r) => {
      if (r.scope === 'range' && r.startDate && r.endDate) {
        // مقایسه ساده با شماره روز (برای هم‌خوانی با بقیه کد پروژه)
        return true; // درخواست رنج وجود دارد — مرخصی پیش‌نویس
      }
      if (r.scope === 'custom_days' && r.selectedDays?.includes(day)) return true;
      return false;
    });

    leaveClassifications.push({
      personnelId,
      day,
      shift,
      type: coveredByRequest ? 'draft' : 'confirmed',
    });
  }

  return { leaveClassifications };
}

// ============================================================================
// Master Checker — بررسی جامع یک پرسنل
// ============================================================================

/**
 * بررسی جامع تمام قوانین ایمنی برای یک پرسنل
 *
 * @param personnel    اطلاعات پرسنل
 * @param assignments  دیکشنری روز → شیفت (۱-indexed)
 * @param totalDays    تعداد روزهای ماه
 * @param requests     درخواست‌های مرتبط با همین پرسنل
 * @param isFinalized  آیا برنامه برای این پرسنل نهایی شده؟
 */
export function checkPersonnelSafety(
  personnel: Personnel,
  assignments: Record<number, ShiftType>,
  totalDays: number,
  requests: ShiftRequest[],
  isFinalized: boolean
): SafetyCheckResult {
  const allViolations: SafetyViolation[] = [];
  const allMandatoryOffs: MandatoryOff[] = [];
  const allSingleShiftFlags: SingleShiftFlag[] = [];

  const r1 = checkCumulative32HourRule(personnel.id, assignments, totalDays);
  allViolations.push(...r1.violations);
  allMandatoryOffs.push(...r1.mandatoryOffs);

  const r2 = checkSleepOffAfterNight(personnel.id, assignments, totalDays);
  allViolations.push(...r2.violations);
  allMandatoryOffs.push(...r2.mandatoryOffs);

  const r3 = checkAntiSingleShiftRule(personnel.id, assignments, totalDays);
  allViolations.push(...r3.violations);
  allSingleShiftFlags.push(...r3.singleShiftFlags);

  const r4 = classifyLeaves(
    personnel.id,
    assignments,
    totalDays,
    isFinalized,
    requests
  );

  const hardViolationCount = allViolations.filter((v) => v.severity === 'hard').length;
  const softViolationCount = allViolations.filter((v) => v.severity === 'soft').length;

  return {
    violations: allViolations,
    mandatoryOffs: deduplicateMandatoryOffs(allMandatoryOffs),
    singleShiftFlags: allSingleShiftFlags,
    leaveClassifications: r4.leaveClassifications,
    isClean: allViolations.length === 0,
    hardViolationCount,
    softViolationCount,
  };
}

// ============================================================================
// Schedule-Level Checker — بررسی کل برنامه ماهانه
// ============================================================================

/**
 * بررسی جامع قوانین ایمنی برای تمام پرسنل یک برنامه ماهانه
 *
 * @returns  Map از personnelId به SafetyCheckResult
 */
export function checkScheduleSafety(
  personnelList: Personnel[],
  schedule: MonthlySchedule,
  totalDays: number,
  requests: ShiftRequest[]
): Map<string, SafetyCheckResult> {
  const results = new Map<string, SafetyCheckResult>();

  for (const person of personnelList) {
    const assignments = schedule.assignments[person.id] ?? {};

    const isFinalized =
      !!schedule.finalized ||
      (person.jobGroup === 'nurse'
        ? !!schedule.finalizedNurses
        : !!schedule.finalizedAssistants);

    results.set(
      person.id,
      checkPersonnelSafety(
        person,
        assignments,
        totalDays,
        requests.filter((r) => r.personnelId === person.id),
        isFinalized
      )
    );
  }

  return results;
}

/**
 * تولید خلاصه آماری ایمنی از نتایج checkScheduleSafety
 */
export function summarizeScheduleSafety(
  results: Map<string, SafetyCheckResult>
): ScheduleSafetySummary {
  let totalHardViolations = 0;
  let totalSoftViolations = 0;
  const personnelWithHardViolations: string[] = [];
  const allMandatoryOffs: MandatoryOff[] = [];
  const allSingleShiftFlags: SingleShiftFlag[] = [];
  let confirmedLeaveCount = 0;
  let draftLeaveCount = 0;

  for (const [personnelId, result] of results) {
    totalHardViolations += result.hardViolationCount;
    totalSoftViolations += result.softViolationCount;
    if (result.hardViolationCount > 0) personnelWithHardViolations.push(personnelId);
    allMandatoryOffs.push(...result.mandatoryOffs);
    allSingleShiftFlags.push(...result.singleShiftFlags);
    confirmedLeaveCount += result.leaveClassifications.filter((l) => l.type === 'confirmed').length;
    draftLeaveCount += result.leaveClassifications.filter((l) => l.type === 'draft').length;
  }

  return {
    totalHardViolations,
    totalSoftViolations,
    personnelWithHardViolations,
    allMandatoryOffs: deduplicateMandatoryOffs(allMandatoryOffs),
    allSingleShiftFlags,
    confirmedLeaveCount,
    draftLeaveCount,
    isFullyClean: totalHardViolations === 0 && totalSoftViolations === 0,
  };
}
