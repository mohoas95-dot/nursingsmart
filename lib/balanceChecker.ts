// lib/balanceChecker.ts - سیستم بررسی و جایگزینی خودکار برای حفظ تعادل شیفت‌ها

import { Personnel, ShiftRequest, MonthlySchedule, ShiftType, SystemSettings } from './types';
import { getJalaliMonthDays } from './jalali';
import { isDayInRequestScope } from '../domain/requests/request-scope-matcher';

export interface SubstitutionResult {
  personnelId: string;
  day: number;
  newShift: ShiftType;
  reason: string;
  previousShift: ShiftType;
}

// ============================================================================
// Holiday Leave Hours Crediting (Task 3)
// ============================================================================

/**
 * ساعت اعتبار دقیق برای هر روز مرخصیِ落在 تعطیلی رسمی.
 * طبق سیاست، یک روز مرخصی در تعطیلی دقیقاً ۷ ساعت کاری اعتبار می‌گیرد.
 */
export const HOLIDAY_LEAVE_CREDIT_HOURS = 7;

/**
 * محاسبهٔ مجموع ساعت‌های مرخصی با درنظرگرفتن اعتبار تعطیلی رسمی.
 *
 *   - روزهای مرخصی落在 تعطیلی: دقیقاً HOLIDAY_LEAVE_CREDIT_HOURS (۷) ساعت.
 *   - سایر روزهای مرخصی: نرخ پایه بر اساس نوع استخدام.
 *
 * @pure
 */
export function computeLeaveHours(params: {
  totalLeaveDays: number;
  holidayLeaveDays: number;
  baseLeaveRate: number;
}): number {
  const { totalLeaveDays, holidayLeaveDays, baseLeaveRate } = params;
  const safeHoliday = Math.max(0, Math.min(holidayLeaveDays, totalLeaveDays));
  const nonHolidayLeaveDays = totalLeaveDays - safeHoliday;
  return safeHoliday * HOLIDAY_LEAVE_CREDIT_HOURS + nonHolidayLeaveDays * baseLeaveRate;
}

/**
 * محاسبه ساعات کاری یک پرسنل در یک روز بر اساس شیفت
 */
function getShiftHours(shift: ShiftType): number {
  if (shift === 'OFF' || shift.startsWith('L')) return 0;
  if (shift === 'M' || shift === 'E' || shift === 'N') return 8;
  if (shift === 'ME' || shift === 'EN' || shift === 'MN') return 16;
  if (shift === 'MEN') return 24;
  return 0;
}

/**
 * بررسی اینکه آیا یک شیفت با درخواست‌های شخص تضاد دارد
 */
function violatesPersonnelRequest(
  personnelId: string,
  day: number,
  shift: ShiftType,
  requests: ShiftRequest[]
): boolean {
  const personRequests = requests.filter(r => r.personnelId === personnelId);
  
  for (const req of personRequests) {
    // بررسی اینکه این روز در دامنه درخواست قرار می‌گیرد؟
    const isInScope = checkIfDayInRequestScope(day, req);
    
    if (!isInScope) continue;
    
    // اگر درخواست نبود در این شیفت
    if (req.requestType === 'avoid_shift' && req.preferredShift) {
      if (shift.includes(req.preferredShift)) {
        return true; // تضاد دارد
      }
    }
    
    // اگر درخواست حضور در شیفت خاصی است
    if (req.requestType === 'shift' && req.preferredShift) {
      if (!shift.includes(req.preferredShift)) {
        return true; // تضاد دارد
      }
    }
    
    // اگر درخواست آف است
    if (req.requestType === 'OFF') {
      if (shift !== 'OFF') {
        return true; // تضاد دارد
      }
    }
    
    // اگر درخواست مرخصی است
    if (req.requestType === 'leave') {
      if (!shift.startsWith('L')) {
        return true; // تضاد دارد
      }
    }
  }
  
  return false;
}

/**
 * بررسی اینکه آیا یک روز در دامنه درخواست قرار می‌گیرد
 *
 * Adapter: delegates to domain/requests/request-scope-matcher.ts
 * For backward compatibility, dayOfWeek is optional. When not provided (legacy call sites),
 * weekday-specific scopes (saturdays–fridays, weekly_even, weekly_odd) will not match,
 * preserving the exact legacy behavior.
 */
function checkIfDayInRequestScope(day: number, request: ShiftRequest, dayOfWeek?: number): boolean {
  // Use -1 as sentinel so weekday scopes return false when dayOfWeek is unknown (legacy behavior)
  return isDayInRequestScope(day, dayOfWeek ?? -1, request);
}

/**
 * محاسبه ساعات کار یک پرسنل در روزهای قبل و بعد یک روز معین
 */
function getAdjacentHours(
  personnelId: string,
  day: number,
  assignments: MonthlySchedule['assignments'],
  daysBefore: number = 1,
  daysAfter: number = 1
): { before: number; after: number } {
  const personAssignments = assignments[personnelId] || {};
  
  let before = 0;
  for (let i = Math.max(1, day - daysBefore); i < day; i++) {
    before += getShiftHours(personAssignments[i] || 'OFF');
  }
  
  let after = 0;
  for (let i = day + 1; i <= Math.min(31, day + daysAfter); i++) {
    after += getShiftHours(personAssignments[i] || 'OFF');
  }
  
  return { before, after };
}

