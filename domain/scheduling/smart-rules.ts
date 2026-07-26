/**
 * SmartRules — Domain Layer (Pure Functions)
 *
 * قوانین هوشمند بازتولید برنامه پرستاران و کمک‌بهیاران.
 *
 * RESPONSIBILITY:
 *   1. سقف ۵ شیفت متوالی: هر روز سه جایگاه زمانی به ترتیب دارد (صبح M، عصر E، شب N)
 *      و دنبالهٔ زمانیِ حضور به‌صورت …M,E,N,M,E,N… در نظر گرفته می‌شود. «شیفت متوالی»
 *      یعنی جایگاه‌های کاریِ پشت‌سرهم بدون هیچ جایگاه خالی بینشان:
 *        - E بعد از M (در همان روز)، N بعد از E (در همان روز)،
 *        - و Mِ روز بعد پس از Nِ دیشب (در مرز دو روز).
 *      هر جایگاه به اندازهٔ «واحد شیفت»اش وزن دارد (صبح ۱، عصر ۱، شب ۲) و تا ۵ واحد
 *      شیفت متوالی مجاز است؛ بیشتر از ۵ واحد (۶ به بالا) ممنوع است.
 *      نکتهٔ کلیدی: وجود حتی یک جایگاه خالی، زنجیره را قطع می‌کند. بنابراین پنج روز
 *      که هر کدام فقط M باشد متوالی محسوب نمی‌شود، چون بین دو M یک E و یک Nِ خالی
 *      وجود دارد. مثال‌ها:
 *        - MEN (روز ۱) + M (روز ۲) = ۱+۱+۲+۱ = ۵ واحد → مجاز (روی حد).
 *        - MEN (روز ۱) + ME (روز ۲) = ۱+۱+۲+۱+۱ = ۶ واحد → ممنوع.
 *        - MN در یک روز = M و N با جای خالیِ E بینشان → دو زنجیرهٔ جداگانه.
 *   2. استراحت اجباری: بلافاصله پس از رسیدن زنجیرهٔ متوالی به ۵ واحد (سقف مجاز)،
 *      هر شیفت کاریِ دیگری زنجیره را از ۵ فراتر می‌برد و ممنوع است؛ پس عملاً یک
 *      استراحت (آف یا مرخصی) لازم می‌شود. این قانون ذاتاً از قانون ۱ نتیجه می‌شود.
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
//
// مدل «شیفت متوالی» (اسلات‌محور و وزن‌دار):
//   هر روز سه جایگاه زمانیِ مرتب دارد: صبح (M)، عصر (E)، شب (N). دنبالهٔ زمانیِ حضور
//   به‌صورت یک خطِ پیوسته در نظر گرفته می‌شود:
//     روز۱.M ، روز۱.E ، روز۱.N ، روز۲.M ، روز۲.E ، روز۲.N ، …
//   یک جایگاه «کاری» است اگر شیفتِ آن روز شامل آن مؤلفه باشد. «زنجیرهٔ متوالی» یعنی
//   بزرگ‌ترین بلوکِ جایگاه‌های کاریِ پشت‌سرهم در این خط، به‌شرطی که هیچ جایگاه خالی
//   بینشان نباشد.
//
//   وزن هر جایگاه برابر تعداد «واحد شیفت» آن است: صبح و عصر هرکدام یک واحد (۶٫۵ ساعت)
//   و شب دو واحد (۱۲٫۵ ساعت ≈ دو برابر یک شیفت عادی). این وزن‌دهی باعث می‌شود قانون
//   به هیچ ترکیب خاصی وابسته نباشد و «هر گونه» شیفت متوالیِ بیش از حد مجاز، مستقل از
//   اینکه از چه الگویی ساخته شده باشد، نقض شمرده شود.
//
//   حد مجاز: تا ۵ واحد شیفت متوالی مجاز است؛ بیشتر از ۵ واحد (یعنی ۶ به بالا) ممنوع.
//
//   نمونه‌ها (همه بر پایهٔ همین یک قانون واحد، بدون استثنای شیفت‌محور):
//     - MEN تنها → ۱+۱+۲ = ۴ → مجاز.
//     - EN (روز۱) + M (روز۲) → ۱+۲+۱ = ۴ → مجاز (معادل بلوک ۲۴ساعته).
//     - MEN (روز۱) + M (روز۲) → ۱+۱+۲+۱ = ۵ → مجاز (دقیقاً روی حد).
//     - EN (روز۱) + ME (روز۲) → ۱+۲+۱+۱ = ۵ → مجاز (دقیقاً روی حد).
//     - MEN (روز۱) + ME (روز۲) → ۱+۱+۲+۱+۱ = ۶ → ممنوع.
//     - N (روز۱) + MEN (روز۲) → ۲+۱+۱+۲ = ۶ → ممنوع.
//     - EN (روز۱) + MEN (روز۲) → ۱+۲+۱+۱+۲ = ۷ → ممنوع.
//   در نتیجه:
//     - E بعد از M و N بعد از E (در یک روز) و Mِ فردا پس از Nِ دیشب، متوالی‌اند.
//     - هر جایگاه خالی (مثلاً E یا Nِ خالی بین دو M در دو روز پیاپی) زنجیره را قطع
//       می‌کند؛ پس پنج روز فقط M، پنج زنجیرهٔ جداگانهٔ ۱واحدی است و متوالی محسوب نمی‌شود.

/**
 * حداکثر تعداد واحدهای شیفتِ متوالیِ مجاز.
 * ۵ واحد مجاز است؛ بیشتر از ۵ واحد شیفت متوالی (۶ به بالا) ممنوع است.
 */
