import {
  AppDatabaseStateSchema,
  type AppDatabaseState,
  type StorageResource,
} from './storageSchemas';

export type { AppDatabaseState } from './storageSchemas';

/**
 * لایهٔ سازگاری با دادهٔ قدیمی (Legacy Compatibility)
 * ---------------------------------------------------------------------------
 * چرا لازم است؟
 * نسخه‌های قبلی سامانه اسنادی با فیلدهای کمتر/متفاوت در Object Storage می‌نوشتند
 * (مثلاً پرسنل بدون `employmentType` یا `position`، درخواست بدون `scope`، یا
 * فیلدهای اضافهٔ ناشناخته). اسکیمای جدید عمداً سخت‌گیرانه است (`.strict()` و
 * فیلدهای الزامی)؛ در نتیجه اسناد قدیمیِ هنوز-در-سطل، با ۵۰۳ رد می‌شدند و
 * «داشبورد خالی» می‌ساختند — دقیقاً سناریوی گزارش‌شده.
 *
 * این ماژول مسیر «خواندنِ همراه با سازگاری» را فراهم می‌کند:
 *  ۱) ابتدا همان اعتبارسنجی سخت‌گیرانه انجام می‌شود (هیچ چیز عوض نمی‌شود).
 *  ۲) اگر شکست خورد، نرمال‌سازی legacy: حذف کلیدهای ناشناخته، پرکردن فیلدهای
 *     جدید با مقدار پیش‌فرض محافظه‌کارانه، و تبدیل نوع‌های رایج (رشته → عدد).
 *  ۳) اگر نرمال‌سازی موفق شد، داده خوانده و با پرچم `legacyNormalized` به
 *     کلاینت اعلام می‌شود؛ نوشتن‌ها همچنان سخت‌گیرانه‌اند، پس ذخیرهٔ بعدی
 *     همان سند را به قالب جدید ارتقا می‌دهد (خودترمیمی بدون دست‌زدن به کنسول S3).
 *  ۴) اگر هم سخت‌گیرانه هم نرمال‌سازی شکست بخورند، همان ۵۰۳ قبلی برمی‌گردد
 *     (سیاست شکستِ بسته حفظ می‌شود و دادهٔ خراب هرگز «ساخته» نمی‌شود).
 */

export type LegacyNormalizationResult<T> =
  | { ok: true; data: T; notes: string[] }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** تبدیل رشتهٔ عددی/تعداد واقعی به عدد؛ در غیر این صورت مقدار پیش‌فرض. */
function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

