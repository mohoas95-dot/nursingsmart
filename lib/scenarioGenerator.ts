import { MonthlySchedule, Personnel, ShiftRequest, SystemSettings, OptimizationResult, ShiftType } from './types';
import { solveWithPriority, SolverBias } from './solver';
import { evaluateSchedule, ScoredSchedule, ScenarioType } from './scoring';
import { generateJalaliMonthCalendar } from './jalali';
import { getShiftHours } from './solver';

export interface EvaluatedScenario {
  schedule: MonthlySchedule;
  score: ScoredSchedule;
  optimizationResult: OptimizationResult;
}

// Seeded random number generator for deterministic results
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// Apply swaps to optimize schedule for a specific bias
function optimizeScheduleForBias(
  schedule: MonthlySchedule,
  bias: SolverBias,
  personnelList: readonly Personnel[],
  requests: readonly ShiftRequest[],
  settings: SystemSettings,
  year: number,
  month: number,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex?: number,
  monthlyDutyHours?: any,
  seed: number = 0
): MonthlySchedule {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const totalDays = calendar.length;
  const rand = seededRandom(seed + bias.charCodeAt(0) * 1000);

  // Deep copy assignments
  const assignments: Record<string, Record<number, ShiftType>> = {};
  for (const [pid, days] of Object.entries(schedule.assignments)) {
    assignments[pid] = { ...days };
  }

  // Build daily requests map
  const dailyRequests: Record<string, Record<number, ShiftRequest>> = {};
  for (const p of personnelList) {
    dailyRequests[p.id] = {};
  }
  for (const req of requests) {
    for (let d = 1; d <= totalDays; d++) {
      const dateInfo = calendar[d - 1];
      let matchesScope = false;
      if (req.scope === 'all') matchesScope = true;
      else if (req.scope === 'even' && d % 2 === 0) matchesScope = true;
      else if (req.scope === 'odd' && d % 2 !== 0) matchesScope = true;
      else if (req.scope === 'saturdays' && dateInfo.dayOfWeek === 0) matchesScope = true;
      else if (req.scope === 'sundays' && dateInfo.dayOfWeek === 1) matchesScope = true;
      else if (req.scope === 'mondays' && dateInfo.dayOfWeek === 2) matchesScope = true;
      else if (req.scope === 'tuesdays' && dateInfo.dayOfWeek === 3) matchesScope = true;
      else if (req.scope === 'wednesdays' && dateInfo.dayOfWeek === 4) matchesScope = true;
      else if (req.scope === 'thursdays' && dateInfo.dayOfWeek === 5) matchesScope = true;
      else if (req.scope === 'fridays' && dateInfo.dayOfWeek === 6) matchesScope = true;

      if (matchesScope) {
        if (req.requestType !== 'avoid_shift') {
          dailyRequests[req.personnelId][d] = req;
        }
      }
    }
  }

  // Calculate hours for each person
  const getHours = (pid: string): number => {
    let hours = 0;
    for (let d = 1; d <= totalDays; d++) {
      hours += getShiftHours(assignments[pid]?.[d] || 'OFF', personnelList.find(p => p.id === pid)?.employmentType || 'official');
    }
    return hours;
  };

  // Get target hours for a person
  const getTargetHours = (pid: string): number => {
    const p = personnelList.find(per => per.id === pid);
    if (!p) return 0;
    const effectiveDuty = monthlyDutyHours || settings.dutyHours;
    if (p.employmentType === 'overtime') return 0;
    return effectiveDuty[p.employmentType] || 0;
  };

  // Perform swaps based on bias
  const numSwaps = 20 + Math.floor(rand() * 30); // 20-50 swaps

  for (let swapIdx = 0; swapIdx < numSwaps; swapIdx++) {
    const d = 1 + Math.floor(rand() * totalDays);

    // Pick two random personnel from the same job group
    const activePersonnel = personnelList.filter(p => p.active);
    const p1 = activePersonnel[Math.floor(rand() * activePersonnel.length)];
    const p2 = activePersonnel[Math.floor(rand() * activePersonnel.length)];

    if (!p1 || !p2 || p1.id === p2.id || p1.jobGroup !== p2.jobGroup) continue;

    const shift1 = assignments[p1.id]?.[d] || 'OFF';
    const shift2 = assignments[p2.id]?.[d] || 'OFF';

    if (shift1 === shift2) continue;

    // Check if swap is valid (not on leave, not locked)
    if (shift1.startsWith('L') || shift2.startsWith('L')) continue;

    // Check if swap violates hard constraints
    const req1 = dailyRequests[p1.id]?.[d];
    const req2 = dailyRequests[p2.id]?.[d];

    // Don't swap if it violates a hard OFF request
    if (req1?.requestType === 'OFF' && req1?.offHardness === 'hard') continue;
    if (req2?.requestType === 'OFF' && req2?.offHardness === 'hard') continue;
    if (req1?.requestType === 'leave') continue;
    if (req2?.requestType === 'leave') continue;

    // Evaluate if swap is beneficial based on bias
    let shouldSwap = false;

    if (bias === 'fairness') {
      // Swap if it reduces hours disparity
      const hours1Before = getHours(p1.id);
      const hours2Before = getHours(p2.id);
      const target1 = getTargetHours(p1.id);
      const target2 = getTargetHours(p2.id);
      const diffBefore = Math.abs(hours1Before - target1) + Math.abs(hours2Before - target2);

      // Simulate swap
      const hours1After = hours1Before - getShiftHours(shift1, p1.employmentType) + getShiftHours(shift2, p1.employmentType);
      const hours2After = hours2Before - getShiftHours(shift2, p2.employmentType) + getShiftHours(shift1, p2.employmentType);
      const diffAfter = Math.abs(hours1After - target1) + Math.abs(hours2After - target2);

      if (diffAfter < diffBefore - 0.5) shouldSwap = true;
      else if (rand() < 0.1) shouldSwap = true; // Small random chance

    } else if (bias === 'requests') {
      // Swap if it fulfills more requests
      let scoreBefore = 0;
      let scoreAfter = 0;

      // Check if current shifts fulfill requests
      if (req1?.requestType === 'shift' && req1.preferredShift) {
        const matches = (req1.preferredShift === shift1) ||
          (req1.preferredShift === 'M' && ['M', 'ME', 'MN', 'MEN'].includes(shift1)) ||
          (req1.preferredShift === 'E' && ['E', 'ME', 'EN', 'MEN'].includes(shift1)) ||
          (req1.preferredShift === 'N' && ['N', 'EN', 'MN', 'MEN'].includes(shift1));
        if (matches) scoreBefore++;
      }
      if (req2?.requestType === 'shift' && req2.preferredShift) {
        const matches = (req2.preferredShift === shift2) ||
          (req2.preferredShift === 'M' && ['M', 'ME', 'MN', 'MEN'].includes(shift2)) ||
          (req2.preferredShift === 'E' && ['E', 'ME', 'EN', 'MEN'].includes(shift2)) ||
          (req2.preferredShift === 'N' && ['N', 'EN', 'MN', 'MEN'].includes(shift2));
        if (matches) scoreBefore++;
      }

      // Check if swapped shifts fulfill requests
      if (req1?.requestType === 'shift' && req1.preferredShift) {
        const matches = (req1.preferredShift === shift2) ||
          (req1.preferredShift === 'M' && ['M', 'ME', 'MN', 'MEN'].includes(shift2)) ||
          (req1.preferredShift === 'E' && ['E', 'ME', 'EN', 'MEN'].includes(shift2)) ||
          (req1.preferredShift === 'N' && ['N', 'EN', 'MN', 'MEN'].includes(shift2));
        if (matches) scoreAfter++;
      }
      if (req2?.requestType === 'shift' && req2.preferredShift) {
        const matches = (req2.preferredShift === shift1) ||
          (req2.preferredShift === 'M' && ['M', 'ME', 'MN', 'MEN'].includes(shift1)) ||
          (req2.preferredShift === 'E' && ['E', 'ME', 'EN', 'MEN'].includes(shift1)) ||
          (req2.preferredShift === 'N' && ['N', 'EN', 'MN', 'MEN'].includes(shift1));
        if (matches) scoreAfter++;
      }

      if (scoreAfter > scoreBefore) shouldSwap = true;
      else if (rand() < 0.05) shouldSwap = true; // Small random chance

    } else {
      // mixed: combine both criteria
      const hours1Before = getHours(p1.id);
      const hours2Before = getHours(p2.id);
      const target1 = getTargetHours(p1.id);
      const target2 = getTargetHours(p2.id);
      const diffBefore = Math.abs(hours1Before - target1) + Math.abs(hours2Before - target2);

      const hours1After = hours1Before - getShiftHours(shift1, p1.employmentType) + getShiftHours(shift2, p1.employmentType);
      const hours2After = hours2Before - getShiftHours(shift2, p2.employmentType) + getShiftHours(shift1, p2.employmentType);
      const diffAfter = Math.abs(hours1After - target1) + Math.abs(hours2After - target2);

      let reqScoreBefore = 0;
      let reqScoreAfter = 0;
      if (req1?.requestType === 'shift' && req1.preferredShift) {
        if (req1.preferredShift === shift1 || ['M', 'E', 'N'].includes(req1.preferredShift)) reqScoreBefore++;
        if (req1.preferredShift === shift2 || ['M', 'E', 'N'].includes(req1.preferredShift)) reqScoreAfter++;
      }
      if (req2?.requestType === 'shift' && req2.preferredShift) {
        if (req2.preferredShift === shift2 || ['M', 'E', 'N'].includes(req2.preferredShift)) reqScoreBefore++;
        if (req2.preferredShift === shift1 || ['M', 'E', 'N'].includes(req2.preferredShift)) reqScoreAfter++;
      }

      const improvement = (diffBefore - diffAfter) + (reqScoreAfter - reqScoreBefore) * 5;
      if (improvement > 0.5) shouldSwap = true;
      else if (rand() < 0.08) shouldSwap = true;
    }

    if (shouldSwap) {
      assignments[p1.id][d] = shift2;
      assignments[p2.id][d] = shift1;
    }
  }

  return {
    ...schedule,
    assignments
  };
}

