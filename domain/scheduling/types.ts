/**
 * Scheduling Domain Types — Facade Contracts
 *
 * These types define the input/output contracts for schedule write operations.
 * They are Solver-Ready and can be consumed by future Server Actions.
 */

import type { JobGroup, ShiftType, MonthlySchedule, ScheduleLockState } from '../types';
import type { Personnel, ShiftRequest, SystemSettings, WorkRoutineTag } from '../../lib/types';
import type { RosterDiffEntry } from './roster-inheritance';

export type { RosterDiffEntry } from './roster-inheritance';

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
  /**
   * فهرست هشدارهای نادیده‌گرفته‌شده پیش از این ویرایش. پس از اعمال تغییر، هشدارهایی
   * که دیگر مصداق ندارند از این فهرست حذف می‌شوند تا کاملاً از سیستم پاک شوند.
   */
  dismissedWarnings?: ReadonlyArray<string>;
  /**
   * مجموعه سلول‌های محافظت‌شده (ویرایش‌های دستی سرپرستار). فرمت: "personnelId:day"
   * این سلول‌ها هرگز توسط reconcileStaffingCoverage تغییر داده نمی‌شوند.
   */
  protectedCells?: ReadonlyArray<string>;
}

export interface ManualShiftChangeResult {
  success: boolean;
  schedule: MonthlySchedule | null;
  error?: string;
  /** هشدارهایی که با این ویرایش رفع شدند و باید از وضعیت نادیده‌گرفتن هم پاک شوند. */
  resolvedWarnings?: ReadonlyArray<string>;
}

// ============================================================================
// Scenario Proposal Merge Operation — Merge مرجع‌محور سناریو روی برنامهٔ مبنا
// ============================================================================

/**
 * ورودی Merge یک سناریو (پیشنهاد موتور) روی برنامهٔ مبنا.
 *
 * قرارداد معماری: برنامهٔ مبنا تنها منبع حقیقت است؛ سناریو فقط پیشنهاد است و
 * هیچ‌گاه مستقیم جای مرجع را نمی‌گیرد. Merge = فقط Diff سناریو نسبت به مبنا و
 * فقط برای پرسنل آزاد.
 */
export interface ScenarioProposalMergeInput {
  /** گروه هدف سناریو (پرستاران/کمک‌بهیاران) — ردیف گروه دیگر دست‌نخورده می‌ماند. */
  jobGroup: JobGroup;
  year: number;
  month: number;
  personnel: ReadonlyArray<Personnel>;
  requests: ReadonlyArray<ShiftRequest>;
  settings: SystemSettings;
  holidays: Readonly<Record<number, string>>;
  firstDayOfWeek: number | undefined;
  /** تعداد روزهای ماه — برای محاسبهٔ Diff سطح‌سلول. */
  totalDays: number;
  /** برنامهٔ مبنای فعلی (مرجع). اگر null باشد، سناریو به‌عنوان پایهٔ اولیه در نظر گرفته می‌شود. */
  currentSchedule: MonthlySchedule | null;
  /** تخصیص‌های پیشنهادی سناریوی انتخاب‌شده. */
  candidateAssignments: Record<string, Record<number, ShiftType>>;
  lockState: ScheduleLockState;
  /** هشدارهای نادیده‌گرفته‌شدهٔ فعلی برنامهٔ مبنا. */
  dismissedWarnings?: ReadonlyArray<string>;
}

export interface ScenarioProposalMergeResult {
  success: boolean;
  /** برنامهٔ مبنای جدید (مرجع به‌روزشده) — منبع حقیقت پس از Merge. */
  schedule: MonthlySchedule | null;
  error?: string;
  /** تغییرهای اعمال‌شده از سناریو روی مبنا (فقط پرسنل آزاد). */
  appliedChanges?: ReadonlyArray<RosterDiffEntry>;
  /** تغییرهای ردشده به‌دلیل قفل ماهانهٔ پرسنل. */
  rejectedChanges?: ReadonlyArray<RosterDiffEntry>;
  /** هشدارهایی که پس از Merge و محاسبهٔ مجدد Constraintها رفع شدند. */
  resolvedWarnings?: ReadonlyArray<string>;
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
