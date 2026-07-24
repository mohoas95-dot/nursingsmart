/**
 * Scheduling Domain Types — Facade Contracts
 *
 * These types define the input/output contracts for schedule write operations.
 * They are Solver-Ready and can be consumed by future Server Actions.
 */

import type { JobGroup, ShiftType, MonthlySchedule, ScheduleLockState } from '../types';
import type { Personnel, ShiftRequest, SystemSettings, WorkRoutineTag } from '../../lib/types';

// ============================================================================
// Optimizer Operation
// ============================================================================

export interface OptimizerInput {
  jobGroup: JobGroup;
  year: number;
  month: number;
  personnel: ReadonlyArray<Personnel>;
  requests: ReadonlyArray<ShiftRequest>;
  settings: SystemSettings;
  holidays: Readonly<Record<number, string>>;
  firstDayOfWeek: number | undefined;
  monthlyDutyHours: { official: number; contract: number } | null;
  currentSchedule: MonthlySchedule | null;
  lockState: ScheduleLockState;
  dismissedWarnings: ReadonlyArray<string>;
}

/**
 * Configuration for the optimizer facade runtime behavior.
 */
export interface OptimizerConfig {
  /** Delay in milliseconds before solver execution (for loading animation). Default: 1500 */
  delayMs?: number;
}

export interface OptimizerResult {
  success: boolean;
  schedule: MonthlySchedule | null;
  error?: string;
  personnelUpdated: number;
}

// ============================================================================
// Manual Shift Change Operation
// ============================================================================

export interface ManualShiftChangeInput {
  personnelId: string;
  day: number;
  shift: ShiftType;
  year: number;
  month: number;
  currentSchedule: MonthlySchedule;
  personnel: ReadonlyArray<Personnel>;
  requests: ReadonlyArray<ShiftRequest>;
  settings: SystemSettings;
  holidays: Readonly<Record<number, string>>;
  firstDayOfWeek: number | undefined;
  lockState: ScheduleLockState;
}

export interface ManualShiftChangeResult {
  success: boolean;
  schedule: MonthlySchedule | null;
  error?: string;
}

// ============================================================================
// Personnel Save Operation
// ============================================================================

export interface PersonnelSaveInput {
  editingPersonnel: Personnel | null;
  formData: {
    firstName: string;
    lastName: string;
    personalCode: string;
    nationalId: string;
    jobGroup: JobGroup;
    position: 'supervisor' | 'staff' | 'general' | 'none';
    employmentType: 'official' | 'contract' | 'conscript' | 'overtime';
    experienceYears: number;
    active: boolean;
    canBeShiftLeader: boolean;
    workRoutine?: WorkRoutineTag | '';
  };
  currentPersonnel: ReadonlyArray<Personnel>;
  pendingPersonnelId: string | null;
}

export interface PersonnelSaveResult {
  success: boolean;
  personnel: Personnel | null;
  personnelList: Personnel[] | null;
  error?: string;
  requiresAccountCreation: boolean;
  accountCreationData?: {
    nationalId: string;
    firstName: string;
    lastName: string;
    personnelId: string;
  };
}
