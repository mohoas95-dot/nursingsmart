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
import { reconcileStaffingCoverage } from '../../../domain/scheduling/staffing-coverage';
import { repairScheduleBeforeWarnings } from '../../../domain/scheduling/repair-orchestrator';
import { findResolvedWarnings, pruneDismissedWarnings } from '../../../domain/scheduling/alert-lifecycle';
import { canEditShiftCell, isScheduleLocked } from '../../../domain/guards/shift-edit-guards';
import { generateJalaliMonthCalendar } from '../../../lib/jalali';

interface ShiftLeaderRecord {
  morning?: string;
  afternoon?: string;
  night?: string;
}

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
  ) => { shiftLeaders: Record<number, ShiftLeaderRecord>; warnings: string[] },
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

    // Merging a single job group with the current schedule (especially when some
    // rows are locked) can reintroduce a shortage or an excess that did not exist
    // in the solver's full result. Reconcile the target group against the same
    // persisted staffing settings before verification and storage.
    const calendar = generateJalaliMonthCalendar(
      year,
      month,
      holidays,
      firstDayOfWeek
    );
    const calendarDays = calendar.map(day => ({ day: day.day, isHoliday: day.isHoliday, dayOfWeek: day.dayOfWeek }));
    const staffingResult = reconcileStaffingCoverage(
      mergedAssignments,
      personnel,
      settings,
      calendarDays,
      [jobGroup],
      lockState.lockedRows,
      requests
    );
    const compliantAssignments = repairScheduleBeforeWarnings({
      assignments: staffingResult.assignments,
      personnelList: personnel,
      settings,
      calendarDays,
      requests,
      targetJobGroups: [jobGroup],
      lockedRows: lockState.lockedRows,
    }).assignments;

    // Step 6: Verify coverage and leaders
    const verification = verifier(
      year,
      month,
      personnel,
      compliantAssignments,
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
      assignments: compliantAssignments,
      shiftLeaders: verification.shiftLeaders,
      warnings: verification.warnings,
      finalizedNurses: jobGroup === 'nurse' ? false : currentSchedule?.finalizedNurses,
      finalizedAssistants: jobGroup === 'assistant' ? false : currentSchedule?.finalizedAssistants,
      // هشدارهایی که با این بازتولید واقعاً رفع شده‌اند دیگر «نادیده‌گرفته‌شده» نمی‌مانند؛
      // وگرنه اگر همان تخلف بعداً دوباره ساخته شود، بی‌صدا پنهان می‌ماند.
      dismissedWarnings: pruneDismissedWarnings(verification.warnings, dismissedWarnings),
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
  ) => { shiftLeaders: Record<number, ShiftLeaderRecord>; warnings: string[] },
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
    lockState,
    dismissedWarnings = currentSchedule.dismissedWarnings ?? [],
    protectedCells: protectedCellsInput,
  } = input;

  const lockedRows = lockState?.lockedRows ?? [];

  // ====== مرز نوشتن (write boundary) ======
  // همان قول‌های قفلی که UI می‌دهد باید اینجا هم — پیش از هر persist —
  // اجرا شوند؛ وگرنه فراخوانی مستقیم facade می‌تواند گروهِ ثبت‌نهایی‌شده یا
  // ردیف قفل‌شده را بازنویسی کند. از همان گزارهٔ خالص UI (canEditShiftCell)
  // استفاده می‌شود تا سیاست تکراری ساخته نشود.
  // (سمنتیک person.locked عمداً اینجا تصمیم‌گیری نمی‌شود — policy-pending.)
  const guardedPerson = personnel.find(p => p.id === personnelId);
  if (guardedPerson && lockState) {
    const finalizedMonthsForGroup =
      guardedPerson.jobGroup === 'nurse'
        ? lockState.finalizedNursesMonths
        : lockState.finalizedAssistantsMonths;
    const editCheck = canEditShiftCell({
      jobGroup: guardedPerson.jobGroup,
      personnelId,
      finalizedMonths: finalizedMonthsForGroup,
      lockedRows,
      monthKey: `${year}_${month}`,
    });
    if (!editCheck.allowed) {
      return {
        success: false,
        schedule: null,
        error: editCheck.message ?? 'ویرایش این سلول مجاز نیست.',
      };
    }
  }

  // سلول ویرایش‌شده توسط سرپرستار + تمام سلول‌های محافظت‌شده قبلی
  const protectedSet = new Set<string>(protectedCellsInput ?? []);
  protectedSet.add(`${personnelId}:${day}`); // سلول فعلی همیشه محافظت می‌شود

  try {
    // Step 1: Update the cell — تغییر دستی سرپرستار حفظ می‌شود
    const updatedAssignments = updateScheduleCell(
      currentSchedule.assignments,
      personnelId,
      day,
      shift
    );

    // Step 2: Auto-reconcile — جبران خودکار کمبود و مازاد
    // سیستم به‌صورت زنجیره‌وار تلاش می‌کند کمبود/مازاد را جبران کند.
    // چندین بار اجرا می‌شود تا اثرات آبشاری (مثلاً آزاد شدن نفر از مازاد روز دیگر
    // و استفاده از او برای جبران کمبود) هم پوشش داده شوند.
    // قوانین:
    //   - تغییر دستی سرپرستار هرگز لغو نمی‌شود (سلول ویرایش‌شده دست‌نخورده می‌ماند)
    //   - شیفت نفرات قفل‌شده (lockedRows) هرگز تغییر نمی‌کند
    //   - فقط در صورتی که هیچ راهی برای جبران نباشد، هشدار صادر می‌شود
    const editedPerson = personnel.find(p => p.id === personnelId);
    const targetJobGroups: Array<'nurse' | 'assistant'> = editedPerson
      ? [editedPerson.jobGroup]
      : ['nurse', 'assistant'];

    const calendar = generateJalaliMonthCalendar(year, month, holidays, firstDayOfWeek);
    const calendarDays = calendar.map(d => ({ day: d.day, isHoliday: d.isHoliday, dayOfWeek: d.dayOfWeek }));

    let reconciledAssignments = updatedAssignments;
    const MAX_RECONCILE_PASSES = 3;
    let prevUnresolvedCount = Infinity;

    for (let pass = 0; pass < MAX_RECONCILE_PASSES; pass++) {
      const staffingResult = reconcileStaffingCoverage(
        reconciledAssignments,
        personnel,
        settings,
        calendarDays,
        targetJobGroups,
        lockedRows, // ← شیفت نفرات قفل‌شده هرگز تغییر نمی‌کند
        requests,
        protectedSet // ← سلول‌های ویرایش‌دستی سرپرستار هرگز دست‌نخورده می‌مانند
      );
      reconciledAssignments = staffingResult.assignments;

      // اگر تعداد gapها کمتر نشد یا صفر شد، توقف
      if (staffingResult.unresolvedGaps.length === 0) break;
      if (staffingResult.unresolvedGaps.length >= prevUnresolvedCount) break;
      prevUnresolvedCount = staffingResult.unresolvedGaps.length;
    }

    // Step 3: Verify coverage and leaders (on reconciled assignments)
    const verification = verifier(
      year,
      month,
      personnel,
      reconciledAssignments,
      settings,
      holidays,
      firstDayOfWeek,
      requests
    );

    // Step 4: Retire alerts that this edit actually resolved.
    const prunedDismissed = pruneDismissedWarnings(verification.warnings, dismissedWarnings);
    const resolvedWarnings = findResolvedWarnings(
      currentSchedule.warnings ?? [],
      verification.warnings
    );

    // Step 5: Build new schedule
    const newSchedule: MonthlySchedule = {
      ...currentSchedule,
      year,
      month,
      assignments: reconciledAssignments,
      shiftLeaders: verification.shiftLeaders,
      warnings: verification.warnings,
      dismissedWarnings: prunedDismissed,
      finalized: false,
    };

    // Step 6: Persist to S3
    await persistence.saveSchedule(newSchedule, departmentId);

    return {
      success: true,
      schedule: newSchedule,
      resolvedWarnings,
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
