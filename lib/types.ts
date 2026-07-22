// lib/types.ts - نسخه به‌روز‌شده با فیلدهای جدید

export type JobGroup = 'nurse' | 'assistant';

export type NursePosition = 'supervisor' | 'staff' | 'general' | 'none';

export type EmploymentType = 'official' | 'contract' | 'conscript' | 'overtime';

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
  /** Lightweight guidance tag for solver to bypass heavy historical analysis. Does NOT restrict solver. */
  isFixedRoutine?: boolean;
  /** Detailed routine tag entered by head nurse: morning, rotating, 24h, etc. This is guidance map, not hard restriction. */
  routineType?: RoutineType;
  /** Optional custom pattern for rotating staff, e.g., "MEN OFF OFF EN M" */
  routinePattern?: string;
}

export type RoutineType =
  | 'none'
  | 'morning' // صبح‌کار
  | 'morning_evening' // صبح و عصر کار
  | 'evening_night' // عصر و شب کار
  | 'night' // شب‌کار
  | '24h' // 24 ساعته (MEN/EN/MN)
  | 'rotating' // چرخشی: بعضی روزها 24، بعضی عصر+شب، بعضی صبح تک یا شب تک
  | 'custom'; // الگوی سفارشی

export type ShiftType = 'M' | 'E' | 'N' | 'ME' | 'EN' | 'MN' | 'MEN' | 'OFF' | 'UNFILLED' | string;

export interface JalaliDateInfo {
  year: number;
  month: number;
  day: number;
  dayOfWeek: number;
  isFriday: boolean;
  isHoliday: boolean;
  holidayTitle?: string;
}

export interface SystemSettings {
  autoCalculateDutyHours?: boolean;
  dutyHours: {
    official: number;
    contract: number;
    conscript: number;
    overtime: number;
  };
  demand: {
    weekday: {
      morningNurse: number;
      morningAssistant: number;
      afternoonNurse: number;
      afternoonAssistant: number;
      afternoonLeader: number;
      nightNurse: number;
      nightAssistant: number;
      nightLeader: number;
    };
    holiday: {
      morningNurse: number;
      morningAssistant: number;
      afternoonNurse: number;
      afternoonAssistant: number;
      afternoonLeader: number;
      nightNurse: number;
      nightAssistant: number;
      nightLeader: number;
    };
  };
}

export type RequestType = 'shift' | 'OFF' | 'leave' | 'pattern' | 'avoid_shift';

export interface ShiftRequest {
  id: string;
  personnelId: string;
  requestType: RequestType;
  preferredShift?: 'M' | 'E' | 'N' | 'ME' | 'EN' | 'MN' | 'MEN' | 'OFF' | 'L';
  patternSteps?: string[];
  isEssential: boolean;
  scope: 'all' | 'even' | 'odd' | 'saturdays' | 'sundays' | 'mondays' | 'tuesdays' | 'wednesdays' | 'thursdays' | 'fridays' | 'range' | 'weekly_even' | 'weekly_odd' | 'custom_days';
  startDate?: string;
  endDate?: string;
  selectedDays?: number[];
  createdAt?: string;
  updatedAt?: string;
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
  autoSubstitutions?: AutoSubstitutionRecord[]; // فیلد جدید برای ثبت جایگزینی‌های خودکار
}

export interface AutoSubstitutionRecord {
  personnelId: string;
  day: number;
  originalShift: ShiftType;
  newShift: ShiftType;
  reason: string;
  timestamp: string;
}

export interface PersonnelReportResult {
  personnelId: string;
  name: string;
  personalCode: string;
  jobGroupText: string;
  positionText: string;
  employmentTypeText: string;
  dutyHours: number;
  workedHours: number;
  overtimeHours: number;
  deficitHours: number;
  experienceHours: number;
  productivityHours: number;
  mCount: number;
  eCount: number;
  nCount: number;
  meCount: number;
  enCount: number;
  mnCount: number;
  menCount: number;
  offCount: number;
  leaveCount: number;
  productivityEligible: boolean;
}

// ====== انواع جدید برای درخواست‌ها ======

export interface AggregatedAlert {
  personnelId: string;
  personnelName: string;
  warningCount: number;
  warnings: string[];
  severity: 'low' | 'medium' | 'high';
  isExpanded: boolean;
  groupType?: 'personnel' | 'general';
  jobGroup?: JobGroup;
}

export interface SmartSuggestion {
  id: string;
  description: string;
  impact: {
    resolvedWarnings: string[];
    newWarnings: string[];
    warningCountChange: number;
  };
  changes: {
    personnelId: string;
    day: number;
    fromShift: ShiftType;
    toShift: ShiftType;
  }[];
  priority: number;
}

export interface OptimizationResult {
  assignments: { [pId: string]: { [day: number]: ShiftType } };
  warnings: string[];
  coverageGaps: {
    day: number;
    shift: 'M' | 'E' | 'N';
    shortage: number;
    filledBy: string[];
  }[];
  priorityUsed: {
    level1: string[];
    level2: string[];
    level3: string[];
  };
}
