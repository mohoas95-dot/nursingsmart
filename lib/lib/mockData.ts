import { Department, Personnel, SystemSettings, PersonnelRequest } from './types';

export const INITIAL_DEPARTMENTS: Department[] = [
  {
    id: 'sepehr',
    name: 'بخش مراقبت‌های ویژه سپهر (ICU)',
    managerUsername: 'sepehr_head',
    managerPassword: '123'
  },
  {
    id: 'bavand',
    name: 'بخش اورژانس باوند',
    managerUsername: 'bavand_head',
    managerPassword: '123'
  }
];

export const INITIAL_SETTINGS: SystemSettings = {
  conscriptMaxHours: 175,
  morningHours: 7.5,
  eveningHours: 7.5,
  nightHours: 10,
  morningEveningHours: 15,
  targetWorkHours: 160
};

export const INITIAL_PERSONNEL: Personnel[] = [
  {
    id: 'p1',
    firstName: 'مریم',
    lastName: 'احمدی',
    conscript: false,
    contractType: 'official',
    role: 'head_nurse',
    gender: 'female',
    active: true,
    targetWorkHours: 160,
    phone: '09121111111',
    email: 'm.ahmadi@gmail.com',
    orderIndex: 0
  },
  {
    id: 'p2',
    firstName: 'علی',
    lastName: 'رضایی',
    conscript: false,
    contractType: 'contractual',
    role: 'nurse',
    gender: 'male',
    active: true,
    targetWorkHours: 160,
    phone: '09122222222',
    email: 'a.rezaei@gmail.com',
    orderIndex: 1
  },
  {
    id: 'p3',
    firstName: 'زهرا',
    lastName: 'ساداتی',
    conscript: true, // Conscript / طرحی
    contractType: 'conscript',
    role: 'nurse',
    gender: 'female',
    active: true,
    targetWorkHours: 175,
    phone: '09123333333',
    email: 'z.sadati@gmail.com',
    orderIndex: 2
  },
  {
    id: 'p4',
    firstName: 'رضا',
    lastName: 'کریمی',
    conscript: false,
    contractType: 'official',
    role: 'nurse',
    gender: 'male',
    active: true,
    targetWorkHours: 160,
    phone: '09124444444',
    email: 'r.karimi@gmail.com',
    orderIndex: 3
  },
  {
    id: 'p5',
    firstName: 'فاطمه',
    lastName: 'حسینی',
    conscript: true, // Conscript / طرحی
    contractType: 'conscript',
    role: 'nurse',
    gender: 'female',
    active: true,
    targetWorkHours: 175,
    phone: '09125555555',
    email: 'f.hoseini@gmail.com',
    orderIndex: 4
  },
  {
    id: 'p6',
    firstName: 'امیر',
    lastName: 'صادقی',
    conscript: false,
    contractType: 'hourly',
    role: 'assistant',
    gender: 'male',
    active: true,
    targetWorkHours: 120,
    phone: '09126666666',
    email: 'a.sadeghi@gmail.com',
    orderIndex: 5
  }
];

export const INITIAL_REQUESTS: PersonnelRequest[] = [
  {
    id: 'req1',
    personnelId: 'p2',
    date: '1405_04_05', // YYYY_MM_DD format (e.g. Tir 1405)
    type: 'off',
    status: 'approved',
    reason: 'سفر شخصی'
  },
  {
    id: 'req2',
    personnelId: 'p3',
    date: '1405_04_10',
    type: 'shift',
    shiftType: 'N',
    status: 'approved',
    reason: 'درخواست شیفت شب'
  },
  {
    id: 'req3',
    personnelId: 'p4',
    date: '1405_04_12',
    type: 'off',
    status: 'pending',
    reason: 'ملاقات پزشکی'
  }
];
