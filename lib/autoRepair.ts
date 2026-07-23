/**
 * AutoRepair — Localized Auto-Repair & Human Veto (Pure Domain Module)
 *
 * RESPONSIBILITY:
 *   1. Localized Auto-Repair (Task 1):
 *      پس از یک ویرایش دستی شیفت، با میکرو-تعویض‌های یک‌گامیه (chain swaps) حداقل‌نیروی
 *      موردنیاز را حفظ کن — بدون ایجاد cascade (زنجیرهٔ ویرایش‌های متوالی).
 *   2. Human Veto Override (Task 2):
 *      اگر سرپرستار شیفتی را اجباراً تعیین کند که قانون ایمنی را می‌شکند، عملیات
 *      مسدود نمی‌شود؛ اما یک پرچم هشدار بحرانی قرمز (criticalWarning) به آن الصاق می‌گردد.
 *
 * DESIGN:
 *   - کاملاً خالص (Pure) و قطعی (Deterministic).
 *   - بدون وابستگی به React/Next/DOM.
 *   - متکی بر safetyConstraints (فاز ۲) و request-scope-matcher.
 *
 * @module lib/autoRepair
 */

import type {
  Personnel,
  ShiftRequest,
  SystemSettings,
  ShiftType,
  MonthlySchedule,
} from './types';
import {
  detectCumulativeHourViolations,
  detectNightRecoveryViolations,
  getShiftDurationHours,
  isWorkingShift,
  shiftIncludesNight,
  MAX_CUMULATIVE_HOURS,
} from './safetyConstraints';
import { isDayInRequestScope } from '../domain/requests/request-scope-matcher';

// ============================================================================
// Public Types
// ============================================================================

export type ShiftSlot = 'M' | 'E' | 'N';
export type JobGroup = 'nurse' | 'assistant';

/** یک ویرایش دستی شیفت (سلول). */
export interface ShiftEdit {
  personnelId: string;
  day: number;
  newShift: ShiftType;
}

/** قانون ایمنی که ممکن است با وتوی دستی نقض شود. */
export type SafetyRule = 'cumulative_32h' | 'sleep_off' | 'min_staffing';

/** هشدار بحرانی (قرمز) ناشی از وتوی دستی. */
export interface CriticalWarning {
  rule: SafetyRule;
  personnelId: string;
  day: number;
  severity: 'critical';
  message: string;
}

/** یک اقدام میکرو-تعویض خودکار. */
export interface AutoRepairAction {
  personnelId: string;
  day: number;
  fromShift: ShiftType;
  toShift: ShiftType;
  reason: string;
}

/** گزینه‌های مشترک. */
export interface AutoRepairOptions {
  personnel: ReadonlyArray<Personnel>;
  settings: SystemSettings;
  totalDays?: number;
  /** روزهای تعطیل (برای تشخیص تقاضای تعطیل/غیرتعطیل). */
  holidayDays?: ReadonlyArray<number>;
  /** ردیف‌های قفل‌شده (نباید جابه‌جا شوند). */
  lockedRows?: ReadonlyArray<string>;
  requests?: ReadonlyArray<ShiftRequest>;
  dayOfWeekByDay?: Readonly<Record<number, number>>;
  /** حداکثر تعداد تعویض (پیش‌فرض ۳) برای جلوگیری از cascade. */
  maxSwaps?: number;
  cumulativeHoursThreshold?: number;
  /** نوع‌های شیفت مجاز برای پر کردن (پیش‌فرض تک‌نوبته‌ها). */
  fillShifts?: ReadonlyArray<ShiftType>;
}

// ============================================================================
// Shared helpers
// ============================================================================

const SLOTS: ReadonlyArray<ShiftSlot> = ['M', 'E', 'N'];

function coversSlot(shift: ShiftType | undefined, slot: ShiftSlot): boolean {
  if (!shift) return false;
  if (slot === 'M') return shift === 'M' || shift === 'ME' || shift === 'MN' || shift === 'MEN';
  if (slot === 'E') return shift === 'E' || shift === 'ME' || shift === 'EN' || shift === 'MEN';
  return shift === 'N' || shift === 'EN' || shift === 'MN' || shift === 'MEN';
}

function demandForSlot(
  settings: SystemSettings,
  isHoliday: boolean,
  slot: ShiftSlot,
  group: JobGroup
): number {
  const demand = isHoliday ? settings.demand.holiday : settings.demand.weekday;
  if (group === 'nurse') {
    if (slot === 'M') return demand.morningNurse;
    if (slot === 'E') return demand.afternoonNurse;
    return demand.nightNurse;
  }
  if (slot === 'M') return demand.morningAssistant;
  if (slot === 'E') return demand.afternoonAssistant;
  return demand.nightAssistant;
}

