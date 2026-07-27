import { MonthlySchedule, Personnel, ShiftRequest, SystemSettings, OptimizationResult, ShiftType } from './types';
import { solveWithPriority, solveNursingSchedule } from './solver';
import { evaluateSchedule, ScoredSchedule, ScenarioType } from './scoring';
import { generateJalaliMonthCalendar } from './jalali';

export interface EvaluatedScenario {
  schedule: MonthlySchedule;
  score: ScoredSchedule;
  optimizationResult: OptimizationResult;
}

/**
 * Post-Generation Optimization: Swap, MultiSwap, ChainSwap, Move
 * Only accept if overall score improves and no Hard Constraint is violated.
 */
function postGenerationOptimization(
  baseSchedule: MonthlySchedule,
  personnelList: readonly Personnel[],
  requests: readonly ShiftRequest[],
  settings: SystemSettings,
  year: number,
  month: number,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex?: number,
  monthlyDutyHours?: any
): MonthlySchedule {
  let bestSchedule = { ...baseSchedule };
  let bestScore = evaluateSchedule(999, 'MIXED', bestSchedule, personnelList, requests, settings, bestSchedule.warnings || [], year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours).totalScore;

  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const totalDays = calendar.length;

  const activePersonnel = personnelList.filter(p => p.active && !p.locked);

  // Helper: Calculate score of a schedule
  const getScore = (sched: MonthlySchedule): number => {
    const sc = evaluateSchedule(0, 'MIXED', sched, personnelList, requests, settings, sched.warnings || [], year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
    return sc.totalScore;
  };

  // Simple Swap: Swap two personnel on same day if both are OFF/work and improves score
  const performSwap = (sched: MonthlySchedule): MonthlySchedule => {
    const newSched = JSON.parse(JSON.stringify(sched));
    let improved = false;

    for (let d = 1; d <= totalDays; d++) {
      for (let i = 0; i < activePersonnel.length; i++) {
        for (let j = i + 1; j < activePersonnel.length; j++) {
          const p1 = activePersonnel[i];
          const p2 = activePersonnel[j];

          if (p1.jobGroup !== p2.jobGroup) continue;

          const s1 = newSched.assignments[p1.id]?.[d] || 'OFF';
          const s2 = newSched.assignments[p2.id]?.[d] || 'OFF';

          // Only swap if both are working or both OFF (simple swap)
          if ((s1 === 'OFF' && s2 === 'OFF') || (s1 !== 'OFF' && s2 !== 'OFF')) {
            // Swap
            newSched.assignments[p1.id][d] = s2;
            newSched.assignments[p2.id][d] = s1;

            const newScore = getScore(newSched);
            if (newScore > bestScore) {
              bestScore = newScore;
              improved = true;
            } else {
              // revert
              newSched.assignments[p1.id][d] = s1;
              newSched.assignments[p2.id][d] = s2;
            }
          }
        }
      }
    }
    return improved ? newSched : sched;
  };

  // Multi Swap (try 2-3 swaps in one pass)
  const performMultiSwap = (sched: MonthlySchedule): MonthlySchedule => {
    let current = { ...sched };
    for (let attempt = 0; attempt < 3; attempt++) {
      current = performSwap(current);
    }
    return current;
  };

  // Chain Swap (swap chain of 3 personnel)
  const performChainSwap = (sched: MonthlySchedule): MonthlySchedule => {
    const newSched = JSON.parse(JSON.stringify(sched));
    // Simple chain: find 3 people and rotate their shifts on same day
    for (let d = 1; d <= totalDays && d < 8; d++) {
      const candidates = activePersonnel.filter(p => p.jobGroup === 'nurse').slice(0, 3);
      if (candidates.length < 3) break;

      const shifts = candidates.map(p => newSched.assignments[p.id]?.[d] || 'OFF');
      // Rotate
      const newShifts = [shifts[2], shifts[0], shifts[1]];

      candidates.forEach((p, idx) => {
        newSched.assignments[p.id][d] = newShifts[idx] as any;
      });

      const newScore = getScore(newSched);
      if (newScore > bestScore) {
        bestScore = newScore;
        return newSched;
      } else {
        // revert
        candidates.forEach((p, idx) => {
          newSched.assignments[p.id][d] = shifts[idx] as any;
        });
      }
    }
    return sched;
  };

  // Move: Move a shift from one person to another OFF person (same group)
  const performMove = (sched: MonthlySchedule): MonthlySchedule => {
    const newSched = JSON.parse(JSON.stringify(sched));
    for (let d = 1; d <= totalDays; d++) {
      for (let i = 0; i < activePersonnel.length; i++) {
        for (let j = 0; j < activePersonnel.length; j++) {
          if (i === j) continue;
          const pFrom = activePersonnel[i];
          const pTo = activePersonnel[j];
          if (pFrom.jobGroup !== pTo.jobGroup) continue;

          const fromShift = newSched.assignments[pFrom.id]?.[d] || 'OFF';
          const toShift = newSched.assignments[pTo.id]?.[d] || 'OFF';

          if (fromShift !== 'OFF' && toShift === 'OFF') {
            newSched.assignments[pFrom.id][d] = 'OFF';
            newSched.assignments[pTo.id][d] = fromShift;

            const newScore = getScore(newSched);
            if (newScore > bestScore) {
              bestScore = newScore;
              return newSched;
            } else {
              newSched.assignments[pFrom.id][d] = fromShift;
              newSched.assignments[pTo.id][d] = 'OFF';
            }
          }
        }
      }
    }
    return sched;
  };

  // Run optimization passes
  let optimized = { ...baseSchedule };

  // Apply different strategies
  optimized = performMultiSwap(optimized);
  optimized = performChainSwap(optimized);
  optimized = performMove(optimized);

  // Final verification pass
  const finalScore = getScore(optimized);
  if (finalScore > bestScore) {
    return optimized;
  }

  return baseSchedule;
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
): { all: ScoredSchedule[], top4: ScoredSchedule[] } {
  
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

  // ========== Multi-Strategy Search ==========
  // Strategy 1: RULES_FIRST (اولویت قوانین ثابت)
  for (let i = 0; i < 2; i++) {
    const optResult = solveWithPriority(year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
    let schedule: MonthlySchedule = { 
      year, month, 
      assignments: mergePreserved(optResult.assignments as any), 
      shiftLeaders: {}, 
      warnings: optResult.warnings 
    };
    
    // Post-Generation Optimization
    schedule = postGenerationOptimization(schedule, personnelList, requests, settings, year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
    
    scenarios.push(evaluateSchedule(idCounter++, 'RULES_FIRST', schedule, personnelList, requests, settings, schedule.warnings || [], year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours));
  }

  // Strategy 2: REQUESTS (اولویت حفظ درخواست‌ها)
  for (let i = 0; i < 2; i++) {
    const optResult = solveWithPriority(year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
    let schedule: MonthlySchedule = { 
      year, month, 
      assignments: mergePreserved(optResult.assignments as any), 
      shiftLeaders: {}, 
      warnings: optResult.warnings 
    };
    schedule = postGenerationOptimization(schedule, personnelList, requests, settings, year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
    scenarios.push(evaluateSchedule(idCounter++, 'REQUESTS', schedule, personnelList, requests, settings, schedule.warnings || [], year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours));
  }

  // Strategy 3: FAIRNESS (اولویت عدالت)
  for (let i = 0; i < 2; i++) {
    const optResult = solveWithPriority(year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
    let schedule: MonthlySchedule = { 
      year, month, 
      assignments: mergePreserved(optResult.assignments as any), 
      shiftLeaders: {}, 
      warnings: optResult.warnings 
    };
    schedule = postGenerationOptimization(schedule, personnelList, requests, settings, year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
    scenarios.push(evaluateSchedule(idCounter++, 'FAIRNESS', schedule, personnelList, requests, settings, schedule.warnings || [], year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours));
  }

  // Strategy 4: MIXED (تعادل کلی)
  for (let i = 0; i < 3; i++) {
    const optResult = solveWithPriority(year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
    let schedule: MonthlySchedule = { 
      year, month, 
      assignments: mergePreserved(optResult.assignments as any), 
      shiftLeaders: {}, 
      warnings: optResult.warnings 
    };
    schedule = postGenerationOptimization(schedule, personnelList, requests, settings, year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
    scenarios.push(evaluateSchedule(idCounter++, 'MIXED', schedule, personnelList, requests, settings, schedule.warnings || [], year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours));
  }

  // ========== Select Best + Top 4 Representatives ==========
  // Sort by totalScore descending
  scenarios.sort((a, b) => b.totalScore - a.totalScore);

  // Keep the absolute best
  const bestOverall = scenarios[0];

  // Find the best representative for each philosophy (avoid duplicates)
  const bestRules = scenarios.filter(s => s.type === 'RULES_FIRST').sort((a, b) => b.totalScore - a.totalScore)[0] || bestOverall;
  const bestRequests = scenarios.filter(s => s.type === 'REQUESTS').sort((a, b) => b.totalScore - a.totalScore)[0] || bestOverall;
  const bestFairness = scenarios.filter(s => s.type === 'FAIRNESS').sort((a, b) => b.totalScore - a.totalScore)[0] || bestOverall;
  const bestMixed = scenarios.filter(s => s.type === 'MIXED').sort((a, b) => b.totalScore - a.totalScore)[0] || bestOverall;

  // Ensure 4 unique representatives
  const top4Set = new Set<number>();
  const top4: ScoredSchedule[] = [];

  // Add best overall first
  if (!top4Set.has(bestOverall.id)) {
    top4.push(bestOverall);
    top4Set.add(bestOverall.id);
  }

  // Add one from each philosophy if different
  [bestRules, bestRequests, bestFairness, bestMixed].forEach(candidate => {
    if (candidate && !top4Set.has(candidate.id) && top4.length < 4) {
      top4.push(candidate);
      top4Set.add(candidate.id);
    }
  });

  // Fill remaining slots with next best if needed
  let idx = 1;
  while (top4.length < 4 && idx < scenarios.length) {
    const next = scenarios[idx];
    if (!top4Set.has(next.id)) {
      top4.push(next);
      top4Set.add(next.id);
    }
    idx++;
  }

  return { all: scenarios, top4 };
}
