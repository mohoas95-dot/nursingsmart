/**
 * ShiftWriteFacade — Facade Layer
 *
 * RESPONSIBILITY:
 *   Orchestrate schedule write operations by:
 *   1. Validating inputs
 *   2. Delegating pure logic to domain functions
 *   3. Handling side effects (persistence, UI updates)
 *
 * DESIGN:
 *   - Facade is NOT pure — it has side effects (S3, UI state)
 *   - Facade delegates pure logic to domain/scheduling/schedule-operations.ts
 *   - Facade is temporary — will be replaced by Server Actions in Phase 4
 *
 * Strangler Fig Pattern:
 *   Phase 2 (NOW): Wrap legacy handlers in Facade
 *   Phase 3: Extract more pure logic from Facade
 *   Phase 4: Replace Facade with Server Actions
 *
 * Extracted from: app/page.tsx (handleRunOptimizer, handleManualShiftChange)
 */

import type {
  OptimizerInput,
  OptimizerResult,
  ManualShiftChangeInput,
  ManualShiftChangeResult,
} from '../../../domain/scheduling/types';
import type { MonthlySchedule } from '../../../domain/types';
import type { Personnel, ShiftRequest, SystemSettings } from '../../../lib/types';
import {
  mergeOptimizerAssignments,
  updateScheduleCell,
} from '../../../domain/scheduling/schedule-operations';
import { isScheduleLocked } from '../../../domain/guards/shift-edit-guards';

// ============================================================================
// Persistence Interface (Dependency Injection)
// ============================================================================

/**
 * Persistence interface for schedule operations.
 * This allows the Facade to be tested without real S3 calls.
 */
export interface SchedulePersistence {
  saveSchedule(schedule: MonthlySchedule, departmentId: string): Promise<void>;
}

/**
 * UI feedback interface for schedule operations.
 */
export interface ScheduleUIFeedback {
  setSolvingTarget(target: string | null): void;
  showConfirmation(message: string): boolean;
  showError(message: string): void;
}

// ============================================================================
// Optimizer Facade
// ============================================================================

/**
 * Run the optimizer for a specific job group.
 *
 * FLOW:
 *   1. Check if schedule is locked → confirm unlock if needed
 *   2. Call solver (solveWithPriority)
 *   3. Merge assignments (respecting row locks)
 *   4. Verify coverage and leaders
 *   5. Persist to S3
 *   6. Update UI state
 *
 * @param input - Optimizer input parameters
 * @param solver - Solver function (injected for testability)
 * @param verifier - Verification function (injected for testability)
 * @param persistence - Persistence interface
 * @param ui - UI feedback interface
 * @returns OptimizerResult
 */