function countCovering(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  day: number,
  slot: ShiftSlot,
  personnel: ReadonlyArray<Personnel>,
  group: JobGroup
): number {
  return personnel.filter(
    (p) => p.active && p.jobGroup === group && coversSlot(assignments[p.id]?.[day], slot)
  ).length;
}

function isLocked(personnelId: string, lockedRows: ReadonlyArray<string> | undefined): boolean {
  return !!lockedRows && lockedRows.includes(personnelId);
}

/** آیا پرسنل در این روز درخواست سخت (مرخصی/آف) دارد؟ */
function hasHardRequestOnDay(
  personnelId: string,
  day: number,
  requests: ReadonlyArray<ShiftRequest> | undefined,
  dayOfWeekOf: (day: number) => number
): boolean {
  if (!requests) return false;
  return requests.some((r) => {
    if (r.personnelId !== personnelId) return false;
    if (r.requestType !== 'leave' && r.requestType !== 'OFF') return false;
    return isDayInRequestScope(day, dayOfWeekOf(day), r);
  });
}

function makeDayOfWeekFn(map: Readonly<Record<number, number>> | undefined): (day: number) => number {
  return (day: number) => (map && map[day] !== undefined ? map[day] : -1);
}

function cloneAssignments(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>
): Record<string, Record<number, ShiftType>> {
  const out: Record<string, Record<number, ShiftType>> = {};
  for (const [pid, row] of Object.entries(assignments)) out[pid] = { ...row };
  return out;
}

function setCell(
  assignments: Record<string, Record<number, ShiftType>>,
  personnelId: string,
  day: number,
  shift: ShiftType
): void {
  if (!assignments[personnelId]) assignments[personnelId] = {};
  assignments[personnelId][day] = shift;
}

// ============================================================================
// Task 1 — Localized Auto-Repair
// ============================================================================

/**
 * تعمیر موضعی پس از یک ویرایش دستی: حداقل‌نیروی روزِ ویرایش‌شده را با
 * میکرو-تعویض‌های یک‌گامیه بازمی‌گرداند.
 *
 * اصل «بدون cascade»: هر تعویض تنها از نیروی OFF یا جایگاهِ مازاد استفاده می‌کند،
 * پس هیچ کمبود جدیدی ایجاد نمی‌شود و زنجیره‌ای از ویرایش‌ها شکل نمی‌گیرد.
 *
 * @param assignments تخصیص‌ها پس از اعمال ویرایش دستی
 * @param edit مکان ویرایش دستی (فقط روزِ آن بررسی می‌شود → موضعی)
 * @pure
 */
export function autoRepairAfterEdit(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  edit: ShiftEdit,
  options: AutoRepairOptions
): { assignments: Record<string, Record<number, ShiftType>>; repairs: AutoRepairAction[] } {
  const {
    personnel,
    settings,
    lockedRows,
    requests,
    dayOfWeekByDay,
  } = options;
  const day = edit.day;
  const holidaySet = new Set(options.holidayDays ?? []);
  const dayOfWeekOf = makeDayOfWeekFn(dayOfWeekByDay);
  const maxSwaps = options.maxSwaps ?? 3;
  const fillShifts = options.fillShifts ?? (['M', 'E', 'N'] as ReadonlyArray<ShiftType>);

  const working = cloneAssignments(assignments);
  const repairs: AutoRepairAction[] = [];

  for (const group of ['nurse', 'assistant'] as JobGroup[]) {
    for (const slot of SLOTS) {
      if (repairs.length >= maxSwaps) break;
      const demand = demandForSlot(settings, holidaySet.has(day), slot, group);
      if (demand === 0) continue;

      let assigned = countCovering(working, day, slot, personnel, group);
      if (assigned >= demand) continue; // کمبودی نیست.

      // یافتن اهداکنندهٔ یک‌گامیه: OFF یا روی جایگاه مازاد، در همان گروه.
      const candidates = personnel.filter(
        (p) =>
          p.active &&
          p.jobGroup === group &&
          p.id !== edit.personnelId && // خودِ سلولِ ویرایش‌شده را جابه‌جا نکن.
          !isLocked(p.id, lockedRows) &&
          !hasHardRequestOnDay(p.id, day, requests, dayOfWeekOf)
      );

      // ترتیب: ابتدا OFFها (جابه‌جایی آن‌ها کمبودی ایجاد نمی‌کند)، سپس مازاد.
      const ranked = candidates
        .map((p) => {
          const cur = working[p.id]?.[day] ?? 'OFF';
          if (cur === 'OFF') return { p, cur, score: 0 }; // بهترین: استراحت
          // آیا روی جایگاهی مازاد است؟
          const primary = primarySlotOf(cur);
          if (primary && primary !== slot) {
            const primaryDemand = demandForSlot(settings, holidaySet.has(day), primary, group);
            const primaryAssigned = countCovering(working, day, primary, personnel, group);
            if (primaryAssigned > primaryDemand) return { p, cur, score: 1 }; // مازاد
          }
          return null;
        })
        .filter((x): x is { p: Personnel; cur: ShiftType; score: number } => x !== null)
        .sort((a, b) => a.score - b.score);

      const donor = ranked[0]?.p;
      if (!donor) continue;

      const fromShift = working[donor.id]?.[day] ?? 'OFF';
      const toShift = slot as ShiftType; // تک‌نوبتهٔ موردنیاز
      if (!fillShifts.includes(toShift)) continue;

      setCell(working, donor.id, day, toShift);
      repairs.push({
        personnelId: donor.id,
        day,
        fromShift,
        toShift,
        reason: `تعمیر خودکار: پر کردن کمبود نوبت ${slot} (گروه ${group}) در روز ${day} با جابه‌جایی یک‌گامیه (از ${fromShift} به ${toShift}).`,
      });
      assigned += 1;
    }
  }

  return { assignments: working, repairs };
}

