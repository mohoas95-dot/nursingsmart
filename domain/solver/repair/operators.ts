/**
 * Repair Operators — Swap, Move, Rotation, Multi-Person
 * Pure functions, solver-ready
 */

import type { ScenarioAssignmentsDTO, ShiftTypeDTO, RepairLogEntryDTO } from '../types';

export interface RepairContext {
  day: number;
  personnelIds: string[];
  assignments: ScenarioAssignmentsDTO;
  iteration: number;
}

export type RepairOperator = 'swap' | 'move' | 'rotation' | 'multi';

export interface OperatorResult {
  success: boolean;
  newAssignments?: ScenarioAssignmentsDTO;
  log?: RepairLogEntryDTO;
}

/**
 * Swap operator: swap shifts between two personnel on same day
 */
export function swapOperator(
  assignments: ScenarioAssignmentsDTO,
  day: number,
  p1: string,
  p2: string,
  iteration: number
): OperatorResult {
  const s1 = assignments[p1]?.[day];
  const s2 = assignments[p2]?.[day];
  if (s1 === undefined || s2 === undefined) return { success: false };
  if (s1 === s2) return { success: false }; // no effect

  const newAssignments: ScenarioAssignmentsDTO = JSON.parse(JSON.stringify(assignments));
  newAssignments[p1][day] = s2 as ShiftTypeDTO;
  newAssignments[p2][day] = s1 as ShiftTypeDTO;

  return {
    success: true,
    newAssignments,
    log: {
      iteration,
      operator: 'swap',
      personnelIds: [p1, p2],
      day,
      from: s1 as ShiftTypeDTO,
      to: s2 as ShiftTypeDTO,
      reasonFa: `جابجایی شیفت روز ${day} بین ${p1} (${s1}→${s2}) و ${p2} (${s2}→${s1}) برای رفع کمبود/تعادل`,
      reasonEn: `Swap day ${day} between ${p1} and ${p2}`,
    },
  };
}

/**
 * Move operator: move a shift from overloaded to underloaded person
 */
export function moveOperator(
  assignments: ScenarioAssignmentsDTO,
  day: number,
  fromPerson: string,
  toPerson: string,
  targetShift: ShiftTypeDTO,
  iteration: number
): OperatorResult {
  const fromShift = assignments[fromPerson]?.[day];
  const toShift = assignments[toPerson]?.[day];
  if (!fromShift || toShift === undefined) return { success: false };
  // fromPerson must have targetShift, toPerson must be OFF
  if (!fromShift.includes(targetShift as string)) return { success: false };
  if (toShift !== 'OFF') return { success: false };

  const newAssignments: ScenarioAssignmentsDTO = JSON.parse(JSON.stringify(assignments));

  // Remove targetShift from fromPerson
  let newFromShift: string = fromShift;
  if (fromShift === targetShift) newFromShift = 'OFF';
  else if (fromShift === 'ME' && targetShift === 'M') newFromShift = 'E';
  else if (fromShift === 'ME' && targetShift === 'E') newFromShift = 'M';
  else if (fromShift === 'MN' && targetShift === 'M') newFromShift = 'N';
  else if (fromShift === 'MN' && targetShift === 'N') newFromShift = 'M';
  else if (fromShift === 'EN' && targetShift === 'E') newFromShift = 'N';
  else if (fromShift === 'EN' && targetShift === 'N') newFromShift = 'E';
  else if (fromShift === 'MEN' && targetShift === 'N') newFromShift = 'ME';
  else if (fromShift === 'MEN' && targetShift === 'E') newFromShift = 'MN';
  else if (fromShift === 'MEN' && targetShift === 'M') newFromShift = 'EN';
  else return { success: false };

  newAssignments[fromPerson][day] = newFromShift as ShiftTypeDTO;
  newAssignments[toPerson][day] = targetShift;

  return {
    success: true,
    newAssignments,
    log: {
      iteration,
      operator: 'move',
      personnelIds: [fromPerson, toPerson],
      day,
      from: fromShift as ShiftTypeDTO,
      to: targetShift,
      reasonFa: `انتقال شیفت ${targetShift} روز ${day} از ${fromPerson} به ${toPerson} برای توزیع عادلانه`,
      reasonEn: `Move ${targetShift} day ${day} from ${fromPerson} to ${toPerson}`,
    },
  };
}

/**
 * Rotation operator: rotate shifts for one person to avoid checkerboard (M-OFF-N-OFF)
 * e.g., change OFF in middle to create clustering
 */
export function rotationOperator(
  assignments: ScenarioAssignmentsDTO,
  personnelId: string,
  day: number,
  newShift: ShiftTypeDTO,
  iteration: number
): OperatorResult {
  const current = assignments[personnelId]?.[day];
  if (!current) return { success: false };
  if (current === newShift) return { success: false };

  const newAssignments: ScenarioAssignmentsDTO = JSON.parse(JSON.stringify(assignments));
  newAssignments[personnelId][day] = newShift;

  return {
    success: true,
    newAssignments,
    log: {
      iteration,
      operator: 'rotation',
      personnelIds: [personnelId],
      day,
      from: current as ShiftTypeDTO,
      to: newShift,
      reasonFa: `چرخش شیفت ${personnelId} روز ${day} از ${current} به ${newShift} برای جلوگیری از تکه‌تکه شدن (Shift Clustering)`,
      reasonEn: `Rotation for ${personnelId} day ${day} ${current} -> ${newShift}`,
    },
  };
}

/**
 * Multi-person operator: simultaneous change for 3 persons
 * Simplified: perform 2 moves in sequence
 */
export function multiPersonOperator(
  assignments: ScenarioAssignmentsDTO,
  moves: Array<{ from: string; to: string; shift: ShiftTypeDTO; day: number }>,
  iteration: number
): OperatorResult {
  let currentAssignments = JSON.parse(JSON.stringify(assignments)) as ScenarioAssignmentsDTO;
  const logs: RepairLogEntryDTO[] = [];

  for (const mv of moves) {
    const res = moveOperator(currentAssignments, mv.day, mv.from, mv.to, mv.shift, iteration);
    if (!res.success || !res.newAssignments) {
      return { success: false };
    }
    currentAssignments = res.newAssignments;
    if (res.log) logs.push(res.log);
  }

  // For audit, return last log as representative, but mark as multi
  const lastLog = logs[logs.length - 1];
  if (!lastLog) return { success: false };

  return {
    success: true,
    newAssignments: currentAssignments,
    log: {
      ...lastLog,
      operator: 'multi',
      personnelIds: moves.flatMap(m => [m.from, m.to]),
      reasonFa: `تغییر چندنفره همزمان روز ${moves[0].day} برای رفع بن‌بست — ${logs.length} جابجایی`,
      reasonEn: `Multi-person change day ${moves[0].day}`,
    },
  };
}
