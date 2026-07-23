// lib/types.ts - نسخه به‌روز‌شده با فیلدهای جدید

export type JobGroup = 'nurse' | 'assistant';

export type NursePosition = 'supervisor' | 'staff' | 'general' | 'none';

export type EmploymentType = 'official' | 'contract' | 'conscript' | 'overtime';

/**
 * برچسب روتین کاری پرسنل — تعیین‌کننده الگوی شیفت‌بندی پیش‌فرض فرد.
 *
 *   - MORNING_ONLY       : صبح کار
 *   - LONG_SHIFT         : لانگ کار (ME)
 *   - EVENING_NIGHT      : عصر شب کار (EN)
 *   - FULL_ROTATION_MEN  : صبح عصر شب کار (MEN)
 *   - ROTATING_GENERAL   : چرخشی کار عمومی (پیش‌فرض)
 */
export type RoutineTag =
  | 'MORNING_ONLY'
  | 'LONG_SHIFT'
  | 'EVENING_NIGHT'
  | 'FULL_ROTATION_MEN'
  | 'ROTATING_GENERAL';

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
  // برچسب روتین کاری (اختیاری/nullable؛ مقدار پیش‌فرض ROTATING_GENERAL است).
  routineTag?: RoutineTag | null;
  orderIndex?: number;
  username?: string;
  password?: string;
  locked?: boolean;
}

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
  // هشدارهای بحرانی (قرمز) ناشی از وتوی دستی سرپرستار که قانون ایمنی را می‌شکند.
  criticalWarnings?: string[];
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

// ====== انواع سناریو و امتیازدهی (Arena) ======

/**
 * ScenarioScore — امتیاز کیفی یک سناریوی زمان‌بندی برای مقایسه و انتخاب.
 *
 * همهٔ شاخص‌های درصدی بین ۰ تا ۱۰۰ هستند (مقدار بالاتر بهتر است).
 */
export interface ScenarioScore {
  /** پوشش شیفت‌ها (۰ تا ۱۰۰): نسبت سلول‌های پرشده به کل تقاضا. */
  coverage: number;
  /** عدالت توزیع ساعت کاری + حفظ routineTag (۰ تا ۱۰۰). */
  fairness: number;
  /** رضایت از درخواست‌ها (۰ تا ۱۰۰): درصد درخواست‌های پرسنلی که رعایت شده‌اند. */
  requestSatisfaction: number;
  /** ایمنی و قیود سخت (۰ تا ۱۰۰): قانون تجمعی ۳۲ ساعت، استراحت بعد از شب‌کار، حداقل نیرو. */
  ruleCompliance: number;
  /** ثبات و کمترین ویرایش دستی نسبت به برنامهٔ پایه (۰ تا ۱۰۰). */
  stability: number;
  /** تعداد کل هشدارها/نقص‌های باقی‌مانده در این سناریو. */
  warningCount: number;
  /** تعداد سلول‌های پرنشده (شیفت UNFILLED). */
  unfilledCount: number;
  /** امتیاز کل وزنی (۰ تا ۱۰۰) محاسبه‌شده از شاخص‌های بالا. */
  total: number;
}

/**
 * ArenaScenario — یک سناریوی جایگزین زمان‌بندی تولیدشده برای مقایسه و انتخاب.
 *
 * موتور بهینه‌سازی می‌تواند چند سناریوی متفاوت تولید کند، هرکدام را با
 * ScenarioScore ارزیابی نماید و بهترین گزینه را در اختیار کاربر قرار دهد.
 */
export interface ArenaScenario {
  /** شناسه یکتای سناریو. */
  id: string;
  /** برچسب نمایشی فارسی سناریو (مثلاً «سناریوی متعادل»). */
  label: string;
  /** تخصیص شیفت‌ها در این سناریو: { personnelId: { day: shift } }. */
  assignments: { [personnelId: string]: { [day: number]: ShiftType } };
  /** امتیاز محاسبه‌شده برای این سناریو. */
  score: ScenarioScore;
  /** هشدارهای باقی‌مانده در این سناریو. */
  warnings: string[];
  /** شکاف‌های پوششی (روز/شیفت با کمبود نیرو). */
  coverageGaps: { day: number; shift: 'M' | 'E' | 'N'; shortage: number }[];
  /** منبع یا روش تولید سناریو (مثلاً «heuristic» یا «ai»). */
  generatedBy?: string;
  /** مهر زمانی تولید سناریو (ISO 8601). */
  createdAt: string;
  /** یادداشت اختیاری توضیحی. */
  notes?: string;
}