// ============================================================================
// Task 2 — Human Veto Override (never blocks; flags critical)
// ============================================================================

/**
 * ارزیابی ایمنیِ یک شیفتِ اجباری (وتوی دستی سرپرستار).
 *
 * سیاست: عملیات را هرگز مسدود نمی‌کند (allowed همیشه true)؛ اما هر قانون ایمنی
 * که با این اجبار نقض شود را به‌صورت هشدار بحرانی برمی‌گرداند.
 *
 * @param currentAssignments تخصیص‌های فعلی (قبل از اعمال ویرایش — برای تشخیص شیفت قبلی)
 * @param edit شیفت اجباری جدید
 * @pure
 */
export function evaluateForcedShiftSafety(
  currentAssignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  edit: ShiftEdit,
  options: AutoRepairOptions
): { allowed: true; criticalWarnings: CriticalWarning[] } {
  const { personnelId, day, newShift } = edit;
  const person = options.personnel.find((p) => p.id === personnelId);
  const group: JobGroup = person?.jobGroup ?? 'nurse';
  const holidaySet = new Set(options.holidayDays ?? []);
  const oldShift = currentAssignments[personnelId]?.[day] ?? 'OFF';
  const modifiedRow: Record<number, ShiftType> = { ...(currentAssignments[personnelId] ?? {}) };
  modifiedRow[day] = newShift;

  const threshold = options.cumulativeHoursThreshold ?? MAX_CUMULATIVE_HOURS;
  const totalDays = options.totalDays ?? maxAssignedDay(modifiedRow);

  const criticalWarnings: CriticalWarning[] = [];

  // --- Sleep OFF ---
  // اگر شیفت جدید شامل شب است و روز بعد کاری است، یا روز قبل شب‌کار بوده و شیفت جدید کاری است.
  if (shiftIncludesNight(newShift) && isWorkingShift(modifiedRow[day + 1])) {
    criticalWarnings.push({
      rule: 'sleep_off',
      personnelId,
      day,
      severity: 'critical',
      message: `وتوی بحرانی: شیفت اجباری ${newShift} در روز ${day} برای پرسنل ${personnelId} قانون استراحت بعد از شب‌کار را نقض می‌کند (روز بعد کاری است).`,
    });
  }
  if (shiftIncludesNight(modifiedRow[day - 1]) && isWorkingShift(newShift)) {
    criticalWarnings.push({
      rule: 'sleep_off',
      personnelId,
      day,
      severity: 'critical',
      message: `وتوی بحرانی: شیفت اجباری ${newShift} در روز ${day} برای پرسنل ${personnelId} بلافاصله پس از شیفت شب قرار گرفته و استراحت شب را نقض می‌کند.`,
    });
  }

  // --- Cumulative 32h ---
  const cumulative = detectCumulativeHourViolations(personnelId, modifiedRow, {
    totalDays,
    cumulativeHoursThreshold: threshold,
  });
  if (cumulative.some((v) => v.chainDays.includes(day))) {
    criticalWarnings.push({
      rule: 'cumulative_32h',
      personnelId,
      day,
      severity: 'critical',
      message: `وتوی بحرانی: شیفت اجباری ${newShift} در روز ${day} برای پرسنل ${personnelId} زنجیرهٔ کاری را از سقف ${threshold} ساعت فراتر می‌برد.`,
    });
  }

  // --- Min Staffing (فقط اگر اجبار، پرسنل را از جایگاهی کم کرده) ---
  for (const slot of SLOTS) {
    const oldCovered = coversSlot(oldShift, slot);
    const newCovered = coversSlot(newShift, slot);
    if (oldCovered && !newCovered) {
      // این اجبار، پرسنل را از نوبت ${slot} خارج کرد.
      const assignedAfter = countCoveringWithRow(
        currentAssignments,
        options.personnel,
        day,
        slot,
        group,
        personnelId,
        newShift
      );
      const demand = demandForSlot(options.settings, holidaySet.has(day), slot, group);
      if (assignedAfter < demand) {
        criticalWarnings.push({
          rule: 'min_staffing',
          personnelId,
          day,
          severity: 'critical',
          message: `وتوی بحرانی: خارج کردن پرسنل ${personnelId} از نوبت ${slot} در روز ${day} باعث نقض حداقل‌نیرو می‌شود (${assignedAfter}/${demand}).`,
        });
      }
    }
  }

  return { allowed: true, criticalWarnings };
}

