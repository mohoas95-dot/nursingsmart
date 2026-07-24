/**
 * Domain Layer — Public API
 *
 * This is the single entry point for all domain logic.
 * Import from here to ensure you're using the pure, tested functions.
 *
 * RULES:
 *   - All functions in this layer are PURE (no side effects)
 *   - All functions are DETERMINISTIC (same input → same output)
 *   - All functions have ZERO dependencies on React, Next.js, or browser APIs
 *   - All functions are Solver-Ready (can be consumed by AI optimization engines)
 */

// ============================================================================
// Types
// ============================================================================

export type {
  DutyHours,
  CalendarDay,
  MonthlyCalendar,
  JobGroup,
  ShiftType,
  ScheduleLockState,
  ShiftEditCheckResult,
  RequestScope,
  ShiftRequestScope,
} from './types';

export type {
  OptimizerInput,
  OptimizerConfig,
  OptimizerResult,
  ManualShiftChangeInput,
  ManualShiftChangeResult,
  PersonnelSaveInput,
  PersonnelSaveResult,
} from './scheduling/types';

// ============================================================================
// Calendar
// ============================================================================

export {
  calculateDutyHoursFromDays,
  calculateMonthlyDutyHours,
} from './calendar/duty-hours-calculator';

// ============================================================================
// Guards
// ============================================================================

export {
  isScheduleLocked,
  isPersonnelRowLocked,
  canEditShiftCell,
  isPersonnelOptimizationTarget,
} from './guards/shift-edit-guards';

// ============================================================================
// Requests
// ============================================================================

export { isDayInRequestScope } from './requests/request-scope-matcher';

// ============================================================================
// Schedule Operations
// ============================================================================

export {
  normalizeScheduleAssignments,
  mergeOptimizerAssignments,
  updateScheduleCell,
  buildPersonnelFromForm,
  validatePersonnelForm,
} from './scheduling/schedule-operations';

export {
  reconcileStaffingCoverage,
  shiftCoversPeriod,
} from './scheduling/staffing-coverage';

export type {
  CoverageShift,
  StaffingCalendarDay,
  StaffingCoverageGap,
  StaffingCoverageResult,
} from './scheduling/staffing-coverage';

// ============================================================================
// Smart Regeneration Rules — قوانین هوشمند بازتولید (سقف متوالی، شیفت تک‌تک، روتین کاری)
// ============================================================================

export {
  HOLIDAY_LEAVE_HOURS,
  HOLIDAY_LEAVE_SHIFT,
  MAX_CONSECUTIVE_SHIFT_UNITS,
  ROUTINE_PERIOD_ACCESS,
  ROUTINE_PREFERRED_SHIFTS,
  SHIFT_SEQUENCE_WEIGHT,
  endsMonthAtCapWithoutRest,
  findConsecutiveCapViolations,
  findConsecutiveRuns,
  findIsolatedSingleShiftDays,
  getRunWeightAroundDay,
  getShiftWeight,
  isHolidayLeaveShift,
  isIsolatedSingleShiftAt,
  isRoutineAllowedSingleShift,
  isWorkShift,
  resolveLeaveShiftAssignment,
  routineAllowsPeriodAdd,
  shiftContainsComponent,
  shiftMatchesRoutine,
  wouldBreachConsecutiveCap,
  wouldCreateIsolatedShift,
} from './scheduling/smart-rules';

export type { AssignmentMap, ConsecutiveRunSummary } from './scheduling/smart-rules';
