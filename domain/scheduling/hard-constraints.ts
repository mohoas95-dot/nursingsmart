/**
 * HardConstraints — Domain Layer (Pure Functions)
 *
 * قرارداد واحدِ «محدودیت‌های سخت» برای تصمیم‌گیری دربارهٔ یک (پرسنل، روز، شیفت).
 *
 * چرا این ماژول وجود دارد؟
 *   تا پیش از این، هر نقطهٔ تصمیم‌گیری (چینش حریصانهٔ solver، مسیر اضطراری،
 *   `solveWithPriority` و `reconcileStaffingCoverage`) قوانین را جداگانه و
 *   ناقص پیاده کرده بود. نتیجه این بود که آخرین نویسنده (reconcile) می‌توانست
 *   قوانینی را بشکند که solver آن‌ها را سخت می‌دانست: Hard OFF، صبح‌کاریِ
 *   سرپرستار/استاف و استراحت شب.
 *
 * این ماژول «مدل واحدِ محدودیت» را تعریف می‌کند؛ یک Solver جدید نمی‌سازد:
 *   - توابع کاملاً pure و deterministic‌اند (بدون React/Next/I/O/state سراسری).
 *   - هر قانون یک تابع کوچک و مستقل دارد و قابل unit-test است.
 *   - هر نقطهٔ تصمیم‌گیری می‌تواند «زیرمجموعه‌ای» از قوانین را فعال کند، اما
 *     تعریف هر قانون فقط یک‌جا (همین فایل) نگهداری می‌شود.
 *
 * تعارض‌های شناخته‌شده و آگاهانه (silent override نداریم):
 *   • سقف شیفت متوالی (MAX_CONSECUTIVE_SHIFTS) در `reconcileStaffingCoverage`
 *     به‌صورت «اولویت» اعمال می‌شود نه «فیلتر سخت»، چون مسیر اضطراریِ خودِ
 *     solver هم در بن‌بست همین کار را می‌کند و نقض آن به‌صورت هشدار بحرانی
 *     `MAX_CONSECUTIVE` گزارش می‌شود. این تصمیم در همان محل به‌صراحت مستند شده است.
 *   • Soft OFF عمداً «سخت» نیست: در بن‌بست قابل نقض است. تفاوت Hard/Soft فقط
 *     از طریق `isHardOffRequest` تعیین می‌شود.
 */

import type { Personnel, ShiftRequest, ShiftType } from '../../lib/types';
import { isDayInRequestScope } from '../requests/request-scope-matcher';
import {
  shiftContainsComponent,
  wouldBreachConsecutiveCap,
  type AssignmentMap,
} from './smart-rules';

/** دوره‌های زمانی روز که مبنای پوشش نیرو هستند. */
export type ConstraintPeriod = 'M' | 'E' | 'N';

/**
 * حداکثر شب‌های متوالی مجاز.
 *
 * این عدد از خودِ implementation استخراج شده است: در چینش حریصانهٔ
 * `solveNursingSchedule` اگر پرسنل در دو روز گذشته شب کار کرده باشد، شبِ سوم
 * غیرمجاز است (`workedN1 && workedN2 → reject`). یعنی سقف دو شب متوالی.
 */
export const MAX_CONSECUTIVE_NIGHTS = 2;

/** شناسهٔ ماشینیِ نوع نقض — برای گزارش ساخت‌یافته، بدون تجزیهٔ متن. */
export type HardConstraintViolation =
  | 'HARD_OFF'
  | 'ESSENTIAL_LEAVE'
  | 'LEAVE_REQUEST'
  | 'LEAVE_CELL'
  | 'LOCKED_ROW'
  | 'PROTECTED_CELL'
  | 'MORNING_ONLY'
  | 'NIGHT_REST_CONSECUTIVE_NIGHTS'
  | 'NIGHT_REST_MORNING_AFTER_NIGHT'
  | 'MAX_CONSECUTIVE';

