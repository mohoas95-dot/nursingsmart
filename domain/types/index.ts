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

export type ShiftType = 'M' | 'E' | 'N' | 'ME' | 'EN' | 'MN' | 'MEN' | 'OFF' | string;

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
