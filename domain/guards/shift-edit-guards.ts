/**
 * ShiftEditGuards — Domain Layer (Pure Predicates)
 *
 * RESPONSIBILITY:
 *   Deterministic guard functions that answer "Can this cell/row/schedule be edited?"
 *   without any UI side effects (no alerts, no confirmations, no DOM access).
 *
 * DESIGN DECISION:
 *   These are PURE predicates. They return structured results, not UI actions.
 *   The UI layer (components/handlers) is responsible for converting these results
 *   into alerts, toasts, or visual feedback.
 *
 * Extracted from: app/page.tsx (handleCellClick ~line 2025, handleRunOptimizer ~line 1486)
 */

import type { JobGroup, ShiftEditCheckResult } from '../types';

/**
 * Check whether the schedule for a given job group and month is finalized (locked).
 *
 * @param jobGroup - 'nurse' or 'assistant'
 * @param finalizedMonths - Array of month keys (e.g., ['1404_3', '1404_4']) that are locked
 * @param monthKey - The month key to check (e.g., '1404_3')
 * @returns true if the schedule is locked for this job group + month
 *
 * @pure - No side effects
 */
export function isScheduleLocked(
  jobGroup: JobGroup,
  finalizedMonths: ReadonlyArray<string>,
  monthKey: string
): boolean {
  void jobGroup; // jobGroup determines WHICH finalizedMonths array to use (caller's responsibility)
  return finalizedMonths.includes(monthKey);
}

/**
 * Check whether a specific personnel row is locked.
 *
 * @param personnelId - The ID of the personnel
 * @param lockedRows - Array of personnel IDs whose rows are locked
 * @returns true if the row is locked
 *
 * @pure - No side effects
 */
export function isPersonnelRowLocked(
  personnelId: string,
  lockedRows: ReadonlyArray<string>
): boolean {
  return lockedRows.includes(personnelId);
}

/**
 * Full guard check: Can a specific cell be edited?
 *
 * Combines schedule lock + row lock checks into a single structured result.
 * The caller decides what to do with the result (show alert, disable button, etc.)
 *
 * @param params.jobGroup - 'nurse' or 'assistant'
 * @param params.personnelId - The personnel ID for the row
 * @param params.finalizedMonths - Array of locked month keys for this job group
 * @param params.lockedRows - Array of locked personnel IDs
 * @param params.monthKey - The current month key
 * @returns ShiftEditCheckResult with allowed flag and reason
 *
 * @pure - No side effects
 */
export function canEditShiftCell(params: {
  jobGroup: JobGroup;
  personnelId: string;
  finalizedMonths: ReadonlyArray<string>;
  lockedRows: ReadonlyArray<string>;
  monthKey: string;
}): ShiftEditCheckResult {
  const { jobGroup, personnelId, finalizedMonths, lockedRows, monthKey } = params;

  // Check 1: Is the entire schedule locked for this job group + month?
  if (isScheduleLocked(jobGroup, finalizedMonths, monthKey)) {
    const groupLabel = jobGroup === 'nurse' ? 'پرستاران' : 'کمک‌بهیاران';
    return {
      allowed: false,
      reason: 'schedule_locked',
      message: `برنامه ${groupLabel} قفل شده است و امکان ویرایش دستی وجود ندارد.`,
    };
  }

  // Check 2: Is this specific row locked?
  if (isPersonnelRowLocked(personnelId, lockedRows)) {
    return {
      allowed: false,
      reason: 'row_locked',
      message: 'این ردیف قفل شده است و نمی‌توان آن را ویرایش کرد.',
    };
  }

  return { allowed: true, reason: 'valid' };
}

/**
 * Check whether a specific personnel should be included in an optimizer run.
 * A personnel is a target if they belong to the job group AND their row is not locked.
 *
 * @param personnelJobGroup - The personnel's job group
 * @param targetJobGroup - The job group being optimized
 * @param personnelId - The personnel ID
 * @param lockedRows - Array of locked personnel IDs
 * @returns true if this personnel should be included in the optimization
 *
 * @pure - No side effects
 */
export function isPersonnelOptimizationTarget(
  personnelJobGroup: JobGroup,
  targetJobGroup: JobGroup,
  personnelId: string,
  lockedRows: ReadonlyArray<string>
): boolean {
  return personnelJobGroup === targetJobGroup && !isPersonnelRowLocked(personnelId, lockedRows);
}