/**
 * یافتن بهترین نفر جایگزین برای یک شیفت
 * منطق:
 * 1. نقض نکردن درخواست‌های ثبت‌شده
 * 2. کمترین ساعات کار قبل و بعد
 */
export function findBestSubstitute(
  day: number,
  shift: ShiftType,
  personnel: Personnel[],
  assignments: MonthlySchedule['assignments'],
  requests: ShiftRequest[],
  currentMonth: number,
  currentYear: number
): { substitute: Personnel; reason: string } | null {
  const totalDays = getJalaliMonthDays(currentYear, currentMonth);
  
  // فیلتر کردن پرسنل‌هایی که:
  // 1. فعال باشند
  // 2. درخواست تضاد‌کننده نداشته باشند
  // 3. در روز جایگزینی درخواست شیفت خاصی نداشته باشند (بجز درخواست‌های آف)
  const validCandidates = personnel.filter(p => {
    if (!p.active) return false;
    
    // بررسی تضاد با درخواست‌های شخص
    if (violatesPersonnelRequest(p.id, day, shift, requests)) {
      return false;
    }
    
    // بررسی اینکه شخص در این روز درخواست شیفت خاصی ندارد
    const personRequests = requests.filter(r => r.personnelId === p.id);
    const hasConflict = personRequests.some(req => {
      const isInScope = checkIfDayInRequestScope(day, req);
      // اگر درخواست شیفت خاصی است و در این روز وجود دارد، تضاد دارد
      return isInScope && req.requestType === 'shift';
    });
    
    return !hasConflict;
  });
  
  if (validCandidates.length === 0) {
    return null;
  }
  
  // مرتب‌سازی بر اساس ساعات قبل و بعد (کمترین بهتر است)
  const candidatesWithHours = validCandidates.map(p => {
    const { before, after } = getAdjacentHours(p.id, day, assignments, 1, 1);
    return {
      personnel: p,
      totalHours: before + after,
      beforeHours: before,
      afterHours: after
    };
  });
  
  // مرتب‌سازی: ابتدا کل ساعات، سپس ساعات قبل، سپس ساعات بعد
  candidatesWithHours.sort((a, b) => {
    if (a.totalHours !== b.totalHours) {
      return a.totalHours - b.totalHours;
    }
    if (a.beforeHours !== b.beforeHours) {
      return a.beforeHours - b.beforeHours;
    }
    return a.afterHours - b.afterHours;
  });
  
  const best = candidatesWithHours[0];
  
  return {
    substitute: best.personnel,
    reason: `کمترین ساعات کاری (قبل: ${best.beforeHours}h، بعد: ${best.afterHours}h)`
  };
}

/**
 * اعمال منطق پیش‌فرض آف برای روزهایی بدون درخواست
 * اگر نفری درخواستی ندارد، پیش‌فرض باید آف باشد
 */
export function applyDefaultOffRule(
  personnel: Personnel[],
  assignments: MonthlySchedule['assignments'],
  requests: ShiftRequest[],
  currentMonth: number,
  currentYear: number
): MonthlySchedule['assignments'] {
  const totalDays = getJalaliMonthDays(currentYear, currentMonth);
  const updatedAssignments = { ...assignments };
  
  for (const person of personnel) {
    if (!person.active) continue;
    
    const personAssignments = updatedAssignments[person.id] || {};
    const personRequests = requests.filter(r => r.personnelId === person.id);
    
    for (let day = 1; day <= totalDays; day++) {
      // اگر برای این روز قبلاً شیفت تعیین شده است، از آن استفاده کن
      if (personAssignments[day]) {
        continue;
      }
      
      // اگر نفری درخواستی برای این روز ندارد
      const hasRequestForDay = personRequests.some(req => {
        return checkIfDayInRequestScope(day, req);
      });
      
      // پیش‌فرض: آف
      if (!hasRequestForDay) {
        personAssignments[day] = 'OFF';
      }
    }
    
    updatedAssignments[person.id] = personAssignments;
  }
  
  return updatedAssignments;
}

/**
 * بررسی نیاز به جایگزینی خودکار
 * اگر شیفتی کمبود نفر داشت و یک نفر از پیش فرض آف فراخوانده شد
 */
export function checkAndApplyAutoSubstitution(
  day: number,
  shift: ShiftType,
  requiredCount: number,
  currentAssignments: MonthlySchedule['assignments'],
  personnel: Personnel[],
  requests: ShiftRequest[],
  currentMonth: number,
  currentYear: number
): SubstitutionResult | null {
  // شمارش نفرات موجود برای این شیفت
  const activePersonnelForShift = personnel.filter(p => {
    const assignment = currentAssignments[p.id]?.[day] || 'OFF';
    return assignment.includes(shift) || assignment === shift;
  });
  
  if (activePersonnelForShift.length >= requiredCount) {
    // کافی است، نیازی به جایگزینی نیست
    return null;
  }
  
  // نیاز به جایگزینی داریم
  const result = findBestSubstitute(
    day,
    shift,
    personnel,
    currentAssignments,
    requests,
    currentMonth,
    currentYear
  );
  
  if (!result) {
    return null;
  }
  
  const previousShift = currentAssignments[result.substitute.id]?.[day] || 'OFF';
  
  return {
    personnelId: result.substitute.id,
    day,
    newShift: shift,
    reason: result.reason,
    previousShift
  };
}
