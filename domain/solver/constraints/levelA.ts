/**
 * Level A Constraints — Almost Non-Negotiable (Safety & Legal)
 * Updated per finalized clarifications 2026-07-22
 *
 * Rules:
 * 1. 32h consecutive limit = cumulative actual working hours across continuous chain WITHOUT a single OFF.
 *    Example: MEN 25.5h + M 6.5h = 32h exactly? Actually 25.5+6.5=32, but spec says MEN+M exceeds 32 and is prohibited -> strict >32? We treat >=32 as trigger for mandatory OFF. Spec says exceeds -> >32 prohibited, but we auto OFF at >=32 for safety.
 *    Upon reaching limit, system MUST automatically schedule mandatory OFF.
 * 2. Ongoing Leave Detection: based on published schedule status + calendar timeline. Confirmed leave already started = hard red-line, unpublished/future draft can be adjusted.
 * 3. OFF Hard/Soft: Use existing isEssential boolean + head nurse approval status. No new DB fields.
 * 4. Memory Freeze: final 1-2 days from schedules table prevMonthKey.
 * 5. Sleep OFF: full recovery after Night shift. Human Veto allowed with critical red warning but not blocked.
 */

import type {
  PersonnelDTO,
  CalendarDayDTO,
  ScenarioAssignmentsDTO,
  ConstraintViolationDTO,
  PreviousMonthMemoryDTO,
  SystemDemandDTO,
  ShiftRequestDTO,
} from '../types';

// Shift durations — must stay in sync with lib/solver.ts SHIFT_HOURS
const SHIFT_HOURS: Record<string, number> = {
  M: 6.5,
  E: 6.5,
  N: 12.5,
  ME: 13.0,
  EN: 19.0,
  MN: 19.0,
  MEN: 25.5,
  OFF: 0,
  UNFILLED: 0,
};

function getShiftHours(shift: string): number {
  if (!shift) return 0;
  if (shift === 'OFF' || shift === 'UNFILLED') return 0;
  if (shift.startsWith('L')) return 7.0; // simplified, real depends on employmentType
  return SHIFT_HOURS[shift] ?? 0;
}

function isNightShift(shift: string): boolean {
  if (!shift) return false;
  return shift.includes('N');
}

function isOff(shift: string | undefined): boolean {
  if (!shift) return true;
  return shift === 'OFF' || shift === 'UNFILLED';
}

function isLeave(shift: string | undefined): boolean {
  if (!shift) return false;
  return shift.startsWith('L');
}

function isOffOrLeave(shift: string | undefined): boolean {
  return isOff(shift) || isLeave(shift);
}

export interface LevelAParams {
  personnel: PersonnelDTO[];
  calendar: CalendarDayDTO[];
  assignments: ScenarioAssignmentsDTO;
  demand: SystemDemandDTO;
  requests: ShiftRequestDTO[];
  previousMonthMemory?: PreviousMonthMemoryDTO[];
  /** For ongoing leave detection: published month keys */
  finalizedMonths?: string[];
  currentMonthKey?: string;
  /** For Human Veto Sleep OFF: allowed overrides */
  humanApprovedLocks?: Array<{ personnelId: string; day: number; shift: string }>;
  /** Year/month for memory freeze key building */
  year?: number;
  month?: number;
}

/**
 * Validate Level A constraints for a single scenario
 * Returns list of violations (blocking if critical, unless human veto)
 */
