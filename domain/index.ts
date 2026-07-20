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
