/**
 * SmartRules — Domain Layer (Pure Functions)
 *
 * قوانین هوشمند بازتولید برنامه پرستاران و کمک‌بهیاران.
 *
 * RESPONSIBILITY:
 *   1. سقف کارکرد متوالی: مجموع واحدهای شیفت پشت‌سرهم هرگز نباید از ۵ بیشتر شود.
 *      وزن هر روز: ‏M = 1، ‏E = 1، ‏N = 2 — بنابراین ME = 2، ‏EN = 3، ‏MN = 3، ‏MEN = 4.
 *      مثال: شیفت MEN (۴ واحد) و فردای آن ME (۲ واحد) = ۶ واحد → غیرمجاز.
 *   2. استراحت اجباری: بلافاصله پس از رسیدن زنجیره متوالی به ۵ واحد، روز بعد باید
 *      استراحت (آف یا مرخصی) باشد. این قانون به‌صورت ذاتی از قانون ۱ نتیجه می‌شود،
 *      چون ادامه کارکردن مجموع را بیشتر از ۵ می‌کند.
 *   3. ممنوعیت شیفت تک‌تک: قرار گرفتن یک شیفت تک‌مؤلفه (به‌ویژه عصر/E) میان
 *      روزهای کاری با مؤلفه متفاوت غیرمجاز است؛ چیدمان باید الگوی پیوسته داشته باشد
 *      و به تگ روتین کاری هر نفر احترام بگذارد.
 *   4. مرخصی روز تعطیل رسمی: روز تعطیلی که درخواست مرخصی روی آن ثبت شده دقیقاً
 *      ۷ ساعت اعتبار مرخصی در محاسبات ساعت موظفی دارد (مارکر LH).
 *
 * PURE: بدون وابستگی به React، Next.js یا I/O.
 */

import type { Personnel, ShiftType, WorkRoutineTag } from '../../lib/types';

export type AssignmentMap = Readonly<Record<string, Readonly<Record<number, ShiftType>>>>;

// ============================================================================
// قانون ۱ و ۲: سقف ۵ شیفت متوالی و استراحت اجباری
// ============================================================================

/** سقف مجموع واحدهای شیفت پشت‌سرهم. */
export const MAX_CONSECUTIVE_SHIFT_UNITS = 5;

/** وزن هر شیفت بر اساس قانون: M = 1، E = 1، N = 2. */
export const SHIFT_SEQUENCE_WEIGHT: Readonly<Record<string, number>> = {
  M: 1,
  E: 1,
  N: 2,
  ME: 2,
  EN: 3,
  MN: 3,
  MEN: 4,
  OFF: 0,
};

/** آیا این شیفت یک روز کاری است؟ (آف و مرخصی روز کاری محسوب نمی‌شوند.) */
export function isWorkShift(shift: ShiftType | undefined): boolean {
  return !!shift && shift !== 'OFF' && !shift.startsWith('L');
}

/** وزن زنجیره‌ای یک شیفت؛ برای آف و مرخصی صفر است. */
export function getShiftWeight(shift: ShiftType | undefined): number {
  if (!isWorkShift(shift)) return 0;
  return SHIFT_SEQUENCE_WEIGHT[shift as string] ?? 0;
}

/**
 * مجموع واحدهای زنجیره کاری متوالی حول یک روز مشخص با احتساب یک تخصیص فرضی.
 * زنجیره از هر دو سو تا رسیدن به روز غیرکاری (آف/مرخصی) ادامه می‌یابد.
 */
export function getRunWeightAroundDay(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  totalDays: number,
  overrideShift?: ShiftType
): number {
  const resolve = (d: number): ShiftType | undefined =>
    d === day && overrideShift !== undefined ? overrideShift : assignments[personnelId]?.[d];

  let weight = getShiftWeight(resolve(day));

  for (let d = day - 1; d >= 1; d--) {
    const w = getShiftWeight(assignments[personnelId]?.[d]);
    if (w === 0) break;
    weight += w;
  }
  for (let d = day + 1; d <= totalDays; d++) {
    const w = getShiftWeight(assignments[personnelId]?.[d]);
    if (w === 0) break;
    weight += w;
  }
  return weight;
}

/**
 * آیا تخصیص candidateShift در روز day، زنجیره متوالی را از سقف ۵ واحد عبور می‌دهد؟
 * اگر زنجیره قبلی دقیقاً ۵ واحد باشد، هر شیفت کاری جدید نقض محسوب می‌شود و عملاً
 * «استراحت اجباری پس از ۵ شیفت» را هم اعمال می‌کند.
 */