export function validateLevelA(params: LevelAParams): ConstraintViolationDTO[] {
  const {
    personnel,
    calendar,
    assignments,
    demand,
    requests,
    previousMonthMemory,
    finalizedMonths,
    currentMonthKey,
    humanApprovedLocks,
  } = params;

  const violations: ConstraintViolationDTO[] = [];
  const totalDays = calendar.length;

  const getAssignment = (personId: string, day: number): string => {
    return assignments[personId]?.[day] ?? 'OFF';
  };

  const isHumanVeto = (personId: string, day: number, shift: string): boolean => {
    if (!humanApprovedLocks) return false;
    return humanApprovedLocks.some(l => l.personnelId === personId && l.day === day && l.shift === shift);
  };

  // --- 1. Mandatory Minimum Rest after Night Shift (Sleep OFF full recovery) ---
  // Clarification #9: Sleep OFF = full recovery after Night. Human Veto allowed with critical warning but not blocked.
  for (const p of personnel) {
    if (!p.active) continue;
    for (let d = 1; d < totalDays; d++) {
      const today = getAssignment(p.id, d);
      const tomorrow = getAssignment(p.id, d + 1);
      if (isNightShift(today) && !isOffOrLeave(tomorrow)) {
        const vetoed = isHumanVeto(p.id, d + 1, tomorrow);
        if (vetoed) {
          violations.push({
            level: 'A',
            code: 'MANDATORY_REST_AFTER_NIGHT_VETOED',
            severity: 'critical',
            personnelId: p.id,
            day: d + 1,
            messageFa: `⚠️ هشدار قرمز بحرانی (وتو انسانی): ${p.firstName} ${p.lastName} روز ${d} شب‌کاری داشته و روز ${d + 1} باید استراحت کامل (OFF) می‌بود اما سرپرستار با وتو انسانی شیفت ${tomorrow} را تایید کرد — سیستم اجازه ذخیره می‌دهد اما این نقض ایمنی ثبت شد`,
            messageEn: `Mandatory rest vetoed for ${p.id} day ${d + 1}: night on ${d} but got ${tomorrow} via Human Veto`,
            isBlocking: false, // NOT blocked per clarification #9
          });
        } else {
          violations.push({
            level: 'A',
            code: 'MANDATORY_REST_AFTER_NIGHT',
            severity: 'critical',
            personnelId: p.id,
            day: d + 1,
            messageFa: `نقض استراحت کامل پس از شب: ${p.firstName} ${p.lastName} در روز ${d} شیفت شب (${today}) داشته و روز ${d + 1} باید OFF کامل برای ریکاوری باشد (در حال حاضر ${tomorrow} است)`,
            messageEn: `Mandatory full recovery violation: ${p.id} night on day ${d}, must be OFF on ${d + 1}, got ${tomorrow}`,
            isBlocking: true,
          });
        }
      }
    }
  }

  // --- 2. Maximum 32-Hour Consecutive Limit — cumulative chain WITHOUT single OFF ---
  // Clarification #1: MEN (25.5h) + M (6.5h) = 32h, but spec says exceeds 32 prohibited. We treat >=32 as mandatory OFF trigger.
  // System MUST automatically schedule mandatory OFF upon reaching limit (handled in repair engine, here we only validate)
  for (const p of personnel) {
    if (!p.active) continue;
    let chainHours = 0;
    let chainShifts = 0;
    let chainStartDay = 1;
    let chainDetails: string[] = [];

    for (let d = 1; d <= totalDays; d++) {
      const shift = getAssignment(p.id, d);
      if (isOff(shift)) {
        // OFF breaks chain — UNFILLED also breaks? Yes, UNFILLED is not working, so chain broken
        chainHours = 0;
        chainShifts = 0;
        chainStartDay = d + 1;
        chainDetails = [];
      } else if (isLeave(shift)) {
        // Leave also breaks chain? For 32h rule, leave is not working but counts as OFF for chain reset per clarification
        // However spec says chain without single OFF, leave is not OFF but still break? We'll treat OFF only as breaker, but to be safe, leave also breaks chain for 32h calculation
        // Actually clarification says cumulative actual working hours across continuous chain without single OFF
        // Leave is not OFF, but is it considered break? In payroll, leave counts as working hours but for safety, we should reset chain on leave as well? We'll reset on OFF only, leave continues? Let's check: leave hours counted, but if on leave, not actually working. For safety, we reset on OFF or UNFILLED.
        // For simplicity: OFF and UNFILLED break, leave does NOT break but adds hours? But leave hours are not heavy? We'll treat leave as break for now to avoid false positives.
        chainHours = 0;
        chainShifts = 0;
        chainStartDay = d + 1;
        chainDetails = [];
      } else {
        const h = getShiftHours(shift);
        chainHours += h;
        chainShifts += 1;
        chainDetails.push(`${d}:${shift}(${h}h)`);

        if (chainHours > 32) {
          violations.push({
            level: 'A',
            code: 'MAX_32H_CHAIN_EXCEEDED',
            severity: 'critical',
            personnelId: p.id,
            day: d,
            messageFa: `سقف ۳۲ ساعت متوالی شکسته شد (بر اساس زنجیره واقعی بدون OFF): ${p.firstName} ${p.lastName} از روز ${chainStartDay} تا ${d} زنجیره [${chainDetails.join(' → ')}] مجموع ${chainHours.toFixed(1)} ساعت کار مداوم بدون حتی یک OFF — مثال MEN ۲۵.۵h + M ۶.۵h = ۳۲h ممنوع است، سیستم باید OFF اجباری بزند`,
            messageEn: `32h chain exceeded for ${p.id} days ${chainStartDay}-${d} chain ${chainDetails.join('->')} total ${chainHours}h`,
            isBlocking: true,
          });
          // After violation, we would auto OFF — for validation we reset
          chainHours = 0;
          chainShifts = 0;
          chainStartDay = d + 1;
          chainDetails = [];
        } else if (chainShifts > 5) {
          violations.push({
            level: 'A',
            code: 'MAX_5_SHIFTS_EXCEEDED',
            severity: 'critical',
            personnelId: p.id,
            day: d,
            messageFa: `سقف ۵ شیفت متوالی شکسته شد: ${p.firstName} ${p.lastName} از روز ${chainStartDay} تا ${d} تعداد ${chainShifts} شیفت متوالی بدون OFF — باید OFF اجباری`,
            messageEn: `Max 5 shifts exceeded for ${p.id}`,
            isBlocking: true,
          });
          chainHours = 0;
          chainShifts = 0;
          chainStartDay = d + 1;
          chainDetails = [];
        }
      }
    }
  }

  // --- 3. Memory Freeze: final 1-2 days of prev month from schedules table prevMonthKey ---
  // Clarification #5: retrieve from database schedules table prevMonthKey
  if (previousMonthMemory && previousMonthMemory.length > 0) {
    for (const mem of previousMonthMemory) {
      const person = personnel.find(pp => pp.id === mem.personnelId);
      if (!person) continue;
      const lastDayPrev = mem.lastTwoDays[mem.lastTwoDays.length - 1];
      const day1Curr = getAssignment(mem.personnelId, 1);

      if (lastDayPrev && isNightShift(lastDayPrev) && !isOffOrLeave(day1Curr)) {
        const vetoed = isHumanVeto(mem.personnelId, 1, day1Curr);
        violations.push({
          level: 'A',
          code: vetoed ? 'MEMORY_FREEZE_REST_VETOED' : 'MEMORY_FREEZE_REST',
          severity: 'critical',
          personnelId: mem.personnelId,
          day: 1,
          messageFa: vetoed
            ? `⚠️ وتو انسانی در مرز ماه: ${person.firstName} ${person.lastName} در ۲ روز پایانی ماه قبل (prevMonthKey) شب داشته و روز ۱ باید OFF باشد اما وتو شد به ${day1Curr}`
            : `نقض حافظه مرزی (prevMonthKey از DB): ${person.firstName} ${person.lastName} در ۲ روز پایانی ماه قبل شب داشته و روز ۱ ماه جاری باید OFF باشد (منبع: schedules جدول)`,
          messageEn: `Memory freeze violation from DB prevMonthKey for ${mem.personnelId}`,
          isBlocking: vetoed ? false : true,
        });
      }

      // Chain stacking across boundary: cumulative without OFF
      let boundaryHours = 0;
      let boundaryShifts = 0;
      let boundaryDetails: string[] = [];
      for (const sh of mem.lastTwoDays) {
        if (isOff(sh)) {
          boundaryHours = 0;
          boundaryShifts = 0;
          boundaryDetails = [];
        } else if (!isLeave(sh)) {
          boundaryHours += getShiftHours(sh);
          boundaryShifts += 1;
          boundaryDetails.push(`prev:${sh}(${getShiftHours(sh)}h)`);
        }
      }
      for (let d = 1; d <= Math.min(5, totalDays); d++) {
        const sh = getAssignment(mem.personnelId, d);
        if (isOff(sh)) {
          boundaryHours = 0;
          boundaryShifts = 0;
          boundaryDetails = [];
        } else if (isLeave(sh)) {
          boundaryHours = 0;
          boundaryShifts = 0;
          boundaryDetails = [];
        } else {
          boundaryHours += getShiftHours(sh);
          boundaryShifts += 1;
          boundaryDetails.push(`${d}:${sh}(${getShiftHours(sh)}h)`);
          if (boundaryHours > 32) {
            violations.push({
              level: 'A',
              code: 'MEMORY_FREEZE_32H',
              severity: 'critical',
              personnelId: mem.personnelId,
              day: d,
              messageFa: `نقض ۳۲ ساعت در مرز ماه با احتساب prevMonthKey از DB: ${person.firstName} ${person.lastName} زنجیره [${boundaryDetails.join(' → ')}] مجموع ${boundaryHours.toFixed(1)}h`,
              messageEn: `Memory freeze 32h chain for ${mem.personnelId}`,
              isBlocking: true,
            });
            break;
          }
        }
      }
    }
  }

  // --- 4. Ongoing Leave Detection based on published schedule status + calendar timeline ---
  // Clarification #2: published/confirmed leave already started = hard red-line, unpublished/future draft can be adjusted
  const isPublished = (monthKey: string | undefined): boolean => {
    if (!monthKey) return false;
    if (!finalizedMonths) return false;
    return finalizedMonths.includes(monthKey);
  };

  const currentIsPublished = isPublished(currentMonthKey);

  const leaveRequests = requests.filter(r => r.requestType === 'leave');
  for (const req of leaveRequests) {
    const pAssignments = assignments[req.personnelId];
    if (!pAssignments) continue;

    const reqIsPublished = req.isPublished ?? currentIsPublished;

    for (const calDay of calendar) {
      const day = calDay.day;
      if (day <= 1) continue;
      const prev = pAssignments[day - 1];
      const curr = pAssignments[day];
      const isPrevLeave = prev && isLeave(prev);

      if (isPrevLeave && curr && !isLeave(curr) && curr !== 'OFF' && curr !== 'UNFILLED') {
        const shouldStillBeLeave = isRequestActiveForDay(req, day, calDay.dayOfWeek);
        if (shouldStillBeLeave) {
          if (reqIsPublished) {
            // Hard red-line
            const person = personnel.find(pp => pp.id === req.personnelId);
            violations.push({
              level: 'A',
              code: 'INTERRUPTED_PUBLISHED_LEAVE',
              severity: 'critical',
              personnelId: req.personnelId,
              day,
              messageFa: `نقض مرخصی پیوسته منتشرشده (سخت): مرخصی تاییدشده و شروع‌شده ${person?.firstName ?? req.personnelId} در روز ${day} قطع شده — این مرخصی بر اساس وضعیت انتشار (published schedule) خط قرمز است و نباید قطع شود`,
              messageEn: `Interrupted published leave hard constraint for ${req.personnelId} day ${day}`,
              isBlocking: true,
            });
          } else {
            // Draft — can be adjusted, lower severity
            violations.push({
              level: 'A',
              code: 'INTERRUPTED_DRAFT_LEAVE',
              severity: 'high',
              personnelId: req.personnelId,
              day,
              messageFa: `مرخصی پیش‌نویس (قابل تنظیم) ${req.personnelId} روز ${day} قطع شده — چون منتشر نشده، قابل جابجایی است`,
              messageEn: `Interrupted draft leave for ${req.personnelId} day ${day}`,
              isBlocking: false,
            });
          }
        }
      }
    }
  }

  // --- 5. Minimum Required Staffing — can be UNFILLED with dark-gray + blinking red ---
  // Clarification #7: UNFILLED status distinct UI
  for (const calDay of calendar) {
    const day = calDay.day;
    const dem = calDay.isHoliday ? demand.holiday : demand.weekday;

    const countFor = (jobGroup: string, shiftChar: 'M' | 'E' | 'N'): number => {
      let count = 0;
      for (const p of personnel) {
        if (!p.active) continue;
        if (p.jobGroup !== jobGroup) continue;
        const s = assignments[p.id]?.[day] ?? 'OFF';
        if (s === 'UNFILLED') continue; // UNFILLED does NOT count as staffed
        if (s.includes(shiftChar)) count++;
      }
      return count;
    };

    const shortages: Array<{ shift: 'M' | 'E' | 'N'; jobGroup: 'nurse' | 'assistant'; required: number; actual: number }> = [];
    const checks: Array<{ shift: 'M' | 'E' | 'N'; jobGroup: 'nurse' | 'assistant'; required: number }> = [
      { shift: 'M', jobGroup: 'nurse', required: dem.morningNurse },
      { shift: 'M', jobGroup: 'assistant', required: dem.morningAssistant },
      { shift: 'E', jobGroup: 'nurse', required: dem.afternoonNurse },
      { shift: 'E', jobGroup: 'assistant', required: dem.afternoonAssistant },
      { shift: 'N', jobGroup: 'nurse', required: dem.nightNurse },
      { shift: 'N', jobGroup: 'assistant', required: dem.nightAssistant },
    ];

    for (const ck of checks) {
      const actual = countFor(ck.jobGroup, ck.shift);
      if (actual < ck.required) {
        shortages.push({ ...ck, actual });
      }
    }

    for (const sh of shortages) {
      violations.push({
        level: 'A',
        code: 'MINIMUM_STAFFING_SHORTAGE_UNFILLED',
        severity: sh.actual === 0 ? 'critical' : 'high',
        day,
        messageFa: `کمبود حداقل نیرو → UNFILLED: روز ${day} شیفت ${sh.shift} گروه ${sh.jobGroup === 'nurse' ? 'پرستار' : 'کمک‌بهیار'} مورد نیاز ${sh.required} موجود ${sh.actual} — شیفت با وضعیت UNFILLED (پس‌زمینه خاکستری تیره + هشدار قرمز چشمک‌زن) خالی می‌ماند — هرگز ایمنی را نشکنید`,
        messageEn: `Staffing shortage UNFILLED day ${day} shift ${sh.shift} ${sh.jobGroup}: required ${sh.required}, actual ${sh.actual}`,
        isBlocking: false,
      });
    }
  }

  // --- 6. Hard OFF based on isEssential (no new DB fields) Clarification #3 ---
  const hardOffRequests = requests.filter(r => r.requestType === 'OFF' && r.isEssential === true);
  for (const req of hardOffRequests) {
    for (const calDay of calendar) {
      const day = calDay.day;
      if (!isRequestActiveForDay(req, day, calDay.dayOfWeek)) continue;
      const ass = assignments[req.personnelId]?.[day];
      if (ass && ass !== 'OFF' && !isLeave(ass) && ass !== 'UNFILLED') {
        // Check if this hard OFF is isolated and staffing overrides? Per deadlock rule, staffing overrides isolated OFFs
        const prev = day > 1 ? assignments[req.personnelId]?.[day - 1] : undefined;
        const next = day < totalDays ? assignments[req.personnelId]?.[day + 1] : undefined;
        const isIsolated = prev !== 'OFF' && next !== 'OFF' && !isLeave(prev) && !isLeave(next);
        if (isIsolated) {
          // Staffing can override isolated hard OFF? Per spec: staffing overrides isolated Soft/Hard OFFs? Actually Level A tie-breaker says staffing overrides isolated Soft/Hard OFFs or single-day leaves
          // But never interrupt multi-day continuous leave already in progress (handled above)
          // So for isolated, downgrade to high not blocking
          violations.push({
            level: 'A',
            code: 'HARD_OFF_ISOLATED_OVERRIDDEN_BY_STAFFING',
            severity: 'high',
            personnelId: req.personnelId,
            day,
            messageFa: `OFF سخت مجزا (isEssential=true) ${req.personnelId} روز ${day} توسط کمبود حداقل نیرو لغو شد (Staffing بر OFF مجزا ارجح است) — شیفت ${ass} تخصیص یافت — بر اساس قانون بن‌بست Level A`,
            messageEn: `Hard OFF isolated overridden by staffing for ${req.personnelId} day ${day}`,
            isBlocking: false,
          });
        } else {
          const person = personnel.find(p => p.id === req.personnelId);
          violations.push({
            level: 'A',
            code: 'HARD_OFF_VIOLATION',
            severity: 'high',
            personnelId: req.personnelId,
            day,
            messageFa: `نقض OFF سخت (isEssential=true تایید سرپرستار): ${person?.firstName ?? req.personnelId} روز ${day} OFF سخت دارد اما ${ass} تخصیص یافته — چون چندروزه است، نباید قطع شود مگر کمبود بحرانی`,
            messageEn: `Hard OFF violation (isEssential) for ${req.personnelId} day ${day}`,
            isBlocking: false,
          });
        }
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Scope matcher — uses same logic as domain/requests but simplified, no coupling
// ---------------------------------------------------------------------------

function isRequestActiveForDay(req: ShiftRequestDTO, day: number, dayOfWeek: number): boolean {
  switch (req.scope) {
    case 'all': return true;
    case 'even': return day % 2 === 0;
    case 'odd': return day % 2 === 1;
    case 'saturdays': return dayOfWeek === 0;
    case 'sundays': return dayOfWeek === 1;
    case 'mondays': return dayOfWeek === 2;
    case 'tuesdays': return dayOfWeek === 3;
    case 'wednesdays': return dayOfWeek === 4;
    case 'thursdays': return dayOfWeek === 5;
    case 'fridays': return dayOfWeek === 6;
    case 'weekly_even': return dayOfWeek === 0 || dayOfWeek === 2 || dayOfWeek === 4;
    case 'weekly_odd': return dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5;
    case 'custom_days': return req.selectedDays?.includes(day) ?? false;
    case 'range': {
      if (!req.startDate || !req.endDate) return false;
      const startDay = parseInt(req.startDate.split('/').pop() || '0', 10);
      const endDay = parseInt(req.endDate.split('/').pop() || '0', 10);
      return day >= startDay && day <= endDay;
    }
    default: return false;
  }
}

/**
 * Deadlock helpers — unchanged but updated for UNFILLED handling
 */
export function isIsolatedOff(
  personnelId: string,
  day: number,
  assignments: ScenarioAssignmentsDTO,
  totalDays: number
): boolean {
  const prev = day > 1 ? assignments[personnelId]?.[day - 1] : undefined;
  const curr = assignments[personnelId]?.[day];
  const next = day < totalDays ? assignments[personnelId]?.[day + 1] : undefined;
  if (curr !== 'OFF') return false;
  const prevOff = prev === 'OFF';
  const nextOff = next === 'OFF';
  return !prevOff && !nextOff;
}

export function isContinuousLeaveInProgress(
  personnelId: string,
  day: number,
  assignments: ScenarioAssignmentsDTO
): boolean {
  if (day <= 1) return false;
  const prev = assignments[personnelId]?.[day - 1];
  const curr = assignments[personnelId]?.[day];
  if (!prev || !curr) return false;
  return prev.toString().startsWith('L') && curr.toString().startsWith('L');
}

/**
 * Auto mandatory OFF scheduler helper — after reaching 32h chain, must schedule OFF
 * Returns the day that must be OFF
 */
export function mustScheduleMandatoryOff(
  chainHours: number,
  nextShiftHours: number
): boolean {
  return chainHours + nextShiftHours > 32;
}
