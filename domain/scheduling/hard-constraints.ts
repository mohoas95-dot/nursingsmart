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
 * قرارداد فعلی:
 *   • سقف workload، استراحت شب، Hard OFF/leave، و ممنوعیت E/N برای
 *     Supervisor/Staff در تمام نویسندگان خودکار محدودیت سخت‌اند.
 *   • Soft OFF عمداً «سخت» نیست: در بن‌بست قابل نقض است. تفاوت Hard/Soft فقط
 *     از طریق `isHardOffRequest` تعیین می‌شود.
 */

import type { Personnel, ShiftRequest, ShiftType } from '../../lib/types';
import { isDayInRequestScope, patternStepForDay } from '../requests/request-scope-matcher';
import {
  MAX_CONSECUTIVE_NIGHTS as WORKLOAD_MAX_CONSECUTIVE_NIGHTS,
  isKnownWorkShift,
  isUnknownShift,
  shiftContainsComponent,
  shiftFromComponents,
  wouldBreachConsecutiveCap,
  wouldViolateNightRest,
  type AssignmentMap,
} from './workload';

/** دوره‌های زمانی روز که مبنای پوشش نیرو هستند. */
export type ConstraintPeriod = 'M' | 'E' | 'N';

/**
 * حداکثر شب‌های متوالی مجاز.
 *
 * این عدد از خودِ implementation استخراج شده است: در چینش حریصانهٔ
 * `solveNursingSchedule` اگر پرسنل در دو روز گذشته شب کار کرده باشد، شبِ سوم
 * غیرمجاز است (`workedN1 && workedN2 → reject`). یعنی سقف دو شب متوالی.
 */
export const MAX_CONSECUTIVE_NIGHTS = WORKLOAD_MAX_CONSECUTIVE_NIGHTS;

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
  | 'MAX_CONSECUTIVE'
  | 'UNKNOWN_SHIFT';

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
  MAX_CONSECUTIVE: 'سقف شیفت متوالی',
  UNKNOWN_SHIFT: 'شیفت ناشناخته',
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
      const step = patternStepForDay(request, day, dayOfWeek);
      if (step && shiftContainsComponent(step, period)) return true;
    }
  }
  return false;
}

/**
 * آیا تخصیص این دوره به سرپرستار/استاف، قانون صبح‌کاری را نقض می‌کند؟
 *
 * Domain rule:
 *   • Supervisor/Staff must never cover E or N, including an explicit request.
 *   • On holidays M is also rest by default; an explicit M plan may still opt into
 *     that holiday morning when the caller enables holiday-rest protection.
 *
 * @param includeHolidayRest If false, only the absolute E/N restriction applies.
 */
export function violatesMorningOnly(
  person: Pick<Personnel, 'position'>,
  period: ConstraintPeriod,
  isHoliday: boolean,
  hasExplicitPlan: boolean,
  includeHolidayRest = true
): boolean {
  if (!isMorningOnlyPosition(person)) return false;
  // E/N is absolute for Supervisor/Staff. Explicit requests and patterns cannot
  // turn this hard domain restriction into a legal coverage candidate.
  if (period === 'E' || period === 'N') return true;
  // Preserve the existing holiday-morning behavior: M is normally rest on a
  // holiday, but an explicit M plan can opt into it where that policy is enabled.
  return isHoliday && includeHolidayRest && !hasExplicitPlan;
}

// ---------------------------------------------------------------------------
// قانون: استراحت شب
// ---------------------------------------------------------------------------

/**
 * Backwards-compatible hard-constraint adapter around the authoritative workload
 * model's night-rest evaluator.
 */
export function violatesNightRest(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  candidateShift: ShiftType
): HardConstraintViolation | null {
  const violation = wouldViolateNightRest(assignments, personnelId, day, candidateShift);
  return violation === 'CONSECUTIVE_NIGHTS' ? 'NIGHT_REST_CONSECUTIVE_NIGHTS' : null;
}

// ---------------------------------------------------------------------------
// قانون: سقف شیفت متوالی
// ---------------------------------------------------------------------------

