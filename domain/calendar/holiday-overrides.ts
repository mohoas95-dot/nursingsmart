/**
 * HolidayOverrides — Domain Layer (Pure Functions)
 *
 * RESPONSIBILITY:
 *   مدل کردن «تعطیلات انتخابی سرپرستار» به‌صورت یک لایه‌ی override روی تقویم رسمی کشور.
 *
 * چرا لایه‌ی override؟
 *   تقویم رسمی (Calendar SSOT) فقط‌خواندنی است و هر ماه دوباره از منبع رسمی دریافت می‌شود.
 *   بنابراین تغییرات سرپرستار نمی‌تواند مستقیماً روی همان نقشه نوشته شود؛ در غیر این صورت با
 *   هر بار همگام‌سازی از بین می‌رفت (دقیقاً همان دلیلی که تیک/کلیک تعطیلات بی‌اثر بود).
 *   در عوض، فقط «تفاوت» نسبت به تقویم رسمی ذخیره می‌شود:
 *     - کلید روز با یک عنوان  → آن روز تعطیل انتخابی است (یا عنوان تعطیل رسمی بازنویسی شده).
 *     - کلید روز با مقدار WORKING_DAY_OVERRIDE → آن روز به‌صورت دستی «کاری» اعلام شده است.
 *
 * سازگاری ذخیره‌سازی: مقادیر همچنان رشته هستند، پس اسکیمای موجود
 * (HolidaysSchema: record<dayKey, string>) و داده‌های قبلی بدون مهاجرت معتبر می‌مانند؛
 * رکوردهای قدیمی صرفاً به‌عنوان «تعطیل انتخابی» تفسیر می‌شوند.
 *
 * PURE: بدون وابستگی به React، Next.js، مرورگر یا I/O.
 * DETERMINISTIC: خروجی فقط تابع ورودی‌هاست.
 */

export type HolidayMap = Record<number, string>;

/** مقدار نگهبان برای روزی که سرپرستار تعطیلی رسمی آن را برداشته و «کاری» کرده است. */
export const WORKING_DAY_OVERRIDE = '__WORKING_DAY__';

/** عنوان پیش‌فرض وقتی سرپرستار روزی را تعطیل می‌کند ولی عنوانی نمی‌نویسد. */
export const DEFAULT_CUSTOM_HOLIDAY_TITLE = 'تعطیل انتخابی بخش';

function normalizeDay(day: number | string): number {
  return Number(day);
}

/** آیا این مقدار override به معنای «این روز کاری است» می‌باشد؟ */
export function isWorkingDayOverride(value: string | undefined): boolean {
  return value === WORKING_DAY_OVERRIDE;
}

/**
 * ادغام تقویم رسمی با تغییرات سرپرستار و ساخت نقشه‌ی «تعطیلات مؤثر».
 *
 * خروجی این تابع همان چیزی است که موتور زمان‌بندی، محاسبه ساعت موظفی و گزارش‌ها
 * مصرف می‌کنند؛ یعنی هیچ مصرف‌کننده‌ای لازم نیست از وجود لایه‌ی override خبر داشته باشد.
 *
 * @param official - تعطیلات رسمی ماه از منبع کشور (روز → عنوان)
 * @param overrides - تغییرات ذخیره‌شده‌ی بخش (روز → عنوان یا WORKING_DAY_OVERRIDE)
 * @returns نقشه‌ی تعطیلات مؤثر (روز → عنوان)
 */
export function mergeHolidayOverrides(
  official: Readonly<HolidayMap> = {},
  overrides: Readonly<HolidayMap> = {}
): HolidayMap {
  const merged: HolidayMap = {};
  for (const [key, title] of Object.entries(official)) {
    const day = normalizeDay(key);
    if (!Number.isFinite(day)) continue;
    merged[day] = title || DEFAULT_CUSTOM_HOLIDAY_TITLE;
  }
  for (const [key, value] of Object.entries(overrides)) {
    const day = normalizeDay(key);
    if (!Number.isFinite(day)) continue;
    if (isWorkingDayOverride(value)) {
      delete merged[day];
      continue;
    }
    // عنوان خالی نباید روز را ناخواسته از حالت تعطیل خارج کند؛ عنوان پیش‌فرض جایگزین می‌شود.
    merged[day] = value.trim() ? value : DEFAULT_CUSTOM_HOLIDAY_TITLE;
  }
  return merged;
}

