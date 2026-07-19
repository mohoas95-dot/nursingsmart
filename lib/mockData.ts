import { Personnel, SystemSettings, ShiftRequest } from './types';

export const INITIAL_PERSONNEL: Personnel[] = [
  {
    id: 'p1',
    firstName: 'حدیثه',
    lastName: 'ماهپروی',
    personalCode: '100010',
    jobGroup: 'nurse',
    position: 'supervisor',
    employmentType: 'official',
    experienceYears: 16,
    active: true,
    canBeShiftLeader: false // Supervisor is never considered a shift leader
  },
  {
    id: 'p2',
    firstName: 'سید محمد حسین',
    lastName: 'عاشق',
    personalCode: '100020',
    jobGroup: 'nurse',
    position: 'staff',
    employmentType: 'official',
    experienceYears: 14,
    active: true,
    canBeShiftLeader: true
  },
  {
    id: 'p3',
    firstName: 'رضا',
    lastName: 'کاظمی',
    personalCode: '100030',
    jobGroup: 'nurse',
    position: 'staff',
    employmentType: 'contract',
    experienceYears: 9,
    active: true,
    canBeShiftLeader: true
  },
  {
    id: 'p4',
    firstName: 'زهرا',
    lastName: 'قاسم پور',
    personalCode: '100040',
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'official',
    experienceYears: 7,
    active: true,
    canBeShiftLeader: true
  },
  {
    id: 'p5',
    firstName: 'احمد',
    lastName: 'خوش قامت',
    personalCode: '100050',
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'contract',
    experienceYears: 4,
    active: true,
    canBeShiftLeader: true
  },
  {
    id: 'p6',
    firstName: 'مهدی',
    lastName: 'جعفری',
    personalCode: '100060',
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'conscript',
    experienceYears: 1,
    active: true,
    canBeShiftLeader: true
  },
  {
    id: 'p7',
    firstName: 'زری',
    lastName: 'ابوالقاسمی',
    personalCode: '100070',
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'contract',
    experienceYears: 5,
    active: true,
    canBeShiftLeader: true
  },
  {
    id: 'p8',
    firstName: 'محمد صادق',
    lastName: 'سازوار',
    personalCode: '100080',
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'overtime',
    experienceYears: 3,
    active: true,
    canBeShiftLeader: true
  },
  {
    id: 'p9',
    firstName: 'رضا',
    lastName: 'کرمی',
    personalCode: '100090',
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'official',
    experienceYears: 11,
    active: true,
    canBeShiftLeader: true
  },
  {
    id: 'p10',
    firstName: 'حمید رضا',
    lastName: 'میرزاپور',
    personalCode: '100100',
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'contract',
    experienceYears: 2,
    active: true,
    canBeShiftLeader: true
  },
  {
    id: 'p11',
    firstName: 'آرش',
    lastName: 'احمدی',
    personalCode: '100110',
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'conscript',
    experienceYears: 1,
    active: true,
    canBeShiftLeader: true
  },
  {
    id: 'p12',
    firstName: 'محمد مهدی',
    lastName: 'ارکیان',
    personalCode: '200010',
    jobGroup: 'assistant',
    position: 'none',
    employmentType: 'official',
    experienceYears: 15,
    active: true,
    canBeShiftLeader: false
  },
  {
    id: 'p13',
    firstName: 'علیرضا',
    lastName: 'قمری',
    personalCode: '200020',
    jobGroup: 'assistant',
    position: 'none',
    employmentType: 'contract',
    experienceYears: 6,
    active: true,
    canBeShiftLeader: false
  },
  {
    id: 'p14',
    firstName: 'زهرا',
    lastName: 'ذوالفقاری',
    personalCode: '200030',
    jobGroup: 'assistant',
    position: 'none',
    employmentType: 'conscript',
    experienceYears: 1,
    active: true,
    canBeShiftLeader: false
  },
  {
    id: 'p15',
    firstName: 'رضا',
    lastName: 'ترابی',
    personalCode: '200040',
    jobGroup: 'assistant',
    position: 'none',
    employmentType: 'contract',
    experienceYears: 8,
    active: true,
    canBeShiftLeader: false
  },
  {
    id: 'p16',
    firstName: 'مبین',
    lastName: 'رحمانی',
    personalCode: '200050',
    jobGroup: 'assistant',
    position: 'none',
    employmentType: 'overtime',
    experienceYears: 4,
    active: true,
    canBeShiftLeader: false
  }
];

export const INITIAL_SETTINGS: SystemSettings = {
  autoCalculateDutyHours: true,
  dutyHours: {
    official: 165,
    contract: 180,
    conscript: 180,
    overtime: 150
  },
  demand: {
    weekday: {
      morningNurse: 6,
      morningAssistant: 4,
      afternoonNurse: 4,
      afternoonAssistant: 2,
      afternoonLeader: 1,
      nightNurse: 4,
      nightAssistant: 2,
      nightLeader: 1
    },
    holiday: {
      morningNurse: 5,
      morningAssistant: 2,
      afternoonNurse: 4,
      afternoonAssistant: 2,
      afternoonLeader: 1,
      nightNurse: 4,
      nightAssistant: 2,
      nightLeader: 1
    }
  }
};

export const INITIAL_REQUESTS: ShiftRequest[] = [
  { id: 'r1', personnelId: 'p1', requestType: 'OFF', isEssential: true, scope: 'range', startDate: '1405/03/05', endDate: '1405/03/06' },
  { id: 'r2', personnelId: 'p2', requestType: 'leave', isEssential: true, scope: 'range', startDate: '1405/03/10', endDate: '1405/03/14' },
  { id: 'r3', personnelId: 'p5', requestType: 'shift', preferredShift: 'N', isEssential: false, scope: 'all' },
  { id: 'r4', personnelId: 'p6', requestType: 'pattern', patternSteps: ['EN', 'OFF', 'OFF'], isEssential: false, scope: 'all' },
  { id: 'r5', personnelId: 'p12', requestType: 'OFF', isEssential: true, scope: 'fridays' }
];

export const INITIAL_HOLIDAYS_1405_03: { [day: number]: string } = {
  14: 'رحلت حضرت امام خمینی (ره)',
  15: 'قیام خونین ۱۵ خرداد'
};