/** برچسب فارسیِ نمایشی هر نقض (فقط برای متن هشدار؛ منطق ماشینی از کد استفاده می‌کند). */
export const HARD_CONSTRAINT_LABELS: Readonly<Record<HardConstraintViolation, string>> = {
  HARD_OFF: 'آف قطعی',
  ESSENTIAL_LEAVE: 'مرخصی ضروری',
  LEAVE_REQUEST: 'مرخصی تأییدشده',
  LEAVE_CELL: 'روز مرخصی',
  LOCKED_ROW: 'ردیف قفل‌شده',
  PROTECTED_CELL: 'ویرایش دستی سرپرستار',
  MORNING_ONLY: 'محدودیت صبح‌کاری سرپرستار/استاف',
  NIGHT_REST_CONSECUTIVE_NIGHTS: 'سقف شب متوالی',
  NIGHT_REST_MORNING_AFTER_NIGHT: 'استراحت پس از شب',
  MAX_CONSECUTIVE: 'سقف شیفت متوالی',
};

// ---------------------------------------------------------------------------
// قانون: Hard OFF / Soft OFF
// ---------------------------------------------------------------------------

/**
 * آیا این درخواست، «آف قطعی (Hard OFF)» است؟
 *
 * مطابق قرارداد موجود کد: `requestType === 'OFF'` و hardness برابر `'hard'`؛
 * نبودِ `offHardness` هم به‌صورت پیش‌فرض hard در نظر گرفته می‌شود (همان رفتاری
 * که در solver و solveWithPriority پیاده شده است). فقط `'soft'` نرم است.
 */
export function isHardOffRequest(request: Readonly<ShiftRequest>): boolean {
  return request.requestType === 'OFF' && request.offHardness !== 'soft';
}

/** آیا این درخواست، «آف ترجیحی (Soft OFF)» است؟ */
export function isSoftOffRequest(request: Readonly<ShiftRequest>): boolean {
  return request.requestType === 'OFF' && request.offHardness === 'soft';
}

/** مقدارِ «روزِ هفته نامشخص است» برای فراخوان‌هایی که تقویم کامل ندارند. */
export const UNKNOWN_DAY_OF_WEEK = -1;

/** دامنه‌هایی که تعیینشان به روزِ هفته نیاز دارد. */
const WEEKDAY_DEPENDENT_SCOPES: ReadonlySet<string> = new Set([
  'saturdays', 'sundays', 'mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays',
  'weekly_even', 'weekly_odd',
]);

/**
 * تطبیق دامنهٔ درخواست با یک روز.
 *
 * اگر `dayOfWeek` نامشخص باشد (UNKNOWN_DAY_OF_WEEK) و دامنهٔ درخواست به روزِ هفته
 * وابسته باشد، محافظه‌کارانه «مطابق» در نظر گرفته می‌شود. دلیل: این توابع
 * محدودیت‌های سخت را ارزیابی می‌کنند و در ابهام باید سمت «حفاظت از پرسنل»
 * خطا کنیم — کمبود پوشش بهتر از نقض یک محدودیت سخت است.
 */
function matchesDay(day: number, dayOfWeek: number, request: Readonly<ShiftRequest>): boolean {
  if (dayOfWeek < 0 && WEEKDAY_DEPENDENT_SCOPES.has(request.scope)) return true;
  return isDayInRequestScope(day, dayOfWeek, request);
}

/** آفِ قطعیِ ثبت‌شده برای این پرسنل در این روز (در صورت وجود). */
export function findHardOffRequest(
  requests: readonly ShiftRequest[] | undefined,
  personnelId: string,
  day: number,
  dayOfWeek: number
): ShiftRequest | undefined {
  return (requests ?? []).find(request =>
    request.personnelId === personnelId &&
    isHardOffRequest(request) &&
    matchesDay(day, dayOfWeek, request)
  );
}

/** آیا قرار دادن شیفت روی این سلول، آفِ قطعی را نقض می‌کند؟ */
export function violatesHardOff(
  requests: readonly ShiftRequest[] | undefined,
  personnelId: string,
  day: number,
  dayOfWeek: number
): boolean {
  return !!findHardOffRequest(requests, personnelId, day, dayOfWeek);
}

