/**
 * lib/ai/compact-context.ts
 * ---------------------------------------------------------------------------
 * فشرده‌سازی «زمینه» (context) پیش از ارسال به مدل زبانی.
 *
 * چرا این فایل وجود دارد؟
 * ------------------------
 * سقف رایگان سرویس‌ها عمدتاً بر پایهٔ **توکن در دقیقه** است، نه تعداد درخواست.
 * برای مثال سقف رایگان `openai/gpt-oss-120b` روی Groq فقط **۸٬۰۰۰ توکن در
 * دقیقه** است. نسخهٔ اول این پروژه کل زمینه را به‌صورت `JSON.stringify` خام
 * می‌فرستاد که برای یک ماه ۳۱ روزه حدود ۴٬۳۰۰ کاراکتر (~۱٬۴۰۰ توکن) می‌شد و
 * بخش عمده‌اش تکرار بی‌فایدهٔ نام کلیدها بود:
 *
 *   {"day":1,"dayOfWeek":0,"weekdayName":"شنبه","isHoliday":false}, …×۳۱
 *
 * همان اطلاعات را می‌توان در ۱۱۸ کاراکتر بیان کرد (۹۴٪ کمتر):
 *
 *   1ش 2ی 3د 4س 5چ 6پ 7ج* 8ش …
 *
 * نتیجه: مصرف توکن هر درخواست به‌شدت پایین می‌آید، به سقف دقیقه‌ای نمی‌خوریم،
 * و سهمیهٔ رایگان چند برابر بیشتر دوام می‌آورد. مدل هم این قالب را راحت‌تر
 * می‌خواند چون نویز کمتری دارد.
 */

/** حرف اول هر روز هفته برای قالب فشرده. */
const WEEKDAY_INITIALS = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

export interface CalendarDayInput {
  day: number;
  dayOfWeek: number;
  weekdayName?: string;
  isHoliday?: boolean;
  holidayTitle?: string;
}

/**
 * تقویم ماه را به یک رشتهٔ فشرده تبدیل می‌کند.
 * قالب: `<شمارهٔ روز><حرف اول روز هفته>[*]` که `*` یعنی تعطیل رسمی.
 *
 * مثال خروجی: `1ش 2ی 3د 4س 5چ 6پ 7ج* 8ش …`
 */
export function encodeCalendar(days: readonly CalendarDayInput[]): string {
  return days
    .map(day => {
      const initial = WEEKDAY_INITIALS[day.dayOfWeek] ?? "?";
      return `${day.day}${initial}${day.isHoliday ? "*" : ""}`;
    })
    .join(" ");
}

/** توضیح قالب فشرده برای مدل (یک بار در پرامپت می‌آید). */
export const CALENDAR_FORMAT_LEGEND =
  'calendar format: "<dayNumber><weekdayInitial>[*]" — ش=شنبه ی=یکشنبه د=دوشنبه س=سه‌شنبه چ=چهارشنبه پ=پنج‌شنبه ج=جمعه، and * marks an official holiday.';

export interface ExistingRequestInput {
  requestType?: string;
  preferredShift?: string;
  scope?: string;
  selectedDays?: number[];
  startDate?: string;
  endDate?: string;
  isEssential?: boolean;
  patternSteps?: string[];
}

/**
 * درخواست‌های قبلی را به خطوط کوتاه تبدیل می‌کند.
 * مثال: `OFF@custom_days[10,12]` یا `shift:ME@weekly_odd!`
 * (`!` یعنی ضروری)
 */
export function encodeExistingRequests(
  requests: readonly ExistingRequestInput[],
  limit = 12,
): string {
  if (!requests || requests.length === 0) return "";
  return requests
    .slice(-limit)
    .map(request => {
      const shift = request.preferredShift ? `:${request.preferredShift}` : "";
      const where =
        request.scope === "custom_days" && request.selectedDays?.length
          ? `[${request.selectedDays.join(",")}]`
          : request.scope === "range"
            ? `[${request.startDate || "?"}..${request.endDate || "?"}]`
            : "";
      const pattern = request.patternSteps?.length ? `{${request.patternSteps.join(">")}}` : "";
      return `${request.requestType}${shift}@${request.scope}${where}${pattern}${request.isEssential ? "!" : ""}`;
    })
    .join("; ");
}

export interface ScheduleHistoryInput {
  monthKey: string;
  assignments: Record<string, string>;
}

/**
 * تاریخچهٔ برنامه را فشرده می‌کند: فقط شمارش هر نوع شیفت، نه تک‌تک روزها.
 *
 * مدل برای «حدس زدن روال کاری» به الگوی کلی نیاز دارد، نه به اینکه روز ۱۷ام
 * سه ماه پیش دقیقاً چه شیفتی بوده. ارسال جزئیات کامل صرفاً توکن می‌سوزاند.
 *
 * مثال خروجی: `1405_4: M×8 E×6 N×5 OFF×11`
 */
export function encodeScheduleHistory(
  history: readonly ScheduleHistoryInput[],
  limit = 3,
): string {
  if (!history || history.length === 0) return "";
  return history
    .slice(-limit)
    .map(month => {
      const counts = new Map<string, number>();
      for (const shift of Object.values(month.assignments || {})) {
        if (!shift) continue;
        counts.set(shift, (counts.get(shift) || 0) + 1);
      }
      if (counts.size === 0) return "";
      const summary = [...counts.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([shift, count]) => `${shift}×${count}`)
        .join(" ");
      return `${month.monthKey}: ${summary}`;
    })
    .filter(Boolean)
    .join(" | ");
}

export interface BuildContextOptions {
  year: number;
  month: number;
  totalDays: number;
  personnel?: { firstName?: string; lastName?: string; jobGroup?: string; workRoutine?: string };
  calendarDays?: readonly CalendarDayInput[];
  existingRequests?: readonly ExistingRequestInput[];
  scheduleHistory?: readonly ScheduleHistoryInput[];
  /** یادداشت اختیاری کاربر (برای مسیر تصویر). */
  note?: string;
}

/**
 * ساخت بلوک زمینهٔ فشرده به‌صورت متن کلید-مقدار خطی.
 *
 * عمداً JSON نیست: قالب خطی هم توکن کمتری می‌گیرد و هم مدل‌های زبانی
 * راحت‌تر می‌خوانندش. تنها جایی که JSON لازم است، خروجی مدل است نه ورودی‌اش.
 */
export function buildCompactContext(options: BuildContextOptions): string {
  const lines: string[] = [];

  lines.push(`month: ${options.year}/${options.month} (${options.totalDays} days)`);

  const person = options.personnel;
  if (person?.firstName || person?.lastName) {
    const bits = [
      `${person.firstName || ""} ${person.lastName || ""}`.trim(),
      person.jobGroup,
      person.workRoutine,
    ].filter(Boolean);
    lines.push(`nurse: ${bits.join(" | ")}`);
  }

  if (options.calendarDays?.length) {
    lines.push(`calendar: ${encodeCalendar(options.calendarDays)}`);
  }

  const existing = encodeExistingRequests(options.existingRequests || []);
  if (existing) lines.push(`alreadyRegistered: ${existing}`);

  const history = encodeScheduleHistory(options.scheduleHistory || []);
  if (history) lines.push(`pastMonths: ${history}`);

  if (options.note) lines.push(`userNote: ${options.note.slice(0, 500)}`);

  return lines.join("\n");
}