/** آیا روز داده‌شده پس از اعمال تغییرات سرپرستار تعطیل است؟ (جمعه‌ها جداگانه توسط تقویم اعمال می‌شوند) */
export function isEffectiveHoliday(
  official: Readonly<HolidayMap>,
  overrides: Readonly<HolidayMap>,
  day: number
): boolean {
  const value = overrides[day];
  if (value !== undefined) return !isWorkingDayOverride(value);
  return Boolean(official[day]);
}

/**
 * متنی که باید در فرم ویرایش عنوان مناسبت نمایش داده شود.
 * اولویت با متن دست‌نویس سرپرستار است، سپس عنوان رسمی همان روز.
 */
export function holidayOverrideTitle(
  official: Readonly<HolidayMap>,
  overrides: Readonly<HolidayMap>,
  day: number
): string {
  const value = overrides[day];
  if (value !== undefined) return isWorkingDayOverride(value) ? '' : value;
  return official[day] || '';
}

/** تعطیل کردن یک روز (یا تغییر عنوان آن) و برگرداندن نقشه‌ی جدید تغییرات. */
export function setHolidayOverride(
  official: Readonly<HolidayMap>,
  overrides: Readonly<HolidayMap>,
  day: number,
  title?: string
): HolidayMap {
  const next: HolidayMap = { ...overrides };
  const resolved = title !== undefined ? title : (official[day] || DEFAULT_CUSTOM_HOLIDAY_TITLE);
  // اگر عنوان دقیقاً همان تقویم رسمی باشد، نیازی به نگهداری override نیست.
  if (official[day] && official[day] === resolved) delete next[day];
  else next[day] = resolved;
  return next;
}

/** کاری کردن یک روز؛ اگر روز رسمی تعطیل باشد نگهبان ثبت می‌شود، وگرنه override حذف می‌شود. */
export function clearHolidayOverride(
  official: Readonly<HolidayMap>,
  overrides: Readonly<HolidayMap>,
  day: number
): HolidayMap {
  const next: HolidayMap = { ...overrides };
  if (official[day]) next[day] = WORKING_DAY_OVERRIDE;
  else delete next[day];
  return next;
}

/**
 * سوئیچ وضعیت یک روز بین «کاری» و «تعطیل».
 * @param title - عنوان دلخواه هنگام تعطیل کردن (در حالت کاری‌کردن نادیده گرفته می‌شود)
 */
export function toggleHolidayOverride(
  official: Readonly<HolidayMap>,
  overrides: Readonly<HolidayMap>,
  day: number,
  title?: string
): HolidayMap {
  return isEffectiveHoliday(official, overrides, day)
    ? clearHolidayOverride(official, overrides, day)
    : setHolidayOverride(official, overrides, day, title);
}

/**
 * عکسِ mergeHolidayOverrides: از روی تقویم رسمی و نقشه‌ی تعطیلات مؤثر، کوچک‌ترین
 * لایه‌ی تغییرات را بازسازی می‌کند.
 *
 * این تابع اجازه می‌دهد مسیرهای ذخیره‌سازی موجود که با نقشه‌ی «مؤثر» کار می‌کنند
 * بدون تغییر امضا باقی بمانند و در عین حال فقط تفاوت‌ها در دیتابیس نوشته شود.
 * تضمین رفت‌وبرگشت: mergeHolidayOverrides(official, diffHolidayOverrides(official, x)) === x
 */
export function diffHolidayOverrides(
  official: Readonly<HolidayMap> = {},
  effective: Readonly<HolidayMap> = {}
): HolidayMap {
  const overrides: HolidayMap = {};
  const normalizedEffective: HolidayMap = {};
  for (const [key, title] of Object.entries(effective)) {
    const day = normalizeDay(key);
    if (!Number.isFinite(day)) continue;
    normalizedEffective[day] = title;
  }
  for (const [key, title] of Object.entries(normalizedEffective)) {
    const day = normalizeDay(key);
    if (official[day] !== title) overrides[day] = title;
  }
  for (const key of Object.keys(official)) {
    const day = normalizeDay(key);
    if (!Number.isFinite(day)) continue;
    if (!(day in normalizedEffective)) overrides[day] = WORKING_DAY_OVERRIDE;
  }
  return overrides;
}

/** منشأ تعطیلی یک روز، برای نمایش نشان «رسمی / انتخابی بخش» در رابط کاربری. */
export function holidaySource(
  official: Readonly<HolidayMap>,
  overrides: Readonly<HolidayMap>,
  day: number
): 'official' | 'custom' | 'none' {
  if (!isEffectiveHoliday(official, overrides, day)) return 'none';
  if (overrides[day] !== undefined && !official[day]) return 'custom';
  return 'official';
}