export async function runOptimizerFacade(
  input: OptimizerInput,
  solver: (
    year: number,
    month: number,
    personnel: ReadonlyArray<Personnel>,
    requests: ReadonlyArray<ShiftRequest>,
    settings: SystemSettings,
    holidays: Readonly<Record<number, string>>,
    firstDayOfWeek: number | undefined,
    monthlyDutyHours: { official: number; contract: number } | null
  ) => { assignments: Record<string, Record<number, string>>; warnings: string[] },
  verifier: (
    year: number,
    month: number,
    personnel: ReadonlyArray<Personnel>,
    assignments: Record<string, Record<number, string>>,
    settings: SystemSettings,
    holidays: Readonly<Record<number, string>>,
    firstDayOfWeek: number | undefined,
    requests: ReadonlyArray<ShiftRequest>
  ) => { shiftLeaders: Record<number, any>; warnings: string[] },
  persistence: SchedulePersistence,
  ui: ScheduleUIFeedback,
  departmentId: string,
  config?: { delayMs?: number }
): Promise<OptimizerResult> {
  const {
    jobGroup,
    year,
    month,
    personnel,
    requests,
    settings,
    holidays,
    firstDayOfWeek,
    monthlyDutyHours,
    currentSchedule,
    lockState,
    dismissedWarnings,
  } = input;

  const monthKey = `${year}_${month}`;

  // Step 1: Check if schedule is locked
  const finalizedMonthsForGroup =
    jobGroup === 'nurse'
      ? lockState.finalizedNursesMonths
      : lockState.finalizedAssistantsMonths;

  const isLocked = isScheduleLocked(jobGroup, finalizedMonthsForGroup, monthKey);

  if (isLocked) {
    const groupTitle = jobGroup === 'nurse' ? 'پرستاران' : 'کمک‌بهیاران';
    const confirmed = ui.showConfirmation(
      `برنامه این ماه ثبت نهایی و قفل شده است. آیا مایلید قفل لیست را باز کرده و بازتولید هوشمند ${groupTitle} را اجرا کنید؟`
    );
    if (!confirmed) {
      return { success: false, schedule: null, personnelUpdated: 0 };
    }
  }

  // Step 2: Show loading state
  ui.setSolvingTarget(jobGroup);

  // Step 3: Delay for loading animation (setTimeout equivalent)
  const delayMs = config?.delayMs ?? 1500;
  if (delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  try {
    // Step 4: Run solver
    const optimized = solver(
      year,
      month,
      personnel,
      requests,
      settings,
      holidays,
      firstDayOfWeek,
      monthlyDutyHours
    );

    // Step 5: Merge assignments (pure domain logic)
    const mergedAssignments = mergeOptimizerAssignments(
      currentSchedule?.assignments,
      optimized.assignments,
      personnel,
      jobGroup,
      lockState.lockedRows
    );

    // Step 6: Verify coverage and leaders
    const verification = verifier(
      year,
      month,
      personnel,
      mergedAssignments,
      settings,
      holidays,
      firstDayOfWeek,
      requests
    );

    // Step 7: Build new schedule
    const newSchedule: MonthlySchedule = {
      ...(currentSchedule || { year, month, assignments: {}, shiftLeaders: {}, warnings: [] }),
      year,
      month,
      assignments: mergedAssignments,
      shiftLeaders: verification.shiftLeaders,
      warnings: verification.warnings,
      finalizedNurses: jobGroup === 'nurse' ? false : currentSchedule?.finalizedNurses,
      finalizedAssistants: jobGroup === 'assistant' ? false : currentSchedule?.finalizedAssistants,
      dismissedWarnings: [...dismissedWarnings],
      lockedRows: [...lockState.lockedRows],
    };

    // Step 8: Persist to S3
    await persistence.saveSchedule(newSchedule, departmentId);

    // Step 9: Count updated personnel
    const personnelUpdated = personnel.filter(
      (p) => p.jobGroup === jobGroup && !lockState.lockedRows.includes(p.id)
    ).length;

    return {
      success: true,
      schedule: newSchedule,
      personnelUpdated,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    ui.showError(`خطا در اجرای بهینه‌ساز: ${errorMessage}`);
    return {
      success: false,
      schedule: null,
      error: errorMessage,
      personnelUpdated: 0,
    };
  } finally {
    // Step 10: Clear loading state
    ui.setSolvingTarget(null);
  }
}

// ============================================================================
// Manual Shift Change Facade
// ============================================================================

/**
 * Apply a manual shift change to a single cell.
 *
 * FLOW:
 *   1. Update the cell (pure domain logic)
 *   2. Verify coverage and leaders
 *   3. Build new schedule
 *   4. Persist to S3
 *   5. Update UI state
 *
 * @param input - Manual shift change input parameters
 * @param verifier - Verification function (injected for testability)
 * @param persistence - Persistence interface
 * @param departmentId - Department ID for persistence
 * @returns ManualShiftChangeResult
 */
export async function applyManualShiftChangeFacade(
  input: ManualShiftChangeInput,
  verifier: (
    year: number,
    month: number,
    personnel: ReadonlyArray<Personnel>,
    assignments: Record<string, Record<number, string>>,
    settings: SystemSettings,
    holidays: Readonly<Record<number, string>>,
    firstDayOfWeek: number | undefined,
    requests: ReadonlyArray<ShiftRequest>
  ) => { shiftLeaders: Record<number, any>; warnings: string[] },
  persistence: SchedulePersistence,
  departmentId: string
): Promise<ManualShiftChangeResult> {
  const {
    personnelId,
    day,
    shift,
    year,
    month,
    currentSchedule,
    personnel,
    requests,
    settings,
    holidays,
    firstDayOfWeek,
  } = input;

  try {
    // Step 1: Update the cell (pure domain logic)
    const updatedAssignments = updateScheduleCell(
      currentSchedule.assignments,
      personnelId,
      day,
      shift
    );

    // Step 2: Verify coverage and leaders
    const verification = verifier(
      year,
      month,
      personnel,
      updatedAssignments,
      settings,
      holidays,
      firstDayOfWeek,
      requests
    );

    // Step 3: Build new schedule
    const newSchedule: MonthlySchedule = {
      ...currentSchedule,
      year,
      month,
      assignments: updatedAssignments,
      shiftLeaders: verification.shiftLeaders,
      warnings: verification.warnings,
      finalized: false,
    };

    // Step 4: Persist to S3
    await persistence.saveSchedule(newSchedule, departmentId);

    return {
      success: true,
      schedule: newSchedule,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      schedule: null,
      error: errorMessage,
    };
  }
}