// ---------------------------------------------------------------------------
// قانون: مرخصی
// ---------------------------------------------------------------------------

/** درخواست مرخصیِ ثبت‌شده برای این پرسنل در این روز (در صورت وجود). */
export function findLeaveRequest(
  requests: readonly ShiftRequest[] | undefined,
  personnelId: string,
  day: number,
  dayOfWeek: number
): ShiftRequest | undefined {
  return (requests ?? []).find(request =>
    request.personnelId === personnelId &&
    request.requestType === 'leave' &&
    matchesDay(day, dayOfWeek, request)
  );
}

/** آیا سلولِ فعلی، یک روز مرخصی (L1..Ln یا LH) است؟ */
export function isLeaveCell(shift: ShiftType | undefined): boolean {
  return !!shift && shift.startsWith('L');
}

// ---------------------------------------------------------------------------
// قانون: صبح‌کاریِ سرپرستار/استاف
// ---------------------------------------------------------------------------

/** آیا این پرسنل مشمول قانون صبح‌کاری است؟ (سرپرستار و استاف) */
export function isMorningOnlyPosition(person: Pick<Personnel, 'position'>): boolean {
  return person.position === 'supervisor' || person.position === 'staff';
}

/**
 * آیا برای این پرسنل/روز/دوره، «برنامهٔ صریح» (درخواست شیفت یا الگوی کاری) ثبت
 * شده است؟ این دقیقاً همان استثنایی است که چینش حریصانهٔ solver برای عبور از
 * قانون صبح‌کاری به‌کار می‌برد.
 */
export function hasExplicitPlanForPeriod(
  requests: readonly ShiftRequest[] | undefined,
  personnelId: string,
  day: number,
  dayOfWeek: number,
  period: ConstraintPeriod
): boolean {
  for (const request of requests ?? []) {
    if (request.personnelId !== personnelId) continue;

    if (request.requestType === 'shift' && request.preferredShift) {
      if (!matchesDay(day, dayOfWeek, request)) continue;
      if (shiftContainsComponent(request.preferredShift, period)) return true;
    }

    if (request.requestType === 'pattern' && request.patternSteps && request.patternSteps.length > 0) {
      const step = request.patternSteps[(day - 1) % request.patternSteps.length];
      if (shiftContainsComponent(step, period)) return true;
    }
  }
  return false;
}

/**
 * آیا تخصیص این دوره به سرپرستار/استاف، قانون صبح‌کاری را نقض می‌کند؟
 *
 * قانون استخراج‌شده از چینش حریصانهٔ `solveNursingSchedule`:
 *   • روز کاری: عصر (E) و شب (N) ممنوع است.
 *   • روز تعطیل: هر سه دوره ممنوع است (سرپرستار/استاف تعطیل‌اند).
 *   • استثنا: وجود درخواست شیفت/الگوی کاری صریح برای همان دوره.
 *
 * @param includeHolidayRest اگر false باشد، فقط بخش «E/N ممنوع» اعمال می‌شود و
 *   تعطیلیِ روزهای تعطیل نادیده گرفته می‌شود. این تفکیک عمدی و صریح است تا
 *   نقاط تصمیم‌گیریِ مختلف بتوانند دامنهٔ قانون را بدون بازنویسیِ آن انتخاب کنند
 *   (مثلاً جبران پوشش، صبحِ روز تعطیل را همچنان مجاز می‌داند).
 */
export function violatesMorningOnly(
  person: Pick<Personnel, 'position'>,
  period: ConstraintPeriod,
  isHoliday: boolean,
  hasExplicitPlan: boolean,
  includeHolidayRest = true
): boolean {
  if (!isMorningOnlyPosition(person)) return false;
  if (hasExplicitPlan) return false;
  if (isHoliday && includeHolidayRest) return true;
  return period === 'E' || period === 'N';
}

