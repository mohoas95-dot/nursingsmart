// lib/solver.ts - Intelligent Multi-Scenario Optimization Engine
import { 
  Personnel, 
  SystemSettings, 
  ShiftRequest, 
  MonthlySchedule, 
  ShiftType, 
  PersonnelReportResult, 
  OptimizationResult, 
  ScenarioResult, 
  ScheduleSummary 
} from './types';
import { generateJalaliMonthCalendar, getJalaliMonthDays, getJalaliWeekday } from './jalali';

export const SCENARIO_COUNT = 500; 

export const SHIFT_HOURS: { [key in ShiftType]: number } = {
  M: 6.5, E: 6.5, N: 12.5, ME: 13.0, EN: 19.0, MN: 19.0, MEN: 25.5, OFF: 0.0,
  L1: 7.0, L2: 7.0, L3: 7.0, L4: 7.0, L5: 7.0
};

export function getShiftHours(shift: string, employmentType: string): number {
  if (shift.startsWith('L')) return getLeaveHours(employmentType);
  return SHIFT_HOURS[shift as ShiftType] || 0.0;
}

export function getLeaveHours(employmentType: string): number {
  switch (employmentType) {
    case 'official': return 7.0;
    case 'contract': return 7.5;
    case 'conscript': return 7.666;
    default: return 7.0;
  }
}

export function getSeniorityHours(personnel: Personnel): number {
  if (personnel.employmentType === 'conscript') return 0;
  if (personnel.jobGroup === 'assistant') return 12.0;
  const years = personnel.experienceYears;
  if (years >= 0 && years <= 4) return 4.0;
  if (years >= 5 && years <= 8) return 8.0;
  if (years >= 9 && years <= 12) return 12.0;
  const extraYears = years - 12;
  const extraSlots = Math.floor(extraYears / 4);
  return 12.0 + (extraSlots * 4.0);
}

/**
 * Calculate productivity eligibility based on position and shift counts
 */
export function checkProductivityEligibility(personnel: Personnel, assignments: ShiftType[]): boolean {
  if (personnel.employmentType === 'conscript') return false;
  if (personnel.position === 'supervisor') return true;

  let mCount = 0, eCount = 0, nCount = 0;
  assignments.forEach((shift) => {
    if (['M', 'ME', 'MN', 'MEN'].includes(shift)) mCount++;
    if (['E', 'ME', 'EN', 'MEN'].includes(shift)) eCount++;
    if (['N', 'EN', 'MN', 'MEN'].includes(shift)) nCount++;
  });

  if (personnel.position === 'staff') return mCount >= 10 && eCount >= 1 && nCount >= 1;
  if (personnel.position === 'general') return mCount >= 3 && eCount >= 3 && nCount >= 3;
  if (personnel.jobGroup === 'assistant') return mCount >= 5 && eCount >= 3 && nCount >= 3;

  return false;
}

/**
 * Calculate individual productivity hours for a specific shift
 */
export function calculateShiftProductivity(shift: ShiftType, isHoliday: boolean): number {
  if (isHoliday) {
    if (shift === 'M' || shift === 'E') return 3.0;
    if (shift === 'N' || shift === 'ME') return 6.0;
    if (shift === 'EN' || shift === 'MN') return 9.0;
    if (shift === 'MEN') return 12.0;
  } else {
    if (['N', 'EN', 'MN', 'MEN'].includes(shift)) return 3.0;
  }
  return 0.0;
}

/**
 * Advanced Scorer & Fairness Engine
 */
