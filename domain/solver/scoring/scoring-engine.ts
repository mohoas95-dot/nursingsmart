/**
 * Scoring Engine — Weighted evaluation 40/25/15/10/10
 * Pure, solver-ready
 */

import type {
  ScenarioDTO,
  ScenarioScoreDTO,
  PersonnelDTO,
  CalendarDayDTO,
  ShiftRequestDTO,
  SystemDemandDTO,
  PreviousMonthMemoryDTO,
} from '../types';
import { validateAllConstraints } from '../constraints';
import { calculateFairness } from './fairness-calculator';
import { inferRoutines } from './routine-inference';

export interface ScoringInput {
  scenario: ScenarioDTO;
  personnel: PersonnelDTO[];
  calendar: CalendarDayDTO[];
  requests: ShiftRequestDTO[];
  demand: SystemDemandDTO;
  dutyHours: { official: number; contract: number; conscript: number; overtime: number };
  previousMonthMemory?: PreviousMonthMemoryDTO[];
  baselineAssignments?: Record<string, Record<number, string>>;
  humanApprovedLocks?: Array<{ personnelId: string; day: number; shift: string }>;
}

const WEIGHTS = {
  safety: 0.40,
  coverage: 0.25,
  requestSatisfaction: 0.15,
  fairness: 0.10,
  stability: 0.10,
};

function calculateSafetyScore(scenario: ScenarioDTO): { raw: number; detailsFa: string } {
  const blockingA = scenario.violations.filter(v => v.level === 'A' && v.isBlocking && v.severity === 'critical');
  if (blockingA.length > 0) {
    return {
      raw: 0,
      detailsFa: `ناایمن — ${blockingA.length} تخلف بحرانی سطح A (غیرقابل مذاکره)`,
    };
  }
  const levelA = scenario.violations.filter(v => v.level === 'A');
  // Deduct per violation, but allow UNDERSTAFFED
  const penaltyPer = 15;
  const understaffed = scenario.understaffedSlots.length;
  // Understaffed is allowed but penalized less than safety breach
  const raw = Math.max(0, 100 - levelA.length * penaltyPer - understaffed * 5);
  return {
    raw,
    detailsFa: levelA.length === 0 ? `ایمن — بدون تخلف سطح A` : `${levelA.length} تخلف سطح A، ${understaffed} شیفت خالی مجاز`,
  };
}

function calculateCoverageScore(scenario: ScenarioDTO, demand: SystemDemandDTO, calendar: CalendarDayDTO[], personnel: PersonnelDTO[]): { raw: number; detailsFa: string } {
  // Coverage: based on understaffedSlots vs total demand
  let totalRequired = 0;
  let totalShortage = 0;
  for (const slot of scenario.understaffedSlots) {
    totalShortage += slot.shortage;
  }
  // Estimate total required as sum demand
  for (const cal of calendar) {
    const dem = cal.isHoliday ? demand.holiday : demand.weekday;
    totalRequired += dem.morningNurse + dem.morningAssistant + dem.afternoonNurse + dem.afternoonAssistant + dem.nightNurse + dem.nightAssistant;
  }
  if (totalRequired === 0) return { raw: 100, detailsFa: 'بدون نیازمندی تعریف‌شده' };
  const coverageRate = Math.max(0, (totalRequired - totalShortage) / totalRequired);
  const raw = Math.round(coverageRate * 100);
  return {
    raw,
    detailsFa: `پوشش ${raw}٪ — نیاز کل ${totalRequired}، کمبود ${totalShortage}`,
  };
}