// ---------------------------------------------------------------------------
// قانون: استراحت شب
// ---------------------------------------------------------------------------

/** آیا شیفت این روز شامل شب است؟ */
function worksNightOn(assignments: AssignmentMap, personnelId: string, day: number): boolean {
  if (day < 1) return false;
  return shiftContainsComponent(assignments[personnelId]?.[day], 'N');
}

/**
 * آیا این تخصیص، قوانین استراحت شب را نقض می‌کند؟
 *
 * دو زیرقانون که هر دو مستقیماً از چینش حریصانهٔ `solveNursingSchedule`
 * استخراج شده‌اند:
 *   1. شبِ سوم متوالی ممنوع است (سقف = MAX_CONSECUTIVE_NIGHTS = ۲).
 *   2. صبحِ بلافاصله پس از شب ممنوع است (استراحت پس از شب‌کاری).
 *
 * @returns کد نقض، یا null اگر مجاز باشد.
 */
export function violatesNightRest(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  candidateShift: ShiftType
): HardConstraintViolation | null {
  if (shiftContainsComponent(candidateShift, 'N')) {
    let consecutive = 0;
    for (let previous = day - 1; previous >= 1; previous--) {
      if (!worksNightOn(assignments, personnelId, previous)) break;
      consecutive += 1;
      if (consecutive >= MAX_CONSECUTIVE_NIGHTS) return 'NIGHT_REST_CONSECUTIVE_NIGHTS';
    }
  }

  if (shiftContainsComponent(candidateShift, 'M') && worksNightOn(assignments, personnelId, day - 1)) {
    return 'NIGHT_REST_MORNING_AFTER_NIGHT';
  }

  return null;
}

// ---------------------------------------------------------------------------
// قانون: سقف شیفت متوالی
// ---------------------------------------------------------------------------

/**
 * آیا این تخصیص، سقف شیفت متوالی را می‌شکند؟
 * پوشش نازکی روی `wouldBreachConsecutiveCap` تا همهٔ نقاط تصمیم‌گیری از یک نام
 * و یک تعریف استفاده کنند (منبع حقیقت همچنان smart-rules است).
 */
export function violatesConsecutiveLimit(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  candidateShift: ShiftType,
  totalDays: number
): boolean {
  return wouldBreachConsecutiveCap(assignments, personnelId, day, candidateShift, totalDays);
}

// ---------------------------------------------------------------------------
// ارزیابی ترکیبی
// ---------------------------------------------------------------------------

/** ورودیِ ارزیابی یک تصمیم تخصیص (پرسنل × روز × شیفت). */
export interface ShiftAssignmentDecision {
  person: Personnel;
  day: number;
  /** ۰=شنبه … ۶=جمعه. اگر در دسترس نباشد، دامنه‌های هفتگی مطابقت نمی‌کنند. */
  dayOfWeek?: number;
  isHoliday?: boolean;
  /** دورهٔ موردنیازِ پوشش (برای قانون صبح‌کاری). */
  period?: ConstraintPeriod;
  /** شیفتِ کاملِ حاصل برای آن روز پس از اعمال تخصیص. */
  candidateShift: ShiftType;
  assignments: AssignmentMap;
  totalDays: number;
  requests?: readonly ShiftRequest[];
  lockedRowIds?: ReadonlySet<string>;
  protectedCells?: ReadonlySet<string>;
}

/** کدام قوانین در این نقطهٔ تصمیم‌گیری «سخت» شمرده شوند. */
export interface HardConstraintRules {
  hardOff?: boolean;
  essentialLeave?: boolean;
  /** هر درخواست مرخصیِ تأییدشده (نه فقط ضروری). */
  leaveRequest?: boolean;
  /** سلولی که هم‌اکنون مرخصی است. */
  leaveCell?: boolean;
  lockedRow?: boolean;
  protectedCell?: boolean;
  morningOnly?: boolean;
  /**
   * آیا قانون صبح‌کاری، «تعطیل بودنِ سرپرستار/استاف در روزهای تعطیل» را هم شامل شود؟
   * پیش‌فرض true. جبران پوشش این بخش را غیرفعال می‌کند تا فقط ممنوعیت E/N اعمال شود
   * (تصمیم صریح؛ در `staffing-coverage.ts` مستند شده است).
   */
  morningOnlyIncludesHoliday?: boolean;
  nightRest?: boolean;
  consecutiveCap?: boolean;
}

