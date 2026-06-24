import { Personnel, ShiftRequest, SystemSettings, MonthlySchedule, PersonnelReportResult, ShiftType, CustomHoliday } from "./types";
import { generateJalaliMonthCalendar } from "./jalali";

export function getShiftHours(shift: string, employmentType: string): number {
  try {
    switch (shift) {
      case 'M': return 7;   // Morning
      case 'E': return 7;   // Afternoon/Evening
      case 'N': return 12;  // Night
      case 'ME': return 14; // Morning + Afternoon
      case 'MN': return 19; // Morning + Night (rare)
      case 'EN': return 19; // Afternoon + Night
      case 'MEN': return 24; // Full day (rare)
      case 'off': return 0;
      default: return 0;
    }
  } catch (err) {
    console.error("Error in getShiftHours:", err);
    return 0;
  }
}

export function getLeaveHours(employmentType: string): number {
  return 0; // Standard leave hours if needed
}

export function getSeniorityHours(personnel: Personnel): number {
  try {
    if (!personnel) return 0;
    // Seniority benefits (reduces duty hours required for older workers or supervisors)
    if (personnel.experience >= 15) return 10;
    if (personnel.experience >= 10) return 5;
    return 0;
  } catch (err) {
    console.error("Error in getSeniorityHours:", err);
    return 0;
  }
}

export function checkProductivityEligibility(personnel: Personnel, assignments: ShiftType[]): boolean {
  try {
    if (!personnel) return false;
    // Active personnel who worked at least some night or afternoon shifts are eligible for productivity bonuses
    const activeShiftsCount = assignments.filter(s => s && s !== 'off').length;
    return activeShiftsCount >= 10;
  } catch (err) {
    console.error("Error in checkProductivityEligibility:", err);
    return false;
  }
}

export function calculateShiftProductivity(shift: ShiftType, isHoliday: boolean): number {
  try {
    let base = 0;
    if (shift === 'M') base = 10;
    else if (shift === 'E') base = 15;
    else if (shift === 'N') base = 25;
    else if (shift === 'ME') base = 25;
    else if (shift === 'MN') base = 35;
    else if (shift === 'EN') base = 40;
    else if (shift === 'MEN') base = 50;
    
    return isHoliday ? base * 1.5 : base;
  } catch (err) {
    console.error("Error in calculateShiftProductivity:", err);
    return 0;
  }
}