/**
 * ترکیب ویرایش اجباری + ارزیابی وتو + تعمیر موضعی در یک عملیات.
 * خروجی: تخصیص‌های نهایی (ویرایش + تعمیر)، اقدامات تعمیر، و هشدارهای بحرانی.
 *
 * @pure
 */
export function handleManualOverride(
  currentAssignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  edit: ShiftEdit,
  options: AutoRepairOptions
): {
  assignments: Record<string, Record<number, ShiftType>>;
  repairs: AutoRepairAction[];
  criticalWarnings: CriticalWarning[];
} {
  // ۱) ارزیابی وتو روی شیفت اجباری (با تخصیص‌های قبل از ویرایش برای تشخیص شیفت قبلی).
  const veto = evaluateForcedShiftSafety(currentAssignments, edit, options);

  // ۲) اعمال ویرایش اجباری.
  const edited = cloneAssignments(currentAssignments);
  setCell(edited, edit.personnelId, edit.day, edit.newShift);

  // ۳) تعمیر موضعیِ حداقل‌نیرو.
  const repair = autoRepairAfterEdit(edited, edit, options);

  return {
    assignments: repair.assignments,
    repairs: repair.repairs,
    criticalWarnings: veto.criticalWarnings,
  };
}

// ============================================================================
// Schedule attachment helper
// ============================================================================

/**
 * الصاق هشدارهای بحرانی به برنامه (ادغام و حذف تکراری).
 * @pure
 */
export function attachCriticalWarnings(
  schedule: MonthlySchedule,
  warnings: ReadonlyArray<CriticalWarning>
): MonthlySchedule {
  if (warnings.length === 0) return schedule;
  const existing = schedule.criticalWarnings ?? [];
  const merged = Array.from(new Set([...existing, ...warnings.map((w) => w.message)]));
  return { ...schedule, criticalWarnings: merged };
}

// ============================================================================
// Internal utilities
// ============================================================================

function primarySlotOf(shift: ShiftType): ShiftSlot | null {
  if (shift === 'M' || shift === 'ME' || shift === 'MN' || shift === 'MEN') return 'M';
  if (shift === 'E' || shift === 'EN') return 'E';
  if (shift === 'N') return 'N';
  return null;
}

function maxAssignedDay(row: Readonly<Record<number, ShiftType>>): number {
  const days = Object.keys(row).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return days.length ? Math.max(...days) : 0;
}

/**
 * شمارش پوشش‌دهندگان یک نوبت با فرض اعمال شیفت جدید روی personnelId.
 * (برای ارزیابی حداقل‌نیرو پس از وتو.)
 */
function countCoveringWithRow(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  personnel: ReadonlyArray<Personnel>,
  day: number,
  slot: ShiftSlot,
  group: JobGroup,
  editedPersonnelId: string,
  editedShift: ShiftType
): number {
  return personnel.filter((p) => {
    if (!p.active || p.jobGroup !== group) return false;
    if (p.id === editedPersonnelId) return coversSlot(editedShift, slot);
    return coversSlot(assignments[p.id]?.[day], slot);
  }).length;
}

/** helper کوچک برای دسترسی به settings در حلقهٔ min-staffing. */
function settings_orFallback(options: AutoRepairOptions): SystemSettings {
  return options.settings;
}