/** همهٔ قوانین سخت. */
export const ALL_HARD_RULES: HardConstraintRules = {
  hardOff: true,
  essentialLeave: true,
  leaveRequest: true,
  leaveCell: true,
  lockedRow: true,
  protectedCell: true,
  morningOnly: true,
  nightRest: true,
  consecutiveCap: true,
};

/**
 * قوانینی که هنگام نوشتن «درخواست شیفت صریح» سخت‌اند.
 *
 * ترتیب اولویت: محدودیت سخت > قفل/محافظت > درخواست صریح > سایر ترجیحات.
 * قانون صبح‌کاری اینجا فعال نیست، چون خودِ درخواست صریح استثنای آن قانون است.
 */
export const EXPLICIT_REQUEST_HARD_RULES: HardConstraintRules = {
  hardOff: true,
  essentialLeave: true,
  leaveRequest: true,
  leaveCell: true,
  nightRest: true,
  consecutiveCap: true,
};

/**
 * قوانینی که هنگام «شکستن زنجیرهٔ آف» (پس‌پردازش solver) سخت‌اند.
 *
 * این قاعده کم‌اولویت است و صرفاً برای رعایت سقف ۳ روز آف متوالی اجرا می‌شود؛
 * پس هرگز نباید آفِ قطعی یا مرخصی را بازنویسی کند. سقف شیفت متوالی جداگانه در
 * همان محل با `wouldBreachConsecutiveCap` بررسی می‌شود (رفتار موجود، بدون تغییر).
 */
export const OFF_BREAKER_HARD_RULES: HardConstraintRules = {
  hardOff: true,
  essentialLeave: true,
  leaveRequest: true,
  leaveCell: true,
  // `personnel.locked` عمداً اینجا اعمال نمی‌شود: نادیده‌گرفتنِ آن توسط
  // solveNursingSchedule یک باگ جداگانه (B6) و خارج از دامنهٔ این Session است.
  // سقف شیفت متوالی هم در همان محل با wouldBreachConsecutiveCap بررسی می‌شود.
};

/**
 * قوانینی که در «مسیر اضطراریِ بن‌بست» solver سخت‌اند.
 *
 * دامنه عمداً حداقلی است و دقیقاً همان چیزی را اضافه می‌کند که برای تضمین
 * B4/B5 لازم است: هیچ جبران‌کنندهٔ پوششی — حتی مسیر اضطراری — حق ندارد یک
 * دنبالهٔ شبِ ممنوع بسازد. آف قطعی و مرخصیِ ضروری هم مثل قبل حفظ می‌شوند.
 *
 * عمداً اضافه نشده (خارج از دامنهٔ B1–B5):
 *   • `morningOnly` — امروز مسیر اضطراری این قانون را اعمال نمی‌کند. سخت‌کردن
 *     آن اینجا باعث می‌شد در روسترهای ناممکن، پوششِ E/N سرپرستار/استاف کاملاً
 *     حذف و ده‌ها هشدار «نبود سرشیفت» تولید شود؛ یعنی تغییری بسیار فراتر از
 *     B3 که فقط دربارهٔ reconcile است. این ناسازگاریِ باقی‌مانده در گزارش
 *     نهایی به‌صراحت ثبت شده است.
 *   • `consecutiveCap` — مثل قبل فقط ترتیب صف را تعیین می‌کند و نقضش به‌صورت
 *     هشدار بحرانی MAX_CONSECUTIVE گزارش می‌شود.
 */
