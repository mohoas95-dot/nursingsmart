'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import TehranDateTime from './components/TehranDateTime';
import { ResetRequestList } from './components/auth/ResetRequestList';
import { useResetRequestCount } from './components/auth/useResetRequestCount';
import { WelcomeOverlay } from './components/auth/WelcomeOverlay';
import type { AuthenticatedUser, LoginResult } from '../lib/auth/types';
import { isValidIranianNationalId, toEnglishDigits } from '../lib/auth/validation';
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
import { captureScrollSnapshot, restoreScrollSnapshot } from '../lib/scroll-restore';
import type { ScrollSnapshot } from '../lib/scroll-restore';
import {
  applyDefaultOffRule,
  findBestSubstitute,
  checkAndApplyAutoSubstitution
} from '../lib/balanceChecker';
import {
  generateSmartSuggestions
} from '../lib/smartSuggestion';
import { generateAndScoreScenariosWithProgress } from '../lib/scenarioGenerator';
import {
  calculateScenarioDifferencePercent,
  evaluateScenarioSchedule,
  filterWarningsForScenarioGroup,
  type ScoredSchedule,
} from '../lib/scoring';
import { canEditShiftCell, isPersonnelOptimizationTarget } from '../domain/guards/shift-edit-guards';
import {
  DEFAULT_CUSTOM_HOLIDAY_TITLE,
  clearHolidayOverride,
  diffHolidayOverrides,
  holidayOverrideTitle,
  holidaySource,
  isEffectiveHoliday,
  mergeHolidayOverrides,
  setHolidayOverride,
  toggleHolidayOverride,
} from '../domain/calendar/holiday-overrides';
import { resolveLeaveShiftAssignment } from '../domain/scheduling/smart-rules';
import { reconcileStaffingCoverage } from '../domain/scheduling/staffing-coverage';
import {
  dismissedWarningsChanged,
  pruneDismissedWarningMap,
  pruneDismissedWarnings,
} from '../domain/scheduling/alert-lifecycle';
import {
  MAX_SYSTEM_EVENT_LOGS,
  appendSystemEventLogs,
  createSystemEventLog,
  normalizeSystemEventLogs,
  type SystemEventInput,
  type SystemEventLog,
} from '../domain/logging/system-events';
import { buildSolverRunEvents } from '../domain/logging/solver-report';
import { runOptimizerFacade, applyManualShiftChangeFacade } from '../features/scheduling/facades/shift-write-facade';
import type { SchedulePersistence, ScheduleUIFeedback } from '../features/scheduling/facades/shift-write-facade';
import { AddPersonnelModal } from '../features/personnel/components/AddPersonnelModal';
import { AlertCenter } from '../features/scheduling/components/AlertCenter';
import { ScenarioWorkspace, type ScenarioWorkflowView } from '../features/scheduling/components/ScenarioWorkspace';
import { PrintScheduleSheet } from '../features/scheduling/components/PrintScheduleSheet';
import { ProfileSection } from '../features/profile/components/ProfileSection';
import { DeleteConfirmModal } from '../features/shared/components/DeleteConfirmModal';
import { BusyOverlay } from '../features/shared/components/BusyOverlay';
import { EventLogPanel } from '../features/reports/components/EventLogPanel';
import { useTaskProgress } from '../features/shared/hooks/useTaskProgress';
import {
  SAVE_PHASES,
  SOLVER_PHASES,
} from '../features/shared/progress-phases';
import { useScheduleState } from '../features/scheduling/hooks/useScheduleState';
import { usePersonnelForm } from '../features/personnel/hooks/usePersonnelForm';
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
  Send,
  Expand,
  Shrink,
  X,
  Paperclip,
  Image as ImageIcon,
  Loader2
} from 'lucide-react';

// Department interface for multi-department management
interface Department {
  id: string;
  name: string;
  username?: string;
  password?: string;
}

interface ScenarioWorkflowGroup extends ScenarioWorkflowView {
  targetJobGroup: JobGroup;
}

type QuickRequestTemplateId = 'en' | 'men' | 'long_off' | 'off' | 'leave';
type QuickRequestScope = 'odd' | 'even' | 'weekly_odd' | 'weekly_even';
type RequestChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  timestamp?: string;
  /**
   * اگر پیام شامل تصویر پیوست‌شده باشد، ObjectURL مرورگر (RAM-only) در این فیلد
   * نگه داشته می‌شود. thumbnail در حباب پیام نمایش داده می‌شود و با کلیک
   * بزرگ‌نمایی می‌شود. URL در زمان unmount یا حذف پیام آزاد می‌شود.
   */
  imageUrl?: string;
  /** عنوان کوتاه برای تصویر (نام فایل یا متن اختیاری کاربر) */
  imageCaption?: string;
};
type ChatProposedShiftRequest = ShiftRequest & { description?: string };

const QUICK_REQUEST_TEMPLATES: ReadonlyArray<{
  id: QuickRequestTemplateId;
  title: string;
  subtitle: string;
  accentClass: string;
}> = [
  { id: 'en', title: 'EN', subtitle: 'عصر و شب', accentClass: 'from-indigo-500 to-violet-600' },
  { id: 'men', title: 'MEN', subtitle: 'شیفت 24', accentClass: 'from-sky-500 to-cyan-600' },
  { id: 'long_off', title: 'لانگ آف', subtitle: 'ME یک‌روزدرمیان', accentClass: 'from-teal-500 to-emerald-600' },
  { id: 'off', title: 'OFF 😴', subtitle: 'آف با انتخاب روز', accentClass: 'from-slate-600 to-slate-800' },
  { id: 'leave', title: 'مرخصی 🏖', subtitle: 'انتخاب روزهای مرخصی', accentClass: 'from-amber-500 to-orange-600' },
];

const QUICK_REQUEST_SCOPE_OPTIONS: ReadonlyArray<{
  id: QuickRequestScope;
  title: string;
  subtitle: string;
}> = [
  { id: 'odd', title: 'تاریخ فرد', subtitle: '۱، ۳، ۵...' },
  { id: 'even', title: 'تاریخ زوج', subtitle: '۲، ۴، ۶...' },
  { id: 'weekly_odd', title: 'روز فرد', subtitle: 'یکشنبه، سه‌شنبه، پنجشنبه' },
  { id: 'weekly_even', title: 'روز زوج', subtitle: 'شنبه، دوشنبه، چهارشنبه' },
];

const QUICK_COMPLEMENT_SCOPE: Record<QuickRequestScope, QuickRequestScope> = {
  odd: 'even',
  even: 'odd',
  weekly_odd: 'weekly_even',
  weekly_even: 'weekly_odd',
};

// خطای تداخل قفل خوش‌بینانه (ETag) — برای شناسایی داخلی و بازیابی خودکار در صف ذخیره‌سازی.
class ConcurrencyConflictError extends Error {
  constructor(resource: string) {
    super(`Optimistic concurrency conflict for ${resource}`);
    this.name = 'ConcurrencyConflictError';
  }
}




// ---------------------------------------------------------------------------
// ارسال درخواست به دستیار هوشمند با تایم‌اوت سمت کلاینت و تلاش مجدد خودکار
// روی خطاهای گذرا (۵۰۳ شلوغی مدل، ۵۰۴ تایم‌اوت، قطع موقت شبکه).
// ---------------------------------------------------------------------------
const CHAT_REQUEST_TIMEOUT_MS = 40000;
const CHAT_REQUEST_MAX_ATTEMPTS = 2;