export const MAX_CONSECUTIVE_SHIFTS = 5;

/** ترتیب جایگاه‌های زمانی هر روز که مبنای شمارش شیفت متوالی است. */
const DAY_PERIODS = ['M', 'E', 'N'] as const;
type DayPeriod = (typeof DAY_PERIODS)[number];

/**
 * وزن (تعداد واحد شیفت) هر جایگاه زمانی.
 * شب ۱۲٫۵ ساعت است — تقریباً دو برابر صبح/عصر (۶٫۵ ساعت) — پس دو واحد شمرده می‌شود.
 * همین وزن‌دهی است که قانون را «شیفت‌مستقل» می‌کند: هر ترکیبی که از ۵ واحد متوالی
 * فراتر رود ممنوع است، فارغ از اینکه MEN+ME باشد یا N+MEN یا EN+MEN.
 */
const PERIOD_WEIGHTS: Readonly<Record<DayPeriod, number>> = { M: 1, E: 1, N: 2 };

/** وزن جایگاه بر اساس اندیس آن در DAY_PERIODS. */
function periodWeight(periodIndex: number): number {
  return PERIOD_WEIGHTS[DAY_PERIODS[periodIndex]];
}

/** آیا این شیفت یک روز کاری است؟ (آف و مرخصی روز کاری محسوب نمی‌شوند.) */
export function isWorkShift(shift: ShiftType | undefined): boolean {
  return !!shift && shift !== 'OFF' && !shift.startsWith('L');
}

/** اندیسِ خطیِ یک جایگاه زمانی در دنبالهٔ سراسری ماه (هر روز ۳ جایگاه دارد). */
function slotIndex(day: number, periodIndex: number): number {
  return (day - 1) * DAY_PERIODS.length + periodIndex;
}

/**
 * آیا پرسنل در جایگاه زمانیِ مشخصِ یک روز حضور دارد؟
 * اگر روز با overrideDay مطابقت کند، شیفت فرضیِ overrideShift به‌جای تخصیص واقعی
 * همان روز در نظر گرفته می‌شود (برای ارزیابی پیش‌نگر هنگام ساخت برنامه).
 */
function isSlotWorked(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  periodIndex: number,
  overrideDay?: number,
  overrideShift?: ShiftType
): boolean {
  const shift =
    day === overrideDay && overrideShift !== undefined
      ? overrideShift
      : assignments[personnelId]?.[day];
  return shiftContainsComponent(shift, DAY_PERIODS[periodIndex]);
}