export const EMERGENCY_FILL_HARD_RULES: HardConstraintRules = {
  hardOff: true,
  essentialLeave: true,
  leaveCell: true,
  nightRest: true,
};

/**
 * قوانینی که هنگام جبران کمبود پوشش در `reconcileStaffingCoverage` سخت‌اند.
 *
 * توجه (تعارض آگاهانه): `consecutiveCap` عمداً اینجا سخت نیست و به‌صورت اولویت
 * اعمال می‌شود؛ دلیل و محل آن در `staffing-coverage.ts` مستند شده است.
 */
export const COVERAGE_FILL_HARD_RULES: HardConstraintRules = {
  hardOff: true,
  essentialLeave: true,
  leaveRequest: true,
  leaveCell: true,
  lockedRow: true,
  protectedCell: true,
  morningOnly: true,
  // جبران پوشش فقط ممنوعیت E/N را اعمال می‌کند؛ «تعطیلیِ روز تعطیل» یک ترجیح
  // چینشی است نه محدودیت سخت، و اعمال آن اینجا رفتار پوشش موجود را می‌شکست.
  morningOnlyIncludesHoliday: false,
  nightRest: true,
};

/**
 * اولین نقضِ محدودیت سختِ فعال را برمی‌گرداند (یا null اگر تخصیص مجاز باشد).
 * ترتیب بررسی از «غیرقابل‌تغییرترین» به «قاعده‌مندترین» است تا کد نقضِ گزارش‌شده
 * معنادار و پایدار باشد.
 */
export function evaluateHardConstraints(
  decision: Readonly<ShiftAssignmentDecision>,
  rules: Readonly<HardConstraintRules> = ALL_HARD_RULES
): HardConstraintViolation | null {
  const {
    person, day, candidateShift, assignments, totalDays,
    requests, lockedRowIds, protectedCells,
  } = decision;
  const dayOfWeek = decision.dayOfWeek ?? -1;

  if (rules.lockedRow && (person.locked || lockedRowIds?.has(person.id))) {
    return 'LOCKED_ROW';
  }

  if (rules.protectedCell && protectedCells?.has(`${person.id}:${day}`)) {
    return 'PROTECTED_CELL';
  }

  if (rules.leaveCell && isLeaveCell(assignments[person.id]?.[day])) {
    return 'LEAVE_CELL';
  }

  if (rules.hardOff && violatesHardOff(requests, person.id, day, dayOfWeek)) {
    return 'HARD_OFF';
  }

  if (rules.essentialLeave || rules.leaveRequest) {
    const leave = findLeaveRequest(requests, person.id, day, dayOfWeek);
    if (leave) {
      if (leave.isEssential && rules.essentialLeave) return 'ESSENTIAL_LEAVE';
      if (rules.leaveRequest) return 'LEAVE_REQUEST';
    }
  }

  if (rules.morningOnly && decision.period) {
    const hasExplicitPlan = hasExplicitPlanForPeriod(
      requests, person.id, day, dayOfWeek, decision.period
    );
    const violates = violatesMorningOnly(
      person,
      decision.period,
      !!decision.isHoliday,
      hasExplicitPlan,
      rules.morningOnlyIncludesHoliday ?? true
    );
    if (violates) return 'MORNING_ONLY';
  }

  if (rules.nightRest) {
    const nightViolation = violatesNightRest(assignments, person.id, day, candidateShift);
    if (nightViolation) return nightViolation;
  }

  if (rules.consecutiveCap && violatesConsecutiveLimit(assignments, person.id, day, candidateShift, totalDays)) {
    return 'MAX_CONSECUTIVE';
  }

  return null;
}

/** نسخهٔ بولیِ `evaluateHardConstraints` برای فیلترهای انتخاب نامزد. */
export function canAssignShift(
  decision: Readonly<ShiftAssignmentDecision>,
  rules: Readonly<HardConstraintRules> = ALL_HARD_RULES
): boolean {
  return evaluateHardConstraints(decision, rules) === null;
}

