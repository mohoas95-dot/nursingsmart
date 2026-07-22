/**
 * Solver Domain — Public API for Multi-Scenario Optimization Engine
 * Pure, solver-ready, English code
 */

export type {
  PersonnelDTO,
  ShiftRequestDTO,
  StaffingDemandDTO,
  SystemDemandDTO,
  CalendarDayDTO,
  SolverInputDTO,
  ConstraintViolationDTO,
  ScenarioDTO,
  ScenarioScoreDTO,
  RepairLogEntryDTO,
  WorkerMessage,
  OffHardnessDTO,
  JobGroupDTO,
  ShiftTypeDTO,
} from './types';

export { validateAllConstraints, validateLevelA, validateLevelB, validateLevelC } from './constraints';
export { scoreScenario } from './scoring/scoring-engine';
export { calculateFairness } from './scoring/fairness-calculator';
export { inferRoutines } from './scoring/routine-inference';
export { generateScenarios } from './generator/scenario-generator';
export { distributeStrategies, mulberry32, DIVERSITY_STRATEGIES } from './generator/strategies';
export { sortForDrafting, sortBySeniorityTieBreaker } from './generator/drafting-order';
export { TabuList } from './repair/tabu-list';
export { autoRepairScenario } from './repair/auto-repair-engine';
export { attemptChainSwap } from './repair/chain-swap';
export { swapOperator, moveOperator, rotationOperator, multiPersonOperator } from './repair/operators';
export { selectArena } from './arena/arena-selector';
export { ARENA_CATEGORY_META } from './arena/arena-types';
export type { ArenaResultDTO, ArenaCategory, ArenaCategoryResultDTO } from './arena/arena-types';
export { SolverOrchestrator } from './worker/solver-orchestrator';
export { CancellationToken, SolverUILock } from './worker/cancellation-token';

export * from './types';
