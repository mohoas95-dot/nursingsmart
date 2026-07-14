'use client';

import React, { useState, useEffect } from 'react';
import { AppDatabaseState } from '../lib/s3Storage';
import { 
  getJalaliMonthDays, 
  generateJalaliMonthCalendar, 
  getJalaliWeekday,
  WEEKDAYS, 
  JALALI_MONTH_NAMES, 
  formatJalaliDateString 
} from '../lib/jalali';
import { 
  JobGroup,
  Personnel, 
  SystemSettings, 
  ShiftRequest, 
  MonthlySchedule, 
  ShiftType, 
  JalaliDateInfo, 
  PersonnelReportResult 
} from '../lib/types';
import { 
  INITIAL_PERSONNEL, 
  INITIAL_SETTINGS, 
  INITIAL_REQUESTS, 
  INITIAL_HOLIDAYS_1405_03 
} from '../lib/mockData';
import { 
  solveNursingSchedule, 
  generatePersonnelReports, 
  verifyCoverageAndLeaders,
  SHIFT_HOURS, 
  getLeaveHours,
  getSeniorityHours,
  calculateAutoDutyHours
} from '../lib/solver';
import { 
  Calendar as CalendarIcon, 
  Users, 
  Settings, 
  AlertTriangle, 
  CheckCircle, 
  Download, 
  Plus, 
  Trash2, 
  Edit, 
  Lock, 
  Unlock, 
  Clock, 
  UserCheck, 
  FileSpreadsheet, 
  Printer, 
  RefreshCw, 
  Sliders, 
  LogOut, 
  HelpCircle, 
  ShieldAlert, 
  Check, 
  BookOpen, 
  Award, 
  Sparkles, 
  ChevronRight, 
  ChevronUp,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  User,
  Activity,
  Menu,
  X,
  Settings2
} from 'lucide-react';

// Department interface for multi-department management
interface Department {
  id: string;
  name: string;
  username?: string;
  password?: string;
}

function BusyOverlay({ subtitle }: { subtitle: string }) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 backdrop-blur-md p-4 cursor-progress">
      <div className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-white/50 bg-white/80 shadow-2xl shadow-slate-900/25">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-l from-indigo-500 via-sky-500 to-emerald-500" />
        <div className="absolute -top-20 -right-16 h-44 w-44 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="absolute -bottom-20 -left-12 h-40 w-40 rounded-full bg-emerald-400/20 blur-3xl" />

        <div
          className="relative flex flex-col items-center gap-5 px-8 py-9 text-center"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="relative flex h-24 w-24 items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-indigo-200/80" />
            <div className="absolute inset-2 rounded-full border-[3px] border-transparent border-t-indigo-600 border-r-sky-500 animate-spin" />
            <div className="absolute inset-5 rounded-full border-2 border-emerald-200/70 border-b-emerald-500 animate-spin [animation-direction:reverse] [animation-duration:1.4s]" />
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 via-sky-500 to-emerald-500 text-white shadow-lg shadow-sky-500/30">
              <Activity className="h-6 w-6 animate-pulse" />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-2xl font-black text-slate-900">لطفا شکیبا باشید</h3>
            <p className="text-sm font-bold leading-7 text-slate-600">{subtitle}</p>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/70 px-4 py-2 text-[11px] font-extrabold text-slate-500 shadow-sm">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            در حال انجام عملیات، لطفاً صفحه را نبندید.
          </div>
        </div>
      </div>
    </div>
  );
}

function toEnglishDigits(str: string): string {
  if (!str) return '';
  const farsiDigits = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
  const arabicDigits = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
  let res = str;
  for (let i = 0; i < 10; i++) {
    res = res.replace(farsiDigits[i], String(i)).replace(arabicDigits[i], String(i));
  }
  return res;
}