async function postChatRequestWithRetry(payload: unknown): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= CHAT_REQUEST_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      await new Promise(resolve => setTimeout(resolve, 800 * 2 ** (attempt - 2) + Math.random() * 300));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch('/api/gemini/chat-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if ((response.status === 503 || response.status === 504 || response.status === 429)
        && attempt < CHAT_REQUEST_MAX_ATTEMPTS) {
        lastError = new Error('مدل هوش مصنوعی موقتاً شلوغ است.');
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= CHAT_REQUEST_MAX_ATTEMPTS) break;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(
    lastError instanceof Error && /abort/i.test(lastError.name + lastError.message)
      ? 'پاسخ دستیار هوشمند بیش از حد طول کشید؛ لطفاً دوباره تلاش کنید.'
      : 'ارتباط با دستیار هوشمند برقرار نشد؛ لطفاً چند لحظه دیگر دوباره تلاش کنید.'
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

  // Self-service head-nurse/department onboarding
  const [showAddDeptModal, setShowAddDeptModal] = useState<boolean>(false);
  const [newDeptName, setNewDeptName] = useState('');
  const [newHeadNurseFirstName, setNewHeadNurseFirstName] = useState('');
  const [newHeadNurseLastName, setNewHeadNurseLastName] = useState('');
  const [newHeadNurseNationalId, setNewHeadNurseNationalId] = useState('');
  const [isOnboardingSubmitting, setIsOnboardingSubmitting] = useState(false);
  const [portalNotice, setPortalNotice] = useState('');
  const [departmentListStatus, setDepartmentListStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // --- Persistent & Local State ---
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [requests, setRequests] = useState<ShiftRequest[]>([]);
  const [isPersonnelLoaded, setIsPersonnelLoaded] = useState<boolean>(false);
  const [isRequestsLoaded, setIsRequestsLoaded] = useState<boolean>(false);
  const [settings, setSettings] = useState<any>(INITIAL_SETTINGS);
  const [dbChecked, setDbChecked] = useState<boolean>(false);

  // تنها منبع سال، ماه، چیدمان هفته و تعطیلات رسمی در کل رابط کاربری
  const officialCalendarState = useOfficialCalendar();
  const currentYear = officialCalendarState.year;
  const currentMonth = officialCalendarState.month;
  const setCurrentYear = officialCalendarState.setYear;
  const setCurrentMonth = officialCalendarState.setMonth;

  const [isMounted, setIsMounted] = useState<boolean>(false);
  const [isMonthLoaded, setIsMonthLoaded] = useState<boolean>(() => typeof window === 'undefined');

  const [storedFirstDayOfWeekIndex, setStoredFirstDayOfWeekIndex] = useState<number | undefined>(undefined);
  const setFirstDayOfWeekIndex = setStoredFirstDayOfWeekIndex;
  // تعطیلات رسمی کشور فقط‌خواندنی هستند و هرگز بازنویسی نمی‌شوند؛ تغییرات سرپرستار
  // به‌صورت یک لایه‌ی override جداگانه (روز → عنوان یا نگهبان روز کاری) ذخیره می‌شود
  // تا با هر بار همگام‌سازی مجدد تقویم رسمی از بین نرود.
  // مرجع پایدار لازم است؛ در غیر این صورت `?? {}` در هر رندر یک شیء تازه می‌سازد و
  // تمام useMemo/useEffectهای وابسته به تعطیلات را بی‌جهت دوباره اجرا می‌کند.
  const officialHolidays = React.useMemo(
    () => officialCalendarState.calendar?.holidays ?? {},
    [officialCalendarState.calendar]
  );
  const [holidayOverrides, setHolidayOverrides] = useState<{ [day: number]: string }>({});
  const customHolidays = React.useMemo(
    () => mergeHolidayOverrides(officialHolidays, holidayOverrides),
    [officialHolidays, holidayOverrides]
  );
  // Requirement 4: روز اول هفته قابل تنظیم توسط سرپرستار است و باید در کل سیستم ذخیره شود
  // اگر سرپرستار مقداری ذخیره کرده باشد (storedFirstDayOfWeekIndex) از آن استفاده می‌کنیم،
  // در غیر این صورت از تقویم رسمی استفاده می‌شود.
  const firstDayOfWeekIndex = storedFirstDayOfWeekIndex ?? officialCalendarState.calendar?.firstDayOfWeek;
  const [calendarOccasions, setCalendarOccasions] = useState<{ [day: number]: string[] }>({});
  const [calendarSyncedAt, setCalendarSyncedAt] = useState<string | null>(null);
  const [calendarOnline, setCalendarOnline] = useState(false);
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<number | null>(null);

  // انتشار ماه رسمی در سازگارساز قدیمی solver؛ تغییرات سرپرستار نباید بازنویسی شود (Requirement 4)
  useEffect(() => {
    const official = officialCalendarState.calendar;
    if (!official) {
      setCalendarOnline(false);
      setCalendarOccasions({});
      return;
    }
    setCalendarOccasions(official.occasions);
    // firstDayOfWeekIndex از storedFirstDayOfWeekIndex ?? official.firstDayOfWeek تامین می‌شود،
    // اینجا آن را بازنویسی نمی‌کنیم تا override سرپرستار حفظ شود.
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
    setSettings((previous: any) => {
      if (previous.dutyHours.official === official && previous.dutyHours.contract === contract && previous.autoCalculateDutyHours) return previous;
      return { ...previous, autoCalculateDutyHours: true, dutyHours: { ...previous.dutyHours, official, contract } };
    });
    // وابستگی به fullDbState تعمدی است: پس از اتمام بارگذاری/ذخیره وضعیت از S3، مقادیر موظفی
    // قدیمیِ ذخیره‌شده سراسری بخش نباید ساعت محاسبه‌شده ماه جاری را بازنویسی کنند (رفع برگشت
    // نمایش ساعت موظفی به ماه پیش‌فرض پس از چند ثانیه از تعویض ماه).
  }, [officialCalendarState.calendar, fullDbState]);

  // State for monthly approved duty hours
  const [monthlyDutyHours, setMonthlyDutyHours] = useState<any>(null);
  // ساعت موظفی رسمی و قراردادی دیگر قابل ویرایش دستی نیست و همیشه به‌صورت پویا از روی
  // تنظیمات تقویم (تعطیلات انتخابی بخش + تعطیلات رسمی) و روز اول هفته با ماژول محاسبه موظفی ماهانه به‌دست می‌آید.
  // Requirement 4: تغییر تقویم باید در کل سیستم و نمایش ساعت موظفی پرسنل بروز شود.
  const autoDutyHours = React.useMemo(() => {
    if (settings.autoCalculateDutyHours === false) {
      // در حالت غیرخودکار آخرین مقدار همگام‌شده نمایش داده می‌شود.
      return { official: settings.dutyHours.official, contract: settings.dutyHours.contract };
    }
    // از تقویم یکپارچه (customHolidays + firstDayOfWeekIndex) استفاده می‌کنیم تا هر تغییر
    // سرپرستار در تعطیلات و روز آغاز هفته بلافاصله در محاسبه موظفی منعکس شود.
    return calculateAutoDutyHours(currentYear, currentMonth, customHolidays, firstDayOfWeekIndex);
  }, [
    settings.autoCalculateDutyHours,
    settings.dutyHours.official,
    settings.dutyHours.contract,
    currentYear,
    currentMonth,
    customHolidays,
    firstDayOfWeekIndex,
  ]);

  // Requirement 4: ساعت موظفی باید در کل سیستم ذخیره و در همه پنل‌ها به‌روز شود.
  // اگر ماه جاری تصویب شده باشد (monthlyDutyHours)، از همان استفاده می‌کنیم؛
  // در غیر این صورت از autoDutyHours (محاسبه از تقویم یکپارچه) + conscript/overtime تنظیمات.
  const effectiveDutyHours = React.useMemo(() => {
    if (monthlyDutyHours) {
      return {
        official: Number(monthlyDutyHours.official) || autoDutyHours.official,
        contract: Number(monthlyDutyHours.contract) || autoDutyHours.contract,
        conscript: Number(monthlyDutyHours.conscript ?? settings.dutyHours.conscript) || 0,
        overtime: Number(monthlyDutyHours.overtime ?? settings.dutyHours.overtime) || 0,
      };
    }
    return {
      official: autoDutyHours.official,
      contract: autoDutyHours.contract,
      conscript: Number(settings.dutyHours.conscript) || 0,
      overtime: Number(settings.dutyHours.overtime) || 0,
    };
  }, [monthlyDutyHours, autoDutyHours, settings.dutyHours]);

  // Schedule state management (extracted to custom hook in Phase 4)
  const {
    schedule,
    setSchedule,
    solvingTarget,
    setSolvingTarget,
    finalizedNursesMonths,
    setFinalizedNursesMonths,
    finalizedAssistantsMonths,
    setFinalizedAssistantsMonths,
    lockedRows,
    setLockedRows,
    toggleRowLock,
    dismissedWarnings,
    setDismissedWarnings,
    editingCell,
    setEditingCell,
    isScheduleLocked,
    isRowLocked,
  } = useScheduleState();

  // ==========================================================================
  // نوار پیشرفت ۰ تا ۱۰۰ درصد — کاملاً هم‌گام با مراحل واقعی پردازش
  // ==========================================================================
  // هر عملیات سنگین تراکر مستقل خود را دارد. مدت واقعی هر مرحله یاد گرفته و در
  // localStorage نگه داشته می‌شود تا تخمین «زمان باقی‌مانده» با هر اجرا دقیق‌تر شود.
  // فقط عملیات واقعاً طولانی نوار درصدی دارند. ورود به سامانه و راه‌اندازی
  // اولیه عمداً کنار گذاشته شده‌اند تا صفحهٔ لودینگ سبک و سریع بماند.
  const solverProgress = useTaskProgress(SOLVER_PHASES, { storageKey: 'solver' });
  const saveProgress = useTaskProgress(SAVE_PHASES, { storageKey: 'save' });

  // saveDbState و handleRunOptimizer توابع معمولی (نه useCallback) هستند و در هر
  // رندر بازساخته می‌شوند؛ با ref همیشه به تازه‌ترین کنترل‌های تراکر دسترسی دارند.
  // به‌روزرسانی ref در effect انجام می‌شود تا فاز رندر خالص بماند؛ این توابع فقط
  // از دل رویدادها و effectها صدا زده می‌شوند، نه حین رندر.
  const saveProgressRef = React.useRef(saveProgress);
  const solverProgressRef = React.useRef(solverProgress);
  useEffect(() => {
    saveProgressRef.current = saveProgress;
    solverProgressRef.current = solverProgress;
  }, [saveProgress, solverProgress]);

  // درخواست ۸: state برای ویرایش درخواست در پنل پرسنل

  const [dismissedAlertWarnings, setDismissedAlertWarnings] = useState<{ [key: string]: boolean }>({});
  const [showAlertCenter, setShowAlertCenter] = useState<boolean>(false);
  const [expandedAlertSections, setExpandedAlertSections] = useState<{general: boolean, personnel: boolean, generalNurse: boolean, generalAssistant: boolean, generalOther: boolean}>({general: true, personnel: true, generalNurse: true, generalAssistant: true, generalOther: true});
  const [highlightedCellId, setHighlightedCellId] = useState<string | null>(null);
  // هایلایت کل ستون یک روز (برای هشدارهای عمومی مانند کمبود/مازاد نیرو)
  const [highlightedDay, setHighlightedDay] = useState<number | null>(null);

  // ====== بازگشت خودکار به موقعیت هشدار پس از رفع آن ======
  // وقتی کاربر از پنجره هشدارها روی «رفتن به سلول» می‌زند، موقعیت اسکرول صفحه
  // ثبت می‌شود؛ اگر آن هشدار با ویرایش دستی برطرف و حذف شد، صفحه دقیقاً به همان
  // نقطه بازمی‌گردد و پنجره هشدارها دوباره باز می‌شود.
  const alertReturnRef = React.useRef<{
    warningText: string;
    targetId: string;
    snapshot: ScrollSnapshot;
    reopenAlertCenter: boolean;
  } | null>(null);
  const [alertReturnAvailable, setAlertReturnAvailable] = useState<boolean>(false);
  const [alertReturnToast, setAlertReturnToast] = useState<{ message: string; canReopen: boolean } | null>(null);

  const personnelRef = React.useRef(personnel);
  const requestsRef = React.useRef(requests);
  const settingsRef = React.useRef(settings);
  const holidaysRef = React.useRef(customHolidays);
  const firstDayRef = React.useRef(firstDayOfWeekIndex);
  const monthlyDutyHoursRef = React.useRef(monthlyDutyHours);
  const scheduleRef = React.useRef(schedule);
  const dismissedWarningsRef = React.useRef(dismissedWarnings);
  const lockedRowsRef = React.useRef(lockedRows);
  // ====== سلول‌های محافظت‌شده (ویرایش‌های دستی سرپرستار) ======
  // هر سلولی که سرپرستار دستی ویرایش می‌کند در این مجموعه ثبت می‌شود.
  // سیستم جبران خودکار هرگز این سلول‌ها را تغییر نمی‌دهد.
  // با اجرای بهینه‌ساز، این فهرست پاک می‌شود.
  const protectedCellsRef = React.useRef<Set<string>>(new Set());

  useEffect(() => {
    personnelRef.current = personnel;
    requestsRef.current = requests;
    settingsRef.current = settings;
    holidaysRef.current = customHolidays;
    firstDayRef.current = firstDayOfWeekIndex;
    monthlyDutyHoursRef.current = monthlyDutyHours;
    scheduleRef.current = schedule;
    dismissedWarningsRef.current = dismissedWarnings;
    lockedRowsRef.current = lockedRows;
  }, [personnel, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours, schedule, dismissedWarnings, lockedRows]);

  // Load persisted selected month/year on mount to prevent defaulting to Khordad after resets
  useEffect(() => {
    setTimeout(() => {
      setIsMounted(true);
      setIsMonthLoaded(true);
    }, 0);
  }, []);

  // User Authentication & Roles
  // roles: 'admin' | 'headnurse' | 'personnel' | 'guest'
  const [role, setRole] = useState<'admin' | 'headnurse' | 'personnel' | 'guest'>('guest');
  const selectedPersonnelUser = React.useMemo(() => {
    if (authenticatedUser?.role !== 'PERSONNEL' || !authenticatedUser.personnelId) return null;
    return personnel.find(person => person.id === authenticatedUser.personnelId) || null;
  }, [authenticatedUser, personnel]);
  const [personnelSearchQuery, setPersonnelSearchQuery] = useState<string>('');

  const canManageHolidays = role === 'headnurse' || role === 'admin';
  
  const monthKey = `${currentYear}_${currentMonth}`;
  const deptData = optimisticDbRef.current?.deptData?.[selectedDepartmentId || 'sepehr'] as any;

  const hydrateStoredScenario = React.useCallback((rawScenario: any, group: JobGroup, index: number): ScoredSchedule => {
    if (rawScenario?.metrics && rawScenario?.scenarioKey && rawScenario?.shortTitle && rawScenario?.title) {
      return rawScenario as ScoredSchedule;
    }
    return evaluateScenarioSchedule({
      id: rawScenario?.id ?? index + 1,
      type: rawScenario?.type || (index === 0 ? 'REQUESTS' : index === 1 ? 'FAIRNESS' : 'MIXED'),
      schedule: {
        ...(rawScenario?.schedule || { year: currentYear, month: currentMonth, assignments: {}, shiftLeaders: {}, warnings: [] }),
        warnings: filterWarningsForScenarioGroup(rawScenario?.schedule?.warnings || rawScenario?.warnings || [], personnel, group),
      },
      personnelList: personnel,
      requests,
      settings: normalizeSettings(settings),
      year: currentYear,
      month: currentMonth,
      customHolidays,
      firstDayOfWeekIndex,
      monthlyDutyHours,
      targetJobGroup: group,
    });
  }, [currentMonth, currentYear, customHolidays, firstDayOfWeekIndex, monthlyDutyHours, personnel, requests, settings]);

  const rawActiveScenariosForMonth = deptData?.activeScenarios?.[monthKey] as any;
  const normalizedActiveScenarios = React.useMemo<{ nurse: ScenarioWorkflowGroup | null; assistant: ScenarioWorkflowGroup | null }>(() => {
    const empty = { nurse: null, assistant: null };
    if (!rawActiveScenariosForMonth) return empty;

    const normalizeGroup = (rawGroup: any, fallbackGroup: JobGroup): ScenarioWorkflowGroup | null => {
      if (!rawGroup || !Array.isArray(rawGroup.scenarios)) return null;
      return {
        targetJobGroup: rawGroup.targetJobGroup || fallbackGroup,
        scenarios: rawGroup.scenarios.map((scenario: any, index: number) => hydrateStoredScenario(scenario, rawGroup.targetJobGroup || fallbackGroup, index)),
        generationLog: rawGroup.generationLog || [],
        comparisonStartedAt: rawGroup.comparisonStartedAt,
        votingOpen: !!rawGroup.votingOpen,
      };
    };

    if (rawActiveScenariosForMonth.scenarios && Array.isArray(rawActiveScenariosForMonth.scenarios)) {
      const fallbackGroup: JobGroup = rawActiveScenariosForMonth.targetJobGroup === 'assistant' ? 'assistant' : 'nurse';
      const normalized = normalizeGroup(rawActiveScenariosForMonth, fallbackGroup);
      return fallbackGroup === 'assistant'
        ? { nurse: null, assistant: normalized }
        : { nurse: normalized, assistant: null };
    }

    return {
      nurse: normalizeGroup(rawActiveScenariosForMonth.nurse, 'nurse'),
      assistant: normalizeGroup(rawActiveScenariosForMonth.assistant, 'assistant'),
    };
  }, [hydrateStoredScenario, rawActiveScenariosForMonth]);

  const scenarioVotesRaw = deptData?.scenarioVotes?.[monthKey] as any;
  const normalizedScenarioVotes = React.useMemo(() => {
    if (!scenarioVotesRaw) return { nurse: {} as Record<number, Record<string, number>>, assistant: {} as Record<number, Record<string, number>> };
    const hasGroupKeys = scenarioVotesRaw.nurse !== undefined || scenarioVotesRaw.assistant !== undefined;
    if (hasGroupKeys) {
      return {
        nurse: scenarioVotesRaw.nurse || {},
        assistant: scenarioVotesRaw.assistant || {},
      };
    }
    return {
      nurse: scenarioVotesRaw as Record<number, Record<string, number>>,
      assistant: {},
    };
  }, [scenarioVotesRaw]);

  const [selectedScenarioIndexNurse, setSelectedScenarioIndexNurse] = useState<number>(-1);
  const [selectedScenarioIndexAssistant, setSelectedScenarioIndexAssistant] = useState<number>(-1);

  const nurseWorkflow = normalizedActiveScenarios.nurse;
  const assistantWorkflow = normalizedActiveScenarios.assistant;

  const currentScenarioNurse = nurseWorkflow && selectedScenarioIndexNurse >= 0
    ? nurseWorkflow.scenarios[selectedScenarioIndexNurse] || null
    : null;
  const currentScenarioAssistant = assistantWorkflow && selectedScenarioIndexAssistant >= 0
    ? assistantWorkflow.scenarios[selectedScenarioIndexAssistant] || null
    : null;

  const displayedSchedule = React.useMemo(() => {
    const preserveLockedRows = (candidate: MonthlySchedule | null): MonthlySchedule | null => {
      if (!candidate) return candidate;
      if (!schedule || lockedRows.length === 0) return candidate;

      const nextAssignments: Record<string, Record<number, ShiftType>> = {
        ...candidate.assignments,
      };
      for (const personnelId of lockedRows) {
        if (schedule.assignments[personnelId]) {
          nextAssignments[personnelId] = { ...schedule.assignments[personnelId] };
        }
      }

      return {
        ...candidate,
        assignments: nextAssignments,
      };
    };

    if (!schedule && !currentScenarioNurse && !currentScenarioAssistant) return schedule;
    if (currentScenarioNurse && !currentScenarioAssistant) {
      return preserveLockedRows(currentScenarioNurse.schedule);
    }
    if (!currentScenarioNurse && currentScenarioAssistant) {
      return preserveLockedRows(currentScenarioAssistant.schedule);
    }
    if (currentScenarioNurse && currentScenarioAssistant) {
      const mergedAssignments: Record<string, Record<number, ShiftType>> = { ...(schedule?.assignments || {}) };
      for (const [personnelId, days] of Object.entries(currentScenarioNurse.schedule.assignments || {})) {
        const person = personnel.find(item => item.id === personnelId);
        if (person?.jobGroup === 'nurse') {
          mergedAssignments[personnelId] = days as Record<number, ShiftType>;
        }
      }
      for (const [personnelId, days] of Object.entries(currentScenarioAssistant.schedule.assignments || {})) {
        const person = personnel.find(item => item.id === personnelId);
        if (person?.jobGroup === 'assistant') {
          mergedAssignments[personnelId] = days as Record<number, ShiftType>;
        }
      }
      return preserveLockedRows({
        ...(schedule || currentScenarioNurse.schedule),
        assignments: mergedAssignments,
        warnings: [
          ...(currentScenarioNurse.schedule.warnings || []),
          ...(currentScenarioAssistant.schedule.warnings || []),
        ],
        shiftLeaders: {
          ...(schedule?.shiftLeaders || {}),
          ...(currentScenarioNurse.schedule.shiftLeaders || {}),
          ...(currentScenarioAssistant.schedule.shiftLeaders || {}),
        },
      } as MonthlySchedule);
    }
    return schedule;
  }, [schedule, personnel, currentScenarioNurse, currentScenarioAssistant, lockedRows]);

  // Compiled reports from current schedule dynamically and reactively
  React.useEffect(() => {
    if (!nurseWorkflow || nurseWorkflow.scenarios.length === 0) {
      if (selectedScenarioIndexNurse !== -1) setSelectedScenarioIndexNurse(-1);
    } else if (selectedScenarioIndexNurse >= nurseWorkflow.scenarios.length) {
      setSelectedScenarioIndexNurse(0);
    }
  }, [nurseWorkflow, selectedScenarioIndexNurse]);

  React.useEffect(() => {
    if (!assistantWorkflow || assistantWorkflow.scenarios.length === 0) {
      if (selectedScenarioIndexAssistant !== -1) setSelectedScenarioIndexAssistant(-1);
    } else if (selectedScenarioIndexAssistant >= assistantWorkflow.scenarios.length) {
      setSelectedScenarioIndexAssistant(0);
    }
  }, [assistantWorkflow, selectedScenarioIndexAssistant]);

  React.useEffect(() => {
    if (role === 'personnel' && selectedPersonnelUser?.jobGroup !== 'nurse' && selectedScenarioIndexNurse !== -1) {
      setSelectedScenarioIndexNurse(-1);
    }
    if (role === 'personnel' && (!nurseWorkflow?.votingOpen) && selectedScenarioIndexNurse !== -1) {
      setSelectedScenarioIndexNurse(-1);
    }
  }, [role, selectedPersonnelUser, nurseWorkflow, selectedScenarioIndexNurse]);

  React.useEffect(() => {
    if (role === 'personnel' && selectedPersonnelUser?.jobGroup !== 'assistant' && selectedScenarioIndexAssistant !== -1) {
      setSelectedScenarioIndexAssistant(-1);
    }
    if (role === 'personnel' && (!assistantWorkflow?.votingOpen) && selectedScenarioIndexAssistant !== -1) {
      setSelectedScenarioIndexAssistant(-1);
    }
  }, [role, selectedPersonnelUser, assistantWorkflow, selectedScenarioIndexAssistant]);

  const reports = React.useMemo(() => {
    if (displayedSchedule && personnel.length > 0 && settings) {
      return generatePersonnelReports(currentYear, currentMonth, personnel, displayedSchedule, settings, customHolidays, firstDayOfWeekIndex, effectiveDutyHours);
    }
    return [];
  }, [personnel, displayedSchedule, settings, customHolidays, firstDayOfWeekIndex, currentYear, currentMonth, effectiveDutyHours]);
  // شمارندهٔ درخواست‌های باز بازیابی رمز، برای نمایش نشان هشدار روی منوی «مدیریت پرسنل».
  const { count: resetRequestCount } = useResetRequestCount(role === 'headnurse' || role === 'admin');

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
      setDepartmentListStatus('loading');
      try {
        const response = await fetch('/api/public/departments');
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'فهرست بخش‌ها دریافت نشد.');
        if (cancelled) return;
        const publicDepartments = result.departments as Department[];
        setDepartments(publicDepartments);
        setDepartmentListStatus('ready');
        if (publicDepartments.length > 0 && !publicDepartments.some(item => item.id === selectedDepartmentId)) {
          setSelectedDepartmentId(publicDepartments[0].id);
          localStorage.setItem('hospital_selected_dept_id', publicDepartments[0].id);
        }
      } catch {
        if (!cancelled) setDepartmentListStatus('error');
      }
    };
    void loadDepartmentOptions();
    return () => { cancelled = true; };
  }, [authenticatedUser, isAuthLoading, selectedDepartmentId]);

  const handlePortalLogin = async (portal: 'staff' | 'head-nurse') => {
    setAuthError('');
    setPortalNotice('');
    setStaffAuthNotice('');
    if (!departments.some(department => department.id === selectedDepartmentId)) {
      setAuthError('ابتدا یک بخش را انتخاب کنید یا به‌عنوان سرپرستار بخش جدید بسازید.');
      return;
    }
    // ارقام فارسی/عربی و فاصله‌های اضافی پیش از ارسال نرمال می‌شوند تا کاربری که با
    // صفحه‌کلید فارسی «۱۲۳۴» تایپ می‌کند، خطای «کد ملی یا رمز عبور نادرست» نگیرد.
    const nationalId = toEnglishDigits(portal === 'staff' ? staffNationalIdInput : headnurseUsernameInput).trim();
    const password = toEnglishDigits(portal === 'staff' ? staffPasswordInput : headnursePasswordInput).trim();
    if (!isValidIranianNationalId(nationalId)) {
      setAuthError('کد ملی معتبر نیست؛ لطفاً هر ۱۰ رقم کد ملی خود را درست وارد کنید.');
      return;
    }
    if (!password) {
      setAuthError('رمز عبور را وارد کنید. رمز اولیه برای حساب‌های جدید ۱۲۳۴ است.');
      return;
    }
    setIsPortalSubmitting(true);
    try {
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
    const nationalId = toEnglishDigits(staffNationalIdInput).trim();
    if (!isValidIranianNationalId(nationalId)) {
      setAuthError('برای ثبت درخواست بازیابی، ابتدا کد ملی معتبر خود را وارد کنید.');
      return;
    }
    // درخواست بازیابی باید به بخش انتخاب‌شده گره بخورد، وگرنه در پنل سرپرستار آن بخش
    // دیده نمی‌شود. بدون بخشِ معتبر اصلاً درخواستی ارسال نمی‌کنیم.
    if (!departments.some(department => department.id === selectedDepartmentId)) {
      setAuthError('ابتدا بخش خود را از فهرست بالا انتخاب کنید تا درخواست برای سرپرستار همان بخش ارسال شود.');
      return;
    }
    setIsResetRequestSubmitting(true);
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nationalId, departmentId: selectedDepartmentId }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'ثبت درخواست انجام نشد.');
      setStaffAuthNotice(result.message || 'درخواست شما ثبت شد؛ سرپرستار بخش رمز عبور شما را بازنشانی می‌کند.');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'خطا در ثبت درخواست بازیابی.');
    } finally {
      setIsResetRequestSubmitting(false);
    }
  };

  const handleHeadNurseOnboarding = async () => {
    setAuthError('');
    setPortalNotice('');
    setIsOnboardingSubmitting(true);
    try {
      const response = await fetch('/api/onboarding/head-nurse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departmentName: newDeptName,
          firstName: newHeadNurseFirstName,
          lastName: newHeadNurseLastName,
          nationalId: newHeadNurseNationalId,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'ساخت بخش انجام نشد.');
      const department = result.department as Department;
      setDepartments(current => [...current.filter(item => item.id !== department.id), department]);
      setSelectedDepartmentId(department.id);
      localStorage.setItem('hospital_selected_dept_id', department.id);
      setHeadnurseUsernameInput(newHeadNurseNationalId);
      setHeadnursePasswordInput('1234');
      setPortalNotice('بخش و حساب سرپرستار با موفقیت ساخته شد. با رمز اولیه ۱۲۳۴ وارد شوید.');
      setShowAddDeptModal(false);
      setNewDeptName('');
      setNewHeadNurseFirstName('');
      setNewHeadNurseLastName('');
      setNewHeadNurseNationalId('');
      setDepartmentListStatus('ready');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'خطا در ساخت بخش و حساب سرپرستار.');
    } finally {
      setIsOnboardingSubmitting(false);
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

  // finalizedNursesMonths, finalizedAssistantsMonths, dismissedWarnings, lockedRows
  // now managed by useScheduleState hook
  const [requestsLockedMonths, setRequestsLockedMonths] = useState<string[]>([]);

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
      case 'activeScenarios': return `department:${resource.departmentId}:activeScenarios`;
      case 'scenarioVotes': return `department:${resource.departmentId}:scenarioVotes`;
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
        { resource: { type: 'activeScenarios', departmentId }, before: (before as any)?.activeScenarios, after: (after as any)?.activeScenarios },
        { resource: { type: 'scenarioVotes', departmentId }, before: (before as any)?.scenarioVotes, after: (after as any)?.scenarioVotes },
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

  // با جایگزینی کامل وضعیت دیتابیس (بارگذاری، ذخیره یا بازیابی پس از تداخل)، تمام
  // stateهای محلی مشتق‌شده از آن نیز همگام می‌شوند تا رابط کاربری با سرور سازگار بماند.
  const syncLocalStateFromDb = (nextDb: AppDatabaseState) => {
    const deptId = selectedDepartmentId || 'sepehr';
    const deptInfo = nextDb.deptData[deptId] || {
      personnel: [],
      requests: [],
      settings_system: INITIAL_SETTINGS,
      settings_credentials: { username: 'headnurse', password: '123456' },
      holidays: {},
      firstDayOfWeek: {},
      schedules: {},
    };

    setDepartments(nextDb.departments || []);
    setPersonnel(deptInfo.personnel || []);
    setRequests(deptInfo.requests || []);
    setSettings(deptInfo.settings_system || INITIAL_SETTINGS);

    const hKey = `${currentYear}_${currentMonth}`;
    const holidaysInfo = deptInfo.holidays?.[hKey] || { days: {}, monthlyDutyHours: null };
    // فقط لایه‌ی تغییرات بخش بارگذاری می‌شود؛ تعطیلات رسمی از منبع کشور می‌آیند.
    setHolidayOverrides(holidaysInfo.days || {});
    setMonthlyDutyHours(holidaysInfo.monthlyDutyHours || null);

    const fdIdx = deptInfo.firstDayOfWeek?.[hKey];
    setFirstDayOfWeekIndex(fdIdx === -1 ? undefined : fdIdx);

    const sched = deptInfo.schedules?.[hKey] || null;
    setSchedule(sched);
    if (sched) {
      // هشدارهای رفع‌شده نباید در حالتِ «نادیده‌گرفته‌شده» باقی بمانند؛ در غیر این‌صورت
      // اگر همان تخلف دوباره ساخته شود، بی‌صدا پنهان می‌ماند.
      setDismissedWarnings(pruneDismissedWarnings(sched.warnings || [], sched.dismissedWarnings || []));
      setDismissedAlertWarnings(prev => pruneDismissedWarningMap(sched.warnings || [], prev));
      setLockedRows(sched.lockedRows || []);
      const isFinNurses = !!sched.finalizedNurses || !!sched.finalized;
      const isFinAssistants = !!sched.finalizedAssistants || !!sched.finalized;
      const isReqLocked = !!sched.requestsLocked;

      setFinalizedNursesMonths((prev: string[]) => {
        const key = `${currentYear}_${currentMonth}`;
        if (isFinNurses && !prev.includes(key)) return [...prev, key];
        if (!isFinNurses) return prev.filter(k => k !== key);
        return prev;
      });
      setFinalizedAssistantsMonths((prev: string[]) => {
        const key = `${currentYear}_${currentMonth}`;
        if (isFinAssistants && !prev.includes(key)) return [...prev, key];
        if (!isFinAssistants) return prev.filter(k => k !== key);
        return prev;
      });
      setRequestsLockedMonths((prev: string[]) => {
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
  };

  // Fetch the latest committed snapshot (state + ETags) for concurrency recovery.
  const fetchLatestSnapshot = async (): Promise<{ state: AppDatabaseState; versions: Record<string, string> }> => {
    const response = await fetch('/api/storage', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || !result.success || !result.state || !result.versions) {
      throw new Error(result.error || 'خواندن امن دیتابیس برای همگام‌سازی مجدد ناموفق بود.');
    }
    return { state: result.state as AppDatabaseState, versions: result.versions as Record<string, string> };
  };

  const readCommittedResourceValue = (snapshot: AppDatabaseState, resource: StorageResource): unknown => {
    if (resource.type === 'departments') return snapshot.departments;
    const dept = snapshot.deptData[resource.departmentId] as any;
    if (!dept) return undefined;
    switch (resource.type) {
      case 'personnel': return dept.personnel;
      case 'requests': return dept.requests;
      case 'settings': return {
        activeYear: dept.activeYear,
        settings_system: dept.settings_system,
        settings_credentials: dept.settings_credentials,
      };
      case 'holidays': return dept.holidays;
      case 'firstDayOfWeek': return dept.firstDayOfWeek;
      case 'schedule': return dept.schedules?.[resource.monthKey];
      case 'activeScenarios': return dept.activeScenarios;
      case 'scenarioVotes': return dept.scenarioVotes;
    }
  };

  // Merge a not-yet-written user change onto the freshly-read server snapshot.
  const applyMutationToSnapshot = (snapshot: AppDatabaseState, mutation: StorageMutation): AppDatabaseState => {
    const next: AppDatabaseState = JSON.parse(JSON.stringify(snapshot));
    const resource = mutation.resource;
    if (resource.type === 'departments') {
      next.departments = mutation.data as AppDatabaseState['departments'];
      return next;
    }
    const dept = next.deptData[resource.departmentId] as any;
    if (!dept) throw new Error(`داده بخش ${resource.departmentId} وجود ندارد.`);
    switch (resource.type) {
      case 'personnel': dept.personnel = mutation.data as typeof dept.personnel; break;
      case 'requests': dept.requests = mutation.data as typeof dept.requests; break;
      case 'settings': {
        const value = mutation.data as { activeYear?: number; settings_system: typeof dept.settings_system; settings_credentials: typeof dept.settings_credentials };
        dept.activeYear = value.activeYear;
        dept.settings_system = value.settings_system;
        dept.settings_credentials = value.settings_credentials;
        break;
      }
      case 'holidays': dept.holidays = mutation.data as typeof dept.holidays; break;
      case 'firstDayOfWeek': dept.firstDayOfWeek = mutation.data as typeof dept.firstDayOfWeek; break;
      case 'schedule': dept.schedules = { ...dept.schedules, [resource.monthKey]: mutation.data as typeof dept.schedules[string] }; break;
      case 'activeScenarios': dept.activeScenarios = mutation.data as any; break;
      case 'scenarioVotes': dept.scenarioVotes = mutation.data as any; break;
    }
    return next;
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
    syncLocalStateFromDb(updatedDb);

    // پیشرفت واقعی ذخیره‌سازی = نسبت منابع نوشته‌شده به کل منابع تغییر‌یافته.
    const totalMutations = Math.max(1, mutations.length);
    let completedMutations = 0;

    const writeMutationOnce = async (mutation: StorageMutation) => {
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
        if (result.code === 'ETAG_CONFLICT') throw new ConcurrencyConflictError(versionId);
        throw new Error(result.error || `خطای ذخیره منبع ${versionId}`);
      }
      storageVersionsRef.current[versionId] = result.etag;
      completedMutations += 1;
      if (showBusyOverlay) {
        saveProgressRef.current.reportPhaseFraction(completedMutations / totalMutations);
      }
    };

    const execute = async () => {
      setPendingDbSaveCount(count => count + 1);
      if (showBusyOverlay) {
        // نوار پیشرفت فقط برای ذخیره‌سازی‌های مسدودکننده (که پوشش لودینگ دارند) اجرا می‌شود.
        saveProgressRef.current.start('validate');
        saveProgressRef.current.beginPhase('upload');
        setBlockingDbSaveCount(count => count + 1);
      }
      try {
        let pendingMutations = mutations;
        // خطای تداخل نباید یک ذخیره معتبر را زمین‌گیر کند: در تداخل، جدیدترین وضعیت سرور
        // خوانده می‌شود، تغییر هدف کاربر روی آن مرج و یک‌بار دیگر ذخیره می‌شود؛ پس از آن
        // دیگر نیازی به تازه‌سازی دستی صفحه نیست. اگر تداخل تکرار شود، رفتار fail-closed باقی می‌ماند.
        for (let pass = 0; pass < 2 && pendingMutations.length > 0; pass += 1) {
          const succeeded: StorageMutation[] = [];
          let conflicted = false;
          for (const mutation of pendingMutations) {
            try {
              await writeMutationOnce(mutation);
              succeeded.push(mutation);
            } catch (error) {
              if (!(error instanceof ConcurrencyConflictError)) throw error;
              conflicted = true;
              break;
            }
          }
          if (!conflicted) {
            pendingMutations = [];
            break;
          }
          if (pass === 1) {
            throw new Error('اطلاعات توسط کاربر دیگری تغییر کرده است؛ برای جلوگیری از بازنویسی، صفحه را تازه‌سازی کنید.');
          }

          const snapshot = await fetchLatestSnapshot();
          storageVersionsRef.current = snapshot.versions;
          const remaining = pendingMutations.filter(m => !succeeded.includes(m));
          // تغییراتی که سرور هم‌اکنون با مقدار هدف ذخیره شده‌اند، دیگر نیاز به نوشتن ندارند.
          const converged = remaining.filter(m =>
            sameDocument(readCommittedResourceValue(snapshot.state, m.resource), m.data));
          let merged = snapshot.state;
          for (const mutation of remaining) merged = applyMutationToSnapshot(merged, mutation);
          optimisticDbRef.current = merged;
          setFullDbState(merged);
          syncLocalStateFromDb(merged);
          // وضعیت وجود سند دوباره محاسبه می‌شود تا شرط If-Match/If-None-Match درست انتخاب شود.
          pendingMutations = remaining
            .filter(m => !converged.includes(m))
            .map(m => ({
              ...m,
              existed: readCommittedResourceValue(snapshot.state, m.resource) !== undefined,
            }));
        }
        if (showBusyOverlay) saveProgressRef.current.beginPhase('sync');
      } catch (error) {
        // A batch can span multiple objects and S3 has no multi-object transaction.
        // Fail closed after any partial failure; a reload is required before more writes.
        storageWriteBlockedRef.current = true;
        if (showBusyOverlay) saveProgressRef.current.reset();
        throw error;
      } finally {
        setPendingDbSaveCount(count => Math.max(0, count - 1));
        if (showBusyOverlay) {
          saveProgressRef.current.complete();
          setBlockingDbSaveCount(count => Math.max(0, count - 1));
        }
      }
    };

    const queuedSave = saveQueueRef.current.then(execute);
    saveQueueRef.current = queuedSave.catch(() => undefined);
    return queuedSave;
  };

  // ==========================================================================
  // لاگ‌ها و اتفاقات — ثبت مرکزی رویدادها در «کارنامه و گزارشات»
  // ==========================================================================
  // همهٔ هشدارها و اتفاقات مهم سامانه (از جمله گزارش پردازش موتور هوشمند) در
  // برنامهٔ همان ماه ذخیره می‌شوند. فقط MAX_SYSTEM_EVENT_LOGS (۳۰) رویداد آخر
  // نگه داشته می‌شود و قدیمی‌ترها به‌صورت خودکار حذف می‌شوند تا فضای
  // ذخیره‌سازی پر نشود.

  /** برچسب کاربر جاری برای ستون «ثبت‌کننده» در لاگ. */
  const currentActorLabel = React.useMemo(() => {
    if (!authenticatedUser) return undefined;
    const roleLabel = authenticatedUser.role === 'ADMIN'
      ? 'مدیر سامانه'
      : authenticatedUser.role === 'HEAD_NURSE'
        ? 'سرپرستار بخش'
        : 'پرسنل';
    return `${authenticatedUser.firstName} ${authenticatedUser.lastName} (${roleLabel})`;
  }, [authenticatedUser]);

  const currentActorRef = React.useRef<string | undefined>(undefined);
  useEffect(() => {
    currentActorRef.current = currentActorLabel;
  }, [currentActorLabel]);

  /** رویدادهای ماه جاری، پس از ادغام رکوردهای متنی قدیمی و اعمال سقف ۳۰تایی. */
  const eventLogs = React.useMemo<SystemEventLog[]>(
    () => normalizeSystemEventLogs(schedule?.eventLogs, schedule?.changeLogs),
    [schedule?.eventLogs, schedule?.changeLogs]
  );

  /**
   * چند رویداد را روی سند برنامهٔ ماه مشخص می‌نشاند و سقف نگهداری را اعمال می‌کند.
   * اگر برنامه‌ای برای آن ماه وجود نداشته باشد، یک سند خالی معتبر ساخته می‌شود
   * تا رویداد از دست نرود.
   */
  const attachEventLogsToDb = React.useCallback((
    nextDb: AppDatabaseState,
    newEvents: ReadonlyArray<SystemEventLog>,
    targetMonthKey?: string
  ): AppDatabaseState => {
    if (newEvents.length === 0) return nextDb;
    const deptId = selectedDepartmentId || 'sepehr';
    const key = targetMonthKey || `${currentYear}_${currentMonth}`;
    const dept = (nextDb.deptData || {})[deptId] as any;
    if (!dept) return nextDb;

    const [yearPart, monthPart] = key.split('_');
    const existingSchedule = dept.schedules?.[key];
    const baseSchedule = existingSchedule || {
      year: Number(yearPart) || currentYear,
      month: Number(monthPart) || currentMonth,
      assignments: {},
      shiftLeaders: {},
      warnings: [],
    };

    const merged = appendSystemEventLogs(
      normalizeSystemEventLogs(baseSchedule.eventLogs, baseSchedule.changeLogs),
      newEvents,
      MAX_SYSTEM_EVENT_LOGS
    );

    const nextSchedule: any = { ...baseSchedule, eventLogs: merged };
    // رکوردهای متنی قدیمی پس از مهاجرت به رویداد ساخت‌یافته حذف می‌شوند تا
    // داده تکراری در فضای ذخیره‌سازی باقی نماند.
    if (nextSchedule.changeLogs) delete nextSchedule.changeLogs;

    nextDb.deptData[deptId] = {
      ...dept,
      schedules: { ...(dept.schedules || {}), [key]: nextSchedule },
    };
    return nextDb;
  }, [currentMonth, currentYear, selectedDepartmentId]);

  /**
   * ثبت رویداد در «لاگ‌ها و اتفاقات» و ذخیرهٔ آن در فضای ذخیره‌سازی.
   * fire-and-forget است: شکست ثبت لاگ هرگز نباید عملیات اصلی کاربر را خراب کند.
   *
   * عمداً useCallback نیست: به saveDbState/getFreshDbCopy وابسته است که در هر
   * رندر بازساخته می‌شوند و باید تازه‌ترین وضعیت را ببینند. دسترسی پایدار از
   * طریق recordEventsRef فراهم می‌شود.
   */
  const recordEvents = async (
    inputs: SystemEventInput | ReadonlyArray<SystemEventInput>,
    options: { monthKey?: string } = {}
  ) => {
    const list = Array.isArray(inputs) ? inputs : [inputs as SystemEventInput];
    if (list.length === 0) return;
    try {
      const now = new Date();
      const built = list.map(input => createSystemEventLog({
        actor: currentActorRef.current,
        ...input,
      }, now));
      const nextDb = attachEventLogsToDb(getFreshDbCopy(), built, options.monthKey);
      await saveDbState(nextDb, { showBusyOverlay: false });
    } catch (error) {
      // ثبت لاگ نباید مسیر اصلی را بشکند؛ فقط در کنسول گزارش می‌شود.
      console.warn('ثبت رویداد در لاگ‌ها و اتفاقات انجام نشد:', error);
    }
  };

  const recordEventsRef = React.useRef(recordEvents);
  useEffect(() => {
    recordEventsRef.current = recordEvents;
  });

  /** نسخهٔ بدون await برای فراخوانی از داخل هندلرهای همگام. */
  const logEvent = React.useCallback((
    input: SystemEventInput,
    options: { monthKey?: string } = {}
  ) => {
    void recordEventsRef.current(input, options);
  }, []);

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
          // فقط لایه‌ی تغییرات بخش بارگذاری می‌شود؛ تعطیلات رسمی از منبع کشور می‌آیند.
          setHolidayOverrides(holidaysInfo.days || {});
          setMonthlyDutyHours(holidaysInfo.monthlyDutyHours || null);

          const fdIdx = deptInfo.firstDayOfWeek?.[hKey];
          setFirstDayOfWeekIndex(fdIdx === -1 ? undefined : fdIdx);

          const sched = deptInfo.schedules?.[hKey] || null;
          setSchedule(sched);
          if (sched) {
            // هم‌ترازسازی وضعیت نادیده‌گرفتن با هشدارهای فعلی (هشدار رفع‌شده = حذف کامل).
            setDismissedWarnings(pruneDismissedWarnings(sched.warnings || [], sched.dismissedWarnings || []));
            setDismissedAlertWarnings(prev => pruneDismissedWarningMap(sched.warnings || [], prev));
            setLockedRows(sched.lockedRows || []);
            const isFinNurses = !!sched.finalizedNurses || !!sched.finalized;
            const isFinAssistants = !!sched.finalizedAssistants || !!sched.finalized;
            const isReqLocked = !!sched.requestsLocked;

            setFinalizedNursesMonths((prev: string[]) => {
              const key = `${currentYear}_${currentMonth}`;
              if (isFinNurses && !prev.includes(key)) return [...prev, key];
              if (!isFinNurses) return prev.filter(k => k !== key);
              return prev;
            });
            setFinalizedAssistantsMonths((prev: string[]) => {
              const key = `${currentYear}_${currentMonth}`;
              if (isFinAssistants && !prev.includes(key)) return [...prev, key];
              if (!isFinAssistants) return prev.filter(k => k !== key);
              return prev;
            });
            setRequestsLockedMonths((prev: string[]) => {
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

  const getWorkflowForGroup = React.useCallback((group: JobGroup): ScenarioWorkflowGroup | null => {
    return group === 'nurse' ? nurseWorkflow : assistantWorkflow;
  }, [assistantWorkflow, nurseWorkflow]);

  const getSelectedScenarioIndexForGroup = React.useCallback((group: JobGroup): number => {
    return group === 'nurse' ? selectedScenarioIndexNurse : selectedScenarioIndexAssistant;
  }, [selectedScenarioIndexAssistant, selectedScenarioIndexNurse]);

  const getSelectedScenarioForGroup = React.useCallback((group: JobGroup): ScoredSchedule | null => {
    const workflow = getWorkflowForGroup(group);
    const index = getSelectedScenarioIndexForGroup(group);
    if (!workflow || index < 0) return null;
    return workflow.scenarios[index] || null;
  }, [getSelectedScenarioIndexForGroup, getWorkflowForGroup]);

  const setSelectedScenarioIndexForGroup = React.useCallback((group: JobGroup, index: number) => {
    if (group === 'nurse') setSelectedScenarioIndexNurse(index);
    else setSelectedScenarioIndexAssistant(index);
  }, []);

  const setSelectedScenarioByIdForGroup = React.useCallback((group: JobGroup, scenarioId: number | null) => {
    if (scenarioId === null) {
      setSelectedScenarioIndexForGroup(group, -1);
      return;
    }
    const workflow = getWorkflowForGroup(group);
    if (!workflow) return;
    const nextIndex = workflow.scenarios.findIndex(scenario => scenario.id === scenarioId);
    setSelectedScenarioIndexForGroup(group, nextIndex >= 0 ? nextIndex : -1);
  }, [getWorkflowForGroup, setSelectedScenarioIndexForGroup]);

  // ====== تابع کلیک روی هشدار و اسکرول (درخواست ۴) ======
  // پیش از پرش به سلول، موقعیت فعلی اسکرول ثبت می‌شود تا پس از رفع هشدار
  // بتوان به همان نقطه بازگشت.
  const handleAlertClick = (personnelId: string, day: number, warningText?: string) => {
    const cellId = `cell-${personnelId}-${day}`;
    const wasAlertCenterOpen = showAlertCenter;
    const snapshot = captureScrollSnapshot(document.getElementById(cellId));

    setShowAlertCenter(false);

    setTimeout(() => {
      const element = document.getElementById(cellId);
      if (element) {
        if (warningText) {
          alertReturnRef.current = {
            warningText,
            targetId: cellId,
            snapshot,
            reopenAlertCenter: wasAlertCenterOpen,
          };
          setAlertReturnAvailable(true);
        }
        setHighlightedCellId(cellId);
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => {
          setHighlightedCellId(current => current === cellId ? null : current);
        }, 3200);
      }
    }, 100);
  };

  // ====== پرش به کل ستون یک روز (هشدارهای عمومی: کمبود/مازاد نیرو) ======
  // برخلاف هشدارهای پرسنلی، این هشدارها به یک سلول مشخص وصل نیستند؛ بنابراین
  // به سربرگ آن روز اسکرول می‌کنیم و کل ستون آن روز هایلایت می‌شود.
  const handleDayAlertClick = (day: number, warningText?: string) => {
    const headerId = `day-header-${day}`;
    const wasAlertCenterOpen = showAlertCenter;
    const snapshot = captureScrollSnapshot(document.getElementById(headerId));

    setShowAlertCenter(false);

    setTimeout(() => {
      const element = document.getElementById(headerId);
      if (element) {
        if (warningText) {
          alertReturnRef.current = {
            warningText,
            targetId: headerId,
            snapshot,
            reopenAlertCenter: wasAlertCenterOpen,
          };
          setAlertReturnAvailable(true);
        }
        setHighlightedDay(day);
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        // اگر بازگشت خودکار ثبت شده باشد، هایلایت تا رفع هشدار (یا انصراف کاربر)
        // باقی می‌ماند تا سرپرستار ستون را گم نکند؛ در غیر این صورت پس از ۶ ثانیه پاک می‌شود.
        if (!warningText) {
          setTimeout(() => {
            setHighlightedDay(current => (current === day ? null : current));
          }, 6000);
        }
      }
    }, 100);
  };

  // بازگشت دستی/خودکار به موقعیت ثبت‌شده‌ی هشدار
  const returnToAlertPosition = React.useCallback((options: { reopenAlertCenter?: boolean } = {}) => {
    const pending = alertReturnRef.current;
    alertReturnRef.current = null;
    setAlertReturnAvailable(false);
    setHighlightedDay(null);
    if (!pending) return;

    restoreScrollSnapshot(pending.snapshot, { behavior: 'smooth' });

    const shouldReopen = options.reopenAlertCenter ?? pending.reopenAlertCenter;
    if (shouldReopen) {
      // کمی صبر تا اسکرول نرم تمام شود، سپس پنجره هشدارها دوباره باز شود
      setTimeout(() => setShowAlertCenter(true), 450);
    }
  }, []);

  const cancelAlertReturn = React.useCallback(() => {
    alertReturnRef.current = null;
    setAlertReturnAvailable(false);
    setHighlightedDay(null);
  }, []);

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

  const alertCenterSchedule = displayedSchedule;

  const getVisibleWarnings = () => {
    if (!alertCenterSchedule) return [];
    const visible = filterActiveWarnings(alertCenterSchedule.warnings, dismissedWarnings)
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
    if (!alertCenterSchedule) return [];
    return filterActiveWarnings(alertCenterSchedule.warnings, dismissedWarnings)
      .filter(w => !dismissedAlertWarnings[w]);
  }, [alertCenterSchedule, dismissedWarnings, dismissedAlertWarnings]);

  const alertCenterContextLabel = React.useMemo(() => {
    if (currentScenarioNurse && currentScenarioAssistant) {
      return `هشدارهای در حال نمایش: ${currentScenarioNurse.scenarioKey} پرستاران + ${currentScenarioAssistant.scenarioKey} کمک‌بهیاران`;
    }
    if (currentScenarioNurse) {
      return `هشدارهای در حال نمایش: برنامه ${currentScenarioNurse.scenarioKey} پرستاران`;
    }
    if (currentScenarioAssistant) {
      return `هشدارهای در حال نمایش: برنامه ${currentScenarioAssistant.scenarioKey} کمک‌بهیاران`;
    }
    return 'هشدارهای در حال نمایش: برنامه مبنا';
  }, [currentScenarioAssistant, currentScenarioNurse]);

  const alertCenterContextDescription = React.useMemo(() => {
    if (currentScenarioNurse || currentScenarioAssistant) {
      return 'با تغییر برنامه فعال در جدول، همین پنجره نارنجی هم بلافاصله با هشدارهای همان برنامه به‌روزرسانی می‌شود.';
    }
    return 'در حال حاضر هشدارهای برنامه مبنا نمایش داده می‌شود.';
  }, [currentScenarioAssistant, currentScenarioNurse]);

  // تمام هشدارها (شامل نادیده‌گرفته‌شده‌ها) برای پنجره هشدار
  const allAlertsForDialog = React.useMemo<AggregatedAlert[]>(() => {
    if (!alertCenterSchedule) return [];
    const warningsForDialog = filterActiveWarnings(alertCenterSchedule.warnings, dismissedWarnings);
    return aggregateWarnings(warningsForDialog, personnel);
  }, [alertCenterSchedule, dismissedWarnings, personnel]);

  // ====== بازگشت خودکار به موقعیت قبلی پس از رفع هشدار ======
  // اگر کاربر با «رفتن به سلول» به سلول پرید و پس از ویرایش دستی، همان هشدار
  // از فهرست هشدارهای برنامه حذف شد، صفحه به آخرین موقعیتی که در آن هشدار را
  // مشاهده می‌کرد بازمی‌گردد.
  React.useEffect(() => {
    const pending = alertReturnRef.current;
    if (!pending) return;
    if (!displayedSchedule) return;

    const stillExists = (displayedSchedule.warnings || []).includes(pending.warningText);
    if (stillExists) return;

    const canReopen = pending.reopenAlertCenter;
    const timer = setTimeout(() => {
      returnToAlertPosition({ reopenAlertCenter: false });
      setAlertReturnToast({
        message: 'هشدار برطرف شد و صفحه به موقعیت قبلی بازگشت.',
        canReopen,
      });
    }, 350);

    return () => clearTimeout(timer);
  }, [displayedSchedule, returnToAlertPosition]);

  // پنهان‌سازی خودکار پیام بازگشت
  React.useEffect(() => {
    if (!alertReturnToast) return;
    const timer = setTimeout(() => setAlertReturnToast(null), 7000);
    return () => clearTimeout(timer);
  }, [alertReturnToast]);

  // اگر کاربر ماه/بخش را عوض کند، نقطه بازگشت ثبت‌شده بی‌اعتبار است
  React.useEffect(() => {
    return () => {
      alertReturnRef.current = null;
      setAlertReturnAvailable(false);
      setAlertReturnToast(null);
      setHighlightedDay(null);
    };
  }, [selectedDepartmentId, currentYear, currentMonth]);

  // ====== پاک‌سازی خودکار هشدارهای رفع‌شده ======
  // به‌محض اینکه سرپرستار مشکلی را در برنامه واقعاً برطرف کند، هشدارِ آن دیگر
  // بازتولید نمی‌شود. در این حالت رکورد «نادیده‌گرفتنِ» آن هشدار هم باید از حالت
  // برنامه و از پایگاه داده حذف شود، وگرنه دو مشکل پیش می‌آید:
  //   ۱) اگر همان تخلف بعداً دوباره ساخته شود، متن هشدار یکسان است و به‌خاطر رکورد
  //      قدیمی بی‌صدا پنهان می‌ماند و سرپرستار از آن باخبر نمی‌شود.
  //   ۲) شمارندهٔ «بازیابی همه» عددی نشان می‌دهد که ربطی به وضعیت فعلی برنامه ندارد.
  React.useEffect(() => {
    if (!schedule) return;
    const activeWarnings = schedule.warnings || [];

    setDismissedAlertWarnings(prev => {
      const next = pruneDismissedWarningMap(activeWarnings, prev);
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });

    const pruned = pruneDismissedWarnings(activeWarnings, dismissedWarnings);
    if (!dismissedWarningsChanged(dismissedWarnings, pruned)) return;

    setDismissedWarnings(pruned);

    // فهرست هم‌ترازشده در پایگاه داده هم ماندگار می‌شود (بدون نمایش لایهٔ انتظار).
    const key = `${currentYear}_${currentMonth}`;
    const deptId = selectedDepartmentId || 'sepehr';
    const nextDb = getFreshDbCopy();
    const oldDept = nextDb?.deptData?.[deptId];
    const existingSched = oldDept?.schedules?.[key];
    if (!oldDept || !existingSched) return;
    if (!dismissedWarningsChanged(existingSched.dismissedWarnings || [], pruned)) return;

    nextDb.deptData[deptId] = {
      ...oldDept,
      schedules: {
        ...oldDept.schedules,
        [key]: { ...existingSched, dismissedWarnings: pruned },
      },
    };
    void saveDbState(nextDb, { showBusyOverlay: false }).catch(error => {
      console.error('Error pruning resolved warnings:', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, dismissedWarnings, currentYear, currentMonth, selectedDepartmentId]);

  // ====== پایش پیوسته، جبران خودکار کمبود/مازاد و بازتولید پویای هشدارها ======
  // این effect هر بار که برنامه (schedule) تغییر می‌کند:
  //   ۱) ابتدا کمبود و مازاد نیرو را به‌صورت خودکار و زنجیره‌وار جبران می‌کند
  //      (تا ۳ بار اجرا می‌شود تا اثرات آبشاری هم پوشش داده شوند)
  //   ۲) سپس هشدارها را بازتولید می‌کند
  //   ۳) در صورت تفاوت، schedule را به‌روزرسانی می‌کند
  // قوانین:
  //   - تغییر دستی سرپرستار حفظ می‌شود
  //   - شیفت نفرات قفل‌شده (lockedRows) هرگز تغییر نمی‌کند
  //   - فقط در صورتی که هیچ راهی نباشد، هشدار صادر می‌شود
  const previousAssignmentsKeyRef = React.useRef<string>('');
  const previousWarningsKeyRef = React.useRef<string>('');
  const isReevaluatingRef = React.useRef<boolean>(false);

  React.useEffect(() => {
    if (!schedule || !settings) return;
    if (isReevaluatingRef.current) return;

    const currentPersonnel = personnelRef.current;
    const currentRequests = requestsRef.current;
    const currentSettings = settingsRef.current;
    const currentHolidays = holidaysRef.current;
    const currentFirstDay = firstDayRef.current;
    const currentLocked = lockedRowsRef.current;

    if (!currentPersonnel.length || !currentSettings) return;

    const assignmentsKey = JSON.stringify(schedule.assignments);
    const assignmentsChanged = assignmentsKey !== previousAssignmentsKeyRef.current;
    previousAssignmentsKeyRef.current = assignmentsKey;

    // ====== گام ۱: جبران خودکار کمبود و مازاد نیرو (زنجیره‌وار) ======
    let effectiveAssignments = schedule.assignments;
    if (assignmentsChanged) {
      const calendar = generateJalaliMonthCalendar(
        currentYear, currentMonth, currentHolidays, currentFirstDay === -1 ? undefined : currentFirstDay
      );
      const calendarDays = calendar.map(d => ({ day: d.day, isHoliday: d.isHoliday }));
      const protectedSet = protectedCellsRef.current;

      const MAX_PASSES = 3;
      let prevUnresolvedCount = Infinity;
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        const staffingResult = reconcileStaffingCoverage(
          effectiveAssignments,
          currentPersonnel,
          currentSettings,
          calendarDays,
          ['nurse', 'assistant'],
          currentLocked, // ← شیفت نفرات قفل‌شده هرگز تغییر نمی‌کند
          currentRequests,
          protectedSet   // ← سلول‌های ویرایش‌دستی سرپرستار هرگز دست‌نخورده می‌مانند
        );
        effectiveAssignments = staffingResult.assignments;
        if (staffingResult.unresolvedGaps.length === 0) break;
        if (staffingResult.unresolvedGaps.length >= prevUnresolvedCount) break;
        prevUnresolvedCount = staffingResult.unresolvedGaps.length;
      }
    }

    // ====== گام ۲: بازتولید هشدارها بر اساس assignments جبران‌شده ======
    const verification = verifyCoverageAndLeaders(
      currentYear,
      currentMonth,
      currentPersonnel,
      effectiveAssignments,
      currentSettings,
      currentHolidays,
      currentFirstDay === -1 ? undefined : currentFirstDay,
      currentRequests
    );

    const freshWarnings = verification.warnings;
    const currentWarnings = schedule.warnings || [];

    const freshKey = [...freshWarnings].sort().join('|||');
    const currentKey = [...currentWarnings].sort().join('|||');
    const reconciledAssignmentsKey = JSON.stringify(effectiveAssignments);

    const assignmentsActuallyChanged = reconciledAssignmentsKey !== JSON.stringify(schedule.assignments);
    const warningsActuallyChanged = freshKey !== currentKey;

    if (!assignmentsActuallyChanged && !warningsActuallyChanged) {
      previousWarningsKeyRef.current = freshKey;
      return;
    }

    if (!assignmentsActuallyChanged && freshKey === previousWarningsKeyRef.current) return;
    previousWarningsKeyRef.current = freshKey;

    isReevaluatingRef.current = true;

    const updatedSchedule: MonthlySchedule = {
      ...schedule,
      assignments: effectiveAssignments,
      warnings: freshWarnings,
      shiftLeaders: verification.shiftLeaders,
      dismissedWarnings: pruneDismissedWarnings(freshWarnings, schedule.dismissedWarnings || []),
    };

    setSchedule(updatedSchedule);
    setDismissedAlertWarnings(prev => pruneDismissedWarningMap(freshWarnings, prev));
    setDismissedWarnings(prev => pruneDismissedWarnings(freshWarnings, prev));

    // ذخیره در پایگاه داده (بدون نمایش لایهٔ انتظار)
    const key = `${currentYear}_${currentMonth}`;
    const deptId = selectedDepartmentId || 'sepehr';
    const nextDb = getFreshDbCopy();
    const oldDept = nextDb?.deptData?.[deptId];
    if (oldDept) {
      nextDb.deptData[deptId] = {
        ...oldDept,
        schedules: {
          ...oldDept.schedules,
          [key]: {
            ...updatedSchedule,
            lockedRows: currentLocked,
          },
        },
      };
      void saveDbState(nextDb, { showBusyOverlay: false }).catch(error => {
        console.error('Error updating schedule after auto-reconciliation:', error);
      }).finally(() => {
        isReevaluatingRef.current = false;
      });
    } else {
      isReevaluatingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, currentYear, currentMonth, selectedDepartmentId, settings]);

  const smartSuggestions = React.useMemo<SmartSuggestion[]>(() => {
    if (!displayedSchedule) return [];
    return generateSmartSuggestions(
      currentYear,
      currentMonth,
      personnel,
      requests,
      displayedSchedule.assignments,
      visibleWarnings,
      customHolidays,
      firstDayOfWeekIndex
    );
  }, [displayedSchedule, currentYear, currentMonth, personnel, requests, customHolidays, firstDayOfWeekIndex, visibleWarnings]);

  // UI Tabs & Active View
  const [activeTab, setActiveTab] = useState<'schedule' | 'personnel' | 'requests' | 'reports' | 'settings' | 'calendar' | 'profile'>('schedule');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: 'personnel' | 'request'; label: string } | null>(null);
  const [isNavOpen, setIsNavOpen] = useState<boolean>(false);

  // Personnel form state management (extracted to custom hook in Phase 4)
  const personnelForm = usePersonnelForm();
  
  // Destructure for backward compatibility with existing code
  const showAddPersonnelModal = personnelForm.isOpen;
  const editingPersonnel = personnelForm.editingPersonnel;

  // Forms states for Personnel (destructured from hook)
  const formFirstName = personnelForm.formData.firstName;
  const setFormFirstName = personnelForm.setFormFirstName;
  const formLastName = personnelForm.formData.lastName;
  const setFormLastName = personnelForm.setFormLastName;
  const formPersonalCode = personnelForm.formData.personalCode;
  const setFormPersonalCode = personnelForm.setFormPersonalCode;
  const formNationalId = personnelForm.formData.nationalId;
  const setFormNationalId = personnelForm.setFormNationalId;
  const [pendingPersonnelId, setPendingPersonnelId] = useState<string | null>(null);
  const [isLoadingPersonnelNationalId, setIsLoadingPersonnelNationalId] = useState(false);
  const formJobGroup = personnelForm.formData.jobGroup;
  const setFormJobGroup = personnelForm.setFormJobGroup;
  const formPosition = personnelForm.formData.position;
  const setFormPosition = personnelForm.setFormPosition;
  const formEmploymentType = personnelForm.formData.employmentType;
  const setFormEmploymentType = personnelForm.setFormEmploymentType;
  const formExperienceYears = personnelForm.formData.experienceYears;
  const setFormExperienceYears = personnelForm.setFormExperienceYears;
  const formActive = personnelForm.formData.active;
  const setFormActive = personnelForm.setFormActive;
  const formCanBeShiftLeader = personnelForm.formData.canBeShiftLeader;
  const setFormCanBeShiftLeader = personnelForm.setFormCanBeShiftLeader;
  const formWorkRoutine = personnelForm.formData.workRoutine;
  const setFormWorkRoutine = personnelForm.setFormWorkRoutine;

  // Forms states for Request
  const [showAddRequestModal, setShowAddRequestModal] = useState<boolean>(false);
  const [editingRequest, setEditingRequest] = useState<ShiftRequest | null>(null);
  // ویرایش نامحدود درخواست ثبت‌شده به‌صورت روزبه‌روز روی تقویم (تا پیش از اتمام مهلت)
  const [requestEditTarget, setRequestEditTarget] = useState<ShiftRequest | null>(null);
  const [requestEditDays, setRequestEditDays] = useState<Record<number, NonNullable<ShiftRequest['preferredShift']>>>({});
  const [requestEditActiveDay, setRequestEditActiveDay] = useState<number | null>(null);
  const [isSavingRequestEdit, setIsSavingRequestEdit] = useState<boolean>(false);
  // editingCell now managed by useScheduleState hook
  const [reqPersonnelId, setReqPersonnelId] = useState<string>('');
  const [reqType, setReqType] = useState<'shift' | 'OFF' | 'leave' | 'pattern' | 'avoid_shift'>('shift');
  const [reqPreferredShift, setReqPreferredShift] = useState<'M' | 'E' | 'N' | 'ME' | 'EN' | 'MN' | 'MEN' | 'OFF' | 'L'>('M');
  const [reqPatternInput, setReqPatternInput] = useState<string>('EN OFF OFF');
  const [reqIsEssential, setReqIsEssential] = useState<boolean>(false);
  const [reqOffHardness, setReqOffHardness] = useState<'hard' | 'soft' | undefined>(undefined);
  const [reqScope, setReqScope] = useState<'all' | 'even' | 'odd' | 'saturdays' | 'sundays' | 'mondays' | 'tuesdays' | 'wednesdays' | 'thursdays' | 'fridays' | 'range' | 'weekly_even' | 'weekly_odd' | 'custom_days'>('all');
  const [reqStartDate, setReqStartDate] = useState<string>('1405/03/01');
  const [reqEndDate, setReqEndDate] = useState<string>('1405/03/31');
  const [reqSelectedDays, setReqSelectedDays] = useState<number[]>([]);

  // Additional system request states
  const [draftRequests, setDraftRequests] = useState<ShiftRequest[]>([]);
  const [showSplitRequests, setShowSplitRequests] = useState<boolean>(false);
  const [quickSelectedTemplateId, setQuickSelectedTemplateId] = useState<QuickRequestTemplateId | null>(null);
  // زیرشاخه‌های هر الگو به‌صورت پیش‌فرض مخفی‌اند و فقط با کلیک روی همان کارت باز می‌شوند
  const [quickScopePickerFor, setQuickScopePickerFor] = useState<QuickRequestTemplateId | null>(null);
  // هر دو بخش «درخواست‌های پرکاربرد» و «CHAT BOX» در ابتدا بسته‌اند
  const [openRequestPanel, setOpenRequestPanel] = useState<'quick' | 'chat' | null>(null);
  const [quickSelectedScope, setQuickSelectedScope] = useState<QuickRequestScope>('odd');
  const [quickSelectedDays, setQuickSelectedDays] = useState<number[]>([]);
  const [quickPersonnelId, setQuickPersonnelId] = useState<string>('');
  const [isQuickRequestSubmitting, setIsQuickRequestSubmitting] = useState<boolean>(false);
  const [requestChatMessages, setRequestChatMessages] = useState<RequestChatMessage[]>([]);
  const [requestChatInput, setRequestChatInput] = useState<string>('');
  const [isRequestChatProcessing, setIsRequestChatProcessing] = useState<boolean>(false);
  const [chatProposedRequests, setChatProposedRequests] = useState<ChatProposedShiftRequest[]>([]);
  const requestChatInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [isChatFullscreen, setIsChatFullscreen] = useState<boolean>(false);
  const [chatFailedText, setChatFailedText] = useState<string | null>(null);
  const requestChatScrollRef = React.useRef<HTMLDivElement | null>(null);

  // ====== ویرایش آیتم‌های کادر نتیجهٔ تحلیل (پیش از ثبت نهایی) ======
  // برای هر آیتم chatProposedRequests، می‌توان روی روزهایش کلیک کرد و شیفت هر روز را
  // به‌صورت مستقیم عوض کرد. این state جدا از ویرایشگر درخواست‌های ثبت‌شده است.
  const [chatEditingIndex, setChatEditingIndex] = useState<number | null>(null);
  // snapshot روز→شیفت برای آیتم در حال ویرایش (مثل state ویرایشگر اصلی)
  const [chatEditingDays, setChatEditingDays] = useState<Record<number, NonNullable<ShiftRequest['preferredShift']>>>({});
  const [chatEditingActiveDay, setChatEditingActiveDay] = useState<number | null>(null);

  // ====== بزرگ‌نمایی تصویر پیوست‌شده در چت ======
  const [chatImageModal, setChatImageModal] = useState<{ url: string; caption?: string } | null>(null);

  // ====== قابلیت جدید: ارسال تصویر دست‌نوشته (Handwritten OCR) ======
  // تصویر فقط در حافظهٔ RAM (به‌صورت ObjectURL + data URL) نگه داشته می‌شود
  // و پس از ارسال به API، فوراً آزاد می‌شود. هیچ فایلی روی سرور ذخیره نمی‌شود.
  const [handwrittenImageFile, setHandwrittenImageFile] = useState<File | null>(null);
  const [handwrittenImagePreview, setHandwrittenImagePreview] = useState<string | null>(null);
  const [isHandwrittenParsing, setIsHandwrittenParsing] = useState<boolean>(false);
  const [handwrittenParseError, setHandwrittenParseError] = useState<string | null>(null);
  const handwrittenFileInputRef = React.useRef<HTMLInputElement | null>(null);
  // نگهداری آخرین ObjectURL در ref تا در زمان unmount قطعی آزاد شود
  // (اگر فقط روی state گوش می‌دادیم، موقع unmount به آن دسترسی نداشتیم)
  const handwrittenImagePreviewRef = React.useRef<string | null>(null);
  useEffect(() => {
    handwrittenImagePreviewRef.current = handwrittenImagePreview;
  }, [handwrittenImagePreview]);
  // پاک‌سازی قطعی: هنگام unmount کامپوننت، ObjectURL مرورگر آزاد می‌شود تا حافظهٔ RAM آزاد شود
  useEffect(() => {
    return () => {
      if (handwrittenImagePreviewRef.current) {
        URL.revokeObjectURL(handwrittenImagePreviewRef.current);
        handwrittenImagePreviewRef.current = null;
      }
    };
  }, []);

  // همهٔ URLهای تصویر که در حباب‌های پیام چت نگه داشته شده‌اند؛ در unmount و
  // تعویض پرسنل یکجا آزاد می‌شوند تا هیچ blob url روی RAM باقی نماند.
  const chatImageUrlsRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    // کپی مقدار در زمان mount تا در cleanup به مقدار زمان mount دسترسی داشته باشیم
    const urlsAtMount = chatImageUrlsRef.current;
    return () => {
      urlsAtMount.forEach(url => {
        try { URL.revokeObjectURL(url); } catch { /* ignore */ }
      });
      urlsAtMount.clear();
    };
  }, []);


  // اسکرول خودکار به جدیدترین پیام چت
  useEffect(() => {
    const container = requestChatScrollRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    }
  }, [requestChatMessages, isRequestChatProcessing, isChatFullscreen]);

  // در حالت تمام صفحه اسکرول پس‌زمینه قفل می‌شود؛ با خروج، ارتفاع تکست‌اریا ریست می‌شود
  useEffect(() => {
    if (isChatFullscreen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
    if (requestChatInputRef.current) {
      requestChatInputRef.current.style.height = '';
    }
  }, [isChatFullscreen]);

  // خروج از حالت تمام صفحه با کلید ESC
  useEffect(() => {
    if (!isChatFullscreen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsChatFullscreen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isChatFullscreen]);

  // عملیات حساس مدیریت بخش: حذف دائمی بخش (با احراز هویت مجدد) و انتقال امن مدیریت
  const [showDeleteDeptModal, setShowDeleteDeptModal] = useState<boolean>(false);
  const [deleteDeptNationalId, setDeleteDeptNationalId] = useState<string>('');
  const [deleteDeptPassword, setDeleteDeptPassword] = useState<string>('');
  const [isDeletingDept, setIsDeletingDept] = useState<boolean>(false);
  const [showTransferDeptModal, setShowTransferDeptModal] = useState<boolean>(false);
  const [transferPrevNationalId, setTransferPrevNationalId] = useState<string>('');
  const [transferPrevPassword, setTransferPrevPassword] = useState<string>('');
  const [transferNewNationalId, setTransferNewNationalId] = useState<string>('');
  const [transferNewFirstName, setTransferNewFirstName] = useState<string>('');
  const [transferNewLastName, setTransferNewLastName] = useState<string>('');
  const [isTransferringDept, setIsTransferringDept] = useState<boolean>(false);

  React.useEffect(() => {
    if (role === 'personnel' && selectedPersonnelUser?.id) {
      setQuickPersonnelId(selectedPersonnelUser.id);
      return;
    }
    if (quickPersonnelId && personnel.some(person => person.id === quickPersonnelId)) return;
    setQuickPersonnelId(personnel[0]?.id || '');
  }, [personnel, quickPersonnelId, role, selectedPersonnelUser]);

  const requestChatPersonnel = React.useMemo(() => {
    if (role === 'personnel') return selectedPersonnelUser;
    return personnel.find(person => person.id === quickPersonnelId) || null;
  }, [personnel, quickPersonnelId, role, selectedPersonnelUser]);

  // حریم خصوصی چت: تاریخچه هر کاربر فقط در حافظهٔ همین نشست است و هیچ‌جا
  // ذخیره نمی‌شود؛ با تعویض پرسنل، گفت‌وگوی قبلی کاملاً پاک می‌شود تا
  // تاریخچهٔ چت کاربران برای یکدیگر قابل مشاهده نباشد.
  React.useEffect(() => {
    const firstName = requestChatPersonnel?.firstName || 'دوست خوبم';
    setRequestChatMessages([
      {
        id: `chat_hello_${requestChatPersonnel?.id || 'guest'}_${currentYear}_${currentMonth}`,
        role: 'assistant',
        content: `سلام ${firstName} جان 👋 من اینجام که درخواستت رو دقیق و بدون خطا تبدیل کنم به فرم شیفت. هرچی می‌خوای خودمونی بنویس؛ اگر چیزی مبهم باشه قبل از ثبت ازت می‌پرسم.`,
        timestamp: new Date().toISOString(),
      },
    ]);
    setChatProposedRequests([]);
    setRequestChatInput('');
    setChatFailedText(null);
    // تصویر دست‌نوشتهٔ انتخاب‌شده (اگر هست) هم پاک می‌شود تا برای پرسنل بعدی
    // لو نرود؛ هیچ فایلی روی سرور ذخیره نشده و فقط URL مرورگر آزاد می‌شود.
    setHandwrittenImageFile(null);
    setHandwrittenParseError(null);
    if (handwrittenImagePreview) {
      URL.revokeObjectURL(handwrittenImagePreview);
      setHandwrittenImagePreview(null);
    }
    if (handwrittenFileInputRef.current) {
      handwrittenFileInputRef.current.value = '';
    }
    // همهٔ URLهای تصاویر حباب‌های چت قبلی هم آزاد می‌شود تا حافظهٔ RAM پاک شود
    chatImageUrlsRef.current.forEach(url => {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    });
    chatImageUrlsRef.current.clear();
  }, [requestChatPersonnel?.id, requestChatPersonnel?.firstName, currentYear, currentMonth]);

  // ====== ویرایش روزبه‌روز درخواست‌های ثبت‌شده ======
  // کدهای شیفت قابل انتخاب در تقویم ویرایش (شامل آف و مرخصی)
  const EDITABLE_SHIFT_CODES: ReadonlyArray<{ code: NonNullable<ShiftRequest['preferredShift']>; label: string; className: string }> = [
    { code: 'M', label: 'صبح (M)', className: 'bg-sky-100 text-sky-800 border-sky-300' },
    { code: 'E', label: 'عصر (E)', className: 'bg-amber-100 text-amber-800 border-amber-300' },
    { code: 'N', label: 'شب (N)', className: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
    { code: 'ME', label: 'صبح-عصر (ME)', className: 'bg-teal-100 text-teal-800 border-teal-300' },
    { code: 'EN', label: 'عصر-شب (EN)', className: 'bg-violet-100 text-violet-800 border-violet-300' },
    { code: 'MN', label: 'شب-صبح (MN)', className: 'bg-cyan-100 text-cyan-800 border-cyan-300' },
    { code: 'MEN', label: '۲۴ ساعته (MEN)', className: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300' },
    { code: 'OFF', label: 'آف 😴', className: 'bg-slate-200 text-slate-800 border-slate-400' },
    { code: 'L', label: 'مرخصی 🏖', className: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  ];

  // روزهای واقعی یک درخواست را بر اساس scope آن روی تقویم ماه جاری باز می‌کند
  const resolveRequestDays = (r: ShiftRequest): number[] => {
    const days = calendarDays.length > 0 ? calendarDays : [];
    switch (r.scope) {
      case 'all':
        return days.map(d => d.day);
      case 'even':
        return days.filter(d => d.day % 2 === 0).map(d => d.day);
      case 'odd':
        return days.filter(d => d.day % 2 === 1).map(d => d.day);
      case 'weekly_even':
        return days.filter(d => d.dayOfWeek === 0 || d.dayOfWeek === 2 || d.dayOfWeek === 4).map(d => d.day);
      case 'weekly_odd':
        return days.filter(d => d.dayOfWeek === 1 || d.dayOfWeek === 3 || d.dayOfWeek === 5).map(d => d.day);
      case 'custom_days':
        return [...(r.selectedDays || [])];
      case 'range': {
        const startDay = Number(String(r.startDate || '').split('/').pop());
        const endDay = Number(String(r.endDate || '').split('/').pop());
        if (!Number.isFinite(startDay) || !Number.isFinite(endDay)) return [];
        return days.filter(d => d.day >= startDay && d.day <= endDay).map(d => d.day);
      }
      default:
        return [...(r.selectedDays || [])];
    }
  };

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
      // پرسنل فقط «آف» را می‌بیند؛ تعیین سخت/نرم بودن در اختیار سرپرستار است
      const canSeeHardness = role === 'admin' || role === 'headnurse';
      const hardnessLabel = !canSeeHardness
        ? '⚫ آف'
        : r.offHardness === 'hard' ? '🔴 آف سخت' : r.offHardness === 'soft' ? '🟡 آف نرم' : '🔴 آف قطعی';
      return `${hardnessLabel} [${timeLabel}]`;
    } else if (r.requestType === 'leave') {
      return `🟢 مرخصی [${timeLabel}]`;
    } else if (r.requestType === 'pattern') {
      return `🧩 الگوی ${r.patternSteps?.join(' / ') || 'شیفت'} [${timeLabel}]`;
    } else {
      return `🔵 حضور در شیفت ${shiftLabel} [${timeLabel}]`;
    }
  };

  // Custom Holiday Management Form
  const [holidayDayInput, setHolidayDayInput] = useState<number | string>(1);
  const [holidayTitleInput, setHolidayTitleInput] = useState<string>('');

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

  const parseNumberInput = (val: string): any => val === '' ? '' : Number(val);

  const normalizeSettings = (s?: SystemSettings | any): SystemSettings => {
    if (!s) return INITIAL_SETTINGS;
    const dh = s.dutyHours || {};
    const wd = s.demand?.weekday || {};
    const hd = s.demand?.holiday || {};
    return {
      ...s,
      autoCalculateDutyHours: s.autoCalculateDutyHours,
      dutyHours: {
        official: Number(dh.official) || 0,
        contract: Number(dh.contract) || 0,
        conscript: Number(dh.conscript) || 0,
        overtime: Number(dh.overtime) || 0,
      },
      demand: {
        weekday: {
          morningNurse: Number(wd.morningNurse) || 0,
          morningAssistant: Number(wd.morningAssistant) || 0,
          afternoonNurse: Number(wd.afternoonNurse) || 0,
          afternoonAssistant: Number(wd.afternoonAssistant) || 0,
          afternoonLeader: Number(wd.afternoonLeader) || 0,
          nightNurse: Number(wd.nightNurse) || 0,
          nightAssistant: Number(wd.nightAssistant) || 0,
          nightLeader: Number(wd.nightLeader) || 0,
        },
        holiday: {
          morningNurse: Number(hd.morningNurse) || 0,
          morningAssistant: Number(hd.morningAssistant) || 0,
          afternoonNurse: Number(hd.afternoonNurse) || 0,
          afternoonAssistant: Number(hd.afternoonAssistant) || 0,
          afternoonLeader: Number(hd.afternoonLeader) || 0,
          nightNurse: Number(hd.nightNurse) || 0,
          nightAssistant: Number(hd.nightAssistant) || 0,
          nightLeader: Number(hd.nightLeader) || 0,
        },
      },
    };
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
      const cleanUpdatedS = normalizeSettings(updatedS);
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
      if (cleanUpdatedS.autoCalculateDutyHours) {
        const autoHours = calculateAutoDutyHours(
          currentYear,
          currentMonth,
          updatedH,
          activeFd === -1 ? undefined : activeFd
        );
        calculatedMonthlyDutyHours = {
          ...cleanUpdatedS.dutyHours,
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
            cleanUpdatedS,
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
          cleanUpdatedS,
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
        const freshSolved = solveNursingSchedule(currentYear, currentMonth, updatedP, updatedR, cleanUpdatedS, updatedH, activeFd === -1 ? undefined : activeFd, calculatedMonthlyDutyHours);

        if (currentMonthSchedule) {
          const nextAssignments = normalizeScheduleAssignments(currentMonthSchedule.assignments, updatedP);
          for (const p of updatedP) {
            // Use domain guard to check if this personnel should be updated
            const finalizedMonthsForGroup = p.jobGroup === 'nurse' ? finalizedNursesMonths : finalizedAssistantsMonths;
            const shouldUpdate = isPersonnelOptimizationTarget(p.jobGroup, p.jobGroup, p.id, lockedRows)
              && !finalizedMonthsForGroup.includes(monthKey);

            if (shouldUpdate) {
              nextAssignments[p.id] = { ...(freshSolved.assignments[p.id] || {}) };
            }
          }
          const verification = verifyCoverageAndLeaders(
            currentYear,
            currentMonth,
            updatedP,
            nextAssignments,
            cleanUpdatedS,
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

      const cleanMonthlyDutyHours = calculatedMonthlyDutyHours ? {
        official: Number(calculatedMonthlyDutyHours.official) || 0,
        contract: Number(calculatedMonthlyDutyHours.contract) || 0,
        conscript: Number(calculatedMonthlyDutyHours.conscript) || 0,
        overtime: Number(calculatedMonthlyDutyHours.overtime) || 0,
      } : null;

      const nextMonthSchedule: any = {
        ...solved,
        finalizedNurses: isLockedNurses,
        finalizedAssistants: isLockedAssistants,
        requestsLocked: isReqLocked,
        // پس از هر بازتولید، هشدارهایی که دیگر مصداق ندارند از فهرست
        // نادیده‌گرفته‌ها هم پاک می‌شوند تا هشدار رفع‌شده کاملاً از سیستم برود.
        dismissedWarnings: pruneDismissedWarnings(solved.warnings || [], dismissedWarnings),
        lockedRows: lockedRows,
        // «لاگ‌ها و اتفاقات» ماه حفظ می‌شود؛ رکوردهای متنی قدیمی هم در همین
        // مسیر به رویداد ساخت‌یافته مهاجرت می‌کنند و سقف ۳۰تایی اعمال می‌گردد.
        eventLogs: normalizeSystemEventLogs(
          oldDept.schedules?.[monthKey]?.eventLogs ?? schedule?.eventLogs,
          oldDept.schedules?.[monthKey]?.changeLogs ?? schedule?.changeLogs
        ),
      };
      // پس از مهاجرت، نسخهٔ متنی قدیمی حذف می‌شود تا دادهٔ تکراری در فضای
      // ذخیره‌سازی نماند (رویدادهای آن در eventLogs حفظ شده‌اند).
      delete nextMonthSchedule.changeLogs;

      const updatedDept = {
        ...oldDept,
        personnel: updatedP,
        requests: updatedR,
        settings_system: cleanUpdatedS,
        holidays: {
          ...oldDept.holidays,
          [`${currentYear}_${currentMonth}`]: {
            // فقط تفاوت نسبت به تقویم رسمی ذخیره می‌شود تا همگام‌سازی بعدی ماه،
            // تعطیلات رسمی به‌روز را حفظ کند و تغییرات سرپرستار هم پاک نشود.
            days: diffHolidayOverrides(officialHolidays, updatedH),
            monthlyDutyHours: cleanMonthlyDutyHours
          }
        },
        firstDayOfWeek: {
          ...oldDept.firstDayOfWeek,
          [`${currentYear}_${currentMonth}`]: activeFd
        },
        schedules: {
          ...oldDept.schedules,
          [monthKey]: nextMonthSchedule,
        }
      };

      nextDb.deptData[deptId] = updatedDept;
      await saveDbState(nextDb);
    } catch (error) {
      console.error("Error in saveState:", error);
      logEvent({
        category: 'storage',
        severity: 'error',
        title: 'ذخیره‌سازی اطلاعات در فضای ابری ناموفق بود',
        detail: error instanceof Error ? error.message : String(error),
      });
      alert("خطا در ذخیره‌سازی داده‌ها: " + (error instanceof Error ? error.message : String(error)));
      throw error;
    }
  };

  const normalizeScenarioMonthRecord = React.useCallback((rawMonth: any): { nurse?: ScenarioWorkflowGroup; assistant?: ScenarioWorkflowGroup } => {
    if (!rawMonth) return {};
    if (rawMonth.scenarios && Array.isArray(rawMonth.scenarios)) {
      const group: JobGroup = rawMonth.targetJobGroup === 'assistant' ? 'assistant' : 'nurse';
      return {
        [group]: {
          targetJobGroup: group,
          scenarios: rawMonth.scenarios,
          generationLog: rawMonth.generationLog || [],
          comparisonStartedAt: rawMonth.comparisonStartedAt,
          votingOpen: !!rawMonth.votingOpen,
        },
      } as { nurse?: ScenarioWorkflowGroup; assistant?: ScenarioWorkflowGroup };
    }
    const normalizeGroup = (rawGroup: any, fallbackGroup: JobGroup): ScenarioWorkflowGroup | undefined => {
      if (!rawGroup || !Array.isArray(rawGroup.scenarios)) return undefined;
      return {
        targetJobGroup: rawGroup.targetJobGroup || fallbackGroup,
        scenarios: rawGroup.scenarios,
        generationLog: rawGroup.generationLog || [],
        comparisonStartedAt: rawGroup.comparisonStartedAt,
        votingOpen: !!rawGroup.votingOpen,
      };
    };
    return {
      nurse: normalizeGroup(rawMonth.nurse, 'nurse'),
      assistant: normalizeGroup(rawMonth.assistant, 'assistant'),
    };
  }, []);

  const reevaluateScenarioForGroup = React.useCallback((scenario: ScoredSchedule, group: JobGroup, scheduleOverride?: MonthlySchedule): ScoredSchedule => {
    const baseSchedule = scheduleOverride || scenario.schedule;
    const normalizedSchedule: MonthlySchedule = {
      ...baseSchedule,
      warnings: filterWarningsForScenarioGroup(baseSchedule.warnings || [], personnelRef.current, group),
    };
    return evaluateScenarioSchedule({
      id: scenario.id,
      type: scenario.type,
      schedule: normalizedSchedule,
      personnelList: personnelRef.current,
      requests: requestsRef.current,
      settings: normalizeSettings(settingsRef.current),
      year: currentYear,
      month: currentMonth,
      customHolidays: holidaysRef.current,
      firstDayOfWeekIndex: firstDayRef.current === -1 ? undefined : firstDayRef.current,
      monthlyDutyHours: monthlyDutyHoursRef.current,
      targetJobGroup: group,
    });
  }, [currentMonth, currentYear]);

  const buildPairwiseDifferences = React.useCallback((scenariosList: ScoredSchedule[], group: JobGroup) => {
    const totalDays = getJalaliMonthDays(currentYear, currentMonth);
    const lockedIds = new Set(lockedRowsRef.current);
    const groupIds = personnelRef.current
      .filter(person => person.active && person.jobGroup === group && !lockedIds.has(person.id))
      .map(person => person.id);
    return scenariosList.map(scenario => ({
      ...scenario,
      pairwiseDifference: Object.fromEntries(
        scenariosList
          .filter(other => other.id !== scenario.id)
          .map(other => [
            other.scenarioKey,
            calculateScenarioDifferencePercent(scenario.schedule, other.schedule, groupIds, totalDays),
          ])
      ),
    }));
  }, [currentMonth, currentYear]);

  const persistScenarioWorkflow = React.useCallback(async (
    group: JobGroup,
    updater: (current: ScenarioWorkflowGroup | null) => ScenarioWorkflowGroup | null,
    options: { resetVotes?: boolean; clearVotes?: boolean; showBusyOverlay?: boolean } = {}
  ) => {
    const deptId = selectedDepartmentId || 'sepehr';
    const nextDb = getFreshDbCopy();
    if (!nextDb.deptData) nextDb.deptData = {};

    const oldDept = nextDb.deptData[deptId] || {
      personnel: [],
      requests: [],
      settings_system: INITIAL_SETTINGS,
      settings_credentials: { username: 'headnurse', password: '123456' },
      holidays: {},
      firstDayOfWeek: {},
      schedules: {},
    };

    const monthScenarios = normalizeScenarioMonthRecord((oldDept.activeScenarios || {})[monthKey]);
    const nextGroup = updater((monthScenarios[group] || null) as ScenarioWorkflowGroup | null);
    const updatedMonthScenarios = { ...monthScenarios } as any;
    if (nextGroup) updatedMonthScenarios[group] = nextGroup;
    else delete updatedMonthScenarios[group];

    const rawVotesMonth = (oldDept.scenarioVotes || {})[monthKey] as any;
    const monthVotes = rawVotesMonth && (rawVotesMonth.nurse !== undefined || rawVotesMonth.assistant !== undefined)
      ? { ...(rawVotesMonth as any) }
      : { nurse: {}, assistant: {} };

    if (options.clearVotes) {
      delete monthVotes[group];
    } else if (options.resetVotes) {
      monthVotes[group] = {};
    }

    const nextActiveScenarios = { ...(oldDept.activeScenarios || {}) } as any;
    if (Object.keys(updatedMonthScenarios).length > 0) nextActiveScenarios[monthKey] = updatedMonthScenarios;
    else delete nextActiveScenarios[monthKey];

    const nextScenarioVotes = { ...(oldDept.scenarioVotes || {}) } as any;
    if (monthVotes.nurse !== undefined || monthVotes.assistant !== undefined) {
      if ((monthVotes.nurse && Object.keys(monthVotes.nurse).length > 0) || (monthVotes.assistant && Object.keys(monthVotes.assistant).length > 0) || !options.clearVotes) {
        nextScenarioVotes[monthKey] = monthVotes;
      } else {
        delete nextScenarioVotes[monthKey];
      }
    }
    if (options.clearVotes && !(monthVotes.nurse && Object.keys(monthVotes.nurse).length > 0) && !(monthVotes.assistant && Object.keys(monthVotes.assistant).length > 0)) {
      delete nextScenarioVotes[monthKey];
    }

    nextDb.deptData[deptId] = {
      ...oldDept,
      activeScenarios: nextActiveScenarios,
      scenarioVotes: nextScenarioVotes,
    };

    await saveDbState(nextDb, { showBusyOverlay: options.showBusyOverlay ?? false });
  }, [monthKey, normalizeScenarioMonthRecord, selectedDepartmentId]);

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
  // Migrated to Facade pattern (Phase 3) — delegates to runOptimizerFacade
  const handleRunOptimizer = async (jobGroup: JobGroup) => {
    const deptId = selectedDepartmentId || 'sepehr';

    // با اجرای بهینه‌ساز، برنامه از نو تولید می‌شود. سلول‌های محافظت‌شده قبلی
    // دیگر معتبر نیستند چون برنامه کاملاً بازنویسی می‌شود.
    protectedCellsRef.current.clear();

    // Never start with the initial/default state while the department or calendar
    // is still being loaded. Otherwise the delayed optimizer could capture old
    // staffing numbers and persist a schedule that ignores the department rules.
    if (
      isLoadingDb ||
      isSavingDb ||
      !dbChecked ||
      !isPersonnelLoaded ||
      !isRequestsLoaded ||
      storageLoadCountRef.current > 0 ||
      officialCalendarState.status === 'loading'
    ) {
      alert('اطلاعات بخش و قوانین تعداد نیرو هنوز در حال همگام‌سازی است؛ چند لحظه بعد دوباره تلاش کنید.');
      return;
    }

    if (storageWriteBlockedRef.current) {
      alert('ارتباط ذخیره‌سازی نیاز به همگام‌سازی مجدد دارد؛ لطفاً صفحه را تازه‌سازی کنید.');
      return;
    }

    // The committed department settings are the source of truth. Unsaved edits in
    // the settings form must not silently change staffing rules during regeneration.
    const persistedSettings = optimisticDbRef.current?.deptData?.[deptId]?.settings_system;
    const optimizerSettings = normalizeSettings(persistedSettings || settingsRef.current);
    const optimizerPersonnel = personnelRef.current;
    const optimizerRequests = requestsRef.current;
    const optimizerHolidays = holidaysRef.current;
    const optimizerFirstDay = firstDayRef.current;
    const optimizerDutyHours = monthlyDutyHoursRef.current;

    // -------------------------------------------------------------
    // Scenario Generation Phase (New Feature)
    // -------------------------------------------------------------
    setSolvingTarget(jobGroup);

    // نوار پیشرفت ۰ تا ۱۰۰ درصد از همین‌جا و دقیقاً هم‌گام با مراحل واقعی موتور شروع می‌شود.
    const progress = solverProgressRef.current;
    progress.start('prepare');

    // Allow UI to render loading state
    await new Promise(resolve => setTimeout(resolve, 100));

    const groupTitle = jobGroup === 'nurse' ? 'پرستاران' : 'کمک‌بهیاران';
    const monthLabel = `${JALALI_MONTH_NAMES[currentMonth - 1]} ${currentYear}`;

    try {
      const currentAssignmentsForMerge = schedule?.assignments || optimisticDbRef.current?.deptData?.[deptId]?.schedules?.[`${currentYear}_${currentMonth}`]?.assignments || null;
      const scenarioPhaseIds = ['scenario-a', 'scenario-b', 'scenario-c'] as const;

      const { top3, generationLog, durationMs, targetPersonnelCount } = await generateAndScoreScenariosWithProgress({
        year: currentYear,
        month: currentMonth,
        personnelList: optimizerPersonnel,
        requests: optimizerRequests,
        settings: optimizerSettings,
        customHolidays: optimizerHolidays,
        firstDayOfWeekIndex: optimizerFirstDay === -1 ? undefined : optimizerFirstDay,
        monthlyDutyHours: optimizerDutyHours,
        targetJobGroup: jobGroup,
        currentAssignments: currentAssignmentsForMerge as any,
        lockedRows: lockedRowsRef.current,
        // هر مرحلهٔ واقعی موتور، مرحلهٔ متناظر نوار پیشرفت را فعال می‌کند تا درصد
        // نمایش‌داده‌شده هرگز از پردازش واقعی جلو یا عقب نیفتد.
        // beginPhase خودش در برابر فراخوانی تکراری برای همان مرحله ایمن است
        // (تایمر مرحله ریست نمی‌شود)، پس بدون اتکا به state کهنه صدا زده می‌شود.
        onProgress: event => {
          if (event.stage === 'prepare') {
            progress.reportPhaseFraction(event.fraction);
            return;
          }
          if (event.stage === 'scenario' && event.scenarioIndex) {
            const phaseId = scenarioPhaseIds[event.scenarioIndex - 1];
            if (phaseId) progress.beginPhase(phaseId);
            progress.reportPhaseFraction(event.fraction);
            return;
          }
          if (event.stage === 'scoring') {
            progress.beginPhase('scoring');
            progress.reportPhaseFraction(event.fraction);
          }
        },
        // فرصت رندر به مرورگر تا انیمیشن لودینگ حین محاسبات سنگین یخ نزند.
        yieldToUi: () => new Promise<void>(resolve => setTimeout(resolve, 0)),
      });

      if (top3.length === 0) {
        const joined = generationLog.length > 0 ? `\n\nجزئیات: \n- ${generationLog.join('\n- ')}` : '';
        alert(`هیچ سناریوی معتبر و به‌اندازه کافی متفاوتی برای این گروه تولید نشد. سناریو فقط وقتی کنار گذاشته می‌شود که تعداد هشدارهای سخت آن به ۵ مورد یا بیشتر برسد.${joined}`);
      }

      progress.beginPhase('persist');

      const scenariosWithDiff = buildPairwiseDifferences(top3, jobGroup);
      await persistScenarioWorkflow(jobGroup, () => ({
        targetJobGroup: jobGroup,
        scenarios: scenariosWithDiff,
        generationLog,
        comparisonStartedAt: undefined,
        votingOpen: false,
      }), { resetVotes: true });

      // گزارش کامل این اجرای solver در «لاگ‌ها و اتفاقات» ثبت می‌شود:
      // چند برنامه تولید شد، چقدر طول کشید، هشدارها و دلیل کنار گذاشته شدن‌ها.
      await recordEvents(
        buildSolverRunEvents({
          jobGroup,
          year: currentYear,
          month: currentMonth,
          monthLabel,
          scenarios: scenariosWithDiff.map(scenario => ({
            scenarioKey: scenario.scenarioKey,
            shortTitle: scenario.shortTitle,
            totalScore: scenario.totalScore,
            relevantWarningCount: scenario.relevantWarningCount,
            relevantHardWarningCount: scenario.relevantHardWarningCount,
            pairwiseDifference: scenario.pairwiseDifference,
          })),
          generationLog,
          durationMs,
          targetPersonnelCount,
          lockedRowCount: lockedRowsRef.current.length,
          actor: currentActorRef.current,
        }).map(event => ({
          category: event.category,
          severity: event.severity,
          title: event.title,
          detail: event.detail,
          actor: event.actor,
        }))
      );

      progress.complete();
      setSelectedScenarioIndexForGroup(jobGroup, scenariosWithDiff.length > 0 ? 0 : -1);
      setSolvingTarget(null);
      return;
    } catch (err) {
      console.error(err);
      progress.reset();
      logEvent({
        category: 'solver',
        severity: 'error',
        title: `پردازش موتور هوشمند برای ${groupTitle} با خطا متوقف شد`,
        detail: `ماه ${monthLabel} — ${err instanceof Error ? err.message : String(err)}`,
      });
      alert('خطا در تولید سناریوها');
      setSolvingTarget(null);
      return;
    }
  };

  const handleApplyScenario = async (selectedScenario: ScoredSchedule, forcedGroup?: JobGroup) => {
    const jobGroup = forcedGroup || selectedScenario.targetJobGroup || null;
    if (!jobGroup) return;

    const deptId = selectedDepartmentId || 'sepehr';
    const persistedSettings = optimisticDbRef.current?.deptData?.[deptId]?.settings_system;
    const optimizerSettings = normalizeSettings(persistedSettings || settingsRef.current);
    const optimizerPersonnel = personnelRef.current;
    const optimizerRequests = requestsRef.current;
    const optimizerHolidays = holidaysRef.current;
    const optimizerFirstDay = firstDayRef.current;
    const optimizerDutyHours = monthlyDutyHoursRef.current;

    const persistenceAdapter: SchedulePersistence = {
      saveSchedule: async (newSchedule: any) => {
        const nextDb = getFreshDbCopy();
        if (!nextDb.deptData) nextDb.deptData = {};

        const oldDept = nextDb.deptData[deptId] || {
          personnel: [],
          requests: [],
          settings_system: INITIAL_SETTINGS,
          settings_credentials: { username: 'headnurse', password: '123456' },
          holidays: {},
          firstDayOfWeek: {},
          schedules: {},
        };

        const monthKeyLocal = `${currentYear}_${currentMonth}`;
        if (jobGroup === 'nurse') {
          newSchedule.finalizedNurses = true;
        } else {
          newSchedule.finalizedAssistants = true;
        }

        const existingActive = normalizeScenarioMonthRecord((oldDept.activeScenarios || {})[monthKeyLocal]);
        const updatedMonth: any = { ...existingActive };
        delete updatedMonth[jobGroup];

        const newActiveScenarios = { ...(oldDept.activeScenarios || {}) } as any;
        if (Object.keys(updatedMonth).length === 0) delete newActiveScenarios[monthKeyLocal];
        else newActiveScenarios[monthKeyLocal] = updatedMonth;

        const existingVotes = (oldDept.scenarioVotes || {})[monthKeyLocal] as any;
        const updatedVotesMonth = existingVotes && (existingVotes.nurse !== undefined || existingVotes.assistant !== undefined)
          ? { ...(existingVotes as any) }
          : { nurse: {}, assistant: {} };
        delete updatedVotesMonth[jobGroup];

        const newScenarioVotes = { ...(oldDept.scenarioVotes || {}) } as any;
        if ((updatedVotesMonth.nurse && Object.keys(updatedVotesMonth.nurse).length > 0) || (updatedVotesMonth.assistant && Object.keys(updatedVotesMonth.assistant).length > 0)) {
          newScenarioVotes[monthKeyLocal] = updatedVotesMonth;
        } else {
          delete newScenarioVotes[monthKeyLocal];
        }

        nextDb.deptData[deptId] = {
          ...oldDept,
          schedules: {
            ...oldDept.schedules,
            [monthKeyLocal]: newSchedule,
          },
          activeScenarios: newActiveScenarios,
          scenarioVotes: newScenarioVotes,
        };

        if (!nextDb.lockState) nextDb.lockState = { finalizedNursesMonths: [], finalizedAssistantsMonths: [], requestsLockedMonths: [] };
        if (jobGroup === 'nurse') {
          if (!nextDb.lockState.finalizedNursesMonths) nextDb.lockState.finalizedNursesMonths = [];
          if (!nextDb.lockState.finalizedNursesMonths.includes(`${currentYear}_${currentMonth}`)) {
            nextDb.lockState.finalizedNursesMonths.push(`${currentYear}_${currentMonth}`);
          }
        } else {
          if (!nextDb.lockState.finalizedAssistantsMonths) nextDb.lockState.finalizedAssistantsMonths = [];
          if (!nextDb.lockState.finalizedAssistantsMonths.includes(`${currentYear}_${currentMonth}`)) {
            nextDb.lockState.finalizedAssistantsMonths.push(`${currentYear}_${currentMonth}`);
          }
        }

        await saveDbState(nextDb);
      },
    };

    const uiAdapter: ScheduleUIFeedback = {
      setSolvingTarget: (target) => setSolvingTarget(target as JobGroup | null),
      showConfirmation: (message) => confirm(message),
      showError: (message) => console.error('Optimizer error:', message),
    };

    const mockSolver = (y: any, m: any, p: any, req: any, set: any, h: any, fd: any, mdh: any) => {
      const baseResult = solveWithPriority(y, m, p, req, set, h, fd, mdh);
      return { assignments: selectedScenario.schedule.assignments, warnings: baseResult.warnings };
    };

    const result = await runOptimizerFacade(
      {
        jobGroup,
        year: currentYear,
        month: currentMonth,
        personnel: optimizerPersonnel,
        requests: optimizerRequests,
        settings: optimizerSettings,
        holidays: optimizerHolidays,
        firstDayOfWeek: optimizerFirstDay,
        monthlyDutyHours: optimizerDutyHours,
        currentSchedule: schedule,
        lockState: {
          finalizedNursesMonths,
          finalizedAssistantsMonths,
          lockedRows,
        },
        dismissedWarnings,
      },
      mockSolver,
      verifyCoverageAndLeaders,
      persistenceAdapter,
      uiAdapter,
      deptId,
      { delayMs: 500 }
    );

    if (!result.success && result.error) {
      logEvent({
        category: 'schedule',
        severity: 'error',
        title: 'اعمال برنامه انتخاب‌شده ناموفق بود',
        detail: `${jobGroup === 'nurse' ? 'پرستاران' : 'کمک‌بهیاران'} — ${result.error}`,
      });
      alert('خطا در اعمال برنامه: ' + result.error);
      return;
    }

    logEvent({
      category: 'schedule',
      severity: 'success',
      title: `برنامه نهایی ${jobGroup === 'nurse' ? 'پرستاران' : 'کمک‌بهیاران'} اعمال و ثبت شد`,
      detail: `${selectedScenario.title} — امتیاز ${selectedScenario.totalScore.toFixed(1)} — ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} ${currentYear} — ${result.personnelUpdated} نفر به‌روزرسانی شدند`,
    });

    setSelectedScenarioIndexForGroup(jobGroup, -1);
  };

  const handleVoteScenario = async (scenarioId: number, rating: number, forcedGroup?: JobGroup) => {
    if (!authenticatedUser || !authenticatedUser.id) return;
    const userId = role === 'personnel' && selectedPersonnelUser ? selectedPersonnelUser.id : (authenticatedUser.id || 'headnurse');

    const deptId = selectedDepartmentId || 'sepehr';
    const nextDb = getFreshDbCopy();
    if (!nextDb.deptData) nextDb.deptData = {};
    const oldDept = nextDb.deptData[deptId];
    if (!oldDept) return;

    const monthKeyLocal = `${currentYear}_${currentMonth}`;
    const scenariosForMonth = normalizeScenarioMonthRecord((oldDept.activeScenarios || {})[monthKeyLocal]);
    const targetGroup = forcedGroup ||
      (scenariosForMonth.nurse?.scenarios.some(scenario => scenario.id === scenarioId) ? 'nurse' : null) ||
      (scenariosForMonth.assistant?.scenarios.some(scenario => scenario.id === scenarioId) ? 'assistant' : null) ||
      (role === 'personnel' && selectedPersonnelUser ? selectedPersonnelUser.jobGroup : null);

    if (!targetGroup) return;

    const existingVotes = (oldDept.scenarioVotes || {})[monthKeyLocal] as any;
    const votesMonth = existingVotes && (existingVotes.nurse !== undefined || existingVotes.assistant !== undefined)
      ? { ...(existingVotes as any) }
      : { nurse: {}, assistant: {} };

    const groupVotes = votesMonth[targetGroup] || {};
    votesMonth[targetGroup] = {
      ...groupVotes,
      [scenarioId]: {
        ...(groupVotes[scenarioId] || {}),
        [userId]: rating,
      },
    };

    nextDb.deptData[deptId] = {
      ...oldDept,
      scenarioVotes: {
        ...(oldDept.scenarioVotes || {}),
        [monthKeyLocal]: votesMonth,
      },
    };

    await saveDbState(nextDb, { showBusyOverlay: false });
  };

  const handleStartScenarioComparison = async (jobGroup: JobGroup) => {
    const workflow = getWorkflowForGroup(jobGroup);
    if (!workflow || workflow.scenarios.length === 0) return;
    if (workflow.scenarios.some(scenario => scenario.relevantWarningCount > 0)) {
      alert('تا زمانی که هشدارهای هر سه سناریو به صفر نرسند، مقایسه و امتیازدهی شروع نمی‌شود.');
      return;
    }

    const rescored = buildPairwiseDifferences(
      workflow.scenarios.map(scenario => reevaluateScenarioForGroup(scenario, jobGroup)),
      jobGroup
    );

    await persistScenarioWorkflow(jobGroup, current => ({
      targetJobGroup: jobGroup,
      scenarios: rescored,
      generationLog: current?.generationLog || [],
      comparisonStartedAt: new Date().toISOString(),
      votingOpen: false,
    }), { resetVotes: false });
  };

  const handleToggleScenarioVoting = async (jobGroup: JobGroup) => {
    const workflow = getWorkflowForGroup(jobGroup);
    if (!workflow || !workflow.comparisonStartedAt) return;

    await persistScenarioWorkflow(jobGroup, current => {
      if (!current) return null;
      return {
        ...current,
        votingOpen: !current.votingOpen,
      };
    }, { showBusyOverlay: false });
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

      const updatedDept = {
        ...oldDept,
        schedules: {
          ...oldDept.schedules,
          [key]: {
            ...existingSched,
            ...(isNurse ? { finalizedNurses: !isLocked } : { finalizedAssistants: !isLocked }),
          }
        }
      };

      nextDb.deptData[deptId] = updatedDept;
      // رویداد در همان تراکنش ذخیره می‌شود تا لاگ و تغییر وضعیت هرگز از هم جدا نیفتند.
      const withLog = attachEventLogsToDb(nextDb, [createSystemEventLog({
        category: 'lock',
        severity: isLocked ? 'info' : 'success',
        title: `برنامه ${groupTitle} ${!isLocked ? 'قفل و ثبت نهایی شد' : 'از حالت قفل خارج شد'}`,
        detail: `ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} ${currentYear}`,
        actor: currentActorRef.current,
      })], key);
      await saveDbState(withLog);
      alert(`لیست شیفت‌های ${groupTitle} ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} با موفقیت ${!isLocked ? 'قفل گردید' : 'باز شد'}.`);
    } catch (error) {
      console.error("Error toggling lock:", error);
      logEvent({
        category: 'lock',
        severity: 'error',
        title: 'تغییر وضعیت قفل برنامه با خطا مواجه شد',
        detail: error instanceof Error ? error.message : String(error),
      });
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

      const updatedDept = {
        ...oldDept,
        schedules: {
          ...oldDept.schedules,
          [key]: {
            ...(existingSched || { year: currentYear, month: currentMonth, assignments: {}, shiftLeaders: {}, warnings: [] }),
            requestsLocked: !isLocked,
          }
        }
      };

      nextDb.deptData[deptId] = updatedDept;
      const withLog = attachEventLogsToDb(nextDb, [createSystemEventLog({
        category: 'requests',
        severity: 'info',
        title: `مهلت ثبت درخواست‌ها ${!isLocked ? 'بسته شد' : 'دوباره باز شد'}`,
        detail: `ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} ${currentYear}`,
        actor: currentActorRef.current,
      })], key);
      await saveDbState(withLog);
      alert(`مهلت ثبت درخواست‌های ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} با موفقیت ${!isLocked ? 'بسته شد' : 'تمدید شد'}.`);
    } catch (error) {
      console.error("Error toggling requests lock:", error);
      logEvent({
        category: 'requests',
        severity: 'error',
        title: 'تغییر وضعیت مهلت درخواست‌ها با خطا مواجه شد',
        detail: error instanceof Error ? error.message : String(error),
      });
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
      // نادیده‌گرفتن یک هشدار هم یک «اتفاق» است و باید در کارنامه ثبت شود.
      const withLog = attachEventLogsToDb(nextDb, [createSystemEventLog({
        category: 'alert',
        severity: 'warning',
        title: 'یک هشدار توسط سرپرستار نادیده گرفته شد',
        detail: warnText,
        actor: currentActorRef.current,
      })], key);
      await saveDbState(withLog, { showBusyOverlay: false });
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
    setPendingPersonnelId(null);
    setIsLoadingPersonnelNationalId(false);
    personnelForm.openAddModal();
  };

  const handleOpenEditPersonnel = async (p: Personnel) => {
    // openEditModal populates every field before making the modal visible.
    // Do not call openAddModal here: it resets the form and turns an edit into
    // an empty "new personnel" form.
    setPendingPersonnelId(null);
    personnelForm.openEditModal(p);
    setIsLoadingPersonnelNationalId(true);
    try {
      const response = await fetch(`/api/users/personnel/${encodeURIComponent(p.id)}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'دریافت کد ملی پرسنل انجام نشد.');
      }
      // پرسنل قدیمی ممکن است هنوز حساب ورود نداشته باشد؛ در این حالت فیلد کد ملی خالی
      // می‌ماند و با ثبت آن، حساب ورود همان‌جا ساخته می‌شود.
      setFormNationalId(result.nationalId || '');
    } catch (error) {
      console.error('Error loading personnel national ID:', error);
      alert('کد ملی این پرسنل دریافت نشد: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsLoadingPersonnelNationalId(false);
    }
  };

  const handleSavePersonnel = async (e: React.FormEvent) => {
    e.preventDefault();
    // کد پرسنلی اختیاری است؛ فقط نام، نام خانوادگی و (برای پرسنل جدید) کد ملی الزامی هستند.
    if (!formFirstName.trim() || !formLastName.trim() || !formNationalId.trim()) {
      alert('لطفاً نام، نام خانوادگی و کد ملی فرد را وارد کنید. کد پرسنلی اختیاری است.');
      return;
    }
    if (isLoadingPersonnelNationalId) {
      alert('لطفاً تا دریافت کد ملی فعلی پرسنل صبر کنید.');
      return;
    }

    try {
      let updatedList: Personnel[];
      if (editingPersonnel) {
        const accountResponse = await fetch(`/api/users/personnel/${encodeURIComponent(editingPersonnel.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nationalId: formNationalId,
            firstName: formFirstName.trim(),
            lastName: formLastName.trim(),
            departmentId: selectedDepartmentId,
          }),
        });
        const accountResult = await accountResponse.json();
        if (!accountResponse.ok || !accountResult.success) {
          throw new Error(accountResult.error || 'ویرایش کد ملی پرسنل انجام نشد.');
        }

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
          canBeShiftLeader: formJobGroup === 'assistant' ? false : formCanBeShiftLeader,
          workRoutine: formWorkRoutine || undefined
        };
        updatedList = personnel.map(p => p.id === editingPersonnel.id ? pData : p);
      } else {
        const newId = pendingPersonnelId || `p_${crypto.randomUUID().replaceAll('-', '')}`;
        setPendingPersonnelId(newId);
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
          workRoutine: formWorkRoutine || undefined,
          orderIndex: personnel.length
        };
        const accountResponse = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nationalId: formNationalId,
            firstName: pData.firstName,
            lastName: pData.lastName,
            role: 'PERSONNEL',
            departmentId: selectedDepartmentId,
            personnelId: newId,
          }),
        });
        const accountResult = await accountResponse.json();
        if (!accountResponse.ok || !accountResult.success) {
          throw new Error(accountResult.error || 'ساخت حساب ورود پرسنل انجام نشد.');
        }
        updatedList = [...personnel, pData];
      }

      await saveState(updatedList, requests, settings, customHolidays, { mode: 'full_resolve' });
      logEvent({
        category: 'personnel',
        severity: 'success',
        title: editingPersonnel
          ? `اطلاعات پرسنل ${formFirstName} ${formLastName} ویرایش شد`
          : `پرسنل جدید ${formFirstName} ${formLastName} به بخش اضافه شد`,
        detail: `گروه شغلی: ${formJobGroup === 'nurse' ? 'پرستار' : 'کمک‌بهیار'} — نوع استخدام: ${formEmploymentType} — برنامه ماه بازتولید شد`,
      });
      setPendingPersonnelId(null);
      setFormNationalId('');
      personnelForm.closeModal();
    } catch (error) {
      console.error("Error saving personnel:", error);
      logEvent({
        category: 'personnel',
        severity: 'error',
        title: 'ثبت اطلاعات پرسنل ناموفق بود',
        detail: error instanceof Error ? error.message : String(error),
      });
      alert("خطا در ثبت اطلاعات پرسنل: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const handleDeletePersonnel = async (id: string) => {
    const removedPerson = personnel.find(p => p.id === id);
    const removedRequestCount = requests.filter(r => r.personnelId === id).length;
    try {
      const updatedP = personnel.filter(p => p.id !== id);
      const updatedR = requests.filter(r => r.personnelId !== id);
      await saveState(updatedP, updatedR, settings, customHolidays, { mode: 'full_resolve' });
      const accountResponse = await fetch(`/api/users/personnel/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const accountResult = await accountResponse.json();
      if (!accountResponse.ok || !accountResult.success) {
        throw new Error(accountResult.error || 'غیرفعال‌سازی حساب ورود پرسنل انجام نشد.');
      }
      logEvent({
        category: 'personnel',
        severity: 'warning',
        title: `پرسنل ${removedPerson ? `${removedPerson.firstName} ${removedPerson.lastName}` : id} از بخش حذف شد`,
        detail: `${removedRequestCount} درخواست مرتبط نیز حذف و برنامه ماه بازتولید شد`,
      });
    } catch (error) {
      console.error("Error deleting personnel:", error);
      logEvent({
        category: 'personnel',
        severity: 'error',
        title: 'حذف پرسنل ناموفق بود',
        detail: error instanceof Error ? error.message : String(error),
      });
      alert("خطا در حذف پرسنل: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  // --- Requests UI Helpers ---
  const handleQuickSubmitRequest = async () => {
    if (role === 'personnel' && requestsLockedMonths.includes(`${currentYear}_${currentMonth}`)) {
      alert('مهلت ثبت درخواست برای این ماه به پایان رسیده است.');
      return;
    }

    const targetPersonnelId = role === 'personnel' && selectedPersonnelUser ? selectedPersonnelUser.id : quickPersonnelId;
    if (!targetPersonnelId) {
      alert('لطفاً ابتدا پرسنل متقاضی را انتخاب کنید.');
      return;
    }
    if (!quickSelectedTemplateId) {
      alert('لطفاً یکی از درخواست‌های پرکاربرد را انتخاب کنید.');
      return;
    }

    const now = new Date().toISOString();
    const baseRequest = {
      personnelId: targetPersonnelId,
      isEssential: false,
      createdAt: now,
      updatedAt: now,
    };

    let newRequests: ShiftRequest[] = [];
    if (quickSelectedTemplateId === 'off' || quickSelectedTemplateId === 'leave') {
      if (quickSelectedDays.length === 0) {
        alert('لطفاً از تقویم، روزهای مورد نظر را انتخاب کنید.');
        return;
      }
      newRequests = [{
        ...baseRequest,
        id: `quick_req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        requestType: quickSelectedTemplateId === 'off' ? 'OFF' : 'leave',
        preferredShift: quickSelectedTemplateId === 'off' ? 'OFF' : 'L',
        // نوع آف (سخت/نرم) را فقط سرپرستار تعیین می‌کند؛ آف ثبت‌شده توسط پرسنل بدون نوع می‌ماند
        offHardness: quickSelectedTemplateId === 'off' ? (role === 'personnel' ? undefined : 'hard') : undefined,
        scope: 'custom_days',
        selectedDays: [...quickSelectedDays].sort((a, b) => a - b),
      }];
    } else {
      const preferredShift: ShiftRequest['preferredShift'] = quickSelectedTemplateId === 'en'
        ? 'EN'
        : quickSelectedTemplateId === 'men'
          ? 'MEN'
          : 'ME';
      newRequests = [{
        ...baseRequest,
        id: `quick_req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        requestType: 'shift',
        preferredShift,
        scope: quickSelectedScope,
      }];

      // لانگ‌آف یعنی حضور ME یک‌روزدرمیان؛ برای روزهای مقابل، آف نرم ثبت می‌شود
      // تا موتور زمان‌بندی ترجیح استراحت بین دو لانگ را بداند ولی در بن‌بست نشکند.
      if (quickSelectedTemplateId === 'long_off') {
        newRequests.push({
          ...baseRequest,
          id: `quick_req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          requestType: 'OFF',
          preferredShift: 'OFF',
          offHardness: 'soft',
          scope: QUICK_COMPLEMENT_SCOPE[quickSelectedScope],
        });
      }
    }

    try {
      setIsQuickRequestSubmitting(true);
      const updatedRequests = [...requests, ...newRequests];
      await saveState(personnel, updatedRequests, settings, customHolidays, {
        mode: 'refresh_personnel',
        personnelIds: [targetPersonnelId],
      });
      const requesterPerson = personnel.find(item => item.id === targetPersonnelId);
      const selectedTemplate = QUICK_REQUEST_TEMPLATES.find(item => item.id === quickSelectedTemplateId);
      logEvent({
        category: 'requests',
        severity: 'success',
        title: `${newRequests.length} درخواست فوری ثبت شد`,
        detail: `الگو: ${selectedTemplate?.title || quickSelectedTemplateId} — پرسنل: ${requesterPerson ? `${requesterPerson.firstName} ${requesterPerson.lastName}` : targetPersonnelId} — ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} ${currentYear}`,
      });
      setQuickSelectedDays([]);
      alert('درخواست فوری با موفقیت ثبت شد.');
    } catch (error) {
      console.error('Error submitting quick request:', error);
      logEvent({
        category: 'requests',
        severity: 'error',
        title: 'ثبت درخواست فوری ناموفق بود',
        detail: error instanceof Error ? error.message : String(error),
      });
      alert('خطا در ثبت درخواست فوری: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsQuickRequestSubmitting(false);
    }
  };

  const buildRequestChatScheduleHistory = (personnelId: string) => {
    const deptId = selectedDepartmentId || 'sepehr';
    const dept = optimisticDbRef.current?.deptData?.[deptId] || fullDbState?.deptData?.[deptId];
    const schedules = (dept as any)?.schedules || {};
    return Object.entries(schedules)
      .filter(([key]) => key !== `${currentYear}_${currentMonth}`)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-4)
      .map(([key, value]) => ({
        monthKey: key,
        assignments: (value as MonthlySchedule)?.assignments?.[personnelId] || {},
      }));
  };

  // منطق اصلی ارسال پیام به دستیار هوشمند؛ دکمه تلاش مجدد آن را بدون افزودن حباب جدید کاربر صدا می‌زند
  const sendChatMessage = async (text: string, appendUserMessage: boolean = true) => {
    if (role === 'personnel' && requestsLockedMonths.includes(`${currentYear}_${currentMonth}`)) {
      alert('مهلت ثبت درخواست برای این ماه به پایان رسیده است.');
      return;
    }

    const targetPersonnel = requestChatPersonnel;
    if (!targetPersonnel) {
      alert('لطفاً ابتدا پرسنل متقاضی را انتخاب کنید.');
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    let nextMessages = requestChatMessages;
    if (appendUserMessage) {
      const userMessage: RequestChatMessage = {
        id: `chat_user_${Date.now()}`,
        role: 'user',
        content: trimmed,
        timestamp: new Date().toISOString(),
      };
      nextMessages = [...requestChatMessages, userMessage];
      setRequestChatMessages(nextMessages);
    }
    setChatFailedText(null);
    setChatProposedRequests([]);
    setIsRequestChatProcessing(true);

    try {
      const response = await postChatRequestWithRetry({
          // فقط چند پیام آخر ارسال می‌شود تا حجم درخواست و زمان پاسخ مدل کم بماند
          messages: nextMessages.slice(-8).map(message => ({ role: message.role, content: message.content })),
          year: currentYear,
          month: currentMonth,
          personnel: {
            firstName: targetPersonnel.firstName,
            lastName: targetPersonnel.lastName,
            jobGroup: targetPersonnel.jobGroup,
            workRoutine: targetPersonnel.workRoutine,
          },
          calendarDays: calendarDays.map(day => ({
            day: day.day,
            dayOfWeek: day.dayOfWeek,
            weekdayName: WEEKDAYS[day.dayOfWeek],
            isHoliday: day.isHoliday,
            holidayTitle: day.holidayTitle || calendarOccasions[day.day]?.join('، '),
          })),
          existingRequests: requests
            .filter(request => request.personnelId === targetPersonnel.id)
            .map(request => ({
              requestType: request.requestType,
              preferredShift: request.preferredShift,
              patternSteps: request.patternSteps,
              scope: request.scope,
              selectedDays: request.selectedDays,
              startDate: request.startDate,
              endDate: request.endDate,
              isEssential: request.isEssential,
              offHardness: request.offHardness,
            })),
          scheduleHistory: buildRequestChatScheduleHistory(targetPersonnel.id),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'پردازش گفت‌وگو انجام نشد.');

      const assistantMessage: RequestChatMessage = {
        id: `chat_assistant_${Date.now()}`,
        role: 'assistant',
        content: data.reply || 'پیامت را گرفتم. اگر منظورت همین است، تأیید کن؛ اگر نه اصلاحش کن.',
        timestamp: new Date().toISOString(),
      };
      setRequestChatMessages(current => [...current, assistantMessage]);

      const extracted = Array.isArray(data.requests) ? data.requests : [];
      if (data.status === 'ready' && extracted.length > 0) {
        const now = new Date().toISOString();
        const mapped: ChatProposedShiftRequest[] = extracted.map((item: any, index: number) => ({
          id: `chat_draft_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
          personnelId: targetPersonnel.id,
          requestType: item.requestType,
          preferredShift: item.requestType === 'leave'
            ? 'L'
            : item.requestType === 'OFF'
              ? 'OFF'
              : item.preferredShift,
          patternSteps: item.patternSteps,
          isEssential: !!item.isEssential,
          offHardness: item.requestType === 'OFF' ? (role === 'personnel' ? undefined : (item.offHardness || 'hard')) : undefined,
          scope: item.scope || 'custom_days',
          startDate: item.startDate,
          endDate: item.endDate,
          selectedDays: item.selectedDays,
          description: item.description,
          createdAt: now,
          updatedAt: now,
        }));
        setChatProposedRequests(mapped);
      }
    } catch (error) {
      console.error('Error processing request chat:', error);
      setChatFailedText(trimmed);
      setRequestChatMessages(current => [
        ...current,
        {
          id: `chat_error_${Date.now()}`,
          role: 'assistant',
          content: `ارتباط با دستیار هوشمند به مشکل خورد: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsRequestChatProcessing(false);
    }
  };

  const handleRequestChatSubmit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const text = requestChatInput.trim();
    if (!text) return;
    setRequestChatInput('');
    await sendChatMessage(text, true);
  };

  // تلاش مجدد برای آخرین پیامی که پاسخی دریافت نکرد (بدون ثبت دوباره حباب کاربر)
  const handleRetryChatMessage = async () => {
    if (!chatFailedText || isRequestChatProcessing) return;
    await sendChatMessage(chatFailedText, false);
  };

  // ====== Handwritten image: انتخاب فایل، پیش‌نمایش، پاک‌سازی حافظه ======
  // هیچ فایلی روی سرور ذخیره نمی‌شود؛ تصویر فقط در حافظهٔ RAM مرورگر (Blob → ObjectURL)
  // و به‌صورت DataURL در payload درخواست HTTP نگه داشته می‌شود. پس از ارسال موفق
  // یا هنگام تعویض پرسنل، همه ارجاع‌ها آزاد می‌شوند تا حافظه آزاد شود.
  const MAX_HANDWRITTEN_IMAGE_BYTES = 8 * 1024 * 1024; // ۸ مگابایت
  const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

  // فقط stateهای مربوط به پیش‌نمایش کنار input را پاک می‌کند.
  // URL ذخیره‌شده در پیام چت (imageUrl) عمداً آزاد نمی‌شود تا thumbnail در
  // حباب چت همچنان نمایش داده شود؛ آزادسازی نهایی در unmount یا تعویض پرسنل است.
  const clearHandwrittenImage = React.useCallback(() => {
    setHandwrittenImageFile(null);
    setHandwrittenImagePreview(null);
    setHandwrittenParseError(null);
    if (handwrittenFileInputRef.current) {
      handwrittenFileInputRef.current.value = '';
    }
  }, []);

  const handleHandwrittenFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      clearHandwrittenImage();
      return;
    }
    const mimeType = (file.type || '').toLowerCase();
    if (!ACCEPTED_IMAGE_TYPES.includes(mimeType)) {
      setHandwrittenParseError('فرمت تصویر پشتیبانی نمی‌شود. فقط JPG، PNG، WebP و HEIC مجاز هستند.');
      if (handwrittenFileInputRef.current) handwrittenFileInputRef.current.value = '';
      return;
    }
    if (file.size > MAX_HANDWRITTEN_IMAGE_BYTES) {
      setHandwrittenParseError('حجم تصویر بیش از ۸ مگابایت است؛ لطفاً تصویر کوچک‌تری انتخاب کنید.');
      if (handwrittenFileInputRef.current) handwrittenFileInputRef.current.value = '';
      return;
    }
    setHandwrittenParseError(null);
    if (handwrittenImagePreview) {
      URL.revokeObjectURL(handwrittenImagePreview);
    }
    setHandwrittenImageFile(file);
    setHandwrittenImagePreview(URL.createObjectURL(file));
  };

  // تبدیل فایل به data URL (base64) فقط در حافظهٔ RAM — هیچ فایلی روی دیسک نوشته نمی‌شود.
  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
      reader.onerror = () => reject(reader.error || new Error('خواندن فایل ناموفق بود.'));
      reader.readAsDataURL(file);
    });

  // ارسال تصویر دست‌نوشته به API: متن + تصویر هر دو اختیاری‌اند، اما حداقل یکی باید باشد.
  // پاسخ API همان آرایهٔ requests ساختاریافته است که در chatProposedRequests می‌نشیند
  // و کاربر باید با دکمهٔ «تأیید و ثبت نهایی» آن را ثبت کند. هوش مصنوعی هرگز مستقیماً
  // در پایگاه‌داده چیزی نمی‌نویسد.
  const handleSendHandwrittenImage = async () => {
    if (role === 'personnel' && requestsLockedMonths.includes(`${currentYear}_${currentMonth}`)) {
      setHandwrittenParseError('مهلت ثبت درخواست برای این ماه به پایان رسیده است.');
      return;
    }
    const targetPersonnel = requestChatPersonnel;
    if (!targetPersonnel) {
      setHandwrittenParseError('لطفاً ابتدا پرسنل متقاضی را انتخاب کنید.');
      return;
    }
    if (!handwrittenImageFile) {
      setHandwrittenParseError('ابتدا یک تصویر انتخاب کنید.');
      return;
    }
    setIsHandwrittenParsing(true);
    setHandwrittenParseError(null);

    // متن اختیاری کاربر (مثلاً «این عکس دست‌نوشتهٔ درخواست‌های این ماهمه») به‌عنوان
    // پیام متنی کاربر به حباب چت اضافه می‌شود تا context کافی برای AI فراهم شود.
    const optionalText = requestChatInput.trim();
    if (optionalText) {
      setRequestChatInput('');
    }

    // پیام موقت کاربر در چت برای شفافیت. thumbnail تصویر در حباب پیام
    // نمایش داده می‌شود تا کاربر چیزی که فرستاده را ببیند.
    const previewUrl = handwrittenImagePreview || undefined;
    if (previewUrl) {
      // ثبت URL در ref برای آزادسازی قطعی در unmount
      chatImageUrlsRef.current.add(previewUrl);
    }
    const userCaption: RequestChatMessage = {
      id: `chat_user_img_${Date.now()}`,
      role: 'user',
      content: optionalText
        ? `📷 تصویر دست‌نوشته پیوست شد — ${optionalText}`
        : '📷 تصویر دست‌نوشته پیوست شد',
      timestamp: new Date().toISOString(),
      imageUrl: previewUrl,
      imageCaption: handwrittenImageFile?.name,
    };
    setRequestChatMessages(current => [...current, userCaption]);

    let parsedDataUrl = '';
    try {
      parsedDataUrl = await readFileAsDataUrl(handwrittenImageFile);

      // آماده‌سازی context (مشابه sendChatMessage ولی فقط context ضروری)
      const contextBody = {
        image: parsedDataUrl,
        mimeType: handwrittenImageFile.type || 'image/jpeg',
        year: currentYear,
        month: currentMonth,
        personnel: {
          firstName: targetPersonnel.firstName,
          lastName: targetPersonnel.lastName,
          jobGroup: targetPersonnel.jobGroup,
          workRoutine: targetPersonnel.workRoutine,
        },
        calendarDays: calendarDays.map(day => ({
          day: day.day,
          dayOfWeek: day.dayOfWeek,
          weekdayName: WEEKDAYS[day.dayOfWeek],
          isHoliday: day.isHoliday,
          holidayTitle: day.holidayTitle || calendarOccasions[day.day]?.join('، '),
        })),
        existingRequests: requests
          .filter(request => request.personnelId === targetPersonnel.id)
          .map(request => ({
            requestType: request.requestType,
            preferredShift: request.preferredShift,
            patternSteps: request.patternSteps,
            scope: request.scope,
            selectedDays: request.selectedDays,
            startDate: request.startDate,
            endDate: request.endDate,
            isEssential: request.isEssential,
            offHardness: request.offHardness,
          })),
        scheduleHistory: buildRequestChatScheduleHistory(targetPersonnel.id),
      };

      // ارسال به API جدید. تایم‌اوت ۶۰ ثانیه چون OCR + تحلیل هم‌زمان زمان‌بر است.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      let response: Response;
      try {
        response = await fetch('/api/gemini/parse-handwritten-shift', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(contextBody),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const data = await response.json().catch(() => ({} as any));
      if (!response.ok) {
        throw new Error(data.error || 'پردازش تصویر دست‌نوشته ناموفق بود.');
      }

      const extracted: any[] = Array.isArray(data.requests) ? data.requests : [];
      const status: string = typeof data.status === 'string' ? data.status : 'ready';
      const serverWarnings: string[] = Array.isArray(data.warnings) ? data.warnings : [];

      // آزادسازی فوری حافظهٔ data URL (بزرگ‌ترین مصرف‌کنندهٔ RAM در این مسیر)
      parsedDataUrl = '';

      // پاک کردن تصویر از UI چون دیگر استفاده شد
      clearHandwrittenImage();

      if (status === 'illegible' || extracted.length === 0) {
        setRequestChatMessages(current => [
          ...current,
          {
            id: `chat_img_illegible_${Date.now()}`,
            role: 'assistant',
            content: 'متأسفانه متن دست‌نوشته خوانا نبود یا چیزی قابل تشخیص نبود. لطفاً عکس واضح‌تری بفرست یا درخواستت را در چت بنویس.',
            timestamp: new Date().toISOString(),
          },
        ]);
        return;
      }

      // نگاشت به فرم داخلی chatProposedShiftRequest
      const now = new Date().toISOString();
      const mapped: ChatProposedShiftRequest[] = extracted.map((item: any, index: number) => ({
        id: `chat_img_draft_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
        personnelId: targetPersonnel.id,
        requestType: item.requestType,
        preferredShift:
          item.requestType === 'leave'
            ? 'L'
            : item.requestType === 'OFF'
              ? 'OFF'
              : item.preferredShift,
        patternSteps: item.patternSteps,
        isEssential: !!item.isEssential,
        offHardness: item.requestType === 'OFF' ? (role === 'personnel' ? undefined : (item.offHardness || 'hard')) : undefined,
        scope: item.scope || 'custom_days',
        startDate: item.startDate,
        endDate: item.endDate,
        selectedDays: item.selectedDays,
        description: item.description,
        createdAt: now,
        updatedAt: now,
      }));

      setChatProposedRequests(mapped);

      const summary = mapped
        .map((r, i) => `${i + 1}. ${getRequestSummaryText(r)}`)
        .join(' | ');
      const warningSuffix = serverWarnings.length > 0
        ? `\n\n⚠️ نکتهٔ هوش مصنوعی: ${serverWarnings.join(' / ')}`
        : '';
      setRequestChatMessages(current => [
        ...current,
        {
          id: `chat_img_extracted_${Date.now()}`,
          role: 'assistant',
          content: `دست‌نوشته خوانده شد ✍️ ${mapped.length} درخواست تشخیص داده شد:\n${summary}\n\nاگر درست است، دکمهٔ «تأیید و ثبت نهایی» را بزن؛ اگر نه، در همین چت اصلاحش کن.${warningSuffix}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      console.error('Handwritten OCR error:', error);
      const message = error instanceof Error ? error.message : String(error);
      setHandwrittenParseError(message);
      setRequestChatMessages(current => [
        ...current,
        {
          id: `chat_img_err_${Date.now()}`,
          role: 'assistant',
          content: `خطا در پردازش تصویر: ${message}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      // پاک‌سازی قطعی هر ارجاعی به data URL در RAM
      parsedDataUrl = '';
      setIsHandwrittenParsing(false);
    }
  };

  const handleConfirmChatRequests = async () => {
    if (chatProposedRequests.length === 0) return;
    if (role === 'personnel' && requestsLockedMonths.includes(`${currentYear}_${currentMonth}`)) {
      alert('مهلت ثبت درخواست برای این ماه به پایان رسیده است.');
      return;
    }

    const targetPersonnel = requestChatPersonnel;
    if (!targetPersonnel) {
      alert('لطفاً ابتدا پرسنل متقاضی را انتخاب کنید.');
      return;
    }

    try {
      const finalized = chatProposedRequests.map((request, index) => ({
        ...request,
        id: `req_chat_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
        personnelId: targetPersonnel.id,
        updatedAt: new Date().toISOString(),
      }));
      const updatedRequests = [...requests, ...finalized];
      await saveState(personnel, updatedRequests, settings, customHolidays, {
        mode: 'refresh_personnel',
        personnelIds: [targetPersonnel.id],
      });
      logEvent({
        category: 'ai',
        severity: 'success',
        title: `${finalized.length} درخواست از CHAT BOX ثبت شد`,
        detail: `پرسنل: ${targetPersonnel.firstName} ${targetPersonnel.lastName} — ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} ${currentYear}`,
      });
      setChatProposedRequests([]);
      setRequestChatMessages(current => [
        ...current,
        {
          id: `chat_saved_${Date.now()}`,
          role: 'assistant',
          content: 'ثبت شد ✅ درخواست‌ها رو وارد کردم؛ فقط یادت باشه اجرای نهایی به پوشش بخش و تصمیم برنامه‌ریزی بستگی داره.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      console.error('Error saving chat requests:', error);
      alert('خطا در ثبت درخواست‌های چت: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  // ====== ویرایش آیتم‌های کادر نتیجهٔ تحلیل (Calendar editor) ======
  // همان روش requestEditTarget استفاده می‌شود: snapshot روز→شیفت می‌سازیم
  // و سپس با بازسازی آیتم، آن را به chatProposedRequests برمی‌گردانیم.
  const openChatItemEditor = (index: number) => {
    const item = chatProposedRequests[index];
    if (!item) return;
    const days = resolveRequestDays(item);
    const daysMap: Record<number, NonNullable<ShiftRequest['preferredShift']>> = {};
    days.forEach(day => {
      if (item.preferredShift) {
        daysMap[day] = item.preferredShift as NonNullable<ShiftRequest['preferredShift']>;
      }
    });
    setChatEditingIndex(index);
    setChatEditingDays(daysMap);
    setChatEditingActiveDay(null);
  };

  const closeChatItemEditor = () => {
    setChatEditingIndex(null);
    setChatEditingDays({});
    setChatEditingActiveDay(null);
  };

  const saveChatItemEdit = () => {
    if (chatEditingIndex === null) return;
    const original = chatProposedRequests[chatEditingIndex];
    if (!original) return;

    // روزهای باقی‌مانده بعد از ویرایش
    const newDays = Object.keys(chatEditingDays)
      .map(d => Number(d))
      .filter(d => Number.isInteger(d) && d >= 1)
      .sort((a, b) => a - b);

    if (newDays.length === 0) {
      // اگر همهٔ روزها حذف شدند، کل آیتم حذف می‌شود
      setChatProposedRequests(current => current.filter((_, i) => i !== chatEditingIndex));
      setRequestChatMessages(current => [
        ...current,
        {
          id: `chat_edit_removed_${Date.now()}`,
          role: 'assistant',
          content: 'این مورد به‌دلیل حذف همهٔ روزها از کادر نتیجه حذف شد.',
          timestamp: new Date().toISOString(),
        },
      ]);
      closeChatItemEditor();
      return;
    }

    // اگر همهٔ روزها شیفت یکسانی دارند، preferredShift همان است؛ در غیر این صورت
    // آیتم به چند آیتم تک‌شیفتی (یکی برای هر شیفت متفاوت) شکسته می‌شود.
    const distinctShifts = Array.from(new Set(newDays.map(d => chatEditingDays[d])));
    const updatedList = [...chatProposedRequests];

    if (distinctShifts.length === 1) {
      // همهٔ روزها یک شیفت: آیتم فعلی به‌روزرسانی می‌شود
      const newShift = distinctShifts[0];
      updatedList[chatEditingIndex] = {
        ...original,
        preferredShift: newShift,
        scope: 'custom_days',
        selectedDays: newDays,
        startDate: undefined,
        endDate: undefined,
        patternSteps: undefined,
        description: original.description
          ? `${original.description} (ویرایش‌شده)`
          : 'ویرایش‌شده توسط کاربر',
        updatedAt: new Date().toISOString(),
      };
    } else {
      // شیفت‌های متفاوت: آیتم فعلی به چند آیتم تقسیم می‌شود
      const groupedByShift: Record<string, number[]> = {};
      newDays.forEach(day => {
        const shift = chatEditingDays[day];
        if (!groupedByShift[shift]) groupedByShift[shift] = [];
        groupedByShift[shift].push(day);
      });

      const newItems: ChatProposedShiftRequest[] = Object.entries(groupedByShift).map(([shift, daysList]) => ({
        ...original,
        id: `chat_draft_edited_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        preferredShift: shift as NonNullable<ShiftRequest['preferredShift']>,
        scope: 'custom_days',
        selectedDays: daysList,
        startDate: undefined,
        endDate: undefined,
        patternSteps: undefined,
        description: original.description
          ? `${original.description} (ویرایش‌شده، شیفت ${shift})`
          : `ویرایش‌شده، شیفت ${shift}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));

      // جایگزینی آیتم فعلی با آیتم‌های جدید
      updatedList.splice(chatEditingIndex, 1, ...newItems);
    }

    setChatProposedRequests(updatedList);
    setRequestChatMessages(current => [
      ...current,
      {
        id: `chat_edit_done_${Date.now()}`,
        role: 'assistant',
        content: distinctShifts.length === 1
          ? 'ویرایش آیتم اعمال شد ✏️'
          : 'به دلیل تفاوت شیفت روزها، آیتم به چند مورد جداگانه تقسیم شد ✏️',
        timestamp: new Date().toISOString(),
      },
    ]);
    closeChatItemEditor();
  };

  const removeChatProposedItem = (index: number) => {
    setChatProposedRequests(current => current.filter((_, i) => i !== index));
  };

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
      offHardness: reqType === 'OFF' ? (role === 'personnel' ? undefined : reqOffHardness) : undefined,
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
        offHardness: reqType === 'OFF' ? (role === 'personnel' ? undefined : reqOffHardness) : undefined,
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
      const requesterPerson = personnel.find(item => item.id === pid);
      logEvent({
        category: 'requests',
        severity: 'success',
        title: `${finalRequestsToSave.length} درخواست شیفت ثبت شد`,
        detail: `پرسنل: ${requesterPerson ? `${requesterPerson.firstName} ${requesterPerson.lastName}` : pid} — ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} ${currentYear} — برنامه همان پرسنل بازتولید شد`,
      });
      setShowAddRequestModal(false);

      setDraftRequests([]);
      setEditingRequest(null);
      setReqPatternInput('EN OFF OFF');
      setReqIsEssential(false);
      setReqSelectedDays([]);
    } catch (error) {
      console.error("Error submitting final requests:", error);
      logEvent({
        category: 'requests',
        severity: 'error',
        title: 'ثبت نهایی درخواست‌ها ناموفق بود',
        detail: error instanceof Error ? error.message : String(error),
      });
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
          offHardness: reqType === 'OFF' ? (role === 'personnel' ? undefined : reqOffHardness) : undefined,
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

  // باز کردن ویرایشگر تقویمی برای یک درخواست ثبت‌شده
  const handleOpenRequestEditor = (r: ShiftRequest) => {
    if (role === 'personnel' && requestsLockedMonths.includes(`${currentYear}_${currentMonth}`)) {
      alert('مهلت ثبت و ویرایش درخواست برای این ماه به پایان رسیده است.');
      return;
    }
    const days = resolveRequestDays(r);
    const defaultCode: NonNullable<ShiftRequest['preferredShift']> =
      r.requestType === 'OFF' ? 'OFF'
      : r.requestType === 'leave' ? 'L'
      : (r.preferredShift || 'M');
    const map: Record<number, NonNullable<ShiftRequest['preferredShift']>> = {};
    days.forEach(day => { map[day] = defaultCode; });
    setRequestEditTarget(r);
    setRequestEditDays(map);
    setRequestEditActiveDay(null);
  };

  const handleCloseRequestEditor = () => {
    setRequestEditTarget(null);
    setRequestEditDays({});
    setRequestEditActiveDay(null);
  };

  // ثبت نهایی ویرایش: هر شیفت متفاوت به یک درخواست custom_days جداگانه تبدیل می‌شود
  const handleSaveRequestEdit = async () => {
    if (!requestEditTarget) return;
    if (role === 'personnel' && requestsLockedMonths.includes(`${currentYear}_${currentMonth}`)) {
      alert('مهلت ثبت و ویرایش درخواست برای این ماه به پایان رسیده است.');
      return;
    }

    const entries = Object.entries(requestEditDays)
      .map(([day, code]) => ({ day: Number(day), code }))
      .filter(entry => Number.isInteger(entry.day) && !!entry.code);

    if (entries.length === 0) {
      alert('حداقل یک روز را انتخاب و نوع شیفت آن را مشخص کنید (یا در صورت نیاز، کل درخواست را حذف کنید).');
      return;
    }

    // گروه‌بندی روزها بر اساس کد شیفت انتخابی
    const grouped = new Map<NonNullable<ShiftRequest['preferredShift']>, number[]>();
    entries.forEach(({ day, code }) => {
      const list = grouped.get(code) || [];
      list.push(day);
      grouped.set(code, list);
    });

    const now = new Date().toISOString();
    const rebuilt: ShiftRequest[] = Array.from(grouped.entries()).map(([code, days], index) => ({
      ...requestEditTarget,
      id: index === 0 ? requestEditTarget.id : `req_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
      requestType: code === 'OFF' ? 'OFF' : code === 'L' ? 'leave' : 'shift',
      preferredShift: code,
      patternSteps: undefined,
      // نوع آف را فقط سرپرستار تعیین می‌کند و مقدار قبلی حفظ می‌شود
      offHardness: code === 'OFF'
        ? (role === 'personnel' ? requestEditTarget.offHardness : (requestEditTarget.offHardness || 'hard'))
        : undefined,
      isEssential: role === 'personnel' ? requestEditTarget.isEssential : requestEditTarget.isEssential,
      scope: 'custom_days',
      startDate: undefined,
      endDate: undefined,
      selectedDays: days.sort((a, b) => a - b),
      createdAt: requestEditTarget.createdAt || now,
      updatedAt: now,
    }));

    setIsSavingRequestEdit(true);
    try {
      const withoutOriginal = requests.filter(item => item.id !== requestEditTarget.id);
      const updatedR = [...withoutOriginal, ...rebuilt];
      await saveState(personnel, updatedR, settings, customHolidays, {
        mode: 'refresh_personnel',
        personnelIds: [requestEditTarget.personnelId],
      });
      const person = personnel.find(item => item.id === requestEditTarget.personnelId);
      logEvent({
        category: 'requests',
        severity: 'success',
        title: 'درخواست ثبت‌شده ویرایش شد',
        detail: `پرسنل: ${person ? `${person.firstName} ${person.lastName}` : requestEditTarget.personnelId} — ${entries.length} روز در ${rebuilt.length} درخواست — ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} ${currentYear}`,
      });
      handleCloseRequestEditor();
    } catch (error) {
      console.error('Error editing request days:', error);
      alert('خطا در ثبت ویرایش درخواست: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsSavingRequestEdit(false);
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

  const getScenarioEditingContext = React.useCallback((personnelId: string) => {
    const person = personnelRef.current.find(item => item.id === personnelId);
    if (!person) return null;
    const workflow = getWorkflowForGroup(person.jobGroup);
    const selectedScenario = getSelectedScenarioForGroup(person.jobGroup);
    if (!workflow || !selectedScenario) return null;
    const scenarioIndex = getSelectedScenarioIndexForGroup(person.jobGroup);
    return {
      group: person.jobGroup,
      workflow,
      scenario: selectedScenario,
      scenarioIndex,
      person,
    };
  }, [getSelectedScenarioForGroup, getSelectedScenarioIndexForGroup, getWorkflowForGroup]);

  // --- Manual Schedule Override cell edit ---
  const handleCellClick = (pId: string, day: number) => {
    if (role !== 'admin' && role !== 'headnurse') return;

    const scenarioContext = getScenarioEditingContext(pId);
    if (scenarioContext) {
      if (lockedRows.includes(pId)) {
        alert('این ردیف قفل شده است و قابل ویرایش نیست.');
        return;
      }
      setEditingCell({ pId, day });
      return;
    }

    const person = personnel.find(per => per.id === pId);
    if (person) {
      const monthKeyLocal = `${currentYear}_${currentMonth}`;
      const finalizedMonthsForGroup = person.jobGroup === 'nurse' ? finalizedNursesMonths : finalizedAssistantsMonths;
      const editCheck = canEditShiftCell({
        jobGroup: person.jobGroup,
        personnelId: pId,
        finalizedMonths: finalizedMonthsForGroup,
        lockedRows,
        monthKey: monthKeyLocal,
      });

      if (!editCheck.allowed && editCheck.message) {
        alert(editCheck.message);
        return;
      }
    }

    setEditingCell({ pId, day });
  };

  const handleManualShiftChange = async (pId: string, day: number, shift: ShiftType) => {
    const deptId = selectedDepartmentId || 'sepehr';
    const monthKey = `${currentYear}_${currentMonth}`;
    const scenarioContext = getScenarioEditingContext(pId);
    const latestSchedule: MonthlySchedule | null = scenarioContext
      ? scenarioContext.scenario.schedule
      : optimisticDbRef.current?.deptData?.[deptId]?.schedules?.[monthKey] ?? scheduleRef.current ?? null;

    if (!latestSchedule) return;

    // از refs برای خواندن آخرین وضعیت استفاده می‌کنیم تا از stale state جلوگیری شود
    const currentPersonnel = personnelRef.current;
    const currentRequests = requestsRef.current;
    const currentSettings = settingsRef.current;
    const currentHolidays = holidaysRef.current;
    const currentFirstDay = firstDayRef.current;
    const currentDismissed = dismissedWarningsRef.current;
    const currentLocked = lockedRowsRef.current;

    // گزینه یکپارچه «مرخصی» در منوی سلول: شماره روز مرخصی بر اساس روزهای پیاپی
    // قبلی تعیین می‌شود تا در لیست، روز اول عدد ۱، روز دوم عدد ۲ و الی آخر بیاید.
    const resolvedShift: ShiftType =
      shift === 'L' ? resolveLeaveShiftAssignment(latestSchedule.assignments, pId, day) : shift;

    try {
      // Create persistence adapter for the Facade
      const persistenceAdapter: SchedulePersistence = {
        saveSchedule: async (newSchedule) => {
          const nextDb = getFreshDbCopy();
          if (!nextDb.deptData) nextDb.deptData = {};

          const oldDept = nextDb.deptData[deptId] || {
            personnel: [],
            requests: [],
            settings_system: INITIAL_SETTINGS,
            settings_credentials: { username: 'headnurse', password: '123456' },
            holidays: {},
            firstDayOfWeek: {},
            schedules: {},
          };

          if (scenarioContext) {
            const monthScenarios = normalizeScenarioMonthRecord((oldDept.activeScenarios || {})[monthKey]);
            const groupRecord = monthScenarios[scenarioContext.group];
            if (!groupRecord) throw new Error('سناریوی انتخاب‌شده برای ویرایش پیدا نشد.');

            const filteredWarnings = filterWarningsForScenarioGroup(newSchedule.warnings || [], currentPersonnel, scenarioContext.group);
            const rescoredScenarios = buildPairwiseDifferences(
              groupRecord.scenarios.map((scenario, index) => {
                if (index !== scenarioContext.scenarioIndex) return scenario;
                return reevaluateScenarioForGroup(
                  scenario,
                  scenarioContext.group,
                  {
                    ...newSchedule,
                    warnings: filteredWarnings,
                    lockedRows: currentLocked,
                  }
                );
              }),
              scenarioContext.group
            );

            const nextActiveScenarios = { ...(oldDept.activeScenarios || {}) } as any;
            nextActiveScenarios[monthKey] = {
              ...monthScenarios,
              [scenarioContext.group]: {
                ...groupRecord,
                scenarios: rescoredScenarios,
                votingOpen: false,
                comparisonStartedAt: undefined,
                generationLog: [
                  ...(groupRecord.generationLog || []),
                  `سناریوی ${groupRecord.scenarios[scenarioContext.scenarioIndex]?.scenarioKey || '?'} پس از ویرایش دستی دوباره به مرحله رفع هشدار بازگشت.`,
                ].slice(-5),
              },
            };

            const rawVotesMonth = (oldDept.scenarioVotes || {})[monthKey] as any;
            const votesMonth = rawVotesMonth && (rawVotesMonth.nurse !== undefined || rawVotesMonth.assistant !== undefined)
              ? { ...(rawVotesMonth as any) }
              : { nurse: {}, assistant: {} };
            votesMonth[scenarioContext.group] = {};

            nextDb.deptData[deptId] = {
              ...oldDept,
              activeScenarios: nextActiveScenarios,
              scenarioVotes: {
                ...(oldDept.scenarioVotes || {}),
                [monthKey]: votesMonth,
              },
            };

            await saveDbState(nextDb, { showBusyOverlay: false });
            return;
          }

          const prunedDismissed = newSchedule.dismissedWarnings ?? currentDismissed;
          nextDb.deptData[deptId] = {
            ...oldDept,
            schedules: {
              ...oldDept.schedules,
              [monthKey]: {
                ...newSchedule,
                dismissedWarnings: prunedDismissed,
                lockedRows: currentLocked,
              },
            },
          };

          await saveDbState(nextDb, { showBusyOverlay: false });
        },
      };

      // Use the Facade (delegates pure logic to domain layer)
      // ====== نکته کلیدی: currentSchedule از آخرین وضعیت تعهدشده خوانده می‌شود ======
      // ثبت سلول ویرایش‌شده در فهرست محافظت‌شده‌ها (سیستم هرگز این سلول را تغییر نمی‌دهد)
      protectedCellsRef.current.add(`${pId}:${day}`);

      const result = await applyManualShiftChangeFacade(
        {
          personnelId: pId,
          day,
          shift: resolvedShift,
          year: currentYear,
          month: currentMonth,
          currentSchedule: latestSchedule,
          personnel: currentPersonnel,
          requests: currentRequests,
          settings: currentSettings,
          holidays: currentHolidays,
          firstDayOfWeek: currentFirstDay,
          lockState: {
            finalizedNursesMonths,
            finalizedAssistantsMonths,
            lockedRows: currentLocked,
          },
          dismissedWarnings: currentDismissed,
          protectedCells: Array.from(protectedCellsRef.current),
        },
        verifyCoverageAndLeaders,
        persistenceAdapter,
        deptId
      );

      if (!result.success) {
        logEvent({
          category: 'schedule',
          severity: 'error',
          title: 'تغییر دستی شیفت انجام نشد',
          detail: result.error || 'خطای نامشخص',
        });
        alert('خطا در تغییر دستی شیفت: ' + result.error);
      } else if (result.schedule) {
        const finalSchedule: MonthlySchedule = {
          ...result.schedule,
          lockedRows: currentLocked,
          dismissedWarnings: result.schedule.dismissedWarnings ?? currentDismissed,
        };

        if (!scenarioContext) {
          setSchedule(finalSchedule);
          const remainingWarnings = finalSchedule.warnings ?? [];
          setDismissedAlertWarnings(prev => pruneDismissedWarningMap(remainingWarnings, prev));
          setDismissedWarnings(prev => pruneDismissedWarnings(remainingWarnings, prev));
        }

        // ویرایش دستی سرپرستار + هشدارهایی که با همین ویرایش رفع شدند، ثبت می‌شود.
        const editedPersonForLog = currentPersonnel.find(item => item.id === pId);
        const previousShift = latestSchedule.assignments?.[pId]?.[day] || 'OFF';
        const resolvedCount = result.resolvedWarnings?.length ?? 0;
        logEvent({
          category: 'schedule',
          severity: 'info',
          title: `ویرایش دستی شیفت${editedPersonForLog ? ` ${editedPersonForLog.firstName} ${editedPersonForLog.lastName}` : ''} در روز ${day}`,
          detail: [
            `شیفت از «${previousShift}» به «${resolvedShift}» تغییر کرد`,
            scenarioContext ? `در سناریوی ${scenarioContext.scenario.scenarioKey}` : `ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} ${currentYear}`,
            resolvedCount > 0 ? `${resolvedCount} هشدار با این تغییر رفع شد` : null,
            (finalSchedule.warnings?.length ?? 0) > 0 ? `${finalSchedule.warnings.length} هشدار باقی‌مانده` : 'بدون هشدار باقی‌مانده',
          ].filter(Boolean).join(' — '),
        });

        setEditingCell(null);
      }
    } catch (error) {
      console.error('Error setting manual shift change:', error);
      alert('خطا در تغییر دستی شیفت: ' + (error instanceof Error ? error.message : String(error)));
    }
  };

  // --- Dynamic System Configuration ---
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await saveState(personnel, requests, settings, customHolidays, { mode: 'full_resolve' });
      logEvent({
        category: 'settings',
        severity: 'success',
        title: 'تنظیمات موظفی و نیاز نیرویی بخش ذخیره شد',
        detail: `موظفی طرح: ${settings.dutyHours.conscript} ساعت — سقف اضافه‌کار: ${settings.dutyHours.overtime} ساعت — برنامه ماه با قوانین جدید بازتولید شد`,
      });
      alert('تنظیمات موظفی و نیاز نیرویی با موفقیت ذخیره شد.');
    } catch (error) {
      console.error("Error saving settings:", error);
      logEvent({
        category: 'settings',
        severity: 'error',
        title: 'ذخیره تنظیمات بخش ناموفق بود',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // --- Holiday Management ---
  // تنها نقطه‌ی نوشتن روی تعطیلات: لایه‌ی تغییرات را به‌روزرسانی می‌کند، بلافاصله
  // رابط کاربری را (خوش‌بینانه) تغییر می‌دهد و سپس نتیجه‌ی ادغام‌شده را ذخیره می‌کند.
  const applyHolidayOverrides = async (
    nextOverrides: { [day: number]: string },
    strategy: ScheduleUpdateStrategy = { mode: 'full_resolve' },
    logDescription?: string
  ) => {
    if (!canManageHolidays) return;
    const previousOverrides = holidayOverrides;
    setHolidayOverrides(nextOverrides);
    try {
      await saveState(
        personnel,
        requests,
        settings,
        mergeHolidayOverrides(officialHolidays, nextOverrides),
        strategy
      );
      if (logDescription) {
        logEvent({
          category: 'calendar',
          severity: 'info',
          title: logDescription,
          detail: `ماه ${JALALI_MONTH_NAMES[currentMonth - 1]} ${currentYear} — ساعت موظفی و برنامه ماه با تقویم جدید بازمحاسبه شد`,
        });
      }
    } catch (error) {
      // ذخیره‌سازی ناموفق نباید تقویم نمایش‌داده‌شده را با سرور ناسازگار بگذارد.
      setHolidayOverrides(previousOverrides);
      console.error('Error saving holiday override:', error);
      logEvent({
        category: 'calendar',
        severity: 'error',
        title: 'ثبت تغییر تقویم و تعطیلات ناموفق بود',
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  const handleToggleHoliday = async (day: number, title?: string) => {
    const wasHoliday = isEffectiveHoliday(officialHolidays, holidayOverrides, day);
    try {
      await applyHolidayOverrides(
        toggleHolidayOverride(officialHolidays, holidayOverrides, day, title),
        { mode: 'full_resolve' },
        `روز ${day} ${wasHoliday ? 'به روز کاری تبدیل شد' : 'تعطیل اعلام شد'}`
      );
    } catch {
      /* پیام خطا در saveState به کاربر نمایش داده شده است. */
    }
  };

  const handleRenameHoliday = async (day: number, title: string) => {
    try {
      await applyHolidayOverrides(
        setHolidayOverride(officialHolidays, holidayOverrides, day, title),
        { mode: 'full_resolve' },
        `عنوان تعطیلی روز ${day} به «${title}» تغییر کرد`
      );
    } catch {
      /* پیام خطا در saveState به کاربر نمایش داده شده است. */
    }
  };

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    const day = Number(holidayDayInput);
    const daysInMonth = calendarDays.length || officialCalendarState.calendar?.days.length || 31;
    if (!Number.isInteger(day) || day < 1 || day > daysInMonth) {
      alert(`روز واردشده معتبر نیست؛ عددی بین ۱ تا ${daysInMonth} وارد کنید.`);
      return;
    }
    if (!holidayTitleInput.trim()) return;
    try {
      await applyHolidayOverrides(
        setHolidayOverride(officialHolidays, holidayOverrides, day, holidayTitleInput.trim()),
        { mode: 'full_resolve' },
        `تعطیلی «${holidayTitleInput.trim()}» برای روز ${day} ثبت شد`
      );
      setHolidayTitleInput('');
      alert('تعطیلات با موفقیت ثبت شد.');
    } catch (error) {
      console.error("Error adding holiday:", error);
    }
  };

  const handleRemoveHoliday = async (day: number) => {
    try {
      await applyHolidayOverrides(
        clearHolidayOverride(officialHolidays, holidayOverrides, day),
        { mode: 'full_resolve' },
        `تعطیلی ثبت‌شده برای روز ${day} حذف شد`
      );
    } catch (error) {
      console.error("Error removing holiday:", error);
    }
  };

  // تثبیت ساعت موظفی محاسبه‌شده‌ی ماه جاری روی همان ماه، تا تغییرات بعدی تنظیمات
  // سراسری بخش، ساعت اعلام‌شده به پرسنل برای این ماه را جابه‌جا نکند.
  const handleApproveMonthlyDutyHours = async (officialHours: number, contractHours: number) => {
    if (!canManageHolidays) return;
    try {
      const dutyToSave = {
        ...settings.dutyHours,
        ...(settings.autoCalculateDutyHours
          ? { official: officialHours, contract: contractHours }
          : {}),
      };

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

      nextDb.deptData[deptId] = {
        ...oldDept,
        holidays: {
          ...oldDept.holidays,
          [`${currentYear}_${currentMonth}`]: {
            // همان لایه‌ی تغییرات ذخیره می‌شود تا تعطیلات رسمی بازنویسی نشوند.
            days: holidayOverrides,
            monthlyDutyHours: dutyToSave,
          },
        },
      };

      await saveDbState(nextDb);
      setMonthlyDutyHours(dutyToSave);
      alert('ساعت موظفی این ماه بر اساس تقویم و تنظیمات نهایی شد و در داشبورد پرسنل برای همین ماه نمایش داده خواهد شد.');
    } catch (e) {
      alert('خطا در ثبت نهایی موظفی این ماه: ' + e);
    }
  };

  // --- Sensitive department management (hard delete / secure ownership transfer) ---
  const exitToGuestPortal = () => {
    setAuthenticatedUser(null);
    setRole('guest');
    setPendingLogin(null);
    localStorage.removeItem('hospital_saved_role');
    localStorage.removeItem('hospital_saved_personnel_id');
    localStorage.removeItem('hospital_selected_dept_id');
    router.replace('/');
  };

  const handleDeleteDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deleteDeptNationalId.trim() || !deleteDeptPassword) {
      alert('برای تأیید حذف بخش، وارد کردن کد ملی و رمز عبور خود الزامی است.');
      return;
    }
    const targetDepartmentId = role === 'headnurse' ? (authenticatedUser?.departmentId || selectedDepartmentId) : selectedDepartmentId;
    setIsDeletingDept(true);
    try {
      const response = await fetch('/api/head-nurse/department', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nationalId: deleteDeptNationalId,
          password: deleteDeptPassword,
          ...(role === 'admin' ? { departmentId: targetDepartmentId } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'حذف بخش انجام نشد.');
      setShowDeleteDeptModal(false);
      setDeleteDeptNationalId('');
      setDeleteDeptPassword('');
      if (result.ownAccountRemoved) {
        // حساب مدیر فعلی نیز حذف شده است؛ خروج اجباری و بازگشت به ورود امن.
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        exitToGuestPortal();
      } else {
        window.location.reload();
      }
    } catch (error) {
      alert('خطا در حذف دائمی بخش: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsDeletingDept(false);
    }
  };

  const handleTransferHeadNurse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferPrevNationalId.trim() || !transferPrevPassword || !transferNewNationalId.trim() || !transferNewFirstName.trim() || !transferNewLastName.trim()) {
      alert('لطفاً اطلاعات سرپرستار جدید و تأیید امنیتی سرپرستار قبلی را کامل وارد کنید.');
      return;
    }
    setIsTransferringDept(true);
    try {
      const response = await fetch('/api/head-nurse/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(role === 'admin' ? { departmentId: selectedDepartmentId } : {}),
          previousNationalId: transferPrevNationalId,
          previousPassword: transferPrevPassword,
          newHeadNurse: {
            nationalId: transferNewNationalId,
            firstName: transferNewFirstName,
            lastName: transferNewLastName,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'انتقال مدیریت بخش انجام نشد.');
      setShowTransferDeptModal(false);
      setTransferPrevNationalId('');
      setTransferPrevPassword('');
      setTransferNewNationalId('');
      setTransferNewFirstName('');
      setTransferNewLastName('');
      if (result.transferredByPreviousHeadNurse) {
        // حساب سرپرستار قبلی غیرفعال شده است؛ خروج اجباری و بازگشت به ورود امن.
        await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        exitToGuestPortal();
      } else {
        alert(result.message || 'مدیریت بخش با موفقیت منتقل شد.');
        window.location.reload();
      }
    } catch (error) {
      alert('خطا در انتقال امن مدیریت بخش: ' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsTransferringDept(false);
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

  // گروه شغلی هدف برای چاپ (null = هر دو گروه)
  const [printJobGroup, setPrintJobGroup] = useState<JobGroup | null>(null);
  // منوی کرکره‌ای خروجی‌ها (PDF پرستاران / PDF کمک‌بهیاران / اکسل)
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);
  const exportMenuRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!showExportMenu) return;
    const onClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [showExportMenu]);

  const handlePrint = (jobGroup: JobGroup | null = null) => {
    setPrintJobGroup(jobGroup);
    // یک تیک صبر می‌کنیم تا برگه چاپ با گروه انتخابی رندر شود
    window.setTimeout(() => window.print(), 60);
  };

  // Generate current calendar array — یکپارچه با تعطیلات انتخابی بخش و روز آغاز هفته (Requirement 4)
  // تا هر تغییر تقویم سرپرستار در همه پنل‌ها، داشبورد و چینش لیست ذخیره و نمایش داده شود.
  const calendarDays = React.useMemo(() => {
    // اگر تقویم رسمی هنوز آماده نیست، آرایه خالی برمی‌گردانیم تا از پرش جلوگیری شود
    if (!officialCalendarState.calendar) return [] as JalaliDateInfo[];
    // از customHolidays (ادغام رسمی + تغییرات بخش) و firstDayOfWeekIndex استفاده می‌کنیم
    return generateJalaliMonthCalendar(currentYear, currentMonth, customHolidays, firstDayOfWeekIndex);
  }, [currentYear, currentMonth, customHolidays, firstDayOfWeekIndex, officialCalendarState.calendar]);

  // Render role badges
  const getRoleBadge = () => {
    switch (role) {
      case 'admin': return <span className="bg-red-500 text-white text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5"/> مدیر سیستم</span>;
      case 'headnurse': return <span className="bg-sky-500 text-white text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1"><UserCheck className="w-3.5 h-3.5"/> مدیر و سرپرستار بخش</span>;
      case 'personnel': return <span className="bg-emerald-500 text-white text-xs px-2.5 py-1 rounded-full font-bold flex items-center gap-1"><User className="w-3.5 h-3.5"/> پرسنل: {selectedPersonnelUser?.firstName} {selectedPersonnelUser?.lastName}</span>;
      default: return <span className="bg-slate-400 text-white text-xs px-2.5 py-1 rounded-full font-bold">مهمان</span>;
    }
  };

  // متن‌ها عمداً کوتاه‌اند تا کارت لودینگ کوچک بماند؛ جزئیات مرحله زیر نوار
  // پیشرفت نمایش داده می‌شود.
  const busyOverlaySubtitle =
    solvingTarget === 'nurse'
      ? 'تولید برنامه پرستاران'
      : solvingTarget === 'assistant'
        ? 'تولید برنامه کمک‌بهیاران'
        : isBlockingDbSave
          ? 'ذخیره‌سازی اطلاعات'
          : null;

  // تراکر فعال با توجه به عملیات جاری انتخاب می‌شود تا نوار درصد دقیقاً
  // مراحل همان عملیات را نشان دهد (نه یک انیمیشن تزئینی و ساختگی).
  const activeProgress =
    solvingTarget !== null
      ? solverProgress
      : isBlockingDbSave
        ? saveProgress
        : null;

  const busyOverlayProgressProps = activeProgress
    ? {
        percent: activeProgress.percent,
        phaseLabel: activeProgress.phaseLabel,
        phaseNumber: activeProgress.phaseNumber,
        phaseCount: activeProgress.phaseCount,
        remainingLabel: activeProgress.remainingLabel,
      }
    : {};

  // صفحات ورود و راه‌اندازی اولیه عمداً نوار درصدی ندارند: این انتظارها کوتاه‌اند
  // و همان اسپینر سبک قبلی، تجربهٔ سریع‌تر و سبک‌تری می‌دهد.
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
        {busyOverlaySubtitle && <BusyOverlay subtitle={busyOverlaySubtitle} {...busyOverlayProgressProps} />}
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
                  value={departments.length > 0 ? selectedDepartmentId : ''}
                  disabled={departmentListStatus !== 'ready' || departments.length === 0}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedDepartmentId(val);
                    if (typeof window !== 'undefined') {
                      localStorage.setItem('hospital_selected_dept_id', val);
                    }
                  }}
                  className="w-full text-xs font-black bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-emerald-500 focus:outline-none text-slate-800"
                >
                  {departments.length === 0 && (
                    <option value="">
                      {departmentListStatus === 'loading' ? 'در حال بارگذاری...' : 'هیچ بخشی تعریف نشده است'}
                    </option>
                  )}
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
                  onClick={() => {
                    setAuthError('');
                    setShowAddDeptModal(true);
                  }}
                  className="w-full sm:w-auto bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 text-indigo-700 font-extrabold text-xs px-3.5 py-2.5 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  تعریف بخش جدید...
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between mt-1 pt-1.5 border-t border-slate-100">
              <div className="text-[10px] text-slate-400 font-bold">
                {departmentListStatus === 'loading' ? (
                  <span>در حال بارگذاری فهرست بخش‌ها...</span>
                ) : departmentListStatus === 'error' ? (
                  <span className="text-rose-600">دریافت فهرست بخش‌ها با خطا مواجه شد.</span>
                ) : activeDept ? (
                  <>بخش فعلی: <span className="text-emerald-700 font-black">{activeDept.name}</span></>
                ) : (
                  <span className="text-amber-700">هنوز هیچ بخش پرستاری تعریف نشده است. سرپرستار می‌تواند بخش خود را ایجاد کند.</span>
                )}
              </div>
            </div>
          </div>

          {authError && (
            <div className="mb-6 p-4 bg-red-50 text-red-700 border border-red-200 text-xs rounded-xl font-bold flex items-center justify-center gap-2 max-w-2xl mx-auto animate-pulse">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              {authError}
            </div>
          )}
          {isPortalSubmitting && (
            <div className="mb-6 p-4 bg-sky-50 text-sky-800 border border-sky-300 text-xs rounded-xl font-black max-w-2xl mx-auto flex items-center justify-center gap-2.5 shadow-sm animate-pulse" role="status">
              <span className="inline-block w-4 h-4 border-2 border-sky-600 border-t-transparent rounded-full animate-spin shrink-0"></span>
              <span>در حال بررسی اطلاعات و ورود به سامانه، لطفاً شکیبا باشید...</span>
            </div>
          )}
          {portalNotice && (
            <div className="mb-6 p-4 bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs rounded-xl font-black max-w-2xl mx-auto" role="status">
              {portalNotice}
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
              <form onSubmit={(e) => { e.preventDefault(); void handlePortalLogin('staff'); }} className="space-y-2 text-right pt-4">
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
                  type="submit"
                  disabled={isPortalSubmitting}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-500 text-white font-extrabold text-xs py-3.5 rounded-xl transition-all cursor-pointer shadow-md hover:scale-[1.01] mt-2 flex items-center justify-center gap-2"
                  id="btn-login-personnel"
                >
                  {isPortalSubmitting ? (
                    <>
                      <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0"></span>
                      <span>در حال ورود...</span>
                    </>
                  ) : (
                    'ورود به پرتال شخصی کادر درمان'
                  )}
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
              </form>
            </div>

            <div className="bg-slate-50/70 border border-slate-200 p-6 rounded-2xl hover:border-emerald-400 hover:bg-slate-50 transition-all flex flex-col justify-between" id="portal-headnurse">
              <div>
                <div className="flex justify-center mb-3">
                  <span className="bg-sky-100/80 text-sky-600 p-3 rounded-xl"><UserCheck className="w-6 h-6"/></span>
                </div>
                <h3 className="font-extrabold text-slate-800 text-base mb-1">پنل سرپرستار بخش</h3>
                <p className="text-[11px] text-slate-500 leading-relaxed mb-4">مدیریت مستقیم تعهدات ماهیانه، تعریف الگوهای پوشش فعال و بهینه‌ساز خودکار توزیع متعادل شیفت.</p>
              </div>
              <form onSubmit={(e) => { e.preventDefault(); void handlePortalLogin('head-nurse'); }} className="space-y-2">
                <input
                  type="text"
                  placeholder="کد ملی سرپرستار"
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
                  type="submit"
                  disabled={isPortalSubmitting}
                  className="w-full bg-sky-600 hover:bg-sky-700 disabled:bg-sky-500 text-white font-extrabold text-xs py-3.5 rounded-xl transition-all cursor-pointer shadow-md hover:scale-[1.01] mt-2 flex items-center justify-center gap-2"
                  id="btn-login-headnurse"
                >
                  {isPortalSubmitting ? (
                    <>
                      <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0"></span>
                      <span>در حال ورود...</span>
                    </>
                  ) : (
                    isNewDeptWithDefaults ? 'ثبت و ورود اولین‌بار سرپرستار' : 'ورود سرپرستار بخش'
                  )}
                </button>
              </form>
            </div>

          </div>
        </div>

        {showAddDeptModal && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-fade-in" id="add-dept-modal">
            <div className="bg-white border rounded-3xl max-w-sm w-full p-6 shadow-2xl relative text-right space-y-4">
              <button
                type="button"
                onClick={() => setShowAddDeptModal(false)}
                className="absolute top-4 left-4 text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg p-1.5 cursor-pointer"
              >
                ✕
              </button>

              <h3 className="text-sm font-black text-slate-800 border-b pb-3 border-slate-100">
                تعریف بخش و حساب سرپرستار
              </h3>
              <p className="rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-[10px] font-bold leading-6 text-indigo-700">
                هر سرپرستار مدیر بخش خود است. حساب شما با رمز اولیه ۱۲۳۴ ساخته می‌شود و در اولین ورود باید رمز را تغییر دهید.
              </p>

              <form onSubmit={(e) => { e.preventDefault(); void handleHeadNurseOnboarding(); }} className="space-y-3">
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
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">نام سرپرستار</label>
                    <input
                      type="text"
                      value={newHeadNurseFirstName}
                      onChange={(e) => setNewHeadNurseFirstName(e.target.value)}
                      className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">نام خانوادگی</label>
                    <input
                      type="text"
                      value={newHeadNurseLastName}
                      onChange={(e) => setNewHeadNurseLastName(e.target.value)}
                      className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">کد ملی سرپرستار</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={10}
                    value={newHeadNurseNationalId}
                    onChange={(e) => setNewHeadNurseNationalId(e.target.value)}
                    className="w-full text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none text-center font-mono"
                    placeholder="کد ملی ۱۰ رقمی"
                  />
                </div>

                {authError && (
                  <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-700" role="alert">{authError}</p>
                )}

                <div className="pt-3 border-t border-slate-100 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddDeptModal(false)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs py-2 rounded-xl transition-all cursor-pointer"
                  >
                    انصراف
                  </button>
                  <button
                    type="submit"
                    disabled={isOnboardingSubmitting}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold text-xs py-2 rounded-xl transition-all shadow-md cursor-pointer"
                  >
                    {isOnboardingSubmitting ? 'در حال ساخت...' : 'ساخت بخش و حساب من'}
                  </button>
                </div>
              </form>
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
      {busyOverlaySubtitle && <BusyOverlay subtitle={busyOverlaySubtitle} {...busyOverlayProgressProps} />}

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
                  {resetRequestCount > 0 && (
                    <span
                      className="mr-auto min-w-5 rounded-full bg-rose-600 px-1.5 text-center text-[10px] font-black leading-5 text-white"
                      title={`${resetRequestCount} درخواست بازیابی رمز عبور در انتظار بررسی`}
                    >
                      {resetRequestCount}
                    </span>
                  )}
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

              {(role === 'admin' || role === 'headnurse') && (
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
                    {role === 'admin' ? 'مدیر سراسری' : role === 'headnurse' ? 'مدیر و سرپرستار بخش' : `پرسنل: ${selectedPersonnelUser?.lastName}`}
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
                {role === 'admin' ? 'مدیر سراسری سامانه' : role === 'headnurse' ? 'مدیر و سرپرستار بخش' : 'کارشناس پرستاری'}
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
          {/* کارت ساعت/تاریخ تهران فقط در داشبورد زمان‌بندی (همه نقش‌ها) نمایش داده می‌شود */}
          {activeTab === 'schedule' && <TehranDateTime lastSync={calendarSyncedAt} />}
          {officialCalendarState.status !== 'ready' && (
            <div className={`rounded-2xl border p-4 text-xs font-black print:hidden ${officialCalendarState.status === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-sky-200 bg-sky-50 text-sky-700'}`} role="status">
              {officialCalendarState.status === 'error' ? 'اتصال به تقویم رسمی کشور برقرار نشد؛ لطفاً اتصال اینترنت را بررسی و صفحه را تازه‌سازی کنید.' : 'در حال همگام‌سازی کامل روزها، مناسبت‌ها و تعطیلات رسمی ماه انتخاب‌شده…'}
            </div>
          )}

          {/* کارت «بازه برنامه‌ریزی» و دکمه‌های بازتولید فقط برای مدیر/سرپرستار و فقط در داشبورد */}
          {role !== 'personnel' && activeTab === 'schedule' && (
          <div className="bg-white border border-slate-200/80 p-4 rounded-2xl shadow-sm flex flex-col md:flex-row items-center justify-between gap-4 print:hidden">
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <span className="bg-indigo-50 text-indigo-700 p-1.5 rounded-xl border border-indigo-100"><Sparkles className="w-4 h-4"/></span>
              <div className="space-y-1">
                <div>
                  <span className="font-extrabold text-slate-700 ml-1">بازه برنامه‌ریزی:</span>
                  <span className="font-mono bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-2 py-0.5 font-bold">
                    {JALALI_MONTH_NAMES[currentMonth - 1]} {currentYear}
                  </span>
                </div>
                <p className="text-[11px] font-bold text-slate-500">
                  از این بخش می‌توانید برای هر گروه شغلی تا ۳ برنامه پیشنهادی معتبر تولید کنید تا پس از رفع هشدار، وارد مقایسه و نظرسنجی شوند.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleRunOptimizer('nurse')}
                    disabled={solvingTarget !== null || isLoadingDb || isSavingDb || !dbChecked || !isPersonnelLoaded || !isRequestsLoaded || officialCalendarState.status === 'loading'}
                    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-xs font-black px-4 py-2.5 rounded-xl shadow-lg ring-4 ring-indigo-500/10 cursor-pointer"
                    id="btn-run-solver-nurse"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${solvingTarget === 'nurse' ? 'animate-spin' : ''}`} />
                    {solvingTarget === 'nurse' ? 'در حال تولید برنامه‌های پیشنهادی پرستاران...' : 'تولید برنامه‌های پیشنهادی پرستاران'}
                  </button>
                  <button
                    onClick={() => handleRunOptimizer('assistant')}
                    disabled={solvingTarget !== null || isLoadingDb || isSavingDb || !dbChecked || !isPersonnelLoaded || !isRequestsLoaded || officialCalendarState.status === 'loading'}
                    className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-xs font-black px-4 py-2.5 rounded-xl shadow-lg ring-4 ring-teal-500/10 cursor-pointer"
                    id="btn-run-solver-assistant"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${solvingTarget === 'assistant' ? 'animate-spin' : ''}`} />
                    {solvingTarget === 'assistant' ? 'در حال تولید برنامه‌های پیشنهادی کمک‌بهیاران...' : 'تولید برنامه‌های پیشنهادی کمک‌بهیاران'}
                  </button>
                </div>
            </div>
          </div>
          )}

          {/* ====== مرکز هشدارها فقط برای داشبورد سرپرستار ====== */}
          {role === 'headnurse' && activeTab === 'schedule' && displayedSchedule && getVisibleWarnings().length > 0 && (
            <div className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
              <div className="bg-amber-50/70 px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    <h3 className="text-sm font-black text-slate-800">
                      مرکز هشدارهای باقی‌مانده
                    </h3>
                    <span className="bg-amber-100 text-amber-800 text-xs font-black px-2.5 py-0.5 rounded-full">
                      {getVisibleWarnings().length} مورد
                    </span>
                    <span className="bg-white text-amber-800 text-[10px] font-black px-2.5 py-0.5 rounded-full border border-amber-200">
                      {alertCenterContextLabel}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-600">
                    {alertCenterContextDescription}
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
                                      dismissedWarnings: pruneDismissedWarnings(verification.warnings, dismissedWarnings),
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

              {nurseWorkflow && (role === 'headnurse' || role === 'admin' || (role === 'personnel' && selectedPersonnelUser?.jobGroup === 'nurse' && nurseWorkflow.votingOpen)) && (
                <ScenarioWorkspace
                  group="nurse"
                  workflow={nurseWorkflow}
                  selectedScenarioId={currentScenarioNurse?.id ?? null}
                  canManage={role === 'headnurse' || role === 'admin'}
                  canVote={Boolean(role === 'personnel' && selectedPersonnelUser?.jobGroup === 'nurse' && nurseWorkflow.votingOpen)}
                  currentUserId={role === 'personnel' && selectedPersonnelUser ? selectedPersonnelUser.id : (authenticatedUser?.id || null)}
                  votes={normalizedScenarioVotes.nurse}
                  onSelectScenario={(scenarioId) => setSelectedScenarioByIdForGroup('nurse', scenarioId)}
                  onStartComparison={() => handleStartScenarioComparison('nurse')}
                  onToggleVoting={() => handleToggleScenarioVoting('nurse')}
                  onFinalize={(scenario) => handleApplyScenario(scenario, 'nurse')}
                  onVote={(scenarioId, rating) => handleVoteScenario(scenarioId, rating, 'nurse')}
                />
              )}

              {assistantWorkflow && (role === 'headnurse' || role === 'admin' || (role === 'personnel' && selectedPersonnelUser?.jobGroup === 'assistant' && assistantWorkflow.votingOpen)) && (
                <ScenarioWorkspace
                  group="assistant"
                  workflow={assistantWorkflow}
                  selectedScenarioId={currentScenarioAssistant?.id ?? null}
                  canManage={role === 'headnurse' || role === 'admin'}
                  canVote={Boolean(role === 'personnel' && selectedPersonnelUser?.jobGroup === 'assistant' && assistantWorkflow.votingOpen)}
                  currentUserId={role === 'personnel' && selectedPersonnelUser ? selectedPersonnelUser.id : (authenticatedUser?.id || null)}
                  votes={normalizedScenarioVotes.assistant}
                  onSelectScenario={(scenarioId) => setSelectedScenarioByIdForGroup('assistant', scenarioId)}
                  onStartComparison={() => handleStartScenarioComparison('assistant')}
                  onToggleVoting={() => handleToggleScenarioVoting('assistant')}
                  onFinalize={(scenario) => handleApplyScenario(scenario, 'assistant')}
                  onVote={(scenarioId, rating) => handleVoteScenario(scenarioId, rating, 'assistant')}
                />
              )}

              <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4 print:hidden">
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="font-extrabold text-slate-800 text-sm">
                    {role === 'personnel' && (finalizedNursesMonths.includes(`${currentYear}_${currentMonth}`) || finalizedAssistantsMonths.includes(`${currentYear}_${currentMonth}`))
                      ? 'برنامه نهایی تاییدشده شیفت‌های ماهانه'
                      : 'جدول برنامه شیفت‌های ماهانه'}
                  </h3>
                  {currentScenarioNurse && (
                    <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                      برنامه فعال پرستاران: {currentScenarioNurse.title}
                    </span>
                  )}
                  {currentScenarioAssistant && (
                    <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      برنامه فعال کمک‌بهیاران: {currentScenarioAssistant.title}
                    </span>
                  )}
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
                  <div className="relative" ref={exportMenuRef}>
                    <button
                      onClick={() => setShowExportMenu(v => !v)}
                      className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 transition-colors cursor-pointer"
                      id="btn-export-menu"
                      title="خروجی‌های چاپ و اکسل"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-emerald-600"/>
                      خروجی و چاپ
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
                    </button>
                    {showExportMenu && (
                      <div className="absolute left-0 mt-2 w-56 bg-white border border-slate-200 rounded-2xl shadow-xl z-40 overflow-hidden animate-fade-in" id="export-menu">
                        <button
                          onClick={() => { setShowExportMenu(false); handlePrint('nurse'); }}
                          className="w-full text-right flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 transition-colors cursor-pointer"
                          id="btn-print-nurses"
                        >
                          <Printer className="w-4 h-4 text-emerald-600"/> چاپ PDF پرستاران
                        </button>
                        <button
                          onClick={() => { setShowExportMenu(false); handlePrint('assistant'); }}
                          className="w-full text-right flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-sky-50 hover:text-sky-700 border-t border-slate-100 transition-colors cursor-pointer"
                          id="btn-print-assistants"
                        >
                          <Printer className="w-4 h-4 text-sky-600"/> چاپ PDF کمک‌بهیاران
                        </button>
                        <button
                          onClick={() => { setShowExportMenu(false); exportToExcel(); }}
                          className="w-full text-right flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 border-t border-slate-100 transition-colors cursor-pointer"
                          id="btn-export-excel"
                        >
                          <FileSpreadsheet className="w-4 h-4 text-slate-500"/> خروجی فایل اکسل
                        </button>
                      </div>
                    )}
                  </div>
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
                            id={`day-header-${d.day}`}
                            className={`sticky top-0 z-20 px-1 py-2 text-center text-[10px] font-black border-l border-b border-slate-200 min-w-[34px] ${d.isHoliday ? 'bg-rose-50 border-b-2 border-b-rose-400 text-rose-800' : 'bg-slate-50 text-slate-600'} ${highlightedDay === d.day ? 'outline-2 outline-indigo-500 outline-offset-[-2px] !bg-indigo-100 !text-indigo-900 animate-[pulse_1.1s_ease-in-out_5]' : ''}`}
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
                        .map(p => {
                          const pAssignments = displayedSchedule?.assignments[p.id] || {};
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

                                const isShiftLeaderM = displayedSchedule?.shiftLeaders?.[d.day]?.morning === p.id;
                                const isShiftLeaderE = displayedSchedule?.shiftLeaders?.[d.day]?.afternoon === p.id;
                                const isShiftLeaderN = displayedSchedule?.shiftLeaders?.[d.day]?.night === p.id;

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
                                    className={`px-0.5 py-1 text-center border-l border-slate-100 relative ${d.isHoliday ? 'bg-rose-50/10' : ''} ${highlightedDay === d.day ? 'bg-indigo-100/70 shadow-[inset_1px_0_0_0_rgb(99_102_241),inset_-1px_0_0_0_rgb(99_102_241)]' : ''}`}
                                  >
                                    {isEditingThis ? (
                                      <select
                                        autoFocus
                                        value={currentShift.startsWith('L') ? 'L' : currentShift}
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
                                        <option value="L">مرخصی</option>
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
              {/* درخواست‌های بازیابی رمز عبور فقط در پنل مدیریت، زیرمجموعه بخش مدیریت پرسنل قابل مشاهده است. */}
              {(role === 'headnurse' || role === 'admin') && <ResetRequestList />}

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
                        <th className="px-6 py-3.5 text-xs font-black text-slate-500 text-center">روتین کاری</th>
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
                          <td className="px-6 py-3.5 text-center">
                            {p.workRoutine === 'morning' && <span className="bg-amber-50 text-amber-700 text-[11px] px-2 py-0.5 rounded font-bold whitespace-nowrap">صبح‌کار</span>}
                            {p.workRoutine === 'evening_night' && <span className="bg-violet-50 text-violet-700 text-[11px] px-2 py-0.5 rounded font-bold whitespace-nowrap">عصر و شب‌کار</span>}
                            {p.workRoutine === 'long' && <span className="bg-teal-50 text-teal-700 text-[11px] px-2 py-0.5 rounded font-bold whitespace-nowrap">لانگ‌کار</span>}
                            {!p.workRoutine && <span className="text-slate-300 text-[11px] font-bold">چرخشی</span>}
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
                    <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" /> ثبت سریع درخواست‌های پرسنل
                  </h3>
                  <p className="text-slate-400 text-xs font-bold mt-0.5">انتخاب الگوهای آماده برای ثبت درخواست در چند ثانیه و کاهش خطای ورود اطلاعات</p>
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

              {/* دو بخش «درخواست‌های پرکاربرد» و «CHAT BOX» به‌صورت آکاردئونی و در ابتدا بسته هستند */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* آکاردئون ۱ — سبز/زمردی */}
                <button
                  type="button"
                  onClick={() => setOpenRequestPanel(prev => (prev === 'quick' ? null : 'quick'))}
                  aria-expanded={openRequestPanel === 'quick'}
                  className={`group relative overflow-hidden flex items-center justify-between gap-3 rounded-[1.75rem] border px-5 py-5 text-right transition-all duration-300 cursor-pointer ${
                    openRequestPanel === 'quick'
                      ? 'bg-gradient-to-bl from-emerald-500 via-teal-500 to-green-600 text-white border-emerald-600 shadow-xl shadow-emerald-200/60 scale-[1.01]'
                      : 'bg-gradient-to-bl from-emerald-50 via-white to-teal-50 text-slate-800 border-emerald-200 hover:border-emerald-400 hover:shadow-lg hover:shadow-emerald-100 hover:-translate-y-0.5'
                  }`}
                >
                  <span className="pointer-events-none absolute -left-10 -top-10 h-28 w-28 rounded-full bg-white/20 blur-2xl" />
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-gradient-to-l from-emerald-400 via-teal-400 to-green-500" />
                  <span className="relative flex items-center gap-3 min-w-0">
                    <span className={`shrink-0 flex h-11 w-11 items-center justify-center rounded-2xl shadow-sm transition-colors ${
                      openRequestPanel === 'quick' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      <Sparkles className="w-5 h-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm sm:text-base font-black">درخواست‌های پر کاربرد</span>
                      <span className={`block text-[10px] sm:text-[11px] font-bold mt-1 leading-5 ${openRequestPanel === 'quick' ? 'text-emerald-50' : 'text-slate-500'}`}>
                        الگوهای آماده EN / MEN / لانگ‌آف / OFF / مرخصی
                      </span>
                    </span>
                  </span>
                  <span className={`relative shrink-0 flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                    openRequestPanel === 'quick' ? 'bg-white/20 text-white rotate-180' : 'bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200'
                  }`}>
                    <ChevronDown className="w-4 h-4" />
                  </span>
                </button>

                {/* آکاردئون ۲ — بنفش/نیلی */}
                <button
                  type="button"
                  onClick={() => setOpenRequestPanel(prev => (prev === 'chat' ? null : 'chat'))}
                  aria-expanded={openRequestPanel === 'chat'}
                  className={`group relative overflow-hidden flex items-center justify-between gap-3 rounded-[1.75rem] border px-5 py-5 text-right transition-all duration-300 cursor-pointer ${
                    openRequestPanel === 'chat'
                      ? 'bg-gradient-to-bl from-violet-600 via-indigo-600 to-sky-600 text-white border-indigo-600 shadow-xl shadow-indigo-200/60 scale-[1.01]'
                      : 'bg-gradient-to-bl from-violet-50 via-white to-sky-50 text-slate-800 border-violet-200 hover:border-violet-400 hover:shadow-lg hover:shadow-violet-100 hover:-translate-y-0.5'
                  }`}
                >
                  <span className="pointer-events-none absolute -left-10 -top-10 h-28 w-28 rounded-full bg-white/20 blur-2xl" />
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-gradient-to-l from-violet-400 via-indigo-400 to-sky-500" />
                  <span className="relative flex items-center gap-3 min-w-0">
                    <span className={`shrink-0 flex h-11 w-11 items-center justify-center rounded-2xl text-[10px] font-black shadow-sm transition-colors ${
                      openRequestPanel === 'chat' ? 'bg-amber-300 text-slate-900' : 'bg-violet-100 text-violet-700'
                    }`}>
                      AI
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm sm:text-base font-black">CHAT BOX 🤩</span>
                      <span className={`block text-[10px] sm:text-[11px] font-bold mt-1 leading-5 ${openRequestPanel === 'chat' ? 'text-indigo-50' : 'text-slate-500'}`}>
                        اگر نتونستی درخواستتو بالا ثبت کنی بیا اینجا بنویس یا عکس بفرست!
                      </span>
                    </span>
                  </span>
                  <span className={`relative shrink-0 flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                    openRequestPanel === 'chat' ? 'bg-white/20 text-white rotate-180' : 'bg-violet-100 text-violet-700 group-hover:bg-violet-200'
                  }`}>
                    <ChevronDown className="w-4 h-4" />
                  </span>
                </button>
              </div>

              {openRequestPanel === 'quick' && (
              <div className="bg-gradient-to-br from-indigo-50 via-white to-emerald-50/60 border border-indigo-100 rounded-[2rem] shadow-sm overflow-hidden">
                <div className="p-5 sm:p-6 border-b border-indigo-100/70 bg-white/70">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-2 bg-indigo-600 text-white px-3 py-1.5 rounded-full text-[11px] font-black shadow-md shadow-indigo-100">
                        <Sparkles className="w-3.5 h-3.5 text-amber-200 fill-amber-200" /> درخواست‌های پر کاربرد
                      </div>
                      <h4 className="text-xl font-black text-slate-900 leading-8">اگر درخواست‌ روتین داری همیجا فوری وارد کن!</h4>
                      <p className="text-xs sm:text-sm font-extrabold text-slate-500">اگر درخواستت طولانیه برو به 🤩 !CHAT BOX</p>
                    </div>

                    {role !== 'personnel' ? (
                      <div className="w-full lg:w-80 bg-white border border-slate-200 rounded-2xl p-3 shadow-xs">
                        <label className="block text-[11px] font-black text-slate-500 mb-1.5">متقاضی درخواست فوری</label>
                        <select
                          value={quickPersonnelId}
                          onChange={(event) => setQuickPersonnelId(event.target.value)}
                          className="w-full text-xs font-extrabold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="">-- انتخاب پرسنل --</option>
                          {personnel.map(person => (
                            <option key={`quick-person-${person.id}`} value={person.id}>
                              {person.firstName} {person.lastName} ({person.jobGroup === 'nurse' ? 'پرستار' : 'کمک‌بهیار'})
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-4 py-3 rounded-2xl text-xs font-black">
                        متقاضی: {selectedPersonnelUser?.firstName} {selectedPersonnelUser?.lastName}
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 sm:p-6 space-y-5">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {QUICK_REQUEST_TEMPLATES.map(template => {
                      const isSelected = quickSelectedTemplateId === template.id;
                      const needsScope = template.id !== 'off' && template.id !== 'leave';
                      const isScopePickerOpen = needsScope && quickScopePickerFor === template.id;
                      return (
                        <React.Fragment key={`quick-template-cell-${template.id}`}>
                        <button
                          type="button"
                          key={template.id}
                          onClick={() => {
                            setQuickSelectedTemplateId(template.id);
                            setQuickSelectedDays([]);
                            // زیرشاخه فقط برای الگوهای شیفتی و دقیقاً زیر همان کارت باز می‌شود
                            setQuickScopePickerFor(prev => (needsScope && prev !== template.id ? template.id : null));
                          }}
                          aria-expanded={isScopePickerOpen}
                          className={`group relative overflow-hidden rounded-2xl border p-3 min-h-[94px] text-right transition-all cursor-pointer ${
                            isSelected
                              ? 'bg-white border-indigo-300 shadow-lg shadow-indigo-100 scale-[1.02]'
                              : 'bg-white/80 border-slate-200 hover:border-indigo-200 hover:shadow-md'
                          }`}
                          aria-pressed={isSelected}
                        >
                          <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-l ${template.accentClass}`} />
                          <span className="block text-base font-black text-slate-900 mb-1">{template.title}</span>
                          <span className="block text-[10px] font-extrabold text-slate-400 leading-5">{template.subtitle}</span>
                          {isSelected && (
                            <span className="absolute left-2 bottom-2 bg-indigo-600 text-white rounded-full p-1 shadow-sm">
                              <Check className="w-3 h-3" />
                            </span>
                          )}
                        </button>

                        {/* زیرشاخه‌ها فقط پس از کلیک روی همین کارت، همان‌جا ظاهر و پس از انتخاب محو می‌شوند */}
                        {isScopePickerOpen && (
                          <div className="col-span-2 md:col-span-5 bg-white/95 border border-indigo-200 rounded-3xl p-4 space-y-3 shadow-xs animate-fadeIn">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                              <div>
                                <h5 className="text-sm font-black text-slate-800">زیرشاخه «{template.title}» را انتخاب کن</h5>
                                <p className="text-[10px] font-bold text-slate-400 mt-1">جمعه‌ها در گزینه‌های «روز فرد/زوج» محاسبه نمی‌شوند.</p>
                              </div>
                              <span className="text-[10px] font-black bg-indigo-50 text-indigo-700 border border-indigo-100 px-3 py-1 rounded-full">
                                {template.id === 'long_off' ? 'لانگ‌آف = ME + OFF نرم روز مقابل' : 'ثبت مستقیم درخواست شیفت'}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                              {QUICK_REQUEST_SCOPE_OPTIONS.map(option => (
                                <button
                                  type="button"
                                  key={`${template.id}-${option.id}`}
                                  onClick={() => {
                                    setQuickSelectedScope(option.id);
                                    // پس از انتخاب، زیرشاخه دوباره محو می‌شود
                                    setQuickScopePickerFor(null);
                                  }}
                                  className={`rounded-2xl border px-3 py-3 text-right transition-all cursor-pointer ${
                                    quickSelectedScope === option.id
                                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-100'
                                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-indigo-50 hover:border-indigo-200'
                                  }`}
                                >
                                  <span className="block text-xs font-black">{option.title}</span>
                                  <span className={`block text-[9px] mt-1 font-bold ${quickSelectedScope === option.id ? 'text-indigo-100' : 'text-slate-400'}`}>{option.subtitle}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        </React.Fragment>
                      );
                    })}
                  </div>

                  {(quickSelectedTemplateId === 'off' || quickSelectedTemplateId === 'leave') && (
                    <div className="bg-white/90 border border-slate-200 p-4 rounded-3xl space-y-3 shadow-xs animate-fadeIn">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <h5 className="text-sm font-black text-slate-800">
                            {quickSelectedTemplateId === 'off' ? 'روزهای OFF 😴 را از تقویم انتخاب کن' : 'روزهای مرخصی 🏖 را از تقویم انتخاب کن'}
                          </h5>
                          <p className="text-[10px] text-slate-400 mt-1 font-bold">همان تقویم ماه جاری استفاده می‌شود؛ هر روز با یک کلیک انتخاب/حذف می‌شود.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (quickSelectedDays.length === calendarDays.length) {
                              setQuickSelectedDays([]);
                            } else {
                              setQuickSelectedDays(calendarDays.map(day => day.day));
                            }
                          }}
                          className="text-[10px] bg-indigo-50 border border-indigo-150 text-indigo-700 px-3 py-2 rounded-xl hover:bg-indigo-100 font-black transition-all cursor-pointer"
                        >
                          {quickSelectedDays.length === calendarDays.length ? 'حذف همه' : 'انتخاب کل ماه'}
                        </button>
                      </div>

                      <div className="grid grid-cols-7 gap-1.5 max-h-[260px] overflow-y-auto p-2 scrollbar-thin rounded-2xl border border-slate-200 bg-white shadow-inner">
                        {WEEKDAYS.map((weekday, index) => (
                          <div key={`quick-weekday-${weekday}`} className={`sticky top-0 z-10 rounded-lg py-1 text-center text-[8px] font-black ${index === 6 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{weekday[0]}</div>
                        ))}
                        {Array.from({ length: calendarDays[0]?.dayOfWeek || 0 }).map((_, index) => <span key={`quick-empty-${index}`} />)}
                        {calendarDays.map(dayInfo => {
                          const isSelected = quickSelectedDays.includes(dayInfo.day);
                          return (
                            <button
                              type="button"
                              key={`quick-custom-day-btn-${dayInfo.day}`}
                              onClick={() => {
                                if (isSelected) {
                                  setQuickSelectedDays(quickSelectedDays.filter(day => day !== dayInfo.day));
                                } else {
                                  setQuickSelectedDays([...quickSelectedDays, dayInfo.day].sort((a, b) => a - b));
                                }
                              }}
                              title={dayInfo.holidayTitle || (calendarOccasions[dayInfo.day] || []).join('، ')}
                              className={`relative min-h-12 py-1.5 text-[11px] font-black rounded-xl border transition-all flex flex-col items-center justify-center cursor-pointer ${
                                isSelected
                                  ? dayInfo.isHoliday
                                    ? 'bg-rose-600 text-white border-rose-700 shadow-md scale-105'
                                    : 'bg-indigo-600 text-white border-indigo-600 shadow-md scale-105'
                                  : dayInfo.isHoliday
                                    ? 'bg-rose-100 text-rose-700 border-rose-300 hover:bg-rose-200'
                                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                              }`}
                            >
                              {dayInfo.isHoliday && <span className={`absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-white' : 'bg-rose-500'}`} />}
                              <span className="text-xs font-mono font-extrabold">{dayInfo.day}</span>
                              <span className="text-[8px] opacity-75">{WEEKDAYS[dayInfo.dayOfWeek][0]}</span>
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[10px] font-bold text-slate-500">
                        <span>تعداد انتخاب: <b className="text-indigo-700">{quickSelectedDays.length}</b> روز</span>
                        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-indigo-600" /> انتخاب‌شده</span>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white border border-slate-200 rounded-3xl p-4 shadow-xs">
                    <div className="text-xs font-bold text-slate-500 leading-6">
                      {quickSelectedTemplateId ? (
                        <>
                          <span className="font-black text-slate-800">آماده ثبت: </span>
                          {QUICK_REQUEST_TEMPLATES.find(template => template.id === quickSelectedTemplateId)?.title}
                          {quickSelectedTemplateId !== 'off' && quickSelectedTemplateId !== 'leave'
                            ? ` / ${QUICK_REQUEST_SCOPE_OPTIONS.find(option => option.id === quickSelectedScope)?.title}`
                            : ` / ${quickSelectedDays.length} روز انتخاب شده`}
                        </>
                      ) : 'یک الگو را انتخاب کنید.'}
                    </div>
                    <button
                      type="button"
                      disabled={isQuickRequestSubmitting || !quickSelectedTemplateId}
                      onClick={handleQuickSubmitRequest}
                      className="w-full lg:w-auto min-w-44 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-black text-xs py-3 px-6 rounded-2xl shadow-lg shadow-emerald-100 transition-all cursor-pointer flex items-center justify-center gap-2"
                    >
                      {isQuickRequestSubmitting ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> در حال ثبت...
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4" /> تأیید
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
              )}

              {(openRequestPanel === 'chat' || isChatFullscreen) && (
              <div
                id="request-chat-box"
                className={isChatFullscreen
                  ? 'fixed inset-0 z-[210] h-[100dvh] w-full bg-white flex flex-col overflow-hidden'
                  : 'bg-white border border-slate-200 rounded-[2rem] shadow-sm overflow-hidden'}
              >
                <div className={`bg-gradient-to-l from-violet-600 via-indigo-600 to-sky-600 text-white ${isChatFullscreen ? 'shrink-0 px-3 py-2' : 'p-5 sm:p-6'}`}>
                  {isChatFullscreen ? (
                    /* هدر فشرده در حالت تمام صفحه: فقط عنوان و توضیح خیلی کوتاه */
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="shrink-0 bg-amber-300 text-slate-900 px-2 py-0.5 rounded-full text-[9px] font-black">CHAT BOX 🤩</span>
                        <span className="hidden sm:inline shrink-0 bg-white/15 border border-white/20 text-white px-2 py-0.5 rounded-full text-[9px] font-black">Gemini Flash</span>
                        <span className="truncate text-[9px] font-bold text-indigo-100">فارسی بنویس؛ اگر مبهم باشد سؤال می‌پرسد.</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="bg-white/10 border border-white/20 rounded-full px-2.5 py-1 text-[9px] font-black text-white/95 max-w-32 truncate">
                          {requestChatPersonnel ? `${requestChatPersonnel.firstName} ${requestChatPersonnel.lastName}` : 'پرسنل انتخاب‌نشده'}
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsChatFullscreen(false)}
                          title="خروج از حالت تمام صفحه (Esc)"
                          className="flex items-center gap-1 bg-white/15 hover:bg-white/25 active:scale-95 border border-white/25 text-white rounded-xl px-2.5 py-1.5 text-[10px] font-black transition-all cursor-pointer"
                        >
                          <Shrink className="w-3.5 h-3.5" />
                          <span>خروج</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="bg-white/15 border border-white/20 text-white px-3 py-1 rounded-full text-[10px] font-black">Gemini Flash</span>
                        <span className="bg-amber-300 text-slate-900 px-2.5 py-1 rounded-full text-[10px] font-black">CHAT BOX 🤩</span>
                      </div>
                      <h4 className="text-lg sm:text-xl font-black">هنوز درخواستتو ثبت نکردی؟ بیا تو چت 😉</h4>
                      <p className="text-[11px] sm:text-xs font-bold text-indigo-100 mt-1 leading-6">
                        فارسی، خودمونی یا رسمی بنویس؛ اگر چیزی مبهم باشد دستیار قبل از پیشنهاد نهایی سؤال می‌پرسد.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 self-start">
                      <div className="bg-white/10 border border-white/20 rounded-2xl px-4 py-3 text-xs font-black text-white/95">
                        گفتگو برای: {requestChatPersonnel ? `${requestChatPersonnel.firstName} ${requestChatPersonnel.lastName}` : 'پرسنل انتخاب‌نشده'}
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsChatFullscreen(true)}
                        title="بزرگ کردن چت به تمام صفحه"
                        className="flex items-center gap-1 bg-white/15 hover:bg-white/25 active:scale-95 border border-white/25 text-white rounded-xl px-2.5 py-1.5 text-[10px] font-black transition-all cursor-pointer"
                      >
                        <Expand className="w-3.5 h-3.5" />
                        <span>تمام صفحه</span>
                      </button>
                    </div>
                  </div>
                  )}
                </div>

                <div className={isChatFullscreen
                  ? 'flex-1 min-h-0 flex flex-col bg-slate-100'
                  : 'grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-0 bg-slate-50/60'}
                >
                  <div className={isChatFullscreen ? 'flex-1 min-h-0 flex flex-col gap-2 p-3 sm:p-4' : 'p-4 sm:p-5 space-y-4'}>
                    <div
                      ref={requestChatScrollRef}
                      className={isChatFullscreen
                        ? 'flex-1 min-h-0 overflow-y-auto rounded-3xl border border-slate-200 bg-white p-3 sm:p-4 shadow-inner scrollbar-thin'
                        : 'h-[360px] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-4 shadow-inner scrollbar-thin'}
                    >
                      <div className={isChatFullscreen ? 'mx-auto max-w-3xl space-y-2' : 'space-y-3'}>
                      {requestChatMessages.map(message => {
                        const isUser = message.role === 'user';
                        const hasImage = !!message.imageUrl;
                        return (
                          <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                            <div className={`shadow-xs font-bold ${
                              isChatFullscreen
                                ? 'max-w-[88%] rounded-2xl px-3 py-2 text-[11px] sm:text-xs leading-6'
                                : 'max-w-[86%] rounded-3xl px-4 py-3 text-xs sm:text-sm leading-7'
                            } ${
                              isUser
                                ? hasImage
                                  ? 'bg-indigo-600/95 text-white rounded-br-md p-2'
                                  : 'bg-indigo-600 text-white rounded-br-md'
                                : 'bg-slate-100 text-slate-700 border border-slate-200 rounded-bl-md'
                            }`}>
                              {hasImage && (
                                <button
                                  type="button"
                                  onClick={() => setChatImageModal({
                                    url: message.imageUrl as string,
                                    caption: message.imageCaption,
                                  })}
                                  className={`block w-full mb-1.5 rounded-xl overflow-hidden border-2 border-white/40 hover:border-white transition-colors cursor-zoom-in ${
                                    isChatFullscreen ? 'h-24' : 'h-32'
                                  }`}
                                  title="کلیک برای بزرگ‌نمایی"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={message.imageUrl}
                                    alt={message.imageCaption || 'تصویر ضمیمه‌شده'}
                                    className="w-full h-full object-cover"
                                  />
                                </button>
                              )}
                              {message.content && (
                                <div className={hasImage ? 'px-1.5 pb-1' : ''}>{message.content}</div>
                              )}
                              {hasImage && message.imageCaption && (
                                <div className={`mt-1 px-1.5 pt-1 border-t border-white/20 text-white/80 font-bold truncate ${isChatFullscreen ? 'text-[9px]' : 'text-[10px]'}`}>
                                  📎 {message.imageCaption}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {isRequestChatProcessing && (
                        <div className="flex justify-start">
                          <div className={`bg-slate-100 border border-slate-200 text-slate-500 rounded-3xl rounded-bl-md font-black flex items-center gap-2 ${isChatFullscreen ? 'px-3 py-2 text-[11px]' : 'px-4 py-3 text-xs'}`}>
                            <span className="w-3.5 h-3.5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" /> دارم دقیق بررسی می‌کنم...
                          </div>
                        </div>
                      )}
                      </div>
                    </div>

                    {/* ====== پیش‌نمایش تصویر دست‌نوشتهٔ انتخاب‌شده (فقط در حافظهٔ RAM) ====== */}
                    {(handwrittenImagePreview || isHandwrittenParsing || handwrittenParseError) && (
                      <div
                        dir="rtl"
                        className={isChatFullscreen
                          ? 'mx-auto w-full max-w-3xl flex items-center gap-2 px-1 py-1.5 rounded-2xl border border-slate-200 bg-slate-50/80 mb-1.5 shrink-0'
                          : 'flex items-center gap-2 px-2 py-1.5 rounded-2xl border border-slate-200 bg-slate-50/80 mb-1.5'}
                      >
                        {handwrittenImagePreview && (
                          <div className="relative shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={handwrittenImagePreview}
                              alt="پیش‌نمایش دست‌نوشته"
                              className={isChatFullscreen
                                ? 'w-12 h-12 object-cover rounded-xl border border-slate-200 shadow-sm'
                                : 'w-14 h-14 object-cover rounded-xl border border-slate-200 shadow-sm'}
                            />
                            <button
                              type="button"
                              onClick={clearHandwrittenImage}
                              disabled={isHandwrittenParsing}
                              className="absolute -top-1.5 -left-1.5 w-5 h-5 bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white rounded-full flex items-center justify-center shadow-md cursor-pointer"
                              title="حذف تصویر"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          {handwrittenImagePreview && (
                            <div className={`font-black text-slate-700 truncate ${isChatFullscreen ? 'text-[10px]' : 'text-[11px]'}`}>
                              <ImageIcon className="w-3 h-3 inline-block ml-1 -mt-0.5" />
                              {handwrittenImageFile?.name || 'تصویر دست‌نوشته'}
                            </div>
                          )}
                          {handwrittenParseError ? (
                            <div className={`text-rose-600 font-bold leading-4 mt-0.5 ${isChatFullscreen ? 'text-[9px]' : 'text-[10px]'}`}>
                              ⚠️ {handwrittenParseError}
                            </div>
                          ) : isHandwrittenParsing ? (
                            <div className={`text-indigo-700 font-bold flex items-center gap-1.5 mt-0.5 ${isChatFullscreen ? 'text-[9px]' : 'text-[10px]'}`}>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              در حال خواندن دست‌نوشته با هوش مصنوعی...
                            </div>
                          ) : handwrittenImagePreview ? (
                            <div className={`text-slate-500 font-bold leading-4 mt-0.5 ${isChatFullscreen ? 'text-[9px]' : 'text-[10px]'}`}>
                              برای ارسال، روی دکمهٔ «ارسال تصویر» بزن. فایلی روی سرور ذخیره نمی‌شود.
                            </div>
                          ) : null}
                        </div>

                        {handwrittenImagePreview && !isHandwrittenParsing && (
                          <button
                            type="button"
                            onClick={handleSendHandwrittenImage}
                            disabled={!requestChatPersonnel}
                            className={`shrink-0 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-black transition-all cursor-pointer flex items-center gap-1 ${isChatFullscreen ? 'px-2.5 py-1.5 text-[10px]' : 'px-3 py-2 text-[11px]'}`}
                            title="ارسال تصویر برای استخراج درخواست‌ها"
                            id="btn-send-handwritten"
                          >
                            <Send className={`-scale-x-100 ${isChatFullscreen ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
                            ارسال تصویر
                          </button>
                        )}
                      </div>
                    )}

                    <form onSubmit={handleRequestChatSubmit} className={isChatFullscreen ? 'mx-auto w-full max-w-3xl flex items-end gap-2 shrink-0' : 'flex items-end gap-2'}>
                      {/* دکمهٔ Attachment: انتخاب تصویر دست‌نوشته از دستگاه */}
                      <button
                        type="button"
                        onClick={() => handwrittenFileInputRef.current?.click()}
                        disabled={isRequestChatProcessing || isHandwrittenParsing || !requestChatPersonnel}
                        title="پیوست تصویر دست‌نوشته (OCR با Gemini)"
                        className="shrink-0 w-10 h-10 rounded-full bg-slate-100 text-slate-600 border border-slate-200 shadow-sm transition-all hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-600 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center"
                        id="btn-attach-handwritten"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>
                      <input
                        ref={handwrittenFileInputRef}
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif"
                        onChange={handleHandwrittenFileChange}
                        className="hidden"
                        id="input-handwritten-file"
                      />

                      <button
                        type="submit"
                        disabled={isRequestChatProcessing || !requestChatInput.trim() || !requestChatPersonnel}
                        title="ارسال پیام"
                        className="shrink-0 w-10 h-10 rounded-full bg-indigo-600 text-white shadow-lg shadow-indigo-100 transition-all hover:bg-indigo-700 active:scale-95 disabled:bg-slate-300 cursor-pointer flex items-center justify-center"
                      >
                        <Send className="w-4 h-4 -scale-x-100" />
                      </button>
                      <textarea
                        ref={requestChatInputRef}
                        value={requestChatInput}
                        onChange={(event) => {
                          setRequestChatInput(event.target.value);
                          if (isChatFullscreen) {
                            // رشد خودکار ارتفاع مثل پیام‌رسان‌ها (حداکثر ۱۲۸px)
                            const element = event.target;
                            element.style.height = 'auto';
                            element.style.height = `${Math.min(element.scrollHeight, 128)}px`;
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            void handleRequestChatSubmit();
                          }
                        }}
                        rows={isChatFullscreen ? 1 : undefined}
                        placeholder="مثلاً: دهم و دوازدهم آف باشم، بیستم شب بیام، پنجشنبه‌ها بیمارستان دیگه EN دارم پس اینجا اون شیفت نباشم... یا عکس دست‌نوشته‌ات رو با 📎 بفرست"
                        className={isChatFullscreen
                          ? 'min-h-[40px] max-h-32 flex-1 resize-none overflow-y-auto rounded-2xl border border-slate-300 bg-white px-3.5 py-2.5 text-[11px] sm:text-xs font-bold text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100'
                          : 'min-h-[58px] flex-1 resize-none rounded-2xl border border-slate-300 bg-white px-4 py-3 text-xs font-bold text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100'}
                      />
                      {chatFailedText && !isRequestChatProcessing && (
                        <button
                          type="button"
                          onClick={handleRetryChatMessage}
                          title={`ارسال مجدد آخرین پیام ناموفق: ${chatFailedText.slice(0, 40)}${chatFailedText.length > 40 ? '…' : ''}`}
                          className="shrink-0 w-7 h-7 rounded-full bg-rose-50 border border-rose-300 text-rose-600 hover:bg-rose-100 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
                        >
                          <span className="text-[11px] leading-none">🔄</span>
                        </button>
                      )}
                    </form>
                  </div>

                  <div className={isChatFullscreen
                    ? 'shrink-0 w-full max-h-[30vh] overflow-y-auto border-t border-slate-200 bg-white scrollbar-thin'
                    : 'border-t xl:border-t-0 xl:border-r border-slate-200 bg-white p-4 sm:p-5 space-y-4'}
                  >
                    <div className={isChatFullscreen ? 'mx-auto max-w-3xl p-2 space-y-2' : 'contents'}>
                      <div className="flex items-center justify-between gap-2">
                        <div className={isChatFullscreen ? 'flex items-center gap-2' : ''}>
                          <h5 className={`font-black text-slate-900 ${isChatFullscreen ? 'text-[11px]' : 'text-sm'}`}>نتیجه تحلیل</h5>
                          {isChatFullscreen ? (
                            <span className="text-[9px] font-bold text-slate-400">ثبت فقط پس از تأیید شما</span>
                          ) : (
                            <p className="text-[10px] font-bold text-slate-400 mt-1 leading-5">ثبت نهایی فقط بعد از تأیید شما انجام می‌شود.</p>
                          )}
                        </div>
                        {chatProposedRequests.length > 0 && (
                          <span className={`shrink-0 rounded-full bg-indigo-50 border border-indigo-100 font-black text-indigo-600 ${isChatFullscreen ? 'px-2 py-0.5 text-[9px]' : 'px-3 py-1 text-[10px]'}`}>
                            {chatProposedRequests.length} درخواست آماده ثبت
                          </span>
                        )}
                      </div>

                    {chatProposedRequests.length > 0 ? (
                      <div className={isChatFullscreen ? 'space-y-2' : 'space-y-3 animate-fadeIn'}>
                        <div className={`rounded-2xl border border-emerald-200 bg-emerald-50 ${isChatFullscreen ? 'p-2 flex items-center gap-2' : 'p-3'}`}>
                          <div className={`font-black text-emerald-800 ${isChatFullscreen ? 'text-[11px]' : 'text-sm'}`}>منظور شما این است؟</div>
                          <div className={`font-bold text-emerald-700 ${isChatFullscreen ? 'text-[9px]' : 'text-[10px] mt-1'}`}>اگر درست است تأیید کن؛ اگر نه، اصلاحش را همین پایین در چت بنویس.</div>
                        </div>

                        <div className={`space-y-1.5 overflow-y-auto pr-1 scrollbar-thin ${isChatFullscreen ? 'max-h-28' : 'max-h-[255px]'}`}>
                          {chatProposedRequests.map((request, index) => (
                            <div key={request.id} className={`rounded-2xl border border-slate-200 bg-slate-50/70 ${isChatFullscreen ? 'p-2 text-[11px] space-y-1' : 'p-3 text-xs space-y-2'}`}>
                              <div className="flex items-start justify-between gap-2">
                                <span className={`font-black text-slate-800 ${isChatFullscreen ? 'leading-5' : 'leading-6'}`}>{getRequestSummaryText(request)}</span>
                                <span className={`shrink-0 rounded-full bg-white border border-slate-200 font-mono text-slate-500 ${isChatFullscreen ? 'px-1.5 py-px text-[9px]' : 'px-2 py-0.5 text-[10px]'}`}>#{index + 1}</span>
                              </div>
                              {request.description && <p className={`font-bold text-slate-500 ${isChatFullscreen ? 'text-[9px] leading-4' : 'text-[10px] leading-5'}`}>{request.description}</p>}
                              <div className="flex flex-wrap gap-1.5 items-center">
                                {request.isEssential && <span className="rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[9px] font-black text-red-700">ضروری</span>}
                                {(role === 'admin' || role === 'headnurse') && request.offHardness === 'hard' && <span className="rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[9px] font-black text-rose-700">Hard OFF</span>}
                                {(role === 'admin' || role === 'headnurse') && request.offHardness === 'soft' && <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[9px] font-black text-amber-700">Soft OFF</span>}
                                {/* دکمه‌های ویرایش و حذف: به کاربر اجازه می‌دهند بدون کنسل کل چت، آیتم را اصلاح کنند */}
                                <button
                                  type="button"
                                  onClick={() => openChatItemEditor(index)}
                                  title="ویرایش این آیتم روی تقویم"
                                  className={`shrink-0 rounded-full bg-white border border-slate-200 text-sky-600 hover:bg-sky-50 hover:border-sky-300 transition-colors cursor-pointer flex items-center gap-1 ${isChatFullscreen ? 'px-1.5 py-px text-[9px]' : 'px-2 py-0.5 text-[10px]'}`}
                                >
                                  <Edit className={isChatFullscreen ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                                  ویرایش
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeChatProposedItem(index)}
                                  title="حذف این آیتم"
                                  className={`shrink-0 rounded-full bg-white border border-slate-200 text-rose-500 hover:bg-rose-50 hover:border-rose-300 transition-colors cursor-pointer flex items-center gap-1 ${isChatFullscreen ? 'px-1.5 py-px text-[9px]' : 'px-2 py-0.5 text-[10px]'}`}
                                >
                                  <Trash2 className={isChatFullscreen ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
                                  حذف
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        <div className={`grid grid-cols-2 ${isChatFullscreen ? 'gap-1.5' : 'gap-2 pt-2'}`}>
                          <button
                            type="button"
                            onClick={() => {
                              requestChatInputRef.current?.focus();
                            }}
                            className={`rounded-2xl border border-slate-200 bg-white font-black text-slate-600 hover:bg-slate-50 transition-all cursor-pointer ${isChatFullscreen ? 'px-3 py-2 text-[10px]' : 'px-3 py-3 text-xs'}`}
                          >
                            اصلاح در چت
                          </button>
                          <button
                            type="button"
                            onClick={handleConfirmChatRequests}
                            className={`rounded-2xl bg-emerald-600 font-black text-white shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all cursor-pointer ${isChatFullscreen ? 'px-3 py-2 text-[10px]' : 'px-3 py-3 text-xs'}`}
                          >
                            تأیید و ثبت نهایی
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className={`border border-dashed border-slate-250 bg-slate-50 text-center font-bold text-slate-400 ${isChatFullscreen ? 'rounded-2xl p-2.5 text-[10px] leading-5' : 'rounded-3xl p-5 text-xs leading-6'}`}>
                        هنوز درخواست آماده ثبت نداریم. پیام بده؛ اگر کامل و روشن باشد، خلاصه ساختاری اینجا می‌آید.
                      </div>
                    )}
                    </div>
                  </div>
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
                                  {/* نوع آف (سخت/نرم) فقط برای سرپرستار و مدیر؛ پرسنل فقط «آف» می‌بیند */}
                                  {r.requestType === 'OFF' && (role === 'admin' || role === 'headnurse') ? (
                                    r.offHardness === 'hard'
                                      ? <span className="bg-red-50 text-red-700 border border-red-200 font-black px-2 py-0.5 rounded text-xs">🔴 آف سخت (Hard OFF)</span>
                                      : r.offHardness === 'soft'
                                        ? <span className="bg-amber-50 text-amber-700 border border-amber-200 font-black px-2 py-0.5 rounded text-xs">🟡 آف نرم (Soft OFF)</span>
                                        : <span className="bg-red-50 text-red-700 border border-red-200 font-bold px-2 py-0.5 rounded text-xs">آف قطعی (OFF)</span>
                                  ) : r.requestType === 'OFF' ? (
                                    <span className="bg-slate-100 text-slate-700 border border-slate-200 font-bold px-2 py-0.5 rounded text-xs">درخواست آف</span>
                                  ) : null}
                                  {r.requestType === 'leave' && <span className="bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded text-xs">درخواست مرخصی</span>}
                                  {r.requestType === 'pattern' && <span className="bg-violet-50 text-violet-700 border border-violet-100 font-bold px-2 py-0.5 rounded text-xs">الگوی شیفت</span>}
                                </td>
                                <td className="px-6 py-3.5 font-semibold text-slate-700">
                                  {r.requestType === 'pattern' ? (
                                    <span className="text-violet-700 font-bold">{r.patternSteps?.join(' / ') || 'الگوی سفارشی'}</span>
                                  ) : r.requestType === 'avoid_shift' ? (
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
                                  {/* ویرایش نامحدود درخواست تا پیش از اتمام مهلت */}
                                  <button
                                    onClick={() => handleOpenRequestEditor(r)}
                                    disabled={role === 'personnel' && requestsLockedMonths.includes(`${currentYear}_${currentMonth}`)}
                                    className="text-sky-600 hover:text-sky-800 disabled:text-slate-300 disabled:cursor-not-allowed p-1.5 rounded-lg hover:bg-sky-50 transition-colors cursor-pointer"
                                    title="ویرایش درخواست روی تقویم"
                                    id={`btn-edit-req-${r.id}`}
                                  >
                                    <Edit className="w-4 h-4" />
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
                  <button onClick={() => { exportToExcel(); handlePrint(null); }} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl flex items-center gap-1.5 cursor-pointer">
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

              {/* لاگ‌ها و اتفاقات — فقط مدیر و سرپرستار؛ در پنل پرسنل نمایش داده نمی‌شود */}
              {role !== 'personnel' && (
                <EventLogPanel
                  events={eventLogs}
                  monthLabel={`${JALALI_MONTH_NAMES[currentMonth - 1]} ${currentYear}`}
                />
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

          {activeTab === 'settings' && (role === 'admin' || role === 'headnurse') && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-6">
                <h3 className="text-lg font-black text-slate-900 border-b pb-3 border-slate-100">ساعات موظفی پایه و پیکربندی بر اساس قوانین</h3>

                <form onSubmit={handleSaveSettings} className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">موظفی کادر رسمی (ساعت)</label>
                      <output
                        dir="ltr"
                        title="این مقدار به‌صورت خودکار و پویا از روی تنظیمات تقویم محاسبه می‌شود"
                        className="block w-full text-sm font-extrabold bg-slate-100 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-700 select-none cursor-not-allowed text-center"
                      >
                        {autoDutyHours.official}
                      </output>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">موظفی قراردادی (ساعت)</label>
                      <output
                        dir="ltr"
                        title="این مقدار به‌صورت خودکار و پویا از روی تنظیمات تقویم محاسبه می‌شود"
                        className="block w-full text-sm font-extrabold bg-slate-100 border border-slate-200 rounded-xl px-3 py-2.5 text-slate-700 select-none cursor-not-allowed text-center"
                      >
                        {autoDutyHours.contract}
                      </output>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">موظفی طرح و وظیفه (ساعت)</label>
                      <input
                        type="number"
                        value={settings.dutyHours.conscript}
                        onChange={(e) => setSettings({
                          ...settings,
                          dutyHours: { ...settings.dutyHours, conscript: parseNumberInput(e.target.value) }
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
                          dutyHours: { ...settings.dutyHours, overtime: parseNumberInput(e.target.value) }
                        })}
                        className="w-full text-sm font-extrabold bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <p className="text-[10px] font-bold leading-5 text-slate-400 bg-slate-50 border border-slate-100 rounded-xl px-3 py-2">
                    مقادیر موظفی کادر رسمی و قراردادی فقط خواندنی است و به‌صورت کاملاً پویا از روی تقویم رسمی، تعطیلات و تنظیمات بخش تقویم (روز آغاز هفته) با ماژول محاسبه ساعت موظفی ماهانه تعیین می‌شود؛ برای تغییر آن‌ها کافی است تقویم یا تعطیلات ماه را اصلاح کنید.
                  </p>

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
                                weekday: { ...settings.demand.weekday, morningNurse: parseNumberInput(e.target.value) }
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
                                weekday: { ...settings.demand.weekday, afternoonNurse: parseNumberInput(e.target.value) }
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
                                weekday: { ...settings.demand.weekday, nightNurse: parseNumberInput(e.target.value) }
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
                                weekday: { ...settings.demand.weekday, morningAssistant: parseNumberInput(e.target.value) }
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
                                weekday: { ...settings.demand.weekday, afternoonAssistant: parseNumberInput(e.target.value) }
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
                                weekday: { ...settings.demand.weekday, nightAssistant: parseNumberInput(e.target.value) }
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
                                holiday: { ...settings.demand.holiday, morningNurse: parseNumberInput(e.target.value) }
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
                                holiday: { ...settings.demand.holiday, afternoonNurse: parseNumberInput(e.target.value) }
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
                                holiday: { ...settings.demand.holiday, nightNurse: parseNumberInput(e.target.value) }
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
                                holiday: { ...settings.demand.holiday, morningAssistant: parseNumberInput(e.target.value) }
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
                                holiday: { ...settings.demand.holiday, afternoonAssistant: parseNumberInput(e.target.value) }
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
                                holiday: { ...settings.demand.holiday, nightAssistant: parseNumberInput(e.target.value) }
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

              {/* «تعریف تقویم و مناسبت‌های تعطیل انتخابی» به تب «مدیریت تقویم و تعطیلات» منتقل شد. */}
              <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col justify-between gap-4">
                <div>
                  <h3 className="text-lg font-black text-slate-900 border-b pb-3 border-slate-100 flex items-center gap-2">
                    <CalendarIcon className="w-5 h-5 text-emerald-600" /> تعریف تقویم و مناسبت‌های تعطیل انتخابی
                  </h3>
                  <p className="text-xs font-bold leading-6 text-slate-500 mt-3">
                    این بخش به تب «مدیریت تقویم و تعطیلات» منتقل شده است تا همه‌ی تنظیمات تقویم، تعطیلات رسمی کشور،
                    مناسبت‌های تعطیل انتخابی بخش و محاسبه ساعت موظفی در یک صفحه مدیریت شوند.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('calendar')}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs py-3 rounded-xl shadow-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
                  id="btn-go-to-calendar-tab"
                >
                  <CalendarIcon className="w-4 h-4" /> رفتن به مدیریت تقویم و تعطیلات
                </button>
              </div>

              <div className="lg:col-span-2 bg-white border border-rose-200 rounded-3xl p-6 shadow-sm space-y-5">
                <div>
                  <h3 className="text-lg font-black text-rose-700 border-b pb-3 border-rose-100 flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5" /> مدیریت و امنیت بخش (عملیات حساس)
                  </h3>
                  <p className="text-xs text-slate-500 mt-2 font-bold leading-6">
                    این بخش مخصوص مدیریت بخش است و عملیات آن فقط با احراز هویت مجدد (کد ملی و رمز عبور) و پس از بررسی سخت‌گیرانه سمت سرور انجام می‌شود.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 flex flex-col justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                        <UserCheck className="w-4 h-4 text-indigo-500" /> انتقال مدیریت (جایگزینی سرپرستار)
                      </h4>
                      <p className="text-[11px] font-bold leading-6 text-slate-500 mt-2">
                        جایگزینی سرپرستار/مدیر فعلی با مدیر جدید تنها با تأیید امنیتی سرپرستار قبلی انجام می‌شود؛ پس از انتقال، حساب قبلی غیرفعال می‌گردد.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setTransferPrevNationalId(role === 'headnurse' ? (authenticatedUser?.nationalId || '') : '');
                        setTransferPrevPassword('');
                        setTransferNewNationalId('');
                        setTransferNewFirstName('');
                        setTransferNewLastName('');
                        setShowTransferDeptModal(true);
                      }}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs py-3 rounded-xl transition-all cursor-pointer shadow-md"
                      id="btn-open-transfer-dept"
                    >
                      شروع انتقال امن مدیریت بخش
                    </button>
                  </div>

                  <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-4 flex flex-col justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-black text-rose-700 flex items-center gap-2">
                        <Trash2 className="w-4 h-4" /> حذف دائمی بخش
                      </h4>
                      <p className="text-[11px] font-bold leading-6 text-slate-500 mt-2">
                        تمام داده‌های بخش شامل پرسنل، شیفت‌ها، درخواست‌ها، تنظیمات و تمام حساب‌های کاربری مرتبط به‌صورت کامل و غیرقابل‌بازگشت حذف می‌شود.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleteDeptNationalId('');
                        setDeleteDeptPassword('');
                        setShowDeleteDeptModal(true);
                      }}
                      className="w-full bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-xs py-3 rounded-xl transition-all cursor-pointer shadow-md shadow-rose-200/40"
                      id="btn-open-delete-dept"
                    >
                      حذف کامل و دائمی بخش «{departments.find(d => d.id === selectedDepartmentId)?.name || ''}»
                    </button>
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
                    <span>تنظیم دستی روز آغاز ماه</span>
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] text-amber-700 group-open:hidden">خاموش</span>
                    <span className="hidden rounded-full bg-emerald-100 px-2 py-1 text-[10px] text-emerald-700 group-open:inline">روشن</span>
                  </summary>
                  <div className="border-t border-amber-200 p-4">
                    <p className="mb-4 text-[10px] font-bold leading-6 text-amber-700">فقط هنگامی استفاده کنید که اتصال تقویم آنلاین کشور با مشکل مواجه شده باشد.</p>

                    <div className="space-y-3 bg-slate-50 border border-slate-200 rounded-2xl p-5">
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
                              disabled={!canManageHolidays}
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
                              } ${canManageHolidays ? 'hover:bg-slate-50 cursor-pointer' : 'opacity-70 cursor-not-allowed'}`}
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
                  </div>
                </details>

                {/* ===== تعریف تقویم و مناسبت‌های تعطیل انتخابی (منتقل‌شده از تب تنظیمات بخش) ===== */}
                <div className="space-y-5 rounded-2xl border border-emerald-200 bg-emerald-50/30 p-5 mb-6">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-100 pb-3">
                    <div>
                      <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
                        <CalendarIcon className="w-4 h-4 text-emerald-600" /> تعریف تقویم و مناسبت‌های تعطیل انتخابی
                      </h4>
                      <p className="text-[10px] font-bold text-slate-500 mt-1 leading-6">
                        جمعه‌ها و تعطیلات رسمی کشور به‌صورت خودکار اعمال می‌شوند. در این بخش می‌توانید مناسبت تعطیل اختصاصی بخش را
                        اضافه یا یک تعطیلی رسمی را برای بخش خود به روز کاری تبدیل کنید.
                      </p>
                    </div>
                    {!canManageHolidays && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-black text-amber-700">
                        فقط سرپرستار بخش اجازه تغییر دارد
                      </span>
                    )}
                  </div>

                  {canManageHolidays && (
                    <form onSubmit={handleAddHoliday} className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-4 rounded-2xl border border-slate-200">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="input-holiday-day">روز چندم ماه؟</label>
                        <input
                          id="input-holiday-day"
                          type="number"
                          min="1"
                          max={calendarDays.length || 31}
                          value={holidayDayInput}
                          onChange={(e) => setHolidayDayInput(parseNumberInput(e.target.value))}
                          className="w-full text-xs font-extrabold bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-emerald-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1" htmlFor="input-holiday-title">عنوان مناسبت تعطیل</label>
                        <input
                          id="input-holiday-title"
                          type="text"
                          placeholder="مثلاً: عاشورای حسینی"
                          value={holidayTitleInput}
                          onChange={(e) => setHolidayTitleInput(e.target.value)}
                          className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-emerald-500 focus:outline-none"
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
                  )}

                  <div className="space-y-2">
                    <h5 className="font-extrabold text-slate-800 text-xs">تعطیلات ثبت‌شده {JALALI_MONTH_NAMES[currentMonth - 1]} {currentYear}:</h5>
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden text-xs bg-white">
                      {Object.keys(customHolidays).length === 0 ? (
                        <div className="p-4 text-center text-slate-400 font-bold">به‌جز جمعه‌ها، تعطیلی دیگری برای این ماه ثبت نشده است.</div>
                      ) : (
                        Object.keys(customHolidays)
                          .map(Number)
                          .sort((a, b) => a - b)
                          .map(dayNum => {
                            const source = holidaySource(officialHolidays, holidayOverrides, dayNum);
                            return (
                              <div key={dayNum} className="p-3 bg-slate-50/50 flex flex-wrap justify-between items-center gap-2 hover:bg-slate-100/50 transition-colors">
                                <span className="font-bold text-slate-800 font-mono">
                                  روز {dayNum} {JALALI_MONTH_NAMES[currentMonth - 1]}:
                                  <span className="text-rose-600 mr-2 font-sans">{customHolidays[dayNum]}</span>
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${
                                    source === 'official'
                                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  }`}>
                                    {source === 'official' ? 'تعطیل رسمی کشور' : 'انتخابی بخش'}
                                  </span>
                                  {canManageHolidays && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveHoliday(dayNum)}
                                      className="text-red-500 hover:text-red-700 bg-white p-1 px-2 rounded-lg shadow-sm border border-slate-200 cursor-pointer font-bold"
                                      id={`btn-remove-holiday-${dayNum}`}
                                      title="این روز به روز کاری تبدیل می‌شود"
                                    >
                                      حذف
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })
                      )}
                    </div>
                  </div>

                  <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                    <div>
                      <h5 className="text-xs font-black text-slate-800 font-sans">تقویم تعاملی {JALALI_MONTH_NAMES[currentMonth - 1]} (کلیک جهت تعیین تعطیلی):</h5>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {canManageHolidays
                          ? 'بر روی هر یک از خانه‌های تقویم زیر کلیک کنید تا وضعیت آن روز بین «کاری» و «تعطیل» سوئیچ شود. جمعه‌ها همیشه تعطیل هستند.'
                          : 'وضعیت تعطیلی روزهای این ماه؛ تغییر آن فقط توسط سرپرستار بخش امکان‌پذیر است.'}
                      </p>
                    </div>

                    <div className="grid grid-cols-7 gap-1 text-center font-extrabold text-[9px]">
                      {WEEKDAYS.map(w => (
                        <div key={`grid-head-${w}`} className="py-1 text-slate-400 font-extrabold text-[9px]">{w[0]}</div>
                      ))}

                      {Array.from({ length: calendarDays[0]?.dayOfWeek || 0 }).map((_, i) => (
                        <div key={`pad-${i}`} className="p-2 bg-slate-100/20 rounded-lg text-transparent text-[10px]">-</div>
                      ))}

                      {calendarDays.map(d => {
                        const isFriday = d.dayOfWeek === 6;
                        const isHoliday = isFriday || isEffectiveHoliday(officialHolidays, holidayOverrides, d.day);
                        const source = holidaySource(officialHolidays, holidayOverrides, d.day);
                        const title = isFriday
                          ? 'جمعه؛ تعطیل هفتگی (غیرقابل تغییر)'
                          : (customHolidays[d.day] || (calendarOccasions[d.day] || []).join('، ') || 'روز کاری');

                        return (
                          <button
                            type="button"
                            key={`day-btn-${d.day}`}
                            disabled={isFriday || !canManageHolidays}
                            title={title}
                            aria-pressed={isHoliday}
                            onClick={() => handleToggleHoliday(d.day)}
                            className={`p-1 rounded-lg border text-[10px] font-black transition-all flex flex-col items-center justify-center min-h-[42px] ${
                              isHoliday
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-white text-slate-700 border-slate-200'
                            } ${
                              isFriday || !canManageHolidays
                                ? 'cursor-not-allowed opacity-80'
                                : `cursor-pointer ${isHoliday ? 'hover:bg-rose-100/60 hover:border-rose-300' : 'hover:bg-slate-100 hover:border-slate-300'}`
                            }`}
                          >
                            <span className="font-mono text-xs">{d.day}</span>
                            <span className="text-[7px] leading-none opacity-80 mt-0.5">
                              {isFriday ? 'جمعه' : source === 'official' ? 'رسمی' : source === 'custom' ? 'تعطیل' : 'کاری'}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap gap-3 pt-1 text-[9px] font-bold text-slate-500">
                      <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-rose-100 ring-1 ring-rose-300" /> تعطیل</span>
                      <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-white ring-1 ring-slate-300" /> روز کاری</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                      کنترل تیکی روزهای هفته و تعطیلات تا آخر ماه {JALALI_MONTH_NAMES[currentMonth - 1]} ({calendarDays.length} روز)
                    </h4>
                    <p className="text-[10px] text-slate-400 mt-1">
                      برای تغییر وضعیت هر روز بین «روز کاری عادی» و «روز تعطیل»، گزینه‌ی مربوطه را تیک بزنید. جمعه‌ها بر اساس قوانین به صورت دائم تعطیل هستند.
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
                        const isFriday = d.dayOfWeek === 6;
                        const isCustomHoliday = isEffectiveHoliday(officialHolidays, holidayOverrides, d.day);
                        const isChecked = isFriday || isCustomHoliday;
                        const source = holidaySource(officialHolidays, holidayOverrides, d.day);

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
                              <label className={`flex items-center gap-1.5 select-none ${isFriday || !canManageHolidays ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  disabled={isFriday || !canManageHolidays}
                                  onChange={() => handleToggleHoliday(d.day)}
                                  className="w-4 h-4 accent-emerald-600 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                                  id={`check-holiday-${d.day}`}
                                />
                                <span className={`text-[10px] ${isChecked ? 'text-rose-600 font-extrabold' : 'text-slate-400 font-normal'}`}>
                                  {isFriday ? 'جمعه' : source === 'official' ? 'تعطیل رسمی' : source === 'custom' ? 'تعطیل انتخابی' : 'روز کاری'}
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
                                  disabled={!isCustomHoliday || !canManageHolidays}
                                  defaultValue={holidayOverrideTitle(officialHolidays, holidayOverrides, d.day)}
                                  key={`holiday-title-${d.day}-${holidayOverrideTitle(officialHolidays, holidayOverrides, d.day)}`}
                                  onBlur={(e) => {
                                    const val = e.target.value.trim() || DEFAULT_CUSTOM_HOLIDAY_TITLE;
                                    if (val === holidayOverrideTitle(officialHolidays, holidayOverrides, d.day)) return;
                                    handleRenameHoliday(d.day, val);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.currentTarget.blur();
                                  }}
                                  className={`w-full text-[10px] px-2.5 py-1 rounded-lg border focus:outline-none transition-all ${
                                    isCustomHoliday && canManageHolidays
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
                            const val = parseNumberInput(e.target.value);
                            const updated = {
                              ...settings,
                              dutyHours: {
                                ...settings.dutyHours,
                                conscript: val
                              }
                            };
                            setSettings(updated);
                            saveState(personnel, requests, normalizeSettings(updated), customHolidays, { mode: 'full_resolve' });
                          }}
                          className="w-full text-xs font-black bg-white border border-slate-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl px-2.5 py-2 text-center text-slate-800 font-mono focus:outline-none transition-all"
                        />
                      </div>
                    </div>

                    {canManageHolidays && (
                      <div className="pt-4 border-t border-slate-200 text-center">
                        <button
                          type="button"
                          onClick={() => handleApproveMonthlyDutyHours(z_calc, contract_calc)}
                          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs px-4 py-3 rounded-xl transition-all shadow-sm cursor-pointer border border-indigo-700 font-sans"
                          id="btn-approve-monthly-duty-hours"
                        >
                          تصویب نهایی ساعت موظفی مطابق تقویم برای ماه در حال نمایش
                        </button>
                        {monthlyDutyHours && (
                          <div className="mt-2 text-[10px] font-bold text-indigo-700">
                            ساعت موظفی این ماه تعیین مقطعی شده است: (رسمی {monthlyDutyHours.official}، قراردادی {monthlyDutyHours.contract}، طرح {monthlyDutyHours.conscript}، اضافه‌کار {monthlyDutyHours.overtime})
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

            </div>
          )}

          {activeTab === 'profile' && authenticatedUser && (
            <ProfileSection user={authenticatedUser} />
          )}

          <div className="hidden print:block w-full bg-white text-slate-900" id="print-schedule-sheet">
            <PrintScheduleSheet
              personnel={personnel}
              schedule={displayedSchedule || schedule}
              reports={reports}
              calendarDays={calendarDays}
              year={currentYear}
              month={currentMonth}
              departmentName={departments.find(d => d.id === selectedDepartmentId)?.name}
              dutyHours={effectiveDutyHours}
              jobGroupFilter={printJobGroup}
            />
          </div>

        </div>
      </main>


      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        label={deleteTarget?.label || ''}
        onConfirm={() => {
          if (deleteTarget) {
            if (deleteTarget.type === 'personnel') {
              handleDeletePersonnel(deleteTarget.id);
            } else {
              handleDeleteRequest(deleteTarget.id);
            }
          }
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      {showDeleteDeptModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-[70] p-4 print:hidden animate-fade-in" id="delete-dept-modal" dir="rtl">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full border border-rose-200 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 border-b border-rose-100 pb-3">
              <span className="w-11 h-11 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </span>
              <div>
                <h3 className="font-black text-slate-900 text-sm">حذف دائمی بخش «{departments.find(d => d.id === selectedDepartmentId)?.name || ''}»</h3>
                <p className="text-[10px] font-bold text-rose-600 mt-1">این عملیات قطعی، فوری و کاملاً غیرقابل بازگشت است.</p>
              </div>
            </div>

            <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-[11px] font-bold leading-6 text-rose-700">
              با این کار تمام اسناد و سوابق بخش (پرسنل، درخواست‌ها، تنظیمات، تعطیلات و کل شیفت‌های ماهانه) و تمام حساب‌های کاربری مرتبط با این بخش (از جمله حساب سرپرستار و پرسنل) برای همیشه از پایگاه‌داده و فضای ذخیره‌سازی پاک می‌شود.
            </div>

            <form onSubmit={handleDeleteDepartment} className="space-y-3">
              <p className="text-[11px] font-black text-slate-700">
                برای تأیید، احراز هویت مجدد کنید — کد ملی و رمز عبور <span className="text-rose-600">حساب خودتان</span> را وارد نمایید:
              </p>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">کد ملی مدیر فعلی</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={10}
                  autoComplete="username"
                  value={deleteDeptNationalId}
                  onChange={(e) => setDeleteDeptNationalId(e.target.value)}
                  className="w-full text-xs font-black bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-rose-500 focus:outline-none text-center font-mono"
                  placeholder="کد ملی ۱۰ رقمی"
                  id="input-delete-dept-national-id"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">رمز عبور</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={deleteDeptPassword}
                  onChange={(e) => setDeleteDeptPassword(e.target.value)}
                  className="w-full text-xs font-black bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 focus:border-rose-500 focus:outline-none text-center font-mono"
                  placeholder="رمز عبور حساب شما"
                  id="input-delete-dept-password"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteDeptModal(false)}
                  disabled={isDeletingDept}
                  className="w-full bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 font-extrabold text-xs py-2.5 rounded-xl transition-all cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isDeletingDept}
                  className="w-full bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-extrabold text-xs py-2.5 rounded-xl transition-all cursor-pointer shadow-md shadow-rose-200/20"
                  id="btn-confirm-delete-dept"
                >
                  {isDeletingDept ? 'در حال حذف دائمی...' : 'تأیید و حذف کامل بخش'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTransferDeptModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-[70] p-4 print:hidden animate-fade-in" id="transfer-dept-modal" dir="rtl">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full border border-indigo-200 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-3 border-b border-indigo-100 pb-3">
              <span className="w-11 h-11 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shrink-0">
                <UserCheck className="w-5 h-5" />
              </span>
              <div>
                <h3 className="font-black text-slate-900 text-sm">انتقال امن مدیریت بخش «{departments.find(d => d.id === selectedDepartmentId)?.name || ''}»</h3>
                <p className="text-[10px] font-bold text-indigo-600 mt-1">جایگزینی سرپرستار فعلی فقط با تأیید امنیتی خودِ او انجام می‌شود.</p>
              </div>
            </div>

            <div className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 text-[11px] font-bold leading-6 text-indigo-700">
              پس از انتقال، حساب سرپرستار جدید با رمز اولیه ۱۲۳۴ ساخته می‌شود (اجبار به تغییر رمز در اولین ورود) و حساب سرپرستار قبلی به‌همراه تمام نشست‌هایش غیرفعال می‌گردد. تمام داده‌ها و پرسنل بخش دست‌نخورده باقی می‌مانند.
            </div>

            <form onSubmit={handleTransferHeadNurse} className="space-y-3">
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-3">
                <p className="text-[11px] font-black text-slate-700">مشخصات سرپرستار جدید:</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">نام</label>
                    <input
                      type="text"
                      value={transferNewFirstName}
                      onChange={(e) => setTransferNewFirstName(e.target.value)}
                      className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                      id="input-transfer-new-fname"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">نام خانوادگی</label>
                    <input
                      type="text"
                      value={transferNewLastName}
                      onChange={(e) => setTransferNewLastName(e.target.value)}
                      className="w-full text-xs font-bold bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none"
                      id="input-transfer-new-lname"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">کد ملی سرپرستار جدید</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={10}
                    value={transferNewNationalId}
                    onChange={(e) => setTransferNewNationalId(e.target.value)}
                    className="w-full text-xs font-black bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-indigo-500 focus:outline-none text-center font-mono"
                    placeholder="کد ملی ۱۰ رقمی"
                    id="input-transfer-new-national-id"
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/50 p-3">
                <p className="text-[11px] font-black text-amber-800 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4" /> تأیید امنیتی سرپرستار قبلی (الزامی):
                </p>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">کد ملی سرپرستار فعلی</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={10}
                    autoComplete="username"
                    value={transferPrevNationalId}
                    onChange={(e) => setTransferPrevNationalId(e.target.value)}
                    className="w-full text-xs font-black bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-amber-500 focus:outline-none text-center font-mono"
                    placeholder="کد ملی ۱۰ رقمی"
                    id="input-transfer-prev-national-id"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">رمز عبور سرپرستار فعلی</label>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={transferPrevPassword}
                    onChange={(e) => setTransferPrevPassword(e.target.value)}
                    className="w-full text-xs font-black bg-white border border-slate-300 rounded-xl px-3 py-2.5 focus:border-amber-500 focus:outline-none text-center font-mono"
                    placeholder="رمز عبور سرپرستار فعلی"
                    id="input-transfer-prev-password"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowTransferDeptModal(false)}
                  disabled={isTransferringDept}
                  className="w-full bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 font-extrabold text-xs py-2.5 rounded-xl transition-all cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  disabled={isTransferringDept}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-extrabold text-xs py-2.5 rounded-xl transition-all cursor-pointer shadow-md"
                  id="btn-confirm-transfer-dept"
                >
                  {isTransferringDept ? 'در حال انتقال...' : 'تأیید و انتقال مدیریت'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <AddPersonnelModal
        isOpen={showAddPersonnelModal}
        onClose={personnelForm.closeModal}
        editingPersonnel={editingPersonnel}
        formFirstName={formFirstName}
        formLastName={formLastName}
        formPersonalCode={formPersonalCode}
        formNationalId={formNationalId}
        isLoadingNationalId={isLoadingPersonnelNationalId}
        formJobGroup={formJobGroup}
        formPosition={formPosition}
        formEmploymentType={formEmploymentType}
        formExperienceYears={formExperienceYears}
        formActive={formActive}
        formCanBeShiftLeader={formCanBeShiftLeader}
        setFormFirstName={setFormFirstName}
        setFormLastName={setFormLastName}
        setFormPersonalCode={setFormPersonalCode}
        setFormNationalId={setFormNationalId}
        setFormJobGroup={setFormJobGroup}
        setFormPosition={setFormPosition}
        setFormEmploymentType={setFormEmploymentType}
        setFormExperienceYears={setFormExperienceYears}
        setFormActive={setFormActive}
        setFormCanBeShiftLeader={setFormCanBeShiftLeader}
        formWorkRoutine={formWorkRoutine}
        setFormWorkRoutine={setFormWorkRoutine}
        onSubmit={handleSavePersonnel}
        parseNumberInput={parseNumberInput}
      />

      <AlertCenter
        isOpen={showAlertCenter && role === 'headnurse' && activeTab === 'schedule'}
        onClose={() => setShowAlertCenter(false)}
        allAlerts={allAlertsForDialog}
        visibleWarningsCount={getVisibleWarnings().length}
        dismissedAlertWarnings={dismissedAlertWarnings}
        contextLabel={alertCenterContextLabel}
        contextDescription={alertCenterContextDescription}
        expandedSections={expandedAlertSections}
        onToggleSection={(section) => setExpandedAlertSections(prev => ({...prev, [section]: !prev[section]}))}
        onDismissAlert={handleDismissAlert}
        onAlertClick={handleAlertClick}
        onDayAlertClick={handleDayAlertClick}
        extractWarningDay={extractWarningDay}
      />

      {/* ====== نوار شناور بازگشت به موقعیت هشدار ====== */}
      {!showAlertCenter && (alertReturnAvailable || alertReturnToast) && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[70] print:hidden animate-fade-in" dir="rtl">
          <div className="flex items-center gap-3 bg-white/95 backdrop-blur border border-slate-200 shadow-2xl rounded-2xl px-4 py-2.5">
            <span className="text-[11px] font-bold text-slate-700">
              {alertReturnToast
                ? alertReturnToast.message
                : 'پس از رفع هشدار، به موقعیت قبلی بازگردانده می‌شوید.'}
            </span>

            {alertReturnAvailable && !alertReturnToast && (
              <button
                onClick={() => returnToAlertPosition({ reopenAlertCenter: true })}
                className="text-[10px] font-black px-3 py-1.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-all cursor-pointer"
              >
                بازگشت به هشدارها
              </button>
            )}

            {alertReturnToast?.canReopen && (
              <button
                onClick={() => { setAlertReturnToast(null); setShowAlertCenter(true); }}
                className="text-[10px] font-black px-3 py-1.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-all cursor-pointer"
              >
                بازکردن پنجره هشدارها
              </button>
            )}

            <button
              onClick={() => { setAlertReturnToast(null); cancelAlertReturn(); }}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
              title="بستن"
            >
              <span className="text-xs font-black">✕</span>
            </button>
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
                      // ====== ریست offHardness هنگام تغییر نوع درخواست ======
                      if (val !== 'OFF') {
                        setReqOffHardness(undefined);
                      } else {
                        setReqOffHardness('hard'); // پیش‌فرض: Hard OFF
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

              {/* ====== انتخاب نوع آف: Hard OFF / Soft OFF ====== */}
              {(role === 'admin' || role === 'headnurse') && reqType === 'OFF' && (
                <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-3 space-y-2">
                  <div className="text-xs font-black text-amber-800">
                    🔒 نوع آف قطعی: سرپرستار تعیین می‌کند که آف سخت (Hard OFF) یا نرم (Soft OFF) باشد.
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setReqOffHardness('hard')}
                      className={`flex-1 text-xs font-black px-4 py-2.5 rounded-xl border-2 transition-all cursor-pointer ${
                        reqOffHardness === 'hard'
                          ? 'bg-red-500 text-white border-red-600 shadow-md'
                          : 'bg-white text-red-600 border-red-200 hover:bg-red-50'
                      }`}
                    >
                      🔴 آف سخت (Hard OFF)
                      <div className={`text-[10px] mt-1 ${reqOffHardness === 'hard' ? 'text-white/80' : 'text-red-400'}`}>
                        Solver حق نقض ندارد — قطعی و غیرقابل تغییر
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setReqOffHardness('soft')}
                      className={`flex-1 text-xs font-black px-4 py-2.5 rounded-xl border-2 transition-all cursor-pointer ${
                        reqOffHardness === 'soft'
                          ? 'bg-amber-500 text-white border-amber-600 shadow-md'
                          : 'bg-white text-amber-600 border-amber-200 hover:bg-amber-50'
                      }`}
                    >
                      🟡 آف نرم (Soft OFF)
                      <div className={`text-[10px] mt-1 ${reqOffHardness === 'soft' ? 'text-white/80' : 'text-amber-400'}`}>
                        Solver می‌تواند در بن‌بست نقض کند — ترجیحی ولی قابل تغییر
                      </div>
                    </button>
                  </div>
                  {!reqOffHardness && (
                    <div className="text-[10px] font-bold text-amber-600 bg-amber-100 px-3 py-1.5 rounded-lg">
                      ⚠️ لطفاً نوع آف را انتخاب کنید. بدون انتخاب، آف به‌صورت پیش‌فرض سخت (Hard OFF) تلقی می‌شود.
                    </div>
                  )}
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

      {/* ====== ویرایشگر تقویمی درخواست ثبت‌شده ====== */}
      {requestEditTarget && (() => {
        const editPerson = personnel.find(item => item.id === requestEditTarget.personnelId);
        const selectedCount = Object.keys(requestEditDays).length;
        return (
          <div className="fixed inset-0 z-[220] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 print:hidden">
            <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-[2rem] bg-white shadow-2xl scrollbar-thin">
              <div className="sticky top-0 z-10 bg-gradient-to-l from-sky-600 via-indigo-600 to-violet-600 text-white px-5 py-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-base font-black">ویرایش درخواست روی تقویم</h4>
                  <p className="text-[11px] font-bold text-indigo-100 mt-1 truncate">
                    {editPerson ? `${editPerson.firstName} ${editPerson.lastName}` : 'پرسنل'} — {JALALI_MONTH_NAMES[currentMonth - 1]} {currentYear}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCloseRequestEditor}
                  className="shrink-0 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 px-3 py-1.5 text-[11px] font-black transition-all cursor-pointer"
                >
                  بستن
                </button>
              </div>

              <div className="p-4 sm:p-5 space-y-4">
                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-[11px] font-bold text-sky-800 leading-6">
                  روی هر روز کلیک کن تا زیرشاخهٔ انواع شیفت (M / E / N / ME / EN / MN / MEN و همچنین آف و مرخصی) همان‌جا باز شود.
                  با انتخاب نوع شیفت، آن روز رنگی می‌شود. برای حذف یک روز، دوباره روی همان نوع انتخاب‌شده کلیک کن.
                  ویرایش تا پیش از اتمام مهلت، نامحدود قابل تکرار است.
                </div>

                <div className="grid grid-cols-7 gap-1.5 rounded-2xl border border-slate-200 bg-white p-2 shadow-inner">
                  {WEEKDAYS.map((weekday, index) => (
                    <div key={`edit-weekday-${weekday}`} className={`rounded-lg py-1 text-center text-[8px] font-black ${index === 6 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{weekday[0]}</div>
                  ))}
                  {Array.from({ length: calendarDays[0]?.dayOfWeek || 0 }).map((_, index) => <span key={`edit-empty-${index}`} />)}
                  {calendarDays.map(dayInfo => {
                    const assigned = requestEditDays[dayInfo.day];
                    const isActive = requestEditActiveDay === dayInfo.day;
                    const meta = EDITABLE_SHIFT_CODES.find(item => item.code === assigned);
                    return (
                      <React.Fragment key={`edit-day-${dayInfo.day}`}>
                        <button
                          type="button"
                          onClick={() => setRequestEditActiveDay(prev => (prev === dayInfo.day ? null : dayInfo.day))}
                          aria-expanded={isActive}
                          className={`relative min-h-14 rounded-xl border px-1 py-1.5 text-[11px] font-black transition-all flex flex-col items-center justify-center cursor-pointer ${
                            isActive
                              ? 'bg-indigo-600 text-white border-indigo-700 shadow-md scale-105'
                              : assigned
                                ? `${meta?.className || 'bg-indigo-100 text-indigo-800 border-indigo-300'} shadow-xs`
                                : dayInfo.isHoliday
                                  ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50'
                          }`}
                          title={dayInfo.holidayTitle || (calendarOccasions[dayInfo.day] || []).join('، ')}
                        >
                          <span className="font-mono text-xs font-extrabold">{dayInfo.day}</span>
                          <span className="text-[8px] opacity-80">{assigned || WEEKDAYS[dayInfo.dayOfWeek][0]}</span>
                        </button>

                        {/* زیرشاخهٔ انواع شیفت، دقیقاً زیر همان ردیف تقویم */}
                        {isActive && (
                          <div className="col-span-7 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3 space-y-2 animate-fadeIn">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-black text-slate-700">
                                نوع شیفت روز {dayInfo.day} ({WEEKDAYS[dayInfo.dayOfWeek]})
                              </span>
                              {assigned && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRequestEditDays(prev => {
                                      const next = { ...prev };
                                      delete next[dayInfo.day];
                                      return next;
                                    });
                                    setRequestEditActiveDay(null);
                                  }}
                                  className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-[10px] font-black text-rose-600 hover:bg-rose-50 cursor-pointer"
                                >
                                  حذف این روز
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                              {EDITABLE_SHIFT_CODES.map(option => (
                                <button
                                  type="button"
                                  key={`edit-${dayInfo.day}-${option.code}`}
                                  onClick={() => {
                                    setRequestEditDays(prev => ({ ...prev, [dayInfo.day]: option.code }));
                                    setRequestEditActiveDay(null);
                                  }}
                                  className={`rounded-xl border px-2 py-2 text-[10px] font-black transition-all cursor-pointer ${
                                    assigned === option.code
                                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-md'
                                      : `${option.className} hover:brightness-95`
                                  }`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-bold text-slate-600">
                  <span>روزهای ویرایش‌شده: <b className="text-indigo-700 font-mono">{selectedCount}</b></span>
                  <span className="text-slate-400">در صورت نیاز، هر روز می‌تواند نوع شیفت متفاوتی داشته باشد.</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleCloseRequestEditor}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-xs font-black text-slate-600 hover:bg-slate-50 transition-all cursor-pointer"
                  >
                    انصراف
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveRequestEdit}
                    disabled={isSavingRequestEdit}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 px-4 py-3 text-xs font-black text-white shadow-lg shadow-emerald-100 transition-all cursor-pointer"
                  >
                    {isSavingRequestEdit ? (
                      <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> در حال ثبت...</>
                    ) : (
                      <><Check className="w-4 h-4" /> ثبت نهایی ویرایش</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ====== ویرایشگر تقویمی آیتم‌های کادر نتیجهٔ تحلیل (پیش از ثبت نهایی) ====== */}
      {chatEditingIndex !== null && chatProposedRequests[chatEditingIndex] && (() => {
        const editingItem = chatProposedRequests[chatEditingIndex];
        const dayList = Object.keys(chatEditingDays).map(d => Number(d)).sort((a, b) => a - b);
        return (
          <div className="fixed inset-0 z-[220] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 print:hidden">
            <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-[2rem] bg-white shadow-2xl scrollbar-thin">
              <div className="sticky top-0 z-10 bg-gradient-to-l from-violet-600 via-purple-600 to-fuchsia-600 text-white px-5 py-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-base font-black">ویرایش آیتم قبل از ثبت</h4>
                  <p className="text-[11px] font-bold text-purple-100 mt-1 truncate">
                    {editingItem.personnelId && (() => {
                      const p = personnel.find(x => x.id === editingItem.personnelId);
                      return p ? `${p.firstName} ${p.lastName} — ${JALALI_MONTH_NAMES[currentMonth - 1]} ${currentYear}` : '';
                    })()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeChatItemEditor}
                  className="shrink-0 rounded-xl bg-white/15 hover:bg-white/25 border border-white/25 px-3 py-1.5 text-[11px] font-black transition-all cursor-pointer"
                >
                  بستن
                </button>
              </div>

              <div className="p-4 sm:p-5 space-y-4">
                <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-[11px] font-bold text-violet-800 leading-6">
                  روی هر روز کلیک کن تا زیرشاخهٔ انواع شیفت (M / E / N / ME / EN / MN / MEN و همچنین آف و مرخصی) همان‌جا باز شود.
                  اگر روزها شیفت‌های متفاوتی داشته باشند، آیتم به‌طور خودکار به چند درخواست جداگانه تقسیم می‌شود.
                </div>

                <div className="grid grid-cols-7 gap-1.5 rounded-2xl border border-slate-200 bg-white p-2 shadow-inner">
                  {WEEKDAYS.map((weekday, index) => (
                    <div key={`chat-edit-weekday-${weekday}`} className={`rounded-lg py-1 text-center text-[8px] font-black ${index === 6 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'}`}>{weekday[0]}</div>
                  ))}
                  {Array.from({ length: calendarDays[0]?.dayOfWeek || 0 }).map((_, index) => <span key={`chat-edit-empty-${index}`} />)}
                  {calendarDays.map(dayInfo => {
                    const assigned = chatEditingDays[dayInfo.day];
                    const isActive = chatEditingActiveDay === dayInfo.day;
                    const meta = EDITABLE_SHIFT_CODES.find(item => item.code === assigned);
                    return (
                      <React.Fragment key={`chat-edit-day-${dayInfo.day}`}>
                        <button
                          type="button"
                          onClick={() => setChatEditingActiveDay(prev => (prev === dayInfo.day ? null : dayInfo.day))}
                          aria-expanded={isActive}
                          className={`relative min-h-14 rounded-xl border px-1 py-1.5 text-[11px] font-black transition-all flex flex-col items-center justify-center cursor-pointer ${
                            isActive
                              ? 'bg-violet-600 text-white border-violet-700 shadow-md scale-105'
                              : assigned
                                ? `${meta?.className || 'bg-violet-100 text-violet-800 border-violet-300'} shadow-xs`
                                : dayInfo.isHoliday
                                  ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-violet-300 hover:bg-violet-50'
                          }`}
                          title={dayInfo.holidayTitle || (calendarOccasions[dayInfo.day] || []).join('، ')}
                        >
                          <span className="font-mono text-xs font-extrabold">{dayInfo.day}</span>
                          <span className="text-[8px] opacity-80">{assigned || WEEKDAYS[dayInfo.dayOfWeek][0]}</span>
                        </button>

                        {isActive && (
                          <div className="col-span-7 rounded-2xl border border-violet-200 bg-violet-50/60 p-3 space-y-2 animate-fadeIn">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-black text-slate-700">
                                نوع شیفت روز {dayInfo.day} ({WEEKDAYS[dayInfo.dayOfWeek]})
                              </span>
                              {assigned && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setChatEditingDays(prev => {
                                      const next = { ...prev };
                                      delete next[dayInfo.day];
                                      return next;
                                    });
                                    setChatEditingActiveDay(null);
                                  }}
                                  className="rounded-lg border border-rose-200 bg-white px-2 py-1 text-[10px] font-black text-rose-600 hover:bg-rose-50 cursor-pointer"
                                >
                                  حذف این روز
                                </button>
                              )}
                            </div>
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                              {EDITABLE_SHIFT_CODES.map(option => (
                                <button
                                  type="button"
                                  key={`chat-edit-${dayInfo.day}-${option.code}`}
                                  onClick={() => {
                                    setChatEditingDays(prev => ({ ...prev, [dayInfo.day]: option.code }));
                                    setChatEditingActiveDay(null);
                                  }}
                                  className={`rounded-xl border px-2 py-2 text-[10px] font-black transition-all cursor-pointer ${
                                    assigned === option.code
                                      ? 'bg-violet-600 text-white border-violet-600 shadow-md'
                                      : `${option.className} hover:brightness-95`
                                  }`}
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-bold text-slate-600">
                  <span>روزهای تنظیم‌شده: <b className="text-violet-700 font-mono">{dayList.length}</b></span>
                  <span className="text-slate-400">اگر صفر شود، این آیتم از کادر حذف می‌شود.</span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={closeChatItemEditor}
                    className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-xs font-black text-slate-600 hover:bg-slate-50 transition-all cursor-pointer"
                  >
                    انصراف
                  </button>
                  <button
                    type="button"
                    onClick={saveChatItemEdit}
                    className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 px-4 py-3 text-xs font-black text-white shadow-lg shadow-emerald-100 transition-all cursor-pointer"
                  >
                    <Check className="w-4 h-4" /> اعمال ویرایش
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ====== Modal بزرگ‌نمایی تصویر پیوست‌شده در چت ====== */}
      {chatImageModal && (
        <div
          className="fixed inset-0 z-[260] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 print:hidden"
          onClick={() => setChatImageModal(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setChatImageModal(null)}
              className="absolute -top-2 -left-2 z-10 w-9 h-9 bg-white hover:bg-slate-100 text-slate-700 rounded-full flex items-center justify-center shadow-lg cursor-pointer"
              title="بستن"
            >
              <X className="w-4 h-4" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={chatImageModal.url}
              alt={chatImageModal.caption || 'تصویر ضمیمه‌شده'}
              className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl border-4 border-white object-contain bg-white"
            />
            {chatImageModal.caption && (
              <div className="mt-3 text-white/90 text-xs font-bold bg-slate-900/60 backdrop-blur px-3 py-1.5 rounded-full">
                {chatImageModal.caption}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
