// lib/solver.ts - نسخه کامل (۱۰۰۰+ خط)

import { Personnel, SystemSettings, ShiftRequest, MonthlySchedule, ShiftType, JalaliDateInfo, PersonnelReportResult, OptimizationResult, AggregatedAlert } from './types';
import { generateJalaliMonthCalendar, getJalaliMonthDays, getJalaliWeekday } from './jalali';

// Shift durations in hours
export const SHIFT_HOURS: { [key in ShiftType]: number } = {
  M: 6.5,
  E: 6.5,
  N: 12.5,
  ME: 13.0,
  EN: 19.0,
  MN: 19.0,
  MEN: 25.5,
  OFF: 0.0,
  L1: 7.0,
  L2: 7.0,
  L3: 7.0,
  L4: 7.0,
  L5: 7.0
};

// Get dynamic shift hours considering personnel's employment type for leaves
export function getShiftHours(shift: string, employmentType: string): number {
  if (shift.startsWith('L')) {
    return getLeaveHours(employmentType);
  }
  return SHIFT_HOURS[shift] || 0.0;
}

// Leave hours by employment type
export function getLeaveHours(employmentType: string): number {
  switch (employmentType) {
    case 'official': return 7.0;
    case 'contract': return 7.5;
    case 'conscript': return 7.666;
    default: return 0;
  }
}

// Experience years "سنوات" calculation (not for conscript)
export function getSeniorityHours(personnel: Personnel): number {
  if (personnel.employmentType === 'conscript') {
    return 0;
  }
  
  if (personnel.jobGroup === 'assistant') {
    return 12.0;
  }
  
  const years = personnel.experienceYears;
  if (years >= 0 && years <= 4) return 4.0;
  if (years >= 5 && years <= 8) return 8.0;
  if (years >= 9 && years <= 12) return 12.0;
  
  const extraYears = years - 12;
  const extraSlots = Math.floor(extraYears / 4);
  return 12.0 + (extraSlots * 4.0);
}

// Calculate productivity hours on a calendar info list for a personnel
export function checkProductivityEligibility(personnel: Personnel, assignments: ShiftType[]): boolean {
  if (personnel.employmentType === 'conscript') {
    return false;
  }

  if (personnel.position === 'supervisor') {
    return true;
  }

  let mCount = 0;
  let eCount = 0;
  let nCount = 0;
  
  assignments.forEach((shift) => {
    if (shift === 'M' || shift === 'ME' || shift === 'MN' || shift === 'MEN') mCount++;
    if (shift === 'E' || shift === 'ME' || shift === 'EN' || shift === 'MEN') eCount++;
    if (shift === 'N' || shift === 'EN' || shift === 'MN' || shift === 'MEN') nCount++;
  });

  if (personnel.position === 'staff') {
    return mCount >= 10 && eCount >= 1 && nCount >= 1;
  }

  if (personnel.position === 'general') {
    return mCount >= 3 && eCount >= 3 && nCount >= 3;
  }

  if (personnel.jobGroup === 'assistant') {
    return mCount >= 5 && eCount >= 3 && nCount >= 3;
  }

  return false;
}

// Calculate individual productivity amount
export function calculateShiftProductivity(shift: ShiftType, isHoliday: boolean): number {
  if (isHoliday) {
    if (shift === 'M') return 3.0;
    if (shift === 'E') return 3.0;
    if (shift === 'N') return 6.0;
    if (shift === 'ME') return 6.0;
    if (shift === 'EN') return 9.0;
    if (shift === 'MN') return 9.0;
    if (shift === 'MEN') return 12.0;
  } else {
    if (shift === 'N') return 3.0;
    if (shift === 'EN') return 3.0;
    if (shift === 'MN') return 3.0;
    if (shift === 'MEN') return 3.0;
  }
  return 0.0;
}

// ====== تابع جدید برای ادغام هشدارهای زنجیره‌ای (درخواست ۵) ======
export function aggregateWarnings(
  warnings: string[],
  personnelList: Personnel[]
): AggregatedAlert[] {
  const grouped: { [personnelId: string]: string[] } = {};
  
  warnings.forEach(warning => {
    let foundPersonnelId: string | null = null;
    
    for (const p of personnelList) {
      const fullName = `${p.firstName} ${p.lastName}`;
      if (warning.includes(fullName)) {
        foundPersonnelId = p.id;
        break;
      }
    }
    
    if (foundPersonnelId) {
      if (!grouped[foundPersonnelId]) {
        grouped[foundPersonnelId] = [];
      }
      grouped[foundPersonnelId].push(warning);
    }
  });
  
  const result: AggregatedAlert[] = [];
  for (const [personnelId, warningsList] of Object.entries(grouped)) {
    const personnel = personnelList.find(p => p.id === personnelId);
    const severity: 'low' | 'medium' | 'high' = 
      warningsList.length >= 5 ? 'high' :
      warningsList.length >= 3 ? 'medium' : 'low';
    
    result.push({
      personnelId,
      personnelName: personnel ? `${personnel.firstName} ${personnel.lastName}` : 'نامشخص',
      warningCount: warningsList.length,
      warnings: warningsList,
      severity,
      isExpanded: false
    });
  }
  
  result.sort((a, b) => b.warningCount - a.warningCount);
  return result;
}

// ====== تابع جدید برای بازتولید هوشمند با اولویت‌بندی (درخواست ۳) ======
export function solveWithPriority(
  year: number,
  month: number,
  personnelList: readonly Personnel[],
  requests: readonly ShiftRequest[],
  settings: SystemSettings,
  customHolidays: Readonly<Record<number, string>> = {},
  firstDayOfWeekIndex?: number,
  monthlyDutyHours?: any
): OptimizationResult {
  
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const totalDays = calendar.length;
  const activePersonnel = personnelList.filter(p => p.active && !p.locked);
  
  const baseResult = solveNursingSchedule(
    year, month, personnelList, requests, settings, 
    customHolidays, firstDayOfWeekIndex, monthlyDutyHours
  );
  
  const assignments = { ...baseResult.assignments };
  const warnings: string[] = [];
  const coverageGaps: OptimizationResult['coverageGaps'] = [];
  const priorityUsed: OptimizationResult['priorityUsed'] = {
    level1: [],
    level2: [],
    level3: []
  };
  
  const nurses = activePersonnel.filter(p => p.jobGroup === 'nurse');
  const assistants = activePersonnel.filter(p => p.jobGroup === 'assistant');
  
  for (let d = 1; d <= totalDays; d++) {
    const isHoliday = calendar[d - 1].isHoliday;
    const demand = isHoliday ? settings.demand.holiday : settings.demand.weekday;
    
    const shifts: ('M' | 'E' | 'N')[] = ['M', 'E', 'N'];
    
    for (const shiftType of shifts) {
      let nurseDemand = 0;
      let assistantDemand = 0;
      let nurseCount = 0;
      let assistantCount = 0;
      
      if (shiftType === 'M') {
        nurseDemand = demand.morningNurse;
        assistantDemand = demand.morningAssistant;
        nurseCount = nurses.filter(n => {
          const s = assignments[n.id]?.[d];
          return s === 'M' || s === 'ME' || s === 'MN' || s === 'MEN';
        }).length;
        assistantCount = assistants.filter(a => {
          const s = assignments[a.id]?.[d];
          return s === 'M' || s === 'ME' || s === 'MN' || s === 'MEN';
        }).length;
      } else if (shiftType === 'E') {
        nurseDemand = demand.afternoonNurse;
        assistantDemand = demand.afternoonAssistant;
        nurseCount = nurses.filter(n => {
          const s = assignments[n.id]?.[d];
          return s === 'E' || s === 'ME' || s === 'EN' || s === 'MEN';
        }).length;
        assistantCount = assistants.filter(a => {
          const s = assignments[a.id]?.[d];
          return s === 'E' || s === 'ME' || s === 'EN' || s === 'MEN';
        }).length;
      } else {
        nurseDemand = demand.nightNurse;
        assistantDemand = demand.nightAssistant;
        nurseCount = nurses.filter(n => {
          const s = assignments[n.id]?.[d];
          return s === 'N' || s === 'EN' || s === 'MN' || s === 'MEN';
        }).length;
        assistantCount = assistants.filter(a => {
          const s = assignments[a.id]?.[d];
          return s === 'N' || s === 'EN' || s === 'MN' || s === 'MEN';
        }).length;
      }
      
      const totalDemand = nurseDemand + assistantDemand;
      const totalCount = nurseCount + assistantCount;
      const shortage = totalDemand - totalCount;
      
      if (shortage > 0) {
        const filledBy: string[] = [];
        
        const availablePersonnel = activePersonnel.filter(p => {
          const currentShift = assignments[p.id]?.[d];
          if (currentShift && currentShift !== 'OFF' && !currentShift.startsWith('L')) {
            return false;
          }
          if (p.locked) return false;
          
          const req = requests.find(r => r.personnelId === p.id);
          if (req && req.requestType === 'OFF' && req.scope === 'all') {
            return false;
          }
          return true;
        });
        
        const priority1 = availablePersonnel.filter(p => {
          const req = requests.find(r => r.personnelId === p.id);
          if (!req) return true;
          if (req.requestType === 'avoid_shift' && req.preferredShift === shiftType) {
            return false;
          }
          return true;
        });
        
        const priority2 = availablePersonnel.filter(p => {
          if (d > 1) {
            const prevShift = assignments[p.id]?.[d-1];
            if (prevShift && ['ME', 'EN', 'MN', 'MEN', 'N'].includes(prevShift)) {
              return true;
            }
          }
          return false;
        });
        
        const priority3 = availablePersonnel.filter(p => {
          const req = requests.find(r => r.personnelId === p.id);
          if (!req) return false;
          if (req.requestType === 'avoid_shift' && req.preferredShift === shiftType) {
            return true;
          }
          return false;
        });
        
        let remainingShortage = shortage;
        
        for (const p of priority1) {
          if (remainingShortage <= 0) break;
          if (!assignments[p.id]) assignments[p.id] = {};
          assignments[p.id][d] = shiftType;
          filledBy.push(p.id);
          priorityUsed.level1.push(p.id);
          remainingShortage--;
        }
        
        for (const p of priority2) {
          if (remainingShortage <= 0) break;
          if (!assignments[p.id]) assignments[p.id] = {};
          assignments[p.id][d] = shiftType;
          filledBy.push(p.id);
          priorityUsed.level2.push(p.id);
          remainingShortage--;
        }
        
        for (const p of priority3) {
          if (remainingShortage <= 0) break;
          if (!assignments[p.id]) assignments[p.id] = {};
          assignments[p.id][d] = shiftType;
          filledBy.push(p.id);
          priorityUsed.level3.push(p.id);
          remainingShortage--;
        }
        
        if (remainingShortage > 0) {
          warnings.push(`کمبود نیرو در روز ${d} شیفت ${shiftType} - ${remainingShortage} نفر باقی ماند`);
        }
        
        coverageGaps.push({
          day: d,
          shift: shiftType,
          shortage: shortage - remainingShortage,
          filledBy
        });
      }
    }
  }
  
  return {
    assignments,
    warnings: [...baseResult.warnings, ...warnings],
    coverageGaps,
    priorityUsed
  };
}

