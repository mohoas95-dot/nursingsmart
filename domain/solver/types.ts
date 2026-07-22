/**
 * Solver DTOs — Pure JSON, no class instances, no functions across worker boundaries
 * Serialization Boundary: Everything here must be JSON.stringify-able
 */

// ---------------------------------------------------------------------------
// Base Personnel & Request DTOs (plain, minimal needed for solver)
// ---------------------------------------------------------------------------

export type JobGroupDTO = 'nurse' | 'assistant';
export type NursePositionDTO = 'supervisor' | 'staff' | 'general' | 'none';
export type EmploymentTypeDTO = 'official' | 'contract' | 'conscript' | 'overtime';
export type ShiftTypeDTO = 'M' | 'E' | 'N' | 'ME' | 'EN' | 'MN' | 'MEN' | 'OFF' | 'UNFILLED' | string;

export type RoutineTypeDTO =
  | 'none'
  | 'morning'
  | 'morning_evening'
  | 'evening_night'
  | 'night'
  | '24h'
  | 'rotating'
  | 'custom';

export interface PersonnelDTO {
  id: string;
  firstName: string;
  lastName: string;
  jobGroup: JobGroupDTO;
  position: NursePositionDTO;
  employmentType: EmploymentTypeDTO;
  experienceYears: number;
  active: boolean;
  canBeShiftLeader: boolean;
  orderIndex?: number;
  /** Lightweight guidance tag — does NOT restrict solver, just bypasses heavy historical analysis */
  isFixedRoutine?: boolean;
  /** Detailed routine tag: morning, evening_night, 24h, rotating, etc. — guidance map, not hard restriction */
  routineType?: RoutineTypeDTO;
  /** Custom pattern for rotating staff, e.g., "MEN OFF OFF EN M" */
  routinePattern?: string;
  /** No requests submitted — needs balanced rotating schedule, not sacrificial lamb */
  hasNoRequests?: boolean;
  /** For anti-gaming detection */
  historicalRequestBias?: 'light' | 'balanced' | 'heavy';
}

export type RequestTypeDTO = 'shift' | 'OFF' | 'leave' | 'pattern' | 'avoid_shift';
/**
 * CLARIFICATION: Do NOT add new DB fields. OFF Hard/Soft mapping uses existing isEssential
 * boolean + Head Nurse approval status. Internal mapping only:
 * - isEssential=true => Hard OFF (head nurse categorized)
 * - isEssential=false => Soft OFF or generic request from staff
 * This DTO keeps offHardness for internal reasoning but it's derived, not persisted.
 */
export type OffHardnessDTO = 'hard' | 'soft' | 'generic';

export interface ShiftRequestDTO {
  id: string;
  personnelId: string;
  requestType: RequestTypeDTO;
  preferredShift?: ShiftTypeDTO;
  patternSteps?: string[];
  /** Existing isEssential boolean — maps to hard/soft OFF per clarification */
  isEssential: boolean;
  /** Derived internally, NOT a new DB field — for solver reasoning only */
  offHardness?: OffHardnessDTO;
  scope: 'all' | 'even' | 'odd' | 'saturdays' | 'sundays' | 'mondays' | 'tuesdays' | 'wednesdays' | 'thursdays' | 'fridays' | 'range' | 'weekly_even' | 'weekly_odd' | 'custom_days';
  startDate?: string;
  endDate?: string;
  selectedDays?: number[];
  /** Priority resolved: Leave > OFF > Shift */
  priorityRank?: number;
  /** Is this request from a published/finalized schedule? For ongoing leave detection */
  isPublished?: boolean;
}

export interface StaffingDemandDTO {
  morningNurse: number;
  morningAssistant: number;
  afternoonNurse: number;
  afternoonAssistant: number;
  nightNurse: number;
  nightAssistant: number;
  afternoonLeader: number;
  nightLeader: number;
}

export interface SystemDemandDTO {
  weekday: StaffingDemandDTO;
  holiday: StaffingDemandDTO;
}

export interface CalendarDayDTO {
  day: number; // 1-31
  dayOfWeek: number; // 0=Saturday ... 6=Friday
  isHoliday: boolean;
  isFriday: boolean;
  holidayTitle?: string;
}

export interface PreviousMonthMemoryDTO {
  personnelId: string;
  lastTwoDays: ShiftTypeDTO[]; // e.g., [day -2, day -1] of previous month
}

