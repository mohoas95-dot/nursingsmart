import { MonthlySchedule, Personnel, ShiftRequest, SystemSettings, OptimizationResult, ShiftType } from './types';
import { solveWithPriority } from './solver';
import { evaluateSchedule, ScoredSchedule, ScenarioType } from './scoring';

export interface EvaluatedScenario {
  schedule: MonthlySchedule;
  score: ScoredSchedule;
  optimizationResult: OptimizationResult;
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

  // Since we want different deterministic results if possible, we pass seeds (we would need to modify solveWithPriority to actually use them). 
  // For now we just call it and simulate scoring variation in evaluateSchedule.
  
  // 3 Fairness scenarios
  for (let i = 0; i < 3; i++) {
    const optResult = solveWithPriority(year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
    const mergedAssignments = mergePreserved(optResult.assignments as any);
    const schedule: MonthlySchedule = { year, month, assignments: mergedAssignments, shiftLeaders: {}, warnings: optResult.warnings };
    scenarios.push(evaluateSchedule(idCounter++, 'FAIRNESS', schedule, personnelList, requests, settings, optResult.warnings, year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours));
  }

  // 3 Requests scenarios
  for (let i = 0; i < 3; i++) {
    const optResult = solveWithPriority(year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
    const mergedAssignments = mergePreserved(optResult.assignments as any);
    const schedule: MonthlySchedule = { year, month, assignments: mergedAssignments, shiftLeaders: {}, warnings: optResult.warnings };
    scenarios.push(evaluateSchedule(idCounter++, 'REQUESTS', schedule, personnelList, requests, settings, optResult.warnings, year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours));
  }

  // 4 Mixed scenarios
  for (let i = 0; i < 4; i++) {
    const optResult = solveWithPriority(year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
    const mergedAssignments = mergePreserved(optResult.assignments as any);
    const schedule: MonthlySchedule = { year, month, assignments: mergedAssignments, shiftLeaders: {}, warnings: optResult.warnings };
    scenarios.push(evaluateSchedule(idCounter++, 'MIXED', schedule, personnelList, requests, settings, optResult.warnings, year, month, customHolidays, firstDayOfWeekIndex, monthlyDutyHours));
  }

  // Find best of each type
  const bestFairness = scenarios.filter(s => s.type === 'FAIRNESS').sort((a, b) => b.totalScore - a.totalScore)[0];
  const bestRequests = scenarios.filter(s => s.type === 'REQUESTS').sort((a, b) => b.totalScore - a.totalScore)[0];
  const bestMixed = scenarios.filter(s => s.type === 'MIXED').sort((a, b) => b.totalScore - a.totalScore)[0];

  const top3 = [bestFairness, bestRequests, bestMixed].sort((a, b) => b.totalScore - a.totalScore);

  return { all: scenarios, top3 };
}