// ====== تابع اصلی solveNursingSchedule ======
export function solveNursingSchedule(
  year: number,
  month: number,
  personnelList: readonly Personnel[],
  requests: readonly ShiftRequest[],
  settings: SystemSettings,
  customHolidays: Readonly<Record<number, string>> = {},
  firstDayOfWeekIndex?: number,
  monthlyDutyHours?: any
): MonthlySchedule {
  
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const totalDays = calendar.length;
  const activePersonnel = personnelList.filter(p => p.active);
  
  // Initialize empty assignments
  const assignments: { [pId: string]: { [day: number]: ShiftType } } = {};
  activePersonnel.forEach(p => {
    assignments[p.id] = {};
    for (let d = 1; d <= totalDays; d++) {
      assignments[p.id][d] = 'OFF';
    }
  });

  const getExtraShiftsCount = (pId: string): number => {
    let count = 0;
    for (let day = 1; day <= totalDays; day++) {
      const s = assignments[pId][day];
      if (s === 'OFF' || s.startsWith('L')) continue;
      
      const req = dailyRequests[pId]?.[day];
      if (req && req.requestType === 'shift' && req.preferredShift) {
        const pref = req.preferredShift;
        if (s === pref || (pref === 'ME' && (s === 'M' || s === 'E')) || (pref === 'EN' && (s === 'E' || s === 'N')) || (pref === 'MN' && (s === 'M' || s === 'N')) || (pref === 'MEN' && (s === 'M' || s === 'E' || s === 'N'))) {
          continue;
        }
      }
      
      const pReq = requests.find(r => r.personnelId === pId && r.requestType === 'pattern');
      if (pReq && pReq.patternSteps && pReq.patternSteps.length > 0) {
        const stepIndex = (day - 1) % pReq.patternSteps.length;
        if (pReq.patternSteps[stepIndex] === s) {
          continue;
        }
      }
      
      count++;
    }
    return count;
  };

  const warnings: string[] = [];
  const shiftLeaders: { [day: number]: { morning?: string; afternoon?: string; night?: string } } = {};
  for (let d = 1; d <= totalDays; d++) {
    shiftLeaders[d] = {};
  }

  // 1. Compile daily requests matrix for each person
  const dailyRequests: { [pId: string]: { [day: number]: ShiftRequest } } = {};
  const avoidedShifts: { [pId: string]: { [day: number]: Set<string> } } = {};
  activePersonnel.forEach(p => {
    dailyRequests[p.id] = {};
    avoidedShifts[p.id] = {};
    for (let d = 1; d <= totalDays; d++) {
      avoidedShifts[p.id][d] = new Set<string>();
    }
  });

  requests.forEach(req => {
    const pId = req.personnelId;
    if (!assignments[pId]) return;

    for (let d = 1; d <= totalDays; d++) {
      const dateInfo = calendar[d - 1];
      let matchesScope = false;

      if (req.scope === 'all') {
        matchesScope = true;
      } else if (req.scope === 'even' && d % 2 === 0) {
        matchesScope = true;
      } else if (req.scope === 'odd' && d % 2 !== 0) {
        matchesScope = true;
      } else if (req.scope === 'saturdays' && dateInfo.dayOfWeek === 0) {
        matchesScope = true;
      } else if (req.scope === 'sundays' && dateInfo.dayOfWeek === 1) {
        matchesScope = true;
      } else if (req.scope === 'mondays' && dateInfo.dayOfWeek === 2) {
        matchesScope = true;
      } else if (req.scope === 'tuesdays' && dateInfo.dayOfWeek === 3) {
        matchesScope = true;
      } else if (req.scope === 'wednesdays' && dateInfo.dayOfWeek === 4) {
        matchesScope = true;
      } else if (req.scope === 'thursdays' && dateInfo.dayOfWeek === 5) {
        matchesScope = true;
      } else if (req.scope === 'fridays' && dateInfo.dayOfWeek === 6) {
        matchesScope = true;
      } else if (req.scope === 'weekly_even' && (dateInfo.dayOfWeek === 0 || dateInfo.dayOfWeek === 2 || dateInfo.dayOfWeek === 4)) {
        matchesScope = true;
      } else if (req.scope === 'weekly_odd' && (dateInfo.dayOfWeek === 1 || dateInfo.dayOfWeek === 3 || dateInfo.dayOfWeek === 5)) {
        matchesScope = true;
      } else if (req.scope === 'custom_days' && req.selectedDays && req.selectedDays.includes(d)) {
        matchesScope = true;
      } else if (req.scope === 'range' && req.startDate && req.endDate) {
        const currentStr = `${year}/${month < 10 ? '0' + month : month}/${d < 10 ? '0' + d : d}`;
        const startNormalized = req.startDate.replace(/\//g, '-');
        const endNormalized = req.endDate.replace(/\//g, '-');
        const currNormalized = currentStr.replace(/\//g, '-');
        
        if (currNormalized >= startNormalized && currNormalized <= endNormalized) {
          matchesScope = true;
        }
      }

      if (matchesScope) {
        if (req.requestType === 'avoid_shift') {
          if (req.preferredShift) {
            avoidedShifts[pId][d].add(req.preferredShift);
          }
        } else {
          const existing = dailyRequests[pId][d];
          if (!existing || (!existing.isEssential && req.isEssential)) {
            dailyRequests[pId][d] = req;
          }
        }
      }
    }
  });

  const nurses = activePersonnel.filter(p => p.jobGroup === 'nurse');
  const assistants = activePersonnel.filter(p => p.jobGroup === 'assistant');

  // Pre-process Leaves
  // Clarification: If personnel is on leave on holiday, count 7 hours for that day (per user request 2026-07-22)
  // Previously holiday leave was converted to OFF and shifted; now it is kept as L and counts as 7h on holiday
  activePersonnel.forEach(p => {
    let leaveDayCount = 0;
    let isCurrentlyOnLeave = false;

    for (let d = 1; d <= totalDays; d++) {
      const req = dailyRequests[p.id][d];

      if (req && req.requestType === 'leave') {
        if (!isCurrentlyOnLeave) {
          isCurrentlyOnLeave = true;
          leaveDayCount = 1;
        } else {
          leaveDayCount++;
        }
        assignments[p.id][d] = `L${leaveDayCount}` as ShiftType;
      } else {
        isCurrentlyOnLeave = false;
        leaveDayCount = 0;
      }
    }
  });

  // 2. Pre-process Patterns
  activePersonnel.forEach(p => {
    const patternReqs = requests.filter(r => r.personnelId === p.id && r.requestType === 'pattern');
    if (patternReqs.length === 0) return;
    
    const req = patternReqs[0];
    const steps = req.patternSteps || [];
    if (steps.length === 0) return;

    for (let d = 1; d <= totalDays; d++) {
      if (assignments[p.id][d].startsWith('L')) continue;
      
      const stepIndex = (d - 1) % steps.length;
      const stepVal = steps[stepIndex];
      
      assignments[p.id][d] = stepVal as ShiftType;
    }
  });

  // 3. Apply Explicit OFF and Shift Requests
  for (let d = 1; d <= totalDays; d++) {
    activePersonnel.forEach(p => {
      if (assignments[p.id][d].startsWith('L')) return;
      
      const req = dailyRequests[p.id][d];
      if (!req) return;

      if (req.requestType === 'OFF') {
        assignments[p.id][d] = 'OFF';
      } else if (req.requestType === 'shift' && req.preferredShift && req.preferredShift !== 'L') {
        assignments[p.id][d] = req.preferredShift as ShiftType;
      }
    });
  }

  // 4. Force default supervisor and staff constraints
  const supervisorAndStaff = activePersonnel.filter(p => p.position === 'supervisor' || p.position === 'staff');
  
  supervisorAndStaff.forEach(p => {
    const hasPattern = requests.some(r => r.personnelId === p.id && r.requestType === 'pattern');
    
    for (let d = 1; d <= totalDays; d++) {
      if (assignments[p.id][d].startsWith('L')) continue;
      
      if (hasPattern) continue;
      
      const isHoliday = calendar[d - 1].isHoliday;
      const req = dailyRequests[p.id][d];
      
      if (isHoliday) {
        if (req && req.requestType === 'shift' && req.preferredShift && req.preferredShift !== 'OFF' && req.preferredShift !== 'L') {
          assignments[p.id][d] = req.preferredShift as ShiftType;
        } else {
          assignments[p.id][d] = 'OFF';
        }
      } else {
        const shouldAvoidM = avoidedShifts[p.id]?.[d]?.has('M');
        if (shouldAvoidM) {
          assignments[p.id][d] = 'OFF';
        } else if (req) {
          if (req.requestType === 'OFF') {
            assignments[p.id][d] = 'OFF';
          } else if (req.requestType === 'shift' && req.preferredShift && req.preferredShift !== 'L') {
            assignments[p.id][d] = req.preferredShift as ShiftType;
          } else {
            assignments[p.id][d] = 'M';
          }
        } else {
          assignments[p.id][d] = 'M';
        }
      }
    }
  });

  const staffs = activePersonnel.filter(p => p.position === 'staff');
  const supervisor = activePersonnel.find(p => p.position === 'supervisor');

  // 5. Fill Shifts & Allocate Demand Day by Day
  for (let d = 1; d <= totalDays; d++) {
    const isHoliday = calendar[d - 1].isHoliday;
    const demand = isHoliday ? settings.demand.holiday : settings.demand.weekday;

    // A. Fill Nurse Assistant Shifts
    const morningAssistantDemand = demand.morningAssistant;
    const afternoonAssistantDemand = demand.afternoonAssistant;
    const nightAssistantDemand = demand.nightAssistant;

    let mAssignedAsst = assistants.filter(a => assignments[a.id][d] === 'M' || assignments[a.id][d] === 'ME' || assignments[a.id][d] === 'MN' || assignments[a.id][d] === 'MEN').length;
    let eAssignedAsst = assistants.filter(a => assignments[a.id][d] === 'E' || assignments[a.id][d] === 'ME' || assignments[a.id][d] === 'EN' || assignments[a.id][d] === 'MEN').length;
    let nAssignedAsst = assistants.filter(a => assignments[a.id][d] === 'N' || assignments[a.id][d] === 'EN' || assignments[a.id][d] === 'MN' || assignments[a.id][d] === 'MEN').length;

    const fillGroupGaps = (group: Personnel[], shiftChar: 'M' | 'E' | 'N', targetDemand: number, currentCount: number) => {
      let gap = targetDemand - currentCount;
      if (gap < 0) {
        let excessCount = Math.abs(gap);
        let assignedToThisShift = group.filter(p => {
            const currentShift = assignments[p.id][d];
            if (shiftChar === 'M') return currentShift === 'M' || currentShift === 'ME' || currentShift === 'MN' || currentShift === 'MEN';
            if (shiftChar === 'E') return currentShift === 'E' || currentShift === 'ME' || currentShift === 'EN' || currentShift === 'MEN';
            if (shiftChar === 'N') return currentShift === 'N' || currentShift === 'EN' || currentShift === 'MN' || currentShift === 'MEN';
            return false;
        });

        assignedToThisShift.sort((x, y) => {
           const isXRequested = (() => {
             const reqX = dailyRequests[x.id]?.[d];
             if (reqX && reqX.requestType === 'shift' && reqX.preferredShift) {
               const pref = reqX.preferredShift;
               return (shiftChar === 'M' && (pref === 'M' || pref === 'ME' || pref === 'MN' || pref === 'MEN')) ||
                      (shiftChar === 'E' && (pref === 'E' || pref === 'ME' || pref === 'EN' || pref === 'MEN')) ||
                      (shiftChar === 'N' && (pref === 'N' || pref === 'EN' || pref === 'MN' || pref === 'MEN'));
             }
             return false;
           })();
           const isYRequested = (() => {
             const reqY = dailyRequests[y.id]?.[d];
             if (reqY && reqY.requestType === 'shift' && reqY.preferredShift) {
               const pref = reqY.preferredShift;
               return (shiftChar === 'M' && (pref === 'M' || pref === 'ME' || pref === 'MN' || pref === 'MEN')) ||
                      (shiftChar === 'E' && (pref === 'E' || pref === 'ME' || pref === 'EN' || pref === 'MEN')) ||
                      (shiftChar === 'N' && (pref === 'N' || pref === 'EN' || pref === 'MN' || pref === 'MEN'));
             }
             return false;
           })();
           
           if (!isXRequested && isYRequested) return -1;
           if (isXRequested && !isYRequested) return 1;

           let hoursX = 0; let hoursY = 0;
           for (let day = 1; day <= totalDays; day++) {
             hoursX += getShiftHours(assignments[x.id][day], x.employmentType);
             hoursY += getShiftHours(assignments[y.id][day], y.employmentType);
           }
           const effectiveDuty = monthlyDutyHours || settings.dutyHours;
           const targetX = x.employmentType === 'overtime' ? 0 : (effectiveDuty[x.employmentType] || 0);
           const targetY = y.employmentType === 'overtime' ? 0 : (effectiveDuty[y.employmentType] || 0);

           const defX = targetX - hoursX;
           const defY = targetY - hoursY;

           if (Math.abs(defX - defY) > 0.1) {
             return defX - defY;
           }
           
           const isHeavy = (s: string) => s === 'MEN' || s === 'MN' || s === 'EN' || s === 'ME' ? 1 : 0;
           const hX = isHeavy(assignments[x.id][d]);
           const hY = isHeavy(assignments[y.id][d]);
           if (hX !== hY) return hY - hX;

           return 0;
        });

        for (let i = 0; i < excessCount && i < assignedToThisShift.length; i++) {
           const p = assignedToThisShift[i];
           const currentShift = assignments[p.id][d];
           
           let newShift: ShiftType = 'OFF';
           if (shiftChar === 'M') {
             if (currentShift === 'M') newShift = 'OFF';
             if (currentShift === 'ME') newShift = 'E';
             if (currentShift === 'MN') newShift = 'N';
             if (currentShift === 'MEN') newShift = 'EN';
           } else if (shiftChar === 'E') {
             if (currentShift === 'E') newShift = 'OFF';
             if (currentShift === 'ME') newShift = 'M';
             if (currentShift === 'EN') newShift = 'N';
             if (currentShift === 'MEN') newShift = 'MN';
           } else if (shiftChar === 'N') {
             if (currentShift === 'N') newShift = 'OFF';
             if (currentShift === 'MN') newShift = 'M';
             if (currentShift === 'EN') newShift = 'E';
             if (currentShift === 'MEN') newShift = 'ME';
           }
           assignments[p.id][d] = newShift;
        }
        return;
      }
      if (gap === 0) return;

      const getMNCount = (pId: string) => {
        let cnt = 0;
        for (let day = 1; day <= totalDays; day++) {
          if (assignments[pId][day] === 'MN') cnt++;
        }
        return cnt;
      };

      const getOnlyECount = (pId: string) => {
        let cnt = 0;
        for (let day = 1; day <= totalDays; day++) {
          if (assignments[pId][day] === 'E') cnt++;
        }
        return cnt;
      };

      const available = group.filter(p => {
        if (assignments[p.id][d].startsWith('L')) return false;
        
        const currentShift = assignments[p.id][d];
        
        if (shiftChar === 'M' && (currentShift === 'M' || currentShift === 'ME' || currentShift === 'MN' || currentShift === 'MEN')) return false;
        if (shiftChar === 'E' && (currentShift === 'E' || currentShift === 'ME' || currentShift === 'EN' || currentShift === 'MEN')) return false;
        if (shiftChar === 'N' && (currentShift === 'N' || currentShift === 'EN' || currentShift === 'MN' || currentShift === 'MEN')) return false;

        if ((p.position === 'supervisor' || p.position === 'staff')) {
          if (isHoliday || (!isHoliday && (shiftChar === 'E' || shiftChar === 'N'))) {
            const hasExplicitRequestForThisShift = (() => {
              const req = dailyRequests[p.id]?.[d];
              if (req && req.requestType === 'shift' && req.preferredShift) {
                const pref = req.preferredShift;
                if (shiftChar === 'M' && (pref === 'M' || pref === 'ME' || pref === 'MN' || pref === 'MEN')) return true;
                if (shiftChar === 'E' && (pref === 'E' || pref === 'ME' || pref === 'EN' || pref === 'MEN')) return true;
                if (shiftChar === 'N' && (pref === 'N' || pref === 'EN' || pref === 'MN' || pref === 'MEN')) return true;
              }
              const pReq = requests.find(r => r.personnelId === p.id && r.requestType === 'pattern');
              if (pReq && pReq.patternSteps && pReq.patternSteps.length > 0) {
                const stepVal = pReq.patternSteps[(d - 1) % pReq.patternSteps.length];
                if (shiftChar === 'M' && (stepVal === 'M' || stepVal === 'ME' || stepVal === 'MN' || stepVal === 'MEN')) return true;
                if (shiftChar === 'E' && (stepVal === 'E' || stepVal === 'ME' || stepVal === 'EN' || stepVal === 'MEN')) return true;
                if (shiftChar === 'N' && (stepVal === 'N' || stepVal === 'EN' || stepVal === 'MN' || stepVal === 'MEN')) return true;
              }
              return false;
            })();
            if (!hasExplicitRequestForThisShift) {
              return false;
            }
          }
        }

        if (shiftChar === 'N' && currentShift === 'M') {
          const isExplicit = dailyRequests[p.id]?.[d]?.requestType === 'shift' && dailyRequests[p.id]?.[d]?.preferredShift === 'MN';
          if (!isExplicit && getMNCount(p.id) >= 2) return false;
        }

        if (shiftChar === 'E' && currentShift === 'OFF') {
          const isExplicit = (dailyRequests[p.id]?.[d]?.requestType === 'shift' && dailyRequests[p.id]?.[d]?.preferredShift === 'E') ||
                             requests.some(r => r.personnelId === p.id && r.requestType === 'pattern' && r.patternSteps?.includes('E'));
          if (!isExplicit && getOnlyECount(p.id) >= 1) return false;
        }

        if (shiftChar === 'N' && currentShift === 'MEN' && d > 1 && assignments[p.id][d-1] === 'MEN') return false;

        if (shiftChar === 'N') {
          const workedN1 = d > 1 && (assignments[p.id][d-1] === 'N' || assignments[p.id][d-1] === 'EN' || assignments[p.id][d-1] === 'MN' || assignments[p.id][d-1] === 'MEN');
          const workedN2 = d > 2 && (assignments[p.id][d-2] === 'N' || assignments[p.id][d-2] === 'EN' || assignments[p.id][d-2] === 'MN' || assignments[p.id][d-2] === 'MEN');
          if (workedN1 && workedN2) return false;
        }

        if (shiftChar === 'M' && d > 1) {
          const prev = assignments[p.id][d-1];
          if (prev === 'N' || prev === 'EN' || prev === 'MN' || prev === 'MEN') return false;
        }

        if (d > 1 && ['ME', 'MEN', 'EN', 'N'].includes(assignments[p.id][d-1])) {
          const isExplicit = (() => {
            const req = dailyRequests[p.id]?.[d];
            if (req && req.requestType === 'shift') return true;
            const pReq = requests.find(r => r.personnelId === p.id && r.requestType === 'pattern');
            if (pReq && pReq.patternSteps && pReq.patternSteps.length > 0) {
              const stepVal = pReq.patternSteps[(d - 1) % pReq.patternSteps.length];
              if (stepVal !== 'OFF' && !stepVal.startsWith('L')) return true;
            }
            return false;
          })();
          
          if (!isExplicit) {
            return false;
          }
        }

        if (avoidedShifts[p.id]?.[d]?.has(shiftChar)) {
          return false;
        }

        const req = dailyRequests[p.id]?.[d];
        if (req) {
          if (req.requestType === 'OFF' || req.requestType === 'leave') {
            return false;
          }
          if (req.requestType === 'shift' && req.preferredShift) {
            const pref = req.preferredShift;
            const matchesM = shiftChar === 'M' && (pref === 'M' || pref === 'ME' || pref === 'MN' || pref === 'MEN');
            const matchesE = shiftChar === 'E' && (pref === 'E' || pref === 'ME' || pref === 'EN' || pref === 'MEN');
            const matchesN = shiftChar === 'N' && (pref === 'N' || pref === 'EN' || pref === 'MN' || pref === 'MEN');
            if (!matchesM && !matchesE && !matchesN) {
              return false;
            }
          }
        }

        if (p.employmentType === 'overtime') {
          let hrs = 0;
          for (let day = 1; day <= totalDays; day++) {
            hrs += getShiftHours(assignments[p.id][day], p.employmentType);
          }
          if (hrs + getShiftHours(shiftChar, p.employmentType) > 240.0) {
            return false;
          }
        }

        const hasRoutine = requests.some(r => r.personnelId === p.id && (r.requestType === 'shift' || r.requestType === 'pattern'));
        if (hasRoutine) {
          const isRequestedForThisDay = (() => {
            if (req && req.requestType === 'shift' && req.preferredShift) {
              const pref = req.preferredShift;
              return (shiftChar === 'M' && (pref === 'M' || pref === 'ME' || pref === 'MN' || pref === 'MEN')) ||
                     (shiftChar === 'E' && (pref === 'E' || pref === 'ME' || pref === 'EN' || pref === 'MEN')) ||
                     (shiftChar === 'N' && (pref === 'N' || pref === 'EN' || pref === 'MN' || pref === 'MEN'));
            }
            const pReq = requests.find(r => r.personnelId === p.id && r.requestType === 'pattern');
            if (pReq && pReq.patternSteps && pReq.patternSteps.length > 0) {
              const stepVal = pReq.patternSteps[(d - 1) % pReq.patternSteps.length];
              return (shiftChar === 'M' && (stepVal === 'M' || stepVal === 'ME' || stepVal === 'MN' || stepVal === 'MEN')) ||
                     (shiftChar === 'E' && (stepVal === 'E' || stepVal === 'ME' || stepVal === 'EN' || stepVal === 'MEN')) ||
                     (shiftChar === 'N' && (stepVal === 'N' || stepVal === 'EN' || stepVal === 'MN' || stepVal === 'MEN'));
            }
            return false;
          })();

          if (!isRequestedForThisDay) {
            if (getExtraShiftsCount(p.id) >= 2) {
              return false;
            }
          }
        }

        let prospectiveShift = currentShift;
        if (currentShift === 'OFF') {
          prospectiveShift = shiftChar;
        } else {
          if (currentShift === 'M' && shiftChar === 'E') prospectiveShift = 'ME';
          if (currentShift === 'M' && shiftChar === 'N') prospectiveShift = 'MN';
          if (currentShift === 'E' && shiftChar === 'N') prospectiveShift = 'EN';
          if (currentShift === 'ME' && shiftChar === 'N') prospectiveShift = 'MEN';
        }

        const isHeavy = (s: ShiftType) => s === 'MEN' || s === 'EN' || s === 'MN' || s === 'ME';

        if (isHeavy(prospectiveShift)) {
          if (d > 1) {
            const prev = assignments[p.id][d-1];
            if (isHeavy(prev)) return false;
          }
          if (d < totalDays) {
            const next = assignments[p.id][d+1];
            if (isHeavy(next)) return false;
          }
        }

        return true;
      });

      const empPriority: { [key: string]: number } = { conscript: 1, contract: 2, official: 3, overtime: 4 };
      available.sort((x, y) => {
        const getPenaltyScore = (p: Personnel) => {
          let score = 0;
          const curr = assignments[p.id][d];
          
          if (shiftChar === 'N' && curr === 'ME') {
            const isExplicit = dailyRequests[p.id]?.[d]?.requestType === 'shift' && dailyRequests[p.id]?.[d]?.preferredShift === 'MEN';
            if (!isExplicit) {
              score += 200000;
            }
          }

          if (shiftChar === 'N' && curr === 'M') {
            score += 100000;
          }
          
          if (shiftChar === 'E' && curr === 'OFF') {
            const isExplicit = (dailyRequests[p.id]?.[d]?.requestType === 'shift' && dailyRequests[p.id]?.[d]?.preferredShift === 'E') ||
                               requests.some(r => r.personnelId === p.id && r.requestType === 'pattern' && r.patternSteps?.includes('E'));
            if (!isExplicit) {
              score += 50000;
            }
          }
          
          if (shiftChar === 'N' && curr === 'OFF') {
            const isExplicit = (dailyRequests[p.id]?.[d]?.requestType === 'shift' && dailyRequests[p.id]?.[d]?.preferredShift === 'N') ||
                               requests.some(r => r.personnelId === p.id && r.requestType === 'pattern' && r.patternSteps?.includes('N'));
            if (!isExplicit) {
              score += 20000;
            }
          }

          return score;
        };

        const penX = getPenaltyScore(x);
        const penY = getPenaltyScore(y);
        if (penX !== penY) {
          return penX - penY;
        }

        const getShiftCountsForPerson = (pId: string) => {
          let mCount = 0, eCount = 0, nCount = 0;
          for (let day = 1; day <= totalDays; day++) {
            const s = assignments[pId][day];
            if (s === 'M' || s === 'ME' || s === 'MN' || s === 'MEN') mCount++;
            if (s === 'E' || s === 'ME' || s === 'EN' || s === 'MEN') eCount++;
            if (s === 'N' || s === 'EN' || s === 'MN' || s === 'MEN') nCount++;
          }
          return { mCount, eCount, nCount };
        };

        const qualifiesForProdSecRow = (ap: Personnel) => {
          if (ap.employmentType === 'conscript' || ap.position === 'supervisor' || ap.position === 'staff') return false;
          const counts = getShiftCountsForPerson(ap.id);
          const reqM = ap.jobGroup === 'assistant' ? 5 : 3;
          if (shiftChar === 'M') return counts.mCount < reqM;
          if (shiftChar === 'E') return counts.eCount < 3;
          if (shiftChar === 'N') return counts.nCount < 3;
          return false;
        };

        const prodX = qualifiesForProdSecRow(x);
        const prodY = qualifiesForProdSecRow(y);
        if (prodX && !prodY) return -1;
        if (!prodX && prodY) return 1;

        const hasRoutineX = requests.some(r => r.personnelId === x.id && (r.requestType === 'shift' || r.requestType === 'pattern'));
        const hasRoutineY = requests.some(r => r.personnelId === y.id && (r.requestType === 'shift' || r.requestType === 'pattern'));
        
        const isXRequested = (() => {
          const reqX = dailyRequests[x.id]?.[d];
          if (reqX && reqX.requestType === 'shift' && reqX.preferredShift) {
            const pref = reqX.preferredShift;
            return (shiftChar === 'M' && (pref === 'M' || pref === 'ME' || pref === 'MN' || pref === 'MEN')) ||
                   (shiftChar === 'E' && (pref === 'E' || pref === 'ME' || pref === 'EN' || pref === 'MEN')) ||
                   (shiftChar === 'N' && (pref === 'N' || pref === 'EN' || pref === 'MN' || pref === 'MEN'));
          }
          return false;
        })();
        const isYRequested = (() => {
          const reqY = dailyRequests[y.id]?.[d];
          if (reqY && reqY.requestType === 'shift' && reqY.preferredShift) {
            const pref = reqY.preferredShift;
            return (shiftChar === 'M' && (pref === 'M' || pref === 'ME' || pref === 'MN' || pref === 'MEN')) ||
                   (shiftChar === 'E' && (pref === 'E' || pref === 'ME' || pref === 'EN' || pref === 'MEN')) ||
                   (shiftChar === 'N' && (pref === 'N' || pref === 'EN' || pref === 'MN' || pref === 'MEN'));
          }
          return false;
        })();

        const routinePenaltyX = hasRoutineX && !isXRequested;
        const routinePenaltyY = hasRoutineY && !isYRequested;

        if (routinePenaltyX && !routinePenaltyY) return 1;
        if (!routinePenaltyX && routinePenaltyY) return -1;

        let hoursX = 0;
        let hoursY = 0;
        for (let day = 1; day <= totalDays; day++) {
          hoursX += getShiftHours(assignments[x.id][day], x.employmentType);
          hoursY += getShiftHours(assignments[y.id][day], y.employmentType);
        }

        const effectiveDuty = monthlyDutyHours || settings.dutyHours;
        const targetX = x.employmentType === 'overtime' ? 0 : (effectiveDuty[x.employmentType] || 0);
        const targetY = y.employmentType === 'overtime' ? 0 : (effectiveDuty[y.employmentType] || 0);

        const defX = targetX - hoursX;
        const defY = targetY - hoursY;

        const hasDeficitX = defX > 0;
        const hasDeficitY = defY > 0;

        if (hasDeficitX && !hasDeficitY) return -1;
        if (!hasDeficitX && hasDeficitY) return 1;

        if (hasDeficitX && hasDeficitY) {
          if (Math.abs(defX - defY) > 0.1) {
            return defY - defX;
          }
        } else {
          if (Math.abs(hoursX - hoursY) > 0.1) {
            return hoursX - hoursY;
          }
        }

        const pX = empPriority[x.employmentType] || 5;
        const pY = empPriority[y.employmentType] || 5;
        if (pX !== pY) return pX - pY;

        return 0;
      });

      for (let i = 0; i < available.length && gap > 0; i++) {
        const p = available[i];
        if (assignments[p.id][d] === 'OFF') {
          assignments[p.id][d] = shiftChar;
        } else {
          const prevS = assignments[p.id][d];
          if (prevS === 'M' && shiftChar === 'E') assignments[p.id][d] = 'ME';
          if (prevS === 'M' && shiftChar === 'N') assignments[p.id][d] = 'MN';
          if (prevS === 'E' && shiftChar === 'N') assignments[p.id][d] = 'EN';
          if (prevS === 'ME' && shiftChar === 'N') assignments[p.id][d] = 'MEN';
        }
        gap--;
      }

      if (gap > 0) {
        let forceAvailable = group.filter(p => {
          if (assignments[p.id][d].startsWith('L')) return false;
          const currentShift = assignments[p.id][d];
          if (shiftChar === 'M' && (currentShift === 'M' || currentShift === 'ME' || currentShift === 'MN' || currentShift === 'MEN')) return false;
          if (shiftChar === 'E' && (currentShift === 'E' || currentShift === 'ME' || currentShift === 'EN' || currentShift === 'MEN')) return false;
          if (shiftChar === 'N' && (currentShift === 'N' || currentShift === 'EN' || currentShift === 'MN' || currentShift === 'MEN')) return false;
          return true;
        });

        forceAvailable.sort((x, y) => {
           let hoursX = 0; let hoursY = 0;
           for (let day = 1; day <= totalDays; day++) {
             hoursX += getShiftHours(assignments[x.id][day], x.employmentType);
             hoursY += getShiftHours(assignments[y.id][day], y.employmentType);
           }
           if (Math.abs(hoursX - hoursY) > 0.1) {
             return hoursX - hoursY;
           }
           const isHeavy = (s: string) => s === 'MEN' || s === 'MN' || s === 'EN' || s === 'ME' ? 1 : 0;
           const hX = isHeavy(assignments[x.id][d]);
           const hY = isHeavy(assignments[y.id][d]);
           if (hX !== hY) return hX - hY;
           return 0;
        });

        for (let i = 0; i < forceAvailable.length && gap > 0; i++) {
           const p = forceAvailable[i];
           if (assignments[p.id][d] === 'OFF') {
             assignments[p.id][d] = shiftChar;
           } else {
             const prevS = assignments[p.id][d];
             if (prevS === 'M' && shiftChar === 'E') assignments[p.id][d] = 'ME';
             if (prevS === 'M' && shiftChar === 'N') assignments[p.id][d] = 'MN';
             if (prevS === 'E' && shiftChar === 'N') assignments[p.id][d] = 'EN';
             if (prevS === 'ME' && shiftChar === 'N') assignments[p.id][d] = 'MEN';
           }
           gap--;
        }

        if (gap > 0) {
          const grpName = group[0]?.jobGroup === 'assistant' ? 'کمک بهیار' : 'پرستار';
          warnings.push(`Coverage Shortage: کمبود نیرو (${grpName}) در روز ${d} شیفت ${shiftChar}`);
        }
      }
    };

    fillGroupGaps(assistants, 'M', morningAssistantDemand, mAssignedAsst);
    fillGroupGaps(assistants, 'E', afternoonAssistantDemand, eAssignedAsst);
    fillGroupGaps(assistants, 'N', nightAssistantDemand, nAssignedAsst);

    // B. Fill Nurse Shifts
    const morningNurseDemand = demand.morningNurse;
    const afternoonNurseDemand = demand.afternoonNurse;
    const nightNurseDemand = demand.nightNurse;

    let mAssignedNurse = nurses.filter(n => assignments[n.id][d] === 'M' || assignments[n.id][d] === 'ME' || assignments[n.id][d] === 'MN' || assignments[n.id][d] === 'MEN').length;
    let eAssignedNurse = nurses.filter(n => assignments[n.id][d] === 'E' || assignments[n.id][d] === 'ME' || assignments[n.id][d] === 'EN' || assignments[n.id][d] === 'MEN').length;
    let nAssignedNurse = nurses.filter(n => assignments[n.id][d] === 'N' || assignments[n.id][d] === 'EN' || assignments[n.id][d] === 'MN' || assignments[n.id][d] === 'MEN').length;

    fillGroupGaps(nurses, 'M', morningNurseDemand, mAssignedNurse);
    fillGroupGaps(nurses, 'E', afternoonNurseDemand, eAssignedNurse);
    fillGroupGaps(nurses, 'N', nightNurseDemand, nAssignedNurse);
  }

  // 6. Post-process OFF and consecutive constraints
  activePersonnel.forEach(p => {
    for (let d = 2; d <= totalDays; d++) {
      const prevS = assignments[p.id][d-1];
      const currS = assignments[p.id][d];
      
      if (prevS.startsWith('L') && currS === 'OFF') {
        const shouldAvoidM = avoidedShifts[p.id]?.[d]?.has('M');
        if (!shouldAvoidM) {
          assignments[p.id][d] = 'M';
          warnings.push(`OFF Removed: حذف OFF ناخواسته پرسنل ${p.firstName} ${p.lastName} در روز ${d} به دلیل قانون ممنوعیت آف بعد از مرخصی`);
        } else {
          const shouldAvoidE = avoidedShifts[p.id]?.[d]?.has('E');
          if (!shouldAvoidE) {
            assignments[p.id][d] = 'E';
            warnings.push(`OFF Removed: حذف OFF ناخواسته پرسنل ${p.firstName} ${p.lastName} در روز ${d} به دلیل قانون ممنوعیت آف بعد از مرخصی (تبدیل به عصر به دلیل محدودیت شیفت صبح)`);
          }
        }
      }
    }

    let consecutiveOff = 0;
    for (let d = 1; d <= totalDays; d++) {
      if (assignments[p.id][d] === 'OFF') {
        consecutiveOff++;
        if (consecutiveOff > 3) {
          const shouldAvoidM = avoidedShifts[p.id]?.[d]?.has('M');
          if (!shouldAvoidM) {
            assignments[p.id][d] = 'M';
            consecutiveOff = 0;
            warnings.push(`OFF Removed: لغو مرخصی آف یا آف متوالی ۴ روزه پرسنل ${p.firstName} ${p.lastName} در روز ${d} جهت رعایت سقف ۳ روز متوالی`);
          } else {
            const shouldAvoidE = avoidedShifts[p.id]?.[d]?.has('E');
            if (!shouldAvoidE) {
              assignments[p.id][d] = 'E';
              consecutiveOff = 0;
              warnings.push(`OFF Removed: لغو مرخصی آف یا آف متوالی ۴ روزه پرسنل ${p.firstName} ${p.lastName} در روز ${d} جهت رعایت سقف ۳ روز متوالی (تبدیل به عصر به دلیل محدودیت صبح)`);
            }
          }
        }
      } else {
        consecutiveOff = 0;
      }
    }
  });

  // 7. Select and Assign Shift Leaders
  for (let d = 1; d <= totalDays; d++) {
    const isHoliday = calendar[d - 1].isHoliday;
    
    if (isHoliday) {
      const isSuperPresent = supervisor && (assignments[supervisor.id][d] === 'M' || assignments[supervisor.id][d] === 'ME' || assignments[supervisor.id][d] === 'MN' || assignments[supervisor.id][d] === 'MEN');
      const isStaffPresent = staffs.some(st => {
        const s = assignments[st.id][d];
        return s === 'M' || s === 'ME' || s === 'MN' || s === 'MEN';
      });

      if (isSuperPresent || isStaffPresent) {
        shiftLeaders[d].morning = isSuperPresent ? supervisor?.id : staffs.find(st => {
          const s = assignments[st.id][d];
          return s === 'M' || s === 'ME' || s === 'MN' || s === 'MEN';
        })?.id;
      } else {
        const leader = nurses.find(n => {
          if (n.position !== 'general' || !n.canBeShiftLeader) return false;
          const s = assignments[n.id][d];
          return s === 'M' || s === 'ME' || s === 'MN' || s === 'MEN';
        });
        if (leader) {
          shiftLeaders[d].morning = leader.id;
        } else {
          warnings.push(`Missing Shift Leader: نبود سرشیفت در نوبت صبح روز تعطیل ${d}`);
        }
      }
    }

    const activeStaffE = staffs.find(st => {
      const s = assignments[st.id][d];
      return s === 'E' || s === 'ME' || s === 'EN' || s === 'MEN';
    });

    if (activeStaffE) {
      shiftLeaders[d].afternoon = activeStaffE.id;
    } else {
      const leader = nurses.find(n => {
        if (n.position !== 'general' || !n.canBeShiftLeader) return false;
        const s = assignments[n.id][d];
        return s === 'E' || s === 'ME' || s === 'EN' || s === 'MEN';
      });
      if (leader) {
        shiftLeaders[d].afternoon = leader.id;
      } else {
        warnings.push(`Missing Shift Leader: نبود سرشیفت در نوبت عصر روز ${d}`);
      }
    }

    const afternoonLeaderId = shiftLeaders[d].afternoon;
    if (afternoonLeaderId) {
      const afterS = assignments[afternoonLeaderId][d];
      if (afterS === 'EN') {
        shiftLeaders[d].night = afternoonLeaderId;
        continue;
      }
    }

    const activeStaffN = staffs.find(st => {
      const s = assignments[st.id][d];
      return s === 'N' || s === 'EN' || s === 'MN' || s === 'MEN';
    });
    if (activeStaffN) {
      shiftLeaders[d].night = activeStaffN.id;
    } else {
      const leader = nurses.find(n => {
        if (n.position !== 'general' || !n.canBeShiftLeader) return false;
        const s = assignments[n.id][d];
        return s === 'N' || s === 'EN' || s === 'MN' || s === 'MEN';
      });
      if (leader) {
        shiftLeaders[d].night = leader.id;
      } else {
        warnings.push(`Missing Shift Leader: نبود سرشیفت در نوبت شب روز ${d}`);
      }
    }
  }

  const verification = verifyCoverageAndLeaders(year, month, activePersonnel, assignments, settings, customHolidays, firstDayOfWeekIndex, requests);
  const combinedWarnings = Array.from(new Set([...warnings, ...verification.warnings]));

  return {
    year,
    month,
    assignments,
    shiftLeaders: verification.shiftLeaders,
    warnings: combinedWarnings
  };
}

// ====== تابع verifyCoverageAndLeaders ======
export function verifyCoverageAndLeaders(
  year: number,
  month: number,
  personnelList: readonly Personnel[],
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  settings: SystemSettings,
  customHolidays: Readonly<Record<number, string>> = {},
  firstDayOfWeekIndex?: number,
  requests: readonly ShiftRequest[] = []
): { warnings: string[], shiftLeaders: { [day: number]: { morning?: string; afternoon?: string; night?: string } } } {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const totalDays = calendar.length;
  const warnings: string[] = [];
  const shiftLeaders: { [day: number]: { morning?: string; afternoon?: string; night?: string } } = {};
  for (let i = 1; i <= totalDays; i++) shiftLeaders[i] = {};

  const activePersonnel = personnelList.filter(p => p.active);
  const assistants = activePersonnel.filter(p => p.jobGroup === 'assistant');
  const nurses = activePersonnel.filter(p => p.jobGroup === 'nurse');
  const staffs = activePersonnel.filter(p => p.position === 'staff');
  const supervisor = activePersonnel.find(p => p.position === 'supervisor');

  for (let d = 1; d <= totalDays; d++) {
    const isHoliday = calendar[d - 1].isHoliday;
    const demand = isHoliday ? settings.demand.holiday : settings.demand.weekday;

    let mAssignedAsst = assistants.filter(a => assignments[a.id]?.[d] && ['M','ME','MN','MEN'].includes(assignments[a.id][d])).length;
    let eAssignedAsst = assistants.filter(a => assignments[a.id]?.[d] && ['E','ME','EN','MEN'].includes(assignments[a.id][d])).length;
    let nAssignedAsst = assistants.filter(a => assignments[a.id]?.[d] && ['N','EN','MN','MEN'].includes(assignments[a.id][d])).length;

    if (mAssignedAsst < demand.morningAssistant) warnings.push(`Coverage Shortage: کمبود نیرو (کمک بهیار) در روز ${d} شیفت M`);
    if (eAssignedAsst < demand.afternoonAssistant) warnings.push(`Coverage Shortage: کمبود نیرو (کمک بهیار) در روز ${d} شیفت E`);
    if (nAssignedAsst < demand.nightAssistant) warnings.push(`Coverage Shortage: کمبود نیرو (کمک بهیار) در روز ${d} شیفت N`);
    
    if (mAssignedAsst > demand.morningAssistant) warnings.push(`Overstaffing: نیروی مازاد (کمک بهیار) در روز ${d} شیفت M`);
    if (eAssignedAsst > demand.afternoonAssistant) warnings.push(`Overstaffing: نیروی مازاد (کمک بهیار) در روز ${d} شیفت E`);
    if (nAssignedAsst > demand.nightAssistant) warnings.push(`Overstaffing: نیروی مازاد (کمک بهیار) در روز ${d} شیفت N`);

    let mAssignedNurse = nurses.filter(n => assignments[n.id]?.[d] && ['M','ME','MN','MEN'].includes(assignments[n.id][d])).length;
    let eAssignedNurse = nurses.filter(n => assignments[n.id]?.[d] && ['E','ME','EN','MEN'].includes(assignments[n.id][d])).length;
    let nAssignedNurse = nurses.filter(n => assignments[n.id]?.[d] && ['N','EN','MN','MEN'].includes(assignments[n.id][d])).length;

    if (mAssignedNurse < demand.morningNurse) warnings.push(`Coverage Shortage: کمبود نیرو (پرستار) در روز ${d} شیفت M`);
    if (eAssignedNurse < demand.afternoonNurse) warnings.push(`Coverage Shortage: کمبود نیرو (پرستار) در روز ${d} شیفت E`);
    if (nAssignedNurse < demand.nightNurse) warnings.push(`Coverage Shortage: کمبود نیرو (پرستار) در روز ${d} شیفت N`);

    if (mAssignedNurse > demand.morningNurse) warnings.push(`Overstaffing: نیروی مازاد (پرستار) در روز ${d} شیفت M`);
    if (eAssignedNurse > demand.afternoonNurse) warnings.push(`Overstaffing: نیروی مازاد (پرستار) در روز ${d} شیفت E`);
    if (nAssignedNurse > demand.nightNurse) warnings.push(`Overstaffing: نیروی مازاد (پرستار) در روز ${d} شیفت N`);

    if (isHoliday) {
      const isSuperPresent = supervisor && assignments[supervisor.id]?.[d] && ['M','ME','MN','MEN'].includes(assignments[supervisor.id][d]);
      const isStaffPresent = staffs.some(st => assignments[st.id]?.[d] && ['M','ME','MN','MEN'].includes(assignments[st.id][d]));

      if (isSuperPresent || isStaffPresent) {
        shiftLeaders[d].morning = isSuperPresent ? supervisor?.id : staffs.find(st => assignments[st.id]?.[d] && ['M','ME','MN','MEN'].includes(assignments[st.id][d]))?.id;
      } else {
        const leader = nurses.find(n => n.position === 'general' && n.canBeShiftLeader && assignments[n.id]?.[d] && ['M','ME','MN','MEN'].includes(assignments[n.id][d]));
        if (leader) shiftLeaders[d].morning = leader.id;
        else warnings.push(`Missing Shift Leader: نبود سرشیفت در نوبت صبح روز تعطیل ${d}`);
      }
    }

    const activeStaffE = staffs.find(st => assignments[st.id]?.[d] && ['E','ME','EN','MEN'].includes(assignments[st.id][d]));
    if (activeStaffE) {
      shiftLeaders[d].afternoon = activeStaffE.id;
    } else {
      const leader = nurses.find(n => n.position === 'general' && n.canBeShiftLeader && assignments[n.id]?.[d] && ['E','ME','EN','MEN'].includes(assignments[n.id][d]));
      if (leader) shiftLeaders[d].afternoon = leader.id;
      else warnings.push(`Missing Shift Leader: نبود سرشیفت در نوبت عصر روز ${d}`);
    }

    const afternoonLeaderId = shiftLeaders[d].afternoon;
    if (afternoonLeaderId && assignments[afternoonLeaderId]?.[d] === 'EN') {
      shiftLeaders[d].night = afternoonLeaderId;
    } else {
      const activeStaffN = staffs.find(st => assignments[st.id]?.[d] && ['N','EN','MN','MEN'].includes(assignments[st.id][d]));
      if (activeStaffN) {
        shiftLeaders[d].night = activeStaffN.id;
      } else {
        const leader = nurses.find(n => n.position === 'general' && n.canBeShiftLeader && assignments[n.id]?.[d] && ['N','EN','MN','MEN'].includes(assignments[n.id][d]));
        if (leader) shiftLeaders[d].night = leader.id;
        else warnings.push(`Missing Shift Leader: نبود سرشیفت در نوبت شب روز ${d}`);
      }
    }
  }

  if (requests && requests.length > 0) {
    activePersonnel.forEach(p => {
      for (let d = 1; d <= totalDays; d++) {
        const dateInfo = calendar[d - 1];
        const assigned = assignments[p.id]?.[d] || 'OFF';

        const personRequests = requests.filter(r => r.personnelId === p.id);
        
        personRequests.forEach(req => {
          let matchesScope = false;

          if (req.scope === 'all') {
            matchesScope = true;
          } else if (req.scope === 'even' && d % 2 === 0) {
            matchesScope = true;
          } else if (req.scope === 'odd' && d % 2 !== 0) {
            matchesScope = true;
          } else if (req.scope === 'saturdays' && dateInfo.dayOfWeek === 0) {
            matchesScope = true;
          } else if (req.scope === 'sundays' && dateInfo.dayOfWeek === 1) {
            matchesScope = true;
          } else if (req.scope === 'mondays' && dateInfo.dayOfWeek === 2) {
            matchesScope = true;
          } else if (req.scope === 'tuesdays' && dateInfo.dayOfWeek === 3) {
            matchesScope = true;
          } else if (req.scope === 'wednesdays' && dateInfo.dayOfWeek === 4) {
            matchesScope = true;
          } else if (req.scope === 'thursdays' && dateInfo.dayOfWeek === 5) {
            matchesScope = true;
          } else if (req.scope === 'fridays' && dateInfo.dayOfWeek === 6) {
            matchesScope = true;
          } else if (req.scope === 'weekly_even' && (dateInfo.dayOfWeek === 0 || dateInfo.dayOfWeek === 2 || dateInfo.dayOfWeek === 4)) {
            matchesScope = true;
          } else if (req.scope === 'weekly_odd' && (dateInfo.dayOfWeek === 1 || dateInfo.dayOfWeek === 3 || dateInfo.dayOfWeek === 5)) {
            matchesScope = true;
          } else if (req.scope === 'custom_days' && req.selectedDays && req.selectedDays.includes(d)) {
            matchesScope = true;
          } else if (req.scope === 'range' && req.startDate && req.endDate) {
            const currentStr = `${year}/${month < 10 ? '0' + month : month}/${d < 10 ? '0' + d : d}`;
            const startNormalized = req.startDate.replace(/\//g, '-');
            const endNormalized = req.endDate.replace(/\//g, '-');
            const currNormalized = currentStr.replace(/\//g, '-');
            if (currNormalized >= startNormalized && currNormalized <= endNormalized) {
              matchesScope = true;
            }
          }

          if (matchesScope) {
            if (req.requestType === 'avoid_shift') {
              const pref = req.preferredShift;
              if (pref) {
                const violates = (pref === 'M' && ['M', 'ME', 'MN', 'MEN'].includes(assigned)) ||
                                 (pref === 'E' && ['E', 'ME', 'EN', 'MEN'].includes(assigned)) ||
                                 (pref === 'N' && ['N', 'EN', 'MN', 'MEN'].includes(assigned)) ||
                                 (assigned === pref);
                if (violates) {
                  warnings.push(`Mismatched Request: برای ${p.firstName} ${p.lastName} در روز ${d} تداخل با درخواست عدم تخصیص شیفت ${pref} وجود دارد (شیفت ${assigned} تخصیص داده شده)`);
                }
              }
            } else if (req.requestType === 'OFF') {
              if (assigned !== 'OFF' && !assigned.startsWith('L')) {
                warnings.push(`Mismatched Request: برای ${p.firstName} ${p.lastName} در روز ${d} درخواست OFF ثبت شده اما شیفت ${assigned} تخصیص یافته است`);
              }
            } else if (req.requestType === 'leave') {
              if (!assigned.startsWith('L')) {
                warnings.push(`Mismatched Request: برای ${p.firstName} ${p.lastName} در روز ${d} درخواست مرخصی ثبت شده اما شیفت ${assigned} تخصیص یافته است`);
              }
            } else if (req.requestType === 'shift') {
              const pref = req.preferredShift;
              if (pref) {
                const matches = (pref === 'M' && ['M', 'ME', 'MN', 'MEN'].includes(assigned)) ||
                                (pref === 'E' && ['E', 'ME', 'EN', 'MEN'].includes(assigned)) ||
                                (pref === 'N' && ['N', 'EN', 'MN', 'MEN'].includes(assigned)) ||
                                (assigned === pref);
                if (!matches) {
                  warnings.push(`Mismatched Request: برای ${p.firstName} ${p.lastName} در روز ${d} درخواست شیفت ${pref} ثبت شده اما شیفت ${assigned} تخصیص یافته است`);
                }
              }
            }
          }
        });
      }
    });
  }

  activePersonnel.forEach(p => {
    let consecutiveOffDays: number[] = [];
    for (let d = 1; d <= totalDays; d++) {
      const assigned = assignments[p.id]?.[d] || 'OFF';
      if (assigned === 'OFF') {
        consecutiveOffDays.push(d);
      } else {
        if (consecutiveOffDays.length >= 4) {
          warnings.push(
            `Consecutive OFFs: عدم رعایت سقف آف متوالی (بیش از ۳ روز متوالی) برای ${p.firstName} ${p.lastName} از روز ${consecutiveOffDays[0]} تا روز ${consecutiveOffDays[consecutiveOffDays.length - 1]} به مدت ${consecutiveOffDays.length} روز متوالی`
          );
        }
        consecutiveOffDays = [];
      }
    }
    if (consecutiveOffDays.length >= 4) {
      warnings.push(
        `Consecutive OFFs: عدم رعایت سقف آف متوالی (بیش از ۳ روز متوالی) برای ${p.firstName} ${p.lastName} از روز ${consecutiveOffDays[0]} تا روز ${consecutiveOffDays[consecutiveOffDays.length - 1]} به مدت ${consecutiveOffDays.length} روز متوالی`
      );
    }
  });

  return { warnings: Array.from(new Set(warnings)), shiftLeaders };
}

// ====== تابع generatePersonnelReports ======
export function generatePersonnelReports(
  year: number,
  month: number,
  personnelList: Personnel[],
  schedule: MonthlySchedule,
  settings: SystemSettings,
  customHolidays: { [day: number]: string } = {},
  firstDayOfWeekIndex?: number,
  monthlyDutyHours?: any
): PersonnelReportResult[] {
  
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const totalDays = calendar.length;

  return personnelList.map(p => {
    let mCount = 0;
    let eCount = 0;
    let nCount = 0;
    let meCount = 0;
    let enCount = 0;
    let mnCount = 0;
    let menCount = 0;
    let offCount = 0;
    let leaveCount = 0;

    const pAssignments = schedule.assignments[p.id] || {};
    const assignmentsList: ShiftType[] = [];

    for (let d = 1; d <= totalDays; d++) {
      const shift = pAssignments[d] || 'OFF';
      assignmentsList.push(shift);

      if (shift === 'M') mCount++;
      else if (shift === 'E') eCount++;
      else if (shift === 'N') nCount++;
      else if (shift === 'ME') meCount++;
      else if (shift === 'EN') enCount++;
      else if (shift === 'MN') mnCount++;
      else if (shift === 'MEN') menCount++;
      else if (shift === 'OFF') offCount++;
      else if (shift.startsWith('L')) leaveCount++;
    }

    let workedHours = 
      mCount * SHIFT_HOURS.M +
      eCount * SHIFT_HOURS.E +
      nCount * SHIFT_HOURS.N +
      meCount * SHIFT_HOURS.ME +
      enCount * SHIFT_HOURS.EN +
      mnCount * SHIFT_HOURS.MN +
      menCount * SHIFT_HOURS.MEN;

    // Clarification: If personnel is on leave on holiday, count 7 hours for that day
    // Previously holiday leave was converted to OFF; now it is kept as L and counts as 7h on holiday, employment-based otherwise
    let leaveHours = 0;
    for (let d = 1; d <= totalDays; d++) {
      const shift = pAssignments[d] || 'OFF';
      if (!shift.startsWith('L')) continue;
      const isHoliday = calendar[d - 1]?.isHoliday;
      if (isHoliday) {
        leaveHours += 7.0; // per user request: 7 hours if leave on holiday
      } else {
        leaveHours += getLeaveHours(p.employmentType);
      }
    }
    workedHours += leaveHours;

    const experienceHours = getSeniorityHours(p);

    let nonHolidayM = 0;
    let nonHolidayE = 0;
    let nonHolidayN = 0;

    for (let d = 1; d <= totalDays; d++) {
      const shift = pAssignments[d] || 'OFF';
      const isHoliday = calendar[d - 1].isHoliday;

      if (!isHoliday) {
        if (shift === 'M' || shift === 'ME' || shift === 'MN' || shift === 'MEN') nonHolidayM++;
        if (shift === 'E' || shift === 'ME' || shift === 'EN' || shift === 'MEN') nonHolidayE++;
        if (shift === 'N' || shift === 'EN' || shift === 'MN' || shift === 'MEN') nonHolidayN++;
      }
    }

    const isEmpOfficialOrContract = p.employmentType === 'official' || p.employmentType === 'contract';
    const isSupervisorOrStaff = p.position === 'supervisor' || p.position === 'staff';
    
    let isEligibleForOtAndProd = true;
    if (isEmpOfficialOrContract && !isSupervisorOrStaff) {
      if (nonHolidayM < 3 || nonHolidayE < 3 || nonHolidayN < 3) {
        isEligibleForOtAndProd = false;
      }
    }

    const baseProductivityEligible = checkProductivityEligibility(p, assignmentsList);
    const productivityEligible = baseProductivityEligible && isEligibleForOtAndProd;
    let productivityHours = 0;
    if (productivityEligible) {
      for (let d = 1; d <= totalDays; d++) {
        const shift = pAssignments[d] || 'OFF';
        const isHoliday = calendar[d - 1].isHoliday;
        productivityHours += calculateShiftProductivity(shift, isHoliday);
      }
    }

    const effectiveDutyHoursConfig = monthlyDutyHours || settings.dutyHours;
    let dutyHours = 0;
    if (p.employmentType === 'official') dutyHours = effectiveDutyHoursConfig.official;
    else if (p.employmentType === 'contract') dutyHours = effectiveDutyHoursConfig.contract;
    else if (p.employmentType === 'conscript') dutyHours = effectiveDutyHoursConfig.conscript;
    else if (p.employmentType === 'overtime') dutyHours = 0;

    const netBalance = workedHours - dutyHours;
    let overtimeHours = netBalance > 0 ? netBalance : 0;
    if (!isEligibleForOtAndProd) {
      overtimeHours = 0;
    }
    const deficitHours = netBalance < 0 ? Math.abs(netBalance) : 0;

    const jobGroupText = p.jobGroup === 'nurse' ? 'پرستار' : 'کمک بهیار';
    let positionText = 'کمک بهیار';
    if (p.jobGroup === 'nurse') {
      if (p.position === 'supervisor') positionText = 'سرپرستار';
      else if (p.position === 'staff') positionText = 'استاف';
      else positionText = 'کارشناس عمومی';
    }

    let employmentTypeText = 'رسمی';
    if (p.employmentType === 'contract') employmentTypeText = 'قراردادی';
    else if (p.employmentType === 'conscript') employmentTypeText = 'وظیفه';
    else if (p.employmentType === 'overtime') employmentTypeText = 'اضافه‌کار';

    return {
      personnelId: p.id,
      name: `${p.firstName} ${p.lastName}`,
      personalCode: p.personalCode,
      jobGroupText,
      positionText,
      employmentTypeText,
      dutyHours,
      workedHours: Number(workedHours.toFixed(2)),
      overtimeHours: Number(overtimeHours.toFixed(2)),
      deficitHours: Number(deficitHours.toFixed(2)),
      experienceHours: Number(experienceHours.toFixed(2)),
      productivityHours: Number(productivityHours.toFixed(2)),
      mCount,
      eCount,
      nCount,
      meCount,
      enCount,
      mnCount,
      menCount,
      offCount,
      leaveCount,
      productivityEligible
    };
  });
}

// ====== تابع calculateAutoDutyHours ======
export function calculateAutoDutyHours(
  year: number,
  month: number,
  customHolidays: { [day: number]: string } = {},
  firstDayOfWeekIndex?: number
): { official: number; contract: number } {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const totalDays = calendar.length;
  const holidaysCount = calendar.filter(d => d.isHoliday).length;
  const X = totalDays - holidaysCount;
  const thursdaysNonHolidayCount = calendar.filter(d => d.dayOfWeek === 5 && !d.isHoliday).length;
  const Y = thursdaysNonHolidayCount * 2;
  const z = (X * 7) - Y;
  
  return {
    official: z,
    contract: z + 14
  };
}