/** فقط کلیدهای شناخته‌شده نگه داشته می‌شوند؛ بقیه حذف. */
function pickKeys(input: unknown, knownKeys: readonly string[]): Record<string, unknown> {
  if (!isRecord(input)) return {};
  const out: Record<string, unknown> = {};
  for (const key of knownKeys) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

// ── نرمال‌سازهای هر سند ──────────────────────────────────────────────────────

const PERSONNEL_KEYS = [
  'id', 'firstName', 'lastName', 'personalCode', 'jobGroup', 'position',
  'employmentType', 'experienceYears', 'active', 'canBeShiftLeader',
  'orderIndex', 'username', 'password', 'locked', 'workRoutine',
] as const;

const JOB_GROUPS = ['nurse', 'assistant'] as const;
const POSITIONS = ['supervisor', 'staff', 'general', 'none'] as const;
const EMPLOYMENT_TYPES = ['official', 'contract', 'conscript', 'overtime'] as const;
const ROUTINES = ['morning', 'evening_night', 'long'] as const;

export function normalizePersonnel(raw: unknown): LegacyNormalizationResult<unknown[]> {
  if (!Array.isArray(raw)) return { ok: false, reason: 'personnel باید آرایه باشد' };
  const notes: string[] = [];
  const items = raw.map((item, index) => {
    const record = pickKeys(item, PERSONNEL_KEYS);
    const original = isRecord(item) ? item : {};
    const normalized: Record<string, unknown> = { ...record };

    for (const key of ['id', 'firstName', 'lastName'] as const) {
      if (typeof normalized[key] !== 'string' || !(normalized[key] as string).trim()) {
        // شناسه/نام برای پرسنل حیاتی است؛ بدون آن رکورد قابل استفاده نیست.
        return { fatal: true, index, key } as const;
      }
    }

    if (!JOB_GROUPS.includes(normalized.jobGroup as any)) {
      if (original.jobGroup !== undefined) notes.push(`پرسنل ${index}: jobGroup نامعتبر («${String(original.jobGroup)}») → پیش‌فرض nurse`);
      normalized.jobGroup = 'nurse';
    }
    if (!POSITIONS.includes(normalized.position as any)) {
      if (original.position !== undefined) notes.push(`پرسنل ${index}: position نامعتبر → پیش‌فرض staff`);
      normalized.position = 'staff';
    }
    if (!EMPLOYMENT_TYPES.includes(normalized.employmentType as any)) {
      if (original.employmentType !== undefined) notes.push(`پرسنل ${index}: employmentType نامعتبر → پیش‌فرض official`);
      normalized.employmentType = 'official';
    }
    if (normalized.workRoutine !== undefined && !ROUTINES.includes(normalized.workRoutine as any)) {
      delete normalized.workRoutine;
    }
    if (normalized.personalCode === undefined) normalized.personalCode = '';
    normalized.experienceYears = coerceNumber(normalized.experienceYears, 0);
    normalized.active = coerceBoolean(normalized.active, true);
    normalized.canBeShiftLeader = coerceBoolean(normalized.canBeShiftLeader, false);
    if (normalized.orderIndex !== undefined) {
      const order = coerceNumber(normalized.orderIndex, 0);
      normalized.orderIndex = Math.max(0, Math.floor(order));
    }
    return normalized;
  });

  if (items.some(item => (item as any).fatal)) {
    const bad = items.find(item => (item as any).fatal) as { index: number; key: string };
    return { ok: false, reason: `پرسنل ${bad.index}: فیلد الزامی «${bad.key}» خالی/نامعتبر است` };
  }
  return { ok: true, data: items as unknown[], notes };
}

const REQUEST_KEYS = [
  'id', 'personnelId', 'requestType', 'preferredShift', 'patternSteps',
  'isEssential', 'offHardness', 'scope', 'startDate', 'endDate',
  'selectedDays', 'note', 'createdAt', 'updatedAt',
] as const;

const REQUEST_TYPES = ['shift', 'OFF', 'leave', 'pattern', 'avoid_shift'] as const;
const SCOPES = [
  'all', 'even', 'odd', 'saturdays', 'sundays', 'mondays', 'tuesdays',
  'wednesdays', 'thursdays', 'fridays', 'range', 'weekly_even', 'weekly_odd',
  'custom_days',
] as const;

export function normalizeRequests(raw: unknown): LegacyNormalizationResult<unknown[]> {
  if (!Array.isArray(raw)) return { ok: false, reason: 'requests باید آرایه باشد' };
  const notes: string[] = [];
  const items = raw.map((item, index) => {
    const record = pickKeys(item, REQUEST_KEYS);
    const original = isRecord(item) ? item : {};
    const normalized: Record<string, unknown> = { ...record };

    if (typeof normalized.id !== 'string' || !(normalized.id as string).trim()) {
      return { fatal: true, index } as const;
    }
    if (typeof normalized.personnelId !== 'string' || !(normalized.personnelId as string).trim()) {
      return { fatal: true, index, key: 'personnelId' } as const;
    }
    if (!REQUEST_TYPES.includes(normalized.requestType as any)) {
      if (original.requestType !== undefined) notes.push(`درخواست ${index}: requestType نامعتبر → پیش‌فرض shift`);
      normalized.requestType = 'shift';
    }
    if (!SCOPES.includes(normalized.scope as any)) {
      if (original.scope !== undefined) notes.push(`درخواست ${index}: scope نامعتبر → پیش‌فرض all`);
      normalized.scope = 'all';
    }
    normalized.isEssential = coerceBoolean(normalized.isEssential, false);
    if (normalized.patternSteps !== undefined && !Array.isArray(normalized.patternSteps)) {
      delete normalized.patternSteps;
    }
    if (normalized.selectedDays !== undefined) {
      if (!Array.isArray(normalized.selectedDays)) delete normalized.selectedDays;
      else normalized.selectedDays = normalized.selectedDays.map(day => coerceNumber(day, 1)).filter(day => day >= 1 && day <= 31);
    }
    return normalized;
  });

  const bad = items.find(item => (item as any).fatal) as { index: number; key?: string } | undefined;
  if (bad) {
    return { ok: false, reason: `درخواست ${bad.index}: فیلد الزامی «${bad.key || 'id'}» خالی/نامعتبر است` };
  }
  return { ok: true, data: items as unknown[], notes };
}

const DEMAND_KEYS = [
  'morningNurse', 'morningAssistant', 'afternoonNurse', 'afternoonAssistant',
  'afternoonLeader', 'nightNurse', 'nightAssistant', 'nightLeader',
] as const;

function normalizeDemand(raw: unknown): Record<string, unknown> {
  const record = isRecord(raw) ? raw : {};
  const out: Record<string, unknown> = {};
  for (const key of DEMAND_KEYS) {
    out[key] = coerceNumber(record[key], 0);
  }
  return out;
}

export function normalizeSettings(raw: unknown): LegacyNormalizationResult<unknown> {
  const record = isRecord(raw) ? raw : {};
  const notes: string[] = [];
  if (!isRecord(record.settings_system)) {
    notes.push('تنظیمات بخش (settings_system) وجود نداشت؛ مقادیر پیش‌فرض صفر استفاده شد');
  }
  const settingsSystem = isRecord(record.settings_system) ? record.settings_system : {};

  const dutyHoursRaw = isRecord(settingsSystem.dutyHours) ? settingsSystem.dutyHours : {};
  const dutyHours = {
    official: coerceNumber(dutyHoursRaw.official, 0),
    contract: coerceNumber(dutyHoursRaw.contract, 0),
    conscript: coerceNumber(dutyHoursRaw.conscript, 0),
    overtime: coerceNumber(dutyHoursRaw.overtime, 0),
  };

  const demandRaw = isRecord(settingsSystem.demand) ? settingsSystem.demand : {};
  const demand = {
    weekday: normalizeDemand(demandRaw.weekday),
    holiday: normalizeDemand(demandRaw.holiday),
  };

  const credentialsRaw = isRecord(record.settings_credentials) ? record.settings_credentials : {};
  const credentials = {
    username: typeof credentialsRaw.username === 'string' ? credentialsRaw.username : '',
    password: typeof credentialsRaw.password === 'string' ? credentialsRaw.password : '',
  };

  return {
    ok: true,
    data: {
      ...(record.activeYear !== undefined ? { activeYear: coerceNumber(record.activeYear, 1404) } : {}),
      settings_system: {
        ...(settingsSystem.autoCalculateDutyHours !== undefined
          ? { autoCalculateDutyHours: coerceBoolean(settingsSystem.autoCalculateDutyHours, false) }
          : {}),
        dutyHours,
        demand,
      },
      settings_credentials: credentials,
    },
    notes,
  };
}

export function normalizeHolidays(raw: unknown): LegacyNormalizationResult<unknown> {
  // قالب: { "1404_5": { days: { "1": "عنوان" }, monthlyDutyHours: {...}|null } }
  if (!isRecord(raw)) return { ok: false, reason: 'holidays باید یک شیء باشد' };
  const out: Record<string, unknown> = {};
  for (const [monthKey, value] of Object.entries(raw)) {
    if (isRecord(value)) {
      const days = isRecord(value.days) ? value.days : {};
      const monthlyDutyHours = value.monthlyDutyHours !== undefined && value.monthlyDutyHours !== null
        ? value.monthlyDutyHours
        : null;
      out[monthKey] = { days, monthlyDutyHours };
    }
  }
  return { ok: true, data: out, notes: [] };
}

export function normalizeFirstDayOfWeek(raw: unknown): LegacyNormalizationResult<unknown> {
  if (!isRecord(raw)) return { ok: false, reason: 'firstDayOfWeek باید یک شیء باشد' };
  const out: Record<string, unknown> = {};
  for (const [monthKey, value] of Object.entries(raw)) {
    const day = coerceNumber(value, -1);
    out[monthKey] = day >= -1 && day <= 6 ? day : -1;
  }
  return { ok: true, data: out, notes: [] };
}

const SCHEDULE_KEYS = [
  'year', 'month', 'assignments', 'shiftLeaders', 'warnings', 'finalized',
  'finalizedNurses', 'finalizedAssistants', 'requestsLocked', 'dismissedWarnings',
  'changeLogs', 'eventLogs', 'lockedRows', 'autoSubstitutions',
] as const;

export function normalizeSchedule(raw: unknown): LegacyNormalizationResult<unknown> {
  const record = pickKeys(raw, SCHEDULE_KEYS);
  const notes: string[] = [];
  if (record.assignments === undefined) record.assignments = {};
  if (record.shiftLeaders === undefined) record.shiftLeaders = {};
  if (record.warnings === undefined) record.warnings = [];
  if (!isRecord(record.assignments)) record.assignments = {};
  if (!isRecord(record.shiftLeaders)) record.shiftLeaders = {};
  if (!Array.isArray(record.warnings)) record.warnings = [];
  if (record.dismissedWarnings !== undefined && !Array.isArray(record.dismissedWarnings)) delete record.dismissedWarnings;
  if (record.changeLogs !== undefined && !Array.isArray(record.changeLogs)) delete record.changeLogs;
  if (record.eventLogs !== undefined && !Array.isArray(record.eventLogs)) delete record.eventLogs;
  if (record.lockedRows !== undefined && !Array.isArray(record.lockedRows)) delete record.lockedRows;
  if (record.autoSubstitutions !== undefined && !Array.isArray(record.autoSubstitutions)) delete record.autoSubstitutions;
  return { ok: true, data: record, notes };
}

const DEPARTMENT_KEYS = ['id', 'name', 'username', 'password'] as const;

export function normalizeDepartments(raw: unknown): LegacyNormalizationResult<unknown[]> {
  if (!Array.isArray(raw)) return { ok: false, reason: 'departments باید آرایه باشد' };
  const notes: string[] = [];
  const items = raw.map((item, index) => {
    const record = pickKeys(item, DEPARTMENT_KEYS);
    if (typeof record.id !== 'string' || !(record.id as string).trim()) {
      return { fatal: true, index, key: 'id' } as const;
    }
    if (typeof record.name !== 'string' || !(record.name as string).trim()) {
      return { fatal: true, index, key: 'name' } as const;
    }
    return record;
  });
  const bad = items.find(item => (item as any).fatal) as { index: number; key: string } | undefined;
  if (bad) {
    return { ok: false, reason: `بخش ${bad.index}: فیلد الزامی «${bad.key}» خالی است` };
  }
  return { ok: true, data: items as unknown[], notes };
}

/**
 * نرمال‌سازی سند بر اساس نوع منبع. همیشه «کامل» است (هرگز throw نمی‌کند).
 */
export function normalizeDocumentFor(
  resource: StorageResource,
  raw: unknown,
): LegacyNormalizationResult<unknown> {
  switch (resource.type) {
    case 'departments': return normalizeDepartments(raw);
    case 'personnel': return normalizePersonnel(raw);
    case 'requests': return normalizeRequests(raw);
    case 'settings': return normalizeSettings(raw);
    case 'holidays': return normalizeHolidays(raw);
    case 'firstDayOfWeek': return normalizeFirstDayOfWeek(raw);
    case 'schedule': return normalizeSchedule(raw);
    case 'activeScenarios':
    case 'scenarioVotes':
      // این دو سند اختیاری‌اند و از قبل رفتار گذرا دارند.
      return { ok: true, data: raw, notes: [] };
  }
}

/**
 * تبدیل یک snapshot کلی (قالب قدیمیِ تک‌فایله) به state معتبر، با نرمال‌سازی.
 * اگر strict قبلاً رد شده باشد صدا زده می‌شود؛ داخلش باز strict می‌شود تا در
 * حالت «داده سالم ولی کلید اضافه» هم جواب دهد.
 */
export function tryParseAppStateLenient(
  raw: unknown,
): { ok: true; state: AppDatabaseState; notes: string[] } | { ok: false; reason: string } {
  const notes: string[] = [];

  // تلاش اول: همان اعتبارسنجی سخت‌گیرانه (دادهٔ سالم با کلیدهای اضافه رد نمی‌شود).
  const strict = AppDatabaseStateSchema.safeParse(raw);
  if (strict.success) return { ok: true, state: strict.data, notes };

  if (!isRecord(raw)) return { ok: false, reason: 'snapshot باید یک شیء باشد' };

  const departmentsResult = normalizeDepartments(raw.departments);
  if (!departmentsResult.ok) return { ok: false, reason: `بخش‌ها: ${departmentsResult.reason}` };
  notes.push(...departmentsResult.notes);

  const deptDataRaw = isRecord(raw.deptData) ? raw.deptData : {};
  const deptData: Record<string, unknown> = {};
  for (const department of departmentsResult.data as Array<Record<string, unknown>>) {
    const departmentId = department.id as string;
    const dept = isRecord(deptDataRaw[departmentId]) ? deptDataRaw[departmentId] : {};

    const personnel = normalizePersonnel(dept.personnel);
    const requests = normalizeRequests(dept.requests);
    const settings = normalizeSettings(dept);
    const holidays = normalizeHolidays(dept.holidays);
    const firstDayOfWeek = normalizeFirstDayOfWeek(dept.firstDayOfWeek);

    if (!personnel.ok) return { ok: false, reason: `${departmentId}: ${personnel.reason}` };
    if (!requests.ok) return { ok: false, reason: `${departmentId}: ${requests.reason}` };
    if (!settings.ok) return { ok: false, reason: `${departmentId}: ${settings.reason}` };
    if (!holidays.ok) return { ok: false, reason: `${departmentId}: ${holidays.reason}` };
    if (!firstDayOfWeek.ok) return { ok: false, reason: `${departmentId}: ${firstDayOfWeek.reason}` };
    notes.push(...personnel.notes, ...requests.notes);

    const schedulesRaw = isRecord(dept.schedules) ? dept.schedules : {};
    const schedules: Record<string, unknown> = {};
    for (const [monthKey, scheduleRaw] of Object.entries(schedulesRaw)) {
      const schedule = normalizeSchedule(scheduleRaw);
      if (!schedule.ok) return { ok: false, reason: `${departmentId}/${monthKey}: ${schedule.reason}` };
      schedules[monthKey] = schedule.data;
    }

    deptData[departmentId] = {
      personnel: personnel.data,
      requests: requests.data,
      ...(isRecord(dept) && dept.activeYear !== undefined
        ? { activeYear: coerceNumber(dept.activeYear, 1404) }
        : {}),
      settings_system: (settings.data as { settings_system: unknown }).settings_system,
      settings_credentials: (settings.data as { settings_credentials: unknown }).settings_credentials,
      holidays: holidays.data,
      firstDayOfWeek: firstDayOfWeek.data,
      schedules,
      ...(dept.activeScenarios !== undefined ? { activeScenarios: dept.activeScenarios } : {}),
      ...(dept.scenarioVotes !== undefined ? { scenarioVotes: dept.scenarioVotes } : {}),
    };
  }

  const candidate = { departments: departmentsResult.data, deptData };
  const parsed = AppDatabaseStateSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `state نرمال‌شده باز هم معتبر نبود: ${parsed.error.issues.slice(0, 3).map(issue => issue.message).join('؛ ')}`,
    };
  }
  return { ok: true, state: parsed.data, notes };
}
