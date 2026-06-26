export interface Department {
  id: string;
  name: string;
  managerUsername?: string;
  managerPassword?: string;
}

export type ContractType = 'official' | 'contractual' | 'conscript' | 'hourly';
export type PersonnelRole = 'head_nurse' | 'nurse' | 'assistant' | 'service';
export type GenderType = 'male' | 'female';

export interface Personnel {
  id: string;
  firstName: string;
  lastName: string;
  conscript: boolean; // طرحی
  contractType: ContractType;
  role: PersonnelRole;
  gender: GenderType;
  active: boolean;
  targetWorkHours: number;
  phone?: string;
  email?: string;
  orderIndex: number;
}

export type RequestType = 'off' | 'shift';
export type ShiftType = 'M' | 'E' | 'N' | 'ME' | 'O'; // Morning, Evening, Night, Morning-Evening, Off

export interface PersonnelRequest {
  id: string;
  personnelId: string;
  date: string; // Format: "YYYY_MM_DD" (Jalali)
  type: RequestType;
  shiftType?: ShiftType;
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
}

export interface SystemSettings {
  conscriptMaxHours: number;
  morningHours: number;
  eveningHours: number;
  nightHours: number;
  morningEveningHours: number;
  targetWorkHours: number;
}

export interface HolidayConfig {
  days: number[]; // Days of the month (1-31)
}

export interface ScheduleConfig {
  finalized: boolean;
  dismissedWarnings?: string[];
  assignments: {
    [personnelId: string]: {
      [day: number]: ShiftType | '';
    };
  };
}