export interface ConsecutiveRunSummary {
  /** اولین روز زنجیره. */
  startDay: number;
  /** آخرین روز زنجیره. */
  endDay: number;
  /** اولین دورهٔ کاری زنجیره (M/E/N). */
  startPeriod: DayPeriod;
  /** آخرین دورهٔ کاری زنجیره (M/E/N). */
  endPeriod: DayPeriod;
  /**
   * تعداد واحدهای شیفتِ متوالی در این زنجیره (شب ۲ واحد، صبح/عصر هرکدام ۱ واحد).
   * مبنای سنجش سقف ۵ شیفت متوالی همین مقدار است.
   */
  length: number;
  /** تعداد جایگاه‌های زمانیِ اشغال‌شده در زنجیره (بدون وزن‌دهی) — برای گزارش‌گیری. */
  slotCount: number;
}

/** خلاصهٔ یک زنجیره از روی اندیس شروع و پایانِ جایگاه‌ها می‌سازد. */
function buildRunSummary(startSlot: number, endSlot: number): ConsecutiveRunSummary {
  let weighted = 0;
  for (let slot = startSlot; slot <= endSlot; slot++) {
    weighted += periodWeight(slot % DAY_PERIODS.length);
  }
  return {
    startDay: Math.floor(startSlot / DAY_PERIODS.length) + 1,
    endDay: Math.floor(endSlot / DAY_PERIODS.length) + 1,
    startPeriod: DAY_PERIODS[startSlot % DAY_PERIODS.length],
    endPeriod: DAY_PERIODS[endSlot % DAY_PERIODS.length],
    length: weighted,
    slotCount: endSlot - startSlot + 1,
  };
}

/**
 * تمام زنجیره‌های کاری متوالی پرسنل در ماه (برای تحلیل و هشدار).
 * زنجیره = بزرگ‌ترین بلوکِ جایگاه‌های کاریِ پشت‌سرهم در دنبالهٔ M,E,N,M,E,N,…
 * هر جایگاه خالی (آف/مرخصی یا مؤلفهٔ کارنشده) زنجیره را قطع می‌کند.
 */
export function findConsecutiveRuns(
  assignments: AssignmentMap,
  personnelId: string,
  totalDays: number,
  overrideDay?: number,
  overrideShift?: ShiftType
): ConsecutiveRunSummary[] {
  const runs: ConsecutiveRunSummary[] = [];
  const totalSlots = totalDays * DAY_PERIODS.length;
  let runStart = -1;

  for (let slot = 0; slot < totalSlots; slot++) {
    const day = Math.floor(slot / DAY_PERIODS.length) + 1;
    const periodIndex = slot % DAY_PERIODS.length;
    const worked = isSlotWorked(assignments, personnelId, day, periodIndex, overrideDay, overrideShift);
    if (worked) {
      if (runStart === -1) runStart = slot;
    } else if (runStart !== -1) {
      runs.push(buildRunSummary(runStart, slot - 1));
      runStart = -1;
    }
  }
  if (runStart !== -1) runs.push(buildRunSummary(runStart, totalSlots - 1));
  return runs;
}

/**
 * زنجیره‌هایی که از ۵ واحد شیفت متوالی فراتر رفته‌اند (غیرمجاز).
 * این بررسی کاملاً شیفت‌مستقل است: هر ترکیبی (MEN+ME، N+MEN، EN+MEN، MEN+MEN و …)
 * که مجموع واحدهای متوالی‌اش از ۵ بگذرد، نقض شمرده می‌شود.
 */
export function findConsecutiveCapViolations(
  assignments: AssignmentMap,
  personnelId: string,
  totalDays: number
): ConsecutiveRunSummary[] {
  return findConsecutiveRuns(assignments, personnelId, totalDays).filter(
    run => run.length > MAX_CONSECUTIVE_SHIFTS
  );
}

/**
 * آیا تخصیص candidateShift در روز day، زنجیرهٔ متوالی را از ۵ واحد فراتر می‌برد؟
 * تنها زنجیره‌هایی می‌توانند تغییر کنند که از جایگاه‌های همان روز day عبور می‌کنند،
 * بنابراین فقط همان‌ها بررسی می‌شوند. اگر زنجیرهٔ عبوری از day از ۵ واحد بگذرد نقض
 * است و عملاً «استراحت اجباری پس از ۵ واحد شیفت متوالی» را هم اعمال می‌کند.
 */