// Auto-solve nursing schedule algorithm
export function solveNursingSchedule(
  year: number,
  month: number,
  personnelList: Personnel[],
  requests: ShiftRequest[] = [],
  settings: SystemSettings,
  customHolidays: CustomHoliday[] = [],
  firstDayOfWeekIndex?: number,
  monthlyDutyHours?: any
): MonthlySchedule {
  try {
    const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
    const totalDays = calendar.length;
    const activePersonnel = (personnelList || []).filter(p => p && p.active);
    
    const assignments: { [pId: string]: { [day: number]: ShiftType } } = {};
    activePersonnel.forEach(p => {
      assignments[p.id] = {};
    });

    // 1. Pre-fill Approved Requests
    (requests || []).forEach(req => {
      if (req && req.status === 'approved' && assignments[req.personnelId]) {
        // Parse date
        const parts = req.date.split('-');
        if (parts.length === 3) {
          const reqDay = parseInt(parts[2]);
          if (reqDay >= 1 && reqDay <= totalDays) {
            assignments[req.personnelId][reqDay] = req.shiftType;
          }
        }
      }
    });

    // 2. Simple Heuristic Solver to assign shifts based on daily demand
    for (let d = 1; d <= totalDays; d++) {
      const isHoliday = calendar[d - 1]?.isHoliday || false;
      
      // Safe fallback demand configs
      const weekdayDemand = settings?.demand?.weekday || {
        morningNurse: 5, afternoonNurse: 4, nightNurse: 4,
        morningAssistant: 2, afternoonAssistant: 2, nightAssistant: 2,
        afternoonLeader: 1, nightLeader: 1
      };
      const holidayDemand = settings?.demand?.holiday || {
        morningNurse: 4, afternoonNurse: 3, nightNurse: 3,
        morningAssistant: 1, afternoonAssistant: 1, nightAssistant: 1,
        afternoonLeader: 1, nightLeader: 1
      };

      const demand = isHoliday ? holidayDemand : weekdayDemand;

      // Classify personnel
      const nurses = activePersonnel.filter(p => p.position === 'nurse' || p.position === 'supervisor' || p.position === 'headnurse');
      const assistants = activePersonnel.filter(p => p.position === 'assistant');

      // Helper to assign specific shift category
      const fillShifts = (pool: Personnel[], shiftType: ShiftType, countNeeded: number) => {
        let assigned = pool.filter(p => assignments[p.id]?.[d] === shiftType).length;
        if (assigned >= countNeeded) return;

        // Find available pool members
        for (const p of pool) {
          if (assigned >= countNeeded) break;
          
          // Skip if already assigned a shift today
          if (assignments[p.id]?.[d]) continue;

          // Constraints check:
          // A. Avoid consecutive Nights (N) if possible
          if (shiftType === 'N') {
            const yesterdayShift = d > 1 ? assignments[p.id]?.[d - 1] : undefined;
            if (yesterdayShift === 'N' || yesterdayShift === 'MN' || yesterdayShift === 'EN' || yesterdayShift === 'MEN') {
              continue; // Skip to avoid double night shifts
            }
          }

          // Assign
          assignments[p.id][d] = shiftType;
          assigned++;
        }

        // Second pass: if we still need more, relax constraint
        for (const p of pool) {
          if (assigned >= countNeeded) break;
          if (assignments[p.id]?.[d]) continue;
          assignments[p.id][d] = shiftType;
          assigned++;
        }
      };

      // Fill Nurse Shifts
      fillShifts(nurses, 'M', demand.morningNurse ?? 5);
      fillShifts(nurses, 'E', demand.afternoonNurse ?? 4);
      fillShifts(nurses, 'N', demand.nightNurse ?? 4);

      // Fill Assistant Shifts
      fillShifts(assistants, 'M', demand.morningAssistant ?? 2);
      fillShifts(assistants, 'E', demand.afternoonAssistant ?? 2);
      fillShifts(assistants, 'N', demand.nightAssistant ?? 2);

      // Fill remaining with Off
      activePersonnel.forEach(p => {
        if (!assignments[p.id]?.[d]) {
          assignments[p.id][d] = 'off';
        }
      });
    }

    // Verify and add leader designations
    const verification = verifyCoverageAndLeaders(year, month, activePersonnel, assignments, settings, customHolidays, firstDayOfWeekIndex, requests);
    
    return {
      year,
      month,
      assignments,
      shiftLeaders: verification.shiftLeaders,
      warnings: verification.warnings
    };
  } catch (err) {
    console.error("Error solving nursing schedule:", err);
    return {
      year,
      month,
      assignments: {},
      shiftLeaders: {},
      warnings: ["خطا در بهینه‌سازی خودکار برنامه شیفت‌ها. لطفاً تنظیمات یا درخواست‌ها را بررسی کنید."]
    };
  }
}