export default function Home() {
  // --- Dynamic Department routing helper ---
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('hospital_selected_dept_id') || 'sepehr';
    }
    return 'sepehr';
  });

  const [departments, setDepartments] = useState<Department[]>([]);

  // S3 Database states
  const [fullDbState, setFullDbState] = useState<AppDatabaseState | null>(null);
  const [isLoadingDb, setIsLoadingDb] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [storageInfo, setStorageInfo] = useState<{ isConfigured: boolean; bucket: string; endpoint: string; source: string } | null>(null);

  // Profile forms and inputs
  const [profileUsernameInput, setProfileUsernameInput] = useState<string>('');
  const [profilePasswordInput, setProfilePasswordInput] = useState<string>('');
  const [profileDeptNameInput, setProfileDeptNameInput] = useState<string>('');

  // New Department form states
  const [showAddDeptModal, setShowAddDeptModal] = useState<boolean>(false);
  const [newDeptName, setNewDeptName] = useState<string>('');
  const [newDeptHeadnurseUsername, setNewDeptHeadnurseUsername] = useState<string>('');
  const [newDeptHeadnursePassword, setNewDeptHeadnursePassword] = useState<string>('');

  // --- Persistent & Local State ---
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [isPersonnelLoaded, setIsPersonnelLoaded] = useState<boolean>(false);
  const [isRequestsLoaded, setIsRequestsLoaded] = useState<boolean>(false);
  const [settings, setSettings] = useState<SystemSettings>(INITIAL_SETTINGS);
  const [dbChecked, setDbChecked] = useState<boolean>(false);

  // Year & Month (1405 as preset, which corresponds to mid-2026 local time)
  const [currentYear, setCurrentYear] = useState<number>(1405);
  const [currentMonth, setCurrentMonth] = useState<number>(3); // Khordad

  const [isMounted, setIsMounted] = useState<boolean>(false);
  const [isMonthLoaded, setIsMonthLoaded] = useState<boolean>(() => typeof window === 'undefined');

  const [customHolidays, setCustomHolidays] = useState<{ [day: number]: string }>(INITIAL_HOLIDAYS_1405_03);
  const [firstDayOfWeekIndex, setFirstDayOfWeekIndex] = useState<number | undefined>(undefined);

  // State for monthly approved duty hours
  const [monthlyDutyHours, setMonthlyDutyHours] = useState<any>(null);

  // Schedule matrix
  const [schedule, setSchedule] = useState<MonthlySchedule | null>(null);

  const personnelRef = React.useRef(personnel);
  const requestsRef = React.useRef(requests);
  const settingsRef = React.useRef(settings);
  const holidaysRef = React.useRef(customHolidays);
  const firstDayRef = React.useRef(firstDayOfWeekIndex);
  const monthlyDutyHoursRef = React.useRef(monthlyDutyHours);

  useEffect(() => {
    personnelRef.current = personnel;
    requestsRef.current = requests;
    settingsRef.current = settings;
    holidaysRef.current = customHolidays;
    firstDayRef.current = firstDayOfWeekIndex;
    monthlyDutyHoursRef.current = monthlyDutyHours;
  }, [personnel, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours]);

  // Load persisted selected month/year on mount to prevent defaulting to Khordad after resets
  useEffect(() => {
    const savedYear = localStorage.getItem('hospital_current_year');
    const savedMonth = localStorage.getItem('hospital_current_month');
    setTimeout(() => {
      setIsMounted(true);
      if (savedYear) {
        setCurrentYear(Number(savedYear));
      }
      if (savedMonth) {
        setCurrentMonth(Number(savedMonth));
      }
      setIsMonthLoaded(true);
    }, 0);
  }, []);

  // Compiled reports from current schedule dynamically and reactively
  const reports = React.useMemo(() => {
    if (schedule && personnel.length > 0 && settings) {
      return generatePersonnelReports(currentYear, currentMonth, personnel, schedule, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
    }
    return [];
  }, [personnel, schedule, settings, customHolidays, firstDayOfWeekIndex, currentYear, currentMonth, monthlyDutyHours]);

  const [solvingTarget, setSolvingTarget] = useState<JobGroup | null>(null);

  // User Authentication & Roles
  // roles: 'admin' | 'headnurse' | 'personnel' | 'guest'
  const [role, setRole] = useState<'admin' | 'headnurse' | 'personnel' | 'guest'>('guest');
  const [selectedPersonnelUser, setSelectedPersonnelUser] = useState<Personnel | null>(null);
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState<string>('');
  
  const [personnelFirstNameInput, setPersonnelFirstNameInput] = useState<string>('');
  const [personnelLastNameInput, setPersonnelLastNameInput] = useState<string>('');
  const [personnelPasswordInput, setPersonnelPasswordInput] = useState<string>('');
  
  const [headnurseUsernameInput, setHeadnurseUsernameInput] = useState<string>('');
  const [headnursePasswordInput, setHeadnursePasswordInput] = useState<string>('');
  
  const [headnurseUsername, setHeadnurseUsername] = useState<string>('headnurse');
  const [headnursePassword, setHeadnursePassword] = useState<string>('123456');

  // States for finalized months (locked schedules that won't auto-resolve)
  const [finalizedMonths, setFinalizedMonths] = useState<string[]>([]);

  // State for dismissed warnings list per month
  const [dismissedWarnings, setDismissedWarnings] = useState<string[]>([]);

  const [isSavingDb, setIsSavingDb] = useState<boolean>(false);

  const getFreshDbCopy = (): AppDatabaseState => {
    return fullDbState ? JSON.parse(JSON.stringify(fullDbState)) : { departments: [], deptData: {} };
  };

  const saveDbState = async (updatedDb: AppDatabaseState) => {
    setFullDbState(updatedDb);
    
    const deptId = selectedDepartmentId || 'sepehr';
    const deptInfo = updatedDb.deptData[deptId] || {
      personnel: [],
      requests: [],
      settings_system: INITIAL_SETTINGS,
      settings_credentials: { username: 'headnurse', password: '123456' },
      holidays: {},
      firstDayOfWeek: {},
      schedules: {},
    };
    
    setDepartments(updatedDb.departments || []);
    setPersonnel(deptInfo.personnel || []);
    setRequests(deptInfo.requests || []);
    setSettings(deptInfo.settings_system || INITIAL_SETTINGS);
    setHeadnurseUsername(deptInfo.settings_credentials?.username || 'headnurse');
    setHeadnursePassword(deptInfo.settings_credentials?.password || '123456');
    
    const hKey = `${currentYear}_${currentMonth}`;
    const holidaysInfo = deptInfo.holidays?.[hKey] || { days: {}, monthlyDutyHours: null };
    setCustomHolidays(holidaysInfo.days || {});
    setMonthlyDutyHours(holidaysInfo.monthlyDutyHours || null);
    
    const fdIdx = deptInfo.firstDayOfWeek?.[hKey];
    setFirstDayOfWeekIndex(fdIdx === -1 ? undefined : fdIdx);
    
    const sched = deptInfo.schedules?.[hKey] || null;
    setSchedule(sched);
    if (sched) {
      setDismissedWarnings(sched.dismissedWarnings || []);
      const isFin = !!sched.finalized;
      setFinalizedMonths(prev => {
        const key = `${currentYear}_${currentMonth}`;
        if (isFin) {
          if (!prev.includes(key)) return [...prev, key];
        } else {
          return prev.filter(k => k !== key);
        }
        return prev;
      });
    } else {
      try {
        const solved = solveNursingSchedule(
          currentYear, 
          currentMonth, 
          deptInfo.personnel || [], 
          deptInfo.requests || [], 
          deptInfo.settings_system || INITIAL_SETTINGS, 
          holidaysInfo.days || {}, 
          fdIdx === -1 ? undefined : fdIdx,
          holidaysInfo.monthlyDutyHours || null
        );
        setSchedule({
          year: currentYear,
          month: currentMonth,
          assignments: solved.assignments || {},
          shiftLeaders: solved.shiftLeaders || {},
          warnings: solved.warnings || []
        });
        setDismissedWarnings([]);
      } catch (e) {
        console.error(e);
      }
    }

    try {
      setIsSavingDb(true);
      const res = await fetch('/api/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: updatedDb })
      });
      const data = await res.json();
      if (!data.success) {
        console.error("S3 Object Storage save failed: ", data.error);
      }
    } catch (err) {
      console.error("Network error saving to S3 Object Storage:", err);
    } finally {
      setIsSavingDb(false);
    }
  };

  // Load whole state from S3 on mount or department/month change
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadDatabase = async () => {
      try {
        setIsLoadingDb(true);
        setIsPersonnelLoaded(false);
        setIsRequestsLoaded(false);
        
        const res = await fetch('/api/storage');
        const data = await res.json();
        
        if (data.success && data.state) {
          setFullDbState(data.state);
          setStorageInfo({
            isConfigured: data.isConfigured,
            bucket: data.bucket,
            endpoint: data.endpoint,
            source: data.source
          });
          
          const updatedDb = data.state as AppDatabaseState;
          setDepartments(updatedDb.departments || []);
          
          const deptId = selectedDepartmentId || 'sepehr';
          if (!updatedDb.deptData[deptId]) {
            updatedDb.deptData[deptId] = {
              personnel: INITIAL_PERSONNEL.map((p, idx) => ({ ...p, orderIndex: idx })),
              requests: INITIAL_REQUESTS,
              settings_system: INITIAL_SETTINGS,
              settings_credentials: { username: 'headnurse', password: '123456' },
              holidays: {},
              firstDayOfWeek: {},
              schedules: {},
            };
          }
          
          const deptInfo = updatedDb.deptData[deptId];
          setPersonnel(deptInfo.personnel || []);
          setRequests(deptInfo.requests || []);
          setSettings(deptInfo.settings_system || INITIAL_SETTINGS);
          setHeadnurseUsername(deptInfo.settings_credentials?.username || 'headnurse');
          setHeadnursePassword(deptInfo.settings_credentials?.password || '123456');
          
          const hKey = `${currentYear}_${currentMonth}`;
          const holidaysInfo = deptInfo.holidays?.[hKey] || { days: {}, monthlyDutyHours: null };
          setCustomHolidays(holidaysInfo.days || {});
          setMonthlyDutyHours(holidaysInfo.monthlyDutyHours || null);
          
          const fdIdx = deptInfo.firstDayOfWeek?.[hKey];
          setFirstDayOfWeekIndex(fdIdx === -1 ? undefined : fdIdx);
          
          const sched = deptInfo.schedules?.[hKey] || null;
          setSchedule(sched);
          if (sched) {
            setDismissedWarnings(sched.dismissedWarnings || []);
            const isFin = !!sched.finalized;
            setFinalizedMonths(prev => {
              const key = `${currentYear}_${currentMonth}`;
              if (isFin) {
                if (!prev.includes(key)) return [...prev, key];
              } else {
                return prev.filter(k => k !== key);
              }
              return prev;
            });
          } else {
            try {
              const solved = solveNursingSchedule(
                currentYear, 
                currentMonth, 
                deptInfo.personnel || [], 
                deptInfo.requests || [], 
                deptInfo.settings_system || INITIAL_SETTINGS, 
                holidaysInfo.days || {}, 
                fdIdx === -1 ? undefined : fdIdx,
                holidaysInfo.monthlyDutyHours || null
              );
              setSchedule({
                year: currentYear,
                month: currentMonth,
                assignments: solved.assignments || {},
                shiftLeaders: solved.shiftLeaders || {},
                warnings: solved.warnings || []
              });
              setDismissedWarnings([]);
            } catch (e) {
              console.error(e);
            }
          }
        }
      } catch (err) {
        console.error("Error loading database from Iranian Object Storage S3:", err);
      } finally {
        setIsLoadingDb(false);
        setIsPersonnelLoaded(true);
        setIsRequestsLoaded(true);
        setIsMonthLoaded(true);
        setDbChecked(true);
      }
    };
    
    loadDatabase();
  }, [selectedDepartmentId, currentYear, currentMonth]);

  const [isChangingPassword, setIsChangingPassword] = useState<boolean>(false);
  const [newUsernameValue, setNewUsernameValue] = useState<string>('');
  const [newPasswordValue, setNewPasswordValue] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');

  // UI Tabs & Active View
  const [activeTab, setActiveTab] = useState<'schedule' | 'personnel' | 'requests' | 'reports' | 'settings' | 'calendar' | 'profile'>('schedule');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: 'personnel' | 'request'; label: string } | null>(null);
  const [isNavOpen, setIsNavOpen] = useState<boolean>(false);

  // CRUD & Modals State
  const [showAddPersonnelModal, setShowAddPersonnelModal] = useState<boolean>(false);
  const [editingPersonnel, setEditingPersonnel] = useState<Personnel | null>(null);
  
  // Forms states for Personnel
  const [formFirstName, setFormFirstName] = useState<string>('');
  const [formLastName, setFormLastName] = useState<string>('');
  const [formPersonalCode, setFormPersonalCode] = useState<string>('');
  const [formJobGroup, setFormJobGroup] = useState<'nurse' | 'assistant'>('nurse');
  const [formPosition, setFormPosition] = useState<'supervisor' | 'staff' | 'general' | 'none'>('general');
  const [formEmploymentType, setFormEmploymentType] = useState<'official' | 'contract' | 'conscript' | 'overtime'>('official');
  const [formExperienceYears, setFormExperienceYears] = useState<number>(1);
  const [formActive, setFormActive] = useState<boolean>(true);
  const [formCanBeShiftLeader, setFormCanBeShiftLeader] = useState<boolean>(true);

  // Forms states for Request
  const [showAddRequestModal, setShowAddRequestModal] = useState<boolean>(false);
  const [editingRequest, setEditingRequest] = useState<ShiftRequest | null>(null);
  const [editingCell, setEditingCell] = useState<{ pId: string; day: number } | null>(null);
  const [reqPersonnelId, setReqPersonnelId] = useState<string>('');
  const [reqType, setReqType] = useState<'shift' | 'OFF' | 'leave' | 'pattern' | 'avoid_shift'>('shift');
  const [reqPreferredShift, setReqPreferredShift] = useState<'M' | 'E' | 'N' | 'ME' | 'EN' | 'MN' | 'MEN' | 'OFF' | 'L'>('M');
  const [reqPatternInput, setReqPatternInput] = useState<string>('EN OFF OFF');
  const [reqIsEssential, setReqIsEssential] = useState<boolean>(false);
  const [reqScope, setReqScope] = useState<'all' | 'even' | 'odd' | 'saturdays' | 'sundays' | 'mondays' | 'tuesdays' | 'wednesdays' | 'thursdays' | 'fridays' | 'range' | 'weekly_even' | 'weekly_odd' | 'custom_days'>('all');
  const [reqStartDate, setReqStartDate] = useState<string>('1405/03/01');
  const [reqEndDate, setReqEndDate] = useState<string>('1405/03/31');
  const [reqSelectedDays, setReqSelectedDays] = useState<number[]>([]);

  // Additional system request states
  const [draftRequests, setDraftRequests] = useState<ShiftRequest[]>([]);
  const [showSplitRequests, setShowSplitRequests] = useState<boolean>(false);
  const [aiPromptInput, setAiPromptInput] = useState<string>('');
  const [isAiProcessing, setIsAiProcessing] = useState<boolean>(false);
  const [aiProposedRequests, setAiProposedRequests] = useState<ShiftRequest[]>([]);
  const [aiSelectedPersonnelId, setAiSelectedPersonnelId] = useState<string>('');

  const getRequestSummaryText = (r: ShiftRequest): string => {
    const shiftLabel = r.preferredShift === 'M' ? 'صبح (M)' :
                       r.preferredShift === 'E' ? 'عصر (E)' :
                       r.preferredShift === 'N' ? 'شب (N)' :
                       r.preferredShift === 'ME' ? 'عصر-صبح (ME)' :
                       r.preferredShift === 'EN' ? 'شب-عصر (EN)' :
                       r.preferredShift === 'MN' ? 'شب-صبح (MN)' :
                       r.preferredShift === 'MEN' ? 'تمام روز (MEN)' :
                       r.preferredShift === 'OFF' ? 'آف قطعی' :
                       r.preferredShift === 'L' ? 'مرخصی' : r.preferredShift;

    let timeLabel = '';
    if (r.scope === 'all') timeLabel = 'کل روزهای ماه';
    else if (r.scope === 'even') timeLabel = 'روزهای زوج ماه';
    else if (r.scope === 'odd') timeLabel = 'روزهای فرد ماه';
    else if (r.scope === 'weekly_even') timeLabel = 'روزهای زوج هفته';
    else if (r.scope === 'weekly_odd') timeLabel = 'روزهای فرد هفته';
    else if (r.scope === 'range') timeLabel = `بازه ${r.startDate} تا ${r.endDate}`;
    else if (r.scope === 'custom_days') timeLabel = `روزهای ${r.selectedDays?.join('، ')}`;

    if (r.requestType === 'avoid_shift') {
      return `🔴 غیبت در شیفت ${shiftLabel} [${timeLabel}]`;
    } else if (r.requestType === 'OFF') {
      return `🟡 آف [${timeLabel}]`;
    } else if (r.requestType === 'leave') {
      return `🟢 مرخصی [${timeLabel}]`;
    } else {
      return `🔵 حضور در شیفت ${shiftLabel} [${timeLabel}]`;
    }
  };

  // Custom Holiday Management Form
  const [holidayDayInput, setHolidayDayInput] = useState<number>(1);
  const [holidayTitleInput, setHolidayTitleInput] = useState<string>('');

  // Department deletion auth form
  const [showDeptDeleteAuth, setShowDeptDeleteAuth] = useState<boolean>(false);
  const [deleteDeptAuthUser, setDeleteDeptAuthUser] = useState<string>('');
  const [deleteDeptAuthPass, setDeleteDeptAuthPass] = useState<string>('');
  type ScheduleUpdateStrategy = {
    mode?: 'preserve_current' | 'refresh_personnel' | 'refresh_group' | 'full_resolve';
    personnelIds?: string[];
    jobGroup?: JobGroup;
  };

  const normalizeScheduleAssignments = (
    sourceAssignments: MonthlySchedule['assignments'] | undefined,
    targetPersonnel: Personnel[]
  ): MonthlySchedule['assignments'] => {
    const totalDays = getJalaliMonthDays(currentYear, currentMonth);
    return targetPersonnel.reduce((acc, person) => {
      const personAssignments = sourceAssignments?.[person.id] || {};
      const normalizedAssignments: { [day: number]: ShiftType } = {};

      for (let d = 1; d <= totalDays; d++) {
        const existingShift = personAssignments[d];
        if (existingShift) {
          normalizedAssignments[d] = existingShift;
        }
      }

      acc[person.id] = normalizedAssignments;
      return acc;
    }, {} as MonthlySchedule['assignments']);
  };

  const saveState = async (
    updatedP: Personnel[], 
    updatedR: ShiftRequest[], 
    updatedS: SystemSettings, 
    updatedH: { [day: number]: string },
    fdIndex?: number,
    strategy: ScheduleUpdateStrategy = { mode: 'preserve_current' }
  ) => {
    try {
      const activeFd = fdIndex !== undefined ? fdIndex : (firstDayOfWeekIndex !== undefined ? firstDayOfWeekIndex : -1);
      
      // Auto calculate duty hours if enabled
      let calculatedMonthlyDutyHours = monthlyDutyHours;
      if (updatedS.autoCalculateDutyHours) {
        const autoHours = calculateAutoDutyHours(
          currentYear, 
          currentMonth, 
          updatedH, 
          activeFd === -1 ? undefined : activeFd
        );
        calculatedMonthlyDutyHours = {
          ...updatedS.dutyHours,
          official: autoHours.official,
          contract: autoHours.contract
        };
        setMonthlyDutyHours(calculatedMonthlyDutyHours);
      }

      const nextDb = getFreshDbCopy();
      if (!nextDb.deptData) nextDb.deptData = {};

      const deptId = selectedDepartmentId || 'sepehr';
      const oldDept = nextDb.deptData[deptId] || {
        personnel: [],
        requests: [],
        settings_system: INITIAL_SETTINGS,
        settings_credentials: { username: 'headnurse', password: '123456' },
        holidays: {},
        firstDayOfWeek: {},
        schedules: {},
      };

      const monthKey = `${currentYear}_${currentMonth}`;
      const currentMonthSchedule =
        schedule && schedule.year === currentYear && schedule.month === currentMonth
          ? schedule
          : oldDept.schedules?.[monthKey] || null;

      // Calculate schedule
      const isLocked = finalizedMonths.includes(monthKey);
      let solved: MonthlySchedule;

      if (currentMonthSchedule && strategy.mode !== 'full_resolve') {
        const preservedAssignments = normalizeScheduleAssignments(currentMonthSchedule.assignments, updatedP);
        let nextAssignments = preservedAssignments;

        if (strategy.mode === 'refresh_personnel' || strategy.mode === 'refresh_group') {
          const freshSolved = solveNursingSchedule(
            currentYear,
            currentMonth,
            updatedP,
            updatedR,
            updatedS,
            updatedH,
            activeFd === -1 ? undefined : activeFd,
            calculatedMonthlyDutyHours
          );

          nextAssignments = normalizeScheduleAssignments(currentMonthSchedule.assignments, updatedP);

          const targetPersonnelIds = strategy.mode === 'refresh_personnel'
            ? Array.from(new Set(strategy.personnelIds || []))
            : updatedP
                .filter(person => person.jobGroup === strategy.jobGroup)
                .map(person => person.id);

          for (const personnelId of targetPersonnelIds) {
            nextAssignments[personnelId] = { ...(freshSolved.assignments[personnelId] || {}) };
          }
        }

        const verification = verifyCoverageAndLeaders(
          currentYear,
          currentMonth,
          updatedP,
          nextAssignments,
          updatedS,
          updatedH,
          activeFd === -1 ? undefined : activeFd,
          updatedR
        );

        solved = {
          ...currentMonthSchedule,
          year: currentYear,
          month: currentMonth,
          assignments: nextAssignments,
          shiftLeaders: verification.shiftLeaders,
          warnings: verification.warnings
        };
      } else {
        solved = solveNursingSchedule(currentYear, currentMonth, updatedP, updatedR, updatedS, updatedH, activeFd === -1 ? undefined : activeFd, calculatedMonthlyDutyHours);
      }

      const updatedDept = {
        ...oldDept,
        personnel: updatedP,
        requests: updatedR,
        settings_system: updatedS,
        holidays: {
          ...oldDept.holidays,
          [`${currentYear}_${currentMonth}`]: {
            days: updatedH,
            monthlyDutyHours: calculatedMonthlyDutyHours || null
          }
        },
        firstDayOfWeek: {
          ...oldDept.firstDayOfWeek,
          [`${currentYear}_${currentMonth}`]: activeFd
        },
        schedules: {
          ...oldDept.schedules,
          [monthKey]: {
            ...solved,
            finalized: isLocked,
            dismissedWarnings: dismissedWarnings
          }
        }
      };

      nextDb.deptData[deptId] = updatedDept;

      // Persist S3 State
      await saveDbState(nextDb);
    } catch (error) {
      console.error("Error in saveState:", error);
      alert("خطا در ذخیره‌سازی داده‌ها: " + (error instanceof Error ? error.message : String(error)));
      throw error;
    }
  };

  const movePersonnel = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= personnel.length) return;
    const updated = [...personnel];
    const temp = updated[index];
    updated[index] = updated[newIndex];
    updated[newIndex] = temp;

    const withOrder = updated.map((p, idx) => ({ ...p, orderIndex: idx }));
    await saveState(withOrder, requests, settings, customHolidays);
  };

  const changePersonnelPosition = async (index: number, targetPos: number) => {
    const targetIndex = targetPos - 1;
    if (targetIndex < 0 || targetIndex >= personnel.length || targetIndex === index) return;
    const updated = [...personnel];
    const [movedItem] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, movedItem);

    const withOrder = updated.map((p, idx) => ({ ...p, orderIndex: idx }));
    await saveState(withOrder, requests, settings, customHolidays);
  };

  // Run the smart constraints CP-SAT mimic engine with loading animation
  const handleRunOptimizer = (jobGroup: JobGroup) => {
    const key = `${currentYear}_${currentMonth}`;
    let wasLocked = finalizedMonths.includes(key);
    if (wasLocked) {
      const groupTitle = jobGroup === 'nurse' ? 'پرستاران' : 'کمک‌بهیاران';
      const confirmUnlock = confirm(`برنامه این ماه ثبت نهایی و قفل شده است. آیا مایلید قفل لیست را باز کرده و بازتولید هوشمند ${groupTitle} را اجرا کنید؟`);
      if (!confirmUnlock) return;
    }

    setSolvingTarget(jobGroup);
    setTimeout(async () => {
      try {
        const solved = solveNursingSchedule(currentYear, currentMonth, personnel, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);
        const baseAssignments = normalizeScheduleAssignments(schedule?.assignments, personnel);
        const mergedAssignments = schedule
          ? { ...baseAssignments }
          : normalizeScheduleAssignments(solved.assignments, personnel);

        const targetPersonnel = personnel.filter(p => p.jobGroup === jobGroup);
        for (const person of targetPersonnel) {
          mergedAssignments[person.id] = { ...(solved.assignments[person.id] || {}) };
        }

        const verification = verifyCoverageAndLeaders(
          currentYear,
          currentMonth,
          personnel,
          mergedAssignments,
          settings,
          customHolidays,
          firstDayOfWeekIndex,
          requests
        );
        
        const nextDb = fullDbState ? { ...fullDbState } : { departments: [], deptData: {} };
        if (!nextDb.deptData) nextDb.deptData = {};
        
        const deptId = selectedDepartmentId || 'sepehr';
        const oldDept = nextDb.deptData[deptId] || {
          personnel: [],
          requests: [],
          settings_system: INITIAL_SETTINGS,
          settings_credentials: { username: 'headnurse', password: '123456' },
          holidays: {},
          firstDayOfWeek: {},
          schedules: {},
        };

        const updatedDept = {
          ...oldDept,
          schedules: {
            ...oldDept.schedules,
            [`${currentYear}_${currentMonth}`]: {
              ...(schedule || solved),
              year: currentYear,
              month: currentMonth,
              assignments: mergedAssignments,
              shiftLeaders: verification.shiftLeaders,
              warnings: verification.warnings,
              finalized: false,
              dismissedWarnings: dismissedWarnings
            }
          }
        };

        nextDb.deptData[deptId] = updatedDept;
        await saveDbState(nextDb);
      } catch (err) {
        console.error("Solver error:", err);
      } finally {
        setSolvingTarget(null);
      }
    }, 1500);
  };

  const handleFinalizeMonth = async () => {
    if (role === 'personnel') return;
    try {
      const key = `${currentYear}_${currentMonth}`;
      
      const nextDb = fullDbState ? { ...fullDbState } : { departments: [], deptData: {} };
      if (!nextDb.deptData) nextDb.deptData = {};
      
      const deptId = selectedDepartmentId || 'sepehr';
      const oldDept = nextDb.deptData[deptId] || {
        personnel: [],
        requests: [],
        settings_system: INITIAL_SETTINGS,
        settings_credentials: { username: 'headnurse', password: '123456' },
        holidays: {},
        firstDayOfWeek: {},
        schedules: {},
      };

      const existingSched = oldDept.schedules?.[key];
      if (!existingSched) {
        alert("جدول شیفتی برای نهایی‌سازی یافت نشد.");
        return;
      }

      const updatedDept = {
        ...oldDept,
        schedules: {
          ...oldDept.schedules,
          [key]: {
            ...existingSched,
            finalized: true
          }
        }
      };

      nextDb.deptData[deptId] = updatedDept;
      await saveDbState(nextDb);
      alert(`لیست شیفت‌های ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} با موفقیت ثبت نهایی شد و قفل گردید.`);
    } catch (error) {
      console.error("Error finalizing month:", error);
      alert("خطا در قفل جدول: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleUnfinalizeMonth = async () => {
    if (role === 'personnel') return;
    try {
      const key = `${currentYear}_${currentMonth}`;
      
      const nextDb = fullDbState ? { ...fullDbState } : { departments: [], deptData: {} };
      if (!nextDb.deptData) nextDb.deptData = {};
      
      const deptId = selectedDepartmentId || 'sepehr';
      const oldDept = nextDb.deptData[deptId] || {
        personnel: [],
        requests: [],
        settings_system: INITIAL_SETTINGS,
        settings_credentials: { username: 'headnurse', password: '123456' },
        holidays: {},
        firstDayOfWeek: {},
        schedules: {},
      };

      const existingSched = oldDept.schedules?.[key];
      if (!existingSched) {
        alert("جدول شیفتی یافت نشد.");
        return;
      }

      const updatedDept = {
        ...oldDept,
        schedules: {
          ...oldDept.schedules,
          [key]: {
            ...existingSched,
            finalized: false
          }
        }
      };

      nextDb.deptData[deptId] = updatedDept;
      await saveDbState(nextDb);
      alert(`قفل لیست شیفت‌های ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} با موفقیت باز شد.`);
    } catch (error) {
      console.error("Error unlocking month:", error);
      alert("خطا در باز کردن قفل جدول: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleDismissWarning = async (warnText: string) => {
    try {
      const updated = [...dismissedWarnings, warnText];
      const key = `${currentYear}_${currentMonth}`;
      
      const nextDb = fullDbState ? { ...fullDbState } : { departments: [], deptData: {} };
      if (!nextDb.deptData) nextDb.deptData = {};
      
      const deptId = selectedDepartmentId || 'sepehr';
      const oldDept = nextDb.deptData[deptId] || {
        personnel: [],
        requests: [],
        settings_system: INITIAL_SETTINGS,
        settings_credentials: { username: 'headnurse', password: '123456' },
        holidays: {},
        firstDayOfWeek: {},
        schedules: {},
      };

      const existingSched = oldDept.schedules?.[key];
      if (!existingSched) return;

      const updatedDept = {
        ...oldDept,
        schedules: {
          ...oldDept.schedules,
          [key]: {
            ...existingSched,
            dismissedWarnings: updated
          }
        }
      };

      nextDb.deptData[deptId] = updatedDept;
      await saveDbState(nextDb);
    } catch (error) {
      console.error("Error dismissing warning:", error);
    }
  };


  const handleSelectMonth = (mNum: number) => {
    setCurrentMonth(mNum);
    if (typeof window !== 'undefined') {
      localStorage.setItem('hospital_current_month', String(mNum));
      localStorage.setItem('hospital_current_year', String(currentYear));
    }
  };

  // --- Authentication Handlers ---
  const handleLogin = async (roleType: 'admin' | 'headnurse' | 'personnel') => {
    setAuthError('');
    if (roleType === 'admin') {
      const uInput = toEnglishDigits(headnurseUsernameInput.trim());
      const pInput = toEnglishDigits(headnursePasswordInput.trim());
      if (uInput === 'admin' && pInput === 'admin') {
        setRole('admin');
        setSelectedPersonnelUser(null);
        setActiveTab('schedule');
        setHeadnurseUsernameInput('');
        setHeadnursePasswordInput('');
      } else {
        setAuthError('اطلاعات ورود مدیر سیستم نادرست است.');
      }
    } else if (roleType === 'headnurse') {
      const uInput = toEnglishDigits(headnurseUsernameInput.trim());
      const pInput = toEnglishDigits(headnursePasswordInput.trim());
      if (uInput === 'admin' && pInput === 'admin') {
        setRole('admin');
        setSelectedPersonnelUser(null);
        setActiveTab('schedule');
        setHeadnurseUsernameInput('');
        setHeadnursePasswordInput('');
        return;
      }

      const matchedDept = departments.find(d => d.id === selectedDepartmentId);
      if (matchedDept) {
        const dbUser = toEnglishDigits(matchedDept.username || 'headnurse');
        const dbPass = toEnglishDigits(matchedDept.password || '123456');
        
        // Dynamic "First Login" credential creation
        if (dbUser === 'headnurse' && dbPass === '123456') {
          if (!uInput || pInput.length < 4) {
            setAuthError('برای اولین ورود سرپرستار، نام کاربری دلخواه و رمز عبور (حداقل ۴ کاراکتر) خود را در کادرها تایپ کنید تا ثبت گردد.');
            return;
          }

          try {
            const updatedDept = {
              ...matchedDept,
              username: uInput,
              password: pInput
            };
            
            const nextDb = fullDbState ? { ...fullDbState } : { departments: [], deptData: {} };
            if (!nextDb.deptData) nextDb.deptData = {};
            
            nextDb.departments = (nextDb.departments || []).map(d => d.id === selectedDepartmentId ? updatedDept : d);
            
            const deptId = selectedDepartmentId || 'sepehr';
            if (!nextDb.deptData[deptId]) {
              nextDb.deptData[deptId] = {
                personnel: INITIAL_PERSONNEL.map((p, idx) => ({ ...p, orderIndex: idx })),
                requests: INITIAL_REQUESTS,
                settings_system: INITIAL_SETTINGS,
                settings_credentials: { username: uInput, password: pInput },
                holidays: {},
                firstDayOfWeek: {},
                schedules: {},
              };
            } else {
              nextDb.deptData[deptId].settings_credentials = { username: uInput, password: pInput };
            }
            
            await saveDbState(nextDb);

            setHeadnurseUsername(uInput);
            setHeadnursePassword(pInput);
            setRole('headnurse');
            setSelectedPersonnelUser(null);
            setActiveTab('schedule');
            
            // Set fields for profile update
            setProfileUsernameInput(uInput);
            setProfilePasswordInput(pInput);
            setProfileDeptNameInput(matchedDept.name);

            setHeadnurseUsernameInput('');
            setHeadnursePasswordInput('');
            alert(`نام کاربری و کلمه عبور سرپرستار این بخش در اولین ورود با موفقیت تنظیم و ذخیره شد!`);
          } catch (e) {
            console.error(e);
            setAuthError('خطا در ثبت نهایی کلمات عبور سرپرستار.');
          }
        } else {
          // Normal login match
          if (uInput === dbUser && pInput === dbPass) {
            setRole('headnurse');
            setSelectedPersonnelUser(null);
            setActiveTab('schedule');
            
            // Set fields for profile update
            setProfileUsernameInput(dbUser);
            setProfilePasswordInput(dbPass);
            setProfileDeptNameInput(matchedDept.name);

            setHeadnurseUsernameInput('');
            setHeadnursePasswordInput('');
          } else {
            setAuthError('نام کاربری یا رمز عبور سرپرستار این بخش نادرست است.');
          }
        }
      } else {
        setAuthError('بخش انتخابی یافت نشد.');
      }
    } else if (roleType === 'personnel') {
      const fInput = personnelFirstNameInput.trim();
      const lInput = personnelLastNameInput.trim();
      const pInput = toEnglishDigits(personnelPasswordInput.trim());

      if (!fInput || !lInput) {
        setAuthError('لطفاً نام و نام خانوادگی خود را به عنوان کادر درمان وارد کنید.');
        return;
      }

      // Default password is '1234'
      const checkPass = pInput || '1234';

      const pMatch = personnel.find(p => {
        if (!p.active) return false;
        
        const matchFirst = p.firstName.trim() === fInput;
        const matchLast = p.lastName.trim() === lInput;
        
        const expectedPass = toEnglishDigits(p.password ? p.password.trim() : '1234');
        return matchFirst && matchLast && expectedPass === checkPass;
      });

      if (!pMatch) {
        setAuthError('پرسنلی با این مشخصات یافت نشد. دقت کنید نام، نام خانوادگی به فارسی و رمز اولیه پیش‌فرض ۱۲۳۴ است.');
        return;
      }

      setSelectedPersonnelUser(pMatch);
      setRole('personnel');
      setActiveTab('schedule');
      
      // Set fields for profile update
      setProfileUsernameInput(pMatch.lastName);
      setProfilePasswordInput(pMatch.password || '1234');
      
      setPersonnelFirstNameInput('');
      setPersonnelLastNameInput('');
      setPersonnelPasswordInput('');
    }
  };

  const handleChangeCredentials = async () => {
    if (newPasswordValue.trim().length >= 4 && newUsernameValue.trim().length > 0) {
      const uVal = newUsernameValue.trim();
      const pVal = newPasswordValue.trim();
      
      const nextDb = fullDbState ? { ...fullDbState } : { departments: [], deptData: {} };
      if (!nextDb.deptData) nextDb.deptData = {};
      
      const deptId = selectedDepartmentId || 'sepehr';
      if (!nextDb.deptData[deptId]) {
        nextDb.deptData[deptId] = {
          personnel: INITIAL_PERSONNEL.map((p, idx) => ({ ...p, orderIndex: idx })),
          requests: INITIAL_REQUESTS,
          settings_system: INITIAL_SETTINGS,
          settings_credentials: { username: uVal, password: pVal },
          holidays: {},
          firstDayOfWeek: {},
          schedules: {},
        };
      } else {
        nextDb.deptData[deptId].settings_credentials = { username: uVal, password: pVal };
      }

      nextDb.departments = (nextDb.departments || []).map(d => {
        if (d.id === selectedDepartmentId) {
          return { ...d, username: uVal, password: pVal };
        }
        return d;
      });

      await saveDbState(nextDb);

      setHeadnurseUsername(uVal);
      setHeadnursePassword(pVal);
      setIsChangingPassword(false);
      setNewUsernameValue('');
      setNewPasswordValue('');
      alert('اطلاعات کاربری سرپرستار با موفقیت تغییر کرد.');
    } else {
      alert('نام کاربری نمی‌تواند خالی باشد و رمز عبور باید حداقل ۴ کاراکتر باشد.');
    }
  };

  const handleLogout = () => {
    setRole('guest');
    setSelectedPersonnelUser(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('hospital_saved_role');
      localStorage.removeItem('hospital_saved_personnel_id');
    }
  };

  // --- Personnel CRUD Helpers ---
  const handleOpenAddPersonnel = () => {
    setEditingPersonnel(null);
    setFormFirstName('');
    setFormLastName('');
    setFormPersonalCode('');
    setFormJobGroup('nurse');
    setFormPosition('general');
    setFormEmploymentType('official');
    setFormExperienceYears(1);
    setFormActive(true);
    setFormCanBeShiftLeader(true);
    setShowAddPersonnelModal(true);
  };

  const handleOpenEditPersonnel = (p: Personnel) => {
    setEditingPersonnel(p);
    setFormFirstName(p.firstName);
    setFormLastName(p.lastName);
    setFormPersonalCode(p.personalCode);
    setFormJobGroup(p.jobGroup);
    setFormPosition(p.position);
    setFormEmploymentType(p.employmentType);
    setFormExperienceYears(p.experienceYears);
    setFormActive(p.active);
    setFormCanBeShiftLeader(p.canBeShiftLeader);
    setShowAddPersonnelModal(true);
  };

  const handleSavePersonnel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formFirstName.trim() || !formLastName.trim() || !formPersonalCode.trim()) {
      alert('لطفاً تمام فیلدها را پر کنید.');
      return;
    }

    try {
      let updatedList: Personnel[];
      if (editingPersonnel) {
        const pData = {
          ...editingPersonnel,
          firstName: formFirstName,
          lastName: formLastName,
          personalCode: formPersonalCode,
          jobGroup: formJobGroup,
          position: formJobGroup === 'assistant' ? 'none' : formPosition,
          employmentType: formEmploymentType,
          experienceYears: Number(formExperienceYears),
          active: formActive,
          canBeShiftLeader: formJobGroup === 'assistant' ? false : formCanBeShiftLeader
        };
        updatedList = personnel.map(p => p.id === editingPersonnel.id ? pData : p);
      } else {
        const newId = `p_${Date.now()}`;
        const pData: Personnel = {
          id: newId,
          firstName: formFirstName.trim(),
          lastName: formLastName.trim(),
          personalCode: formPersonalCode.trim(),
          jobGroup: formJobGroup,
          position: formJobGroup === 'assistant' ? 'none' : formPosition,
          employmentType: formEmploymentType,
          experienceYears: Number(formExperienceYears),
          active: formActive,
          canBeShiftLeader: formJobGroup === 'assistant' ? false : formCanBeShiftLeader,
          username: formLastName.trim(), // Default username is LastName
          password: '1234',                 // Default personnel password is 1234
          orderIndex: personnel.length
        };
        updatedList = [...personnel, pData];
      }

      await saveState(updatedList, requests, settings, customHolidays, undefined, { mode: 'full_resolve' });
      setShowAddPersonnelModal(false);
    } catch (error) {
      console.error("Error saving personnel:", error);
      alert("خطا در ثبت اطلاعات پرسنل: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleDeletePersonnel = async (id: string) => {
    try {
      const updatedP = personnel.filter(p => p.id !== id);
      const updatedR = requests.filter(r => r.personnelId !== id);
      await saveState(updatedP, updatedR, settings, customHolidays, undefined, { mode: 'full_resolve' });
    } catch (error) {
      console.error("Error deleting personnel:", error);
      alert("خطا در حذف پرسنل: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  // --- Requests UI Helpers ---
  const handleAddDraftRequest = () => {
    const pid = role === 'personnel' && selectedPersonnelUser ? selectedPersonnelUser.id : reqPersonnelId;
    if (!pid) {
      alert('لطفاً پرسنل مورد نظر را انتخاب کنید.');
      return;
    }

    const steps = reqType === 'pattern' ? reqPatternInput.split(' ').map(s => s.trim().toUpperCase()) : undefined;

    const reqData: ShiftRequest = {
      id: `draft_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      personnelId: pid,
      requestType: reqType,
      preferredShift: reqType === 'leave' ? 'L' : (reqType === 'OFF' ? 'OFF' : ((reqType === 'shift' || reqType === 'avoid_shift') ? reqPreferredShift : undefined)),
      patternSteps: steps,
      isEssential: role === 'personnel' ? false : reqIsEssential, // Personnel cannot request essential
      scope: reqScope,
      startDate: reqScope === 'range' ? reqStartDate : undefined,
      endDate: reqScope === 'range' ? reqEndDate : undefined,
      selectedDays: reqScope === 'custom_days' ? reqSelectedDays : undefined
    };

    setDraftRequests([...draftRequests, reqData]);
    // Clear selections for next add
    setReqSelectedDays([]);
  };

  const handleFinalSubmitRequests = async () => {
    const pid = role === 'personnel' && selectedPersonnelUser ? selectedPersonnelUser.id : reqPersonnelId;
    if (!pid) {
      alert('لطفاً پرسنل مورد نظر را انتخاب کنید.');
      return;
    }

    // Elegant fallback: If draft is empty but they currently have mapped input in the form, add it first so nothing is lost!
    let finalRequestsToSave = [...draftRequests];
    if (finalRequestsToSave.length === 0) {
      const steps = reqType === 'pattern' ? reqPatternInput.split(' ').map(s => s.trim().toUpperCase()) : undefined;
      const currentReq: ShiftRequest = {
        id: `req_${Date.now()}`,
        personnelId: pid,
        requestType: reqType,
        preferredShift: reqType === 'leave' ? 'L' : (reqType === 'OFF' ? 'OFF' : ((reqType === 'shift' || reqType === 'avoid_shift') ? reqPreferredShift : undefined)),
        patternSteps: steps,
        isEssential: role === 'personnel' ? false : reqIsEssential,
        scope: reqScope,
        startDate: reqScope === 'range' ? reqStartDate : undefined,
        endDate: reqScope === 'range' ? reqEndDate : undefined,
        selectedDays: reqScope === 'custom_days' ? reqSelectedDays : undefined
      };
      finalRequestsToSave.push(currentReq);
    }

    try {
      let updatedR = [...requests];
      for (const reqData of finalRequestsToSave) {
        // Replace temporary draft id with real id
        const finalId = reqData.id.startsWith('draft_') ? `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}` : reqData.id;
        const finalReq = { ...reqData, id: finalId };
        updatedR.push(finalReq);
      }

      await saveState(
        personnel,
        updatedR,
        settings,
        customHolidays,
        undefined,
        {
          mode: 'refresh_personnel',
          personnelIds: Array.from(new Set(finalRequestsToSave.map(req => req.personnelId)))
        }
      );
      setShowAddRequestModal(false);
      
      // Reset states
      setDraftRequests([]);
      setEditingRequest(null);
      setReqPatternInput('EN OFF OFF');
      setReqIsEssential(false);
      setReqSelectedDays([]);
    } catch (error) {
      console.error("Error submitting final requests:", error);
      alert("خطا در ثبت نهایی درخواست‌ها: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleDeleteAllPersonRequests = async (personId: string, name: string) => {
    if (!confirm(`آیا مطمئن هستید که می‌خواهید تمام درخواست‌های ثبت‌شده ${name} را حذف کنید؟`)) {
      return;
    }
    try {
      const updatedR = requests.filter(r => r.personnelId !== personId);
      await saveState(personnel, updatedR, settings, customHolidays, undefined, {
        mode: 'refresh_personnel',
        personnelIds: [personId]
      });
    } catch (e) {
      console.error("Error deleting all requests:", e);
      alert("خطا در حذف درخواست‌ها: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleAddRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Direct edit mode saving
    if (editingRequest) {
      try {
        const pid = role === 'personnel' && selectedPersonnelUser ? selectedPersonnelUser.id : reqPersonnelId;
        const steps = reqType === 'pattern' ? reqPatternInput.split(' ').map(s => s.trim().toUpperCase()) : undefined;
        
        const reqData: ShiftRequest = {
          id: editingRequest.id,
          personnelId: pid,
          requestType: reqType,
          preferredShift: reqType === 'leave' ? 'L' : (reqType === 'OFF' ? 'OFF' : ((reqType === 'shift' || reqType === 'avoid_shift') ? reqPreferredShift : undefined)),
          patternSteps: steps,
          isEssential: role === 'personnel' ? false : reqIsEssential,
          scope: reqScope,
          startDate: reqScope === 'range' ? reqStartDate : undefined,
          endDate: reqScope === 'range' ? reqEndDate : undefined,
          selectedDays: reqScope === 'custom_days' ? reqSelectedDays : undefined
        };

        const updatedR = requests.map(r => r.id === editingRequest.id ? reqData : r);
        await saveState(
          personnel,
          updatedR,
          settings,
          customHolidays,
          undefined,
          {
            mode: 'refresh_personnel',
            personnelIds: Array.from(new Set([editingRequest.personnelId, pid]))
          }
        );
        setShowAddRequestModal(false);
        setEditingRequest(null);
        setReqSelectedDays([]);
      } catch (error) {
        console.error("Error editing request:", error);
        alert("خطا در ویرایش درخواست: " + (error instanceof Error ? error.message : String(error)));
      }
    } else {
      // Create mode: Final Submit
      await handleFinalSubmitRequests();
    }
  };

  const handleDeleteRequest = async (id: string) => {
    try {
      const deletedRequest = requests.find(r => r.id === id);
      const updatedR = requests.filter(r => r.id !== id);
      await saveState(
        personnel,
        updatedR,
        settings,
        customHolidays,
        undefined,
        deletedRequest ? {
          mode: 'refresh_personnel',
          personnelIds: [deletedRequest.personnelId]
        } : { mode: 'preserve_current' }
      );
    } catch (error) {
      console.error("Error deleting request:", error);
      alert("خطا در حذف درخواست: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  // --- Manual Schedule Override cell edit ---
  const handleCellClick = (pId: string, day: number) => {
    if (role === 'admin' || role === 'headnurse') {
      setEditingCell({ pId, day });
    }
  };

  const handleManualShiftChange = async (pId: string, day: number, shift: ShiftType) => {
    if (!schedule) return;
    
    try {
      const updatedAssignments = { ...schedule.assignments };
      if (!updatedAssignments[pId]) updatedAssignments[pId] = {};
      updatedAssignments[pId][day] = shift;

      const verification = verifyCoverageAndLeaders(currentYear, currentMonth, personnel, updatedAssignments, settings, customHolidays, firstDayOfWeekIndex, requests);

      const nextDb = fullDbState ? { ...fullDbState } : { departments: [], deptData: {} };
      if (!nextDb.deptData) nextDb.deptData = {};
      
      const deptId = selectedDepartmentId || 'sepehr';
      const oldDept = nextDb.deptData[deptId] || {
        personnel: [],
        requests: [],
        settings_system: INITIAL_SETTINGS,
        settings_credentials: { username: 'headnurse', password: '123456' },
        holidays: {},
        firstDayOfWeek: {},
        schedules: {},
      };

      const updatedDept = {
        ...oldDept,
        schedules: {
          ...oldDept.schedules,
          [`${currentYear}_${currentMonth}`]: {
            year: currentYear,
            month: currentMonth,
            assignments: updatedAssignments,
            shiftLeaders: verification.shiftLeaders,
            warnings: verification.warnings,
            finalized: false,
            dismissedWarnings: dismissedWarnings
          }
        }
      };

      nextDb.deptData[deptId] = updatedDept;
      await saveDbState(nextDb);

      setEditingCell(null);
    } catch (error) {
      console.error("Error setting manual shift change:", error);
      alert("خطا در تغییر دستی شیفت: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  // --- Dynamic System Configuration ---
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await saveState(personnel, requests, settings, customHolidays, undefined, { mode: 'full_resolve' });
      alert('تنظیمات موظفی و نیاز نیرویی با موفقیت ذخیره شد.');
    } catch (error) {
      console.error("Error saving settings:", error);
    }
  };

  // --- Profile Modifications handler ---
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (role === 'headnurse') {
      if (!profileUsernameInput.trim() || !profilePasswordInput.trim() || !profileDeptNameInput.trim()) {
        alert('لطفاً تمامی فیلدها را پر کنید.');
        return;
      }
    } else if (role === 'personnel') {
      if (!profilePasswordInput.trim()) {
        alert('لطفاً کلمه عبور را پر کنید.');
        return;
      }
    }

    try {
      const nextDb = fullDbState ? { ...fullDbState } : { departments: [], deptData: {} };
      if (!nextDb.deptData) nextDb.deptData = {};
      
      const deptId = selectedDepartmentId || 'sepehr';
      if (role === 'headnurse') {
        const uVal = profileUsernameInput.trim();
        const pVal = profilePasswordInput.trim();
        const dName = profileDeptNameInput.trim();

        nextDb.departments = (nextDb.departments || []).map(d => {
          if (d.id === selectedDepartmentId) {
            return { ...d, username: uVal, password: pVal, name: dName };
          }
          return d;
        });

        if (!nextDb.deptData[deptId]) {
          nextDb.deptData[deptId] = {
            personnel: INITIAL_PERSONNEL.map((p, idx) => ({ ...p, orderIndex: idx })),
            requests: INITIAL_REQUESTS,
            settings_system: INITIAL_SETTINGS,
            settings_credentials: { username: uVal, password: pVal },
            holidays: {},
            firstDayOfWeek: {},
            schedules: {},
          };
        } else {
          nextDb.deptData[deptId].settings_credentials = { username: uVal, password: pVal };
        }

        await saveDbState(nextDb);
        alert('پروفایل سرپرستار بخش با موفقیت ارتقا یافت و ذخیره شد.');
      } else if (role === 'personnel' && selectedPersonnelUser) {
        const pData = {
          ...selectedPersonnelUser,
          password: profilePasswordInput.trim()
        };

        const updatedP = personnel.map(p => p.id === selectedPersonnelUser.id ? pData : p);
        
        if (!nextDb.deptData[deptId]) {
          nextDb.deptData[deptId] = {
            personnel: updatedP,
            requests: requests,
            settings_system: settings,
            settings_credentials: { username: headnurseUsername, password: headnursePassword },
            holidays: {},
            firstDayOfWeek: {},
            schedules: {},
          };
        } else {
          nextDb.deptData[deptId].personnel = updatedP;
        }

        await saveDbState(nextDb);
        setSelectedPersonnelUser(pData);
        alert('اطلاعات امنیتی پرسنل با موفقیت به‌روزرسانی شد.');
      }
    } catch (err) {
      console.error("Error saving profile:", err);
      alert("خطا در به‌روزرسانی اطلاعات پروفایل");
    }
  };

  // --- Holiday Management ---
  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayTitleInput.trim()) return;
    try {
      const updated = { ...customHolidays, [holidayDayInput]: holidayTitleInput.trim() };
      setCustomHolidays(updated);
      await saveState(personnel, requests, settings, updated, undefined, { mode: 'full_resolve' });
      setHolidayTitleInput('');
      alert('تعطیلات با موفقیت ثبت شد.');
    } catch (error) {
      console.error("Error adding holiday:", error);
    }
  };

  const handleRemoveHoliday = async (day: number) => {
    try {
      const updated = { ...customHolidays };
      delete updated[day];
      setCustomHolidays(updated);
      await saveState(personnel, requests, settings, updated, undefined, { mode: 'full_resolve' });
    } catch (error) {
      console.error("Error removing holiday:", error);
    }
  };

  // --- Reporting Exports ---
  // --- Helper to convert column index to Excel letter ---
  const getExcelColumnLetter = (col: number): string => {
    let letter = '';
    while (col > 0) {
      let t = (col - 1) % 26;
      letter = String.fromCharCode(65 + t) + letter;
      col = Math.floor((col - t) / 26);
    }
    return letter;
  };

  const exportToExcel = async () => {
    if (!schedule) return;
    const ExcelJS = (await import('exceljs')).default;
    
    // Ensure accurate starting day of the week based on what the user defined
    const startDayIndex = firstDayOfWeekIndex !== undefined 
      ? firstDayOfWeekIndex 
      : getJalaliWeekday(currentYear, currentMonth, 1);
    const calendarDays = generateJalaliMonthCalendar(currentYear, currentMonth, customHolidays, startDayIndex);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('برنامه کاری پرستاری');

    // Make it RTL and enable Grid lines
    worksheet.views = [{ showGridLines: true, rtl: true } as any];

    // Configure for A4 Landscape print fit to page width!
    worksheet.pageSetup = {
      paperSize: 9, // A4
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    };

    // Styling fonts and alignments with Beautiful Persian Fonts (B Titr and B Nazanin)
    const titleFont = { name: 'B Titr', size: 16, bold: true, color: { argb: 'FF1E293B' } };
    const headFont = { name: 'B Titr', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    const bodyFont = { name: 'B Nazanin', size: 11 };
    const boldBodyFont = { name: 'B Nazanin', size: 11, bold: true };
    const kpiFont = { name: 'B Nazanin', size: 11, bold: true, color: { argb: 'FF065F46' } };

    const centerAlign = { vertical: 'middle' as const, horizontal: 'center' as const, wrapText: true };
    const rightAlign = { vertical: 'middle' as const, horizontal: 'right' as const };

    // 1. Add Title block (Merged across total columns: 3 leading columns + calendar days + 6 metrics)
    const totalCols = 3 + calendarDays.length + 6;
    const lastColLetter = getExcelColumnLetter(totalCols);
    worksheet.mergeCells(`A1:${lastColLetter}1`);
    
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `جدول هوشمند و برنامه شیفت‌بندی پرستاری - ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} سال ${currentYear}`;
    titleCell.font = titleFont;
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 42;

    // Blank row 2
    worksheet.getRow(2).height = 10;

    // Row 3: Headers (without 'کد پرسنلی')
    const headers = [
      'نام و نام خانوادگی',
      'سمت',
      'نوع استخدام',
    ];

    calendarDays.forEach(d => {
      headers.push(`${d.day}\n${WEEKDAYS[d.dayOfWeek]}`);
    });

    headers.push('موظفی', 'ساعات کارکرد', 'اضافه‌کار', 'کسری شیفت', 'بهره‌وری', 'سنوات');

    const headerRow = worksheet.addRow(headers);
    headerRow.height = 36;

    const primaryColor = 'FF4F46E5'; // Indigo 600
    const weekendColor = 'FFE11D48'; // Rose 600 (Red)
    const kpiColor = 'FF059669'; // Emerald 600

    headerRow.eachCell((cell, colNumber) => {
      cell.font = headFont;
      cell.alignment = centerAlign;
      cell.border = {
        top: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
        bottom: { style: 'medium' as const, color: { argb: 'FF1E293B' } },
        left: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } },
        right: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } }
      };

      if (colNumber <= 3) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: primaryColor }
        };
      } else if (colNumber > 3 && colNumber <= 3 + calendarDays.length) {
        const d = calendarDays[colNumber - 4];
        if (d.isHoliday || d.dayOfWeek === 6) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: weekendColor } // Red Highlight for Holidays Headers
          };
        } else {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: primaryColor }
          };
        }
      } else {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: kpiColor }
        };
      }
    });

    // 2. Add Data Rows (without personalCode, and with highlighted columns for holidays)
    personnel.filter(p => p.active).forEach((p, rowIndex) => {
      const rep = reports.find(r => r.personnelId === p.id);
      const rowData: any[] = [
        `${p.firstName} ${p.lastName}`,
        rep?.positionText || '',
        rep?.employmentTypeText || '',
      ];

      calendarDays.forEach(d => {
        const s = schedule.assignments[p.id]?.[d.day] || 'OFF';
        let cleanS = s;
        if (s.startsWith('L')) {
          cleanS = s.substring(1) as ShiftType; // e.g. 'L1' -> '1', 'L2' -> '2'
        }
        
        // Translate OFF to Persian 'آف'
        if (cleanS === 'OFF') {
          rowData.push('آف');
        } else {
          rowData.push(cleanS);
        }
      });

      rowData.push(
        rep?.dutyHours || 0,
        rep?.workedHours || 0,
        rep?.overtimeHours || 0,
        rep?.deficitHours || 0,
        rep?.productivityHours || 0,
        rep?.experienceHours || 0
      );

      const addedRow = worksheet.addRow(rowData);
      addedRow.height = 25;

      const isEven = (rowIndex % 2 === 1);
      const rowBgColor = isEven ? 'FFF8FAFC' : 'FFFFFFFF';

      addedRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = bodyFont;
        cell.border = {
          top: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin' as const, color: { argb: 'FFE2E8F0' } }
        };
        cell.alignment = centerAlign;

        if (colNumber <= 3) {
          cell.alignment = colNumber === 1 ? rightAlign : centerAlign;
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isEven ? 'FFE2E8F0' : 'FFF1F5F9' }
          };
          cell.font = colNumber === 1 ? boldBodyFont : bodyFont;

        } else if (colNumber > 3 && colNumber <= 3 + calendarDays.length) {
          const d = calendarDays[colNumber - 4];
          const val = cell.value;
          const isHolidayCol = d.isHoliday || d.dayOfWeek === 6;
          
          if (isHolidayCol) {
            // Holiday column shading: Beautiful clear soft red/pink background for the whole column!
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFC7CE' } // Soft pastel red background
            };
            
            // Text fonts style in Holiday columns
            if (val === 'آف') {
              cell.font = { name: 'B Nazanin', size: 11, bold: true, color: { argb: 'FF9C0006' } }; // Dark red
            } else if (val === 'M') {
              cell.font = { name: 'B Titr', size: 10, bold: true, color: { argb: 'FF0284C7' } };
            } else if (val === 'E') {
              cell.font = { name: 'B Titr', size: 10, bold: true, color: { argb: 'FFEA580C' } };
            } else if (val === 'N') {
              cell.font = { name: 'B Titr', size: 10, bold: true, color: { argb: 'FF9333EA' } };
            } else if (typeof val === 'string' && ['ME', 'EN', 'MN', 'MEN'].includes(val)) {
              cell.font = { name: 'B Titr', size: 10, bold: true, color: { argb: 'FF16A34A' } };
            } else {
              cell.font = { name: 'B Titr', size: 10, bold: true, color: { argb: 'FF9C0006' } };
            }
          } else {
            // Normal day column shading
            if (val === 'آف') {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF1F5F9' }
              };
              cell.font = { name: 'B Nazanin', size: 11, color: { argb: 'FF94A3B8' } };
            } else if (val === 'M') {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0F2FE' }
              };
              cell.font = { name: 'B Titr', size: 10, bold: true, color: { argb: 'FF0284C7' } };
            } else if (val === 'E') {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFEDD5' }
              };
              cell.font = { name: 'B Titr', size: 10, bold: true, color: { argb: 'FFEA580C' } };
            } else if (val === 'N') {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF3E8FF' }
              };
              cell.font = { name: 'B Titr', size: 10, bold: true, color: { argb: 'FF9333EA' } };
            } else if (typeof val === 'string' && ['ME', 'EN', 'MN', 'MEN'].includes(val)) {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFDCFCE7' }
              };
              cell.font = { name: 'B Titr', size: 10, bold: true, color: { argb: 'FF16A34A' } };
            } else if (val !== null && val !== undefined && val !== '') {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFEF3C7' }
              };
              cell.font = { name: 'B Titr', size: 10, bold: true, color: { argb: 'FFD97706' } };
            } else {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: rowBgColor }
              };
            }
          }
        } else {
          cell.alignment = centerAlign;
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFECFDF5' }
          };
          cell.font = kpiFont;
        }
      });
    });

    // 3. Set Columns Width beautifully with proper limits
    worksheet.getColumn(1).width = 25; // Name and last name
    worksheet.getColumn(2).width = 15; // Position
    worksheet.getColumn(3).width = 15; // Employment type

    for (let c = 4; c <= 3 + calendarDays.length; c++) {
      worksheet.getColumn(c).width = 14; // Wider columns to beautifully fit full Persian weekday names
    }

    const startKpiCol = 4 + calendarDays.length;
    const endKpiCol = 9 + calendarDays.length;
    for (let c = startKpiCol; c <= endKpiCol; c++) {
      worksheet.getColumn(c).width = 11;
    }

    // Save and download actual buffer file!
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `barname_shifthaye_پرستاری_${JALALI_MONTH_NAMES[currentMonth - 1]}_${currentYear}.xlsx`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  // Generate current calendar array
  const calendarDays = generateJalaliMonthCalendar(currentYear, currentMonth, customHolidays, firstDayOfWeekIndex);

  // Render role badges
  const getRoleBadge = () => {
    switch (role) {
      case 'admin': return <span className="bg-red-500 text-white text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5"/> مدیر سیستم</span>;
      case 'headnurse': return <span className="bg-sky-500 text-white text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1"><UserCheck className="w-3.5 h-3.5"/> سرپرستار بخش</span>;
      case 'personnel': return <span className="bg-emerald-500 text-white text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1"><User className="w-3.5 h-3.5"/> پرسنل: {selectedPersonnelUser?.firstName} {selectedPersonnelUser?.lastName}</span>;
      default: return <span className="bg-slate-400 text-white text-xs px-2.5 py-1 rounded-full font-bold">مهمان</span>;
    }
  };

  const busyOverlaySubtitle =
    solvingTarget === 'nurse'
      ? 'در حال بازتولید هوشمند برنامه پرستاران و ثبت تغییرات در سامانه...'
      : solvingTarget === 'assistant'
        ? 'در حال بازتولید هوشمند برنامه کمک بهیاران و ثبت تغییرات در سامانه...'
        : isAiProcessing
          ? 'در حال پردازش درخواست شما با هوش مصنوعی و آماده سازی نتایج...'
          : isSavingDb
            ? 'اطلاعات در سامانه در حال ثبت و ذخیره سازی است. چند لحظه منتظر بمانید...'
            : null;

  if (!isMounted) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 font-sans animate-pulse" dir="rtl">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm font-black text-slate-600">در حال راه‌اندازی و همگام‌سازی سامانه هوشمند...</p>
        </div>
      </div>
    );
  }

  if (role === 'guest') {
    const activeDept = departments.find(d => d.id === selectedDepartmentId);
    const isNewDeptWithDefaults = activeDept?.username === 'headnurse' && activeDept?.password === '123456';

    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 p-4 sm:p-6 lg:p-12 font-sans relative overflow-hidden" dir="rtl">
        {busyOverlaySubtitle && <BusyOverlay subtitle={busyOverlaySubtitle} />}
        <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:16px_16px] opacity-70"></div>
        <div className="max-w-4xl w-full bg-white border border-slate-200/85 shadow-2xl rounded-3xl p-6 sm:p-10 text-center relative z-10 overflow-hidden">
          <div className="absolute top-0 bottom-0 right-0 w-2.5 bg-gradient-to-b from-emerald-600 via-teal-500 to-indigo-600"></div>
          
          {/* Be'sat Hospital Logo (Root/Public Directory Lookup) */}
          <div className="mb-6 flex flex-col items-center">
            <picture className="w-20 h-20 flex items-center justify-center transition-transform hover:scale-105 duration-300">
              <img 
                src="/logo.png" 
                alt="بیمارستان بعثت نهاجا" 
                className="w-full h-full object-contain"
                onError={(e) => {
                  const imgEl = e.currentTarget;
                  if (imgEl.src.endsWith('/logo.png')) {
                    imgEl.src = '/logo.svg';
                  } else if (imgEl.src.endsWith('/logo.svg')) {
                    imgEl.src = '/logo.jpg';
                  } else if (imgEl.src.endsWith('/logo.jpg')) {
                    imgEl.src = '/logo.jpeg';
                  } else {
                    imgEl.style.display = 'none';
                    const fallbackEl = document.getElementById('hospital-icon-fallback');
                    if (fallbackEl) {
                      fallbackEl.style.display = 'flex';
                    }
                  }
                }}
              />
              <div 
                id="hospital-icon-fallback" 
                className="hidden w-20 h-20 bg-emerald-50 rounded-2xl border border-emerald-200 shadow-inner flex items-center justify-center text-4xl"
              >
                🏥
              </div>
            </picture>
            <span className="text-[10px] text-amber-600 font-extrabold tracking-widest mt-2 uppercase">بیمارستان بعثت نهاجا</span>
          </div>

          <h2 className="text-2xl font-black text-slate-900 mb-2 font-sans text-center">سامانه هوشمند برنامه‌ریزی شیفت های پرستاری - بیمارستان بعثت نهاجا</h2>
          <p className="text-slate-500 text-xs max-w-xl mx-auto mb-8 font-bold leading-relaxed">
            سیستم توزیع عادلانه شیفت ها مبتنی بر هوش مصنوعی و الگوریتم‌های رصد قوانین بیمارستان. لطفا برای ورود، بخش مورد نظر و نوع کاربری خود را تایید نمایید.
          </p>

          {/* Department Selection & Creation Row */}
          <div className="max-w-xl mx-auto mb-8 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-right space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-black text-slate-500 mb-1.5"> بخش پرستاری فعال (مبنای ثبت اطلاعات)</label>
                <select 
                  value={selectedDepartmentId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedDepartmentId(val);
                    if (typeof window !== 'undefined') {
                      localStorage.setItem('hospital_selected_dept_id', val);
                    }
                  }}
                  className="w-full text-xs font-black bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-emerald-500 focus:outline-none text-slate-800"
                >
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.id === 'sepehr' ? '(بخش پیش‌فرض)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="sm:pt-5">
                <button
                  type="button"
                  onClick={() => setShowAddDeptModal(true)}
                  className="w-full sm:w-auto bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 font-extrabold text-xs px-3.5 py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  تعریف بخش جدید...
                </button>
              </div>
            </div>

            {/* Selected Department Description */}
            <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-slate-100">
              <div className="text-[10px] text-slate-400 font-bold">
                بخش فعلی: <span className="text-emerald-700 font-black">{activeDept?.name || 'بارگذاری نشده...'}</span>
              </div>
              {selectedDepartmentId !== 'sepehr' && (
                <button
                  type="button"
                  onClick={() => setShowDeptDeleteAuth(true)}
                  className="text-[10px] text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-1 rounded-lg transition-colors font-extrabold cursor-pointer flex items-center gap-1 shrink-0"
                >
                  حذف بخش فوق 🗑️
                </button>
              )}
            </div>
          </div>

          {authError && (
            <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 text-xs rounded-xl font-bold flex items-center justify-center gap-2 max-w-2xl mx-auto animate-pulse">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              {authError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl mx-auto">
            
            {/* Personnel dropdown login */}
            <div className="bg-slate-50/70 border border-slate-200 p-6 rounded-2xl hover:border-emerald-400 hover:bg-slate-50 transition-all flex flex-col justify-between" id="portal-personnel">
              <div>
                <div className="flex justify-center mb-3">
                  <span className="bg-emerald-100/80 text-emerald-600 p-3 rounded-xl"><Users className="w-6 h-6"/></span>
                </div>
                <h3 className="font-extrabold text-slate-800 text-base mb-1">ورود کادر درمان کشیک</h3>
                <p className="text-[11px] text-slate-500 leading-relaxed mb-4">جهت ورود و ثبت درخواست‌ها، نام، نام خانوادگی و کلمه عبور خود را وارد نمایید.</p>
              </div>
              <div className="space-y-2 text-right pt-4">
                <input 
                  type="text" 
                  placeholder="نام (به فارسی)" 
                  value={personnelFirstNameInput}
                  onChange={(e) => setPersonnelFirstNameInput(e.target.value)}
                  className="w-full text-xs font-black bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-emerald-500 focus:outline-none text-slate-800 text-center font-sans placeholder-slate-400"
                  id="login-personnel-firstname"
                />
                <input 
                  type="text" 
                  placeholder="نام خانوادگی (به فارسی)" 
                  value={personnelLastNameInput}
                  onChange={(e) => setPersonnelLastNameInput(e.target.value)}
                  className="w-full text-xs font-black bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-emerald-500 focus:outline-none text-slate-800 text-center font-sans placeholder-slate-400"
                  id="login-personnel-lastname"
                />
                <input 
                  type="password" 
                  placeholder="کلمه عبور (پیش‌فرض ۱۲۳۴)" 
                  value={personnelPasswordInput}
                  onChange={(e) => setPersonnelPasswordInput(e.target.value)}
                  className="w-full text-xs font-black bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-emerald-500 focus:outline-none text-slate-800 text-center font-mono placeholder-slate-400"
                  id="login-personnel-pass"
                />
                
                <button 
                  onClick={() => handleLogin('personnel')}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs py-3.5 rounded-xl transition-all cursor-pointer shadow-md hover:scale-[1.01] mt-2"
                  id="btn-login-personnel"
                >
                  ورود به پرتال شخصی کادر درمان
                </button>
              </div>
            </div>

            {/* Head Nurse Portal */}
            <div className="bg-slate-50/70 border border-slate-200 p-6 rounded-2xl hover:border-emerald-400 hover:bg-slate-50 transition-all flex flex-col justify-between" id="portal-headnurse">
              <div>
                <div className="flex justify-center mb-3">
                  <span className="bg-sky-100/80 text-sky-600 p-3 rounded-xl"><UserCheck className="w-6 h-6"/></span>
                </div>
                <h3 className="font-extrabold text-slate-800 text-base mb-1">پنل سرپرستار بخش</h3>
                <p className="text-[11px] text-slate-500 leading-relaxed mb-4">مدیریت مستقیم تعهدات ماهیانه، تعریف الگوهای پوشش فعال و بهینه‌ساز خودکار توزیع متعادل شیفت.</p>
              </div>
              <div className="space-y-2">
                <input 
                  type="text" 
                  placeholder="نام کاربری سرپرستار" 
                  value={headnurseUsernameInput}
                  onChange={(e) => setHeadnurseUsernameInput(e.target.value)}
                  className="w-full text-xs bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-emerald-500 focus:outline-none text-slate-800 text-center font-sans placeholder-slate-400 font-black"
                  id="input-username"
                />
                <input 
                  type="password" 
                  placeholder="کلمه عبور" 
                  value={headnursePasswordInput}
                  onChange={(e) => setHeadnursePasswordInput(e.target.value)}
                  className="w-full text-xs bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-emerald-500 focus:outline-none text-slate-800 text-center font-mono placeholder-slate-400 font-black"
                  id="input-password"
                />

                {isNewDeptWithDefaults && (
                  <p className="text-[9px] text-amber-600 font-extrabold leading-normal bg-amber-50 p-2 border border-amber-100 rounded-lg text-center mt-1 animate-fade-in">
                    ⚠️ اولین ورود سرپرستار این بخش است. جهت تنظیم اولیه کلمات عبور این بخش، نام کاربری و رمز عبور دلخواه خود را تایپ کرده و کلید ورود را بفشارید.
                  </p>
                )}

                <button 
                  onClick={() => handleLogin('headnurse')}
                  className="w-full bg-sky-600 hover:bg-sky-700 text-white font-extrabold text-xs py-3.5 rounded-xl transition-all cursor-pointer shadow-md hover:scale-[1.01] mt-2"
                  id="btn-login-headnurse"
                >
                  {isNewDeptWithDefaults ? 'ثبت و ورود اولین‌بار سرپرستار' : 'ورود سرپرستار بخش'}
                </button>
              </div>
            </div>

          </div>
        </div>

        {/* Dynamic Modal to add custom department */}
        {showAddDeptModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in" id="add-dept-modal">
            <div className="bg-white border rounded-3xl max-w-sm w-full p-6 shadow-2xl relative text-right space-y-4">
              <button 
                onClick={() => {
                  setShowAddDeptModal(false);
                  setNewDeptName('');
                  setNewDeptHeadnurseUsername('');
                  setNewDeptHeadnursePassword('');
                }}
                className="absolute top-4 left-4 text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg p-1.5 cursor-pointer"
              >
                ✕
              </button>
              
              <h3 className="text-sm font-black text-slate-800 border-b pb-3 border-slate-100">
                تعریف بخش پرستاری جدید
              </h3>

              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">نام بخش (فارسی)</label>
                  <input 
                    type="text" 
                    placeholder="مثال: بخش مهر، بخش اورژانس" 
                    value={newDeptName}
                    onChange={(e) => setNewDeptName(e.target.value)}
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">نام کاربری سرپرستار</label>
                  <input 
                    type="text" 
                    placeholder="نام کاربری مستقل بخش جدید" 
                    value={newDeptHeadnurseUsername}
                    onChange={(e) => setNewDeptHeadnurseUsername(e.target.value)}
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none text-left font-sans"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">کلمه عبور اولین ورود (حداقل ۴ کاراکتر)</label>
                  <input 
                    type="password" 
                    placeholder="کلمه عبور مستقل بخش جدید" 
                    value={newDeptHeadnursePassword}
                    onChange={(e) => setNewDeptHeadnursePassword(e.target.value)}
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none text-left font-mono"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddDeptModal(false);
                    setNewDeptName('');
                    setNewDeptHeadnurseUsername('');
                    setNewDeptHeadnursePassword('');
                  }}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs py-2 rounded-xl transition-all"
                >
                  انصراف
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!newDeptName.trim() || !newDeptHeadnurseUsername.trim() || newDeptHeadnursePassword.trim().length < 4) {
                      alert('لطفا تمامی اطلاعات بخش جدید را با شرایط صحیح وارد کنید.');
                      return;
                    }

                    const newId = `dept_${Date.now()}`;
                    const customDeptData: Department = {
                      id: newId,
                      name: newDeptName.trim(),
                      username: newDeptHeadnurseUsername.trim(),
                      password: newDeptHeadnursePassword.trim()
                    };

                    try {
                      const nextDb = getFreshDbCopy();
                      if (!nextDb.departments) nextDb.departments = [];
                      if (!nextDb.deptData) nextDb.deptData = {};

                      nextDb.departments = [...nextDb.departments, customDeptData];
                      nextDb.deptData[newId] = {
                        personnel: INITIAL_PERSONNEL.map((p, idx) => ({ ...p, orderIndex: idx })),
                        requests: INITIAL_REQUESTS,
                        settings_system: INITIAL_SETTINGS,
                        settings_credentials: {
                          username: newDeptHeadnurseUsername.trim(),
                          password: newDeptHeadnursePassword.trim()
                        },
                        holidays: {},
                        firstDayOfWeek: {},
                        schedules: {},
                      };

                      await saveDbState(nextDb);

                      // Select department and reset inputs
                      setSelectedDepartmentId(newId);
                      if (typeof window !== 'undefined') {
                        localStorage.setItem('hospital_selected_dept_id', newId);
                      }

                      setShowAddDeptModal(false);
                      setNewDeptName('');
                      setNewDeptHeadnurseUsername('');
                      setNewDeptHeadnursePassword('');
                      alert(`بخش جدید «${customDeptData.name}» با موفقیت در دیتابیس بعثت نهاجا تشکیل شد!`);
                    } catch (err) {
                      console.error(err);
                      alert('خطا در تعریف مستقل بخش جدید.');
                    }
                  }}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-2 rounded-xl transition-all shadow-md"
                >
                  تایید و پیکربندی مستقل
                </button>
              </div>
            </div>
          </div>
        )}

      {/* --- CUSTOM MODAL: DEPARTMENT DELETE AUTH --- */}
      {showDeptDeleteAuth && (
        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center z-55 p-4 print:hidden animate-fade-in" id="dept-delete-auth-modal" dir="rtl">
          <div className="bg-white rounded-[24px] shadow-2xl p-6 md:p-8 w-full max-w-[420px] animate-scale-in border border-slate-100 relative">
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2 mb-3">
              <span className="text-xl">🗑️</span> تایید هویت برای حذف بخش
            </h3>
            <p className="text-xs text-rose-500 font-bold mb-6 bg-rose-50 p-3 rounded-xl border border-rose-100 leading-relaxed">
              هشدار: شما در حال حذف کامل بخش «{departments.find(d => d.id === selectedDepartmentId)?.name || selectedDepartmentId}» هستید. این عملیات قابل بازگشت نیست. برای تایید، لطفاً نام کاربری و رمز عبور سرپرستار این بخش را وارد کنید.
            </p>
            
            <div className="space-y-4 text-right">
              <div>
                <label className="block text-[10px] font-black text-slate-600 mb-1">نام کاربری سرپرستار بخش</label>
                <input 
                  type="text" 
                  value={deleteDeptAuthUser}
                  onChange={(e) => setDeleteDeptAuthUser(e.target.value)}
                  className="w-full text-xs font-bold bg-slate-50 border border-slate-200 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 rounded-xl px-3 py-2.5 text-slate-800 font-sans"
                  placeholder="نام کاربری"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-600 mb-1">رمز عبور سرپرستار بخش</label>
                <input 
                  type="password" 
                  value={deleteDeptAuthPass}
                  onChange={(e) => setDeleteDeptAuthPass(e.target.value)}
                  className="w-full text-xs font-bold bg-slate-50 border border-slate-200 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 rounded-xl px-3 py-2.5 text-slate-800 font-mono"
                  placeholder="رمز عبور"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-8">
              <button 
                onClick={async () => {
                  const matchedDept = departments.find(d => d.id === selectedDepartmentId);
                  if (matchedDept && matchedDept.username === deleteDeptAuthUser && matchedDept.password === deleteDeptAuthPass) {
                    try {
                      const nextDb = getFreshDbCopy();
                      if (!nextDb.departments) nextDb.departments = [];
                      if (!nextDb.deptData) nextDb.deptData = {};

                      nextDb.departments = nextDb.departments.filter(d => d.id !== selectedDepartmentId);
                      delete nextDb.deptData[selectedDepartmentId];

                      await saveDbState(nextDb);

                      alert(`بخش با موفقیت حذف شد.`);
                      setSelectedDepartmentId('sepehr');
                      setShowDeptDeleteAuth(false);
                      setDeleteDeptAuthUser('');
                      setDeleteDeptAuthPass('');
                      if (typeof window !== 'undefined') {
                        localStorage.setItem('hospital_selected_dept_id', 'sepehr');
                      }
                    } catch (err) {
                      console.error("Error deleting department:", err);
                      alert("خطا در حذف بخش.");
                    }
                  } else {
                    alert('نام کاربری یا رمز عبور سرپرستار بخش نادرست است. عملیات لغو شد.');
                  }
                }}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs py-2.5 rounded-xl transition-all font-sans cursor-pointer shadow-sm border border-rose-700"
              >
                تایید و حذف قطعی بخش
              </button>
              <button 
                onClick={() => {
                  setShowDeptDeleteAuth(false);
                  setDeleteDeptAuthUser('');
                  setDeleteDeptAuthPass('');
                }}
                className="flex-1 bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 font-bold text-xs py-2.5 rounded-xl transition-all cursor-pointer font-sans"
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen h-screen w-full overflow-hidden bg-slate-50 font-sans" dir="rtl">
      {busyOverlaySubtitle && <BusyOverlay subtitle={busyOverlaySubtitle} />}
      
      {/* FLOATING COLLAPSIBLE NAVIGATION DRAWER (HAMBURGER SIDEMENU) */}
      {isNavOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex justify-start print:hidden animate-fade-in"
          onClick={() => setIsNavOpen(false)}
          id="drawer-overlay"
        >
          <div 
            className="w-72 bg-[#1e293b] text-white h-full flex flex-col shadow-2xl relative animate-slide-left"
            onClick={(e) => e.stopPropagation()}
            id="drawer-container"
          >
            {/* Drawer Logo / Header */}
            <div className="p-6 border-b border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center font-bold text-white shadow-md shadow-blue-500/20">H</div>
                <span className="text-lg font-black tracking-tight text-white">سامانه پرستاری</span>
              </div>
              <button 
                onClick={() => setIsNavOpen(false)}
                className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-colors cursor-pointer"
                id="btn-close-drawer"
                title="بستن منو"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation Drawer List */}
            <nav className="flex-1 py-4 text-sm font-semibold space-y-1 overflow-y-auto">
              
              {/* Dashboard Table Nav */}
              <button
                onClick={() => {
                  setActiveTab('schedule');
                  setIsNavOpen(false);
                }}
                className={`w-full px-6 py-3 flex items-center gap-3 text-right hover:text-white transition-all cursor-pointer ${
                  activeTab === 'schedule'
                    ? 'bg-blue-600/20 text-blue-400 border-r-4 border-blue-400 font-extrabold'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
                id="tab-schedule-drawer"
              >
                <span className="text-lg leading-none">📊</span>
                <span>داشبورد زمان‌بندی</span>
              </button>

              {/* Personnel Management Nav */}
              {role !== 'personnel' && (
                <button
                  onClick={() => {
                    setActiveTab('personnel');
                    setIsNavOpen(false);
                  }}
                  className={`w-full px-6 py-3 flex items-center gap-3 text-right hover:text-white transition-all cursor-pointer ${
                    activeTab === 'personnel'
                      ? 'bg-blue-600/20 text-blue-400 border-r-4 border-blue-400 font-extrabold'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                  id="tab-personnel-drawer"
                >
                  <span className="text-lg leading-none">👥</span>
                  <span>مدیریت پرسنل</span>
                </button>
              )}

              {/* Calendar & Holiday Settings Nav */}
              {role !== 'personnel' && (
                <button
                  onClick={() => {
                    setActiveTab('calendar');
                    setIsNavOpen(false);
                  }}
                  className={`w-full px-6 py-3 flex items-center gap-3 text-right hover:text-white transition-all cursor-pointer ${
                    activeTab === 'calendar'
                      ? 'bg-blue-600/20 text-blue-400 border-r-4 border-blue-400 font-extrabold'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                  id="tab-calendar-drawer"
                >
                  <span className="text-lg leading-none">📅</span>
                  <span>مدیریت تقویم و تعطیلات</span>
                </button>
              )}

              {/* Leave Requests Nav */}
              <button
                onClick={() => {
                  setActiveTab('requests');
                  setIsNavOpen(false);
                }}
                className={`w-full px-6 py-3 flex items-center gap-3 text-right hover:text-white transition-all cursor-pointer ${
                  activeTab === 'requests'
                    ? 'bg-blue-600/20 text-blue-400 border-r-4 border-blue-400 font-extrabold'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
                id="tab-requests-drawer"
              >
                <span className="text-lg leading-none">📝</span>
                <span>ثبت درخواست‌ها</span>
              </button>

              {/* Monthly Reports Nav */}
              <button
                onClick={() => {
                  setActiveTab('reports');
                  setIsNavOpen(false);
                }}
                className={`w-full px-6 py-3 flex items-center gap-3 text-right hover:text-white transition-all cursor-pointer ${
                  activeTab === 'reports'
                    ? 'bg-blue-600/20 text-blue-400 border-r-4 border-blue-400 font-extrabold'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
                id="tab-reports-drawer"
              >
                <span className="text-lg leading-none">📈</span>
                <span>کارنامه و گزارشات</span>
              </button>

              {/* District Settings Nav */}
              {role === 'admin' && (
                <button
                  onClick={() => {
                    setActiveTab('settings');
                    setIsNavOpen(false);
                  }}
                  className={`w-full px-6 py-3 flex items-center gap-3 text-right hover:text-white transition-all cursor-pointer ${
                    activeTab === 'settings'
                      ? 'bg-[#2563eb]/20 text-blue-400 border-r-4 border-blue-400 font-extrabold'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  }`}
                  id="tab-settings-drawer"
                >
                  <span className="text-lg leading-none">🛠️</span>
                  <span>تنظیمات بخش</span>
                </button>
              )}

              {/* Secure Profile Menu Option */}
              <button
                onClick={() => {
                  setActiveTab('profile');
                  setIsNavOpen(false);
                }}
                className={`w-full px-6 py-3 flex items-center gap-3 text-right hover:text-white transition-all cursor-pointer ${
                  activeTab === 'profile'
                    ? 'bg-emerald-600/20 text-emerald-400 border-r-4 border-emerald-400 font-extrabold'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
                id="tab-profile-drawer"
              >
                <span className="text-lg leading-none font-sans text-xs shrink-0">👤</span>
                <span>پروفایل امن کاربری</span>
              </button>
            </nav>

            {/* Current logged user card & engine status widget */}
            <div className="p-4 border-t border-slate-700/80 space-y-4">
              
              {/* Active Level Card */}
              <div className="bg-slate-800/50 p-3 rounded-xl border border-slate-700/50">
                <div className="text-[10px] text-slate-400 mb-1 font-bold">سطح دسترسی فعال:</div>
                <div className="flex items-center justify-between">
                  <div className="font-extrabold text-xs text-slate-200">
                    {role === 'admin' ? 'مدیر سیستم' : role === 'headnurse' ? 'سرپرستار بخش' : `پرسنل: ${selectedPersonnelUser?.lastName}`}
                  </div>
                  <button
                    onClick={() => {
                      handleLogout();
                      setIsNavOpen(false);
                    }}
                    title="خروج از حساب"
                    className="text-slate-400 hover:text-rose-400 p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                    id="btn-logout-drawer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Smart Engine Widget Status */}
              <div className="bg-[#151f32]/85 p-3 rounded-xl border border-slate-800/50 text-[11px] font-bold">
                <div className="text-slate-400 mb-1 leading-tight text-[10px]">وضعیت محاسبات هوشمند:</div>
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  <span className="text-white">آماده به کار (CP-SAT)</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      )}

      {/* DASHBOARD CONTAINER WORKSPACE */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        
        {/* HEADER BAR */}
        <header className="h-16 bg-white border-b border-slate-200 px-6 sm:px-8 flex items-center justify-between shrink-0 print:hidden transition-all duration-300">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsNavOpen(true)}
              className="p-2 sm:px-3 sm:py-2 bg-[#1e293b] text-white hover:bg-slate-800 rounded-xl transition-all cursor-pointer flex items-center gap-2 font-black text-xs shadow-md shadow-slate-900/10"
              title="باز کردن منوی ناوبری"
              id="btn-nav-toggle"
            >
              <Menu className="w-4 h-4 text-white" />
              <span className="hidden sm:inline">منوی ناوبری</span>
            </button>
            <h1 className="text-base sm:text-lg font-black text-slate-800 underline decoration-emerald-500 underline-offset-8">
              برنامه‌ریزی شیفت {JALALI_MONTH_NAMES[currentMonth - 1]} {currentYear}
            </h1>
            <div className="hidden md:flex text-xs font-black text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
              {departments.find(d => d.id === selectedDepartmentId)?.name || 'بخش سپهر'}
            </div>
            {/* Iranian Object Storage Status Badge */}
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-black text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-full border border-blue-100">
              <span className={`w-2 h-2 rounded-full ${isSavingDb ? 'bg-orange-500 animate-pulse' : (isLoadingDb ? 'bg-blue-400 animate-pulse' : 'bg-emerald-500')}`} />
              <span>پشتیبان‌گیری ابری:</span>
              <span className="font-mono text-[9px] text-blue-600 bg-blue-100/60 px-1.5 py-0.5 rounded-md">Arvan S3</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4 text-xs">
            <div className="text-right hidden sm:block">
              <p className="font-black text-slate-800">
                {role === 'admin' ? 'دکتر مریم علوی' : role === 'headnurse' ? (departments.find(d => d.id === selectedDepartmentId)?.name || 'بخش سپهر') : `${selectedPersonnelUser?.firstName} ${selectedPersonnelUser?.lastName}`}
              </p>
              <p className="text-slate-500 text-[10px] text-right font-medium mt-0.5">
                {role === 'admin' ? 'سوپروایزر ارشد بیمارستان' : role === 'headnurse' ? 'مدیریت برنامه‌ریزی' : 'کارشناس پرستاری'}
              </p>
            </div>
            <div className="w-10 h-10 bg-gradient-to-tr from-emerald-500 to-teal-600 rounded-full flex items-center justify-center font-bold text-white shadow-md text-sm cursor-pointer select-none">
              {role === 'admin' ? 'AD' : role === 'headnurse' ? 'HN' : selectedPersonnelUser ? selectedPersonnelUser.firstName[0] : 'G'}
            </div>
          </div>
        </header>

        {/* HORIZONTAL MONTH SELECTOR RIBBON */}
        <div className="bg-white border-b border-slate-100 px-6 sm:px-8 py-3 flex gap-2 overflow-x-auto print:hidden shrink-0 shadow-2xs scrollbar-none">
          {JALALI_MONTH_NAMES.map((name, idx) => {
            const mNum = idx + 1;
            const isActive = currentMonth === mNum;
            return (
              <button
                key={name}
                type="button"
                onClick={() => handleSelectMonth(mNum)}
                className={`px-4 py-1.5 rounded-full text-xs font-black shrink-0 transition-all cursor-pointer ${
                  isActive 
                    ? 'bg-emerald-600 text-white shadow-xs scale-102 font-black' 
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200/60'
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>

        {/* CONTENT VIEWPORT */}
        <div className="flex-1 p-6 space-y-6 overflow-y-auto bg-slate-50 print:p-0 print:bg-white text-slate-800">
          
          {/* QUICK PERMISSIONS AND SOLVER STRAP ALERT */}
          <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-sm flex flex-col md:flex-row items-center justify-between gap-4 print:hidden">
            <div className="flex items-center gap-2 text-xs">
              <span className="bg-indigo-50 text-indigo-700 p-1.5 rounded-xl border border-indigo-100"><Sparkles className="w-4 h-4"/></span>
              <div>
                <span className="font-extrabold text-slate-700 ml-1">بازه برنامه‌ریزی:</span>
                <span className="font-mono bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-2 py-0.5 font-bold">
                  {JALALI_MONTH_NAMES[currentMonth - 1]} {currentYear}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {role === 'headnurse' && (
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsChangingPassword(!isChangingPassword)}
                    className="text-xs bg-slate-100 hover:bg-slate-200 border border-slate-200 font-bold px-3 py-1.5 rounded-xl text-slate-800 transition-all cursor-pointer"
                    id="btn-toggle-change-pass"
                  >
                    تغییر مشخصات سرپرستار
                  </button>
                  {isChangingPassword && (
                    <div className="flex gap-1 items-center">
                      <input 
                        type="text" 
                        placeholder="نام کاربری جدید" 
                        value={newUsernameValue}
                        onChange={(e) => setNewUsernameValue(e.target.value)}
                        className="text-xs border border-slate-300 px-2.5 py-1.5 rounded-xl bg-white w-28 focus:outline-none"
                      />
                      <input 
                        type="password" 
                        placeholder="رمز جدید" 
                        value={newPasswordValue}
                        onChange={(e) => setNewPasswordValue(e.target.value)}
                        className="text-xs border border-slate-300 px-2.5 py-1.5 rounded-xl bg-white w-24 focus:outline-none"
                      />
                      <button onClick={handleChangeCredentials} className="bg-sky-600 text-white text-xs px-2.5 py-1.5 rounded-xl font-bold hover:bg-sky-700 cursor-pointer">ثبت</button>
                    </div>
                  )}
                </div>
              )}
              {role !== 'personnel' && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleRunOptimizer('nurse')}
                    disabled={solvingTarget !== null}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-xs font-black px-4 py-2.5 rounded-xl shadow-lg ring-4 ring-indigo-500/10 cursor-pointer"
                    id="btn-run-solver-nurse"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${solvingTarget === 'nurse' ? 'animate-spin' : ''}`} />
                    {solvingTarget === 'nurse' ? 'در حال بازتولید هوشمند پرستاران...' : 'بازتولید هوشمند پرستاران'}
                  </button>
                  <button
                    onClick={() => handleRunOptimizer('assistant')}
                    disabled={solvingTarget !== null}
                    className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-xs font-black px-4 py-2.5 rounded-xl shadow-lg ring-4 ring-teal-500/10 cursor-pointer"
                    id="btn-run-solver-assistant"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${solvingTarget === 'assistant' ? 'animate-spin' : ''}`} />
                    {solvingTarget === 'assistant' ? 'در حال بازتولید هوشمند کمک‌بهیاران...' : 'بازتولید هوشمند کمک‌بهیاران'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* DASHBOARD DISPATCH STATS KPI CORNER */}
          {(activeTab === 'schedule' || activeTab === 'reports') && (
            <>
              {role !== 'personnel' ? (
                <div className={`grid grid-cols-2 gap-4 print:hidden lg:grid-cols-4`}>
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="text-slate-500 text-[10px] font-black mb-1">کل پرسنل فعال</div>
                      <div className="text-2xl font-black text-slate-900 font-mono">{personnel.filter(p => p.active).length} نفر</div>
                    </div>
                    <div className="text-indigo-600 text-[10px] mt-2 font-bold bg-indigo-50 border border-indigo-100/50 px-2 py-0.5 rounded w-max">
                      نیروی سازمان‌دهی شده
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="text-slate-500 text-[10px] font-black mb-1">میانگین موظفی کادر</div>
                      <div className="text-2xl font-black text-slate-900 font-mono">{monthlyDutyHours ? monthlyDutyHours.official : settings.dutyHours.official} ساعت</div>
                    </div>
                    <div className="text-slate-500 text-[10px] mt-2 font-bold bg-slate-100 px-2 py-0.5 rounded w-max">
                      {monthlyDutyHours ? 'تصویب شده این ماه' : 'بر اساس قانون استخدام'}
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-r-4 border-r-orange-500 flex flex-col justify-between animate-fade-in">
                    <div>
                      <div className="text-slate-500 text-[10px] font-black mb-1">هشدارهای پوشش شیفت</div>
                      <div className="text-2xl font-black text-orange-600 font-mono">
                        {schedule ? schedule.warnings.filter(w => !dismissedWarnings.includes(w)).length : 0} مورد
                        {schedule && schedule.warnings.length > schedule.warnings.filter(w => !dismissedWarnings.includes(w)).length && (
                          <span className="text-xs text-slate-400 font-sans font-medium mr-1.5">
                            ({schedule.warnings.length - schedule.warnings.filter(w => !dismissedWarnings.includes(w)).length} حذف‌شده)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-orange-600 text-[10px] mt-2 font-bold bg-orange-50 border border-orange-100/50 px-2 py-0.5 rounded w-max">
                      مغایرت قوانین کادر
                    </div>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm border-r-4 border-r-blue-500 flex flex-col justify-between">
                    <div>
                      <div className="text-slate-500 text-[10px] font-black mb-1">کل درخواست‌های ماه</div>
                      <div className="text-2xl font-black text-blue-600 font-mono">{requests.length} درخواست</div>
                    </div>
                    <div className="text-blue-600 text-[10px] mt-2 font-bold bg-blue-50 border border-blue-100/50 px-2 py-0.5 rounded w-max">
                      مرخصی و آف ثبت شده
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 print:hidden">
                  <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                    <div className="bg-slate-50 border-b border-slate-100 px-4 py-3 flex items-center justify-between">
                      <div className="font-black text-slate-800 text-sm flex items-center gap-2">
                        <CalendarIcon className="w-5 h-5 text-emerald-600" />
                        تقویم شمسی {JALALI_MONTH_NAMES[currentMonth - 1]} {currentYear}
                      </div>
                      <div className="text-[10px] font-bold text-slate-500">فقط جهت مشاهده ماه</div>
                    </div>
                    <div className="p-4 bg-white">
                      <div className="grid grid-cols-7 gap-1 mb-2">
                        {['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map((dayName, idx) => (
                          <div key={idx} className={`text-center text-[10px] font-black py-1 rounded-md ${idx === 6 ? 'text-rose-500 bg-rose-50' : 'text-slate-500 bg-slate-50'}`}>
                            {dayName}
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-7 gap-1">
                        {Array.from({ length: firstDayOfWeekIndex || 0 }).map((_, i) => (
                          <div key={`empty-${i}`} className="p-2 border border-transparent"></div>
                        ))}
                        {calendarDays.map((d) => (
                          <div 
                            key={d.day} 
                            className={`flex flex-col items-center justify-center p-2 rounded-xl border relative ${
                              d.isHoliday 
                                ? 'border-rose-100 bg-rose-50/50 text-rose-700' 
                                : 'border-slate-100 bg-white text-slate-700'
                            }`}
                          >
                            <span className="text-xs font-mono font-bold block">{d.day}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col justify-center items-center text-center relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-100/50 rounded-full blur-3xl -mr-10 -mt-10"></div>
                    <div className="relative z-10 w-full flex flex-col items-center">
                      <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-4 ring-8 ring-emerald-50/50">
                        <Clock className="w-7 h-7" />
                      </div>
                      <h3 className="text-sm font-black text-slate-800 mb-1">ساعت موظفی این ماه شما</h3>
                      <div className="text-[11px] font-bold text-slate-500 mb-4 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
                        استخدام: {selectedPersonnelUser?.employmentType === 'official' ? 'رسمی' : selectedPersonnelUser?.employmentType === 'contract' ? 'قراردادی' : selectedPersonnelUser?.employmentType === 'conscript' ? 'طرح/وظیفه' : 'اضافه‌کار'}
                      </div>
                      <div className="text-4xl font-mono font-black text-emerald-600">
                        {monthlyDutyHours ? monthlyDutyHours[selectedPersonnelUser?.employmentType || 'official'] : settings.dutyHours[selectedPersonnelUser?.employmentType || 'official']} <span className="text-lg font-sans font-extrabold text-emerald-700/60">ساعت</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* INTERNAL CONTENT VIEW MANAGER */}
          {activeTab === 'schedule' && (
            <div className="space-y-6">
              
              {/* Toolbar */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4 print:hidden">
                <div className="flex items-center gap-3">
                  <h3 className="font-extrabold text-slate-800 text-sm">لیست شیفت‌های ماهانه</h3>
                  <p className="text-slate-400 text-xs font-semibold">تعداد روزها: {calendarDays.length} روز / {calendarDays.filter(c => c.isHoliday).length} روز تعطیلات</p>
                </div>
                
                <div className="flex items-center gap-2">
                  {role !== 'personnel' && (
                    finalizedMonths.includes(`${currentYear}_${currentMonth}`) ? (
                      <button 
                        onClick={handleUnfinalizeMonth}
                        className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-black px-3.5 py-2 rounded-xl border border-emerald-200 transition-all cursor-pointer shadow-xs"
                        title="قفل این ماه فعال است. برای باز کردن و ویرایش مجدد کلیک کنید"
                      >
                        <Lock className="w-4 h-4 text-emerald-600 animate-[pulse_2s_infinite]"/>
                        <span>برنامه ثبت نهایی شده (باز کردن قفل)</span>
                      </button>
                    ) : (
                      <button 
                        onClick={handleFinalizeMonth}
                        className="flex items-center gap-1.5 bg-slate-50 hover:bg-emerald-600 hover:text-white text-slate-700 text-xs font-black px-3.5 py-2 rounded-xl border border-slate-200 hover:border-emerald-600 transition-all cursor-pointer shadow-xs"
                        title="ثبت نهایی و قفل برنامه این ماه"
                      >
                        <Unlock className="w-4 h-4 text-slate-500 hover:text-inherit"/>
                        <span>ثبت نهایی و قفل جدول</span>
                      </button>
                    )
                  )}
                  <button 
                    onClick={exportToExcel}
                    className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 transition-colors cursor-pointer"
                    id="btn-export-excel"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600"/> خروجی فایل اکسل (Excel)
                  </button>
                  <button 
                    onClick={handlePrint}
                    className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 transition-colors cursor-pointer"
                    id="btn-export-pdf"
                  >
                    <Printer className="w-4 h-4 text-indigo-600"/> چاپ برنامه / PDF
                  </button>
                </div>
              </div>

              {/* Solver Outputs & Deadlock Solving Warnings */}
              {role !== 'personnel' && schedule && schedule.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-4 shadow-inner">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h4 className="text-amber-900 font-extrabold text-sm flex items-center gap-1.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 animate-[bounce_1.5s_infinite]"/>
                      هشدارها و تصمیمات موتور برنامه‌ریز (حل بن‌بست):
                    </h4>
                    {dismissedWarnings.length > 0 && (
                      <button
                        onClick={() => {
                          setDismissedWarnings([]);
                          localStorage.removeItem(`hospital_dismissed_warnings_${currentYear}_${currentMonth}`);
                        }}
                        className="text-amber-700 hover:text-amber-950 font-bold text-[10px] bg-amber-100/70 border border-amber-200 hover:bg-amber-200/80 px-2.5 py-1 rounded-lg transition-all cursor-pointer shadow-2xs"
                      >
                        بازیابی همه هشدارهای حذف شده ({dismissedWarnings.length})
                      </button>
                    )}
                  </div>
                  {schedule.warnings.filter(w => !dismissedWarnings.includes(w)).length === 0 ? (
                    <div className="text-xs text-emerald-800 font-bold bg-white/80 border border-emerald-150 p-3 rounded-xl text-center shadow-2xs">
                      ✨ تمامی هشدارهای این ماه توسط شما نادیده گرفته شده‌اند.
                    </div>
                  ) : (
                    <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 text-xs text-amber-800">
                      {schedule.warnings.filter(w => !dismissedWarnings.includes(w)).map((warn, i) => (
                        <li key={i} className="flex items-start justify-between gap-1.5 bg-white/70 p-2.5 rounded-xl border border-amber-100/85 group transition-all hover:bg-white hover:shadow-xs">
                          <div className="flex items-start gap-1">
                            <span className="text-amber-600 font-black ml-1">•</span>
                            <span className="leading-relaxed">{warn}</span>
                          </div>
                          <button
                            onClick={() => handleDismissWarning(warn)}
                            className="text-amber-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg p-1 transition-all flex-shrink-0 cursor-pointer self-start"
                            title="حذف دستی این هشدار"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* SCHEDULE SCROLLABLE WEB GRID */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden" id="schedule-grid-container">
                <div className="overflow-x-auto overflow-y-auto max-h-[75vh]">
                  <table className="w-full text-right border-collapse min-w-[1200px]">
                    
                    {/* Calendar Head Days numbers */}
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-20 shadow-sm">
                      <tr>
                        <th className="sticky right-0 top-0 bg-slate-50 z-30 px-4 py-3 text-xs font-extrabold text-slate-600 border-l border-b border-slate-200 w-44 text-center">پرسنل / روزهای ماه</th>
                        {calendarDays.map(d => (
                          <th 
                            key={d.day} 
                            className={`sticky top-0 z-20 px-1 py-2 text-center text-[10px] font-black border-l border-b border-slate-200 min-w-[34px] ${d.isHoliday ? 'bg-rose-50 border-b-2 border-b-rose-400 text-rose-800' : 'bg-slate-50 text-slate-600'}`}
                            title={d.holidayTitle || 'روز عادی'}
                          >
                            <div>{d.day}</div>
                            <div className="font-medium text-[9px] mt-0.5">{WEEKDAYS[d.dayOfWeek].substring(0, 2)}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>

                    {/* Matrix Rows */}
                    <tbody className="divide-y divide-slate-200">
                      
                      {/* Filter logic if role is personnel: show only their row */}
                      {personnel
                        .filter(p => p.active)
                        .filter(p => {
                          if (role === 'personnel' && selectedPersonnelUser) {
                            return p.id === selectedPersonnelUser.id;
                          }
                          return true;
                        })
                        .map(p => {
                          const pAssignments = schedule?.assignments[p.id] || {};
                          const report = reports.find(r => r.personnelId === p.id);
                          
                          return (
                            <tr key={p.id} className="hover:bg-indigo-50/20 transition-colors">
                              
                              {/* Personnel Info Card */}
                              <td className="sticky right-0 bg-white z-10 px-4 py-2 border-l border-slate-200 shadow-[2px_0_5px_rgba(0,0,0,0.03)] text-right">
                                <div className="font-extrabold text-slate-900 text-sm leading-tight">{p.firstName} {p.lastName}</div>
                                <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-400 font-serif">
                                  <span>{p.personalCode} •</span>
                                  <span className="font-bold text-slate-500">{report?.positionText}</span>
                                </div>
                              </td>

                              {/* Day Shift cells */}
                              {calendarDays.map(d => {
                                const currentShift = pAssignments[d.day] || 'OFF';
                                
                                const isShiftLeaderM = schedule?.shiftLeaders?.[d.day]?.morning === p.id;
                                const isShiftLeaderE = schedule?.shiftLeaders?.[d.day]?.afternoon === p.id;
                                const isShiftLeaderN = schedule?.shiftLeaders?.[d.day]?.night === p.id;

                                const isShiftLeaderCell = 
                                  (currentShift === 'M' && isShiftLeaderM) ||
                                  (currentShift === 'E' && isShiftLeaderE) ||
                                  (currentShift === 'N' && isShiftLeaderN) ||
                                  (currentShift === 'ME' && (isShiftLeaderM || isShiftLeaderE)) ||
                                  (currentShift === 'EN' && (isShiftLeaderE || isShiftLeaderN)) ||
                                  (currentShift === 'MN' && (isShiftLeaderM || isShiftLeaderN)) ||
                                  (currentShift === 'MEN' && (isShiftLeaderM || isShiftLeaderE || isShiftLeaderN));

                                // Color Scheme definitions
                                let badgeClass = "bg-slate-100 text-slate-400 text-[10px]";
                                let displayVal: string = currentShift;

                                if (currentShift === 'M') {
                                  badgeClass = "bg-blue-50 text-blue-700 font-bold border-blue-200 border text-xs";
                                  displayVal = isShiftLeaderCell ? 'صبح 👑' : 'صبح';
                                } else if (currentShift === 'E') {
                                  badgeClass = "bg-amber-50 text-amber-700 font-bold border-amber-200 border text-xs";
                                  displayVal = isShiftLeaderCell ? 'عصر 👑' : 'عصر';
                                } else if (currentShift === 'N') {
                                  badgeClass = "bg-purple-50 text-purple-700 font-bold border-purple-200 border text-xs";
                                  displayVal = isShiftLeaderCell ? 'شب 👑' : 'شب';
                                } else if (currentShift === 'ME') {
                                  badgeClass = "bg-gradient-to-r from-blue-50 to-amber-50 text-slate-700 font-black border-indigo-200 border text-xs";
                                  displayVal = isShiftLeaderCell ? 'ME 👑' : 'ME';
                                } else if (currentShift === 'EN') {
                                  badgeClass = "bg-gradient-to-r from-amber-50 to-purple-50 text-slate-700 font-black border-violet-200 border text-xs";
                                  displayVal = isShiftLeaderCell ? 'EN 👑' : 'EN';
                                } else if (currentShift === 'MN') {
                                  badgeClass = "bg-gradient-to-r from-blue-50 to-purple-50 text-indigo-700 font-black border-indigo-200 border text-xs";
                                  displayVal = isShiftLeaderCell ? 'MN 👑' : 'MN';
                                } else if (currentShift === 'MEN') {
                                  badgeClass = "bg-indigo-600 text-white font-black text-xs";
                                  displayVal = isShiftLeaderCell ? 'MEN 👑' : 'MEN';
                                } else if (currentShift === 'OFF') {
                                  badgeClass = "bg-slate-50 text-slate-300 font-medium text-xs";
                                  displayVal = 'آف';
                                } else if (currentShift.startsWith('L')) {
                                  // LEAVE! Under rule: "نمایش مرخصی به صورت ۱ ۲ ۳ و نه L1 یا L2"
                                  badgeClass = "bg-emerald-100 text-emerald-800 font-black text-xs border border-emerald-300";
                                  displayVal = currentShift.substring(1); // 'L1' -> '1', 'L2' -> '2'
                                }

                                // Interactive cell selection for HeadNurse/Admin editing
                                const isEditingThis = editingCell?.pId === p.id && editingCell?.day === d.day;

                                return (
                                  <td 
                                    key={d.day} 
                                    className={`px-0.5 py-1 text-center border-l border-slate-100 relative ${d.isHoliday ? 'bg-rose-50/10' : ''}`}
                                  >
                                    {isEditingThis ? (
                                      <select 
                                        autoFocus
                                        value={currentShift}
                                        onChange={(e) => handleManualShiftChange(p.id, d.day, e.target.value as ShiftType)}
                                        onBlur={() => setEditingCell(null)}
                                        className="absolute inset-0 z-20 w-full h-full text-xs font-bold border border-indigo-500 bg-white"
                                        id={`select-edit-${p.id}-${d.day}`}
                                      >
                                        <option value="OFF">آف (OFF)</option>
                                        <option value="M">صبح (M)</option>
                                        <option value="E">عصر (E)</option>
                                        <option value="N">شب (N)</option>
                                        <option value="ME">عصر-صبح (ME)</option>
                                        <option value="EN">شب-عصر (EN)</option>
                                        <option value="MN">شب-صبح (MN)</option>
                                        <option value="MEN">ترکیبی (MEN)</option>
                                        <option value="L1">مرخصی روز ۱</option>
                                        <option value="L2">مرخصی روز ۲</option>
                                        <option value="L3">مرخصی روز ۳</option>
                                        <option value="L4">مرخصی روز ۴</option>
                                        <option value="L5">مرخصی روز ۵</option>
                                      </select>
                                    ) : (
                                      <button 
                                        onClick={() => handleCellClick(p.id, d.day)}
                                        disabled={role === 'personnel'}
                                        className={`w-full max-w-[32px] h-8 rounded-lg flex items-center justify-center transition-all ${badgeClass} ${role !== 'personnel' ? 'hover:scale-105 hover:shadow cursor-pointer' : ''}`}
                                        title={`${p.firstName} ${p.lastName} • روز ${d.day} \nکلیک برای ویرایش دستی`}
                                        id={`cell-${p.id}-${d.day}`}
                                      >
                                        {displayVal}
                                      </button>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Legends explanation */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs font-semibold print:hidden">
                <span className="text-slate-500">راهنمای نوبت‌های کاری:</span>
                <div className="flex flex-wrap gap-4">
                  <span className="flex items-center gap-1.5"><span className="w-5 h-5 bg-blue-50 text-blue-700 border border-blue-200 flex items-center justify-center rounded font-bold">صبح</span> صبح (M)</span>
                  <span className="flex items-center gap-1.5"><span className="w-5 h-5 bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center rounded font-bold">عصر</span> عصر (E)</span>
                  <span className="flex items-center gap-1.5"><span className="w-5 h-5 bg-purple-50 text-purple-700 border border-purple-200 flex items-center justify-center rounded font-bold">شب</span> شب (N)</span>
                  <span className="flex items-center gap-1.5"><span className="w-5 h-5 bg-gradient-to-r from-blue-100 to-amber-100 text-slate-700 flex items-center justify-center rounded font-bold text-[10px]">ME</span> عصر-صبح (ME)</span>
                  <span className="flex items-center gap-1.5"><span className="w-5 h-5 bg-indigo-600 text-white flex items-center justify-center rounded font-bold text-[9px]">MEN</span> کل روز (MEN)</span>
                  <span className="flex items-center gap-1.5"><span className="w-5 h-5 bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center justify-center rounded font-bold">۱</span> شماره روزهای متوالی مرخصی</span>
                  <span className="flex items-center gap-1.5"><span className="w-5 h-5 bg-rose-100 border border-rose-300 w-3.5 h-3.5 inline-block rounded"></span> جمعه‌ها و تعطیلات رسمی</span>
                </div>
              </div>

            </div>
          )}

          {/* --- VIEW 2: PERSONNEL LIST & MANAGEMENT --- */}
          {activeTab === 'personnel' && role !== 'personnel' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-black text-slate-900">لیست کادر پرستاری و کمک‌بهیاران بخش</h3>
                <button
                  onClick={handleOpenAddPersonnel}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg cursor-pointer"
                  id="btn-add-personnel"
                >
                  <Plus className="w-4 h-4"/> تعریف پرسنل پرسنل جدید
                </button>
              </div>

              {/* Personnel Table list */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-right border-collapse min-w-[800px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-3.5 text-xs font-black text-slate-500 text-center w-28">ترتیب چیدمان</th>
                        <th className="px-6 py-3.5 text-xs font-black text-slate-500">کد پرسنلی</th>
                        <th className="px-6 py-3.5 text-xs font-black text-slate-500">نام و نام خانوادگی</th>
                        <th className="px-6 py-3.5 text-xs font-black text-slate-500">گروه شغلی / سمت</th>
                        <th className="px-6 py-3.5 text-xs font-black text-slate-500">نوع استخدام</th>
                        <th className="px-6 py-3.5 text-xs font-black text-slate-500 text-center">سابقهکار (سال)</th>
                        <th className="px-6 py-3.5 text-xs font-black text-slate-500 text-center">قابلیت سرشیفت</th>
                        <th className="px-6 py-3.5 text-xs font-black text-slate-500 text-center">وضعیت کاربر</th>
                        <th className="px-6 py-3.5 text-xs font-black text-slate-500 text-center w-28">عملیات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {personnel.map((p, index) => (
                        <tr key={p.id} className="hover:bg-slate-50/50 transition-colors animate-fadeIn">
                          <td className="px-4 py-3.5 text-center">
                            <div className="flex items-center justify-center gap-1 bg-slate-50 p-1.5 rounded-xl border border-slate-150 inline-flex">
                              {/* Move Up Input */}
                              <button
                                disabled={index === 0}
                                onClick={() => movePersonnel(index, 'up')}
                                className="text-slate-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-400 p-0.5 rounded-md hover:bg-white border border-transparent hover:border-slate-100 transition-all cursor-pointer"
                                title="انتقال به ردیف بالا"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              
                              {/* Direct Order Number Input */}
                              <input
                                type="number"
                                min="1"
                                max={personnel.length}
                                value={index + 1}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  if (!isNaN(val)) changePersonnelPosition(index, val);
                                }}
                                className="w-9 text-center text-xs font-black bg-white border border-slate-200 rounded-lg py-0.5 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-100"
                                title="تغییر شماره ردیف مستقیم"
                              />

                              {/* Move Down Input */}
                              <button
                                disabled={index === personnel.length - 1}
                                onClick={() => movePersonnel(index, 'down')}
                                className="text-slate-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-400 p-0.5 rounded-md hover:bg-white border border-transparent hover:border-slate-100 transition-all cursor-pointer"
                                title="انتقال به ردیف پایین"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                          <td className="px-6 py-3.5 font-mono text-xs font-bold text-slate-500">{p.personalCode}</td>
                          <td className="px-6 py-3.5 font-bold text-slate-800">{p.firstName} {p.lastName}</td>
                          <td className="px-6 py-3.5 text-slate-600">
                            {p.jobGroup === 'assistant' ? (
                              <span className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded-md text-xs font-bold">کمک بهیار</span>
                            ) : (
                              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md text-xs font-bold">
                                {p.position === 'supervisor' ? 'سرپرستار' : (p.position === 'staff' ? 'استاف (Staff)' : 'کارشناس عمومی')}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-3.5">
                            {p.employmentType === 'official' && <span className="bg-sky-50 text-sky-700 text-xs px-2 py-0.5 rounded font-bold">رسمی</span>}
                            {p.employmentType === 'contract' && <span className="bg-purple-50 text-purple-700 text-xs px-2 py-0.5 rounded font-bold">قراردادی</span>}
                            {p.employmentType === 'conscript' && <span className="bg-amber-50 text-amber-700 text-xs px-2 py-0.5 rounded font-bold">طرح / وظیفه</span>}
                            {p.employmentType === 'overtime' && <span className="bg-pink-50 text-pink-700 text-xs px-2 py-0.5 rounded font-bold">اضافه‌کار</span>}
                          </td>
                          <td className="px-6 py-3.5 text-center font-mono text-slate-600">{p.experienceYears} سال</td>
                          <td className="px-6 py-3.5 text-center">
                            {p.canBeShiftLeader ? (
                              <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded text-xs font-bold flex items-center gap-1 w-max mx-auto"><Check className="w-3.5 h-3.5" /> بله (سرشیفت)</span>
                            ) : (
                              <span className="text-slate-400 font-bold text-xs">-</span>
                            )}
                          </td>
                          <td className="px-6 py-3.5 text-center">
                            {p.active ? (
                              <span className="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded-full font-bold">فعال</span>
                            ) : (
                              <span className="bg-slate-200 text-slate-500 text-[10px] px-2 py-0.5 rounded-full font-bold">غیرفعال</span>
                            )}
                          </td>
                          <td className="px-6 py-3.5 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <button
                                onClick={() => handleOpenEditPersonnel(p)}
                                className="text-sky-600 hover:text-sky-800 p-1 rounded-lg hover:bg-sky-50 transition-colors cursor-pointer"
                                title="ویرایش مشخصات"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteTarget({ id: p.id, type: 'personnel', label: `${p.firstName} ${p.lastName}` })}
                                className="text-red-500 hover:text-red-700 p-1 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                                title="حذف کلی"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'requests' && (
            <div className="space-y-6 animate-fadeIn">
              
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" /> سامانه دوگانه ثبت درخواست‌های مرخصی و آف
                  </h3>
                  <p className="text-slate-400 text-xs font-bold mt-0.5">ثبت ترجیحات زمانی و مرخصی جهت اعمال دقیق در الگوریتم هوشمند بهینه‌سازی شیفت کادر</p>
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                  {(role === 'admin' || role === 'headnurse') && (
                    <label className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 px-3.5 py-2 rounded-xl text-xs font-black text-slate-705 cursor-pointer transition-colors">
                      <input 
                        type="checkbox" 
                        checked={showSplitRequests}
                        onChange={(e) => setShowSplitRequests(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      نمایش تفکیکی درخواست‌ها
                    </label>
                  )}
                </div>
              </div>

              {/* BIFURCATED TWO-METHOD REGISTRATION DESIGNS */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                
                {/* METHOD A: CLASSIC STEP-BY-STEP MANUAL ENTRY CARD */}
                <div className="bg-white border border-slate-200/80 rounded-3xl p-6 shadow-sm flex flex-col justify-between hover:border-indigo-200 hover:shadow-md transition-all">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="bg-indigo-50 p-2.5 rounded-2xl">
                        <Plus className="w-5 h-5 text-indigo-600" />
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-slate-800">روش اول) ثبت گام‌به‌گام و دستی درخواست‌ها</h4>
                        <p className="text-[11px] text-slate-400 font-bold">فرم کلاسیک جهت تعریف آف، کشیک‌ها و مرخصی‌های تک‌به‌تک</p>
                      </div>
                    </div>

                    <div className="bg-slate-50 border border-slate-100 p-4 rounded-2xl space-y-2.5 text-xs text-slate-600 font-bold leading-relaxed">
                      <p className="text-indigo-900 font-black mb-1">💡 قابلیت‌های کلیدی پنل ثبت دستی:</p>
                      <div className="flex items-start gap-1.5">
                        <span className="text-indigo-500">•</span>
                        <span>تعیین دقیق دامنه تاریخ (روزهای زوج/فرد، تمام ماه یا روزهای انتخابی از تقویم)</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <span className="text-indigo-500">•</span>
                        <span><b>امکان ثبت چندگانه:</b> اضافه کردن نامحدود نوع کشیک به لیست موقت و سپس ثبت نهایی در یک نوبت</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <span className="text-indigo-500">•</span>
                        <span>تسهیل نمایش کلیه درخواست‌های کادر در یک خط مجزا و شکیل</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-6">
                    <button
                      onClick={() => {
                        setReqPersonnelId(role === 'personnel' && selectedPersonnelUser ? selectedPersonnelUser.id : personnel[0]?.id || '');
                        setReqType('shift');
                        setReqPreferredShift('M');
                        setReqIsEssential(false);
                        setReqScope('all');
                        setDraftRequests([]); // Reset draft list on open
                        setShowAddRequestModal(true);
                      }}
                      className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black py-3 rounded-2xl shadow-lg hover:shadow-indigo-500/10 transition-all cursor-pointer"
                      id="btn-trigger-add-req-bifurcated"
                    >
                      <Plus className="w-4 h-4"/> ایجاد و مدیریت درخواست‌های دستی کادر
                    </button>
                  </div>
                </div>

                {/* METHOD B: EXTREMELY ADVANCED AI DYNAMIC ENTRY CARD */}
                <div className="bg-gradient-to-br from-indigo-50/40 via-white to-purple-50/30 border border-purple-100 rounded-3xl p-6 shadow-xs flex flex-col justify-between hover:border-purple-200 hover:shadow-md transition-all relative overflow-hidden">
                  <div className="absolute top-0 left-0 bg-purple-500 text-white text-[9px] font-black px-3 py-1 rounded-br-2xl animate-pulse tracking-wider">
                    Powered by Gemini AI (Beta)
                  </div>
                  
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center gap-3">
                      <div className="bg-purple-50 p-2.5 rounded-2xl">
                        <Sparkles className="w-5 h-5 text-purple-600 fill-purple-100" />
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-slate-800">روش دوم) ثبت هوشمند نوشتاری با هوش مصنوعی</h4>
                        <p className="text-[11px] text-slate-400 font-bold">بدون نیاز به کار با دکمه‌ها! جملهٔ مد نظر خود را به فارسی بنویسید</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3">
                      {role !== 'personnel' ? (
                        <div>
                          <label className="block text-[11px] font-bold text-slate-500 mb-1">پرستار متقاضی:</label>
                          <select 
                            value={aiSelectedPersonnelId} 
                            onChange={(e) => setAiSelectedPersonnelId(e.target.value)}
                            className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3 py-2 focus:border-purple-500 focus:outline-none"
                          >
                            <option value="">-- انتخاب پرسنل متقاضی --</option>
                            {personnel.map(p => (
                              <option key={`ai-p-${p.id}`} value={p.id}>{p.firstName} {p.lastName} ({p.jobGroup === 'nurse' ? 'پرستار' : 'کمک بهیار'})</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="bg-emerald-50 text-emerald-800 border border-emerald-150 p-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center">
                          متقاضی: {selectedPersonnelUser?.firstName} {selectedPersonnelUser?.lastName}
                        </div>
                      )}
                      
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">درخواست خود را بنویسید:</label>
                        <textarea
                          value={aiPromptInput}
                          onChange={(e) => setAiPromptInput(e.target.value)}
                          placeholder="نمونه: دهم و دوازدهم آف باشم، ۱۵ام تا ۱۸ام مرخصی روزانه و ۲۰ام شیفت شب باشم و ۲۲ام شب و عصر (EN) نباشم"
                          className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-4 py-2 focus:border-purple-500 focus:outline-none min-h-[50px] h-[58px] resize-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 flex justify-end gap-2 text-xs">
                    {aiProposedRequests.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setAiProposedRequests([]);
                          setAiPromptInput('');
                        }}
                        className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-4 py-2.5 rounded-xl font-bold transition-all cursor-pointer"
                      >
                        پاک کردن نتایج
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isAiProcessing}
                      onClick={async () => {
                        const targetPId = role === 'personnel' && selectedPersonnelUser ? selectedPersonnelUser.id : aiSelectedPersonnelId;
                        if (!targetPId) {
                          alert("لطفاً ابتدا پرسنل مورد نظر را انتخاب کنید.");
                          return;
                        }
                        if (!aiPromptInput.trim()) {
                          alert("لطفاً ابتدا درخواست خود را بنویسید.");
                          return;
                        }
                        setIsAiProcessing(true);
                        setAiProposedRequests([]);
                        try {
                          const res = await fetch("/api/gemini/parse-requests", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              text: aiPromptInput,
                              year: currentYear,
                              month: currentMonth
                            })
                          });
                          if (!res.ok) {
                            const errData = await res.json();
                            throw new Error(errData.error || "خطا در برقراری ارتباط با سرور");
                          }
                          const data = await res.json();
                          const mapped = (data.requests || []).map((r: any, idx: number) => ({
                            ...r,
                            id: `ai_req_${Date.now()}_${idx}`,
                            personnelId: targetPId
                          }));
                          setAiProposedRequests(mapped);
                        } catch (err) {
                          console.error(err);
                          alert("خطا در پردازش هوش مصنوعی: " + (err instanceof Error ? err.message : String(err)));
                        } finally {
                          setIsAiProcessing(false);
                        }
                      }}
                      className="w-full flex items-center justify-center gap-1.5 bg-purple-700 hover:bg-purple-800 disabled:bg-purple-300 text-white text-xs font-bold py-3 px-5 rounded-2xl shadow-md transition-all cursor-pointer"
                    >
                      {isAiProcessing ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                          در حال پردازش هوشمند...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 text-amber-200 fill-amber-200" /> پردازش با هوش مصنوعی گوگل
                        </>
                      )}
                    </button>
                  </div>
                </div>

              </div>

              {/* AI Proposed List Confirmation BOX */}
              {aiProposedRequests.length > 0 && (
                <div className="bg-white border border-purple-100 p-5 rounded-3xl space-y-3 shadow-md animate-fadeIn">
                  <div className="flex items-center justify-between border-b pb-2 border-slate-105">
                    <span className="text-xs font-black text-purple-800 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-purple-600 fill-purple-200" /> نتایج استخراج شده هوشمند (نیاز به تایید شما):
                    </span>
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-mono font-bold">
                      {aiProposedRequests.length} مورد یافت شد
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[160px] overflow-y-auto p-1">
                    {aiProposedRequests.map((r, idx) => {
                      const targetPId = role === 'personnel' && selectedPersonnelUser ? selectedPersonnelUser.id : aiSelectedPersonnelId;
                      const p = personnel.find(per => per.id === targetPId) || selectedPersonnelUser;
                      return (
                        <div key={`ai-prop-${idx}`} className="flex items-center justify-between p-2 rounded-xl border border-slate-100 bg-purple-50/20 hover:bg-purple-50/40 text-xs">
                          <div className="flex items-center gap-2 font-bold text-slate-705">
                            <span className="px-1.5 py-0.5 rounded bg-purple-100 text-purple-705 text-[10px] font-mono">#{idx+1}</span>
                            <span>{getRequestSummaryText(r)}</span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-bold border border-slate-200 px-1.5 py-0.5 rounded bg-white">{p ? `${p.firstName} ${p.lastName}` : "پرسنل"}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-between pt-2 border-t border-slate-100 gap-2">
                    <p className="text-[10px] text-rose-500 font-extrabold">در صورت تایید، تغییرات مستقیماً در صف درخواست‌های این ماه پرستار ثبت خواهد شد.</p>
                    <button
                      type="button"
                      onClick={async () => {
                        const targetPId = role === 'personnel' && selectedPersonnelUser ? selectedPersonnelUser.id : aiSelectedPersonnelId;
                        if (!targetPId) {
                          alert("لطفاً ابتدا پرسنل مورد نظر را انتخاب کنید.");
                          return;
                        }
                        try {
                          const newRequests = aiProposedRequests.map(item => ({
                            ...item,
                            id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                            personnelId: targetPId
                          }));

                          let updatedR = [...requests];
                          for (const reqData of newRequests) {
                            updatedR.push(reqData);
                          }

                          await saveState(personnel, updatedR, settings, customHolidays, undefined, {
                            mode: 'refresh_personnel',
                            personnelIds: [targetPId]
                          });
                          alert("درخواست‌های هوشمند با موفقیت ثبت شدند!");
                          setAiProposedRequests([]);
                          setAiPromptInput('');
                        } catch (e) {
                          console.error(e);
                          alert("خطا در ذخیره‌سازی درخواست هوشمند: " + (e instanceof Error ? e.message : String(e)));
                        }
                      }}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black px-4 py-2.5 rounded-xl shadow cursor-pointer transition-colors"
                    >
                      ✓ تایید نهایی و اضافه کردن به سامانه
                    </button>
                  </div>
                </div>
              )}

              {/* Requests Registry Table */}
              <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-right border-collapse min-w-[900px]">
                    <thead className="bg-slate-50 border-b border-slate-205">
                      <tr>
                        <th className="px-6 py-4 text-xs font-black text-slate-500 w-1/4">متقاضی (پرستار / بهیار)</th>
                        {showSplitRequests || role === 'personnel' ? (
                          <>
                            <th className="px-6 py-4 text-xs font-black text-slate-500">نوع درخواست</th>
                            <th className="px-6 py-4 text-xs font-black text-slate-500">شیفت ترجیحی / الگو</th>
                            <th className="px-6 py-4 text-xs font-black text-slate-500">بازه زمانی / روزها</th>
                          </>
                        ) : (
                          <th className="px-6 py-4 text-xs font-black text-slate-500 w-1/2">مجموعه درخواست‌های ارسالی این ماه</th>
                        )}
                        <th className="px-6 py-4 text-xs font-black text-slate-500 text-center w-36">نوع اولویت</th>
                        <th className="px-6 py-4 text-xs font-black text-slate-500 text-center w-28">عملیات</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {/* 1. Grouped View Mode */}
                      {!showSplitRequests && role !== 'personnel' ? (
                        (() => {
                          const groupedPIds = Array.from(new Set(requests.map(r => r.personnelId)));
                          if (groupedPIds.length === 0) {
                            return (
                              <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 font-bold">
                                  هیچ درخواستی برای این ماه ثبت نشده است.
                                </td>
                              </tr>
                            );
                          }
                          return groupedPIds.map(pid => {
                            const p = personnel.find(per => per.id === pid);
                            if (!p) return null;
                            const pReqs = requests.filter(r => r.personnelId === pid);
                            const hasEssential = pReqs.some(r => r.isEssential);

                            return (
                              <tr key={`group-row-${pid}`} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-6 py-4">
                                  <span className="font-extrabold text-slate-800">{p.firstName} {p.lastName}</span>
                                  <span className="text-xs text-slate-400 block mt-0.5">کد پرسنلی: {p.personalCode} ({p.jobGroup === 'nurse' ? 'پرستار' : 'کمک بهیار'})</span>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex flex-wrap gap-1.5 max-w-xl">
                                    {pReqs.map((r, idx) => (
                                      <span key={`pReq-${r.id}`} className="text-[10px] bg-slate-50 border border-slate-150 text-slate-705 font-black px-2 py-1 rounded-xl shadow-2xs flex items-center gap-1">
                                        {getRequestSummaryText(r)}
                                      </span>
                                    ))}
                                    <span className="bg-indigo-50 text-indigo-700 text-[10px] px-2.5 py-1 rounded-xl font-bold">مجموعاً {pReqs.length} درخواست</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  {hasEssential ? (
                                    <span className="bg-red-50 text-red-700 border border-red-200 font-black text-[10px] px-3 py-1 rounded-full">دارای اولویت بالا ★</span>
                                  ) : (
                                    <span className="bg-slate-100 text-slate-600 font-bold text-[10px] px-3 py-1 rounded-full">عادی</span>
                                  )}
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <button
                                      onClick={() => {
                                        // Open split requests mode so they can edit or toggle individually
                                        setShowSplitRequests(true);
                                      }}
                                      className="text-indigo-600 hover:bg-indigo-50 border border-indigo-100 bg-white text-xs font-bold px-2.5 py-1.5 rounded-xl transition-all cursor-pointer"
                                      title="مشاهده تفکیکی"
                                    >
                                      مشاهده و افراز
                                    </button>
                                    <button
                                      onClick={() => handleDeleteAllPersonRequests(pid, `${p.firstName} ${p.lastName}`)}
                                      className="text-red-500 hover:text-red-700 bg-white border border-red-100 hover:bg-red-50 p-1.5 rounded-xl transition-all cursor-pointer"
                                      title="حذف کلیه درخواست‌ها"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          });
                        })()
                      ) : (
                        // 2. Split View (Individual Rows) Mode
                        (() => {
                          const filteredRequests = requests.filter(r => {
                            if (role === 'personnel' && selectedPersonnelUser) {
                              return r.personnelId === selectedPersonnelUser.id;
                            }
                            return true;
                          });

                          if (filteredRequests.length === 0) {
                            return (
                              <tr>
                                <td colSpan={6} className="px-6 py-12 text-center text-slate-400 font-bold">
                                  هیچ درخواستی برای این ماه ثبت نشده است.
                                </td>
                              </tr>
                            );
                          }

                          // If personnel mode, is it grouped in one line anyway?
                          // Yes! "همه ی درخواست در قالب یک خط در صفحه ی درخواستها دیده شود"
                          if (role === 'personnel' && selectedPersonnelUser) {
                            const p = selectedPersonnelUser;
                            const pReqs = filteredRequests;
                            const hasEssential = pReqs.some(r => r.isEssential);
                            return (
                              <tr className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-6 py-4">
                                  <span className="font-extrabold text-slate-800">{p.firstName} {p.lastName}</span>
                                  <span className="text-xs text-slate-400 block mt-0.5">کد پرسنلی: {p.personalCode}</span>
                                </td>
                                <td colSpan={3} className="px-6 py-4">
                                  <div className="flex flex-wrap gap-1.5">
                                    {pReqs.map((r) => (
                                      <span key={`pReq-pers-${r.id}`} className="text-[10px] bg-slate-50 border border-slate-150 text-slate-705 font-black px-2 py-1 rounded-xl flex items-center gap-1 shadow-2xs">
                                        {getRequestSummaryText(r)}
                                      </span>
                                    ))}
                                    <span className="bg-indigo-50 text-indigo-700 text-[10px] px-2.5 py-1 rounded-xl font-bold">مجموعاً {pReqs.length} درخواست ثبت‌شده شما</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <span className="bg-slate-100 text-slate-600 font-bold text-[10px] px-3 py-1 rounded-full">عادی (مدیریت توسط سرپرستار)</span>
                                </td>
                                <td className="px-6 py-4 text-center">
                                  <button
                                    onClick={() => handleDeleteAllPersonRequests(p.id, "درخواست‌های ثبت‌شده تان")}
                                    className="text-red-500 hover:text-red-700 bg-red-50/50 hover:bg-red-50 border border-red-100 p-1.5 rounded-xl transition-all cursor-pointer inline-flex items-center gap-1 font-bold text-xs px-2.5 py-1.5"
                                    title="حذف کلیه درخواست‌ها"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" /> حذف همه
                                  </button>
                                </td>
                              </tr>
                            );
                          }

                          return filteredRequests.map(r => {
                            const p = personnel.find(per => per.id === r.personnelId);
                            if (!p) return null;

                            return (
                              <tr key={r.id} className="hover:bg-slate-50/50 transition-colors animate-fadeIn">
                                <td className="px-6 py-3.5">
                                  <span className="font-extrabold text-slate-800">{p.firstName} {p.lastName}</span>
                                  <span className="text-xs text-slate-400 block mt-0.5">{p.personalCode}</span>
                                </td>
                                <td className="px-6 py-3.5 text-slate-600">
                                  {r.requestType === 'shift' && <span className="bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded text-xs">تعیین شیفت</span>}
                                  {r.requestType === 'avoid_shift' && <span className="bg-rose-50 text-rose-700 border border-rose-100 font-bold px-2 py-0.5 rounded text-xs">نبودن در شیفت</span>}
                                  {r.requestType === 'OFF' && <span className="bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded text-xs">آف قطعی (OFF)</span>}
                                  {r.requestType === 'leave' && <span className="bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded text-xs">درخواست مرخصی</span>}
                                </td>
                                <td className="px-6 py-3.5 font-semibold text-slate-700">
                                  {r.requestType === 'avoid_shift' ? (
                                    <span className="text-rose-600 font-bold">شیفت {
                                      r.preferredShift === 'M' ? 'صبح' :
                                      r.preferredShift === 'E' ? 'عصر' :
                                      r.preferredShift === 'N' ? 'شب' :
                                      r.preferredShift === 'ME' ? 'عصر-صبح' :
                                      r.preferredShift === 'EN' ? 'شب-عصر' : r.preferredShift
                                    } نباشم</span>
                                  ) : (
                                    r.preferredShift === 'M' ? 'صبح' :
                                    r.preferredShift === 'E' ? 'عصر' :
                                    r.preferredShift === 'N' ? 'شب' :
                                    r.preferredShift === 'ME' ? 'عصر-صبح (ME)' :
                                    r.preferredShift === 'EN' ? 'شب-عصر (EN)' :
                                    r.preferredShift === 'MN' ? 'شب-صبح (MN)' :
                                    r.preferredShift === 'MEN' ? 'ترکیبی کل روز (MEN)' :
                                    r.preferredShift === 'OFF' ? 'آف' :
                                    r.preferredShift === 'L' ? 'مرخصی روزانه' : r.preferredShift
                                  )}
                                </td>
                                <td className="px-6 py-3.5 text-slate-600 text-xs font-bold text-slate-500">
                                  {r.scope === 'all' && 'تمام روزهای ماه'}
                                  {r.scope === 'even' && 'تاریخ زوج ماه'}
                                  {r.scope === 'odd' && 'تاریخ فرد ماه'}
                                  {r.scope === 'weekly_even' && 'روزهای زوج هفته (شنبه، دوشنبه، چهارشنبه)'}
                                  {r.scope === 'weekly_odd' && 'روزهای فرد هفته (یک‌شنبه، سه‌شنبه، پنج‌شنبه)'}
                                  {r.scope === 'range' && `از ${r.startDate} تا ${r.endDate}`}
                                  {r.scope === 'custom_days' && `روزهای انتخابی: ${r.selectedDays?.join('، ')}`}
                                </td>
                                <td className="px-6 py-3.5 text-center">
                                  {(role === 'admin' || role === 'headnurse') ? (
                                    <button
                                      onClick={async () => {
                                        const updatedReq = { ...r, isEssential: !r.isEssential };
                                        const updatedList = requests.map(item => item.id === r.id ? updatedReq : item);
                                        await saveState(personnel, updatedList, settings, customHolidays, undefined, {
                                          mode: 'refresh_personnel',
                                          personnelIds: [r.personnelId]
                                        });
                                      }}
                                      className={`px-3 py-1.5 rounded-full text-[10px] font-black transition-all border cursor-pointer ${
                                        r.isEssential 
                                          ? 'bg-red-500 text-white border-red-500 hover:bg-red-650 shadow-xs' 
                                          : 'bg-slate-50 text-slate-500 border-slate-205 hover:bg-slate-100'
                                      }`}
                                    >
                                      {r.isEssential ? '★ ضروری (اولویت بالا)' : '☆ عادی'}
                                    </button>
                                  ) : (
                                    r.isEssential ? (
                                      <span className="bg-red-50 text-red-700 border border-red-200 font-extrabold text-[10px] px-3 py-1 rounded-full">ضروری</span>
                                    ) : (
                                      <span className="bg-slate-150 text-slate-600 font-bold text-[10px] px-3 py-1 rounded-full">عادی</span>
                                    )
                                  )}
                                </td>
                                <td className="px-6 py-3.5 text-center flex items-center justify-center gap-1">
                                  <button
                                    onClick={() => {
                                      setEditingRequest(r);
                                      setReqPersonnelId(r.personnelId);
                                      setReqType(r.requestType);
                                      if (r.requestType === 'shift' || r.requestType === 'avoid_shift') {
                                        setReqPreferredShift(r.preferredShift as any || 'M');
                                      }
                                      setReqPatternInput(r.patternSteps ? r.patternSteps.join(' ') : 'EN OFF OFF');
                                      setReqIsEssential(r.isEssential || false);
                                      setReqScope(r.scope || 'all');
                                      if (r.startDate) setReqStartDate(r.startDate);
                                      if (r.endDate) setReqEndDate(r.endDate);
                                      setReqSelectedDays(r.selectedDays || []);
                                      setShowAddRequestModal(true);
                                    }}
                                    className="text-blue-500 hover:text-blue-700 p-1.5 rounded-lg hover:bg-blue-50 transition-colors cursor-pointer"
                                    title="ویرایش درخواست"
                                  ><Settings2 className="w-4 h-4" /></button>
                                  <button
                                    onClick={() => setDeleteTarget({ 
                                      id: r.id, 
                                      type: 'request', 
                                      label: `درخواست ${r.requestType === 'shift' ? 'تعیین شیفت' : r.requestType === 'OFF' ? 'آف' : r.requestType === 'leave' ? 'مرخصی' : 'سایر'} پرسنل ${p.firstName} ${p.lastName}` 
                                    })}
                                    className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                                    title="حذف درخواست"
                                    id={`btn-delete-req-${r.id}`}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            );
                          });
                        })()
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* --- VIEW 4: PERFORMANCE REPORTS PANEL --- */}
          {activeTab === 'reports' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-black text-slate-800">کارنامه خلاصه کارکرد و فیش ساعت‌کاری کل پرسنل</h3>
                  <p className="text-xs text-slate-400 mt-1 font-semibold">محاسبات عادلانه بر پایه ساعت موظفی ماهانه، با فاکتورگیری سنوات، بهره‌وری و کسر شیفت</p>
                </div>
                
                <div className="flex gap-2">
                  <button onClick={exportToExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer">
                    <FileSpreadsheet className="w-4 h-4"/> دریافت اکسل جامع گزارشات
                  </button>
                  <button onClick={handlePrint} className="bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer">
                    <Printer className="w-4 h-4"/> چاپ کارنامه‌ها
                  </button>
                </div>
              </div>

              {/* Statistics Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                
                {/* Total Worked card */}
                <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg p-5 rounded-2xl border border-indigo-200">
                  <div className="flex justify-between items-start">
                    <span className="text-indigo-100 font-bold text-xs">مجموع ساعت ارائه خدمات</span>
                    <Clock className="w-5 h-5 text-indigo-200"/>
                  </div>
                  <div className="text-2xl font-black mt-2 font-mono">
                    {reports.reduce((acc, curr) => acc + curr.workedHours, 0).toFixed(1)} <span className="text-xs font-normal">ساعت</span>
                  </div>
                </div>

                {/* Total Overtime card */}
                <div className="bg-white border border-slate-200 shadow-sm p-5 rounded-2xl">
                  <div className="flex justify-between items-start">
                    <span className="text-slate-400 font-bold text-xs">مجموع اضافه‌کار انباشته</span>
                    <Sparkles className="w-5 h-5 text-emerald-500"/>
                  </div>
                  <div className="text-2xl font-black mt-2 text-slate-800 font-mono">
                    {reports.reduce((acc, curr) => acc + curr.overtimeHours, 0).toFixed(1)} <span className="text-xs font-normal text-slate-400">ساعت</span>
                  </div>
                </div>

                {/* Eligible productivity counter */}
                <div className="bg-white border border-slate-200 shadow-sm p-5 rounded-2xl">
                  <div className="flex justify-between items-start">
                    <span className="text-slate-400 font-bold text-xs">تعداد واجدین بهره‌وری بخش</span>
                    <Award className="w-5 h-5 text-indigo-500"/>
                  </div>
                  <div className="text-2xl font-black mt-2 text-slate-800 font-mono">
                    {reports.filter(r => r.productivityEligible).length} <span className="text-xs font-normal text-slate-400">نفر</span>
                  </div>
                </div>

                {/* Total productivity hours */}
                <div className="bg-white border border-slate-200 shadow-sm p-5 rounded-2xl">
                  <div className="flex justify-between items-start">
                    <span className="text-slate-400 font-bold text-xs">ساعت و امتیاز بهره‌وری</span>
                    <Activity className="w-5 h-5 text-purple-500" />
                  </div>
                  <div className="text-2xl font-black mt-2 text-slate-800 font-mono">
                    {reports.reduce((acc, curr) => acc + curr.productivityHours, 0).toFixed(1)} <span className="text-xs font-normal text-slate-400 text-slate-400">ساعت</span>
                  </div>
                </div>

              </div>

              {/* Comprehensive performance table */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden" id="reports-table-container">
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-right border-collapse min-w-[900px]">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 text-xs font-black text-slate-500">مشخصات پرسنل</th>
                        <th className="px-6 py-4 text-xs font-black text-slate-500 text-center">موظفی تفکیکی</th>
                        <th className="px-6 py-4 text-xs font-black text-slate-500 text-center">ساعت کارکرد</th>
                        <th className="px-6 py-4 text-xs font-black text-slate-500 text-center">اضافه‌کار رسمی</th>
                        <th className="px-6 py-4 text-xs font-black text-slate-500 text-center">کسری شیفت</th>
                        <th className="px-2 py-4 text-xs font-black text-slate-500 text-center w-24">بهره‌وری (ساعت)</th>
                        <th className="px-2 py-4 text-xs font-black text-slate-500 text-center w-24">مزایای سنوات</th>
                        <th className="px-6 py-4 text-xs font-black text-slate-500 text-center">وضعیت بهره‌وری</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {reports.map(r => (
                        <tr key={r.personnelId} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4">
                            <span className="font-extrabold text-slate-800 leading-none">{r.name}</span>
                            <div className="flex gap-2 text-[10px] text-slate-400 mt-1 font-semibold">
                              <span>{r.positionText}</span>
                              <span>•</span>
                              <span>{r.employmentTypeText}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center font-mono font-bold text-slate-500">{r.dutyHours} ساعت</td>
                          <td className="px-6 py-4 text-center font-mono font-extrabold text-indigo-700">{r.workedHours}h</td>
                          <td className="px-6 py-4 text-center font-mono">
                            {r.overtimeHours > 0 ? (
                              <span className="text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg font-extrabold">+{r.overtimeHours}h</span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center font-mono">
                            {r.deficitHours > 0 ? (
                              <span className="text-red-600 bg-red-50 px-2.5 py-1 rounded-lg font-extrabold">-{r.deficitHours}h</span>
                            ) : (
                              <span className="text-slate-300">-</span>
                            )}
                          </td>
                          <td className="px-2 py-4 text-center font-mono font-bold text-purple-700">{r.productivityHours}h</td>
                          <td className="px-2 py-4 text-center font-mono font-bold text-slate-600">{r.experienceHours}h</td>
                          <td className="px-6 py-4 text-center">
                            {r.productivityEligible ? (
                              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded text-[11px] font-extrabold inline-block">مشمول قانون کادر</span>
                            ) : (
                              <span className="text-slate-400 bg-slate-100 px-2 py-0.5 rounded text-[11px] font-bold inline-block">غیرمشمول (حداقل کارکرد)</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* --- VIEW 5: SYSTEM DEMAND & CONFIGURATION --- */}
          {activeTab === 'settings' && role === 'admin' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              
              {/* Left Column: Duty Hours and staffing demand */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
                <h3 className="text-lg font-black text-slate-900 border-b pb-3 border-slate-100">ساعات موظفی پایه و پیکربندی بر اساس قوانین</h3>
                
                <form onSubmit={handleSaveSettings} className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">موظفی کادر رسمی (ساعت)</label>
                      <input 
                        type="number" 
                        value={settings.dutyHours.official}
                        onChange={(e) => setSettings({
                          ...settings,
                          dutyHours: { ...settings.dutyHours, official: Number(e.target.value) }
                        })}
                        className="w-full text-sm font-extrabold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">موظفی قراردادی (ساعت)</label>
                      <input 
                        type="number" 
                        value={settings.dutyHours.contract}
                        onChange={(e) => setSettings({
                          ...settings,
                          dutyHours: { ...settings.dutyHours, contract: Number(e.target.value) }
                        })}
                        className="w-full text-sm font-extrabold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">موظفی طرح و وظیفه (ساعت)</label>
                      <input 
                        type="number" 
                        value={settings.dutyHours.conscript}
                        onChange={(e) => setSettings({
                          ...settings,
                          dutyHours: { ...settings.dutyHours, conscript: Number(e.target.value) }
                        })}
                        className="w-full text-sm font-extrabold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">حداکثر سقف اضافه‌کار (ساعت)</label>
                      <input 
                        type="number" 
                        value={settings.dutyHours.overtime}
                        onChange={(e) => setSettings({
                          ...settings,
                          dutyHours: { ...settings.dutyHours, overtime: Number(e.target.value) }
                        })}
                        className="w-full text-sm font-extrabold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <h4 className="font-extrabold text-slate-800 text-sm mt-6 mb-2">حد نیازمندی پوشش نیرو در ایام هفته (روزهای عادی):</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 border border-slate-100 p-3 rounded-2xl bg-slate-50/20">
                      <span className="text-xs font-black text-slate-700 block border-b pb-1">پرستاران (منشی/سرپرستار/عمومی):</span>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[9px] font-extrabold text-slate-500 mb-1">صبح (M)</label>
                          <input 
                            type="number" 
                            value={settings.demand.weekday.morningNurse}
                            onChange={(e) => setSettings({
                              ...settings,
                              demand: {
                                ...settings.demand,
                                weekday: { ...settings.demand.weekday, morningNurse: Number(e.target.value) }
                              }
                            })}
                            className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-extrabold text-slate-500 mb-1">عصر (E)</label>
                          <input 
                            type="number" 
                            value={settings.demand.weekday.afternoonNurse}
                            onChange={(e) => setSettings({
                              ...settings,
                              demand: {
                                ...settings.demand,
                                weekday: { ...settings.demand.weekday, afternoonNurse: Number(e.target.value) }
                              }
                            })}
                            className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-extrabold text-slate-500 mb-1">شب (N)</label>
                          <input 
                            type="number" 
                            value={settings.demand.weekday.nightNurse}
                            onChange={(e) => setSettings({
                              ...settings,
                              demand: {
                                ...settings.demand,
                                weekday: { ...settings.demand.weekday, nightNurse: Number(e.target.value) }
                              }
                            })}
                            className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 border border-slate-100 p-3 rounded-2xl bg-slate-50/20">
                      <span className="text-xs font-black text-slate-700 block border-b pb-1">کمک پرستاران / کمک‌بهیاران:</span>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[9px] font-extrabold text-slate-500 mb-1">صبح (M)</label>
                          <input 
                            type="number" 
                            value={settings.demand.weekday.morningAssistant}
                            onChange={(e) => setSettings({
                              ...settings,
                              demand: {
                                ...settings.demand,
                                weekday: { ...settings.demand.weekday, morningAssistant: Number(e.target.value) }
                              }
                            })}
                            className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-extrabold text-slate-500 mb-1">عصر (E)</label>
                          <input 
                            type="number" 
                            value={settings.demand.weekday.afternoonAssistant}
                            onChange={(e) => setSettings({
                              ...settings,
                              demand: {
                                ...settings.demand,
                                weekday: { ...settings.demand.weekday, afternoonAssistant: Number(e.target.value) }
                              }
                            })}
                            className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-extrabold text-slate-500 mb-1">شب (N)</label>
                          <input 
                            type="number" 
                            value={settings.demand.weekday.nightAssistant}
                            onChange={(e) => setSettings({
                              ...settings,
                              demand: {
                                ...settings.demand,
                                weekday: { ...settings.demand.weekday, nightAssistant: Number(e.target.value) }
                              }
                            })}
                            className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <h4 className="font-extrabold text-slate-800 text-sm mt-6 mb-2">حد نیازمندی پوشش در ایام تعطیل (جمعه‌ها و مناسبت‌ها):</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2 border border-slate-100 p-3 rounded-2xl bg-slate-50/20">
                      <span className="text-xs font-black text-slate-700 block border-b pb-1">پرستاران (منشی/سرپرستار/عمومی):</span>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[9px] font-extrabold text-slate-500 mb-1">صبح (M)</label>
                          <input 
                            type="number" 
                            value={settings.demand.holiday.morningNurse}
                            onChange={(e) => setSettings({
                              ...settings,
                              demand: {
                                ...settings.demand,
                                holiday: { ...settings.demand.holiday, morningNurse: Number(e.target.value) }
                              }
                            })}
                            className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-extrabold text-slate-500 mb-1">عصر (E)</label>
                          <input 
                            type="number" 
                            value={settings.demand.holiday.afternoonNurse}
                            onChange={(e) => setSettings({
                              ...settings,
                              demand: {
                                ...settings.demand,
                                holiday: { ...settings.demand.holiday, afternoonNurse: Number(e.target.value) }
                              }
                            })}
                            className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-extrabold text-slate-500 mb-1">شب (N)</label>
                          <input 
                            type="number" 
                            value={settings.demand.holiday.nightNurse}
                            onChange={(e) => setSettings({
                              ...settings,
                              demand: {
                                ...settings.demand,
                                holiday: { ...settings.demand.holiday, nightNurse: Number(e.target.value) }
                              }
                            })}
                            className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 border border-slate-100 p-3 rounded-2xl bg-slate-50/20">
                      <span className="text-xs font-black text-slate-700 block border-b pb-1">کمک پرستاران / کمک‌بهیاران:</span>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="block text-[9px] font-extrabold text-slate-500 mb-1">صبح (M)</label>
                          <input 
                            type="number" 
                            value={settings.demand.holiday.morningAssistant}
                            onChange={(e) => setSettings({
                              ...settings,
                              demand: {
                                ...settings.demand,
                                holiday: { ...settings.demand.holiday, morningAssistant: Number(e.target.value) }
                              }
                            })}
                            className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-extrabold text-slate-500 mb-1">عصر (E)</label>
                          <input 
                            type="number" 
                            value={settings.demand.holiday.afternoonAssistant}
                            onChange={(e) => setSettings({
                              ...settings,
                              demand: {
                                ...settings.demand,
                                holiday: { ...settings.demand.holiday, afternoonAssistant: Number(e.target.value) }
                              }
                            })}
                            className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-extrabold text-slate-500 mb-1">شب (N)</label>
                          <input 
                            type="number" 
                            value={settings.demand.holiday.nightAssistant}
                            onChange={(e) => setSettings({
                              ...settings,
                              demand: {
                                ...settings.demand,
                                holiday: { ...settings.demand.holiday, nightAssistant: Number(e.target.value) }
                              }
                            })}
                            className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs py-3 rounded-xl shadow-lg transition-colors cursor-pointer"
                    id="btn-save-settings"
                  >
                    ذخیره پیکربندی تعهدات و پوشش
                  </button>
                </form>
              </div>

              {/* Right Column: Holiday Management & Calendar define */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
                <div>
                  <h3 className="text-lg font-black text-slate-900 border-b pb-3 border-slate-100">تعریف تقویم و مناسبت‌های تعطیل انتخابی</h3>
                  <p className="text-xs text-slate-400 mt-1 font-semibold">جمعه‌ها به طور خودکار تعطیل هستند. در این بخش می‌توانید تعطیلات مذهبی یا ملی اضافی ماه را تعریف کنید.</p>
                </div>

                <form onSubmit={handleAddHoliday} className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">روز چندم ماه؟</label>
                    <input 
                      type="number" 
                      min="1" 
                      max="31"
                      value={holidayDayInput}
                      onChange={(e) => setHolidayDayInput(Number(e.target.value))}
                      className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">عنوان مناسبت تعطیل</label>
                    <input 
                      type="text" 
                      placeholder="مثلاً: عاشورای حسینی"
                      value={holidayTitleInput}
                      onChange={(e) => setHolidayTitleInput(e.target.value)}
                      className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="submit"
                      className="w-full bg-slate-800 hover:bg-slate-900 text-white font-extrabold text-xs py-2.5 rounded-xl flex items-center justify-center gap-1 cursor-pointer"
                      id="btn-add-holiday"
                    >
                      <Plus className="w-4 h-4"/> افزودن به تقویم
                    </button>
                  </div>
                </form>

                {/* Holiday registry list */}
                <div className="space-y-2">
                  <h4 className="font-extrabold text-slate-800 text-xs">تعطیلات ثبت شده اضافه در آبان/آذر/خرداد:</h4>
                  <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden text-xs">
                    {Object.keys(customHolidays).length === 0 ? (
                      <div className="p-4 text-center text-slate-400">هیچ مورد تعطیل دیگری در این ماه ثبت نشده است.</div>
                    ) : (
                      Object.keys(customHolidays).map(d => {
                        const dayNum = Number(d);
                        return (
                          <div key={dayNum} className="p-3 bg-slate-50/50 flex justify-between items-center hover:bg-slate-100/50 transition-colors">
                            <span className="font-bold text-slate-800 font-mono">روز {dayNum} {JALALI_MONTH_NAMES[currentMonth - 1]}: <span className="text-rose-600 mr-2">{customHolidays[dayNum]}</span></span>
                            <button 
                              onClick={() => handleRemoveHoliday(dayNum)}
                              className="text-red-500 hover:text-red-700 bg-white p-1 rounded-lg shadow-sm border border-slate-200 cursor-pointer"
                              id={`btn-remove-holiday-${dayNum}`}
                            >
                              حذف
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* SELECT DAY ONCE FOR 1ST DAY OF MONTH */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mt-4 space-y-3">
                  <div>
                    <h4 className="text-xs font-black text-slate-800">روز ۱ام ماه چندشنبه است؟</h4>
                    <p className="text-[10px] text-slate-400 mt-1">با تعیین این فیلد، روزهای هفته در تقویم بر لایه‌ی محاسباتی جدید قرار خواهند گرفت و توزیع شیفت‌ها و جمعه‌ها تصحیح می‌شود.</p>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 text-center font-bold">
                    {WEEKDAYS.map((w, idx) => {
                      const mathDefault = getJalaliWeekday(currentYear, currentMonth, 1);
                      const isSelected = firstDayOfWeekIndex !== undefined 
                        ? firstDayOfWeekIndex === idx 
                        : mathDefault === idx;

                      return (
                        <button
                          type="button"
                          key={`start-day-${idx}`}
                          onClick={() => {
                            setFirstDayOfWeekIndex(idx);
                            if (typeof window !== 'undefined') {
                              localStorage.setItem(`hospital_first_day_of_week_index_${currentYear}_${currentMonth}`, String(idx));
                              localStorage.setItem('hospital_first_day_of_week_index', String(idx));
                            }
                            saveState(personnel, requests, settings, customHolidays, idx, { mode: 'full_resolve' });
                          }}
                          className={`px-2 py-1.5 rounded-xl border text-[10px] font-extrabold cursor-pointer transition-all ${
                            isSelected 
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' 
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {w}
                          {mathDefault === idx && <span className="block text-[8px] opacity-75 font-normal">(پیش‌فرض)</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ON-CLICK CALENDAR TOGGLE GRID */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mt-4 space-y-3">
                  <div>
                    <h4 className="text-xs font-black text-slate-800 font-sans">تقویم تعاملی {JALALI_MONTH_NAMES[currentMonth - 1]} (کلیک جهت تعیین تعطیلی):</h4>
                    <p className="text-[10px] text-slate-400 mt-1">بر روی هر یک از خانه‌های تقویم زیر کلیک کنید تا وضعیت آن روز بین «کاری» و «تعطیل» سوئیچ شود.</p>
                  </div>
                  
                  <div className="grid grid-cols-7 gap-1 text-center font-extrabold text-[9px]">
                    {WEEKDAYS.map(w => (
                      <div key={w} className="py-1 text-slate-400 font-extrabold text-[9px]">{w[0]}</div>
                    ))}
                    
                    {Array.from({ length: calendarDays[0]?.dayOfWeek || 0 }).map((_, i) => (
                      <div key={`pad-${i}`} className="p-2 bg-slate-100/20 rounded-lg text-transparent text-[10px]">-</div>
                    ))}

                    {calendarDays.map(d => {
                      const isCustomHoliday = !!customHolidays[d.day];
                      const isFriday = d.dayOfWeek === 6;
                      const isRed = isFriday || isCustomHoliday;
                      
                      return (
                        <button
                          type="button"
                          key={`day-btn-${d.day}`}
                          onClick={() => {
                            const updated = { ...customHolidays };
                            if (updated[d.day]) {
                              delete updated[d.day];
                            } else {
                              updated[d.day] = 'تعطیل کاربری با یک کلیک';
                            }
                            setCustomHolidays(updated);
                            saveState(personnel, requests, settings, updated, undefined, { mode: 'full_resolve' });
                          }}
                          className={`p-1 rounded-lg border text-[10px] font-black transition-all cursor-pointer flex flex-col items-center justify-center min-h-[38px] ${
                            isRed 
                              ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100/50 hover:border-rose-300' 
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                          }`}
                        >
                          <span className="font-mono text-xs">{d.day}</span>
                          <span className="text-[7px] leading-none opacity-80 mt-0.5">
                            {isFriday ? 'جمعه' : isCustomHoliday ? 'تعطیل' : 'کاری'}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-4 border-t border-slate-200 text-center">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const activeFd = firstDayOfWeekIndex !== undefined ? firstDayOfWeekIndex : -1;
                          let dutyToSave = { ...settings.dutyHours };
                          if (settings.autoCalculateDutyHours) {
                            const isLeapYearVal = [1, 5, 9, 13, 17, 22, 26, 30].includes(currentYear % 33);
                            const daysInMonth = currentMonth <= 6 ? 31 : (currentMonth === 12 && !isLeapYearVal ? 29 : 30);
                            const mathDefault = getJalaliWeekday(currentYear, currentMonth, 1);
                            const activeFirstDayIndex = activeFd !== -1 ? activeFd : mathDefault;
                            
                            let liveCalendarDays = [];
                            for (let d = 1; d <= daysInMonth; d++) {
                              const calculatedDayOfWeek = (activeFirstDayIndex + ((d - 1) % 7)) % 7;
                              const isFriday = calculatedDayOfWeek === 6;
                              const isCustomHoliday = !!customHolidays[d];
                              liveCalendarDays.push({ day: d, isHoliday: isFriday || isCustomHoliday, dayOfWeek: calculatedDayOfWeek });
                            }
                            const nonFridayHolidaysCount_val = liveCalendarDays.filter(d => d.dayOfWeek !== 6 && d.isHoliday).length;
                            const X_val = daysInMonth - nonFridayHolidaysCount_val - (liveCalendarDays.filter(d => d.dayOfWeek === 6).length);
                            const thursdaysNonHolidayCount_val = liveCalendarDays.filter(d => d.dayOfWeek === 5 && !d.isHoliday).length;
                            const Y_val = thursdaysNonHolidayCount_val * 2;
                            const z_calc = (X_val * 7) - Y_val;
                            const contract_calc = z_calc + 14;
                            dutyToSave.official = z_calc;
                            dutyToSave.contract = contract_calc;
                          }

                          const nextDb = getFreshDbCopy();
                          if (!nextDb.deptData) nextDb.deptData = {};
                          
                          const deptId = selectedDepartmentId || 'sepehr';
                          const oldDept = nextDb.deptData[deptId] || {
                            personnel: [],
                            requests: [],
                            settings_system: INITIAL_SETTINGS,
                            settings_credentials: { username: 'headnurse', password: '123456' },
                            holidays: {},
                            firstDayOfWeek: {},
                            schedules: {},
                          };

                          const updatedDept = {
                            ...oldDept,
                            holidays: {
                              ...oldDept.holidays,
                              [`${currentYear}_${currentMonth}`]: {
                                days: customHolidays,
                                monthlyDutyHours: dutyToSave
                              }
                            }
                          };

                          nextDb.deptData[deptId] = updatedDept;
                          await saveDbState(nextDb);

                          setMonthlyDutyHours(dutyToSave);
                          alert('ساعت موظفی این ماه بر اساس تقویم و تنظیمات نهایی شد و در داشبورد پرسنل برای همین ماه نمایش داده خواهد شد.');
                        } catch (e) {
                          alert('خطا در ثبت نهایی موظفی این ماه: ' + e);
                        }
                      }}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs px-4 py-3 rounded-xl transition-all shadow-sm cursor-pointer border border-indigo-700 font-sans"
                    >
                      تصویب نهایی ساعت موظفی مطابق تقویم برای ماه در حال نمایش
                    </button>
                    {monthlyDutyHours && (
                      <div className="mt-2 text-[10px] font-bold text-indigo-700">
                        ساعت موظفی این ماه تعیین مقطعی شده است: (رسمی {monthlyDutyHours.official}، قراردادی {monthlyDutyHours.contract}، طرح {monthlyDutyHours.conscript}، اضافه‌کار {monthlyDutyHours.overtime})
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* --- VIEW 6: CALENDAR & HOLIDAYS MANAGEMENT --- */}
          {activeTab === 'calendar' && (
            <div className="space-y-6 animate-fade-in print:hidden">
              
              <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-150 pb-4 mb-4">
                  <div>
                    <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                      <span className="text-xl">📅</span> تنظیمات تقویم هوشمند و مدیریت تعطیلات
                    </h3>
                    <p className="text-slate-400 text-[11px] font-bold mt-1">تغییر دهنده روز شروع اول فیلد، و تخصیص مستقیم روزهای هفته و جمعه‌ها جهت اجرای خودکار شیفت‌ها</p>
                  </div>
                  
                  <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 text-[11px] font-extrabold px-3 py-1.5 rounded-full flex items-center gap-2 shrink-0">
                    <span>ماه فعال کنونی:</span>
                    <span className="bg-emerald-600 text-white px-2 py-0.5 rounded font-black font-mono">{JALALI_MONTH_NAMES[currentMonth - 1]} {currentYear}</span>
                  </div>
                </div>

                {/* STEP 1: CHOOSE STARTING WEEKDAY */}
                <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-2xl p-5 mb-6">
                  <div>
                    <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                      روز ۱ام {JALALI_MONTH_NAMES[currentMonth - 1]} چندشنبه است؟
                    </h4>
                    <p className="text-[10px] text-slate-400 mt-1">
                      با انتخاب روز هفته برای روز ۱ام، مابقی روزها به لحاظ موقعیت در یک لایه محاسباتی بازچیده می‌شوند:
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-7 gap-2">
                    {WEEKDAYS.map((w, idx) => {
                      const mathDefault = getJalaliWeekday(currentYear, currentMonth, 1);
                      const isSelected = firstDayOfWeekIndex !== undefined 
                        ? firstDayOfWeekIndex === idx 
                        : mathDefault === idx;

                      return (
                        <button
                          type="button"
                          key={`tab-cal-start-day-${idx}`}
                          onClick={() => {
                            setFirstDayOfWeekIndex(idx);
                            if (typeof window !== 'undefined') {
                              localStorage.setItem(`hospital_first_day_of_week_index_${currentYear}_${currentMonth}`, String(idx));
                              localStorage.setItem('hospital_first_day_of_week_index', String(idx));
                            }
                            saveState(personnel, requests, settings, customHolidays, idx, { mode: 'full_resolve' });
                          }}
                          className={`px-3 py-2 rounded-xl border text-xs font-black cursor-pointer transition-all flex flex-col items-center justify-center gap-1 ${
                            isSelected 
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-md scale-[1.02]' 
                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          <span>{w}</span>
                          {mathDefault === idx && (
                            <span className="text-[8px] font-normal opacity-85">(پیش‌فرض سیستم)</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* STEP 2: TICK TO DEFINE HOLIDAYS LIST */}
                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                      کنترل تیکی روزهای هفته و تعطیلات تا آخر ماه {JALALI_MONTH_NAMES[currentMonth - 1]} ({calendarDays.length} روز)
                    </h4>
                    <p className="text-[10px] text-slate-400 mt-1">
                      برای تغییر وضعیت هر روز بین «روز کاری عادی» و «روز تعطیل رسمی»، گزینه‌ی مربوطه را تیک بزنید. جمعه‌ها بر اساس قوانین به صورت دائم تعطیل هستند.
                    </p>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                    <div className="max-h-[500px] overflow-y-auto divide-y divide-slate-100 scrollbar-thin">
                      
                      {/* Table Header */}
                      <div className="grid grid-cols-12 bg-slate-50 p-3 text-[10px] font-black text-slate-500 sticky top-0 border-b border-slate-250 z-10">
                        <div className="col-span-3 text-center">وضعیت تعطیلی مذهبی/ملی</div>
                        <div className="col-span-2 text-center">تاریخ روز</div>
                        <div className="col-span-3">روز هفته</div>
                        <div className="col-span-4">علت تعطیلی / توضیح مناسبت</div>
                      </div>

                      {/* Days list */}
                      {calendarDays.map(d => {
                        const isCustomHoliday = !!customHolidays[d.day];
                        const isFriday = d.dayOfWeek === 6;
                        const isChecked = isFriday || isCustomHoliday;

                        return (
                          <div 
                            key={`tab-cal-day-${d.day}`}
                            className={`grid grid-cols-12 p-3 items-center text-xs font-bold transition-colors ${
                              isChecked 
                                ? 'bg-rose-50/30 text-rose-800' 
                                : 'hover:bg-slate-50/30 text-slate-700'
                            }`}
                          >
                            {/* Checkbox trigger */}
                            <div className="col-span-3 flex items-center justify-center gap-2">
                              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input 
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={isFriday} // Friday is automatically system holiday
                                  onChange={(e) => {
                                    const updated = { ...customHolidays };
                                    if (e.target.checked) {
                                      updated[d.day] = customHolidays[d.day] || 'تعطیل انتخابی با تیک';
                                    } else {
                                      delete updated[d.day];
                                    }
                                    setCustomHolidays(updated);
                                    saveState(personnel, requests, settings, updated, undefined, { mode: 'full_resolve' });
                                  }}
                                  className="w-4 h-4 accent-emerald-600 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                                  id={`check-holiday-${d.day}`}
                                />
                                <span className={`text-[10px] ${isChecked ? 'text-rose-600 font-extrabold' : 'text-slate-400 font-normal'}`}>
                                  {isChecked ? 'تعطیل کاربری' : 'روز کاری'}
                                </span>
                              </label>
                            </div>

                            {/* Holiday ID/Day */}
                            <div className="col-span-2 text-center font-mono font-black text-sm text-slate-800">
                              {d.day}
                            </div>

                            {/* Weekday name */}
                            <div className="col-span-3">
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${
                                isFriday 
                                  ? 'bg-rose-100 text-rose-700 border border-rose-200' 
                                  : 'bg-slate-100 text-slate-650 border border-slate-150'
                              }`}>
                                {WEEKDAYS[d.dayOfWeek]}
                              </span>
                            </div>

                            {/* Reason Input */}
                            <div className="col-span-4 flex items-center">
                              {isFriday ? (
                                <span className="text-slate-400 text-[10px] font-normal italic">روز جمعه (تعطیل مستقل سیستم)</span>
                              ) : (
                                <input 
                                  type="text"
                                  placeholder="مثلاً: مناسبت تعطیلی مذهبی..."
                                  disabled={!isCustomHoliday}
                                  value={customHolidays[d.day] || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    const updated = { ...customHolidays };
                                    if (updated[d.day] !== undefined) {
                                      updated[d.day] = val;
                                      setCustomHolidays(updated);
                                      saveState(personnel, requests, settings, updated, undefined, { mode: 'full_resolve' });
                                    }
                                  }}
                                  className={`w-full text-[10px] px-2.5 py-1 rounded-lg border focus:outline-none transition-all ${
                                    isCustomHoliday 
                                      ? 'bg-white border-rose-300 text-rose-800 font-black focus:border-rose-500' 
                                      : 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                                  }`}
                                />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

              </div>

              {/* STEP 3: MANAGE DUTY HOURS */}
              {(() => {
                const liveCalendarDays = generateJalaliMonthCalendar(currentYear, currentMonth, customHolidays, firstDayOfWeekIndex);
                const liveTotalDays = liveCalendarDays.length;
                const liveHolidaysCount = liveCalendarDays.filter(d => d.isHoliday).length;
                const X_val = liveTotalDays - liveHolidaysCount;
                const thursdaysNonHolidayCount_val = liveCalendarDays.filter(d => d.dayOfWeek === 5 && !d.isHoliday).length;
                const Y_val = thursdaysNonHolidayCount_val * 2;
                const z_calc = (X_val * 7) - Y_val;
                const contract_calc = z_calc + 14;

                return (
                  <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
                    <div>
                      <h3 className="text-base font-black text-slate-800 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
                        محاسبه و تنظیم ساعت موظفی ماهانه پرسنل
                      </h3>
                      <p className="text-xs text-slate-400 mt-1 font-semibold">
                        ساعت موظفی پرسنل را می‌توانید به صورت دستی وارد کرده یا محاسبه خودکار آیین‌نامه‌ای بر اساس قرارهای کاری ماه طوری تنظیم کنید که با تغییر تعطیلات تقویم آپدیت شود.
                      </p>
                    </div>

                    {/* Auto calculate Toggle */}
                    <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-2xl p-4">
                      <div className="space-y-0.5 ml-4">
                        <span className="text-xs font-black text-slate-800 block">محاسبه خودکار ساعت موظفی بر اساس تعطیلات تقویم (فرمول وزارتخانه)</span>
                        <span className="text-[10px] text-slate-400 font-semibold block leading-relaxed">
                          با فعال‌سازی این مورد، ساعت موظفی رسمی و قراردادی بر اساس تعداد روزهای غیرجمعه و پنجشنبه‌های غیرتعطیل ماه به صورت پویا محاسبه می‌شود.
                        </span>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input 
                          type="checkbox" 
                          checked={!!settings.autoCalculateDutyHours} 
                          onChange={(e) => {
                            const isChecked = e.target.checked;
                            const updated = {
                              ...settings,
                              autoCalculateDutyHours: isChecked,
                              ...(isChecked ? {
                                dutyHours: {
                                  ...settings.dutyHours,
                                  official: z_calc,
                                  contract: contract_calc
                                }
                              } : {})
                            };
                            setSettings(updated);
                            saveState(personnel, requests, updated, customHolidays, undefined, { mode: 'full_resolve' });
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                      <div className="bg-slate-50 p-3.5 border border-slate-200 rounded-2xl relative">
                        <label className="block text-[10px] font-black text-slate-500 mb-1.5 flex justify-between items-center">
                          <span>ساعت موظفی رسمی (ساعت)</span>
                          {settings.autoCalculateDutyHours && <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-md font-bold">محاسبه شده: {z_calc}h</span>}
                        </label>
                        <input 
                          type="number"
                          value={settings.dutyHours.official}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            const updated = {
                              ...settings,
                              autoCalculateDutyHours: false,
                              dutyHours: {
                                ...settings.dutyHours,
                                official: val
                              }
                            };
                            setSettings(updated);
                            saveState(personnel, requests, updated, customHolidays, undefined, { mode: 'full_resolve' });
                          }}
                          className="w-full text-xs font-black bg-white border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl px-2.5 py-2 text-center text-slate-800 font-mono focus:outline-none transition-all"
                        />
                      </div>

                      <div className="bg-slate-50 p-3.5 border border-slate-200 rounded-2xl relative">
                        <label className="block text-[10px] font-black text-slate-500 mb-1.5 flex justify-between items-center">
                          <span>ساعت موظفی قراردادی (ساعت)</span>
                          {settings.autoCalculateDutyHours && <span className="text-[9px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-md font-bold">محاسبه شده: {contract_calc}h</span>}
                        </label>
                        <input 
                          type="number"
                          value={settings.dutyHours.contract}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            const updated = {
                              ...settings,
                              autoCalculateDutyHours: false,
                              dutyHours: {
                                ...settings.dutyHours,
                                contract: val
                              }
                            };
                            setSettings(updated);
                            saveState(personnel, requests, updated, customHolidays, undefined, { mode: 'full_resolve' });
                          }}
                          className="w-full text-xs font-black bg-white border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl px-2.5 py-2 text-center text-slate-800 font-mono focus:outline-none transition-all"
                        />
                      </div>

                      <div className="bg-slate-50 p-3.5 border border-slate-200 rounded-2xl">
                        <label className="block text-[10px] font-black text-slate-500 mb-1.5">کادر طرح / وظیفه (ساعت)</label>
                        <input 
                          type="number"
                          value={settings.dutyHours.conscript}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            const updated = {
                              ...settings,
                              dutyHours: {
                                ...settings.dutyHours,
                                conscript: val
                              }
                            };
                            setSettings(updated);
                            saveState(personnel, requests, updated, customHolidays, undefined, { mode: 'full_resolve' });
                          }}
                          className="w-full text-xs font-black bg-white border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl px-2.5 py-2 text-center text-slate-800 font-mono focus:outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}
              
            </div>
          )}

          {/* --- VIEW 7: PERSONAL PROFILE MANAGEMENT --- */}
          {activeTab === 'profile' && (
            <div className="max-w-4xl mx-auto space-y-6 animate-fade-in print:hidden text-right">
              <div className="bg-white border border-slate-200 p-6 sm:p-10 rounded-3xl shadow-sm text-right space-y-6">
                
                <div className="flex items-center gap-3 border-b border-slate-100 pb-5">
                  <span className="bg-emerald-50 text-emerald-600 p-3 rounded-2xl">
                    <User className="w-6 h-6" />
                  </span>
                  <div>
                    <h3 className="text-lg font-black text-slate-950">مدیریت پروفایل و امنیت کاربری</h3>
                    <p className="text-[11px] text-slate-400 font-bold mt-1">
                      ویرایش مستقل حساب کاربری فعال، گذرواژه امن سرپرستار بخش و کاربران کادر درمان کشیک
                    </p>
                  </div>
                </div>

                {role === 'headnurse' && (
                  <form onSubmit={handleSaveProfile} className="space-y-6">
                    <div className="bg-slate-50/50 border border-slate-200/80 p-4 rounded-2xl text-[11px] font-bold text-slate-500 leading-relaxed">
                      💡 به عنوان <span className="text-indigo-600 font-black">سرپرستار بخش فعال</span>، اطلاعات تغییر یافته در این پنل مستقیماً نام بخش و شناسه امن حضور شما را برای این دپارتمان تغییر می‌دهد.
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-2">نام فارسی بخش</label>
                        <input 
                          type="text" 
                          value={profileDeptNameInput}
                          onChange={(e) => setProfileDeptNameInput(e.target.value)}
                          className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3.5 py-3 focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-2">نام کاربری سرپرستار (جهت ورود مجدد)</label>
                        <input 
                          type="text" 
                          value={profileUsernameInput}
                          onChange={(e) => setProfileUsernameInput(e.target.value)}
                          className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3.5 py-3 focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800 text-left font-sans"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-xs font-black text-slate-700 mb-2">کلمه عبور امن سرپرستار بخش</label>
                        <input 
                          type="text" 
                          value={profilePasswordInput}
                          onChange={(e) => setProfilePasswordInput(e.target.value)}
                          className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3.5 py-3 focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800 text-left font-mono"
                        />
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex justify-end">
                      <button
                        type="submit"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-8 py-3 rounded-xl transition-all shadow-md cursor-pointer hover:scale-[1.01]"
                      >
                        ذخیره تنظیمات امنیتی بخش و سرپرستار
                      </button>
                    </div>
                  </form>
                )}

                {role === 'personnel' && selectedPersonnelUser && (
                  <form onSubmit={handleSaveProfile} className="space-y-6">
                    {/* Read only info section */}
                    <div className="bg-slate-50 border border-slate-200/80 p-5 rounded-2xl grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-bold text-slate-600">
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-1">نام کادر درمان:</span>
                        <span className="text-slate-800 font-extrabold">{selectedPersonnelUser.firstName}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-1">نام خانوادگی:</span>
                        <span className="text-slate-800 font-extrabold">{selectedPersonnelUser.lastName}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-1">کد پرسنلی بعثت:</span>
                        <span className="text-slate-800 font-mono font-extrabold">{selectedPersonnelUser.personalCode}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-1">رده یا گروه شغلی:</span>
                        <span className={`px-2.5 py-0.5 rounded text-[10px] ${selectedPersonnelUser.jobGroup === 'nurse' ? 'bg-indigo-50 text-indigo-700' : 'bg-amber-50 text-amber-700'}`}>
                          {selectedPersonnelUser.jobGroup === 'nurse' ? 'پرستار' : 'کمک بهیار'}
                        </span>
                      </div>
                    </div>

                    <div className="bg-amber-50 border border-amber-200/60 p-4 rounded-xl text-[10px] font-bold text-amber-800 leading-normal">
                      ⚠️ همکار گرامی، پیش‌فرض رمز عبور شما «۱۲۳۴» تنظیم شده است. برای حفاظت از امنیت اطلاعات خود و جلوگیری از ویرایش درخواست‌ها توسط سایرین، رمز عبور شخصی خود را بازنشانی کنید. نام کاربری شما تغییر نمی‌کند و برای ورود باید اطلاعات هویتی و رمزتان را وارد کنید.
                    </div>

                    <div className="grid grid-cols-1 gap-6">
                      <div>
                        <label className="block text-xs font-black text-slate-700 mb-2">کلمه عبور شخصی جدید</label>
                        <input 
                          type="text" 
                          value={profilePasswordInput}
                          onChange={(e) => setProfilePasswordInput(e.target.value)}
                          className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3.5 py-3 focus:ring-2 focus:ring-emerald-500 focus:outline-none text-slate-800 text-center font-mono placeholder-slate-400"
                          placeholder="کلمه عبور امن منحصر به خودتان"
                        />
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex justify-end">
                      <button
                        type="submit"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs px-8 py-3 rounded-xl transition-all shadow-md cursor-pointer hover:scale-[1.01]"
                      >
                        ذخیره اطلاعات عبور شخصی من
                      </button>
                    </div>
                  </form>
                )}

                {role === 'admin' && (
                  <div className="text-center py-12 text-slate-400 text-xs font-bold space-y-2">
                    <p>🔧 حساب کاربری مدیریت کل (مدیر سامانه) به صورت سراسری مدیریت می‌شود و قابل تعویق نیست.</p>
                  </div>
                )}

              </div>
            </div>
          )}

          {/* --- VIEW 1 (PRINT SPECIFIC LAYOUT ONLY) --- */}
          <div className="hidden print:block w-full bg-white text-slate-900 p-8">
            <div className="text-center mb-6">
              <h1 className="text-2xl font-black">جدول زمان‌بندی و توزیع شیفت پرسنل پرستاری بیمارستان</h1>
              <p className="text-sm mt-1 font-mono">{JALALI_MONTH_NAMES[currentMonth - 1]} {currentYear}</p>
            </div>
            
            <div className="overflow-x-auto w-full">
              <table className="w-full text-xs text-right border-collapse border border-slate-300 min-w-[1240px]">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-300 p-2 font-bold w-44">پرسنل</th>
                    {calendarDays.map(d => (
                      <th key={d.day} className="border border-slate-300 p-1 text-center font-bold">
                        {d.day}
                      </th>
                    ))}
                    <th className="border border-slate-300 p-1 font-bold text-[10px] w-12">حضور</th>
                    <th className="border border-slate-300 p-1 font-bold text-[10px] w-12">اضافه‌کار</th>
                    <th className="border border-slate-300 p-1 font-bold text-[10px] w-12">بهره‌وری</th>
                    <th className="border border-slate-300 p-1 font-bold text-[10px] w-12">سنوات</th>
                  </tr>
                </thead>
                <tbody>
                  {personnel.filter(p => p.active).map(p => {
                    const pAssignments = schedule?.assignments[p.id] || {};
                    const pReport = reports.find(r => r.personnelId === p.id);
                    return (
                      <tr key={p.id}>
                        <td className="border border-slate-300 p-2 font-bold whitespace-nowrap">{p.firstName} {p.lastName}</td>
                        {calendarDays.map(d => {
                          const shift = pAssignments[d.day] || 'OFF';
                          let cleanS = shift;
                          if (shift.startsWith('L')) {
                            cleanS = shift.substring(1) as ShiftType;
                          }

                          const isLeaderM = schedule?.shiftLeaders?.[d.day]?.morning === p.id;
                          const isLeaderE = schedule?.shiftLeaders?.[d.day]?.afternoon === p.id;
                          const isLeaderN = schedule?.shiftLeaders?.[d.day]?.night === p.id;

                          const isLeaderCell = 
                            (shift === 'M' && isLeaderM) ||
                            (shift === 'E' && isLeaderE) ||
                            (shift === 'N' && isLeaderN) ||
                            (shift === 'ME' && (isLeaderM || isLeaderE)) ||
                            (shift === 'EN' && (isLeaderE || isLeaderN)) ||
                            (shift === 'MN' && (isLeaderM || isLeaderN)) ||
                            (shift === 'MEN' && (isLeaderM || isLeaderE || isLeaderN));

                          let printDisplay = cleanS === 'OFF' ? 'آف' : cleanS;
                          if (cleanS !== 'OFF' && isLeaderCell) {
                            printDisplay = `${cleanS} *`;
                          }

                          return (
                            <td key={d.day} className="border border-slate-300 p-1 text-center font-mono text-[9px]">
                              {printDisplay}
                            </td>
                          );
                        })}
                        <td className="border border-slate-300 p-1 text-center font-mono text-[10px] font-bold">{pReport?.workedHours || 0}</td>
                        <td className="border border-slate-300 p-1 text-center font-mono text-[10px]">{pReport?.overtimeHours || 0}</td>
                        <td className="border border-slate-300 p-1 text-center font-mono text-[10px]">{pReport?.productivityHours || 0}</td>
                        <td className="border border-slate-300 p-1 text-center font-mono text-[10px]">{pReport?.experienceHours || 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

        </div> {/* close CONTENT VIEWPORT */}
      </main> {/* close DASHBOARD CONTAINER WORKSPACE */}

      {/* --- CUSTOM MODAL: DELETE CONFIRMATION --- */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center z-55 p-4 print:hidden animate-fade-in" id="delete-confirm-modal" dir="rtl">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full border border-slate-200 shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-2">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="font-extrabold text-slate-900 text-base font-sans">تایید حذف نهایی</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-bold">
              آیا از حذف <b className="text-rose-600">«{deleteTarget.label}»</b> اطمینان دارید؟ تمام فعالیت‌ها و شیفت‌های مرتبط نیز پاک خواهند شد. این عملیات غیرقابل بازگشت است.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs py-2.5 rounded-xl transition-all cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={() => {
                  if (deleteTarget.type === 'personnel') {
                    handleDeletePersonnel(deleteTarget.id);
                  } else {
                    handleDeleteRequest(deleteTarget.id);
                  }
                  setDeleteTarget(null);
                }}
                className="w-full bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs py-2.5 rounded-xl transition-all cursor-pointer shadow-md shadow-rose-200/20"
                id="btn-confirm-delete-action"
              >
                تایید و حذف دائم
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 1: ADD / EDIT PERSONNEL --- */}
      {showAddPersonnelModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 print:hidden animate-fade-in" id="personnel-modal">
          <div className="bg-white border rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6 shadow-2xl relative scrollbar-thin">
            <button 
              onClick={() => setShowAddPersonnelModal(false)}
              className="absolute top-4 left-4 text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg p-1.5 cursor-pointer"
            >
              ✕
            </button>
            
            <h3 className="text-base font-black text-slate-800 mb-6 border-b pb-3 border-slate-100">
              {editingPersonnel ? 'ویرایش اطلاعات پرسنلی' : 'تعریف پرسنل جدید'}
            </h3>

            <form onSubmit={handleSavePersonnel} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">نام</label>
                  <input 
                    type="text" 
                    value={formFirstName}
                    onChange={(e) => setFormFirstName(e.target.value)}
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                    id="input-form-fname"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">نام خانوادگی</label>
                  <input 
                    type="text" 
                    value={formLastName}
                    onChange={(e) => setFormLastName(e.target.value)}
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                    id="input-form-lname"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">کد پرسنلی (یکتا)</label>
                <input 
                  type="text" 
                  value={formPersonalCode}
                  onChange={(e) => setFormPersonalCode(e.target.value)}
                  className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none font-mono"
                  id="input-form-code"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">گروه شغلی</label>
                  <select 
                    value={formJobGroup}
                    onChange={(e) => {
                      const mode = e.target.value as 'nurse' | 'assistant';
                      setFormJobGroup(mode);
                      if (mode === 'assistant') {
                        setFormPosition('none');
                        setFormCanBeShiftLeader(false);
                      } else {
                        setFormPosition('general');
                        setFormCanBeShiftLeader(true);
                      }
                    }}
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                    id="select-form-job"
                  >
                    <option value="nurse">پرستار</option>
                    <option value="assistant">کمک بهیار</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">سمت پرستاری</label>
                  <select 
                    value={formPosition}
                    disabled={formJobGroup === 'assistant'}
                    onChange={(e) => setFormPosition(e.target.value as any)}
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                    id="select-form-position"
                  >
                    <option value="none">بدون سمت</option>
                    <option value="supervisor">سرپرستار</option>
                    <option value="staff">استاف</option>
                    <option value="general">کارشناس عمومی</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">نوع استخدام</label>
                  <select 
                    value={formEmploymentType}
                    onChange={(e) => setFormEmploymentType(e.target.value as any)}
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                    id="select-form-emptype"
                  >
                    <option value="official">رسمی</option>
                    <option value="contract">قراردادی</option>
                    <option value="conscript">طرح / وظیفه</option>
                    <option value="overtime">اضافه‌کاری</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">سابقه کار (سال)</label>
                  <input 
                    type="number" 
                    value={formExperienceYears}
                    onChange={(e) => setFormExperienceYears(Number(e.target.value))}
                    className="w-full text-xs font-extrabold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                    id="input-form-years"
                  />
                </div>
              </div>

              <div className="pt-3 flex flex-col gap-2 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
                  <input 
                    type="checkbox" 
                    checked={formActive} 
                    onChange={(e) => setFormActive(e.target.checked)}
                    className="rounded border-slate-300 accent-indigo-600 text-indigo-600 focus:ring-indigo-500"
                  />
                  کاربر فعال باشد (حضور در برنامه‌ریزی)
                </label>

                {formJobGroup !== 'assistant' && (
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                    <input 
                      type="checkbox" 
                      checked={formCanBeShiftLeader} 
                      disabled={formPosition === 'supervisor'}
                      onChange={(e) => setFormCanBeShiftLeader(e.target.checked)}
                      className="rounded border-slate-300 accent-indigo-600 text-indigo-600"
                    />
                    قابلیت سرشیفت شدن (ویژه استاف و کارشناس عمومی)
                  </label>
                )}
              </div>

              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs py-3 rounded-xl shadow-lg mt-4 cursor-pointer"
                id="btn-save-form-personnel"
              >
                ثبت اطلاعات و به‌روزرسانی بانک داده
              </button>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL 2: ADD ADVANCED MODULAR REQUEST --- */}
      {showAddRequestModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 print:hidden animate-fade-in" id="request-modal">
          <div className="bg-white border rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6 shadow-2xl relative animate-scale-up scrollbar-thin">
            <button 
              onClick={() => setShowAddRequestModal(false)}
              className="absolute top-4 left-4 text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg p-1.5 cursor-pointer"
            >
              ✕
            </button>
            
            <h3 className="text-base font-black text-slate-800 mb-6 border-b pb-3 border-slate-100">
              ثبت درخواست هوشمند و مرخصی پرستاری
            </h3>

            <form onSubmit={(e) => { e.preventDefault(); handleFinalSubmitRequests(); }} className="space-y-4">
              
              {role !== 'personnel' ? (
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">پرستار یا بهیار متقاضی:</label>
                  <select 
                    value={reqPersonnelId} 
                    onChange={(e) => setReqPersonnelId(e.target.value)}
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                    id="select-req-p"
                  >
                    <option value="">-- انتخاب پرسنل --</option>
                    {personnel.map(p => (
                      <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.jobGroup === 'nurse' ? 'پرستار' : 'کمک بهیار'})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="bg-emerald-50 text-emerald-800 p-3 rounded-xl text-xs font-extrabold">
                  ثبت درخواست به نام: {selectedPersonnelUser?.firstName} {selectedPersonnelUser?.lastName}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">نوع درخواست</label>
                  <select 
                    value={reqType} 
                    onChange={(e) => {
                      const val = e.target.value as any;
                      setReqType(val);
                      if (val === 'avoid_shift') {
                        setReqPreferredShift('M');
                      }
                    }}
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500"
                    id="select-req-type"
                  >
                    <option value="shift">درخواست شیفت تفکیکی</option>
                    <option value="OFF">آف</option>
                    <option value="leave">مرخصی استحقاقی (نمایش عددی)</option>
                    <option value="avoid_shift">در تاریخ... شیفت....نباشم</option>
                  </select>
                </div>

                <div>
                  {reqType === 'shift' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">شیفت درخواستی</label>
                      <select 
                        value={reqPreferredShift} 
                        onChange={(e) => setReqPreferredShift(e.target.value as any)}
                        className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500"
                        id="select-req-prefshift"
                      >
                        <option value="M">صبح (M)</option>
                        <option value="E">عصر (E)</option>
                        <option value="N">شب (N)</option>
                        <option value="ME">عصر-صبح (ME)</option>
                        <option value="EN">شب-عصر (EN)</option>
                        <option value="MN">شب-صبح (MN)</option>
                        <option value="MEN">ترکیبی کل روز (MEN)</option>
                      </select>
                    </div>
                  )}

                  {reqType === 'avoid_shift' && (
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">شیفت ممنوعه</label>
                      <select 
                        value={reqPreferredShift} 
                        onChange={(e) => setReqPreferredShift(e.target.value as any)}
                        className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500"
                        id="select-req-avoidshift"
                      >
                        <option value="M">صبح (M)</option>
                        <option value="E">عصر (E)</option>
                        <option value="N">شب (N)</option>
                        <option value="ME">عصر-صبح (ME)</option>
                        <option value="EN">شب-عصر (EN)</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">دامنه زمانی تکرار درخواست:</label>
                <select 
                  value={reqScope}
                  onChange={(e) => setReqScope(e.target.value as any)}
                  className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500"
                  id="select-req-scope"
                >
                  <option value="all">تمام روزهای ماه</option>
                  <option value="even">تاریخ زوج ماه</option>
                  <option value="odd">تاریخ فرد ماه</option>
                  <option value="weekly_even">روزهای زوج هفته (شنبه، دوشنبه، چهارشنبه)</option>
                  <option value="weekly_odd">روزهای فرد هفته (یک‌شنبه، سه‌شنبه، پنج‌شنبه)</option>
                  <option value="custom_days">روزهای انتخابی از تقویم (کلیک و تیک روی روزهای خاص)</option>
                </select>
              </div>

              {reqScope === 'custom_days' && (
                <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] font-black text-slate-705">روزهای مورد نظر خود را کلیک و انتخاب کنید:</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (reqSelectedDays.length === calendarDays.length) {
                          setReqSelectedDays([]);
                        } else {
                          setReqSelectedDays(calendarDays.map(d => d.day));
                        }
                      }}
                      className="text-[10px] bg-indigo-55 bg-indigo-50 border border-indigo-150 text-indigo-700 px-2.5 py-1 rounded-xl hover:bg-indigo-100 font-bold transition-all cursor-pointer"
                    >
                      {reqSelectedDays.length === calendarDays.length ? 'حذف همه انتخاب‌ها' : 'انتخاب تمام روزهای ماه'}
                    </button>
                  </div>
                  <div className="grid grid-cols-6 sm:grid-cols-7 gap-1.5 max-h-[160px] overflow-y-auto p-1.5 scrollbar-thin rounded-xl border border-slate-150 bg-white">
                    {calendarDays.map(d => {
                      const isSelected = reqSelectedDays.includes(d.day);
                      return (
                        <button
                          type="button"
                          key={`req-custom-day-btn-${d.day}`}
                          onClick={() => {
                            if (isSelected) {
                              setReqSelectedDays(reqSelectedDays.filter(day => day !== d.day));
                            } else {
                              setReqSelectedDays([...reqSelectedDays, d.day].sort((a,b) => a-b));
                            }
                          }}
                          className={`py-1.5 text-[11px] font-black rounded-xl border transition-all flex flex-col items-center justify-center cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105'
                              : d.dayOfWeek === 6
                                ? 'bg-rose-50 text-rose-700 border-rose-100 hover:bg-rose-100/50'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <span className="text-xs font-mono font-extrabold">{d.day}</span>
                          <span className="text-[8px] opacity-75">{WEEKDAYS[d.dayOfWeek][0]}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-[11px] text-slate-500 font-bold flex justify-between items-center px-1">
                    <span>تعداد روزهای انتخاب‌شده:</span>
                    <span className="bg-indigo-100 text-indigo-805 font-black px-2.5 py-0.5 rounded-full text-xs">{reqSelectedDays.length} روز انتخاب شده</span>
                  </div>
                </div>
              )}

              {(role === 'admin' || role === 'headnurse') && (
                <div>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-extrabold text-slate-700 pt-1">
                    <input 
                      type="checkbox" 
                      checked={reqIsEssential} 
                      onChange={(e) => setReqIsEssential(e.target.checked)}
                      className="rounded border-slate-300 accent-indigo-600 focus:ring-indigo-500 text-indigo-600"
                    />
                    درخواست ضروری (اولویت بسیار بالا در موتور زمان‌بندی)
                  </label>
                </div>
              )}

              {/* DRAFT TABLE IN MODAL */}
              {draftRequests.length > 0 && (
                <div className="mt-4 border-t border-slate-100 pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black text-slate-500">لیست درخواست‌های موقت (آماده برای ثبت نهایی):</span>
                    <span className="bg-amber-50 text-amber-755 text-[10px] px-2 py-0.5 rounded font-mono font-bold">{draftRequests.length} مورد</span>
                  </div>
                  <div className="space-y-1.5 max-h-[110px] overflow-y-auto p-1 border border-slate-100 bg-slate-50/50 rounded-xl">
                    {draftRequests.map((d, index) => (
                      <div key={d.id} className="flex items-center justify-between p-2 rounded-lg border border-slate-150 bg-white text-xs text-slate-700">
                        <span className="font-bold">{getRequestSummaryText(d)}</span>
                        <button
                          type="button"
                          onClick={() => setDraftRequests(draftRequests.filter((_, idx) => idx !== index))}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1 rounded-md transition-colors cursor-pointer"
                          title="حذف این مورد از لیست موقت"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleAddDraftRequest}
                  className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-705 border border-slate-300 font-extrabold text-xs py-3 rounded-xl shadow-sm transition-all cursor-pointer animate-pulse-subtle"
                  id="btn-add-draft"
                >
                  <Plus className="w-4 h-4 text-slate-600 animate-spin-once" /> افزودن به لیست
                </button>
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs py-3 rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  id="btn-save-req"
                >
                  <Check className="w-4 h-4 text-white" /> ثبت نهایی درخواست‌ها
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
