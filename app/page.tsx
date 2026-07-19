'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TehranDateTime from './components/TehranDateTime';
import { ResetRequestList } from './components/auth/ResetRequestList';
import { WelcomeOverlay } from './components/auth/WelcomeOverlay';
import type { AuthenticatedUser, LoginResult } from '../lib/auth/types';
import { useOfficialCalendar } from '../hooks/useOfficialCalendar';
import type { AppDatabaseState, StorageResource } from '../lib/storageSchemas';
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
  PersonnelReportResult,
  AggregatedAlert,
  SmartSuggestion,
  OptimizationResult
} from '../lib/types';
import {
  INITIAL_PERSONNEL,
  INITIAL_SETTINGS,
  INITIAL_REQUESTS
} from '../lib/mockData';
import {
  solveNursingSchedule,
  generatePersonnelReports,
  verifyCoverageAndLeaders,
  SHIFT_HOURS,
  getLeaveHours,
  getSeniorityHours,
  calculateAutoDutyHours,
  solveWithPriority
} from '../lib/solver';
import { aggregateWarnings, filterActiveWarnings } from '../lib/alertAggregator';
import {
  applyDefaultOffRule,
  findBestSubstitute,
  checkAndApplyAutoSubstitution
} from '../lib/balanceChecker';
import { generateSmartSuggestions } from '../lib/smartSuggestion';
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
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  User,
  Activity,
  Menu,
  X,
  Settings2,
  History
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

