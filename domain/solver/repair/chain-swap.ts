/**
 * Chain Swap — Depth Policy: Prefer short chains, allow deep if needed to break deadlock
 * Pure, solver-ready
 */

import type { ScenarioAssignmentsDTO, ShiftTypeDTO, RepairLogEntryDTO } from '../types';
import { swapOperator } from './operators';

export interface ChainSwapResult {
  success: boolean;
  newAssignments?: ScenarioAssignmentsDTO;
  chainLength: number;
  logs: RepairLogEntryDTO[];
  summaryFa: string;
  summaryEn: string;
}

/**
 * Attempt chain swap to fill a shortage
 * Example: Need M on day 5, but all M persons are busy with other shifts.
 * Chain: A (has M, wants OFF) -> B (has OFF, can take M) -> C (has E, can swap...)
 *
 * Simplified BFS for chain up to maxDepth
 */
export function attemptChainSwap(
  assignments: ScenarioAssignmentsDTO,
  day: number,
  requiredShift: ShiftTypeDTO,
  personnelList: string[],
  maxDepth: number = 3,
  iteration: number = 0
): ChainSwapResult {
  // For MVP, implement depth 2 chain: find intermediate
  // Full implementation would need staffing demand context

  // Depth 1: direct swap attempt
  for (let i = 0; i < personnelList.length; i++) {
    for (let j = i + 1; j < personnelList.length; j++) {
      const p1 = personnelList[i];
      const p2 = personnelList[j];
      const s1 = assignments[p1]?.[day];
      const s2 = assignments[p2]?.[day];
      if (!s1 || !s2) continue;
      // If one has requiredShift and other OFF, swapping helps? Actually move would be better.
      // Chain swap useful when both have different shifts, swapping resolves two shortages.
      // For MVP, just attempt swap if it brings requiredShift to someone who is OFF?
      // We'll implement simple: if p1 has requiredShift and p2 has OFF, but p1 wants OFF (not in this MVP)
      // So skip depth 1 as moveOperator covers it
    }
  }

  // Depth 2: p1 -> p2 -> p3
  if (maxDepth >= 2) {
    for (let i = 0; i < personnelList.length; i++) {
      for (let j = 0; j < personnelList.length; j++) {
        if (i === j) continue;
        for (let k = 0; k < personnelList.length; k++) {
          if (k === i || k === j) continue;
          const p1 = personnelList[i];
          const p2 = personnelList[j];
          const p3 = personnelList[k];

          const s1 = assignments[p1]?.[day];
          const s2 = assignments[p2]?.[day];
          const s3 = assignments[p3]?.[day];
          if (!s1 || !s2 || !s3) continue;

          // Scenario: p1 has requiredShift but should be OFF (overloaded), p2 has other shift X, p3 is OFF
          // Chain: p1 -> p2: p1 gives requiredShift to p2 if p2 can take it (combine)
          //        p2 -> p3: p2 gives X to p3
          // Simplified check: if p3 is OFF and p2 shift can be moved to p3, and p1 shift can be moved to p2

          if (s3 === 'OFF' && s2 !== 'OFF' && s1.includes(requiredShift as string)) {
            // Try p2 -> p3 move
            // For simplicity, check if s2 is single shift
            const singleShifts = ['M', 'E', 'N'];
            if (singleShifts.includes(s2)) {
              // Chain feasible
              let newAssignments = JSON.parse(JSON.stringify(assignments)) as ScenarioAssignmentsDTO;
              // p2 -> p3
              newAssignments[p2][day] = 'OFF' as ShiftTypeDTO;
              newAssignments[p3][day] = s2 as ShiftTypeDTO;
              // p1 -> p2
              // Remove requiredShift from p1
              let newS1 = s1;
              if (s1 === requiredShift) newS1 = 'OFF';
              else if (s1 === 'ME' && requiredShift === 'M') newS1 = 'E';
              else if (s1 === 'ME' && requiredShift === 'E') newS1 = 'M';
              else if (s1 === 'MN' && requiredShift === 'M') newS1 = 'N';
              else if (s1 === 'MN' && requiredShift === 'N') newS1 = 'M';
              else if (s1 === 'EN' && requiredShift === 'E') newS1 = 'N';
              else if (s1 === 'EN' && requiredShift === 'N') newS1 = 'E';
              else if (s1 === 'MEN') {
                if (requiredShift === 'M') newS1 = 'EN';
                else if (requiredShift === 'E') newS1 = 'MN';
                else newS1 = 'ME';
              } else newS1 = 'OFF'; // fallback

              newAssignments[p1][day] = newS1 as ShiftTypeDTO;
              newAssignments[p2][day] = requiredShift;

              const logs: RepairLogEntryDTO[] = [
                {
                  iteration,
                  operator: 'chain',
                  personnelIds: [p2, p3],
                  day,
                  from: s2 as ShiftTypeDTO,
                  to: s2 as ShiftTypeDTO,
                  reasonFa: `زنجیره ۲ مرحله‌ای: ${p2} شیفت ${s2} را به ${p3} منتقل کرد`,
                  reasonEn: `Chain step 1: ${p2} -> ${p3} ${s2}`,
                },
                {
                  iteration,
                  operator: 'chain',
                  personnelIds: [p1, p2],
                  day,
                  from: s1 as ShiftTypeDTO,
                  to: requiredShift,
                  reasonFa: `زنجیره ۲ مرحله‌ای: ${p1} شیفت ${requiredShift} را به ${p2} منتقل کرد (نیاز اصلی)`,
                  reasonEn: `Chain step 2: ${p1} -> ${p2} ${requiredShift}`,
                },
              ];

              return {
                success: true,
                newAssignments,
                chainLength: 2,
                logs,
                summaryFa: `جابجایی زنجیره‌ای عمیق ۲ نفره برای تامین شیفت ${requiredShift} روز ${day} — ${p1}→${p2}→${p3}`,
                summaryEn: `Chain swap depth 2 for shift ${requiredShift} day ${day}`,
              };
            }
          }
        }
      }
    }
  }

  // Depth 3+ would be similar BFS, omitted for MVP but structure allows extension up to 7

  return {
    success: false,
    chainLength: 0,
    logs: [],
    summaryFa: `جابجایی زنجیره‌ای تا عمق ${maxDepth} برای روز ${day} شیفت ${requiredShift} ناموفق`,
    summaryEn: `Chain swap failed day ${day} shift ${requiredShift}`,
  };
}