function calculateRequestSatisfactionScore(
  personnel: PersonnelDTO[],
  requests: ShiftRequestDTO[],
  scenario: ScenarioDTO,
  calendar: CalendarDayDTO[]
): { raw: number; detailsFa: string } {
  if (requests.length === 0) return { raw: 100, detailsFa: 'بدون درخواست ثبت‌شده' };

  let totalWeight = 0;
  let satisfiedWeight = 0;
  let leaveSatisfied = 0;
  let leaveTotal = 0;
  let offSatisfied = 0;
  let offTotal = 0;
  let shiftSatisfied = 0;
  let shiftTotal = 0;

  const isActiveForDay = (req: ShiftRequestDTO, day: number, dow: number): boolean => {
    switch (req.scope) {
      case 'all': return true;
      case 'even': return day % 2 === 0;
      case 'odd': return day % 2 === 1;
      case 'saturdays': return dow === 0;
      case 'sundays': return dow === 1;
      case 'mondays': return dow === 2;
      case 'tuesdays': return dow === 3;
      case 'wednesdays': return dow === 4;
      case 'thursdays': return dow === 5;
      case 'fridays': return dow === 6;
      case 'weekly_even': return dow === 0 || dow === 2 || dow === 4;
      case 'weekly_odd': return dow === 1 || dow === 3 || dow === 5;
      case 'custom_days': return req.selectedDays?.includes(day) ?? false;
      case 'range': {
        if (!req.startDate || !req.endDate) return false;
        const s = parseInt(req.startDate.split('/').pop() || '0', 10);
        const e = parseInt(req.endDate.split('/').pop() || '0', 10);
        return day >= s && day <= e;
      }
      default: return false;
    }
  };

  for (const req of requests) {
    const p = personnel.find(pp => pp.id === req.personnelId);
    if (!p || !p.active) continue;
    for (const cal of calendar) {
      const day = cal.day;
      if (!isActiveForDay(req, day, cal.dayOfWeek)) continue;
      const assigned = scenario.assignments[req.personnelId]?.[day];
      if (!assigned) continue;

      const weight = req.requestType === 'leave' ? 3 : req.requestType === 'OFF' ? 2 : 1; // Leave > OFF > Shift
      totalWeight += weight;

      let satisfied = false;
      if (req.requestType === 'leave') {
        satisfied = assigned.toString().startsWith('L');
        leaveTotal++;
        if (satisfied) leaveSatisfied++;
      } else if (req.requestType === 'OFF') {
        satisfied = assigned === 'OFF';
        offTotal++;
        if (satisfied) offSatisfied++;
      } else if (req.requestType === 'shift') {
        if (!req.preferredShift) satisfied = true;
        else satisfied = assigned.includes(req.preferredShift) || assigned === req.preferredShift;
        shiftTotal++;
        if (satisfied) shiftSatisfied++;
      } else if (req.requestType === 'avoid_shift') {
        if (!req.preferredShift) satisfied = true;
        else satisfied = !assigned.includes(req.preferredShift);
        shiftTotal++;
        if (satisfied) shiftSatisfied++;
      } else if (req.requestType === 'pattern') {
        // Simplified
        satisfied = true;
        shiftTotal++;
        if (satisfied) shiftSatisfied++;
      }

      if (satisfied) satisfiedWeight += weight;
    }
  }

  const raw = totalWeight > 0 ? Math.round((satisfiedWeight / totalWeight) * 100) : 100;
  const detailsFa = `رضایت کلی ${raw}٪ — مرخصی ${leaveTotal ? Math.round((leaveSatisfied / leaveTotal) * 100) : 100}٪ (${leaveSatisfied}/${leaveTotal})، آف ${offTotal ? Math.round((offSatisfied / offTotal) * 100) : 100}٪ (${offSatisfied}/${offTotal})، شیفت ${shiftTotal ? Math.round((shiftSatisfied / shiftTotal) * 100) : 100}٪ (${shiftSatisfied}/${shiftTotal})`;

  return { raw, detailsFa };
}

function calculateStabilityScore(
  scenario: ScenarioDTO,
  baseline?: Record<string, Record<number, string>>
): { raw: number; detailsFa: string } {
  if (!baseline) return { raw: 100, detailsFa: 'بدون برنامه مبنا — پایداری کامل (اولین انتشار)' };
  let totalCells = 0;
  let changed = 0;
  for (const pId of Object.keys(scenario.assignments)) {
    const basePerson = baseline[pId];
    if (!basePerson) continue;
    for (const dayStr of Object.keys(scenario.assignments[pId])) {
      const day = parseInt(dayStr, 10);
      const curr = scenario.assignments[pId][day];
      const base = basePerson[day];
      if (base === undefined) continue;
      totalCells++;
      if (base !== curr) changed++;
    }
  }
  if (totalCells === 0) return { raw: 100, detailsFa: 'بدون مقایسه' };
  const changeRate = changed / totalCells;
  const raw = Math.round(Math.max(0, 100 - changeRate * 100));
  return {
    raw,
    detailsFa: `پایداری ${raw}٪ — ${changed} تغییر از ${totalCells} سلول (${(changeRate * 100).toFixed(1)}٪)`,
  };
}

export function scoreScenario(input: ScoringInput): ScenarioScoreDTO {
  const { scenario, personnel, calendar, requests, demand, dutyHours, previousMonthMemory, baselineAssignments, humanApprovedLocks } = input;

  // If violations not yet computed, compute now
  let violations = scenario.violations;
  if (violations.length === 0) {
    const result = validateAllConstraints({
      personnel,
      calendar,
      assignments: scenario.assignments,
      demand,
      requests,
      dutyHours,
      previousMonthMemory,
      humanApprovedLocks,
    });
    violations = result.violations;
    scenario.violations = violations;
  }

  const safety = calculateSafetyScore(scenario);
  const coverage = calculateCoverageScore(scenario, demand, calendar, personnel);
  const fairnessCalc = calculateFairness(personnel, scenario.assignments, calendar);
  const requestSat = calculateRequestSatisfactionScore(personnel, requests, scenario, calendar);
  const stability = calculateStabilityScore(scenario, baselineAssignments);

  const total = Math.round(
    safety.raw * WEIGHTS.safety +
    coverage.raw * WEIGHTS.coverage +
    requestSat.raw * WEIGHTS.requestSatisfaction +
    fairnessCalc.fairnessScore * WEIGHTS.fairness +
    stability.raw * WEIGHTS.stability
  );

  return {
    total,
    safety: safety.raw,
    coverage: coverage.raw,
    requestSatisfaction: requestSat.raw,
    fairness: fairnessCalc.fairnessScore,
    stability: stability.raw,
    breakdown: {
      safety: { raw: safety.raw, weight: WEIGHTS.safety, detailsFa: safety.detailsFa },
      coverage: { raw: coverage.raw, weight: WEIGHTS.coverage, detailsFa: coverage.detailsFa },
      requestSatisfaction: { raw: requestSat.raw, weight: WEIGHTS.requestSatisfaction, detailsFa: requestSat.detailsFa },
      fairness: { raw: fairnessCalc.fairnessScore, weight: WEIGHTS.fairness, detailsFa: fairnessCalc.detailsFa },
      stability: { raw: stability.raw, weight: WEIGHTS.stability, detailsFa: stability.detailsFa },
    },
  };
}