export function verifyCoverageAndLeaders(
  year: number,
  month: number,
  activePersonnel: Personnel[],
  assignments: { [pId: string]: { [day: number]: ShiftType } },
  settings: SystemSettings,
  customHolidays: CustomHoliday[] = [],
  firstDayOfWeekIndex?: number,
  requests: ShiftRequest[] = []
): { warnings: string[], shiftLeaders: { [day: number]: { morning?: string; afternoon?: string; night?: string } } } {
  try {
    const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
    const totalDays = calendar.length;
    const warnings: string[] = [];
    const shiftLeaders: { [day: number]: { morning?: string; afternoon?: string; night?: string } } = {};
    for (let i = 1; i <= totalDays; i++) shiftLeaders[i] = {};

    const nurses = (activePersonnel || []).filter(p => p && (p.position === 'nurse' || p.position === 'supervisor' || p.position === 'headnurse'));
    const assistants = (activePersonnel || []).filter(p => p && p.position === 'assistant');

    for (let d = 1; d <= totalDays; d++) {
      const isHoliday = calendar[d - 1]?.isHoliday || false;
      
      const weekdayDemand = settings?.demand?.weekday || {
        morningNurse: 5, afternoonNurse: 4, nightNurse: 4,
        morningAssistant: 2, afternoonAssistant: 2, nightAssistant: 2,
        afternoonLeader: 1, nightLeader: 1
      };
      const holidayDemand = settings?.demand?.holiday || {
        morningNurse: 4, afternoonNurse: 3, nightNurse: 3,
        morningAssistant: 1, afternoonAssistant: 1, nightAssistant: 1,
        afternoonLeader: 1, nightLeader: 1
      };

      const demand = isHoliday ? holidayDemand : weekdayDemand;

      // Check Assistant coverage
      const mAssignedAsst = assistants.filter(a => assignments[a.id]?.[d] && ['M','ME','MN','MEN'].includes(assignments[a.id][d])).length;
      const eAssignedAsst = assistants.filter(a => assignments[a.id]?.[d] && ['E','ME','EN','MEN'].includes(assignments[a.id][d])).length;
      const nAssignedAsst = assistants.filter(a => assignments[a.id]?.[d] && ['N','MN','EN','MEN'].includes(assignments[a.id][d])).length;

      const morningAssistantReq = demand?.morningAssistant ?? 2;
      const afternoonAssistantReq = demand?.afternoonAssistant ?? 2;
      const nightAssistantReq = demand?.nightAssistant ?? 2;

      if (mAssignedAsst < morningAssistantReq) {
        warnings.push(`روز ${d}: کمبود کمک‌پرستار در شیفت صبح (موجود: ${mAssignedAsst}، نیاز: ${morningAssistantReq})`);
      }
      if (eAssignedAsst < afternoonAssistantReq) {
        warnings.push(`روز ${d}: کمبود کمک‌پرستار در شیفت عصر (موجود: ${eAssignedAsst}، نیاز: ${afternoonAssistantReq})`);
      }
      if (nAssignedAsst < nightAssistantReq) {
        warnings.push(`روز ${d}: کمبود کمک‌پرستار در شیفت شب (موجود: ${nAssignedAsst}، نیاز: ${nightAssistantReq})`);
      }

      // Check Nurse coverage
      const mAssignedNurses = nurses.filter(n => assignments[n.id]?.[d] && ['M','ME','MN','MEN'].includes(assignments[n.id][d]));
      const eAssignedNurses = nurses.filter(n => assignments[n.id]?.[d] && ['E','ME','EN','MEN'].includes(assignments[n.id][d]));
      const nAssignedNurses = nurses.filter(n => assignments[n.id]?.[d] && ['N','MN','EN','MEN'].includes(assignments[n.id][d]));

      const morningNurseReq = demand?.morningNurse ?? 5;
      const afternoonNurseReq = demand?.afternoonNurse ?? 4;
      const nightNurseReq = demand?.nightNurse ?? 4;

      if (mAssignedNurses.length < morningNurseReq) {
        warnings.push(`روز ${d}: کمبود پرستار در شیفت صبح (موجود: ${mAssignedNurses.length}، نیاز: ${morningNurseReq})`);
      }
      if (eAssignedNurses.length < afternoonNurseReq) {
        warnings.push(`روز ${d}: کمبود پرستار در شیفت عصر (موجود: ${eAssignedNurses.length}، نیاز: ${afternoonNurseReq})`);
      }
      if (nAssignedNurses.length < nightNurseReq) {
        warnings.push(`روز ${d}: کمبود پرستار در شیفت شب (موجود: ${nAssignedNurses.length}، نیاز: ${nightNurseReq})`);
      }

      // Determine Shift Leaders (Supervisors or Senior Nurses with highest experience)
      const getLeader = (assignedList: Personnel[]) => {
        if (assignedList.length === 0) return undefined;
        // Priority: supervisor / headnurse, then experience
        const sorted = [...assignedList].sort((a, b) => {
          const aPriority = (a.position === 'supervisor' || a.position === 'headnurse') ? 2 : 1;
          const bPriority = (b.position === 'supervisor' || b.position === 'headnurse') ? 2 : 1;
          if (aPriority !== bPriority) return bPriority - aPriority;
          return b.experience - a.experience;
        });
        return `${sorted[0].firstName} ${sorted[0].lastName}`;
      };

      shiftLeaders[d] = {
        morning: getLeader(mAssignedNurses),
        afternoon: getLeader(eAssignedNurses),
        night: getLeader(nAssignedNurses)
      };
    }

    // Constraints Validation:
    activePersonnel.forEach(p => {
      let consecutiveNights = 0;
      for (let d = 1; d <= totalDays; d++) {
        const s = assignments[p.id]?.[d];
        const isNight = s === 'N' || s === 'MN' || s === 'EN' || s === 'MEN';
        if (isNight) {
          consecutiveNights++;
          if (consecutiveNights > 2) {
            warnings.push(`پرسنل ${p.firstName} ${p.lastName} بیش از ۲ شیفت شب متوالی دارد (روزهای ${d-2} تا ${d})`);
          }
        } else {
          consecutiveNights = 0;
        }
      }
    });

    return { warnings: Array.from(new Set(warnings)), shiftLeaders };
  } catch (err) {
    console.error("Error verifying coverage and leaders:", err);
    return { warnings: ["خطا در راستی‌آزمایی پوشش شیفت‌ها و تعیین سرشیفت."], shiftLeaders: {} };
  }
}