/**
 * آیا این تخصیص، سقف شیفت متوالی را می‌شکند؟
 * پوشش نازکی روی `wouldBreachConsecutiveCap` تا همهٔ نقاط تصمیم‌گیری از یک نام
 * و یک تعریف استفاده کنند (منبع حقیقت workload.ts است).
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
  /** Reject unknown shift strings rather than inventing a safe workload. */
  knownShift?: boolean;
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
  knownShift: true,
};

/**
 * قوانینی که هنگام نوشتن «درخواست شیفت صریح» سخت‌اند.
 *
 * ترتیب اولویت: محدودیت سخت > قفل/محافظت > درخواست صریح > سایر ترجیحات.
 * درخواست صریح هیچ استثنایی برای ممنوعیت E/N Supervisor/Staff ایجاد نمی‌کند.
 */
export const EXPLICIT_REQUEST_HARD_RULES: HardConstraintRules = {
  hardOff: true,
  essentialLeave: true,
  leaveRequest: true,
  leaveCell: true,
  lockedRow: true,
  protectedCell: true,
  // Explicit requests must not bypass the absolute Supervisor/Staff E/N ban.
  morningOnly: true,
  nightRest: true,
  consecutiveCap: true,
  knownShift: true,
};

/**
 * قوانینی که هنگام «شکستن زنجیرهٔ آف» (پس‌پردازش solver) سخت‌اند.
 *
 * این قاعده کم‌اولویت است و صرفاً برای رعایت سقف ۳ روز آف متوالی اجرا می‌شود؛
 * پس هرگز نباید آفِ قطعی، مرخصی، قفل، استراحت شب، سقف workload، یا محدودیت
 * E/N Supervisor/Staff را نقض کند.
 */
export const OFF_BREAKER_HARD_RULES: HardConstraintRules = {
  hardOff: true,
  essentialLeave: true,
  leaveRequest: true,
  leaveCell: true,
  lockedRow: true,
  morningOnly: true,
  nightRest: true,
  consecutiveCap: true,
  knownShift: true,
};

/**
 * قوانین سختِ مسیر اضطراری solver.
 *
 * Emergency means broader search among legal candidates; it never permits a
 * hard OFF/leave/lock breach, workload-cap breach, night-rest breach, or
 * Supervisor/Staff E/N assignment.
 */
export const EMERGENCY_FILL_HARD_RULES: HardConstraintRules = {
  hardOff: true,
  essentialLeave: true,
  leaveRequest: true,
  leaveCell: true,
  lockedRow: true,
  protectedCell: true,
  morningOnly: true,
  // Holiday M-rest remains a scheduling policy, but E/N is absolute.
  morningOnlyIncludesHoliday: false,
  nightRest: true,
  consecutiveCap: true,
  knownShift: true,
};

/**
 * قوانین سخت هنگام جبران کمبود پوشش در `reconcileStaffingCoverage`.
 * A remaining shortage is preferred to intentionally violating any enabled rule.
 */
export const COVERAGE_FILL_HARD_RULES: HardConstraintRules = {
  hardOff: true,
  essentialLeave: true,
  leaveRequest: true,
  leaveCell: true,
  lockedRow: true,
  protectedCell: true,
  morningOnly: true,
  // Coverage filling enforces the absolute E/N restriction but may still use a
  // Supervisor/Staff morning on a holiday when required.
  morningOnlyIncludesHoliday: false,
  nightRest: true,
  consecutiveCap: true,
  knownShift: true,
};

/**
 * Rules for validating an already-written work assignment. Lock/protected and
 * leave-cell checks are intentionally absent: a verifier reports schedule
 * legality, not whether a historic assignment was editable.
 */
export const VERIFICATION_HARD_RULES: HardConstraintRules = {
  hardOff: true,
  essentialLeave: true,
  leaveRequest: true,
  morningOnly: true,
  morningOnlyIncludesHoliday: false,
  nightRest: true,
  consecutiveCap: true,
  knownShift: true,
};

/** A composable, machine-readable hard-legality result for one candidate assignment. */
export interface HardConstraintEvaluation {
  legal: boolean;
  violations: HardConstraintViolation[];
}

/**
 * Evaluate every enabled hard rule in a stable order. Callers that only need the
 * historical first reason can continue using `evaluateHardConstraints` below.
 */
