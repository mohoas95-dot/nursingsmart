/**
 * lib/image-file.ts
 * ---------------------------------------------------------------------------
 * خواندن مطمئن فایل تصویر در مرورگر (سمت کلاینت).
 *
 * مسئله‌ای که حل می‌کند
 * ----------------------
 * کاربران هنگام ارسال عکس در چت‌باکس این خطا را می‌دیدند:
 *
 *   «The requested file could not be read, typically due to permission problems
 *    that have occurred after a reference to a file was acquired.»
 *
 * این پیام خام مرورگر برای خطای `NotReadableError` است و تقریباً همیشه یک دلیل
 * دارد: **ارجاع به فایل بین لحظهٔ انتخاب و لحظهٔ ارسال «بیات» شده است.**
 * سناریوهای رایج روی موبایل:
 *   - عکس مستقیماً با دوربین گرفته شده و سیستم‌عامل فایل موقت را آزاد کرده.
 *   - عکس از Google Photos / iCloud انتخاب شده و هنوز روی دستگاه دانلود نبوده.
 *   - iOS بین انتخاب و ارسال، فایل HEIC را دوباره کدگذاری کرده.
 *   - کاربر عکس را در گالری ویرایش یا حذف کرده بعد از انتخاب.
 *
 * راهبرد این ماژول (سه لایه دفاعی)
 * ---------------------------------
 *  ۱. «زودخوانی» (eager read): بلافاصله پس از انتخاب فایل، محتوا خوانده و در
 *     حافظه نگه داشته می‌شود. این پنجرهٔ بیات‌شدن را عملاً به صفر می‌رساند و
 *     مهم‌ترین بخش راه‌حل است.
 *  ۲. دو مسیر خواندن: اول `file.arrayBuffer()` (مدرن و مقاوم‌تر) و اگر شکست خورد
 *     `FileReader` به‌عنوان جایگزین. هر کدام ممکن است روی مرورگری موفق شود که
 *     دیگری روی آن شکست می‌خورد.
 *  ۳. تلاش مجدد + پیام فارسی قابل‌فهم: به‌جای متن انگلیسی مرورگر، به کاربر
 *     دقیقاً گفته می‌شود چه کار کند.
 */

/** پیام راهنمای فارسی برای وقتی فایل واقعاً قابل خواندن نیست. */
export const IMAGE_UNREADABLE_MESSAGE =
  "این عکس قابل خواندن نبود. اگر تازه با دوربین گرفته‌ای یا از فضای ابری (مثل Google Photos) انتخاب کرده‌ای، ابتدا آن را در گالری دستگاه ذخیره کن و دوباره از همان‌جا انتخاب کن.";

/** آیا خطا از نوع «فایل بیات/غیرقابل‌خواندن» است؟ */
export function isFileUnreadableError(error: unknown): boolean {
  const candidate = error as { name?: string; message?: string } | null;
  const name = String(candidate?.name || "");
  const message = String(candidate?.message || "");
  return (
    name === "NotReadableError" ||
    name === "NotFoundError" ||
    /could not be read|permission problems|file could not be|notreadable|notfound/i.test(message)
  );
}

/** تبدیل ArrayBuffer به رشتهٔ base64 — تکه‌تکه، تا برای عکس‌های بزرگ stack سرریز نکند. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000; // ۳۲ کیلوبایت در هر مرحله
  let binary = "";
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

/** مسیر اول: API مدرن و مقاوم‌تر. */
async function readViaArrayBuffer(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    throw new Error("فایل خالی است.");
  }
  const mime = file.type || "image/jpeg";
  return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
}

/** مسیر دوم: روش کلاسیک، برای مرورگرهایی که مسیر اول رویشان می‌لنگد. */
function readViaFileReader(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result) {
        reject(new Error("محتوای فایل خالی بود."));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error || new Error("خواندن فایل ناموفق بود."));
    reader.onabort = () => reject(new Error("خواندن فایل نیمه‌کاره رها شد."));
    reader.readAsDataURL(file);
  });
}

/**
 * خواندن فایل تصویر به‌صورت Data URL با چند لایه تلاش.
 *
 * @throws خطایی با پیام فارسی قابل نمایش مستقیم به کاربر.
 */
export async function readImageFileAsDataUrl(file: File): Promise<string> {
  const attempts: Array<() => Promise<string>> = [
    () => readViaArrayBuffer(file),
    () => readViaFileReader(file),
    // تلاش سوم: گاهی یک بار دیگر صدا زدن arrayBuffer پس از یک tick موفق می‌شود
    // (مثلاً وقتی سیستم‌عامل هنوز مشغول دانلود فایل از فضای ابری بوده).
    () => new Promise<string>(resolve => setTimeout(resolve, 250)).then(() => readViaArrayBuffer(file)),
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      const dataUrl = await attempt();
      if (dataUrl) return dataUrl;
    } catch (error) {
      lastError = error;
    }
  }

  if (isFileUnreadableError(lastError)) {
    throw new Error(IMAGE_UNREADABLE_MESSAGE);
  }
  throw new Error(
    lastError instanceof Error && lastError.message
      ? `خواندن عکس ناموفق بود: ${lastError.message}`
      : "خواندن عکس ناموفق بود؛ لطفاً عکس دیگری را امتحان کن.",
  );
}
