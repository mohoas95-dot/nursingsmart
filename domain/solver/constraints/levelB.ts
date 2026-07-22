/**
 * Level B Constraints — Soft OFF, Priority Personnel, Human Approved, Shift Leader
 * Pure functions, solver-ready
 */

import type {
  PersonnelDTO,
  CalendarDayDTO,
  ScenarioAssignmentsDTO,
  ConstraintViolationDTO,
  ShiftRequestDTO,
  SystemDemandDTO,
} from '../types';

function isRequestActive(req: ShiftRequestDTO, day: number, dayOfWeek: number): boolean {
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
      const s = parseInt(req.startDate.split('/').pop() || '0', 10);
      const e = parseInt(req.endDate.split('/').pop() || '0', 10);
      return day >= s && day <= e;
    }
    default: return false;
  }
}

export function validateLevelB(params: {
  personnel: PersonnelDTO[];
  calendar: CalendarDayDTO[];
  assignments: ScenarioAssignmentsDTO;
  requests: ShiftRequestDTO[];
  demand: SystemDemandDTO;
  humanApprovedLocks?: Array<{ personnelId: string; day: number; shift: string }>;
}): ConstraintViolationDTO[] {
  const { personnel, calendar, assignments, requests, demand, humanApprovedLocks } = params;
  const violations: ConstraintViolationDTO[] = [];

  // --- Soft OFF ---
  const softOffRequests = requests.filter(r => r.requestType === 'OFF' && (r.offHardness === 'soft' || r.offHardness === 'generic' || !r.offHardness));
  for (const req of softOffRequests) {
    for (const calDay of calendar) {
      if (!isRequestActive(req, calDay.day, calDay.dayOfWeek)) continue;
      const ass = assignments[req.personnelId]?.[calDay.day];
      if (ass && ass !== 'OFF' && !ass.startsWith('L')) {
        const person = personnel.find(p => p.id === req.personnelId);
        violations.push({
          level: 'B',
          code: 'SOFT_OFF_VIOLATION',
          severity: 'medium',
          personnelId: req.personnelId,
          day: calDay.day,
          messageFa: `عدم رعایت OFF نرم: ${person?.firstName ?? req.personnelId} در روز ${calDay.day} درخواست OFF داشته اما ${ass} گرفته است`,
          messageEn: `Soft OFF violation ${req.personnelId} day ${calDay.day}`,
          isBlocking: false,
        });
      }
    }
  }

  // --- Human Approved Changes must be preserved ---
  if (humanApprovedLocks) {
    for (const lock of humanApprovedLocks) {
      const actual = assignments[lock.personnelId]?.[lock.day];
      if (actual && actual !== lock.shift) {
        violations.push({
          level: 'B',
          code: 'HUMAN_APPROVED_VIOLATED',
          severity: 'high',
          personnelId: lock.personnelId,
          day: lock.day,
          messageFa: `تغییر تاییدشده انسانی نقض شد: ${lock.personnelId} روز ${lock.day} باید ${lock.shift} باشد ولی ${actual} است`,
          messageEn: `Human approved change violated for ${lock.personnelId} day ${lock.day}`,
          isBlocking: false,
        });
      }
    }
  }

  // --- Shift Leader Requirement (BUT never degrade overall quality merely for leader; issue warning instead) ---
  // For each day and shift, check if leader present
  for (const calDay of calendar) {
    const day = calDay.day;
    const isHoliday = calDay.isHoliday;
    // Simplified: if demand requires leader, check if someone with canBeShiftLeader present
    // For afternoon and night
    const afternoonLeaderDemand = isHoliday ? demand.holiday.afternoonLeader : demand.weekday.afternoonLeader;
    const nightLeaderDemand = isHoliday ? demand.holiday.nightLeader : demand.weekday.nightLeader;

    if (afternoonLeaderDemand > 0) {
      const hasLeader = personnel.some(p => {
        if (!p.canBeShiftLeader || !p.active) return false;
        const s = assignments[p.id]?.[day];
        if (!s) return false;
        return s.includes('E');
      });
      if (!hasLeader) {
        violations.push({
          level: 'B',
          code: 'MISSING_SHIFT_LEADER_AFTERNOON',
          severity: 'medium',
          day,
          messageFa: `سرشیفت عصر روز ${day} تامین نشد (کیفیت کلی فدای سرشیفت نشود — فقط هشدار)`,
          messageEn: `Missing shift leader afternoon day ${day}`,
          isBlocking: false,
        });
      }
    }

    if (nightLeaderDemand > 0) {
      const hasLeader = personnel.some(p => {
        if (!p.canBeShiftLeader || !p.active) return false;
        const s = assignments[p.id]?.[day];
        if (!s) return false;
        // If afternoon leader is EN, also covers night
        return s.includes('N') || s === 'EN';
      });
      if (!hasLeader) {
        violations.push({
          level: 'B',
          code: 'MISSING_SHIFT_LEADER_NIGHT',
          severity: 'medium',
          day,
          messageFa: `سرشیفت شب روز ${day} تامین نشد (فقط هشدار، نه افت کیفیت)`,
          messageEn: `Missing shift leader night day ${day}`,
          isBlocking: false,
        });
      }
    }
  }

  // --- Avoid shift requests (Level B) ---
  const avoidRequests = requests.filter(r => r.requestType === 'avoid_shift');
  for (const req of avoidRequests) {
    if (!req.preferredShift) continue;
    for (const calDay of calendar) {
      if (!isRequestActive(req, calDay.day, calDay.dayOfWeek)) continue;
      const ass = assignments[req.personnelId]?.[calDay.day];
      if (!ass) continue;
      if (ass.includes(req.preferredShift)) {
        const person = personnel.find(p => p.id === req.personnelId);
        violations.push({
          level: 'B',
          code: 'AVOID_SHIFT_VIOLATION',
          severity: 'medium',
          personnelId: req.personnelId,
          day: calDay.day,
          messageFa: `درخواست عدم حضور در شیفت نقض شد: ${person?.firstName ?? req.personnelId} روز ${calDay.day} نباید ${req.preferredShift} باشد ولی ${ass} تخصیص یافته`,
          messageEn: `Avoid shift violation ${req.personnelId} day ${calDay.day}`,
          isBlocking: false,
        });
      }
    }
  }

  return violations;
}