export function evaluateHardConstraintViolations(
  decision: Readonly<ShiftAssignmentDecision>,
  rules: Readonly<HardConstraintRules> = ALL_HARD_RULES
): HardConstraintViolation[] {
  const {
    person, day, candidateShift, assignments, totalDays,
    requests, lockedRowIds, protectedCells,
  } = decision;
  const dayOfWeek = decision.dayOfWeek ?? UNKNOWN_DAY_OF_WEEK;
  const violations: HardConstraintViolation[] = [];
  const add = (violation: HardConstraintViolation) => {
    if (!violations.includes(violation)) violations.push(violation);
  };

  if (rules.knownShift && isUnknownShift(candidateShift)) add('UNKNOWN_SHIFT');
  // The lock is a MONTHLY concept: only the month's locked-row ids apply.
  // The global `person.locked` field is not a scheduling lock (monthly policy).
  if (rules.lockedRow && lockedRowIds?.has(person.id)) add('LOCKED_ROW');
  if (rules.protectedCell && protectedCells?.has(`${person.id}:${day}`)) add('PROTECTED_CELL');
  if (rules.leaveCell && isLeaveCell(assignments[person.id]?.[day])) add('LEAVE_CELL');
  if (rules.hardOff && violatesHardOff(requests, person.id, day, dayOfWeek)) add('HARD_OFF');

  if (rules.essentialLeave || rules.leaveRequest) {
    const leave = findLeaveRequest(requests, person.id, day, dayOfWeek);
    if (leave) {
      if (leave.isEssential && rules.essentialLeave) add('ESSENTIAL_LEAVE');
      else if (rules.leaveRequest) add('LEAVE_REQUEST');
    }
  }

  if (rules.morningOnly) {
    const periods = decision.period ? [decision.period] : shiftPeriods(candidateShift);
    for (const period of periods) {
      const hasExplicitPlan = hasExplicitPlanForPeriod(requests, person.id, day, dayOfWeek, period);
      if (violatesMorningOnly(
        person,
        period,
        !!decision.isHoliday,
        hasExplicitPlan,
        rules.morningOnlyIncludesHoliday ?? true
      )) {
        add('MORNING_ONLY');
        break;
      }
    }
  }

  if (rules.nightRest) {
    const nightViolation = violatesNightRest(assignments, person.id, day, candidateShift);
    if (nightViolation) add(nightViolation);
  }

  if (rules.consecutiveCap && violatesConsecutiveLimit(assignments, person.id, day, candidateShift, totalDays)) {
    add('MAX_CONSECUTIVE');
  }

  return violations;
}

/** Structured legality API for all candidate-assignment callers. */
export function evaluateHardConstraintLegality(
  decision: Readonly<ShiftAssignmentDecision>,
  rules: Readonly<HardConstraintRules> = ALL_HARD_RULES
): HardConstraintEvaluation {
  const violations = evaluateHardConstraintViolations(decision, rules);
  return { legal: violations.length === 0, violations };
}

/** Backwards-compatible first-violation adapter. */
export function evaluateHardConstraints(
  decision: Readonly<ShiftAssignmentDecision>,
  rules: Readonly<HardConstraintRules> = ALL_HARD_RULES
): HardConstraintViolation | null {
  return evaluateHardConstraintViolations(decision, rules)[0] ?? null;
}

/** Boolean adapter for candidate filters. */
export function canAssignShift(
  decision: Readonly<ShiftAssignmentDecision>,
  rules: Readonly<HardConstraintRules> = ALL_HARD_RULES
): boolean {
  return evaluateHardConstraintLegality(decision, rules).legal;
}

// ---------------------------------------------------------------------------
// بزرگ‌ترین زیرمجموعهٔ مجازِ یک شیفت درخواستی
// ---------------------------------------------------------------------------

const PERIOD_ORDER: readonly ConstraintPeriod[] = ['M', 'E', 'N'];

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
  return subsets
    .map(subset => shiftFromComponents(subset.key.split('') as ConstraintPeriod[]))
    .filter((candidate): candidate is ShiftType => !!candidate);
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
  if (!isKnownWorkShift(requestedShift)) {
    return { shift: null, exact: false, blockedBy: 'UNKNOWN_SHIFT' };
  }

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
