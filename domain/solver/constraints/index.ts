/**
 * Constraints aggregator — validates all levels and returns combined violations
 */

import { validateLevelA } from './levelA';
import { validateLevelB } from './levelB';
import { validateLevelC } from './levelC';
import type {
  PersonnelDTO,
  CalendarDayDTO,
  ScenarioAssignmentsDTO,
  ConstraintViolationDTO,
  SystemDemandDTO,
  ShiftRequestDTO,
  PreviousMonthMemoryDTO,
} from '../types';

export interface AllConstraintsInput {
  personnel: PersonnelDTO[];
  calendar: CalendarDayDTO[];
  assignments: ScenarioAssignmentsDTO;
  demand: SystemDemandDTO;
  requests: ShiftRequestDTO[];
  dutyHours: { official: number; contract: number; conscript: number; overtime: number };
  previousMonthMemory?: PreviousMonthMemoryDTO[];
  humanApprovedLocks?: Array<{ personnelId: string; day: number; shift: string }>;
  finalizedMonths?: string[];
  currentMonthKey?: string;
}

export interface ValidationResult {
  violations: ConstraintViolationDTO[];
  levelA: ConstraintViolationDTO[];
  levelB: ConstraintViolationDTO[];
  levelC: ConstraintViolationDTO[];
  hasBlockingA: boolean;
  isSafe: boolean; // no blocking A
}

export function validateAllConstraints(input: AllConstraintsInput): ValidationResult {
  const levelA = validateLevelA({
    personnel: input.personnel,
    calendar: input.calendar,
    assignments: input.assignments,
    demand: input.demand,
    requests: input.requests,
    previousMonthMemory: input.previousMonthMemory,
    finalizedMonths: input.finalizedMonths,
    currentMonthKey: input.currentMonthKey,
    humanApprovedLocks: input.humanApprovedLocks,
  });

  const levelB = validateLevelB({
    personnel: input.personnel,
    calendar: input.calendar,
    assignments: input.assignments,
    requests: input.requests,
    demand: input.demand,
    humanApprovedLocks: input.humanApprovedLocks,
  });

  const levelC = validateLevelC({
    personnel: input.personnel,
    calendar: input.calendar,
    assignments: input.assignments,
    dutyHours: input.dutyHours,
  });

  const violations = [...levelA, ...levelB, ...levelC];
  const hasBlockingA = levelA.some(v => v.isBlocking && v.severity === 'critical');

  return {
    violations,
    levelA,
    levelB,
    levelC,
    hasBlockingA,
    isSafe: !hasBlockingA,
  };
}

export { validateLevelA, validateLevelB, validateLevelC };
