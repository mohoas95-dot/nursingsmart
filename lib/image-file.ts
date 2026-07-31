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

/* ---------------------------------------------------------------------------
 * آماده‌سازی تصویر برای Vision API (OCR جدول‌های شیفت)
 * ---------------------------------------------------------------------------
 * سیاست کیفیت (طبق دستورالعمل پروژه):
 *   - بیشینهٔ ابعاد: ۲۰۴۸px در طولانی‌ترین ضلع — فقط اگر تصویر بزرگ‌تر باشد
 *     کوچک می‌شود؛ هرگز ریزایز «شدید» یا upscale انجام نمی‌دهیم.
 *   - کیفیت JPEG هرگز زیر ۰٫۸۵ نمی‌آید (هدف ۰٫۹۰).
 *   - اگر تصویر از قبل در محدودهٔ مجاز است، بایت‌های اصلی بدون هیچ ری‌انکدی
 *     ارسال می‌شوند (بهترین کیفیت ممکن برای OCR).
 *   - زمینهٔ سفید زیر تصویر کشیده می‌شود تا PNG شفاف هنگام تبدیل به JPEG
 *     زمینهٔ سیاه نگیرد (جدول‌ها معمولاً سند سفید هستند).
 *   - پرداختۀ بالای in-painting  → imageSmoothingQuality: "high"
 * ------------------------------------------------------------------------ */

/** حداکثر عرض/ارتفاع تصویر ارسالی به Vision API (پیکسل). */
export const VISION_IMAGE_MAX_DIMENSION = 2048;
/** کیفیت هدف JPEG هنگام ری‌انکد. */
export const VISION_JPEG_TARGET_QUALITY = 0.9;
/** کف کیفیت JPEG — طبق دستورالعمل هرگز کمتر از ۰٫۸۵ نشود. */
export const VISION_JPEG_MIN_QUALITY = 0.85;
/** سقف حجم خروجی (هم‌راستا با سقف ۸ مگابایتی سرور). */
export const VISION_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/** MIME های قابل ارسال مستقیم بدون ری‌انکد. */
const DIRECT_SENDABLE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

/** نتیجهٔ آماده‌سازی تصویر برای ارسال به Vision API. */
export interface PreparedVisionImage {
  /** Data URL نهایی برای پی‌لود base64. */
  dataUrl: string;
  /** MIME واقعیِ دادهٔ داخل dataUrl (پس از ری‌انکد JPEG می‌شود image/jpeg). */
  mimeType: string;
  /** ابعاد نهایی تصویر ارسالی. */
  width: number;
  height: number;
  /** آیا نسبت به فایل اصلی ریزایز/ری‌انکد انجام شد؟ */
  resized: boolean;
  /** کیفیت JPEG استفاده‌شده (فقط وقتی ری‌انکد شده). */
  quality?: number;
  originalBytes: number;
  finalBytes: number;
}

interface DecodedImageSource {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/** رمزگشایی فایل به بوم قابل رسم — createImageBitmap و سپس <img> به‌عنوان fallback. */
async function decodeImageForCanvas(file: File): Promise<DecodedImageSource> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 0 && bitmap.height > 0) {
        return {
          source: bitmap,
          width: bitmap.width,
          height: bitmap.height,
          release: () => {
            try {
              bitmap.close();
            } catch {
              // best-effort
            }
          },
        };
      }
    } catch {
      // برخی مرورگرها/کدک‌ها (مثل HEIC در کروم) اینجا شکست می‌خورند؛ مسیر دوم را می‌رویم.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("کدک تصویر برای مرورگر ناشناخته است."));
      element.src = objectUrl;
    });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) {
      throw new Error("ابعاد تصویر قابل تشخیص نیست.");
    }
    return { source: image, width, height, release: () => undefined };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** رندر روی canvas با زمینهٔ سفید و نمونه‌برداری نرم برای حفظ خوانایی متن ریز. */
function renderToCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("بوم پردازش تصویر در این مرورگر در دسترس نیست.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function canvasToJpegDataUrl(canvas: HTMLCanvasElement, quality: number): Promise<{ dataUrl: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (!blob) {
          reject(new Error("کدگذاری JPEG تصویر ناموفق بود."));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = typeof reader.result === "string" ? reader.result : "";
          if (!dataUrl) {
            reject(new Error("خواندن خروجی JPEG ناموفق بود."));
            return;
          }
          resolve({ dataUrl, bytes: blob.size });
        };
        reader.onerror = () => reject(reader.error || new Error("خواندن خروجی JPEG ناموفق بود."));
        reader.readAsDataURL(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * آماده‌سازی تصویر برای ارسال به Vision API:
 * ابعاد ≤ ۲۰۴۸px و کیفیت JPEG ≥ ۰٫۸۵ — بدون ریزایز شدید یا افت کیفیت.
 *
 * استراتژی:
 *   ۱. اگر فایل از قبل در محدوده است (ابعاد/حجم/فرمت) → همان بایت‌های اصلی ارسال می‌شوند.
 *   ۲. در غیر این صورت دکد → ریزایز متناسب (با حفظ نسبت، هرگز upscale نه) → JPEG ۰٫۹۰.
 *   ۳. اگر خروجی از سقف حجم بزرگ‌تر شد، کیفیت تا کف ۰٫۸۵ و بعد ابعاد پله‌پله
 *      کم می‌شوند تا زیر سقف سرور بماند.
 *   ۴. اگر مرورگر اصلاً نتواند تصویر را دکد کند (مثل HEIC در کروم)، به‌جای
 *      شکست، فایل اصلی دست‌نخورده ارسال می‌شود تا سرور تصمیم بگیرد.
 */
export async function prepareImageForVisionUpload(file: File): Promise<PreparedVisionImage> {
  const originalBytes = file.size;

  let decoded: DecodedImageSource | null = null;
  try {
    decoded = await decodeImageForCanvas(file);
  } catch {
    decoded = null;
  }

  // مسیر ۱: دکد ناموفق (فرمت ناشناخته برای مرورگر) → عبور مستقیم فایل اصلی
  if (!decoded) {
    const dataUrl = await readImageFileAsDataUrl(file);
    return {
      dataUrl,
      mimeType: file.type || "image/jpeg",
      width: 0,
      height: 0,
      resized: false,
      originalBytes,
      finalBytes: originalBytes,
    };
  }

  const { width: sourceWidth, height: sourceHeight } = decoded;
  const normalizedMime = (file.type || "image/jpeg").toLowerCase();
  const maxSide = Math.max(sourceWidth, sourceHeight);

  // مسیر ۲: تصویر از قبل در محدودهٔ مجاز است → بدون هیچ دست‌کاری (بهترین کیفیت OCR)
  if (
    maxSide <= VISION_IMAGE_MAX_DIMENSION &&
    originalBytes <= VISION_MAX_OUTPUT_BYTES &&
    DIRECT_SENDABLE_TYPES.has(normalizedMime)
  ) {
    const dataUrl = await readImageFileAsDataUrl(file);
    decoded.release();
    return {
      dataUrl,
      mimeType: normalizedMime,
      width: sourceWidth,
      height: sourceHeight,
      resized: false,
      originalBytes,
      finalBytes: originalBytes,
    };
  }

  // مسیر ۳: ریزایز متناسب + ری‌انکد JPEG با کیفیت ≥ ۰٫۸۵
  try {
    const initialScale = Math.min(1, VISION_IMAGE_MAX_DIMENSION / maxSide);
    const qualitySteps = [VISION_JPEG_TARGET_QUALITY, VISION_JPEG_MIN_QUALITY];
    const MIN_ACCEPTABLE_SIDE = 640;

    let scale = initialScale;
    let lastResult: { dataUrl: string; bytes: number } | null = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));
      const canvas = renderToCanvas(decoded.source, width, height);

      for (const quality of qualitySteps) {
        const result = await canvasToJpegDataUrl(canvas, quality);
        lastResult = result;
        if (result.bytes <= VISION_MAX_OUTPUT_BYTES) {
          return {
            dataUrl: result.dataUrl,
            mimeType: "image/jpeg",
            width,
            height,
            resized: true,
            quality,
            originalBytes,
            finalBytes: result.bytes,
          };
        }
      }

      const nextSide = Math.max(sourceWidth, sourceHeight) * scale * 0.75;
      if (nextSide < MIN_ACCEPTABLE_SIDE) break;
      scale *= 0.75;
    }

    // شرط ممکن: حتی در کف کیفیت/ابعاد هنوز بزرگ است — آخرین خروجی را برمی‌گردانیم
    // (سرور در بدترین حالت با پیام واضح رد می‌کند؛ بهتر از شکست سمت کلاینت است).
    if (lastResult) {
      return {
        dataUrl: lastResult.dataUrl,
        mimeType: "image/jpeg",
        width: Math.max(1, Math.round(sourceWidth * scale)),
        height: Math.max(1, Math.round(sourceHeight * scale)),
        resized: true,
        quality: VISION_JPEG_MIN_QUALITY,
        originalBytes,
        finalBytes: lastResult.bytes,
      };
    }
    throw new Error("پردازش تصویر ناموفق بود.");
  } finally {
    decoded.release();
  }
}
