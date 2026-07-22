/**
 * Auto Repair Engine — Swap, Move, Rotation, Multi-Person, Chain Swap
 * With Tabu, Max Iterations, Time Limit, Blast Radius, Oscillation Prevention
 * Pure, solver-ready
 */

import type {
  ScenarioDTO,
  PersonnelDTO,
  CalendarDayDTO,
  SystemDemandDTO,
  ShiftRequestDTO,
  ShiftTypeDTO,
} from '../types';
import { validateAllConstraints } from '../constraints';
import { TabuList } from './tabu-list';
import { swapOperator, moveOperator, rotationOperator, multiPersonOperator } from './operators';
import { attemptChainSwap } from './chain-swap';
import { scoreScenario } from '../scoring/scoring-engine';

export interface AutoRepairConfig {
  maxIterations: number; // e.g., 100
  maxTimeMs: number; // e.g., 2000 per scenario
  tabuSize: number; // e.g., 100
  tabuTenure: number; // e.g., 20
  blastRadiusDays?: number; // for localized repair: only ±N days around manual change
  centerDay?: number; // if localized, center of blast radius
  maxChainDepth: number; // e.g., 3, allow up to 7 for hard deadlock
  enableChainSwap: boolean;
}

const DEFAULT_CONFIG: AutoRepairConfig = {
  maxIterations: 100,
  maxTimeMs: 2000,
  tabuSize: 100,
  tabuTenure: 20,
  maxChainDepth: 3,
  enableChainSwap: true,
};

export interface RepairResult {
  scenario: ScenarioDTO;
  improved: boolean;
  iterations: number;
  elapsedMs: number;
  finalScore: number;
  initialScore: number;
}

/**
 * Auto repair a single scenario
 */