export function wouldBreachConsecutiveCap(
  assignments: AssignmentMap,
  personnelId: string,
  day: number,
  candidateShift: ShiftType,
  totalDays: number
): boolean {
  if (!isWorkShift(candidateShift)) return false;

  const dayStartSlot = slotIndex(day, 0);
  const dayEndSlot = slotIndex(day, DAY_PERIODS.length - 1);
  const runs = findConsecutiveRuns(assignments, personnelId, totalDays, day, candidateShift);

  return runs.some(run => {
    const runStartSlot = slotIndex(run.startDay, DAY_PERIODS.indexOf(run.startPeriod));
    const runEndSlot = slotIndex(run.endDay, DAY_PERIODS.indexOf(run.endPeriod));
    const overlapsDay = runStartSlot <= dayEndSlot && runEndSlot >= dayStartSlot;
    return overlapsDay && run.length > MAX_CONSECUTIVE_SHIFTS;
  });
}

/**
 * آیا پرسنل در پایان ماه به سقف متوالی رسیده و نیاز به استراحت اجباری در ابتدای
 * ماه بعد دارد؟ یعنی آخرین زنجیره دقیقاً تا آخرین جایگاه ماه (شبِ آخرین روز) ادامه
 * داشته و طولش به سقف مجاز (۵ واحد) رسیده باشد؛ در این صورت هر شیفتِ ماه بعد آن را
 * از ۵ فراتر می‌برد و ممنوع است.
 */
export function endsMonthAtCapWithoutRest(
  assignments: AssignmentMap,
  personnelId: string,
  totalDays: number
): boolean {
  const runs = findConsecutiveRuns(assignments, personnelId, totalDays);
  const lastRun = runs[runs.length - 1];
  if (!lastRun) return false;
  return (
    lastRun.endDay === totalDays &&
    lastRun.endPeriod === 'N' &&
    lastRun.length >= MAX_CONSECUTIVE_SHIFTS
  );
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

/**
 * دوره‌های زمانی مجاز برای هر تگ روتین کاری هنگام تخصیص تدریجی solver.
 * نفراتی که تگ روتین دارند و هیچ درخواست شیفت/الگویی ثبت نکرده‌اند، فقط در
 * همین دوره‌ها چیده می‌شوند تا چینش دقیقاً بر اساس تگشان انجام شود:
 *  - صبح‌کار: فقط صبح (نتیجه نهایی M)
 *  - لانگ‌کار: صبح و عصر (نتیجه نهایی ME)
 *  - عصر و شب‌کار: عصر و شب (نتیجه نهایی EN یا N)
 */
export const ROUTINE_PERIOD_ACCESS: Readonly<Record<WorkRoutineTag, readonly ('M' | 'E' | 'N')[]>> = {
  morning: ['M'],
  long: ['M', 'E'],
  evening_night: ['E', 'N'],
};

/** آیا دوره زمانی موردنظر برای تگ روتین کاری مجاز است؟ */
export function routineAllowsPeriodAdd(routine: WorkRoutineTag | undefined, period: 'M' | 'E' | 'N'): boolean {
  if (!routine) return true;
  return (ROUTINE_PERIOD_ACCESS[routine] as readonly string[]).includes(period);
}

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

/**
 * برای تخصیص دستی «مرخصی» از منوی سلول شیفت: شماره روز مرخصی بر اساس تعداد
 * روزهای پیاپی مرخصیِ بلافاصله قبل تعیین می‌شود تا در لیست، روز اول عدد ۱، روز
 * دوم عدد ۲ و الی آخر نمایش داده شود. مرخصی تعطیل (LH) شماره‌دار نیست و زنجیره
 * شمارش را قطع می‌کند (بعد از آن دوباره از ۱ شروع می‌شود).
 */
export function resolveLeaveShiftAssignment(
  assignments: AssignmentMap,
  personnelId: string,
  day: number
): ShiftType {
  let streak = 0;
  for (let d = day - 1; d >= 1; d--) {
    const previous = assignments[personnelId]?.[d];
    if (previous && /^L\d+$/.test(previous)) {
      streak += 1;
    } else {
      break;
    }
  }
  return `L${streak + 1}`;
}