export function generateAndScoreScenarios(
  year: number,
  month: number,
  personnelList: readonly Personnel[],
  requests: readonly ShiftRequest[],
  settings: SystemSettings,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex?: number,
  monthlyDutyHours?: any,
  targetJobGroup?: 'nurse' | 'assistant',
  currentAssignments?: Record<string, Record<number, ShiftType>> | null
): { all: ScoredSchedule[], top3: ScoredSchedule[] } {

  const scenarios: ScoredSchedule[] = [];
  let idCounter = 1;

  const mergePreserved = (optimized: Record<string, Record<number, ShiftType>>) => {
    if (!targetJobGroup || !currentAssignments) return optimized;
    const merged: Record<string, Record<number, ShiftType>> = { ...optimized };
    for (const p of personnelList) {
      if (p.jobGroup !== targetJobGroup) {
        if (currentAssignments[p.id]) {
          merged[p.id] = { ...(currentAssignments[p.id] as any) };
        }
      }
    }
    return merged;
  };

  // Generate base schedule using solver
  const baseResult = solveWithPriority(year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours, 'mixed');
  const baseMerged = mergePreserved(baseResult.assignments as any);
  const baseSchedule: MonthlySchedule = {
    year,
    month,
    assignments: baseMerged,
    shiftLeaders: {},
    warnings: baseResult.warnings
  };

  // Helper to generate a scenario with a specific bias
  const generateScenario = (type: ScenarioType, bias: SolverBias, seed: number) => {
    // Optimize the base schedule for this bias
    const optimizedSchedule = optimizeScheduleForBias(
      baseSchedule, bias, personnelList, requests, settings,
      year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours, seed
    );
    return evaluateSchedule(idCounter++, type, optimizedSchedule, personnelList, requests, settings, baseResult.warnings, year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
  };

  // 3 Fairness scenarios - prioritize equal distribution
  for (let i = 0; i < 3; i++) {
    scenarios.push(generateScenario('FAIRNESS', 'fairness', i));
  }

  // 3 Requests scenarios - prioritize fulfilling personnel requests
  for (let i = 0; i < 3; i++) {
    scenarios.push(generateScenario('REQUESTS', 'requests', i));
  }

  // 4 Mixed scenarios - balance both approaches
  for (let i = 0; i < 4; i++) {
    scenarios.push(generateScenario('MIXED', 'mixed', i));
  }

  // Find best of each type
  const bestFairness = scenarios.filter(s => s.type === 'FAIRNESS').sort((a, b) => b.totalScore - a.totalScore)[0];
  const bestRequests = scenarios.filter(s => s.type === 'REQUESTS').sort((a, b) => b.totalScore - a.totalScore)[0];
  const bestMixed = scenarios.filter(s => s.type === 'MIXED').sort((a, b) => b.totalScore - a.totalScore)[0];

  const top3 = [bestFairness, bestRequests, bestMixed].sort((a, b) => b.totalScore - a.totalScore);

  return { all: scenarios, top3 };
}