export function wouldBreachConsecutiveCap(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  candidateShift: ShiftType,
  totalDays: number
): boolean {
  if (!isWorkShift(candidateShift)) return false;
  return getRunWeightAroundDay(assignments, personnelId, day, totalDays, candidateShift) > MAX_CONSECUTIVE_SHIFT_UNITS;
}

export interface ConsecutiveRunSummary {
  startDay: number;
  endDay: number;
  weight: number;
}

/** تمام زنجیره‌های کاری متوالی پرسنل در ماه (برای تحلیل و هشدار). */
export function findConsecutiveRuns(
  assignments: AssignmentMap,
  personnelId: string,
  totalDays: number
): ConsecutiveRunSummary[] {
  const runs: ConsecutiveRunSummary[] = [];
  let runStart = 0;
  let weight = 0;

  for (let d = 1; d <= totalDays; d++) {
    const w = getShiftWeight(assignments[personnelId]?.[d]);
    if (w === 0) {
      if (weight > 0) runs.push({ startDay: runStart, endDay: d - 1, weight });
      runStart = 0;
      weight = 0;
    } else {
      if (weight === 0) runStart = d;
      weight += w;
    }
  }
  if (weight > 0) runs.push({ startDay: runStart, endDay: totalDays, weight });
  return runs;
}

/** زنجیره‌هایی که از سقف ۵ واحد عبور کرده‌اند. */
export function findConsecutiveCapViolations(
  assignments: AssignmentMap,
  personnelId: string,
  totalDays: number
): ConsecutiveRunSummary[] {
  return findConsecutiveRuns(assignments, personnelId, totalDays).filter(
    run => run.weight > MAX_CONSECUTIVE_SHIFT_UNITS
  );
}

/**
 * آیا پرسنل در پایان ماه به سقف متوالی رسیده و نیاز به استراحت اجباری در ابتدای
 * ماه بعد دارد؟
 */
export function endsMonthAtCapWithoutRest(
  assignments: AssignmentMap,
  personnelId: string,
  totalDays: number
): boolean {
  const runs = findConsecutiveRuns(assignments, personnelId, totalDays);
  const lastRun = runs[runs.length - 1];
  return !!lastRun && lastRun.endDay === totalDays && lastRun.weight >= MAX_CONSECUTIVE_SHIFT_UNITS;
}

// ============================================================================
// قانون ۳: ممنوعیت شیفت تک‌تک و احترام به تگ روتین کاری
// ============================================================================

/** شیفت‌های ترجیحی هر تگ روتین کاری. */
export const ROUTINE_PREFERRED_SHIFTS: Readonly<Record<WorkRoutineTag, readonly ShiftType[]>> = {
  // صبح‌کار: کسانی که معمولاً به‌صورت M تک می‌آیند.
  morning: ['M'],
  // عصر و شب‌کار: کسانی که معمولاً EN یا MEN یا N یا NM(MN) می‌آیند.
  evening_night: ['EN', 'MEN', 'N', 'MN'],
  // لانگ‌کار: کسانی که معمولاً ME می‌آیند.
  long: ['ME'],
};

/** آیا شیفت با تگ روتین کاری پرسنل سازگار است؟ */
export function shiftMatchesRoutine(shift: ShiftType | undefined, routine: WorkRoutineTag | undefined): boolean {
  if (!routine || !shift) return false;
  return (ROUTINE_PREFERRED_SHIFTS[routine] as readonly ShiftType[]).includes(shift);
}

const SHIFT_COMPONENTS: Readonly<Record<string, readonly string[]>> = {
  M: ['M'],
  E: ['E'],
  N: ['N'],
  ME: ['M', 'E'],
  EN: ['E', 'N'],
  MN: ['M', 'N'],
  MEN: ['M', 'E', 'N'],
  OFF: [],
};

const SINGLE_COMPONENT_SHIFTS: ReadonlySet<string> = new Set(['M', 'E', 'N']);

/** آیا شیفت (احتمالاً ترکیبی) شامل مؤلفه مشخصی است؟ */
export function shiftContainsComponent(shift: ShiftType | undefined, component: 'M' | 'E' | 'N'): boolean {
  if (!shift) return false;
  return SHIFT_COMPONENTS[shift]?.includes(component) ?? false;
}

/**
 * نزدیک‌ترین روز کاری قبلی/بعدی را پیدا می‌کند؛ حداکثر یک روز غیرکاری بینابینی
 * نادیده گرفته می‌شود تا الگوی پیوسته حفظ شود.
 */
function nearestWorkShift(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  direction: -1 | 1,
  totalDays: number
): ShiftType | null {
  let skipped = 0;
  for (let d = day + direction; d >= 1 && d <= totalDays; d += direction) {
    const shift = assignments[personnelId]?.[d];
    if (isWorkShift(shift)) return shift;
    skipped += 1;
    if (skipped > 1) return null;
  }
  return null;
}

