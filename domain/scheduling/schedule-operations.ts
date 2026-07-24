/**
 * Schedule Operations — Domain Layer (Pure Functions)
 *
 * RESPONSIBILITY:
 *   Pure business logic for schedule write operations.
 *   ZERO side effects — no I/O, no UI, no persistence.
 *
 * These functions are consumed by the Facade layer, which handles:
 *   - Persistence (S3/Server Actions)
 *   - UI state updates (React state)
 *   - User feedback (alerts, toasts)
 *
 * Extracted from: app/page.tsx (handleRunOptimizer, handleManualShiftChange)
 */

import type { JobGroup, ShiftType, MonthlySchedule } from '../types';
import type { Personnel, ShiftRequest, SystemSettings, WorkRoutineTag } from '../../lib/types';
import { isPersonnelOptimizationTarget } from '../guards/shift-edit-guards';

// ============================================================================
// Schedule Assignment Normalization
// ============================================================================

/**
 * Normalize schedule assignments to ensure all active personnel have entries.
 * Missing personnel get empty day maps.
 *
 * @pure - No side effects
 */
export function normalizeScheduleAssignments(
  assignments: Record<string, Record<number, ShiftType>> | undefined,
  personnel: ReadonlyArray<Personnel>
): Record<string, Record<number, ShiftType>> {
  const normalized: Record<string, Record<number, ShiftType>> = {};

  for (const person of personnel) {
    if (!person.active) continue;
    normalized[person.id] = { ...(assignments?.[person.id] || {}) };
  }

  return normalized;
}

// ============================================================================
// Optimizer: Merge Assignments
// ============================================================================

/**
 * Merge optimized assignments into the current schedule, respecting row locks.
 *
 * BUSINESS RULE:
 *   - Only personnel whose rows are NOT locked should be updated
 *   - Only personnel in the target job group should be updated
 *   - All other personnel retain their current assignments
 *
 * @param currentAssignments - Current schedule assignments (or null if no schedule exists)
 * @param optimizedAssignments - New assignments from the solver
 * @param personnel - All personnel
 * @param targetJobGroup - Job group being optimized ('nurse' or 'assistant')
 * @param lockedRows - Array of locked personnel IDs
 * @returns Merged assignments
 *
 * @pure - No side effects
 */
export function mergeOptimizerAssignments(
  currentAssignments: Record<string, Record<number, ShiftType>> | undefined,
  optimizedAssignments: Record<string, Record<number, ShiftType>>,
  personnel: ReadonlyArray<Personnel>,
  targetJobGroup: JobGroup,
  lockedRows: ReadonlyArray<string>
): Record<string, Record<number, ShiftType>> {
  const baseAssignments = normalizeScheduleAssignments(currentAssignments, personnel);
  const mergedAssignments = currentAssignments
    ? { ...baseAssignments }
    : normalizeScheduleAssignments(optimizedAssignments, personnel);

  // Only update personnel who are targets (correct job group + not locked)
  const targetPersonnel = personnel.filter((p) =>
    isPersonnelOptimizationTarget(p.jobGroup, targetJobGroup, p.id, lockedRows)
  );

  for (const person of targetPersonnel) {
    mergedAssignments[person.id] = { ...(optimizedAssignments[person.id] || {}) };
  }

  return mergedAssignments;
}

// ============================================================================
// Manual Shift Change: Update Single Cell
// ============================================================================

/**
 * Update a single cell in the schedule assignments.
 *
 * @param assignments - Current assignments
 * @param personnelId - Personnel ID for the row
 * @param day - Day number (1-31)
 * @param shift - New shift value
 * @returns Updated assignments (shallow copy)
 *
 * @pure - No side effects, no mutation of input
 */
export function updateScheduleCell(
  assignments: Record<string, Record<number, ShiftType>>,
  personnelId: string,
  day: number,
  shift: ShiftType
): Record<string, Record<number, ShiftType>> {
  const updated = { ...assignments };
  if (!updated[personnelId]) {
    updated[personnelId] = {};
  } else {
    updated[personnelId] = { ...updated[personnelId] };
  }
  updated[personnelId][day] = shift;
  return updated;
}

// ============================================================================
// Personnel: Build Personnel Object
// ============================================================================

/**
 * Build a Personnel object from form data, handling both create and update cases.
 *
 * @param editingPersonnel - Existing personnel (null for new)
 * @param formData - Form input data
 * @param pendingId - Pending ID for new personnel (or null to generate)
 * @param currentOrderIndex - Current max order index (for new personnel)
 * @returns New or updated Personnel object
 *
 * @pure - No side effects
 */
export function buildPersonnelFromForm(
  editingPersonnel: Personnel | null,
  formData: {
    firstName: string;
    lastName: string;
    personalCode: string;
    jobGroup: JobGroup;
    position: 'supervisor' | 'staff' | 'general' | 'none';
    employmentType: 'official' | 'contract' | 'conscript' | 'overtime';
    experienceYears: number;
    active: boolean;
    canBeShiftLeader: boolean;
    workRoutine?: WorkRoutineTag | '';
  },
  pendingId: string | null,
  currentOrderIndex: number
): Personnel {
  // Apply business rules: assistants always have position='none' and canBeShiftLeader=false
  const position = formData.jobGroup === 'assistant' ? 'none' : formData.position;
  const canBeShiftLeader = formData.jobGroup === 'assistant' ? false : formData.canBeShiftLeader;
  const workRoutine = formData.workRoutine || undefined;

  if (editingPersonnel) {
    // Update existing personnel
    return {
      ...editingPersonnel,
      firstName: formData.firstName,
      lastName: formData.lastName,
      personalCode: formData.personalCode,
      jobGroup: formData.jobGroup,
      position,
      employmentType: formData.employmentType,
      experienceYears: formData.experienceYears,
      active: formData.active,
      canBeShiftLeader,
      workRoutine,
    };
  } else {
    // Create new personnel
    const newId = pendingId || `p_${crypto.randomUUID().replaceAll('-', '')}`;
    return {
      id: newId,
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim(),
      personalCode: formData.personalCode.trim(),
      jobGroup: formData.jobGroup,
      position,
      employmentType: formData.employmentType,
      experienceYears: formData.experienceYears,
      active: formData.active,
      canBeShiftLeader,
      workRoutine,
      orderIndex: currentOrderIndex,
    };
  }
}

/**
 * Validate personnel form data before save.
 *
 * @returns Validation result with error message if invalid
 *
 * @pure - No side effects
 */
export function validatePersonnelForm(formData: {
  firstName: string;
  lastName: string;
  nationalId: string;
}, isEditing: boolean): { valid: boolean; error?: string } {
  if (!formData.firstName.trim() || !formData.lastName.trim()) {
    return {
      valid: false,
      error: 'لطفاً نام و نام خانوادگی فرد را وارد کنید.',
    };
  }

  if (!isEditing && !formData.nationalId.trim()) {
    return {
      valid: false,
      error: 'برای پرسنل جدید، کد ملی الزامی است.',
    };
  }

  return { valid: true };
}