export function calculateDetailedScore(
  schedule: MonthlySchedule,
  personnel: Personnel[],
  requests: ShiftRequest[],
  settings: SystemSettings,
  customHolidays: { [day: number]: string },
  firstDayOfWeekIndex?: number,
  monthlyDutyHours?: SystemSettings['dutyHours'] | null,
  referenceAssignments?: MonthlySchedule['assignments']
) {
  let score = 0;
  const reports = generatePersonnelReports(schedule.year, schedule.month, personnel, schedule, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours ?? null);
  
  // LEVEL A: Critical
  schedule.warnings.forEach(w => {
    if (w.includes('کمبود نیرو')) score += 10000000;
    if (w.includes('توالی غیرمجاز')) score += 5000000;
    if (w.includes('نقض آف قطعی')) score += 8000000;
    if (w.includes('نقض مرخصی')) score += 9000000;
    if (w.includes('مغایرت با درخواست')) score += 500000;
  });

  const calculateVar = (vals: number[]) => {
    if (vals.length === 0) return 0;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return vals.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / vals.length;
  };

  const fScore = (calculateVar(reports.map(r => r.workedHours)) * 100) + 
                 (calculateVar(reports.map(r => r.equivalentShiftCount)) * 1000) +
                 (calculateVar(reports.map(r => r.attendanceCount)) * 2000) +
                 (calculateVar(reports.map(r => r.longShiftCount)) * 4000);
  
  score += fScore;

  let changes = 0;
  if (referenceAssignments) {
    personnel.forEach(p => {
      Object.keys(schedule.assignments[p.id] || {}).forEach(d => {
        const day = Number(d);
        if (schedule.assignments[p.id][day] !== referenceAssignments[p.id]?.[day]) changes++;
      });
    });
    score += changes * 50000;
  }

  const satisfaction = Math.max(0, 100 - (schedule.warnings.filter(w => w.includes('مغایرت') || w.includes('نقض')).length * 2));

  // Mapping fairnessScore (variance) to 1-10 rating.
  const fairnessRating = Math.max(1, Math.min(10, Number((10 - (fScore / 1000000)).toFixed(1))));

  return { 
    score, 
    warningCount: schedule.warnings.length, 
    fairnessScore: fScore, 
    fairnessRating,
    requestSatisfaction: satisfaction, 
    stabilityScore: referenceAssignments ? Math.max(0, 100 - (changes / 5)) : 100,
    changeCount: changes, 
    realWorkloadVariance: fScore 
  };
}

/**
 * Auto Repair Engine
 */
export function runAutoRepair(
  schedule: MonthlySchedule, personnel: Personnel[], requests: ShiftRequest[], settings: SystemSettings,
  customHolidays: { [day: number]: string }, firstDayOfWeekIndex?: number, monthlyDutyHours?: SystemSettings['dutyHours'] | null,
  referenceAssignments?: MonthlySchedule['assignments']
): MonthlySchedule {
  let current = JSON.parse(JSON.stringify(schedule));
  let bestMetrics = calculateDetailedScore(current, personnel, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours, referenceAssignments);
  
  for (let iter = 0; iter < 100; iter++) {
    const day = Math.floor(Math.random() * 28) + 1;
    const p1Idx = Math.floor(Math.random() * personnel.length);
    const p2Idx = Math.floor(Math.random() * personnel.length);
    const p1 = personnel[p1Idx];
    const p2 = personnel[p2Idx];

    if (p1 && p2 && p1.id !== p2.id && p1.jobGroup === p2.jobGroup && !p1.locked && !p2.locked) {
      const nextA = JSON.parse(JSON.stringify(current.assignments));
      const s1 = nextA[p1.id][day] || 'OFF', s2 = nextA[p2.id][day] || 'OFF';
      if (s1 !== s2) {
        nextA[p1.id][day] = s2; nextA[p2.id][day] = s1;
        const v = verifyCoverageAndLeaders(current.year, current.month, personnel, nextA, settings, customHolidays, firstDayOfWeekIndex, requests);
        const nextS = { ...current, assignments: nextA, warnings: v.warnings, shiftLeaders: v.shiftLeaders };
        const nextMetrics = calculateDetailedScore(nextS, personnel, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours, referenceAssignments);
        if (nextMetrics.score < bestMetrics.score) {
          current = nextS; bestMetrics = nextMetrics;
        }
      }
    }
  }
  return current;
}

