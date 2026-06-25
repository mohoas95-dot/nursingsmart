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
}

export type ShiftType = 'M' | 'E' | 'N' | 'ME' | 'EN' | 'MN' | 'MEN' | 'OFF' | string;

export interface JalaliDateInfo {
  year: number;
  month: number; // 1-12
  day: number;   // 1-29/30/31
  dayOfWeek: number; // 0 (Saturday) to 6 (Friday)
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
  preferredShift?: 'M' | 'E' | 'N' | 'ME' | 'EN' | 'MN' | 'MEN' | 'OFF' | 'L'; // 'L' is leave
  patternSteps?: string[]; // e.g. ['EN', 'OFF', 'OFF'] or ['ME', 'OFF']
  isEssential: boolean; // true = ضروری, false = عادی
  scope: 'all' | 'even' | 'odd' | 'saturdays' | 'sundays' | 'mondays' | 'tuesdays' | 'wednesdays' | 'thursdays' | 'fridays' | 'range' | 'weekly_even' | 'weekly_odd' | 'custom_days';
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
  selectedDays?: number[]; // list of days of the month e.g. [1, 5, 12, 30]
}

export interface MonthlySchedule {
  year: number;
  month: number;
  assignments: {
    [personnelId: string]: {
      [day: number]: ShiftType; // day of the month
    };
  };
  shiftLeaders: {
    [day: number]: {
      morning?: string; // personnelId
      afternoon?: string; // personnelId
      night?: string; // personnelId
    };
  };
  warnings: string[];
}

export interface PersonnelReportResult {
  personnelId: string;
  name: string;
  personalCode: string;
  jobGroupText: string;
  positionText: string;
  employmentTypeText: string;
  
  // Hours calculated
  dutyHours: number;
  workedHours: number;
  overtimeHours: number;
  deficitHours: number;
  experienceHours: number;
  productivityHours: number;
  
  // Shift counts
  mCount: number;
  eCount: number;
  nCount: number;
  meCount: number;
  enCount: number;
  mnCount: number;
  menCount: number;
  offCount: number;
  leaveCount: number;
  
  // Statuses
  productivityEligible: boolean;
}
