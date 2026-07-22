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

export type NursePosition = 'supervisor' | 'staff' | 'general' | 'none';

export type EmploymentType = 'official' | 'contract' | 'conscript' | 'overtime';

// ====== برچسب روتین کاری پرسنل ======
export type RoutineTag =
  | 'MORNING_ONLY'       // صبح کار
  | 'LONG_SHIFT'         // لانگ کار: ME
  | 'EVENING_NIGHT'      // عصر شب کار: EN
  | 'FULL_ROTATION_MEN'  // صبح عصر شب کار: MEN
  | 'ROTATING_GENERAL';  // چرخشی کار عمومی

export type ShiftType = 'M' | 'E' | 'N' | 'ME' | 'EN' | 'MN' | 'MEN' | 'OFF' | 'UNFILLED' | string;

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
  orderIndex?: number;
  username?: string;
  password?: string;
  locked?: boolean;
  /** برچسب روتین کاری — اختیاری، پیش‌فرض: ROTATING_GENERAL */
  routineTag?: RoutineTag;
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

// ============================================================================
// Arena / Scenario Types
// ============================================================================

/** امتیاز یک سناریوی برنامه‌ریزی */
export interface ScenarioScore {
  /** امتیاز کلی (بالاتر = بهتر) */
  total: number;
  /** درصد پوشش شیفت‌ها */
  coverageRate: number;
  /** تعداد تخلف از درخواست‌های ضروری */
  essentialViolations: number;
  /** تعداد هشدارهای فعال */
  warningCount: number;
  /** تعداد شیفت‌های پر‌نشده (UNFILLED) */
  unfilledSlots: number;
}

/** یک سناریوی آرنا — برنامه‌ریزی پیشنهادی برای مقایسه */
export interface ArenaScenario {
  /** شناسه یکتای سناریو */
  id: string;
  /** عنوان نمایشی سناریو */
  label: string;
  /** توضیح مختصر رویکرد این سناریو */
  description?: string;
  /** زمان ایجاد (ISO 8601) */
  createdAt: string;
  /** برنامه ماهانه تولیدشده */
  schedule: MonthlySchedule;
  /** امتیاز محاسبه‌شده */
  score: ScenarioScore;
  /** آیا این سناریو به‌عنوان برنده/انتخابی انتخاب شده است؟ */
  selected?: boolean;
}