/**
 * آیا شیفت روز مشخص، یک «شیفت تک‌تک» است؟
 * شیفت تک‌تک = شیفت تک‌مؤلفه (M/E/N) که نزدیک‌ترین روزهای کاری قبل و بعد آن
 * همان مؤلفه را ندارند؛ یعنی میان روزهای کاری با الگوی متفاوت گیر افتاده است.
 * در مرز ماه (فقدان قرینه‌سازی از سمت ماه قبل/بعد) محتاطانه نقض اعلام نمی‌شود.
 */
export function isIsolatedSingleShiftAt(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  totalDays: number,
  overrideShift?: ShiftType
): boolean {
  const shift = overrideShift ?? assignments[personnelId]?.[day];
  if (!shift || !SINGLE_COMPONENT_SHIFTS.has(shift as string)) return false;
  const component = shift as 'M' | 'E' | 'N';

  const previous = nearestWorkShift(assignments, personnelId, day, -1, totalDays);
  const next = nearestWorkShift(assignments, personnelId, day, 1, totalDays);

  // نقض قطعی فقط وقتی است که هر دو همسایه کاری با الگوی متفاوت موجود باشند.
  if (!previous || !next) return false;
  return !shiftContainsComponent(previous, component) && !shiftContainsComponent(next, component);
}

/**
 * نسخه پیش‌بینی‌کننده برای زمان ساخت برنامه: روزهای آینده هنوز تخصیص نیافته‌اند،
 * پس اگر همسایه کاری قبلی الگو را بشکند و بعدی مشخص نباشد یا بشکند، این تخصیص
 * در حال ساخت یک شیفت تک‌تک است و باید در اولویت‌بندی جریمه شود.
 */
export function wouldCreateIsolatedShift(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  totalDays: number,
  overrideShift: ShiftType
): boolean {
  const shift = overrideShift;
  if (!shift || !SINGLE_COMPONENT_SHIFTS.has(shift as string)) return false;
  const component = shift as 'M' | 'E' | 'N';

  const previous = nearestWorkShift(assignments, personnelId, day, -1, totalDays);
  if (!previous) return false;
  if (shiftContainsComponent(previous, component)) return false;

  const next = nearestWorkShift(assignments, personnelId, day, 1, totalDays);
  return !next || !shiftContainsComponent(next, component);
}

/**
 * آیا این «شیفت تک» طبق تگ روتین کاری پرسنل مجاز است؟
 * پرسنل صبح‌کار ذاتاً با شیفت‌های M تک کار می‌کنند، پس M تک برایشان تک‌تک محسوب نمی‌شود.
 */
export function isRoutineAllowedSingleShift(shift: ShiftType | undefined, routine: WorkRoutineTag | undefined): boolean {
  return shift === 'M' && routine === 'morning';
}

/** تمام روزهای دارای شیفت تک‌تک غیرمجاز برای یک پرسنل (برای هشدار و ترمیم). */
export function findIsolatedSingleShiftDays(
  assignments: AssignmentMap,
  personnelId: string,
  totalDays: number,
  routine?: WorkRoutineTag
): number[] {
  const days: number[] = [];
  for (let d = 1; d <= totalDays; d++) {
    const shift = assignments[personnelId]?.[d];
    if (isRoutineAllowedSingleShift(shift, routine)) continue;
    if (isIsolatedSingleShiftAt(assignments, personnelId, d, totalDays)) {
      days.push(d);
    }
  }
  return days;
}

/** پرسنلِ شخص از روی شناسه برمی‌گرداند؛ برای پیام‌های هشدار فارسی. */
export function personnelDisplayName(person: Pick<Personnel, 'firstName' | 'lastName'>): string {
  return `${person.firstName} ${person.lastName}`;
}

// ============================================================================
// قانون ۴: مرخصی روز تعطیل رسمی
// ============================================================================

/**
 * مارکر تخصیص «مرخصی واقع در روز تعطیل رسمی».
 * با حرف L شروع می‌شود تا در تمام منطق‌های موجود به‌عنوان مرخصی شناخته شود.
 */
export const HOLIDAY_LEAVE_SHIFT: ShiftType = 'LH';

/** اعتبار دقیق مرخصی روز تعطیل: ۷ ساعت برای همه انواع استخدام. */
export const HOLIDAY_LEAVE_HOURS = 7.0;

export function isHolidayLeaveShift(shift: ShiftType | undefined): boolean {
  return shift === HOLIDAY_LEAVE_SHIFT;
}
