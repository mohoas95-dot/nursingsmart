/**
 * features/calendar/theme.ts
 * ---------------------------------------------------------------------------
 * پالت رنگی تقویم شمسی بر اساس فصل‌های سال.
 *
 * چرا فصلی؟ در تقویم‌های دیواری ایرانی (همان الگویی که مبنای طراحی این تقویم است)
 * سربرگ هر ماه رنگ مخصوص خودش را دارد: بهار سبز و صورتی، تابستان زرد و نارنجی،
 * پاییز نارنجی سوخته و زرشکی، زمستان آبی و فیروزه‌ای. این فایل «تنها منبع حقیقت»
 * رنگ‌های تقویم است تا همهٔ تقویم‌های سامانه یکدست بمانند.
 *
 * همهٔ کلاس‌ها به‌صورت رشتهٔ کامل نوشته شده‌اند (نه ساخت پویا) تا Tailwind بتواند
 * در زمان build آن‌ها را استخراج کند.
 */

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

export interface CalendarTheme {
  /** شناسهٔ فصل ماه */
  season: SeasonId;
  /** نام فارسی فصل — زیر عنوان ماه نمایش داده می‌شود */
  seasonLabel: string;
  /** گرادیان سربرگ ماه */
  headerGradient: string;
  /** گرادیان نوار روزهای هفته */
  weekdayBar: string;
  /** رنگ متن روزهای هفته */
  weekdayText: string;
  /** حاشیهٔ کارت تقویم */
  frameBorder: string;
  /** پس‌زمینهٔ ملایم کل کارت (زمینه همیشه روشن است) */
  frameBackground: string;
  /** پس‌زمینهٔ سلول روز عادی */
  cellIdle: string;
  /** حالت hover سلول روز عادی */
  cellHover: string;
  /** رنگ عدد روز عادی */
  dayText: string;
  /** سلول انتخاب‌شده (کلیک‌شده) */
  cellActive: string;
  /** رنگ حلقهٔ تمرکز/انتخاب */
  ring: string;
  /** رنگ نقطهٔ مناسبت */
  occasionDot: string;
  /** رنگ تأکیدی برای متن‌های کمکی */
  accentText: string;
  /** پس‌زمینهٔ چیپ‌ها و دکمه‌های کنترلی */
  chip: string;
}

const SPRING: Omit<CalendarTheme, 'season' | 'seasonLabel'> = {
  headerGradient: 'from-emerald-500 via-green-500 to-teal-500',
  weekdayBar: 'from-emerald-600 via-green-600 to-teal-600',
  weekdayText: 'text-white',
  frameBorder: 'border-emerald-200',
  frameBackground: 'bg-gradient-to-b from-emerald-50/70 via-white to-white',
  cellIdle: 'bg-white border-emerald-100/80',
  cellHover: 'hover:border-emerald-400 hover:bg-emerald-50',
  dayText: 'text-emerald-950',
  cellActive: 'bg-emerald-600 text-white border-emerald-700',
  ring: 'ring-emerald-400',
  occasionDot: 'bg-emerald-500',
  accentText: 'text-emerald-700',
  chip: 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100',
};

const SUMMER: Omit<CalendarTheme, 'season' | 'seasonLabel'> = {
  headerGradient: 'from-amber-500 via-orange-500 to-yellow-500',
  weekdayBar: 'from-amber-600 via-orange-600 to-yellow-600',
  weekdayText: 'text-white',
  frameBorder: 'border-amber-200',
  frameBackground: 'bg-gradient-to-b from-amber-50/70 via-white to-white',
  cellIdle: 'bg-white border-amber-100/80',
  cellHover: 'hover:border-amber-400 hover:bg-amber-50',
  dayText: 'text-amber-950',
  cellActive: 'bg-amber-600 text-white border-amber-700',
  ring: 'ring-amber-400',
  occasionDot: 'bg-amber-500',
  accentText: 'text-amber-700',
  chip: 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100',
};

const AUTUMN: Omit<CalendarTheme, 'season' | 'seasonLabel'> = {
  headerGradient: 'from-orange-600 via-rose-500 to-red-500',
  weekdayBar: 'from-orange-700 via-rose-600 to-red-600',
  weekdayText: 'text-white',
  frameBorder: 'border-orange-200',
  frameBackground: 'bg-gradient-to-b from-orange-50/70 via-white to-white',
  cellIdle: 'bg-white border-orange-100/80',
  cellHover: 'hover:border-orange-400 hover:bg-orange-50',
  dayText: 'text-orange-950',
  cellActive: 'bg-orange-600 text-white border-orange-700',
  ring: 'ring-orange-400',
  occasionDot: 'bg-orange-500',
  accentText: 'text-orange-700',
  chip: 'bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100',
};

const WINTER: Omit<CalendarTheme, 'season' | 'seasonLabel'> = {
  headerGradient: 'from-sky-500 via-cyan-500 to-blue-600',
  weekdayBar: 'from-sky-600 via-cyan-600 to-blue-700',
  weekdayText: 'text-white',
  frameBorder: 'border-sky-200',
  frameBackground: 'bg-gradient-to-b from-sky-50/70 via-white to-white',
  cellIdle: 'bg-white border-sky-100/80',
  cellHover: 'hover:border-sky-400 hover:bg-sky-50',
  dayText: 'text-sky-950',
  cellActive: 'bg-sky-600 text-white border-sky-700',
  ring: 'ring-sky-400',
  occasionDot: 'bg-sky-500',
  accentText: 'text-sky-700',
  chip: 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100',
};

/** ماه ۱ تا ۱۲ → پوستهٔ فصلی. */
export function getCalendarTheme(month: number): CalendarTheme {
  if (month >= 1 && month <= 3) return { season: 'spring', seasonLabel: 'بهار', ...SPRING };
  if (month >= 4 && month <= 6) return { season: 'summer', seasonLabel: 'تابستان', ...SUMMER };
  if (month >= 7 && month <= 9) return { season: 'autumn', seasonLabel: 'پاییز', ...AUTUMN };
  return { season: 'winter', seasonLabel: 'زمستان', ...WINTER };
}

/** رنگ‌های ثابت روز تعطیل — در همهٔ فصل‌ها قرمز است، دقیقاً مانند تقویم دیواری. */
export const HOLIDAY_TONE = {
  cell: 'bg-rose-50 border-rose-200',
  text: 'text-rose-600',
  active: 'bg-rose-600 text-white border-rose-700',
  dot: 'bg-rose-500',
  chip: 'bg-rose-50 text-rose-700 border-rose-200',
} as const;
