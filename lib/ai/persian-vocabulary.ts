/**
 * lib/ai/persian-vocabulary.ts
 * ---------------------------------------------------------------------------
 * واژگان رسمی سامانه — «تنها منبع حقیقت» برای نحوهٔ حرف‌زدن دربارهٔ شیفت‌ها و روزها.
 *
 * چرا متمرکز شده؟
 *   قبلاً هر جای سیستم با ادبیات خودش حرف می‌زد: رابط کاربری می‌گفت «تمام روز»،
 *   هوش مصنوعی می‌گفت «۲۴ ساعته»، و خلاصهٔ درخواست می‌گفت «روزهای ۵، ۷». نتیجه
 *   این بود که کاربر مطمئن نبود سیستم منظورش را درست فهمیده یا نه.
 *   حالا هم پرامپت‌های Groq/Gemini و هم برچسب‌های UI از همین فایل تغذیه می‌شوند.
 *
 * دو قاعدهٔ حیاتی که بارها باعث سوءتفاهم شده بود:
 *   ۱. «روزهای فرد/زوج» یعنی **روز هفته** (یکشنبه‌ها… / شنبه‌ها…)
 *   ۲. «تاریخ‌های فرد/زوج» یعنی **شمارهٔ روز ماه** (۱، ۳، ۵… / ۲، ۴، ۶…)
 *   این دو هرگز نباید با هم اشتباه شوند.
 */

/** ارقام لاتین → فارسی، برای نمایش به کاربر. */
export function toPersianDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, digit => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);
}

/**
 * قالب رسمی یک شمارهٔ روز: «۵اُم».
 * در سراسر سامانه به‌جای «روز ۵» از این استفاده می‌شود.
 */
export function formatDayOrdinal(day: number): string {
  return `${toPersianDigits(day)}اُم`;
}

/** فهرست روزها به شکل «۵اُم، ۷اُم، ۱۲اُم». */
export function formatDayList(days: readonly number[] | undefined): string {
  if (!days || days.length === 0) return "";
  return [...days].sort((a, b) => a - b).map(formatDayOrdinal).join("، ");
}

/** برچسب فارسی هر کد شیفت — «MEN» همیشه «شیفت ۲۴» است، نه «تمام روز». */
export const SHIFT_LABELS: Readonly<Record<string, string>> = {
  M: "صبح (M)",
  E: "عصر (E)",
  N: "شب (N)",
  ME: "لانگ / صبح-عصر (ME)",
  EN: "عصر-شب (EN)",
  MN: "شب-صبح (MN)",
  MEN: "شیفت ۲۴ (MEN)",
  OFF: "آف",
  L: "مرخصی",
};

export function getShiftLabel(shift: string | undefined): string {
  if (!shift) return "";
  return SHIFT_LABELS[shift] || shift;
}

/** روزهای هفته که «روز زوج» شمرده می‌شوند. */
export const WEEKLY_EVEN_DAY_NAMES = ["شنبه", "دوشنبه", "چهارشنبه"] as const;

/** روزهای هفته که «روز فرد» شمرده می‌شوند. */
export const WEEKLY_ODD_DAY_NAMES = ["یکشنبه", "سه‌شنبه", "پنج‌شنبه"] as const;

/** برچسب فارسی هر scope — با تفکیک دقیق «روز» از «تاریخ». */
export const SCOPE_LABELS: Readonly<Record<string, string>> = {
  all: "همهٔ روزهای ماه",
  even: "تاریخ‌های زوج ماه (۲اُم، ۴اُم، ۶اُم…)",
  odd: "تاریخ‌های فرد ماه (۱اُم، ۳اُم، ۵اُم…)",
  weekly_even: "روزهای زوج هفته (شنبه، دوشنبه، چهارشنبه)",
  weekly_odd: "روزهای فرد هفته (یکشنبه، سه‌شنبه، پنج‌شنبه)",
};

/** نسخهٔ کوتاه برای جاهایی که فضا کم است (مثل چیپ‌های خلاصه). */
export const SCOPE_LABELS_SHORT: Readonly<Record<string, string>> = {
  all: "همهٔ روزهای ماه",
  even: "تاریخ‌های زوج ماه",
  odd: "تاریخ‌های فرد ماه",
  weekly_even: "روزهای زوج هفته",
  weekly_odd: "روزهای فرد هفته",
};

/**
 * درس واژگانی که به هر دو موتور (Groq و Gemini) داده می‌شود.
 *
 * این متن عمداً صریح و تکراری است: مدل‌های زبانی وقتی یک قاعده را فقط یک بار
 * ببینند در پاسخ‌های طولانی فراموشش می‌کنند، ولی وقتی با مثال نقض همراه باشد
 * (❌ اشتباه / ✅ درست) پایدار رعایتش می‌کنند.
 */
export const PERSIAN_VOCABULARY_LESSON = `
VOCABULARY — obey exactly:

A) «روز» (weekday) vs «تاریخ» (day-number) — most important distinction:
   «روزهای فرد»/«روز فرد» = یکشنبه، سه‌شنبه، پنج‌شنبه → scope="weekly_odd"
   «روزهای زوج»/«روز زوج» = شنبه، دوشنبه، چهارشنبه → scope="weekly_even"
   «تاریخ‌های فرد»/«تاریخ فرد» = 1,3,5,7… → scope="odd"
   «تاریخ‌های زوج»/«تاریخ زوج» = 2,4,6,8… → scope="even"
   جمعه NEVER belongs to weekly_even/weekly_odd. Bare «روزهای فرد» = weekday (weekly_odd), not day numbers.

B) SHIFT NAMES when speaking: M=«صبح» E=«عصر» N=«شب» ME=«لانگ» EN=«عصر-شب» MN=«شب-صبح» OFF=«آف» L=«مرخصی»
   MEN = «شیفت ۲۴» always. ❌ NEVER say «تمام روز»/«کل روز»/«۲۴ ساعته». ✅ «شیفت ۲۴ برای ۱۳اُم»

C) DATES in prose: use «۵اُم»، «تاریخ‌های ۵اُم، ۷اُم و ۹اُم» with Persian digits.
   ❌ «روز 5»، «روزهای ۵، ۷». But inside JSON "selectedDays" use Latin integers: [5,7,9].
`;