export default function Home() {
  const router = useRouter();
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthenticatedUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [staffNationalIdInput, setStaffNationalIdInput] = useState('');
  const [staffPasswordInput, setStaffPasswordInput] = useState('');
  const [headnurseUsernameInput, setHeadnurseUsernameInput] = useState('');
  const [headnursePasswordInput, setHeadnursePasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [staffAuthNotice, setStaffAuthNotice] = useState('');
  const [pendingLogin, setPendingLogin] = useState<LoginResult | null>(null);
  const [isPortalSubmitting, setIsPortalSubmitting] = useState(false);
  const [isResetRequestSubmitting, setIsResetRequestSubmitting] = useState(false);

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
  const [storageInfo, setStorageInfo] = useState<{ isConfigured: boolean; bucket: string; environment: string; source: string } | null>(null);

  // ETags are deliberately kept outside render state. Writes are serialized and a
  // failed/conflicting queue is blocked until a successful reload refreshes all ETags.
  const storageVersionsRef = React.useRef<Record<string, string>>({});
  const optimisticDbRef = React.useRef<AppDatabaseState | null>(null);
  const saveQueueRef = React.useRef<Promise<void>>(Promise.resolve());
  const storageWriteBlockedRef = React.useRef(false);
  const storageLoadCountRef = React.useRef(0);
  const storageLoadGenerationRef = React.useRef(0);

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

  // تنها منبع سال، ماه، چیدمان هفته و تعطیلات رسمی در کل رابط کاربری
  const officialCalendarState = useOfficialCalendar();
  const currentYear = officialCalendarState.year;
  const currentMonth = officialCalendarState.month;
  const setCurrentYear = officialCalendarState.setYear;
  const setCurrentMonth = officialCalendarState.setMonth;

  const [isMounted, setIsMounted] = useState<boolean>(false);
  const [isMonthLoaded, setIsMonthLoaded] = useState<boolean>(() => typeof window === 'undefined');

  const [, setCustomHolidays] = useState<{ [day: number]: string }>({});
  const [, setFirstDayOfWeekIndex] = useState<number | undefined>(undefined);
  // Adapter فقط خواندنی: دیتابیس و فرم‌های قدیمی هرگز منبع رسمی را بازنویسی نمی‌کنند.
  const customHolidays = officialCalendarState.calendar?.holidays ?? {};
  const firstDayOfWeekIndex = officialCalendarState.calendar?.firstDayOfWeek;
  const [calendarOccasions, setCalendarOccasions] = useState<{ [day: number]: string[] }>({});
  const [calendarSyncedAt, setCalendarSyncedAt] = useState<string | null>(null);
  const [calendarOnline, setCalendarOnline] = useState(false);
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<number | null>(null);

  // انتشار ماه رسمی در سازگارساز قدیمی solver؛ هیچ داده محلی اجازه بازنویسی تقویم رسمی را ندارد.
  useEffect(() => {
    const official = officialCalendarState.calendar;
    if (!official) {
      setCalendarOnline(false);
      setCalendarOccasions({});
      return;
    }
    setCustomHolidays(official.holidays);
    setCalendarOccasions(official.occasions);
    setFirstDayOfWeekIndex(official.firstDayOfWeek);
    setCalendarSyncedAt(official.syncedAt);
    setCalendarOnline(true);
  }, [officialCalendarState.calendar]);

  // ساعت موظفی فقط پس از دریافت کامل ماه رسمی محاسبه می‌شود؛ در زمان loading مقدار ماه قبل بازنویسی نمی‌شود.
  useEffect(() => {
    const officialMonth = officialCalendarState.calendar;
    if (!officialMonth) return;
    const workDays = officialMonth.days.filter(day => !day.isHoliday).length;
    const workingThursdays = officialMonth.days.filter(day => day.dayOfWeek === 5 && !day.isHoliday).length;
    // فرمول موجود سیستم بدون تغییر: رسمی = (روز کاری × ۷) - (پنجشنبه کاری × ۲)، قراردادی = رسمی + ۱۴
    const official = (workDays * 7) - (workingThursdays * 2);
    const contract = official + 14;
    setSettings(previous => {
      if (previous.dutyHours.official === official && previous.dutyHours.contract === contract && previous.autoCalculateDutyHours) return previous;
      return { ...previous, autoCalculateDutyHours: true, dutyHours: { ...previous.dutyHours, official, contract } };
    });
  }, [officialCalendarState.calendar]);

  // State for monthly approved duty hours
  const [monthlyDutyHours, setMonthlyDutyHours] = useState<any>(null);
  const effectiveDutyHours = {
    ...(monthlyDutyHours || settings.dutyHours),
    official: settings.dutyHours.official,
    contract: settings.dutyHours.contract
  };

  // Schedule matrix
  const [schedule, setSchedule] = useState<MonthlySchedule | null>(null);

  // درخواست ۸: state برای ویرایش درخواست در پنل پرسنل

  const [dismissedAlertWarnings, setDismissedAlertWarnings] = useState<{ [key: string]: boolean }>({});
  const [showAlertCenter, setShowAlertCenter] = useState<boolean>(false);
  const [expandedAlertSections, setExpandedAlertSections] = useState<{general: boolean, personnel: boolean}>({general: true, personnel: true});
  const [highlightedCellId, setHighlightedCellId] = useState<string | null>(null);

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
    setTimeout(() => {
      setIsMounted(true);
      setIsMonthLoaded(true);
    }, 0);
  }, []);

  // Compiled reports from current schedule dynamically and reactively
  const reports = React.useMemo(() => {
    if (schedule && personnel.length > 0 && settings) {
      return generatePersonnelReports(currentYear, currentMonth, personnel, schedule, settings, customHolidays, firstDayOfWeekIndex, effectiveDutyHours);
    }
    return [];
  }, [personnel, schedule, settings, customHolidays, firstDayOfWeekIndex, currentYear, currentMonth, monthlyDutyHours]);

  const [solvingTarget, setSolvingTarget] = useState<JobGroup | null>(null);

  // User Authentication & Roles
  // roles: 'admin' | 'headnurse' | 'personnel' | 'guest'
  const [role, setRole] = useState<'admin' | 'headnurse' | 'personnel' | 'guest'>('guest');
  const selectedPersonnelUser = React.useMemo(() => {
    if (authenticatedUser?.role !== 'PERSONNEL' || !authenticatedUser.personnelId) return null;
    return personnel.find(person => person.id === authenticatedUser.personnelId) || null;
  }, [authenticatedUser, personnel]);
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const loadSession = async () => {
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok || !result.user) {
          if (!cancelled) {
            setAuthenticatedUser(null);
            setRole('guest');
          }
          return;
        }
        const user = result.user as AuthenticatedUser;
        if (user.mustChangePassword) {
          router.replace('/change-password');
          return;
        }
        if (cancelled) return;
        setAuthenticatedUser(user);
        setRole(user.role === 'ADMIN' ? 'admin' : user.role === 'HEAD_NURSE' ? 'headnurse' : 'personnel');
        if (user.departmentId) {
          setSelectedDepartmentId(user.departmentId);
          localStorage.setItem('hospital_selected_dept_id', user.departmentId);
        }
      } catch {
        if (!cancelled) {
          setAuthenticatedUser(null);
          setRole('guest');
        }
      } finally {
        if (!cancelled) setIsAuthLoading(false);
      }
    };
    void loadSession();
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    if (isAuthLoading || authenticatedUser) return;
    let cancelled = false;
    const loadDepartmentOptions = async () => {
      try {
        const response = await fetch('/api/public/departments');
        const result = await response.json();
        if (!response.ok || !result.success || cancelled) return;
        const publicDepartments = result.departments as Department[];
        setDepartments(publicDepartments);
        if (publicDepartments.length > 0 && !publicDepartments.some(item => item.id === selectedDepartmentId)) {
          setSelectedDepartmentId(publicDepartments[0].id);
          localStorage.setItem('hospital_selected_dept_id', publicDepartments[0].id);
        }
      } catch {
        // The existing login layout remains usable and shows the global auth error on submit.
      }
    };
    void loadDepartmentOptions();
    return () => { cancelled = true; };
  }, [authenticatedUser, isAuthLoading, selectedDepartmentId]);

  const handlePortalLogin = async (portal: 'staff' | 'head-nurse') => {
    setAuthError('');
    setStaffAuthNotice('');
    setIsPortalSubmitting(true);
    try {
      const nationalId = portal === 'staff' ? staffNationalIdInput : headnurseUsernameInput;
      const password = portal === 'staff' ? staffPasswordInput : headnursePasswordInput;
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nationalId, password, departmentId: selectedDepartmentId, portal }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'ورود انجام نشد.');
      setPendingLogin({ user: result.user, redirectTo: result.redirectTo });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'خطا در برقراری ارتباط با سرور.');
    } finally {
      setIsPortalSubmitting(false);
    }
  };

  const handleStaffForgotPassword = async () => {
    setAuthError('');
    setStaffAuthNotice('');
    if (!staffNationalIdInput.trim()) {
      setAuthError('ابتدا کد ملی خود را وارد کنید.');
      return;
    }
    setIsResetRequestSubmitting(true);
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nationalId: staffNationalIdInput }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'ثبت درخواست انجام نشد.');
      setStaffAuthNotice('رمز عبور جدید به زودی برات ارسال میشه!');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'خطا در ثبت درخواست بازیابی.');
    } finally {
      setIsResetRequestSubmitting(false);
    }
  };

  const finishWelcome = React.useCallback(() => {
    if (!pendingLogin) return;
    if (pendingLogin.user.mustChangePassword) {
      router.replace('/change-password');
      return;
    }
    const user = pendingLogin.user;
    setAuthenticatedUser(user);
    setRole(user.role === 'ADMIN' ? 'admin' : user.role === 'HEAD_NURSE' ? 'headnurse' : 'personnel');
    if (user.departmentId) {
      setSelectedDepartmentId(user.departmentId);
      localStorage.setItem('hospital_selected_dept_id', user.departmentId);
    }
    setPendingLogin(null);
    router.replace('/');
  }, [pendingLogin, router]);

  // States for finalized months (locked schedules that won't auto-resolve)
  const [finalizedNursesMonths, setFinalizedNursesMonths] = useState<string[]>([]);
  const [finalizedAssistantsMonths, setFinalizedAssistantsMonths] = useState<string[]>([]);
  const [requestsLockedMonths, setRequestsLockedMonths] = useState<string[]>([]);

  // State for dismissed warnings list per month
  const [dismissedWarnings, setDismissedWarnings] = useState<string[]>([]);

  // ====== STATE‌های جدید برای درخواست‌ها ======

  // برای قفل ردیف‌ها (درخواست ۶)
  const [lockedRows, setLockedRows] = useState<string[]>([]);

  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);

  const [pendingDbSaveCount, setPendingDbSaveCount] = useState<number>(0);
  const [blockingDbSaveCount, setBlockingDbSaveCount] = useState<number>(0);
  const isSavingDb = pendingDbSaveCount > 0;
  const isBlockingDbSave = blockingDbSaveCount > 0;

  const getFreshDbCopy = (): AppDatabaseState => {
    const current = optimisticDbRef.current || fullDbState;
    if (!current || storageWriteBlockedRef.current) {
      throw new Error('دیتابیس هنوز آماده نیست یا پس از خطای هم‌زمانی قفل شده است؛ صفحه را تازه‌سازی کنید.');
    }
    return JSON.parse(JSON.stringify(current));
  };

  const versionIdForResource = (resource: StorageResource): string => {
    switch (resource.type) {
      case 'departments': return 'departments';
      case 'personnel': return `department:${resource.departmentId}:personnel`;
      case 'requests': return `department:${resource.departmentId}:requests`;
      case 'settings': return `department:${resource.departmentId}:settings`;
      case 'holidays': return `department:${resource.departmentId}:holidays`;
      case 'firstDayOfWeek': return `department:${resource.departmentId}:firstDayOfWeek`;
      case 'schedule': return `department:${resource.departmentId}:schedule:${resource.monthKey}`;
    }
  };

  type StorageMutation = { resource: StorageResource; data: unknown; existed: boolean };
  const sameDocument = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

  const buildStorageMutations = (
    previous: AppDatabaseState,
    next: AppDatabaseState
  ): StorageMutation[] => {
    const mutations: StorageMutation[] = [];

    for (const department of next.departments) {
      const departmentId = department.id;
      const before = previous.deptData[departmentId];
      const after = next.deptData[departmentId];
      if (!after) throw new Error(`داده بخش ${departmentId} وجود ندارد.`);

      const resources: Array<{ resource: StorageResource; before: unknown; after: unknown }> = [
        { resource: { type: 'personnel', departmentId }, before: before?.personnel, after: after.personnel },
        { resource: { type: 'requests', departmentId }, before: before?.requests, after: after.requests },
        {
          resource: { type: 'settings', departmentId },
          before: before ? {
            activeYear: before.activeYear,
            settings_system: before.settings_system,
            settings_credentials: before.settings_credentials,
          } : undefined,
          after: {
            activeYear: after.activeYear,
            settings_system: after.settings_system,
            settings_credentials: after.settings_credentials,
          },
        },
        { resource: { type: 'holidays', departmentId }, before: before?.holidays, after: after.holidays },
        { resource: { type: 'firstDayOfWeek', departmentId }, before: before?.firstDayOfWeek, after: after.firstDayOfWeek },
      ];

      for (const item of resources) {
        if (!sameDocument(item.before, item.after)) {
          mutations.push({ resource: item.resource, data: item.after, existed: item.before !== undefined });
        }
      }

      for (const [monthKey, nextSchedule] of Object.entries(after.schedules || {})) {
        const previousSchedule = before?.schedules?.[monthKey];
        if (!sameDocument(previousSchedule, nextSchedule)) {
          mutations.push({
            resource: { type: 'schedule', departmentId, monthKey },
            data: nextSchedule,
            existed: previousSchedule !== undefined,
          });
        }
      }
    }

    // Publish index changes last: a newly-created department never becomes visible
    // before all of its required documents have been written successfully.
    if (!sameDocument(previous.departments, next.departments)) {
      mutations.push({
        resource: { type: 'departments' },
        data: next.departments,
        existed: true,
      });
    }
    return mutations;
  };

  const saveDbState = async (
    updatedDb: AppDatabaseState,
    options: { showBusyOverlay?: boolean } = {}
  ) => {
    const { showBusyOverlay = true } = options;
    const baseDb = optimisticDbRef.current;
    if (!baseDb || storageWriteBlockedRef.current || storageLoadCountRef.current > 0) {
      throw new Error('ذخیره‌سازی هنگام بارگذاری یا پس از خطای هم‌زمانی متوقف است؛ صفحه را تازه‌سازی کنید.');
    }

    const mutations = buildStorageMutations(baseDb, updatedDb);
    optimisticDbRef.current = updatedDb;
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
      setLockedRows(sched.lockedRows || []);
      const isFinNurses = !!sched.finalizedNurses || !!sched.finalized;
      const isFinAssistants = !!sched.finalizedAssistants || !!sched.finalized;
      const isReqLocked = !!sched.requestsLocked;

      setFinalizedNursesMonths(prev => {
        const key = `${currentYear}_${currentMonth}`;
        if (isFinNurses && !prev.includes(key)) return [...prev, key];
        if (!isFinNurses) return prev.filter(k => k !== key);
        return prev;
      });
      setFinalizedAssistantsMonths(prev => {
        const key = `${currentYear}_${currentMonth}`;
        if (isFinAssistants && !prev.includes(key)) return [...prev, key];
        if (!isFinAssistants) return prev.filter(k => k !== key);
        return prev;
      });
      setRequestsLockedMonths(prev => {
        const key = `${currentYear}_${currentMonth}`;
        if (isReqLocked && !prev.includes(key)) return [...prev, key];
        if (!isReqLocked) return prev.filter(k => k !== key);
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
        setLockedRows([]);
      } catch (error) {
        console.error(error);
      }
    }

    const execute = async () => {
      setPendingDbSaveCount(count => count + 1);
      if (showBusyOverlay) setBlockingDbSaveCount(count => count + 1);
      try {
        for (const mutation of mutations) {
          const versionId = versionIdForResource(mutation.resource);
          const expectedETag = storageVersionsRef.current[versionId];
          if (mutation.existed && !expectedETag) {
            throw new Error(`ETag منبع ${versionId} موجود نیست؛ ذخیره متوقف شد.`);
          }

          const response = await fetch('/api/storage', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(mutation.existed
                ? { 'If-Match': expectedETag }
                : { 'If-None-Match': '*' }),
            },
            body: JSON.stringify({ resource: mutation.resource, data: mutation.data }),
          });
          const result = await response.json();
          if (!response.ok || !result.success || !result.etag) {
            throw new Error(result.code === 'ETAG_CONFLICT'
              ? 'اطلاعات توسط کاربر دیگری تغییر کرده است؛ برای جلوگیری از بازنویسی، صفحه را تازه‌سازی کنید.'
              : result.error || `خطای ذخیره منبع ${versionId}`);
          }
          storageVersionsRef.current[versionId] = result.etag;
        }
      } catch (error) {
        // A batch can span multiple objects and S3 has no multi-object transaction.
        // Fail closed after any partial failure; a reload is required before more writes.
        storageWriteBlockedRef.current = true;
        throw error;
      } finally {
        setPendingDbSaveCount(count => Math.max(0, count - 1));
        if (showBusyOverlay) setBlockingDbSaveCount(count => Math.max(0, count - 1));
      }
    };

    const queuedSave = saveQueueRef.current.then(execute);
    saveQueueRef.current = queuedSave.catch(() => undefined);
    return queuedSave;
  };

  // Load whole state from S3 on mount or department/month change
  useEffect(() => {
    if (typeof window === 'undefined' || isAuthLoading || !authenticatedUser) return;

    const loadDatabase = async () => {
      const generation = ++storageLoadGenerationRef.current;
      storageLoadCountRef.current += 1;
      try {
        setIsLoadingDb(true);
        setIsPersonnelLoaded(false);
        setIsRequestsLoaded(false);
        // Reads and writes never overlap in this tab. This also prevents a late GET
        // from replacing newly written ETags with an older snapshot.
        await saveQueueRef.current;
        const res = await fetch('/api/storage', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok || !data.success || !data.state || !data.versions) {
          throw new Error(data.error || 'خواندن امن دیتابیس ناموفق بود.');
        }
        if (generation !== storageLoadGenerationRef.current) return;

        const updatedDb = data.state as AppDatabaseState;
        if (!updatedDb.departments.length) {
          throw new Error('فهرست بخش‌ها خالی است؛ مقداردهی خودکار برای حفاظت از داده غیرفعال است.');
        }

        storageVersionsRef.current = data.versions;
        optimisticDbRef.current = updatedDb;
        storageWriteBlockedRef.current = false;
        setFullDbState(updatedDb);
        setStorageInfo({
          isConfigured: data.isConfigured,
          bucket: data.bucket,
          environment: data.environment,
          source: data.source
        });
        setDepartments(updatedDb.departments);

        const requestedDeptId = selectedDepartmentId || 'sepehr';
        const deptId = updatedDb.deptData[requestedDeptId]
          ? requestedDeptId
          : updatedDb.departments[0].id;
        if (deptId !== requestedDeptId) {
          setSelectedDepartmentId(deptId);
          localStorage.setItem('hospital_selected_dept_id', deptId);
        }
        const deptInfo = updatedDb.deptData[deptId];
        if (!deptInfo) throw new Error(`داده بخش ${deptId} وجود ندارد.`);
          setPersonnel(deptInfo.personnel || []);
          setRequests(deptInfo.requests || []);
          setSettings(deptInfo.settings_system || INITIAL_SETTINGS);

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
            setLockedRows(sched.lockedRows || []);
            const isFinNurses = !!sched.finalizedNurses || !!sched.finalized;
            const isFinAssistants = !!sched.finalizedAssistants || !!sched.finalized;
            const isReqLocked = !!sched.requestsLocked;

            setFinalizedNursesMonths(prev => {
              const key = `${currentYear}_${currentMonth}`;
              if (isFinNurses && !prev.includes(key)) return [...prev, key];
              if (!isFinNurses) return prev.filter(k => k !== key);
              return prev;
            });
            setFinalizedAssistantsMonths(prev => {
              const key = `${currentYear}_${currentMonth}`;
              if (isFinAssistants && !prev.includes(key)) return [...prev, key];
              if (!isFinAssistants) return prev.filter(k => k !== key);
              return prev;
            });
            setRequestsLockedMonths(prev => {
              const key = `${currentYear}_${currentMonth}`;
              if (isReqLocked && !prev.includes(key)) return [...prev, key];
              if (!isReqLocked) return prev.filter(k => k !== key);
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
              setLockedRows([]);
            } catch (e) {
              console.error(e);
            }
          }
      } catch (err) {
        if (generation === storageLoadGenerationRef.current) {
          storageWriteBlockedRef.current = true;
          console.error("Error loading database from Iranian Object Storage S3:", err);
        }
      } finally {
        storageLoadCountRef.current = Math.max(0, storageLoadCountRef.current - 1);
        if (generation === storageLoadGenerationRef.current) {
          setIsLoadingDb(false);
          setIsPersonnelLoaded(true);
          setIsRequestsLoaded(true);
          setIsMonthLoaded(true);
          setDbChecked(true);
        }
      }
    };

    loadDatabase();
  }, [selectedDepartmentId, currentYear, currentMonth, authenticatedUser, isAuthLoading]);

  const extractWarningDay = (warningText: string) => {
    const dayMatch = warningText.match(/روز (\d+)/);
    return dayMatch ? parseInt(dayMatch[1], 10) : null;
  };

  // ====== تابع کلیک روی هشدار و اسکرول (درخواست ۴) ======
  const handleAlertClick = (personnelId: string, day: number) => {
    setTimeout(() => {
      const cellId = `cell-${personnelId}-${day}`;
      const element = document.getElementById(cellId);
      if (element) {
        setShowAlertCenter(false);
        setHighlightedCellId(cellId);
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          setHighlightedCellId(current => current === cellId ? null : current);
        }, 3200);
      }
    }, 100);
  };

  // ====== درخواست ۵: توابع مدیریت هشدارها ======
  const handleDismissAlert = (warningText: string) => {
    // اگر قبلاً نادیده گرفته شده، بازگردانی کن
    if (dismissedAlertWarnings[warningText]) {
      const newDismissed = { ...dismissedAlertWarnings };
      delete newDismissed[warningText];
      setDismissedAlertWarnings(newDismissed);
      // همچنین از dismissedWarnings حذف کن
      const updated = dismissedWarnings.filter(w => w !== warningText);
      setDismissedWarnings(updated);
      // ذخیره در دیتابیس
      const key = `${currentYear}_${currentMonth}`;
      const nextDb = getFreshDbCopy();
      const deptId = selectedDepartmentId || 'sepehr';
      const oldDept = nextDb.deptData[deptId];
      if (oldDept && oldDept.schedules?.[key]) {
        const updatedDept = {
          ...oldDept,
          schedules: {
            ...oldDept.schedules,
            [key]: {
              ...oldDept.schedules[key],
              dismissedWarnings: updated
            }
          }
        };
        nextDb.deptData[deptId] = updatedDept;
        saveDbState(nextDb, { showBusyOverlay: false });
      }
    } else {
      setDismissedAlertWarnings(prev => ({
        ...prev,
        [warningText]: true
      }));
      handleDismissWarning(warningText);
    }
  };

  const getVisibleWarnings = () => {
    if (!schedule) return [];
    // هشدارهایی که نه در dismissedWarnings هستند و نه در dismissedAlertWarnings
    const visible = filterActiveWarnings(schedule.warnings, dismissedWarnings)
      .filter(w => !dismissedAlertWarnings[w]);
    return visible;
  };

  const handleRestoreAllWarnings = async () => {
    setDismissedWarnings([]);
    setDismissedAlertWarnings({});

    const key = `${currentYear}_${currentMonth}`;
    const nextDb = getFreshDbCopy();
    const deptId = selectedDepartmentId || 'sepehr';
    const oldDept = nextDb.deptData[deptId];

    if (oldDept && oldDept.schedules?.[key]) {
      nextDb.deptData[deptId] = {
        ...oldDept,
        schedules: {
          ...oldDept.schedules,
          [key]: {
            ...oldDept.schedules[key],
            dismissedWarnings: []
          }
        }
      };
      await saveDbState(nextDb, { showBusyOverlay: false });
    }
  };

  const visibleWarnings = React.useMemo(() => {
    if (!schedule) return [];
    return filterActiveWarnings(schedule.warnings, dismissedWarnings)
      .filter(w => !dismissedAlertWarnings[w]);
  }, [schedule, dismissedWarnings, dismissedAlertWarnings]);

  const aggregatedAlerts = React.useMemo<AggregatedAlert[]>(() => {
    return aggregateWarnings(visibleWarnings, personnel);
  }, [visibleWarnings, personnel]);

  // تمام هشدارها (شامل نادیده‌گرفته‌شده‌ها) برای پنجره هشدار
  const allAlertsForDialog = React.useMemo<AggregatedAlert[]>(() => {
    if (!schedule) return [];
    // فقط dismissedWarnings (ذخیره‌شده در دیتابیس) فیلتر شوند، نه dismissedAlertWarnings
    const warningsForDialog = filterActiveWarnings(schedule.warnings, dismissedWarnings);
    return aggregateWarnings(warningsForDialog, personnel);
  }, [schedule, dismissedWarnings, personnel]);

  const smartSuggestions = React.useMemo<SmartSuggestion[]>(() => {
    if (!schedule) return [];
    return generateSmartSuggestions(
      currentYear,
      currentMonth,
      personnel,
      requests,
      schedule.assignments,
      visibleWarnings,
      customHolidays,
      firstDayOfWeekIndex
    );
  }, [schedule, currentYear, currentMonth, personnel, requests, customHolidays, firstDayOfWeekIndex, visibleWarnings]);

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
    fdIndex?: number | ScheduleUpdateStrategy,
    strategy?: ScheduleUpdateStrategy
  ) => {
    try {
      let activeFd: number;
      let finalStrategy: ScheduleUpdateStrategy = { mode: 'preserve_current' };

      if (typeof fdIndex === 'number') {
        activeFd = fdIndex;
        finalStrategy = strategy || { mode: 'preserve_current' };
      } else {
        activeFd = firstDayOfWeekIndex !== undefined ? firstDayOfWeekIndex : -1;
        finalStrategy = (fdIndex as ScheduleUpdateStrategy) || { mode: 'preserve_current' };
      }

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

      const isLockedNurses = finalizedNursesMonths.includes(monthKey);
      const isLockedAssistants = finalizedAssistantsMonths.includes(monthKey);
      const isReqLocked = requestsLockedMonths.includes(monthKey);
      let solved: MonthlySchedule;

      if (currentMonthSchedule && finalStrategy.mode !== 'full_resolve') {
        const preservedAssignments = normalizeScheduleAssignments(currentMonthSchedule.assignments, updatedP);
        let nextAssignments = preservedAssignments;

        if (finalStrategy.mode === 'refresh_personnel' || finalStrategy.mode === 'refresh_group') {
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

          const targetPersonnelIds = (finalStrategy.mode === 'refresh_personnel'
            ? Array.from(new Set(finalStrategy.personnelIds || []))
            : updatedP
                .filter(person => person.jobGroup === finalStrategy.jobGroup)
                .map(person => person.id)
          ).filter(id => {
            const p = updatedP.find(per => per.id === id);
            if (!p) return false;
            // چک قفل گروهی و قفل ردیف فردی
            if (lockedRows.includes(id)) return false;
            return p.jobGroup === 'nurse' ? !isLockedNurses : !isLockedAssistants;
          });

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
        const freshSolved = solveNursingSchedule(currentYear, currentMonth, updatedP, updatedR, updatedS, updatedH, activeFd === -1 ? undefined : activeFd, calculatedMonthlyDutyHours);

        if (currentMonthSchedule) {
          const nextAssignments = normalizeScheduleAssignments(currentMonthSchedule.assignments, updatedP);
          for (const p of updatedP) {
            const isLocked = p.jobGroup === 'nurse' ? isLockedNurses : isLockedAssistants;
            // چک قفل گروهی و قفل ردیف فردی - اگر قفل باشد، شیفت‌های این پرسنل تغییر نمی‌کند
            if (!isLocked && !lockedRows.includes(p.id)) {
              nextAssignments[p.id] = { ...(freshSolved.assignments[p.id] || {}) };
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
          solved = freshSolved;
        }
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
            finalizedNurses: isLockedNurses,
            finalizedAssistants: isLockedAssistants,
            requestsLocked: isReqLocked,
            dismissedWarnings: dismissedWarnings,
            lockedRows: lockedRows,
            changeLogs: schedule?.changeLogs || []
          }
        }
      };

      nextDb.deptData[deptId] = updatedDept;
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
    let wasLocked = jobGroup === 'nurse' ? finalizedNursesMonths.includes(key) : finalizedAssistantsMonths.includes(key);
    if (wasLocked) {
      const groupTitle = jobGroup === 'nurse' ? 'پرستاران' : 'کمک‌بهیاران';
      const confirmUnlock = confirm(`برنامه این ماه ثبت نهایی و قفل شده است. آیا مایلید قفل لیست را باز کرده و بازتولید هوشمند ${groupTitle} را اجرا کنید؟`);
      if (!confirmUnlock) return;
    }

    setSolvingTarget(jobGroup);
    setTimeout(async () => {
      try {
        const optimized = solveWithPriority(
          currentYear,
          currentMonth,
          personnel,
          requests,
          settings,
          customHolidays,
          firstDayOfWeekIndex,
          monthlyDutyHours
        );

        const baseAssignments = normalizeScheduleAssignments(schedule?.assignments, personnel);
        const mergedAssignments = schedule
          ? { ...baseAssignments }
          : normalizeScheduleAssignments(optimized.assignments, personnel);

        // فقط پرسنلی که قفل نیستند تغییر کنند
        const targetPersonnel = personnel.filter(p => p.jobGroup === jobGroup && !lockedRows.includes(p.id));
        for (const person of targetPersonnel) {
          mergedAssignments[person.id] = { ...(optimized.assignments[person.id] || {}) };
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
          schedules: {
            ...oldDept.schedules,
            [`${currentYear}_${currentMonth}`]: {
              ...(schedule || { year: currentYear, month: currentMonth, assignments: {}, shiftLeaders: {}, warnings: [] }),
              year: currentYear,
              month: currentMonth,
              assignments: mergedAssignments,
              shiftLeaders: verification.shiftLeaders,
              warnings: verification.warnings,
              ...(jobGroup === 'nurse' ? { finalizedNurses: false } : { finalizedAssistants: false }),
              dismissedWarnings: dismissedWarnings,
              lockedRows: lockedRows
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

  const handleToggleLock = async (jobGroup: JobGroup) => {
    if (role === 'personnel') return;
    try {
      const key = `${currentYear}_${currentMonth}`;
      const isNurse = jobGroup === 'nurse';
      const isLocked = isNurse ? finalizedNursesMonths.includes(key) : finalizedAssistantsMonths.includes(key);
      const groupTitle = isNurse ? 'پرستاران' : 'کمک‌بهیاران';

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

      const existingSched = oldDept.schedules?.[key];
      if (!existingSched) {
        alert("جدول شیفتی یافت نشد.");
        return;
      }

      const updatedLogs = [...(existingSched.changeLogs || []), `تغییر وضعیت قفل ${groupTitle}: ${!isLocked ? 'قفل شد' : 'باز شد'} در تاریخ ${new Date().toLocaleString('fa-IR')}`];

      const updatedDept = {
        ...oldDept,
        schedules: {
          ...oldDept.schedules,
          [key]: {
            ...existingSched,
            ...(isNurse ? { finalizedNurses: !isLocked } : { finalizedAssistants: !isLocked }),
            changeLogs: updatedLogs
          }
        }
      };

      nextDb.deptData[deptId] = updatedDept;
      await saveDbState(nextDb);
      alert(`لیست شیفت‌های ${groupTitle} ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} با موفقیت ${!isLocked ? 'قفل گردید' : 'باز شد'}.`);
    } catch (error) {
      console.error("Error toggling lock:", error);
      alert("خطا در تغییر وضعیت قفل: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleToggleRequestsLock = async () => {
    if (role === 'personnel') return;
    try {
      const key = `${currentYear}_${currentMonth}`;
      const isLocked = requestsLockedMonths.includes(key);

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

      const existingSched = oldDept.schedules?.[key];

      const updatedLogs = existingSched ? [...(existingSched.changeLogs || []), `تغییر وضعیت مهلت درخواست‌ها: ${!isLocked ? 'بسته شد' : 'باز شد'} در تاریخ ${new Date().toLocaleString('fa-IR')}`] : [`تغییر وضعیت مهلت درخواست‌ها: ${!isLocked ? 'بسته شد' : 'باز شد'} در تاریخ ${new Date().toLocaleString('fa-IR')}`];

      const updatedDept = {
        ...oldDept,
        schedules: {
          ...oldDept.schedules,
          [key]: {
            ...(existingSched || { year: currentYear, month: currentMonth, assignments: {}, shiftLeaders: {}, warnings: [] }),
            requestsLocked: !isLocked,
            changeLogs: updatedLogs
          }
        }
      };

      nextDb.deptData[deptId] = updatedDept;
      await saveDbState(nextDb);
      alert(`مهلت ثبت درخواست‌های ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} با موفقیت ${!isLocked ? 'بسته شد' : 'تمدید شد'}.`);
    } catch (error) {
      console.error("Error toggling requests lock:", error);
      alert("خطا در تغییر وضعیت مهلت درخواست‌ها: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleDismissWarning = async (warnText: string) => {
    try {
      const updated = [...dismissedWarnings, warnText];
      const key = `${currentYear}_${currentMonth}`;

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
      await saveDbState(nextDb, { showBusyOverlay: false });
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

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setAuthenticatedUser(null);
      setRole('guest');
      localStorage.removeItem('hospital_saved_role');
      localStorage.removeItem('hospital_saved_personnel_id');
      router.replace('/');
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
          orderIndex: personnel.length
        };
        updatedList = [...personnel, pData];
      }

      await saveState(updatedList, requests, settings, customHolidays, { mode: 'full_resolve' });
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
      await saveState(updatedP, updatedR, settings, customHolidays, { mode: 'full_resolve' });
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
      isEssential: role === 'personnel' ? false : reqIsEssential,
      scope: reqScope,
      startDate: reqScope === 'range' ? reqStartDate : undefined,
      endDate: reqScope === 'range' ? reqEndDate : undefined,
      selectedDays: reqScope === 'custom_days' ? reqSelectedDays : undefined
    };

    setDraftRequests([...draftRequests, reqData]);
    setReqSelectedDays([]);
  };

  const handleFinalSubmitRequests = async () => {
    const pid = role === 'personnel' && selectedPersonnelUser ? selectedPersonnelUser.id : reqPersonnelId;
    if (!pid) {
      alert('لطفاً پرسنل مورد نظر را انتخاب کنید.');
      return;
    }

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
        const finalId = reqData.id.startsWith('draft_') ? `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}` : reqData.id;
        const finalReq = { ...reqData, id: finalId };
        updatedR.push(finalReq);
      }

      await saveState(
        personnel,
        updatedR,
        settings,
        customHolidays,
        {
          mode: 'refresh_personnel',
          personnelIds: Array.from(new Set(finalRequestsToSave.map(req => req.personnelId)))
        }
      );
      setShowAddRequestModal(false);

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
    if (role === 'personnel' && requestsLockedMonths.includes(`${currentYear}_${currentMonth}`)) {
      alert('مهلت ثبت و ویرایش درخواست برای این ماه به پایان رسیده است.');
      return;
    }
    if (!confirm(`آیا مطمئن هستید که می‌خواهید تمام درخواست‌های ثبت‌شده ${name} را حذف کنید؟`)) {
      return;
    }
    try {
      const updatedR = requests.filter(r => r.personnelId !== personId);
      await saveState(personnel, updatedR, settings, customHolidays, {
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

    if (role === 'personnel' && requestsLockedMonths.includes(`${currentYear}_${currentMonth}`)) {
      alert('مهلت ثبت درخواست برای این ماه به پایان رسیده است.');
      return;
    }

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
      await handleFinalSubmitRequests();
    }
  };

  const handleDeleteRequest = async (id: string) => {
    if (role === 'personnel' && requestsLockedMonths.includes(`${currentYear}_${currentMonth}`)) {
      alert('مهلت ثبت و ویرایش درخواست برای این ماه به پایان رسیده است.');
      return;
    }
    try {
      const deletedRequest = requests.find(r => r.id === id);
      const updatedR = requests.filter(r => r.id !== id);
      await saveState(
        personnel,
        updatedR,
        settings,
        customHolidays,
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
      const p = personnel.find(per => per.id === pId);
      if (p) {
        const monthKey = `${currentYear}_${currentMonth}`;
        const isLocked = p.jobGroup === 'nurse' ? finalizedNursesMonths.includes(monthKey) : finalizedAssistantsMonths.includes(monthKey);
        if (isLocked) {
          alert(`برنامه ${p.jobGroup === 'nurse' ? 'پرستاران' : 'کمک‌بهیاران'} قفل شده است و امکان ویرایش دستی وجود ندارد.`);
          return;
        }
        if (lockedRows.includes(pId)) {
          alert('این ردیف قفل شده است و نمی‌توان آن را ویرایش کرد.');
          return;
        }
      }
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
        schedules: {
          ...oldDept.schedules,
          [`${currentYear}_${currentMonth}`]: {
            year: currentYear,
            month: currentMonth,
            assignments: updatedAssignments,
            shiftLeaders: verification.shiftLeaders,
            warnings: verification.warnings,
            finalized: false,
            dismissedWarnings: dismissedWarnings,
            lockedRows: lockedRows
          }
        }
      };

      nextDb.deptData[deptId] = updatedDept;
      await saveDbState(nextDb, { showBusyOverlay: false });

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
      await saveState(personnel, requests, settings, customHolidays, { mode: 'full_resolve' });
      alert('تنظیمات موظفی و نیاز نیرویی با موفقیت ذخیره شد.');
    } catch (error) {
      console.error("Error saving settings:", error);
    }
  };

  // --- Holiday Management ---
  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!holidayTitleInput.trim()) return;
    try {
      const updated = { ...customHolidays, [holidayDayInput]: holidayTitleInput.trim() };
      setCustomHolidays(updated);
      await saveState(personnel, requests, settings, updated, { mode: 'full_resolve' });
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
      await saveState(personnel, requests, settings, updated, { mode: 'full_resolve' });
    } catch (error) {
      console.error("Error removing holiday:", error);
    }
  };

  // --- Reporting Exports ---
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

    const startDayIndex = firstDayOfWeekIndex !== undefined
      ? firstDayOfWeekIndex
      : getJalaliWeekday(currentYear, currentMonth, 1);
    const calendarDays = generateJalaliMonthCalendar(currentYear, currentMonth, customHolidays, startDayIndex);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('برنامه کاری پرستاری');

    worksheet.views = [{ showGridLines: true, rtl: true } as any];

    worksheet.pageSetup = {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0
    };

    const titleFont = { name: 'B Titr', size: 16, bold: true, color: { argb: 'FF1E293B' } };
    const headFont = { name: 'B Titr', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    const bodyFont = { name: 'B Nazanin', size: 11 };
    const boldBodyFont = { name: 'B Nazanin', size: 11, bold: true };
    const kpiFont = { name: 'B Nazanin', size: 11, bold: true, color: { argb: 'FF065F46' } };

    const centerAlign = { vertical: 'middle' as const, horizontal: 'center' as const, wrapText: true };
    const rightAlign = { vertical: 'middle' as const, horizontal: 'right' as const };

    const totalCols = 3 + calendarDays.length + 6;
    const lastColLetter = getExcelColumnLetter(totalCols);
    worksheet.mergeCells(`A1:${lastColLetter}1`);

    const titleCell = worksheet.getCell('A1');
    titleCell.value = `جدول هوشمند و برنامه شیفت‌بندی پرستاری - ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} سال ${currentYear}`;
    titleCell.font = titleFont;
    titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
    worksheet.getRow(1).height = 42;

    worksheet.getRow(2).height = 10;

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

    const primaryColor = 'FF4F46E5';
    const weekendColor = 'FFE11D48';
    const kpiColor = 'FF059669';

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
            fgColor: { argb: weekendColor }
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
          cleanS = s.substring(1) as ShiftType;
        }

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
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFC7CE' }
            };

            if (val === 'آف') {
              cell.font = { name: 'B Nazanin', size: 11, bold: true, color: { argb: 'FF9C0006' } };
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

    worksheet.getColumn(1).width = 25;
    worksheet.getColumn(2).width = 15;
    worksheet.getColumn(3).width = 15;

    for (let c = 4; c <= 3 + calendarDays.length; c++) {
      worksheet.getColumn(c).width = 14;
    }

    const startKpiCol = 4 + calendarDays.length;
    const endKpiCol = 9 + calendarDays.length;
    for (let c = startKpiCol; c <= endKpiCol; c++) {
      worksheet.getColumn(c).width = 11;
    }

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
  const calendarDays = officialCalendarState.calendar?.days || [];

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
          : isBlockingDbSave
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

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100" dir="rtl">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
          <p className="mt-4 text-sm font-black text-slate-600">در حال بررسی ورود امن...</p>
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
        {pendingLogin && (
          <WelcomeOverlay
            firstName={pendingLogin.user.firstName}
            lastName={pendingLogin.user.lastName}
            onComplete={finishWelcome}
          />
        )}
        <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:16px_16px] opacity-70"></div>
        <div className="max-w-4xl w-full bg-white border border-slate-200/85 shadow-2xl rounded-3xl p-6 sm:p-10 text-center relative z-10 overflow-hidden">
          <div className="absolute top-0 bottom-0 right-0 w-2.5 bg-gradient-to-b from-emerald-600 via-teal-500 to-indigo-600"></div>

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

            <div className="bg-slate-50/70 border border-slate-200 p-6 rounded-2xl hover:border-emerald-400 hover:bg-slate-50 transition-all flex flex-col justify-between" id="portal-personnel">
              <div>
                <div className="flex justify-center mb-3">
                  <span className="bg-emerald-100/80 text-emerald-600 p-3 rounded-xl"><Users className="w-6 h-6"/></span>
                </div>
                <h3 className="font-extrabold text-slate-800 text-base mb-1">ورود کادر درمان کشیک</h3>
                <p className="text-[11px] text-slate-500 leading-relaxed mb-4">جهت ورود و ثبت درخواست‌ها، کد ملی و کلمه عبور خود را وارد نمایید.</p>
              </div>
              <div className="space-y-2 text-right pt-4">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="username"
                  maxLength={10}
                  placeholder="کد ملی"
                  value={staffNationalIdInput}
                  onChange={(e) => setStaffNationalIdInput(e.target.value)}
                  className="w-full text-xs font-black bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-emerald-500 focus:outline-none text-slate-800 text-center font-sans placeholder-slate-400"
                  id="login-personnel-national-id"
                />
                <input
                  type="password"
                  placeholder="کلمه عبور (پیش‌فرض ۱۲۳۴)"
                  value={staffPasswordInput}
                  onChange={(e) => setStaffPasswordInput(e.target.value)}
                  className="w-full text-xs font-black bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-emerald-500 focus:outline-none text-slate-800 text-center font-mono placeholder-slate-400"
                  id="login-personnel-pass"
                />

                <button
                  onClick={() => void handlePortalLogin('staff')}
                  disabled={isPortalSubmitting}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs py-3.5 rounded-xl transition-all cursor-pointer shadow-md hover:scale-[1.01] mt-2"
                  id="btn-login-personnel"
                >
                  ورود به پرتال شخصی کادر درمان
                </button>
                <button
                  type="button"
                  onClick={() => void handleStaffForgotPassword()}
                  disabled={isPortalSubmitting || isResetRequestSubmitting}
                  className="w-full text-xs font-black text-indigo-700 hover:text-indigo-800 hover:bg-indigo-50 px-4 py-2.5 rounded-xl transition-all cursor-pointer disabled:opacity-60"
                >
                  {isResetRequestSubmitting ? 'در حال ثبت درخواست...' : 'فراموشی رمز عبور'}
                </button>
                {staffAuthNotice && (
                  <div className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl p-3 font-black text-center" role="status">
                    {staffAuthNotice}
                  </div>
                )}
              </div>
            </div>

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
                  onClick={() => void handlePortalLogin('head-nurse')}
                  disabled={isPortalSubmitting}
                  className="w-full bg-sky-600 hover:bg-sky-700 text-white font-extrabold text-xs py-3.5 rounded-xl transition-all cursor-pointer shadow-md hover:scale-[1.01] mt-2"
                  id="btn-login-headnurse"
                >
                  {isNewDeptWithDefaults ? 'ثبت و ورود اولین‌بار سرپرستار' : 'ورود سرپرستار بخش'}
                </button>
              </div>
            </div>

          </div>
        </div>

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


  if (!authenticatedUser) {
    return null;
  }

  return (
    <div className="flex flex-col min-h-screen h-screen w-full overflow-hidden bg-slate-50 font-sans" dir="rtl">
      {busyOverlaySubtitle && <BusyOverlay subtitle={busyOverlaySubtitle} />}

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

            <nav className="flex-1 py-4 text-sm font-semibold space-y-1 overflow-y-auto">

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

              {(role === 'admin' || role === 'headnurse') && (
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

            <div className="p-4 border-t border-slate-700/80 space-y-4">

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

      <main className="flex-1 flex flex-col h-full overflow-hidden">

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
            {role === 'admin' ? (
              <select
                value={selectedDepartmentId}
                onChange={event => {
                  setSelectedDepartmentId(event.target.value);
                  localStorage.setItem('hospital_selected_dept_id', event.target.value);
                }}
                className="hidden max-w-44 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700 outline-none md:block"
                aria-label="انتخاب بخش"
              >
                {departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select>
            ) : (
              <div className="hidden rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700 md:flex">
                {departments.find(d => d.id === selectedDepartmentId)?.name || 'بخش سپهر'}
              </div>
            )}
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-black text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-full border border-blue-100">
              <span className={`w-2 h-2 rounded-full ${isSavingDb ? 'bg-orange-500 animate-pulse' : (isLoadingDb ? 'bg-blue-400 animate-pulse' : 'bg-emerald-500')}`} />
              <span>پشتیبان‌گیری ابری:</span>
              <span className="font-mono text-[9px] text-blue-600 bg-blue-100/60 px-1.5 py-0.5 rounded-md">Arvan S3</span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="text-right hidden sm:block">
              <p className="font-black text-slate-800">{authenticatedUser.firstName} {authenticatedUser.lastName}</p>
              <p className="text-slate-500 text-[10px] text-right font-medium mt-0.5">
                {role === 'admin' ? 'مدیر سامانه' : role === 'headnurse' ? 'مدیریت برنامه‌ریزی بخش' : 'کارشناس پرستاری'}
              </p>
            </div>
            <div className="w-10 h-10 bg-gradient-to-tr from-emerald-500 to-teal-600 rounded-full flex items-center justify-center font-bold text-white shadow-md text-sm cursor-pointer select-none">
              {authenticatedUser.firstName[0]}{authenticatedUser.lastName[0]}
            </div>
          </div>
        </header>

        <div className="bg-white border-b border-slate-100 px-6 sm:px-8 py-3 flex items-center gap-3 overflow-x-auto print:hidden shrink-0 shadow-2xs scrollbar-none">
          <div className="flex items-center gap-2 bg-slate-100 border border-slate-200 rounded-full px-2 py-1 shrink-0">
             <button onClick={() => {
                setCurrentYear(y => {
                  const newY = y - 1;
                  if (typeof window !== 'undefined') localStorage.setItem('hospital_current_year', String(newY));
                  return newY;
                });
             }} className="p-1 text-slate-500 hover:text-emerald-600 transition-colors"><ChevronRight className="w-4 h-4"/></button>
             <span className="text-xs font-black text-slate-800 w-10 text-center">{currentYear}</span>
             <button onClick={() => {
                setCurrentYear(y => {
                  const newY = y + 1;
                  if (typeof window !== 'undefined') localStorage.setItem('hospital_current_year', String(newY));
                  return newY;
                });
             }} className="p-1 text-slate-500 hover:text-emerald-600 transition-colors"><ChevronLeft className="w-4 h-4"/></button>
          </div>
          <div className="w-px h-6 bg-slate-200 shrink-0 hidden sm:block"></div>
          {JALALI_MONTH_NAMES.map((name, idx) => {
            const mNum = idx + 1;
            const isActive = currentMonth === mNum;
            return (
              <button
                key={name}
                type="button"
                onClick={() => handleSelectMonth(mNum)}
                className={`px-4 py-1.5 rounded-full text-[11px] font-black shrink-0 transition-all cursor-pointer ${
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

        <div className="flex-1 p-6 space-y-6 overflow-y-auto bg-slate-50 print:p-0 print:bg-white text-slate-800">
          <TehranDateTime lastSync={calendarSyncedAt} />
          {(role === 'headnurse' || role === 'admin') && <ResetRequestList />}
          {officialCalendarState.status !== 'ready' && (
            <div className={`rounded-2xl border p-4 text-xs font-black print:hidden ${officialCalendarState.status === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-sky-200 bg-sky-50 text-sky-700'}`} role="status">
              {officialCalendarState.status === 'error' ? 'اتصال به تقویم رسمی کشور برقرار نشد؛ لطفاً اتصال اینترنت را بررسی و صفحه را تازه‌سازی کنید.' : 'در حال همگام‌سازی کامل روزها، مناسبت‌ها و تعطیلات رسمی ماه انتخاب‌شده…'}
            </div>
          )}

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

          {/* ====== مرکز هشدارها فقط برای داشبورد سرپرستار ====== */}
          {role === 'headnurse' && activeTab === 'schedule' && schedule && getVisibleWarnings().length > 0 && (
            <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
              <div className="bg-amber-50/70 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    <h3 className="text-sm font-black text-slate-800">
                      مرکز هشدارهای باقی‌مانده
                    </h3>
                    <span className="bg-amber-100 text-amber-800 text-xs font-black px-2.5 py-0.5 rounded-full">
                      {getVisibleWarnings().length} مورد
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-600">
                    هشدارها فقط در داشبورد پنل سرپرستار نمایش داده می‌شوند و با یک کلیک در پنجره جداگانه باز خواهند شد.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAlertCenter(true)}
                    className="text-xs bg-amber-500 hover:bg-amber-600 text-white font-black px-4 py-2 rounded-xl transition-all cursor-pointer shadow-sm"
                  >
                    مشاهده هشدارها در پنجره
                  </button>
                  {dismissedWarnings.length > 0 && (
                    <button
                      onClick={handleRestoreAllWarnings}
                      className="text-amber-700 hover:text-amber-950 font-bold text-[10px] bg-amber-100/70 border border-amber-200 hover:bg-amber-200/80 px-2.5 py-1 rounded-lg transition-all cursor-pointer"
                    >
                      بازیابی همه ({dismissedWarnings.length})
                    </button>
                  )}
                </div>
              </div>

              {/* بخش پیشنهادات هوشمند حذف شد */}
              {false && (
                <div className="bg-indigo-50/80 border-b border-indigo-200 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-indigo-800">💡 پیشنهادات هوشمند برای رفع تناقضات:</span>
                    <span className="text-[10px] text-indigo-600 font-bold">
                      {smartSuggestions.reduce((acc, s) => acc + Math.abs(s.impact.warningCountChange), 0)} مشکل قابل حل
                    </span>
                  </div>
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {smartSuggestions.map((suggestion) => (
                      <div key={suggestion.id} className="bg-white/70 rounded-lg p-2.5 border border-indigo-100 flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="text-xs font-bold text-slate-700">{suggestion.description}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {suggestion.impact.resolvedWarnings.length > 0 && (
                              <span className="text-emerald-600">✔ {suggestion.impact.resolvedWarnings.length} هشدار رفع می‌شود</span>
                            )}
                            {suggestion.impact.newWarnings.length > 0 && (
                              <span className="text-amber-600 mr-2">✖ {suggestion.impact.newWarnings.length} هشدار جدید</span>
                            )}
                            <span className="mr-2 text-indigo-600">
                              {suggestion.impact.warningCountChange < 0 ? `⬇ ${Math.abs(suggestion.impact.warningCountChange)}` : ''}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={async () => {
                            const change = suggestion.changes[0];
                            if (change && schedule) {
                              const updatedAssignments = { ...schedule.assignments };
                              if (!updatedAssignments[change.personnelId]) updatedAssignments[change.personnelId] = {};
                              updatedAssignments[change.personnelId][change.day] = change.toShift;

                              const verification = verifyCoverageAndLeaders(
                                currentYear, currentMonth, personnel, updatedAssignments,
                                settings, customHolidays, firstDayOfWeekIndex, requests
                              );

                              const nextDb = getFreshDbCopy();
                              const deptId = selectedDepartmentId || 'sepehr';
                              const oldDept = nextDb.deptData[deptId];
                              if (oldDept) {
                                const key = `${currentYear}_${currentMonth}`;
                                const updatedDept = {
                                  ...oldDept,
                                  schedules: {
                                    ...oldDept.schedules,
                                    [key]: {
                                      year: currentYear,
                                      month: currentMonth,
                                      assignments: updatedAssignments,
                                      shiftLeaders: verification.shiftLeaders,
                                      warnings: verification.warnings,
                                      dismissedWarnings: dismissedWarnings,
                                      lockedRows: lockedRows
                                    }
                                  }
                                };
                                nextDb.deptData[deptId] = updatedDept;
                                await saveDbState(nextDb, { showBusyOverlay: false });
                                setShowSuggestions(false);
                              }
                            }
                          }}
                          className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer shrink-0"
                        >
                          اعمال
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="text-[9px] text-slate-400 font-bold text-center pt-1">
                    با اعمال هر پیشنهاد، سیستم به صورت خودکار بازتولید می‌شود
                  </div>
                </div>
              )}


            </div>
          )}

          {(activeTab === 'schedule' || activeTab === 'reports') && (
            <>
              {role !== 'personnel' ? (
                <div className="grid grid-cols-2 gap-4 print:hidden lg:grid-cols-4">
                  <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="text-slate-500 text-[10px] font-black mb-1">کل پرسنل فعال</div>
                      <div className="text-2xl font-black text-slate-900 font-mono">{personnel.filter(p => p.active).length} نفر</div>
                    </div>
                    <div className="text-indigo-600 text-[10px] mt-2 font-bold bg-indigo-50 border border-indigo-100/50 px-2 py-0.5 rounded w-max">
                      نیروی سازمان‌دهی شده
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

                  <div className="col-span-2 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-slate-800 text-xs font-black">ساعت موظفی بر اساس شیوه استخدام</div>
                        <div className="text-slate-400 text-[9px] font-bold mt-1">
                          {monthlyDutyHours ? 'مقادیر تصویب‌شده برای ماه جاری' : 'مقادیر پایه تنظیمات استخدامی'}
                        </div>
                      </div>
                      <span className="shrink-0 rounded-lg bg-emerald-50 p-2 text-emerald-600">
                        <Clock className="h-4 w-4" />
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2" dir="rtl">
                      {[
                        { label: 'رسمی', value: effectiveDutyHours.official, tone: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
                        { label: 'قراردادی', value: effectiveDutyHours.contract, tone: 'bg-sky-50 text-sky-700 border-sky-100' },
                        { label: 'طرح / وظیفه', value: effectiveDutyHours.conscript, tone: 'bg-violet-50 text-violet-700 border-violet-100' }
                      ].map((item) => (
                        <div key={item.label} className={`rounded-lg border px-2 py-2.5 text-center ${item.tone}`}>
                          <div className="text-[9px] font-black sm:text-[10px]">{item.label}</div>
                          <div className="mt-1 whitespace-nowrap font-mono text-lg font-black sm:text-xl">
                            {item.value} <span className="font-sans text-[9px] font-bold">ساعت</span>
                          </div>
                        </div>
                      ))}
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
                        {calendarDays.map((d) => {
                          const hasOccasion = (calendarOccasions[d.day] || []).length > 0;
                          return (
                            <button
                              type="button"
                              key={d.day}
                              onClick={() => setSelectedCalendarDay(d.day)}
                              className={`relative flex min-h-11 flex-col items-center justify-center rounded-xl border p-2 transition-all ${
                                d.isHoliday
                                  ? 'border-rose-200 bg-rose-50 text-rose-700 shadow-sm'
                                  : 'border-slate-100 bg-white text-slate-700 hover:border-emerald-300 hover:bg-emerald-50'
                              } ${selectedCalendarDay === d.day ? 'ring-2 ring-emerald-500 ring-offset-1' : ''}`}
                              aria-label={`روز ${d.day}${d.isHoliday ? '، تعطیل' : ''}`}
                            >
                              <span className="block font-mono text-xs font-black">{d.day}</span>
                              {hasOccasion && <span className={`mt-1 h-1.5 w-1.5 rounded-full ${d.isHoliday ? 'bg-rose-500' : 'bg-indigo-500'}`} />}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-3 text-[9px] font-bold text-slate-500">
                        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-rose-100 ring-1 ring-rose-300" /> تعطیل رسمی</span>
                        <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-indigo-500" /> دارای مناسبت</span>
                      </div>
                      {selectedCalendarDay !== null && (
                        <div className={`mt-4 rounded-2xl border p-4 text-right ${calendarDays.find(day => day.day === selectedCalendarDay)?.isHoliday ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50'}`}>
                          <div className="flex items-center justify-between gap-2">
                            <strong className="text-xs text-slate-800">{selectedCalendarDay} {JALALI_MONTH_NAMES[currentMonth - 1]} {currentYear}</strong>
                            {calendarDays.find(day => day.day === selectedCalendarDay)?.isHoliday && <span className="rounded-full bg-rose-600 px-2 py-1 text-[9px] font-black text-white">تعطیل رسمی</span>}
                          </div>
                          <p className="mt-2 text-[11px] font-bold leading-6 text-slate-600">
                            {(calendarOccasions[selectedCalendarDay] || []).join('، ') || customHolidays[selectedCalendarDay] || (calendarDays.find(day => day.day === selectedCalendarDay)?.isFriday ? 'جمعه؛ تعطیل هفتگی' : 'مناسبت رسمی ثبت نشده است.')}
                          </p>
                        </div>
                      )}
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
                        {effectiveDutyHours[selectedPersonnelUser?.employmentType || 'official']} <span className="text-lg font-sans font-extrabold text-emerald-700/60">ساعت</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'schedule' && (
            <div className="space-y-6">

              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4 print:hidden">
                <div className="flex items-center gap-3">
                  <h3 className="font-extrabold text-slate-800 text-sm">لیست شیفت‌های ماهانه</h3>
                  <p className="text-slate-400 text-xs font-semibold">تعداد روزها: {calendarDays.length} روز / {calendarDays.filter(c => c.isHoliday).length} روز تعطیلات</p>
                </div>

                <div className="flex items-center gap-2">
                  {role !== 'personnel' && (
                    <>
                      {finalizedNursesMonths.includes(`${currentYear}_${currentMonth}`) ? (
                        <button
                          onClick={() => handleToggleLock('nurse')}
                          className="flex items-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 text-xs font-black px-3.5 py-2 rounded-xl border border-emerald-200 transition-all cursor-pointer shadow-xs"
                          title="قفل پرستاران این ماه فعال است. برای باز کردن کلیک کنید"
                        >
                          <Lock className="w-4 h-4 text-emerald-600 animate-[pulse_2s_infinite]"/>
                          <span>قفل پرستاران (باز کردن)</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleToggleLock('nurse')}
                          className="flex items-center gap-1.5 bg-slate-50 hover:bg-emerald-600 hover:text-white text-slate-700 text-xs font-black px-3.5 py-2 rounded-xl border border-slate-200 hover:border-emerald-600 transition-all cursor-pointer shadow-xs"
                          title="ثبت نهایی و قفل برنامه پرستاران"
                        >
                          <Unlock className="w-4 h-4 text-slate-500 hover:text-inherit"/>
                          <span>قفل پرستاران</span>
                        </button>
                      )}

                      {finalizedAssistantsMonths.includes(`${currentYear}_${currentMonth}`) ? (
                        <button
                          onClick={() => handleToggleLock('assistant')}
                          className="flex items-center gap-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 text-xs font-black px-3.5 py-2 rounded-xl border border-sky-200 transition-all cursor-pointer shadow-xs"
                          title="قفل کمک‌بهیاران این ماه فعال است. برای باز کردن کلیک کنید"
                        >
                          <Lock className="w-4 h-4 text-sky-600 animate-[pulse_2s_infinite]"/>
                          <span>قفل کمک‌بهیاران (باز کردن)</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleToggleLock('assistant')}
                          className="flex items-center gap-1.5 bg-slate-50 hover:bg-sky-600 hover:text-white text-slate-700 text-xs font-black px-3.5 py-2 rounded-xl border border-slate-200 hover:border-sky-600 transition-all cursor-pointer shadow-xs"
                          title="ثبت نهایی و قفل برنامه کمک‌بهیاران"
                        >
                          <Unlock className="w-4 h-4 text-slate-500 hover:text-inherit"/>
                          <span>قفل کمک‌بهیاران</span>
                        </button>
                      )}
                    </>
                  )}
                  <button
                    onClick={() => { exportToExcel(); handlePrint(); }}
                    className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 transition-colors cursor-pointer"
                    id="btn-export-excel-pdf"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600"/> خروجی فایل اکسل و PDF
                  </button>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden" id="schedule-grid-container">
                <div className="overflow-x-auto overflow-y-auto max-h-[75vh]">
                  <table className="w-full text-right border-collapse min-w-[1200px]">

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

                    <tbody className="divide-y divide-slate-200">

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

                              <td className="sticky right-0 bg-white z-10 px-4 py-2 border-l border-slate-200 shadow-[2px_0_5px_rgba(0,0,0,0.03)] text-right">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="font-extrabold text-slate-900 text-sm leading-tight">{p.firstName} {p.lastName}</div>
                                    <div className="flex items-center gap-1.5 mt-1 text-[10px] text-slate-400 font-serif">
                                      <span>{p.personalCode} •</span>
                                      <span className="font-bold text-slate-500">{report?.positionText}</span>
                                    </div>
                                  </div>

                                  {(role === 'admin' || role === 'headnurse') && (
                                    <button
                                      onClick={async () => {
                                        const isLocked = lockedRows.includes(p.id);
                                        const newLocked = isLocked
                                          ? lockedRows.filter(id => id !== p.id)
                                          : [...lockedRows, p.id];
                                        setLockedRows(newLocked);

                                        const nextDb = getFreshDbCopy();
                                        const deptId = selectedDepartmentId || 'sepehr';
                                        const oldDept = nextDb.deptData[deptId];
                                        if (oldDept) {
                                          const key = `${currentYear}_${currentMonth}`;
                                          const sched = oldDept.schedules?.[key];
                                          if (sched) {
                                            const updatedDept = {
                                              ...oldDept,
                                              schedules: {
                                                ...oldDept.schedules,
                                                [key]: {
                                                  ...sched,
                                                  lockedRows: newLocked
                                                }
                                              }
                                            };
                                            nextDb.deptData[deptId] = updatedDept;
                                            await saveDbState(nextDb, { showBusyOverlay: false });
                                          }
                                        }
                                      }}
                                      className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                                        lockedRows.includes(p.id)
                                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                          : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                                      }`}
                                      title={lockedRows.includes(p.id) ? 'باز کردن قفل این ردیف' : 'قفل کردن این ردیف'}
                                    >
                                      {lockedRows.includes(p.id) ? (
                                        <Lock className="w-4 h-4" />
                                      ) : (
                                        <Unlock className="w-4 h-4" />
                                      )}
                                    </button>
                                  )}
                                </div>
                              </td>

                              {calendarDays.map(d => {
                                const currentShift = pAssignments[d.day] || 'OFF';
                                const cellId = `cell-${p.id}-${d.day}`;

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
                                  badgeClass = "bg-emerald-100 text-emerald-800 font-black text-xs border border-emerald-300";
                                  displayVal = currentShift.substring(1);
                                }

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
                                        disabled={role === 'personnel' || lockedRows.includes(p.id)}
                                        className={`w-full max-w-[32px] h-8 rounded-lg flex items-center justify-center transition-all ${badgeClass} ${highlightedCellId === cellId ? 'ring-4 ring-red-500 ring-offset-2 ring-offset-white animate-[pulse_0.7s_ease-in-out_5]' : ''} ${(role !== 'personnel' && !lockedRows.includes(p.id)) ? 'hover:scale-105 hover:shadow cursor-pointer' : ''}`}
                                        title={`${p.firstName} ${p.lastName} • روز ${d.day} \nکلیک برای ویرایش دستی`}
                                        id={cellId}
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
                              <button
                                disabled={index === 0}
                                onClick={() => movePersonnel(index, 'up')}
                                className="text-slate-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-400 p-0.5 rounded-md hover:bg-white border border-transparent hover:border-slate-100 transition-all cursor-pointer"
                                title="انتقال به ردیف بالا"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
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
                    <>
                      <label className="flex items-center gap-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3.5 py-2 rounded-xl text-xs font-black text-rose-800 cursor-pointer transition-colors shadow-xs">
                        <input
                          type="checkbox"
                          checked={requestsLockedMonths.includes(`${currentYear}_${currentMonth}`)}
                          onChange={handleToggleRequestsLock}
                          className="rounded border-rose-300 text-rose-600 focus:ring-rose-500"
                        />
                        اتمام مهلت ثبت درخواست‌ها
                      </label>
                      <label className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 px-3.5 py-2 rounded-xl text-xs font-black text-slate-700 cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={showSplitRequests}
                          onChange={(e) => setShowSplitRequests(e.target.checked)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        نمایش تفکیکی درخواست‌ها
                      </label>
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

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
                        setDraftRequests([]);
                        setShowAddRequestModal(true);
                      }}
                      className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black py-3 rounded-2xl shadow-lg hover:shadow-indigo-500/10 transition-all cursor-pointer"
                      id="btn-trigger-add-req-bifurcated"
                    >
                      <Plus className="w-4 h-4"/> ایجاد و مدیریت درخواست‌های دستی کادر
                    </button>
                  </div>
                </div>

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

                          await saveState(personnel, updatedR, settings, customHolidays, {
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
                                        await saveState(personnel, updatedList, settings, customHolidays, {
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
                                      const isLocked = requestsLockedMonths.includes(`${currentYear}_${currentMonth}`);
                                      if (isLocked && role === 'personnel') {
                                        alert('مهلت ویرایش درخواست برای این ماه به پایان رسیده است.');
                                        return;
                                      }
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
                                  >
                                    <Settings2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setDeleteTarget({
                                      id: r.id,
                                      type: 'request',
                                      label: `درخواست پرسنل ${p.firstName} ${p.lastName}`
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

          {activeTab === 'reports' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-black text-slate-800">کارنامه خلاصه کارکرد و فیش ساعت‌کاری کل پرسنل</h3>
                  <p className="text-xs text-slate-400 mt-1 font-semibold">محاسبات عادلانه بر پایه ساعت موظفی ماهانه، با فاکتورگیری سنوات، بهره‌وری و کسر شیفت</p>
                </div>

                <div className="flex gap-2">
                  <button onClick={() => { exportToExcel(); handlePrint(); }} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer">
                    <FileSpreadsheet className="w-4 h-4"/> دریافت همزمان اکسل و چاپ کارنامه‌ها
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">

                <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg p-5 rounded-2xl border border-indigo-200">
                  <div className="flex justify-between items-start">
                    <span className="text-indigo-100 font-bold text-xs">مجموع ساعت ارائه خدمات</span>
                    <Clock className="w-5 h-5 text-indigo-200"/>
                  </div>
                  <div className="text-2xl font-black mt-2 font-mono">
                    {reports.reduce((acc, curr) => acc + curr.workedHours, 0).toFixed(1)} <span className="text-xs font-normal">ساعت</span>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 shadow-sm p-5 rounded-2xl">
                  <div className="flex justify-between items-start">
                    <span className="text-slate-400 font-bold text-xs">مجموع اضافه‌کار انباشته</span>
                    <Sparkles className="w-5 h-5 text-emerald-500"/>
                  </div>
                  <div className="text-2xl font-black mt-2 text-slate-800 font-mono">
                    {reports.reduce((acc, curr) => acc + curr.overtimeHours, 0).toFixed(1)} <span className="text-xs font-normal text-slate-400">ساعت</span>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 shadow-sm p-5 rounded-2xl">
                  <div className="flex justify-between items-start">
                    <span className="text-slate-400 font-bold text-xs">تعداد واجدین بهره‌وری بخش</span>
                    <Award className="w-5 h-5 text-indigo-500"/>
                  </div>
                  <div className="text-2xl font-black mt-2 text-slate-800 font-mono">
                    {reports.filter(r => r.productivityEligible).length} <span className="text-xs font-normal text-slate-400">نفر</span>
                  </div>
                </div>

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

              {schedule?.changeLogs && schedule.changeLogs.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 print:hidden">
                  <h4 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-4">
                    <History className="w-5 h-5 text-indigo-500" />
                    لاگ‌ها و اتفاقات (تاریخچه قفل‌ها و مهلت درخواست)
                  </h4>
                  <ul className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                    {schedule.changeLogs.slice().reverse().map((log, idx) => (
                      <li key={idx} className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0"></div>
                        {log}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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

          {activeTab === 'settings' && role === 'admin' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

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
                            saveState(personnel, requests, settings, updated, { mode: 'full_resolve' });
                          }}
                          className={`p-1 rounded-lg border text-[10px] font-black transition-all flex flex-col items-center justify-center min-h-[38px] cursor-pointer ${
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

          {activeTab === 'calendar' && (
            <div className="space-y-6 animate-fade-in print:hidden">

              <div className="bg-white border border-slate-200 p-6 rounded-3xl shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-150 pb-4 mb-4">
                  <div>
                    <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                      <span className="text-xl">📅</span> تنظیمات تقویم هوشمند و مدیریت تعطیلات
                    </h3>
                    <p className="text-slate-400 text-[11px] font-bold mt-1">تقویم رسمی شمسی ایران؛ روز آغاز ماه، تعطیلات و مناسبت‌ها به‌صورت آنلاین دریافت و در محاسبات شیفت اعمال می‌شوند.</p>
                    <div className={`mt-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black ${calendarOnline ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                      <span className={`h-2 w-2 rounded-full ${calendarOnline ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                      {calendarOnline ? 'متصل به تقویم رسمی ایران • همگام‌سازی خودکار فعال' : 'در حال اتصال؛ محاسبات داخلی تقویم فعال است'}
                    </div>
                  </div>

                  <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 text-[11px] font-extrabold px-3 py-1.5 rounded-full flex items-center gap-2 shrink-0">
                    <span>ماه فعال کنونی:</span>
                    <span className="bg-emerald-600 text-white px-2 py-0.5 rounded font-black font-mono">{JALALI_MONTH_NAMES[currentMonth - 1]} {currentYear}</span>
                  </div>
                </div>

                <details className="group mb-6 overflow-hidden rounded-2xl border border-amber-200 bg-amber-50/40">
                  <summary className="flex cursor-pointer list-none items-center justify-between p-4 text-sm font-black text-slate-800">
                    <span>تنظیم ساعت دستی</span>
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] text-amber-700 group-open:hidden">خاموش</span>
                    <span className="hidden rounded-full bg-emerald-100 px-2 py-1 text-[10px] text-emerald-700 group-open:inline">روشن</span>
                  </summary>
                  <div className="border-t border-amber-200 p-4">
                    <p className="mb-4 text-[10px] font-bold leading-6 text-amber-700">فقط هنگامی استفاده کنید که اتصال تقویم آنلاین کشور با مشکل مواجه شده باشد.</p>
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
                          disabled={role === 'personnel'}
                          onClick={() => {
                            setFirstDayOfWeekIndex(idx);
                            if (typeof window !== 'undefined') {
                              localStorage.setItem(`hospital_first_day_of_week_index_${currentYear}_${currentMonth}`, String(idx));
                              localStorage.setItem('hospital_first_day_of_week_index', String(idx));
                            }
                            saveState(personnel, requests, settings, customHolidays, idx, { mode: 'full_resolve' });
                          }}
                          className={`px-3 py-2 rounded-xl border text-xs font-black transition-all flex flex-col items-center justify-center gap-1 ${
                            isSelected
                              ? 'bg-emerald-600 text-white border-emerald-600 shadow-md scale-[1.02]'
                              : 'bg-white text-slate-600 border-slate-200'
                          } ${role !== 'personnel' ? 'hover:bg-slate-50 cursor-pointer' : 'opacity-70 cursor-not-allowed'}`}
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

                      <div className="grid grid-cols-12 bg-slate-50 p-3 text-[10px] font-black text-slate-500 sticky top-0 border-b border-slate-250 z-10">
                        <div className="col-span-3 text-center">وضعیت تعطیلی مذهبی/ملی</div>
                        <div className="col-span-2 text-center">تاریخ روز</div>
                        <div className="col-span-3">روز هفته</div>
                        <div className="col-span-4">علت تعطیلی / توضیح مناسبت</div>
                      </div>

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
                            <div className="col-span-3 flex items-center justify-center gap-2">
                              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={isFriday || role === 'personnel'}
                                  onChange={(e) => {
                                    const updated = { ...customHolidays };
                                    if (e.target.checked) {
                                      updated[d.day] = customHolidays[d.day] || 'تعطیل انتخابی با تیک';
                                    } else {
                                      delete updated[d.day];
                                    }
                                    setCustomHolidays(updated);
                                    saveState(personnel, requests, settings, updated, { mode: 'full_resolve' });
                                  }}
                                  className="w-4 h-4 accent-emerald-600 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                                  id={`check-holiday-${d.day}`}
                                />
                                <span className={`text-[10px] ${isChecked ? 'text-rose-600 font-extrabold' : 'text-slate-400 font-normal'}`}>
                                  {isChecked ? 'تعطیل کاربری' : 'روز کاری'}
                                </span>
                              </label>
                            </div>

                            <div className="col-span-2 text-center font-mono font-black text-sm text-slate-800" title={(calendarOccasions[d.day] || []).join('، ')}>
                              {d.day}
                              {calendarOccasions[d.day]?.length ? <span className="mx-auto mt-1 block h-1.5 w-1.5 rounded-full bg-indigo-500" /> : null}
                            </div>

                            <div className="col-span-3">
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-black ${
                                isFriday
                                  ? 'bg-rose-100 text-rose-700 border border-rose-200'
                                  : 'bg-slate-100 text-slate-650 border border-slate-150'
                              }`}>
                                {WEEKDAYS[d.dayOfWeek]}
                              </span>
                            </div>

                            <div className="col-span-4 flex items-center">
                              {isFriday ? (
                                <span className="text-slate-400 text-[10px] font-normal italic">روز جمعه (تعطیل مستقل سیستم)</span>
                              ) : (
                                <input
                                  type="text"
                                  placeholder="مثلاً: مناسبت تعطیلی مذهبی..."
                                  disabled={!isCustomHoliday || role === 'personnel'}
                                  value={customHolidays[d.day] || ''}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    const updated = { ...customHolidays };
                                    if (updated[d.day] !== undefined) {
                                      updated[d.day] = val;
                                      setCustomHolidays(updated);
                                      saveState(personnel, requests, settings, updated, { mode: 'full_resolve' });
                                    }
                                  }}
                                  className={`w-full text-[10px] px-2.5 py-1 rounded-lg border focus:outline-none transition-all ${
                                    isCustomHoliday && role !== 'personnel'
                                      ? 'bg-white border-rose-300 text-rose-800 font-black focus:border-rose-500'
                                      : 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed opacity-75'
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
                </details>

              </div>

              {role !== 'personnel' && (() => {
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
                        ساعت موظفی رسمی و قراردادی همواره و به‌صورت غیرقابل ویرایش از تقویم آنلاین محاسبه می‌شود؛ ساعت کادر طرح / وظیفه همچنان قابل ویرایش است.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                      <div className="bg-emerald-50 p-3.5 border border-emerald-200 rounded-2xl">
                        <label className="block text-[10px] font-black text-emerald-700 mb-1.5">ساعت موظفی رسمی ـ محاسبه خودکار تقویم</label>
                        <div className="w-full rounded-xl border border-emerald-200 bg-white px-2.5 py-2 text-center font-mono text-sm font-black text-slate-800">{z_calc}</div>
                      </div>

                      <div className="bg-sky-50 p-3.5 border border-sky-200 rounded-2xl">
                        <label className="block text-[10px] font-black text-sky-700 mb-1.5">ساعت موظفی قراردادی ـ محاسبه خودکار تقویم</label>
                        <div className="w-full rounded-xl border border-sky-200 bg-white px-2.5 py-2 text-center font-mono text-sm font-black text-slate-800">{contract_calc}</div>
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
                            saveState(personnel, requests, updated, customHolidays, { mode: 'full_resolve' });
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

          {activeTab === 'profile' && (
            <div className="mx-auto w-full max-w-3xl animate-fade-in print:hidden" dir="rtl">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                      <User className="h-7 w-7" />
                    </span>
                    <div>
                      <h3 className="text-lg font-black text-slate-900">{authenticatedUser.firstName} {authenticatedUser.lastName}</h3>
                      <p className="mt-1 text-xs font-bold text-slate-500">کد ملی: <span className="font-mono" dir="ltr">{authenticatedUser.nationalId}</span></p>
                      <p className="mt-1 text-[11px] font-bold text-slate-400">سطح دسترسی: {authenticatedUser.role === 'ADMIN' ? 'مدیر سامانه' : authenticatedUser.role === 'HEAD_NURSE' ? 'سرپرستار بخش' : 'پرسنل'}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => router.push('/change-password')}
                    className="rounded-xl bg-indigo-600 px-5 py-3 text-xs font-black text-white shadow-md transition hover:bg-indigo-700"
                  >
                    تغییر امن رمز عبور
                  </button>
                </div>
                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold leading-7 text-amber-800">
                  رمز عبور در پایگاه داده امن و به‌صورت Hash نگهداری می‌شود و در هیچ بخش از رابط کاربری نمایش داده نخواهد شد.
                </div>
              </div>
            </div>
          )}

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

        </div>
      </main>

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

      {showAlertCenter && role === 'headnurse' && activeTab === 'schedule' && (
        <div className="fixed inset-0 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center z-[60] p-4 print:hidden animate-fade-in" id="alert-center-modal" dir="rtl">
          <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 bg-amber-50/70 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  <h3 className="text-base font-black text-slate-800">پنجره هشدارهای باقی‌مانده</h3>
                </div>
                <p className="text-xs font-bold text-slate-600 mt-1">
                  روی هر بخش کلیک کنید تا هشدارها باز/بسته شوند.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-amber-100 text-amber-800 text-xs font-black px-2.5 py-1 rounded-full">
                  {getVisibleWarnings().length} هشدار فعال
                </span>
                <button
                  onClick={() => setShowAlertCenter(false)}
                  className="text-slate-500 hover:text-slate-700 border border-slate-200 rounded-xl p-2 bg-white transition-colors cursor-pointer"
                  title="بستن پنجره هشدارها"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 bg-slate-50 space-y-4">
              {allAlertsForDialog.filter(a => a.warnings.length > 0).length === 0 ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-emerald-800 text-sm font-black text-center">
                  ✨ هشدار فعالی برای این ماه باقی نمانده است.
                </div>
              ) : (
                <>
                  {/* بخش هشدارهای عمومی - کرکره‌ای */}
                  {(() => {
                    const generalAlerts = allAlertsForDialog.filter(a => a.groupType === 'general' && a.warnings.length > 0);
                    if (generalAlerts.length === 0) return null;
                    const activeCount = generalAlerts.reduce((acc, a) => acc + a.warnings.filter(w => !dismissedAlertWarnings[w]).length, 0);
                    return (
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={() => setExpandedAlertSections(prev => ({...prev, general: !prev.general}))}
                          className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl cursor-pointer transition-all"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-indigo-500"></div>
                            <h4 className="text-sm font-black text-indigo-800">هشدارهای عمومی</h4>
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                              {activeCount} مورد
                            </span>
                          </div>
                          <ChevronDown className={`w-5 h-5 text-indigo-600 transition-transform ${expandedAlertSections.general ? 'rotate-180' : ''}`} />
                        </button>
                        {expandedAlertSections.general && generalAlerts.map((alert) => {
                          const allWarnings = alert.warnings;
                          const severityClasses =
                            alert.severity === 'high'
                              ? 'border-red-200 bg-red-50/40'
                              : alert.severity === 'medium'
                                ? 'border-amber-200 bg-amber-50/40'
                                : 'border-blue-200 bg-blue-50/40';

                          return (
                            <div key={alert.personnelId} className={`border rounded-2xl p-4 ${severityClasses}`}>
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  <span className={`text-sm font-black ${
                                    alert.severity === 'high'
                                      ? 'text-red-600'
                                      : alert.severity === 'medium'
                                        ? 'text-amber-600'
                                        : 'text-blue-600'
                                  }`}>
                                    {alert.severity === 'high' ? '🔴' : alert.severity === 'medium' ? '🟡' : '🔵'}
                                  </span>
                                  <div>
                                    <div className="font-black text-slate-800 text-sm">{alert.personnelName}</div>
                                    <div className="text-[11px] font-bold text-slate-500">
                                      {allWarnings.filter(w => !dismissedAlertWarnings[w]).length} هشدار فعال
                                      {' • هشدارهای بدون پرسنل مشخص'}
                                    </div>
                                  </div>
                                </div>
                                <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-indigo-100 border border-indigo-200 text-indigo-700">
                                  عمومی
                                </span>
                              </div>

                              <div className="mt-4 space-y-2">
                                {allWarnings.map((warn, idx) => {
                                  const day = extractWarningDay(warn);
                                  const isDismissed = !!dismissedAlertWarnings[warn];

                                  return (
                                    <div key={`${alert.personnelId}-${idx}`} className={`border rounded-xl p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between transition-all ${isDismissed ? 'bg-slate-50 border-slate-200 opacity-50' : 'bg-white border-slate-200'}`}>
                                      <div className="flex items-start gap-2 flex-1">
                                        <span className={`font-black mt-0.5 ${isDismissed ? 'text-slate-300' : 'text-amber-600'}`}>•</span>
                                        <div className="space-y-1">
                                          <div className={`text-xs font-bold leading-6 ${isDismissed ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{warn}</div>
                                          {day !== null && (
                                            <span className="inline-flex text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                              روز {day}
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-[10px] font-bold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500">
                                          فاقد سلول مستقیم
                                        </span>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleDismissAlert(warn); }}
                                          className={`text-[10px] font-black px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${isDismissed ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}
                                          title={isDismissed ? 'بازگرداندن این هشدار' : 'نادیده گرفتن این هشدار'}
                                        >
                                          {isDismissed ? 'بازگرداندن' : 'نادیده گرفتن'}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* بخش هشدارهای پرسنلی - کرکره‌ای */}
                  {(() => {
                    const personnelAlerts = allAlertsForDialog.filter(a => a.groupType !== 'general' && a.warnings.length > 0);
                    if (personnelAlerts.length === 0) return null;
                    const activeCount = personnelAlerts.reduce((acc, a) => acc + a.warnings.filter(w => !dismissedAlertWarnings[w]).length, 0);
                    return (
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={() => setExpandedAlertSections(prev => ({...prev, personnel: !prev.personnel}))}
                          className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl cursor-pointer transition-all"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                            <h4 className="text-sm font-black text-amber-800">هشدارهای پرسنلی</h4>
                            <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                              {activeCount} مورد
                            </span>
                          </div>
                          <ChevronDown className={`w-5 h-5 text-amber-600 transition-transform ${expandedAlertSections.personnel ? 'rotate-180' : ''}`} />
                        </button>
                        {expandedAlertSections.personnel && personnelAlerts.map((alert) => {
                          const allWarnings = alert.warnings;
                          const severityClasses =
                            alert.severity === 'high'
                              ? 'border-red-200 bg-red-50/40'
                              : alert.severity === 'medium'
                                ? 'border-amber-200 bg-amber-50/40'
                                : 'border-blue-200 bg-blue-50/40';

                          return (
                            <div key={alert.personnelId} className={`border rounded-2xl p-4 ${severityClasses}`}>
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-3">
                                  <span className={`text-sm font-black ${
                                    alert.severity === 'high'
                                      ? 'text-red-600'
                                      : alert.severity === 'medium'
                                        ? 'text-amber-600'
                                        : 'text-blue-600'
                                  }`}>
                                    {alert.severity === 'high' ? '🔴' : alert.severity === 'medium' ? '🟡' : '🔵'}
                                  </span>
                                  <div>
                                    <div className="font-black text-slate-800 text-sm">{alert.personnelName}</div>
                                    <div className="text-[11px] font-bold text-slate-500">
                                      {allWarnings.filter(w => !dismissedAlertWarnings[w]).length} هشدار فعال
                                    </div>
                                  </div>
                                </div>
                                <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-amber-100 border border-amber-200 text-amber-700">
                                  پرسنلی
                                </span>
                              </div>

                              <div className="mt-4 space-y-2">
                                {allWarnings.map((warn, idx) => {
                                  const day = extractWarningDay(warn);
                                  const canNavigateToCell = day !== null;
                                  const isDismissed = !!dismissedAlertWarnings[warn];

                                  return (
                                    <div key={`${alert.personnelId}-${idx}`} className={`border rounded-xl p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between transition-all ${isDismissed ? 'bg-slate-50 border-slate-200 opacity-50' : 'bg-white border-slate-200'}`}>
                                      <div className="flex items-start gap-2 flex-1">
                                        <span className={`font-black mt-0.5 ${isDismissed ? 'text-slate-300' : 'text-amber-600'}`}>•</span>
                                        <div className="space-y-1">
                                          <div className={`text-xs font-bold leading-6 ${isDismissed ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{warn}</div>
                                          {day !== null && (
                                            <span className="inline-flex text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                              روز {day}
                                            </span>
                                          )}
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2 shrink-0">
                                        {canNavigateToCell && day !== null && !isDismissed ? (
                                          <button
                                            onClick={() => handleAlertClick(alert.personnelId, day)}
                                            className="text-[10px] font-black px-3 py-1.5 rounded-xl border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-all cursor-pointer"
                                          >
                                            رفتن به سلول
                                          </button>
                                        ) : !isDismissed ? (
                                          <span className="text-[10px] font-bold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500">
                                            فاقد سلول مستقیم
                                          </span>
                                        ) : null}

                                        <button
                                          onClick={(e) => { e.stopPropagation(); handleDismissAlert(warn); }}
                                          className={`text-[10px] font-black px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${isDismissed ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}
                                          title={isDismissed ? 'بازگرداندن این هشدار' : 'نادیده گرفتن این هشدار'}
                                        >
                                          {isDismissed ? 'بازگرداندن' : 'نادیده گرفتن'}
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showAddRequestModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 print:hidden animate-fade-in" id="request-modal">
          <div className="bg-white border rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 sm:p-6 shadow-2xl relative animate-scale-up scrollbar-thin">
            <button
              onClick={() => {
                setShowAddRequestModal(false);
                setEditingRequest(null);
              }}
              className="absolute top-4 left-4 text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg p-1.5 cursor-pointer"
            >
              ✕
            </button>

            <h3 className="text-base font-black text-slate-800 mb-6 border-b pb-3 border-slate-100">
              ثبت درخواست هوشمند و مرخصی پرستاری
            </h3>

            <form onSubmit={handleAddRequest} className="space-y-4">

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
                  <div className="grid grid-cols-7 gap-1.5 max-h-[210px] overflow-y-auto p-2 scrollbar-thin rounded-2xl border border-slate-200 bg-white shadow-inner">
                    {WEEKDAYS.map((weekday, index) => (
                      <div key={`req-weekday-${weekday}`} className={`sticky top-0 z-10 rounded-lg py-1 text-center text-[8px] font-black ${index === 6 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{weekday[0]}</div>
                    ))}
                    {Array.from({ length: calendarDays[0]?.dayOfWeek || 0 }).map((_, index) => <span key={`req-empty-${index}`} />)}
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
                          title={d.holidayTitle || (calendarOccasions[d.day] || []).join('، ')}
                          className={`relative min-h-12 py-1.5 text-[11px] font-black rounded-xl border transition-all flex flex-col items-center justify-center cursor-pointer ${
                            isSelected
                              ? d.isHoliday
                                ? 'bg-rose-600 text-white border-rose-700 shadow-md scale-105'
                                : 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105'
                              : d.isHoliday
                                ? 'bg-rose-100 text-rose-700 border-rose-300 hover:bg-rose-200'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                          }`}
                        >
                          {d.isHoliday && <span className={`absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-rose-500'}`} />}
                          <span className="text-xs font-mono font-extrabold">{d.day}</span>
                          <span className="text-[8px] opacity-75">{WEEKDAYS[d.dayOfWeek][0]}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-3 px-1 text-[9px] font-bold text-slate-500">
                    <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-rose-100 ring-1 ring-rose-300" /> جمعه و تعطیل رسمی</span>
                    <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-indigo-600" /> روز انتخاب‌شده</span>
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

              <div className={`grid gap-3 pt-2 ${editingRequest ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {!editingRequest && (
                  <button
                    type="button"
                    onClick={handleAddDraftRequest}
                    className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-705 border border-slate-300 font-extrabold text-xs py-3 rounded-xl shadow-sm transition-all cursor-pointer animate-pulse-subtle"
                    id="btn-add-draft"
                  >
                    <Plus className="w-4 h-4 text-slate-600 animate-spin-once" /> افزودن به لیست
                  </button>
                )}
                <button
                  type="submit"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs py-3 rounded-xl shadow-lg transition-all cursor-pointer flex items-center justify-center gap-1.5"
                  id="btn-save-req"
                >
                  <Check className="w-4 h-4 text-white" /> {editingRequest ? 'ثبت ویرایش درخواست' : 'ثبت نهایی درخواست‌ها'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
