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

export {
  DEFAULT_CUSTOM_HOLIDAY_TITLE,
  WORKING_DAY_OVERRIDE,
  clearHolidayOverride,
  diffHolidayOverrides,
  holidayOverrideTitle,
  holidaySource,
  isEffectiveHoliday,
  isWorkingDayOverride,
  mergeHolidayOverrides,
  setHolidayOverride,
  toggleHolidayOverride,
} from './calendar/holiday-overrides';

export type { HolidayMap } from './calendar/holiday-overrides';

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
// Authoritative Workload Model
// ============================================================================

export {
  HEAVY_SHIFT_WORKLOAD_THRESHOLD,
  MAX_CONSECUTIVE_NIGHTS,
  MAX_CONSECUTIVE_SHIFTS,
  PERIOD_WORKLOAD_WEIGHTS,
  POST_HEAVY_OFF_PREFERENCE_PENALTY,
  WORKLOAD_PERIODS,
  endsMonthAtCapWithoutRest,
  evaluatePostHeavyOffPreference,
  findConsecutiveCapViolations,
  findConsecutiveRuns,
  getAdjacentWorkload,
  getCandidateWorkloadContext,
  getShiftWorkload,
  isHeavyShift,
  isKnownNonWorkShift,
  isKnownShift,
  isKnownWorkShift,
  isUnknownShift,
  isWorkShift,
  shiftComponents,
  shiftContainsComponent,
  shiftContainsNight,
  shiftFromComponents,
  shiftSatisfiesRequestedShift,
  wouldBreachConsecutiveCap,
  wouldViolateNightRest,
} from './scheduling/workload';

export type {
  AdjacentWorkload,
  AssignmentMap,
  CandidateWorkloadContext,
  ConsecutiveRunSummary,
  PostHeavyOffPreference,
  NightRestViolation,
  WorkloadPeriod,
} from './scheduling/workload';

// ============================================================================
// Smart Regeneration Rules — قوانین روتین، شیفت تک‌تک، و مرخصی
// ============================================================================

export {
  HOLIDAY_LEAVE_HOURS,
  HOLIDAY_LEAVE_SHIFT,
  ROUTINE_PERIOD_ACCESS,
  ROUTINE_PREFERRED_SHIFTS,
  findIsolatedSingleShiftDays,
  isHolidayLeaveShift,
  isIsolatedSingleShiftAt,
  isRoutineAllowedSingleShift,
  resolveLeaveShiftAssignment,
  routineAllowsPeriodAdd,
  shiftMatchesRoutine,
  wouldCreateIsolatedShift,
} from './scheduling/smart-rules';

// ============================================================================
// Hard Constraints — قرارداد واحدِ محدودیت‌های سخت (Solver + reconcile)
// ============================================================================

export {
  ALL_HARD_RULES,
  COVERAGE_FILL_HARD_RULES,
  EMERGENCY_FILL_HARD_RULES,
  EXPLICIT_REQUEST_HARD_RULES,
  HARD_CONSTRAINT_LABELS,
  OFF_BREAKER_HARD_RULES,
  UNKNOWN_DAY_OF_WEEK,
  VERIFICATION_HARD_RULES,
  canAssignShift,
  evaluateHardConstraintLegality,
  evaluateHardConstraintViolations,
  evaluateHardConstraints,
  findHardOffRequest,
  findLeaveRequest,
  hasExplicitPlanForPeriod,
  isHardOffRequest,
  isLeaveCell,
  isMorningOnlyPosition,
  isSoftOffRequest,
  resolveLegalShiftForRequest,
  shiftPeriods,
  shiftSubsetsByCoverage,
  violatesConsecutiveLimit,
  violatesHardOff,
  violatesMorningOnly,
  violatesNightRest,
} from './scheduling/hard-constraints';

export {
  repairScheduleBeforeWarnings,
} from './scheduling/repair-orchestrator';

export type {
  DetectedRepairViolation,
  RepairBeforeWarningInput,
  RepairBeforeWarningResult,
  RepairableViolationCode,
  ScheduleRepairAction,
} from './scheduling/repair-orchestrator';

export type {
  ConstraintPeriod,
  HardConstraintEvaluation,
  HardConstraintRules,
  HardConstraintViolation,
  LegalShiftResolution,
  ShiftAssignmentDecision,
} from './scheduling/hard-constraints';

// ============================================================================
// Alert Lifecycle — چرخهٔ عمر هشدارها (پاک‌سازی خودکار هشدارهای رفع‌شده)
// ============================================================================

export {
  dismissedWarningsChanged,
  findResolvedWarnings,
  pruneDismissedWarningMap,
  pruneDismissedWarnings,
} from './scheduling/alert-lifecycle';

// ============================================================================
// Structured Warning Model — مدل ساخت‌یافتهٔ هشدار (کد/شدت/روز/شیفت/پرسنل)
// ============================================================================

export {
  CRITICAL_WARNING_CODES,
  countCriticalScheduleWarnings,
  createScheduleWarning,
  dedupeScheduleWarningsByMessage,
  defaultSeverityForCode,
  getCriticalScheduleWarnings,
  hasCriticalScheduleWarning,
  isCriticalScheduleWarning,
  isCriticalWarningCode,
  warningMessages,
} from './warnings/schedule-warning';

export type {
  ScheduleWarning,
  ScheduleWarningCode,
  ScheduleWarningSeverity,
} from './warnings/schedule-warning';

// ============================================================================
// System Event Log — لاگ‌ها و اتفاقات (نگهداری ۳۰ رویداد آخر)
// ============================================================================

export {
  MAX_SYSTEM_EVENT_LOGS,
  SYSTEM_EVENT_CATEGORIES,
  SYSTEM_EVENT_SEVERITIES,
  appendSystemEventLogs,
  createSystemEventId,
  createSystemEventLog,
  formatSystemEventTime,
  migrateLegacyChangeLogs,
  normalizeSystemEventLogs,
  orderEventLogsForDisplay,
  summarizeEventLogs,
} from './logging/system-events';

export type {
  SystemEventCategory,
  SystemEventInput,
  SystemEventLog,
  SystemEventSeverity,
} from './logging/system-events';
