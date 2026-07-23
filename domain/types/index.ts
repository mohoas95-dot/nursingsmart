/**
 * Domain Types - Pure TypeScript types with ZERO dependencies on React, Next.js, or browser APIs
 * These types are Solver-Ready and can be used by future AI optimization engines
 */

// ============================================================================
// Calendar Types
// ============================================================================

export interface DutyHours {
  official: number;
  contract: number;
}

export interface CalendarDay {
  dayOfWeek: number; // 0=Saturday, 1=Sunday, ..., 5=Thursday, 6=Friday
  isHoliday: boolean;
}

export interface MonthlyCalendar {
  days: CalendarDay[];
  holidays: Record<number, string>;
  firstDayOfWeek: number;
}

// ============================================================================
// Shift & Schedule Types
// ============================================================================

export type JobGroup = 'nurse' | 'assistant';

/**
 * برچسب روتین کاری پرسنل — تعیین‌کننده الگوی شیفت‌بندی پیش‌فرض فرد.
 *
 *   - MORNING_ONLY       : صبح کار
 *   - LONG_SHIFT         : لانگ کار (ME)
 *   - EVENING_NIGHT      : عصر شب کار (EN)
 *   - FULL_ROTATION_MEN  : صبح عصر شب کار (MEN)
 *   - ROTATING_GENERAL   : چرخشی کار عمومی (پیش‌فرض)
 */
export type RoutineTag =
  | 'MORNING_ONLY'
  | 'LONG_SHIFT'
  | 'EVENING_NIGHT'
  | 'FULL_ROTATION_MEN'
  | 'ROTATING_GENERAL';

export type ShiftType = 'M' | 'E' | 'N' | 'ME' | 'EN' | 'MN' | 'MEN' | 'OFF' | 'UNFILLED' | string;

export type NursePosition = 'supervisor' | 'staff' | 'general' | 'none';

export type EmploymentType = 'official' | 'contract' | 'conscript' | 'overtime';

/**
 * Personnel — نسخهٔ Solver-Ready از نوع پرسنل.
 *
 * این نوع مستقل از React/Next.js/Browser است و توسط موتورهای بهینه‌سازی
 * (AI Solver) قابل مصرف است. با نوع هم‌نام در `lib/types` سازگار ساختاری است.
 */
export interface Personnel {
  id: string;
  firstName: string;
  lastName: string;
  personalCode: string;
  jobGroup: JobGroup;
  position: NursePosition;
  employmentType: EmploymentType;
  experienceYears: number;
  active: boolean;
  canBeShiftLeader: boolean;
  // برچسب روتین کاری (اختیاری/nullable؛ مقدار پیش‌فرض ROTATING_GENERAL است).
  routineTag?: RoutineTag | null;
  orderIndex?: number;
  username?: string;
  password?: string;
  locked?: boolean;
}

export interface ScheduleLockState {
  finalizedNursesMonths: string[];
  finalizedAssistantsMonths: string[];
  lockedRows: string[];
}

export interface ShiftEditCheckResult {
  allowed: boolean;
  reason?: 'schedule_locked' | 'row_locked' | 'valid';
  message?: string;
}

export interface AutoSubstitutionRecord {
  personnelId: string;
  day: number;
  originalShift: ShiftType;
  newShift: ShiftType;
  reason: string;
  timestamp: string;
}

export interface MonthlySchedule {
  year: number;
  month: number;
  assignments: {
    [personnelId: string]: {
      [day: number]: ShiftType;
    };
  };
  shiftLeaders: {
    [day: number]: {
      morning?: string;
      afternoon?: string;
      night?: string;
    };
  };
  warnings: string[];
  // هشدارهای بحرانی (قرمز) ناشی از وتوی دستی سرپرستار که قانون ایمنی را می‌شکند.
  criticalWarnings?: string[];
  finalized?: boolean;
  finalizedNurses?: boolean;
  finalizedAssistants?: boolean;
  requestsLocked?: boolean;
  dismissedWarnings?: string[];
  changeLogs?: string[];
  lockedRows?: string[];
  autoSubstitutions?: AutoSubstitutionRecord[];
}

// ============================================================================
// Request Types
// ============================================================================

export type RequestScope =
  | 'all'
  | 'even'
  | 'odd'
  | 'saturdays'
  | 'sundays'
  | 'mondays'
  | 'tuesdays'
  | 'wednesdays'
  | 'thursdays'
  | 'fridays'
  | 'range'
  | 'weekly_even'
  | 'weekly_odd'
  | 'custom_days';

export interface ShiftRequestScope {
  scope: RequestScope;
  startDate?: string;
  endDate?: string;
  selectedDays?: number[];
}
