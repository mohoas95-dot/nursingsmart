/**
 * Level C Constraints — Working Hours Targets, Fairness, Distribution
 * Pure, solver-ready
 */

import type {
  PersonnelDTO,
  CalendarDayDTO,
  ScenarioAssignmentsDTO,
  ConstraintViolationDTO,
} from '../types';

const SHIFT_HOURS: Record<string, number> = {
  M: 6.5,
  E: 6.5,
  N: 12.5,
  ME: 13.0,
  EN: 19.0,
  MN: 19.0,
  MEN: 25.5,
  OFF: 0,
};

function getHours(shift: string, employmentType: string, isHoliday: boolean = false): number {
  if (shift.startsWith('L')) {
    if (isHoliday) return 7.0; // Clarification: holiday leave counts as 7 hours
    if (employmentType === 'official') return 7.0;
    if (employmentType === 'contract') return 7.5;
    if (employmentType === 'conscript') return 7.666;
    return 0;
  }
  return SHIFT_HOURS[shift] ?? 0;
}

export function validateLevelC(params: {
  personnel: PersonnelDTO[];
  calendar: CalendarDayDTO[];
  assignments: ScenarioAssignmentsDTO;
  dutyHours: { official: number; contract: number; conscript: number; overtime: number };
}): ConstraintViolationDTO[] {
  const { personnel, calendar, assignments, dutyHours } = params;
  const violations: ConstraintViolationDTO[] = [];
  const totalDays = calendar.length;

  // --- Working Hour Targets ---
  for (const p of personnel) {
    if (!p.active) continue;
    if (p.employmentType === 'overtime') continue; // no target
    let worked = 0;
    for (let d = 1; d <= totalDays; d++) {
      const s = assignments[p.id]?.[d] ?? 'OFF';
      const isHoliday = calendar[d - 1]?.isHoliday ?? false;
      worked += getHours(s, p.employmentType, isHoliday);
    }
    const target =
      p.employmentType === 'official' ? dutyHours.official :
      p.employmentType === 'contract' ? dutyHours.contract :
      p.employmentType === 'conscript' ? dutyHours.conscript : 0;

    const diff = worked - target;
    if (Math.abs(diff) > 14) { // tolerance 14h ~ 2 shifts
      violations.push({
        level: 'C',
        code: diff > 0 ? 'OVERTIME_HIGH' : 'DEFICIT_HIGH',
        severity: 'low',
        personnelId: p.id,
        messageFa: `${p.firstName} ${p.lastName}: ساعت کارکرد ${worked.toFixed(1)} با موظفی ${target} اختلاف ${diff.toFixed(1)} ساعت دارد (بیش از حد مجاز)`,
        messageEn: `Working hours deviation for ${p.id}: worked ${worked}, target ${target}, diff ${diff}`,
        isBlocking: false,
      });
    }
  }

  // --- Anti-Fragmentation: Checkerboard M-OFF-N-OFF ---
  for (const p of personnel) {
    if (!p.active) continue;
    if (p.isFixedRoutine) continue; // exception for fixed staff
    let fragmentCount = 0;
    for (let d = 1; d <= totalDays - 2; d++) {
      const s1 = assignments[p.id]?.[d] ?? 'OFF';
      const s2 = assignments[p.id]?.[d + 1] ?? 'OFF';
      const s3 = assignments[p.id]?.[d + 2] ?? 'OFF';
      // Pattern: work - OFF - work with different shift types => fragmentation
      if (s1 !== 'OFF' && !s1.startsWith('L') && s2 === 'OFF' && s3 !== 'OFF' && !s3.startsWith('L') && s1 !== s3) {
        fragmentCount++;
      }
    }
    if (fragmentCount >= 3) {
      violations.push({
        level: 'C',
        code: 'FRAGMENTED_SCHEDULE',
        severity: 'low',
        personnelId: p.id,
        messageFa: `برنامه ${p.firstName} ${p.lastName} دچار تکه‌تکه شدن (Checkerboard) است: ${fragmentCount} مورد الگوی کار-آف-کار با شیفت متفاوت (خستگی‌زا)`,
        messageEn: `Fragmented schedule for ${p.id}: ${fragmentCount} checkerboard patterns`,
        isBlocking: false,
      });
    }
  }

  // --- Rolling Window Fairness (7-day) ---
  // For each 7-day window, check workload balance
  for (let windowStart = 1; windowStart <= totalDays - 6; windowStart++) {
    const windowHours: Array<{ id: string; hours: number }> = [];
    for (const p of personnel) {
      if (!p.active) continue;
      let h = 0;
      for (let d = windowStart; d < windowStart + 7; d++) {
        const s = assignments[p.id]?.[d] ?? 'OFF';
        const isHol = calendar[d - 1]?.isHoliday ?? false;
        h += getHours(s, p.employmentType, isHol);
      }
      windowHours.push({ id: p.id, hours: h });
    }
    if (windowHours.length === 0) continue;
    const avg = windowHours.reduce((sum, x) => sum + x.hours, 0) / windowHours.length;
    const variance = windowHours.reduce((sum, x) => sum + Math.pow(x.hours - avg, 2), 0) / windowHours.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 15) { // high deviation in 7-day window => potential burnout
      violations.push({
        level: 'C',
        code: 'ROLLING_FAIRNESS_HIGH_VARIANCE',
        severity: 'low',
        day: windowStart,
        messageFa: `عدم تعادل بار کاری در پنجره ۷ روزه ${windowStart} تا ${windowStart + 6}: انحراف معیار ${stdDev.toFixed(1)} ساعت بالا است (خطر فرسودگی)`,
        messageEn: `Rolling fairness high variance window ${windowStart}-${windowStart + 6} stdDev ${stdDev}`,
        isBlocking: false,
      });
    }
  }

  return violations;
}