// Generate reports of worked, overtime, and deficit hours
export function generatePersonnelReports(
  year: number,
  month: number,
  personnelList: Personnel[],
  schedule: MonthlySchedule,
  settings: SystemSettings,
  customHolidays: CustomHoliday[] = [],
  firstDayOfWeekIndex?: number,
  monthlyDutyHours?: any
): PersonnelReportResult[] {
  try {
    const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
    const totalDays = calendar.length;
    const list = personnelList || [];

    return list.map(p => {
      let workedHours = 0;
      let productivity = 0;
      const pAssignments = schedule?.assignments?.[p.id] || {};
      const assignmentsList: ShiftType[] = [];

      for (let d = 1; d <= totalDays; d++) {
        const shift = pAssignments[d] || 'off';
        assignmentsList.push(shift);
        
        // Calculate worked hours
        const hrs = getShiftHours(shift, p.employmentType);
        workedHours += hrs;

        // Calculate productivity points
        const isHoliday = calendar[d - 1]?.isHoliday || false;
        productivity += calculateShiftProductivity(shift, isHoliday);
      }

      // Read configured duty hours with robust fallbacks
      const dutyHoursConfig = monthlyDutyHours || settings?.dutyHours || {
        official: 165,
        contract: 175,
        conscript: 175,
        overtime: 120
      };

      let requiredHours = 175;
      if (p.employmentType === 'official') requiredHours = dutyHoursConfig.official ?? 165;
      else if (p.employmentType === 'contract') requiredHours = dutyHoursConfig.contract ?? 175;
      else if (p.employmentType === 'conscript') requiredHours = dutyHoursConfig.conscript ?? 175;

      // Adjust for seniority
      const seniorityBenefit = getSeniorityHours(p);
      requiredHours = Math.max(0, requiredHours - seniorityBenefit);

      // Overtime and Deficit Calculations
      let overtimeHours = 0;
      let deficitHours = 0;

      if (workedHours > requiredHours) {
        overtimeHours = workedHours - requiredHours;
        const maxOvertimeAllowed = dutyHoursConfig.overtime ?? 120;
        if (overtimeHours > maxOvertimeAllowed) {
          overtimeHours = maxOvertimeAllowed;
        }
      } else if (workedHours < requiredHours) {
        deficitHours = requiredHours - workedHours;
      }

      const productivityEligible = checkProductivityEligibility(p, assignmentsList);

      return {
        personnelId: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        position: p.position,
        employmentType: p.employmentType,
        workedHours,
        overtimeHours,
        deficitHours,
        experience: p.experience,
        productivity,
        productivityEligible
      };
    });
  } catch (err) {
    console.error("Error generating personnel reports:", err);
    return [];
  }
}

export function calculateAutoDutyHours(
  year: number,
  month: number,
  customHolidays: CustomHoliday[] = [],
  firstDayOfWeekIndex?: number
): number {
  try {
    const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
    const nonHolidayDays = calendar.filter(d => !d.isHoliday).length;
    // Standard Iranian formula: 44 hours per week, approx 7.33 hours per weekday
    return Math.round(nonHolidayDays * 7.33);
  } catch (err) {
    console.error("Error calculating auto duty hours:", err);
    return 175;
  }
}