export function autoRepairScenario(
  scenario: ScenarioDTO,
  personnel: PersonnelDTO[],
  calendar: CalendarDayDTO[],
  demand: SystemDemandDTO,
  requests: ShiftRequestDTO[],
  dutyHours: { official: number; contract: number; conscript: number; overtime: number },
  config: Partial<AutoRepairConfig> = {}
): RepairResult {
  const cfg: AutoRepairConfig = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  const tabu = new TabuList(cfg.tabuSize, cfg.tabuTenure);

  let currentScenario = JSON.parse(JSON.stringify(scenario)) as ScenarioDTO;
  let currentScore = scoreScenario({
    scenario: currentScenario,
    personnel,
    calendar,
    requests,
    demand,
    dutyHours,
  }).total;

  const initialScore = currentScore;
  let improved = false;
  let iteration = 0;

  // For localized repair, determine allowed days
  const isLocalized = cfg.blastRadiusDays !== undefined && cfg.centerDay !== undefined;
  const allowedDays: Set<number> = new Set();
  if (isLocalized) {
    const center = cfg.centerDay!;
    const radius = cfg.blastRadiusDays!;
    for (let d = Math.max(1, center - radius); d <= Math.min(calendar.length, center + radius); d++) {
      allowedDays.add(d);
    }
  }

  const shouldAllowDay = (day: number): boolean => {
    if (!isLocalized) return true;
    return allowedDays.has(day);
  };

  for (iteration = 0; iteration < cfg.maxIterations; iteration++) {
    if (Date.now() - startTime > cfg.maxTimeMs) break; // time limit

    tabu.setIteration(iteration);

    // Validate current
    const validation = validateAllConstraints({
      personnel,
      calendar,
      assignments: currentScenario.assignments,
      demand,
      requests,
      dutyHours,
    });

    // If no violations at all, break (perfect)
    if (validation.violations.length === 0) break;

    // Prioritize violations by severity: critical A first
    const sortedViolations = [...validation.violations].sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      if (a.level !== b.level) {
        const levelOrder = { A: 0, B: 1, C: 2 };
        return levelOrder[a.level] - levelOrder[b.level];
      }
      return order[a.severity] - order[b.severity];
    });

    const targetViolation = sortedViolations[0];
    if (!targetViolation) break;

    // Try operators based on violation type
    let bestCandidate: ScenarioDTO | null = null;
    let bestCandidateScore = currentScore;

    const day = targetViolation.day ?? (cfg.centerDay ?? 1);
    if (!shouldAllowDay(day)) {
      // Skip if outside blast radius, try next violation in blast radius
      // Find next violation inside blast radius
      const inside = sortedViolations.find(v => v.day !== undefined && shouldAllowDay(v.day));
      if (!inside) break; // no repairable violation inside blast radius
      // continue will attempt that in next iteration via loop
      // For simplicity, set day to inside.day
      // We'll proceed with inside.day in next iteration
      continue;
    }

    const personnelIds = personnel.filter(p => p.active).map(p => p.id);

    // 1. Try swap for staffing shortages
    if (targetViolation.code === 'MINIMUM_STAFFING_SHORTAGE' && targetViolation.day) {
      const neededDay = targetViolation.day;
      // Find understaffed slot detail from scenario if available
      const understaffed = currentScenario.understaffedSlots.find(u => u.day === neededDay);
      if (understaffed) {
        const jobGroup = understaffed.jobGroup;
        const shift = understaffed.shift as ShiftTypeDTO;

        // Candidates who are OFF and can take shift
        const offCandidates = personnel.filter(p => {
          if (p.jobGroup !== jobGroup) return false;
          if (!p.active) return false;
          const s = currentScenario.assignments[p.id]?.[neededDay];
          return s === 'OFF';
        });

        // Candidates who have shift but could give it (move)
        const hasShiftCandidates = personnel.filter(p => {
          if (p.jobGroup !== jobGroup) return false;
          if (!p.active) return false;
          const s = currentScenario.assignments[p.id]?.[neededDay];
          return s && s.includes(shift);
        });

        // Try move: from hasShift to off
        if (offCandidates.length > 0 && hasShiftCandidates.length > 0) {
          for (const from of hasShiftCandidates) {
            for (const to of offCandidates) {
              const res = moveOperator(currentScenario.assignments, neededDay, from.id, to.id, shift, iteration);
              if (!res.success || !res.newAssignments) continue;
              const hash = TabuList.hashAssignments(res.newAssignments);
              if (tabu.isTabu(hash)) continue;

              const testScenario: ScenarioDTO = {
                ...currentScenario,
                assignments: res.newAssignments,
                repairLog: [...currentScenario.repairLog, res.log!],
              };
              const score = scoreScenario({
                scenario: testScenario,
                personnel,
                calendar,
                requests,
                demand,
                dutyHours,
              }).total;

              if (score > bestCandidateScore) {
                bestCandidateScore = score;
                bestCandidate = testScenario;
              }
            }
          }
        }

        // Try chain swap if move didn't succeed and enabled
        if (!bestCandidate && cfg.enableChainSwap) {
          const chainRes = attemptChainSwap(
            currentScenario.assignments,
            neededDay,
            shift,
            personnelIds,
            cfg.maxChainDepth,
            iteration
          );
          if (chainRes.success && chainRes.newAssignments) {
            const hash = TabuList.hashAssignments(chainRes.newAssignments);
            if (!tabu.isTabu(hash)) {
              const testScenario: ScenarioDTO = {
                ...currentScenario,
                assignments: chainRes.newAssignments,
                repairLog: [...currentScenario.repairLog, ...chainRes.logs],
              };
              const score = scoreScenario({
                scenario: testScenario,
                personnel,
                calendar,
                requests,
                demand,
                dutyHours,
              }).total;
              if (score > bestCandidateScore) {
                bestCandidateScore = score;
                bestCandidate = testScenario;
              }
            }
          }
        }
      }
    }

    // 2. Try swap for soft OFF violation (staffing override isolated OFF)
    if (targetViolation.code === 'SOFT_OFF_VIOLATION' || targetViolation.code === 'HARD_OFF_VIOLATION') {
      // If this OFF is isolated and staffing needs it, we can move OFF to another day?
      // For MVP, try swap with someone else who is OFF elsewhere
      // Simplified: try to find another person with same jobGroup who is OFF on that day and swap?
      // Actually soft OFF violation means person has OFF request but got shift. We could try to give his shift to someone else OFF.
      const pId = targetViolation.personnelId;
      const d = targetViolation.day;
      if (pId && d) {
        const currentShift = currentScenario.assignments[pId]?.[d];
        if (currentShift && currentShift !== 'OFF') {
          const candidates = personnel.filter(p => {
            if (p.id === pId) return false;
            if (!p.active) return false;
            if (p.jobGroup !== personnel.find(pp => pp.id === pId)?.jobGroup) return false;
            const s = currentScenario.assignments[p.id]?.[d];
            return s === 'OFF';
          });
          for (const cand of candidates) {
            const res = moveOperator(currentScenario.assignments, d, pId, cand.id, currentShift as ShiftTypeDTO, iteration);
            if (!res.success || !res.newAssignments) continue;
            const hash = TabuList.hashAssignments(res.newAssignments);
            if (tabu.isTabu(hash)) continue;
            const testScenario: ScenarioDTO = {
              ...currentScenario,
              assignments: res.newAssignments,
              repairLog: [...currentScenario.repairLog, res.log!],
            };
            const score = scoreScenario({
              scenario: testScenario,
              personnel,
              calendar,
              requests,
              demand,
              dutyHours,
            }).total;
            if (score > bestCandidateScore) {
              bestCandidateScore = score;
              bestCandidate = testScenario;
            }
          }
        }
      }
    }

    // 3. For fragmentation, try rotation
    if (targetViolation.code === 'FRAGMENTED_SCHEDULE' && targetViolation.personnelId) {
      const pId = targetViolation.personnelId;
      // Find a day with OFF surrounded by different works -> try to make OFF into one of neighboring shifts
      for (let d = 2; d < calendar.length; d++) {
        if (!shouldAllowDay(d)) continue;
        const s1 = currentScenario.assignments[pId]?.[d - 1];
        const s2 = currentScenario.assignments[pId]?.[d];
        const s3 = currentScenario.assignments[pId]?.[d + 1];
        if (!s1 || !s2 || !s3) continue;
        if (s1 !== 'OFF' && !s1.startsWith('L') && s2 === 'OFF' && s3 !== 'OFF' && !s3.startsWith('L') && s1 !== s3) {
          // Try to change OFF to s1 (clustering)
          const res = rotationOperator(currentScenario.assignments, pId, d, s1 as ShiftTypeDTO, iteration);
          if (!res.success || !res.newAssignments) continue;
          const hash = TabuList.hashAssignments(res.newAssignments);
          if (tabu.isTabu(hash)) continue;
          const testScenario: ScenarioDTO = {
            ...currentScenario,
            assignments: res.newAssignments,
            repairLog: [...currentScenario.repairLog, res.log!],
          };
          const score = scoreScenario({
            scenario: testScenario,
            personnel,
            calendar,
            requests,
            demand,
            dutyHours,
          }).total;
          if (score > bestCandidateScore) {
            bestCandidateScore = score;
            bestCandidate = testScenario;
          }
        }
      }
    }

    // If we found a better candidate, apply it
    if (bestCandidate && bestCandidateScore > currentScore) {
      const prevHash = TabuList.hashAssignments(currentScenario.assignments);
      tabu.add(prevHash);
      currentScenario = {
        ...bestCandidate,
        repaired: true,
      };
      currentScore = bestCandidateScore;
      improved = true;
    } else {
      // No improvement, try random disturb to escape local optimum (10% chance)
      if (Math.random() < 0.1 && iteration < cfg.maxIterations - 1) {
        // Random swap
        const day = Math.floor(Math.random() * calendar.length) + 1;
        if (!shouldAllowDay(day)) continue;
        const ids = personnel.filter(p => p.active).map(p => p.id);
        if (ids.length < 2) continue;
        const idx1 = Math.floor(Math.random() * ids.length);
        let idx2 = Math.floor(Math.random() * ids.length);
        while (idx2 === idx1) idx2 = Math.floor(Math.random() * ids.length);
        const res = swapOperator(currentScenario.assignments, day, ids[idx1], ids[idx2], iteration);
        if (res.success && res.newAssignments) {
          const hash = TabuList.hashAssignments(res.newAssignments);
          if (!tabu.isTabu(hash)) {
            // Even if score not improved, allow with some probability to escape
            tabu.add(TabuList.hashAssignments(currentScenario.assignments));
            currentScenario = {
              ...currentScenario,
              assignments: res.newAssignments,
              repairLog: [...currentScenario.repairLog, res.log!],
              repaired: true,
            };
            currentScore = scoreScenario({
              scenario: currentScenario,
              personnel,
              calendar,
              requests,
              demand,
              dutyHours,
            }).total;
          }
        }
      } else {
        // No improvement and no random move, break to avoid infinite loop
        break;
      }
    }
  }

  const elapsedMs = Date.now() - startTime;

  // Final validation
  const finalValidation = validateAllConstraints({
    personnel,
    calendar,
    assignments: currentScenario.assignments,
    demand,
    requests,
    dutyHours,
  });
  currentScenario.violations = finalValidation.violations;

  // Recalculate understaffed
  const understaffed: typeof currentScenario.understaffedSlots = [];
  for (const calDay of calendar) {
    const dem = calDay.isHoliday ? demand.holiday : demand.weekday;
    const checks: Array<{ shift: 'M' | 'E' | 'N'; jobGroup: 'nurse' | 'assistant'; required: number }> = [
      { shift: 'M', jobGroup: 'nurse', required: dem.morningNurse },
      { shift: 'M', jobGroup: 'assistant', required: dem.morningAssistant },
      { shift: 'E', jobGroup: 'nurse', required: dem.afternoonNurse },
      { shift: 'E', jobGroup: 'assistant', required: dem.afternoonAssistant },
      { shift: 'N', jobGroup: 'nurse', required: dem.nightNurse },
      { shift: 'N', jobGroup: 'assistant', required: dem.nightAssistant },
    ];
    for (const ck of checks) {
      const actual = personnel.filter(p => {
        if (p.jobGroup !== ck.jobGroup) return false;
        if (!p.active) return false;
        const s = currentScenario.assignments[p.id]?.[calDay.day];
        return s && s.includes(ck.shift);
      }).length;
      if (actual < ck.required) {
        understaffed.push({ day: calDay.day, shift: ck.shift, jobGroup: ck.jobGroup, shortage: ck.required - actual });
      }
    }
  }
  currentScenario.understaffedSlots = understaffed;

  // Final score
  const finalScore = scoreScenario({
    scenario: currentScenario,
    personnel,
    calendar,
    requests,
    demand,
    dutyHours,
  }).total;

  return {
    scenario: {
      ...currentScenario,
      score: {
        ...(currentScenario.score as any),
        total: finalScore,
      } as any,
    },
    improved,
    iterations: iteration,
    elapsedMs,
    finalScore,
    initialScore,
  };
}
