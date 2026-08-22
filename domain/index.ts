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
// Exact Rational Arithmetic
// ============================================================================

export {
  EXACT_RATIONAL_ONE,
  EXACT_RATIONAL_ZERO,
  addExactRational,
  compareExactRationalDescending,
  createExactRational,
  deserializeExactRational,
  divideExactRationalByInteger,
  exactRationalEquals,
  exactRationalToNumberForDisplay,
  serializeExactRational,
} from './math/exact-rational';
export type {
  ExactRational,
  SerializedExactRational,
} from './math/exact-rational';

// ============================================================================
// Requests
// ============================================================================

export {
  isDayInRequestScope,
  patternStepForDay,
} from './requests/request-scope-matcher';
export type { PatternScopeRequest } from './requests/request-scope-matcher';

export {
  CANONICAL_REQUEST_DAY_VERSION,
  CANONICAL_REQUEST_VALUES,
  REQUEST_COMPONENTS,
  REQUEST_CONFLICT_REASONS,
  REQUEST_DAY_OUTCOME_VERSION,
  REQUEST_INTENTS,
  REQUEST_INVALID_REASONS,
  REQUEST_OUTCOME_KINDS,
  REQUEST_OUTCOME_LEDGER_VERSION,
  REQUEST_OUTCOME_REASONS,
  REQUEST_POLARITIES,
  REQUEST_QUALITY_VERSION,
  REQUEST_RESOLUTION_PROVENANCE_VERSION,
  REQUEST_RESOLUTION_STAGES,
  REQUEST_VALIDATION_ISSUE_VERSION,
  deserializeRequestQuality,
  serializeRequestQuality,
} from './requests/request-domain';
export type {
  BlockedRequestDayOutcome,
  CanonicalRequestDay,
  CanonicalRequestValue,
  CompatibleRequestDayOutcome,
  ConflictRequestDayOutcome,
  ConflictRequestValidationIssue,
  ExactRequestDayOutcome,
  InvalidRequestDayOutcome,
  InvalidRequestValidationIssue,
  NonEmptyRequestResolutionProvenance,
  PartialRequestDayOutcome,
  QualityEligibleRequestDayOutcome,
  RequestComponent,
  RequestConflictReason,
  RequestDayOutcome,
  RequestIntent,
  RequestInvalidReason,
  RequestOutcomeKind,
  RequestOutcomeLedger,
  RequestOutcomeReason,
  RequestPolarity,
  RequestQuality,
  RequestResolutionProvenance,
  RequestResolutionStage,
  RequestValidationIssue,
  SerializedRequestQuality,
  UnsatisfiedRequestDayOutcome,
} from './requests/request-domain';

export {
  SEMANTIC_PATTERN_STEP_VALUES,
  SEMANTIC_REQUEST_SCOPES,
  SEMANTIC_REQUEST_TYPES,
  SEMANTIC_WORK_SHIFT_VALUES,
  validateRequestsSemantically,
} from './requests/request-semantic-validator';
export type {
  RequestSemanticValidationCalendarDay,
  RequestSemanticValidationContext,
  RequestSemanticValidationResult,
  SemanticPatternStepValue,
  SemanticRequestScope,
  SemanticWorkShiftValue,
} from './requests/request-semantic-validator';

export {
  CANONICAL_REQUEST_MONTH_VERSION,
  canonicalizeRequestDaysForMonth,
} from './requests/request-canonicalizer';
export type {
  CanonicalRequestMonthResult,
} from './requests/request-canonicalizer';

export {
  REQUEST_GENERATION_BLOCKED_ERROR_NAME,
  RequestGenerationBlockedError,
  adaptCanonicalRequestMonthForSolver,
} from './requests/solver-request-adapter';
export type {
  SolverRequestView,
} from './requests/solver-request-adapter';

export { evaluateCanonicalRequestDay } from './requests/request-outcome-evaluator';
export {
  buildRequestOutcomeLedger,
  prioritizeRequestDeficienciesForCandidate,
} from './requests/request-outcome-ledger';
export { buildRequestQualityFromLedger } from './requests/request-quality';
export {
  REQUEST_SET_FINGERPRINT_CONTRACT_VERSION,
  buildRequestSetFingerprint,
  serializeCanonicalRequestSet,
} from './requests/request-set-fingerprint';
export {
  deserializeMonthlyRequestArtifacts,
  deserializeRequestOutcomeLedger,
  serializeMonthlyRequestArtifacts,
  serializeRequestOutcomeLedger,
} from './requests/request-persistence';
export type {
  SerializedMonthlyRequestArtifacts,
  SerializedRequestOutcomeLedger,
} from './requests/request-persistence';
export {
  projectRequestWarningsFromLedger,
  replaceRequestWarningsFromLedger,
} from './requests/request-warning-projection';
export { formatRequestGenerationIssues } from './requests/request-issue-presentation';

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
  shiftViolatesRoutine,
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

// ============================================================================
// Shift Hours + Overtime Cap — ساعت هر شیفت و سقف اضافه‌کار
// ============================================================================

export {
  SHIFT_HOURS,
  getLeaveHours,
  getShiftHours,
} from './scheduling/shift-hours';

export {
  OVERTIME_CAP_FALLBACK,
  effectiveOvertimeCap,
  overtimeHoursForPerson,
  wouldExceedOvertimeCap,
} from './scheduling/overtime-cap';
export type { OvertimeCapSource } from './scheduling/overtime-cap';

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
  INFORMATIONAL_WARNING_CODES,
  countCriticalScheduleWarnings,
  createScheduleWarning,
  dedupeScheduleWarningsByMessage,
  defaultSeverityForCode,
  getCriticalScheduleWarnings,
  hasCriticalScheduleWarning,
  isCriticalScheduleWarning,
  isCriticalWarningCode,
  isInformationalWarningCode,
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