export interface SolverInputDTO {
  year: number;
  month: number;
  personnel: PersonnelDTO[];
  requests: ShiftRequestDTO[];
  calendar: CalendarDayDTO[];
  demand: SystemDemandDTO;
  dutyHours: {
    official: number;
    contract: number;
    conscript: number;
    overtime: number;
  };
  /** Memory freeze: final 1-2 days of previous month retrieved from schedules table prevMonthKey */
  previousMonthMemory?: PreviousMonthMemoryDTO[];
  /** Previous month key for memory freeze retrieval, e.g., "1404_2" */
  previousMonthKey?: string;
  /** Already published assignments for stability calculation */
  baselineAssignments?: Record<string, Record<number, ShiftTypeDTO>>;
  /** Published/finalized status for ongoing leave detection: if month is finalized, leaves are hard red-line */
  isPublishedMonth?: boolean;
  finalizedMonths?: string[]; // list of finalized month keys for leave detection
  /** Human approved changes that must be preserved (Human Veto) */
  humanApprovedLocks?: Array<{ personnelId: string; day: number; shift: ShiftTypeDTO }>;
  /** Auto scenario count: system automatically generates 100-500 diverse scenarios in background, no manual input */
  scenarioCount: number; // auto 100-500, see autoScenarioCount() helper
  /** Blast radius for mid-month localized repair */
  blastRadiusDays?: number; // default 3
  /** Max chain swap depth */
  maxChainDepth?: number; // default 3, allow up to 7 for hard deadlock
  /** Random seed for reproducibility */
  seed?: number;
}

/**
 * Auto scenario count based on personnel size — per clarification #6
 * No manual user input required, system decides 100-500 automatically
 */
export function autoScenarioCount(personnelCount: number): number {
  if (personnelCount < 15) return 100;
  if (personnelCount < 25) return 200;
  if (personnelCount < 40) return 300;
  return 500;
}

// ---------------------------------------------------------------------------
// Constraint violation
// ---------------------------------------------------------------------------