// ---------------------------------------------------------------------------
// بزرگ‌ترین زیرمجموعهٔ مجازِ یک شیفت درخواستی
// ---------------------------------------------------------------------------

const PERIOD_ORDER: readonly ConstraintPeriod[] = ['M', 'E', 'N'];

const COMPONENTS_TO_SHIFT: Readonly<Record<string, ShiftType>> = {
  M: 'M', E: 'E', N: 'N', ME: 'ME', EN: 'EN', MN: 'MN', MEN: 'MEN',
};

/** مؤلفه‌های M/E/N یک شیفت (ترکیبی یا تک). */
export function shiftPeriods(shift: ShiftType | undefined): ConstraintPeriod[] {
  if (!shift) return [];
  return PERIOD_ORDER.filter(period => shiftContainsComponent(shift, period));
}

/**
 * زیرمجموعه‌های ناتهیِ یک شیفت، مرتب از «کامل‌ترین» به «کوچک‌ترین».
 * ترتیب کاملاً قطعی است: ابتدا بر اساس تعداد مؤلفه (نزولی)، سپس ترتیب M→E→N.
 */
export function shiftSubsetsByCoverage(shift: ShiftType): ShiftType[] {
  const periods = shiftPeriods(shift);
  const subsets: { key: string; size: number; rank: number }[] = [];

  for (let mask = 1; mask < 1 << periods.length; mask++) {
    const selected = periods.filter((_, index) => (mask & (1 << index)) !== 0);
    const key = PERIOD_ORDER.filter(period => selected.includes(period)).join('');
    subsets.push({ key, size: selected.length, rank: mask });
  }

  subsets.sort((left, right) => (right.size - left.size) || (left.rank - right.rank));
  return subsets.map(subset => COMPONENTS_TO_SHIFT[subset.key]).filter(Boolean);
}

/** نتیجهٔ تلاش برای اعمال یک شیفت درخواستی زیر سایهٔ محدودیت‌های سخت. */
export interface LegalShiftResolution {
  /** بزرگ‌ترین زیرمجموعهٔ مجاز از شیفت درخواستی، یا null اگر هیچ‌کدام مجاز نباشد. */
  shift: ShiftType | null;
  /** آیا دقیقاً همان شیفت درخواستی اعمال شد؟ */
  exact: boolean;
  /** نقضی که مانع اعمال شیفت کاملِ درخواستی شد (اگر اعمال کامل ممکن نبود). */
  blockedBy: HardConstraintViolation | null;
}

/**
 * بزرگ‌ترین زیرمجموعهٔ «مجاز» از یک شیفت درخواستی را پیدا می‌کند.
 *
 * فلسفه: درخواست صریح یک ورودی با اولویت بالاست و نباید به‌خاطر یک تعارض جزئی
 * کاملاً دور ریخته شود؛ اما هرگز هم نباید محدودیت سخت را بشکند. پس تا جایی که
 * قانونی است اجرا می‌شود (مثلاً وقتی شبِ سوم متوالی ممنوع است، از EN فقط E
 * می‌ماند) و تفاوت با درخواست، صریح گزارش می‌گردد.
 */
export function resolveLegalShiftForRequest(
  decision: Readonly<Omit<ShiftAssignmentDecision, 'candidateShift'>>,
  requestedShift: ShiftType,
  rules: Readonly<HardConstraintRules> = ALL_HARD_RULES
): LegalShiftResolution {
  const candidates = shiftSubsetsByCoverage(requestedShift);
  if (candidates.length === 0) {
    return { shift: null, exact: false, blockedBy: null };
  }

  let firstViolation: HardConstraintViolation | null = null;
  for (const candidate of candidates) {
    const violation = evaluateHardConstraints({ ...decision, candidateShift: candidate }, rules);
    if (!violation) {
      return { shift: candidate, exact: candidate === candidates[0], blockedBy: firstViolation };
    }
    if (firstViolation === null) firstViolation = violation;
  }

  return { shift: null, exact: false, blockedBy: firstViolation };
}
