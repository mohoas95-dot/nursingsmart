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
PERSIAN SCHEDULING VOCABULARY — MEMORIZE AND OBEY EXACTLY:

A) «روز» (day-of-week) vs «تاریخ» (day-of-month) — THE MOST IMPORTANT DISTINCTION:
   - «روزهای فرد» / «روز فرد» / «روزهای فرد هفته» = WEEKDAYS یکشنبه، سه‌شنبه، پنج‌شنبه → scope="weekly_odd"
   - «روزهای زوج» / «روز زوج» / «روزهای زوج هفته» = WEEKDAYS شنبه، دوشنبه، چهارشنبه → scope="weekly_even"
   - «تاریخ‌های فرد» / «تاریخ فرد» / «روزهای فرد ماه» = DAY NUMBERS 1,3,5,7,... → scope="odd"
   - «تاریخ‌های زوج» / «تاریخ زوج» / «روزهای زوج ماه» = DAY NUMBERS 2,4,6,8,... → scope="even"
   جمعه NEVER belongs to weekly_even or weekly_odd.
   If the user says a bare «روزهای فرد» with no other clue, it means WEEKDAYS (weekly_odd), NOT day numbers.
   If the user says a bare «تاریخ‌های فرد», it means DAY NUMBERS (odd).

B) SHIFT NAMING — always use these exact Persian words when speaking to the user:
   - M   → «صبح»
   - E   → «عصر»
   - N   → «شب»
   - ME  → «لانگ» (or «صبح-عصر»)
   - EN  → «عصر-شب»
   - MN  → «شب-صبح»
   - MEN → «شیفت ۲۴»           ← ALWAYS say «شیفت ۲۴».
                                  ❌ NEVER say «تمام روز», «کل روز», «۲۴ ساعته», «all day».
                                  ✅ Correct: «شیفت ۲۴ برای ۱۳اُم»
   - OFF → «آف»
   - L   → «مرخصی»

C) REFERRING TO DATES — always use the ordinal «اُم» form with Persian digits:
   ✅ Correct: «۵اُم»، «۷اُم»، «تاریخ‌های ۵اُم و ۷اُم»، «۱۲اُم تا ۱۵اُم»
   ❌ Wrong:   «روز 5»، «روز ۵»، «روزهای ۵، ۷»، «day 5»، «۵ و ۷»
   When listing several dates in your reply, write «تاریخ‌های ۵اُم، ۷اُم و ۹اُم».
   (This applies ONLY to prose you speak to the user. Inside the JSON field
    "selectedDays" you MUST still use plain Latin integers: [5, 7, 9].)
`;