export type ConstraintLevel = 'A' | 'B' | 'C';
export type ViolationSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ConstraintViolationDTO {
  level: ConstraintLevel;
  code: string; // e.g., "MANDATORY_REST_AFTER_NIGHT", "MAX_CONSECUTIVE_32H"
  severity: ViolationSeverity;
  personnelId?: string;
  day?: number;
  messageFa: string; // Persian, native, professional
  messageEn: string; // English for logs
  isBlocking: boolean; // if Level A and non-negotiable
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------

export interface ScenarioAssignmentsDTO {
  [personnelId: string]: {
    [day: number]: ShiftTypeDTO;
  };
}

export interface ScenarioDTO {
  id: string;
  index: number;
  strategy: string; // e.g., "shuffle_draft", "fairness_tilt", "lookahead_sacrifice"
  assignments: ScenarioAssignmentsDTO;
  shiftLeaders: Record<number, { morning?: string; afternoon?: string; night?: string }>;
  violations: ConstraintViolationDTO[];
  warnings: string[]; // legacy warnings for compat
  repaired: boolean;
  repairLog: RepairLogEntryDTO[];
  score?: ScenarioScoreDTO;
  /** For UNDERSTAFFED handling */
  understaffedSlots: Array<{ day: number; shift: 'M' | 'E' | 'N'; jobGroup: JobGroupDTO; shortage: number }>;
}

export interface RepairLogEntryDTO {
  iteration: number;
  operator: 'swap' | 'move' | 'rotation' | 'multi' | 'chain';
  personnelIds: string[];
  day: number;
  from: ShiftTypeDTO;
  to: ShiftTypeDTO;
  reasonFa: string;
  reasonEn: string;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScenarioScoreDTO {
  total: number; // 0-100
  safety: number; // 40%
  coverage: number; // 25%
  requestSatisfaction: number; // 15%
  fairness: number; // 10%
  stability: number; // 10%
  breakdown: {
    safety: { raw: number; weight: number; detailsFa: string };
    coverage: { raw: number; weight: number; detailsFa: string };
    requestSatisfaction: { raw: number; weight: number; detailsFa: string };
    fairness: { raw: number; weight: number; detailsFa: string };
    stability: { raw: number; weight: number; detailsFa: string };
  };
}

// ---------------------------------------------------------------------------
// Worker messages
// ---------------------------------------------------------------------------

export type WorkerMessageType = 'START' | 'PROGRESS' | 'SCENARIO_DONE' | 'DONE' | 'ERROR' | 'CANCEL';

export interface WorkerStartMessage {
  type: 'START';
  payload: SolverInputDTO;
}

export interface WorkerProgressMessage {
  type: 'PROGRESS';
  payload: {
    current: number; // e.g., 85
    total: number; // e.g., 300
    bestScore: number;
    elapsedMs: number;
  };
}

export interface WorkerScenarioDoneMessage {
  type: 'SCENARIO_DONE';
  payload: {
    scenario: ScenarioDTO;
  };
}

export interface WorkerDoneMessage {
  type: 'DONE';
  payload: {
    scenarios: ScenarioDTO[];
    best: ScenarioDTO | null;
    arena: import('./arena/arena-types').ArenaResultDTO;
    elapsedMs: number;
  };
}

export interface WorkerErrorMessage {
  type: 'ERROR';
  payload: {
    message: string;
    stack?: string;
  };
}

export interface WorkerCancelMessage {
  type: 'CANCEL';
}

export type WorkerMessage =
  | WorkerStartMessage
  | WorkerProgressMessage
  | WorkerScenarioDoneMessage
  | WorkerDoneMessage
  | WorkerErrorMessage
  | WorkerCancelMessage;

export type MainThreadMessage = WorkerMessage;

// ---------------------------------------------------------------------------
// Utilities: DTO mappers (pure)
// ---------------------------------------------------------------------------

/**
 * OFF Hard/Soft mapping using existing isEssential boolean + Head Nurse approval
 * Per clarification #3: Do NOT add new DB fields
 */
export function mapOffHardness(isEssential: boolean, isHeadNurseApproved: boolean = false): OffHardnessDTO {
  if (isEssential && isHeadNurseApproved) return 'hard';
  if (isEssential) return 'hard'; // isEssential=true implies head nurse categorized as hard
  return 'soft'; // staff generic request
}

export function personnelToDTO(p: {
  id: string;
  firstName: string;
  lastName: string;
  jobGroup: JobGroupDTO;
  position: NursePositionDTO;
  employmentType: EmploymentTypeDTO;
  experienceYears: number;
  active: boolean;
  canBeShiftLeader: boolean;
  orderIndex?: number;
  isFixedRoutine?: boolean;
  routineType?: RoutineTypeDTO;
  routinePattern?: string;
  hasNoRequests?: boolean;
}): PersonnelDTO {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    jobGroup: p.jobGroup,
    position: p.position,
    employmentType: p.employmentType,
    experienceYears: p.experienceYears,
    active: p.active,
    canBeShiftLeader: p.canBeShiftLeader,
    orderIndex: p.orderIndex,
    isFixedRoutine: p.isFixedRoutine ?? (p.position === 'supervisor' || p.position === 'staff' ? true : undefined),
    routineType: p.routineType ?? (p.isFixedRoutine ? 'morning' : 'none'),
    routinePattern: p.routinePattern,
    hasNoRequests: p.hasNoRequests,
  };
}

/**
 * Routine compatibility check — does a shift match a routine type?
 * Used as guidance map, not hard restriction, per user clarification
 */
export function isShiftCompatibleWithRoutine(
  shift: ShiftTypeDTO,
  routineType?: RoutineTypeDTO,
  routinePattern?: string
): boolean {
  if (!routineType || routineType === 'none' || routineType === 'custom') {
    // If custom pattern provided, check if shift is in pattern tokens? For now allow all
    return true;
  }
  if (shift === 'OFF' || shift === 'UNFILLED' || shift.startsWith('L')) return true; // OFF always allowed

  switch (routineType) {
    case 'morning':
      return shift === 'M';
    case 'morning_evening':
      return ['M', 'E', 'ME'].includes(shift);
    case 'evening_night':
      return ['E', 'N', 'EN'].includes(shift);
    case 'night':
      return shift === 'N' || shift === 'EN' || shift === 'MN'; // allow combined with N
    case '24h':
      return ['EN', 'MN', 'MEN', 'ME'].includes(shift); // 24h variants
    case 'rotating':
      return true; // rotating accepts all, but we will prefer clustered patterns
    default:
      return true;
  }
}

/**
 * Get allowed shifts for a routine type — for generator guidance
 */
export function getAllowedShiftsForRoutine(routineType?: RoutineTypeDTO): ShiftTypeDTO[] {
  switch (routineType) {
    case 'morning':
      return ['M'];
    case 'morning_evening':
      return ['M', 'E', 'ME'];
    case 'evening_night':
      return ['E', 'N', 'EN'];
    case 'night':
      return ['N', 'EN', 'MN'];
    case '24h':
      return ['EN', 'MN', 'MEN', 'ME'];
    case 'rotating':
      return ['M', 'E', 'N', 'ME', 'EN', 'MN', 'MEN']; // all, but clustered
    case 'custom':
      return ['M', 'E', 'N', 'ME', 'EN', 'MN', 'MEN'];
    default:
      return ['M', 'E', 'N', 'ME', 'EN', 'MN', 'MEN'];
  }
}
