/**
 * lib/ai/errors.ts
 * ---------------------------------------------------------------------------
 * خطاهای مشترک لایهٔ هوش مصنوعی (Groq برای متن، Gemini برای تصویر).
 *
 * هدف: هر خطای داخلی (سهمیهٔ تمام‌شده، شلوغی مدل، تایم‌اوت، کلید نامعتبر)
 * به یک خطای معنادار فارسی تبدیل شود تا API Route همیشه بتواند یک پاسخ
 * JSON تمیز برگرداند و چت‌باکس هرگز «سفید» یا معلق نماند.
 */

/** پیام‌های فارسی استاندارد که مستقیماً در حباب چت نمایش داده می‌شوند. */
export const MODEL_BUSY_MESSAGE =
  "سرور هوش مصنوعی فعلاً شلوغ است؛ لطفاً چند لحظه دیگر دوباره تلاش کنید.";

export const QUOTA_EXHAUSTED_MESSAGE =
  "سرویس هوش مصنوعی همین الان ظرفیت خالی ندارد. معمولاً چند ثانیه بیشتر طول نمی‌کشد — کمی صبر کن و دوباره بفرست.";

export const MODEL_TIMEOUT_MESSAGE =
  "پاسخ هوش مصنوعی بیش از حد طول کشید؛ لطفاً دوباره تلاش کنید (در صورت امکان پیام را کوتاه‌تر بنویسید).";

export const MISSING_KEY_MESSAGE =
  "هیچ کلید API معتبری برای این سرویس هوش مصنوعی تنظیم نشده است؛ لطفاً متغیرهای محیطی را در Vercel تکمیل کنید.";

/** مدل/سرویس موقتاً در دسترس نیست (۴۲۹/۵۰۳/۵۰۰) — قابل تلاش مجدد. */
export class ModelBusyError extends Error {
  readonly retryable = true;
  readonly provider?: string;
  constructor(message: string = MODEL_BUSY_MESSAGE, provider?: string) {
    super(message);
    this.name = "ModelBusyError";
    this.provider = provider;
  }
}

/** همهٔ کلیدهای این سرویس به سقف سهمیه خورده‌اند — قابل تلاش مجدد بعد از cooldown. */
export class QuotaExhaustedError extends Error {
  readonly retryable = true;
  readonly provider?: string;
  /** میلی‌ثانیهٔ باقی‌مانده تا آزاد شدن نزدیک‌ترین کلید (برای نمایش به کاربر). */
  readonly retryAfterMs?: number;
  constructor(message: string = QUOTA_EXHAUSTED_MESSAGE, provider?: string, retryAfterMs?: number) {
    super(message);
    this.name = "QuotaExhaustedError";
    this.provider = provider;
    this.retryAfterMs = retryAfterMs;
  }
}

/** بودجهٔ زمانی کل درخواست تمام شد — قابل تلاش مجدد. */
export class ModelTimeoutError extends Error {
  readonly retryable = true;
  readonly provider?: string;
  constructor(message: string = MODEL_TIMEOUT_MESSAGE, provider?: string) {
    super(message);
    this.name = "ModelTimeoutError";
    this.provider = provider;
  }
}

/** هیچ کلیدی تنظیم نشده یا همهٔ کلیدها نامعتبرند — غیرقابل تلاش مجدد. */
export class MissingApiKeyError extends Error {
  readonly retryable = false;
  readonly provider?: string;
  constructor(message: string = MISSING_KEY_MESSAGE, provider?: string) {
    super(message);
    this.name = "MissingApiKeyError";
    this.provider = provider;
  }
}

/** خطای غیرگذرا از سمت سرویس (مثلاً درخواست نامعتبر). */
export class ProviderRequestError extends Error {
  readonly retryable = false;
  readonly provider?: string;
  readonly status?: number;
  constructor(message: string, provider?: string, status?: number) {
    super(message);
    this.name = "ProviderRequestError";
    this.provider = provider;
    this.status = status;
  }
}

/**
 * پیام سهمیه با ذکر زمان واقعی انتظار.
 *
 * قبلاً همیشه «چند دقیقه دیگر» گفته می‌شد که هم نادرست بود (معمولاً چند ثانیه
 * است) و هم کاربر را می‌ترساند که سهمیه‌اش واقعاً تمام شده. حالا اگر سرویس
 * زمان دقیق داده باشد، همان به کاربر گفته می‌شود.
 */
export function buildQuotaMessage(providerLabel: string, retryAfterMs?: number): string {
  const seconds = typeof retryAfterMs === "number" ? Math.ceil(retryAfterMs / 1000) : undefined;

  if (seconds !== undefined && seconds > 0 && seconds <= 90) {
    return `سرویس ${providerLabel} همین الان ظرفیت خالی ندارد. حدود ${seconds} ثانیهٔ دیگر دوباره بفرست 🙂`;
  }
  if (seconds !== undefined && seconds > 90) {
    const minutes = Math.ceil(seconds / 60);
    return `سرویس ${providerLabel} موقتاً به سقف مصرف خورده. حدود ${minutes} دقیقهٔ دیگر دوباره تلاش کن.`;
  }
  return `سرویس ${providerLabel} همین الان ظرفیت خالی ندارد؛ چند لحظه صبر کن و دوباره بفرست.`;
}

/** کد وضعیت HTTP مناسب برای هر خطای هوش مصنوعی. */
export function httpStatusForAiError(error: unknown): number {
  if (error instanceof ModelTimeoutError) return 504;
  if (error instanceof QuotaExhaustedError) return 429;
  if (error instanceof ModelBusyError) return 503;
  if (error instanceof MissingApiKeyError) return 500;
  if (error instanceof ProviderRequestError) return error.status && error.status < 500 ? 400 : 502;
  return 500;
}

/** آیا کلاینت می‌تواند دوباره تلاش کند؟ */
export function isRetryableAiError(error: unknown): boolean {
  return (
    error instanceof ModelBusyError ||
    error instanceof ModelTimeoutError ||
    error instanceof QuotaExhaustedError
  );
}