export function baseSolveNursingSchedule(
  year: number, month: number, personnelList: Personnel[], requests: ShiftRequest[], settings: SystemSettings,
  customHolidays: { [day: number]: string } = {}, firstDayOfWeekIndex?: number, monthlyDutyHours?: SystemSettings['dutyHours'] | null,
  humanApprovedChanges?: { [pId: string]: { [d: number]: ShiftType } }, previousMonthFinalDays?: { [pId: string]: { [d: number]: ShiftType } }
): MonthlySchedule {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const totalDays = calendar.length;
  const assignments: { [pId: string]: { [d: number]: ShiftType } } = {};
  const decisionLogs: { [k: string]: string } = {};

  const activePersonnel = [...personnelList].filter(p => p.active);

  // Initialize
  activePersonnel.forEach(p => {
    assignments[p.id] = {};
    for (let d = 1; d <= totalDays; d++) {
      if (humanApprovedChanges?.[p.id]?.[d]) {
        assignments[p.id][d] = humanApprovedChanges[p.id][d];
      } else {
        assignments[p.id][d] = 'OFF';
      }
    }
  });

  // Step 1: Default Supervisor and Staff shifts (M on workdays)
  activePersonnel.forEach(p => {
    if (p.position === 'supervisor' || p.position === 'staff') {
        for (let d = 1; d <= totalDays; d++) {
            if (humanApprovedChanges?.[p.id]?.[d]) continue;
            if (!calendar[d-1].isHoliday) assignments[p.id][d] = 'M';
        }
    }
  });

  const dailyReqs: { [pId: string]: { [d: number]: ShiftRequest } } = {};
  const avoided: { [pId: string]: { [d: number]: Set<string> } } = {};
  
  requests.forEach(req => {
    const pId = req.personnelId;
    if (!assignments[pId]) return;
    for (let d = 1; d <= totalDays; d++) {
      const dateInfo = calendar[d - 1];
      let matches = false;
      if (req.scope === 'all') matches = true;
      else if (req.scope === 'even' && d % 2 === 0) matches = true;
      else if (req.scope === 'odd' && d % 2 !== 0) matches = true;
      else if (req.scope === 'saturdays' && dateInfo.dayOfWeek === 0) matches = true;
      else if (req.scope === 'sundays' && dateInfo.dayOfWeek === 1) matches = true;
      else if (req.scope === 'mondays' && dateInfo.dayOfWeek === 2) matches = true;
      else if (req.scope === 'tuesdays' && dateInfo.dayOfWeek === 3) matches = true;
      else if (req.scope === 'wednesdays' && dateInfo.dayOfWeek === 4) matches = true;
      else if (req.scope === 'thursdays' && dateInfo.dayOfWeek === 5) matches = true;
      else if (req.scope === 'fridays' && dateInfo.dayOfWeek === 6) matches = true;
      else if (req.scope === 'weekly_even' && [0, 2, 4].includes(dateInfo.dayOfWeek)) matches = true;
      else if (req.scope === 'weekly_odd' && [1, 3, 5].includes(dateInfo.dayOfWeek)) matches = true;
      else if (req.scope === 'custom_days' && req.selectedDays?.includes(d)) matches = true;
      else if (req.scope === 'range' && req.startDate && req.endDate) {
        const currStr = `${year}/${month < 10 ? '0'+month : month}/${d < 10 ? '0'+d : d}`;
        const startNorm = req.startDate.replace(/\//g, '-'), endNorm = req.endDate.replace(/\//g, '-'), currNorm = currStr.replace(/\//g, '-');
        if (currNorm >= startNorm && currNorm <= endNorm) matches = true;
      }
      if (matches) {
        if (req.requestType === 'avoid_shift') {
          if (!avoided[pId]) avoided[pId] = {};
          if (!avoided[pId][d]) avoided[pId][d] = new Set();
          if (req.preferredShift) avoided[pId][d].add(req.preferredShift);
        } else {
          const existing = dailyReqs[pId]?.[d];
          const getPrio = (r: ShiftRequest) => r.requestType === 'leave' ? 1 : (r.requestType === 'OFF' ? 2 : 3);
          const newP = getPrio(req), oldP = existing ? getPrio(existing) : 100;
          if (newP < oldP || (newP === oldP && !existing?.isEssential && req.isEssential)) {
            if (!dailyReqs[pId]) dailyReqs[pId] = {};
            dailyReqs[pId][d] = req;
          }
        }
      }
    }
  });

  // Step 2: Apply Priority Personnel sorting
  const sortedPersonnel = [...activePersonnel].sort((a, b) => (b.priorityScheduling ? 1 : 0) - (a.priorityScheduling ? 1 : 0));

  // Step 3: Apply High Priority Requests
  sortedPersonnel.forEach(p => {
    for (let d = 1; d <= totalDays; d++) {
        if (humanApprovedChanges?.[p.id]?.[d]) continue;
        const r = dailyReqs[p.id]?.[d];
        if (!r) continue;
        if (r.requestType === 'leave') assignments[p.id][d] = 'L1';
        else if (r.requestType === 'OFF') assignments[p.id][d] = 'OFF';
        else if (r.requestType === 'shift' && r.preferredShift) assignments[p.id][d] = r.preferredShift as ShiftType;
    }
  });

  // Step 4: Fill Coverage Gaps with Combined Shift logic
  for (let d = 1; d <= totalDays; d++) {
    const isH = calendar[d-1].isHoliday, dem = isH ? settings.demand.holiday : settings.demand.weekday;
    const fill = (grp: Personnel[], sType: 'M'|'E'|'N', target: number) => {
        let count = grp.filter(p => {
           const s = assignments[p.id][d];
           return s === sType || (sType === 'M' && ['ME', 'MN', 'MEN'].includes(s)) || (sType === 'E' && ['ME', 'EN', 'MEN'].includes(s)) || (sType === 'N' && ['EN', 'MN', 'MEN'].includes(s));
        }).length;
        let gap = target - count;
        if (gap <= 0) return;

        const available = grp.filter(p => {
            if (p.locked) return false;
            const s = assignments[p.id][d];
            if (s.startsWith('L')) return false;
            if (s.includes(sType)) return false;
            if (avoided[p.id]?.[d]?.has(sType)) return false;
            if (sType === 'M' && s.includes('N')) return false;
            if (sType === 'N' && s.includes('M')) return false;
            if (d > 1 && sType === 'M' && assignments[p.id][d-1].includes('N')) return false;
            if (d === 1) {
              const last = previousMonthFinalDays?.[p.id]?.[30] || previousMonthFinalDays?.[p.id]?.[31];
              if (last && last.includes('N') && sType === 'M') return false;
            }
            return true;
        });

        // Combined Shift logic: Favor people already working that day
        available.sort((a, b) => {
           const sa = assignments[a.id][d], sb = assignments[b.id][d];
           const aHasReq = !!dailyReqs[a.id]?.[d];
           const bHasReq = !!dailyReqs[b.id]?.[d];
           if (sa !== 'OFF' && sb === 'OFF') return -1;
           if (sa === 'OFF' && sb !== 'OFF') return 1;
           if (aHasReq && !bHasReq) return 1; 
           if (!aHasReq && bHasReq) return -1;
           return 0;
        });

        available.slice(0, gap).forEach(p => {
            const current = assignments[p.id][d];
            if (current === 'OFF') assignments[p.id][d] = sType;
            else {
                let merged: string = current;
                if (!merged.includes(sType)) merged += sType;
                if (merged.includes('M') && merged.includes('E') && merged.includes('N')) merged = 'MEN';
                else if (merged.includes('M') && merged.includes('E')) merged = 'ME';
                else if (merged.includes('E') && merged.includes('N')) merged = 'EN';
                else if (merged.includes('M') && merged.includes('N')) merged = 'MN';
                assignments[p.id][d] = merged as ShiftType;
            }
        });
    };

    const nurses = sortedPersonnel.filter(p => p.jobGroup === 'nurse');
    const assistants = sortedPersonnel.filter(p => p.jobGroup === 'assistant');
    fill(assistants, 'M', dem.morningAssistant); fill(assistants, 'E', dem.afternoonAssistant); fill(assistants, 'N', dem.nightAssistant);
    fill(nurses, 'M', dem.morningNurse); fill(nurses, 'E', dem.afternoonNurse); fill(nurses, 'N', dem.nightNurse);
  }

  const v = verifyCoverageAndLeaders(year, month, activePersonnel, assignments, settings, customHolidays, firstDayOfWeekIndex, requests);
  return { year, month, assignments, shiftLeaders: v.shiftLeaders, warnings: v.warnings, decisionLogs };
}

export function solveNursingSchedule(
  year: number, month: number, personnelList: Personnel[], requests: ShiftRequest[], settings: SystemSettings,
  customHolidays: { [day: number]: string } = {}, firstDayOfWeekIndex?: number, monthlyDutyHours?: SystemSettings['dutyHours'] | null,
  referenceAssignments?: MonthlySchedule['assignments'], humanApprovedChanges?: { [pId: string]: { [d: number]: ShiftType } },
  previousMonthFinalDays?: { [pId: string]: { [d: number]: ShiftType } }, 
  onProgress?: (prog: { current: number, total: number, bestScore: number, lowestWarnings: number }) => void,
  quickMode: boolean = false
): OptimizationResult {
  const count = quickMode ? 10 : (settings.scenarioCount || SCENARIO_COUNT);
  let bestS: MonthlySchedule | null = null;
  let minScore = Infinity;
  const scenarios: ScenarioResult[] = [];

  for (let i = 0; i < count; i++) {
    const pList = [...personnelList];
    if (i > 0) pList.sort(() => Math.random() - 0.5);
    const base = baseSolveNursingSchedule(year, month, pList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours, humanApprovedChanges, previousMonthFinalDays);
    const repaired = runAutoRepair(base, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours, referenceAssignments);
    const m = calculateDetailedScore(repaired, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours, referenceAssignments);
    
    scenarios.push({ id: `s_${i}`, schedule: repaired, score: m.score, metrics: m });
    if (m.score < minScore) { minScore = m.score; bestS = repaired; }
    if (onProgress && i % 10 === 0) onProgress({ current: i + 1, total: count, bestScore: minScore, lowestWarnings: m.warningCount });
  }

  const sorted = scenarios.sort((a,b) => a.score - b.score);
  const best = bestS!;
  
  // Category tagging
  const bestOverall = sorted[0]; bestOverall.category = 'بهترین پیشنهاد کلی';
  const bestFairness = [...sorted].sort((a,b) => a.metrics.fairnessScore - b.metrics.fairnessScore)[0]; bestFairness.category = 'عدالت‌محورترین حالت';
  const bestSatisfaction = [...sorted].sort((a,b) => b.metrics.requestSatisfaction - a.metrics.requestSatisfaction)[0]; bestSatisfaction.category = 'حداکثر رضایت پرسنل';

  const arena = [bestOverall, bestFairness, bestSatisfaction].filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
  
  arena.forEach(s => { 
    const rank = sorted.findIndex(ts => ts.id === s.id);
    if (rank <= count * 0.05) s.stars = 5;
    else if (rank <= count * 0.2) s.stars = 4;
    else if (rank <= count * 0.5) s.stars = 3;
    else if (rank <= count * 0.8) s.stars = 2;
    else s.stars = 1;
  });

  const fMetrics = calculateDetailedScore(best, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours, referenceAssignments);
  const summary: ScheduleSummary = {
    quality: fMetrics.score < 2000000 ? 'بسیار مطلوب (Elite)' : (fMetrics.score < 10000000 ? 'مطلوب' : 'قابل قبول'),
    warnings: fMetrics.warningCount,
    fairness: Math.round(Math.max(0, 100 - (fMetrics.fairnessScore / 100000))),
    satisfaction: Math.round(fMetrics.requestSatisfaction)
  };

  return { ...best, coverageGaps: [], priorityUsed: { level1: [], level2: [], level3: [] }, scenarios: arena, summary };
}

export function solveWithPriority(year: number, month: number, personnelList: Personnel[], requests: ShiftRequest[], settings: SystemSettings, customHolidays: { [day: number]: string } = {}, firstDayOfWeekIndex?: number, monthlyDutyHours?: SystemSettings['dutyHours'] | null, onProgress?: (prog: any) => void): OptimizationResult {
    return solveNursingSchedule(year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours, undefined, undefined, undefined, onProgress);
}

export function verifyCoverageAndLeaders(
  year: number, month: number, personnelList: Personnel[], assignments: MonthlySchedule['assignments'], settings: SystemSettings, 
  customHolidays: any, firstDayOfWeekIndex: any, requests: ShiftRequest[]
): { warnings: string[], shiftLeaders: MonthlySchedule['shiftLeaders'] } {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const totalDays = calendar.length;
  const warnings: string[] = [];
  const shiftLeaders: MonthlySchedule['shiftLeaders'] = {};
  
  for (let d = 1; d <= totalDays; d++) {
    shiftLeaders[d] = {};
    const isH = calendar[d-1].isHoliday, dem = isH ? settings.demand.holiday : settings.demand.weekday;
    const count = (job: string, s: string) => personnelList.filter(p => p.jobGroup === job && (assignments[p.id]?.[d] === s || assignments[p.id]?.[d]?.includes(s))).length;
    
    if (count('nurse', 'M') < dem.morningNurse) warnings.push(`کمبود نیروی پرستار در روز ${d} شیفت صبح`);
    if (count('nurse', 'E') < dem.afternoonNurse) warnings.push(`کمبود نیروی پرستار در روز ${d} شیفت عصر`);
    if (count('nurse', 'N') < dem.nightNurse) warnings.push(`کمبود نیروی پرستار در روز ${d} شیفت شب`);
    if (count('assistant', 'M') < dem.morningAssistant) warnings.push(`کمبود نیروی کمک بهیار در روز ${d} شیفت صبح`);
    if (count('assistant', 'E') < dem.afternoonAssistant) warnings.push(`کمبود نیروی کمک بهیار در روز ${d} شیفت عصر`);
    if (count('assistant', 'N') < dem.nightAssistant) warnings.push(`کمبود نیروی کمک بهیار در روز ${d} شیفت شب`);
  }

  personnelList.forEach(p => {
    requests.filter(r => r.personnelId === p.id).forEach(req => {
        for (let d = 1; d <= totalDays; d++) {
            const dateInfo = calendar[d-1];
            let matches = false;
            if (req.scope === 'all') matches = true;
            else if (req.scope === 'even' && d % 2 === 0) matches = true;
            else if (req.scope === 'odd' && d % 2 !== 0) matches = true;
            else if (req.scope === 'saturdays' && dateInfo.dayOfWeek === 0) matches = true;
            else if (req.scope === 'sundays' && dateInfo.dayOfWeek === 1) matches = true;
            else if (req.scope === 'mondays' && dateInfo.dayOfWeek === 2) matches = true;
            else if (req.scope === 'tuesdays' && dateInfo.dayOfWeek === 3) matches = true;
            else if (req.scope === 'wednesdays' && dateInfo.dayOfWeek === 4) matches = true;
            else if (req.scope === 'thursdays' && dateInfo.dayOfWeek === 5) matches = true;
            else if (req.scope === 'fridays' && dateInfo.dayOfWeek === 6) matches = true;
            else if (req.scope === 'weekly_even' && [0, 2, 4].includes(dateInfo.dayOfWeek)) matches = true;
            else if (req.scope === 'weekly_odd' && [1, 3, 5].includes(dateInfo.dayOfWeek)) matches = true;
            else if (req.scope === 'custom_days' && req.selectedDays?.includes(d)) matches = true;
            else if (req.scope === 'range' && req.startDate && req.endDate) {
                const currStr = `${year}/${month < 10 ? '0'+month : month}/${d < 10 ? '0'+d : d}`;
                const startNorm = req.startDate.replace(/\//g, '-'), endNorm = req.endDate.replace(/\//g, '-'), currNorm = currStr.replace(/\//g, '-');
                if (currNorm >= startNorm && currNorm <= endNorm) matches = true;
            }

            if (matches) {
                const assigned = assignments[p.id]?.[d] || 'OFF';
                if (req.requestType === 'leave' && !assigned.startsWith('L')) warnings.push(`نقض مرخصی: ${p.firstName} ${p.lastName} در روز ${d}`);
                else if (req.requestType === 'OFF' && assigned !== 'OFF') warnings.push(`نقض آف ${req.offSubtype === 'hard' ? 'قطعی' : 'توافقی'}: ${p.firstName} ${p.lastName} در روز ${d}`);
                else if (req.requestType === 'shift' && req.preferredShift && !assigned.includes(req.preferredShift)) warnings.push(`مغایرت با درخواست: ${p.firstName} ${p.lastName} در روز ${d} (درخواستی: ${req.preferredShift})`);
            }
        }
    });

    let offC = 0;
    for (let d = 1; d <= totalDays; d++) {
        if (assignments[p.id][d] === 'OFF') {
            offC++;
            if (offC > 3) warnings.push(`توالی غیرمجاز ایام تعطیل: بیش از ۳ روز آف متوالی برای ${p.firstName} ${p.lastName} (شروع از روز ${d-offC+1})`);
        } else { offC = 0; }
    }
  });

  return { warnings: Array.from(new Set(warnings)), shiftLeaders };
}

export function generatePersonnelReports(
  year: number, 
  month: number, 
  personnelList: Personnel[], 
  schedule: MonthlySchedule, 
  settings: SystemSettings, 
  customHolidays: { [day: number]: string }, 
  firstDayOfWeekIndex: number | undefined, 
  monthlyDutyHours: SystemSettings['dutyHours'] | null
): PersonnelReportResult[] {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  
  return personnelList.map(p => {
    const pA = schedule.assignments[p.id] || {};
    let m = 0, e = 0, n = 0, me = 0, en = 0, mn = 0, men = 0, off = 0, l = 0;
    
    Object.values(pA).forEach(s => {
      if (s === 'M') m++; else if (s === 'E') e++; else if (s === 'N') n++;
      else if (s === 'ME') me++; else if (s === 'EN') en++; else if (s === 'MN') mn++;
      else if (s === 'MEN') men++; else if (s === 'OFF') off++; else if (s.startsWith('L')) l++;
    });

    const workedHours = (m + e) * 6.5 + n * 12.5 + me * 13 + (en + mn) * 19 + men * 25.5 + l * 7;
    const duty = monthlyDutyHours?.[p.employmentType] || settings.dutyHours[p.employmentType] || 160;
    
    const assignmentsList = Object.values(pA);
    const productivityEligible = checkProductivityEligibility(p, assignmentsList);
    
    let productivityHours = 0;
    if (productivityEligible) {
      calendar.forEach(d => {
        const shift = pA[d.day];
        if (shift) {
            productivityHours += calculateShiftProductivity(shift, d.isHoliday);
        }
      });
    }

    return {
      personnelId: p.id, 
      name: `${p.firstName} ${p.lastName}`, 
      personalCode: p.personalCode,
      jobGroupText: p.jobGroup === 'nurse' ? 'پرستار' : 'کمک بهیار',
      positionText: p.position === 'supervisor' ? 'سرپرستار' : (p.position === 'staff' ? 'استاف' : 'کارشناس'),
      employmentTypeText: p.employmentType, 
      dutyHours: duty, 
      workedHours,
      overtimeHours: Math.max(0, workedHours - duty), 
      deficitHours: Math.max(0, duty - workedHours),
      experienceHours: getSeniorityHours(p), 
      productivityHours,
      mCount: m, eCount: e, nCount: n, meCount: me, enCount: en, mnCount: mn, menCount: men, offCount: off, leaveCount: l,
      productivityEligible, 
      attendanceCount: Object.values(pA).filter(v => v !== 'OFF' && !v.startsWith('L')).length,
      equivalentShiftCount: (m + e) + n * 2 + me * 2 + (en + mn) * 3 + men * 4,
      longShiftCount: me + en + mn + men
    };
  });
}
export function calculateAutoDutyHours(year: number, month: number, customHolidays: { [day: number]: string } = {}, firstDayOfWeekIndex?: number): { official: number; contract: number } {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const totalDays = calendar.length;
  const holidaysCount = calendar.filter(d => d.isHoliday).length;
  const X = totalDays - holidaysCount;
  const thursdaysNonHolidayCount = calendar.filter(d => d.dayOfWeek === 5 && !d.isHoliday).length;
  const Y = thursdaysNonHolidayCount * 2;
  const z = (X * 7) - Y;
  return { official: z, contract: z + 14 };
}
