/**
 * مکانیزم تلاش مجدد خودکار (Retry) برای خطاهای موقت پایگاه داده
 * ---------------------------------------------------------------------------
 * خطاهای هم‌زمانی (deadlock، serialization failure، قفل شدن دیتابیس، تایم‌اوت
 * connection pool) ذاتاً گذرا هستند: همان عملیات چند میلی‌ثانیه بعد موفق می‌شود.
 * این ماژول یک لایهٔ عمومی «تلاش مجدد با عقب‌نشینی نمایی + jitter» فراهم می‌کند
 * تا این خطاها هرگز به کاربر نرسند.
 *
 * چرا jitter؟ اگر چند درخواست هم‌زمان با فاصلهٔ یکسان تلاش مجدد کنند، دوباره با
 * هم برخورد می‌کنند (thundering herd). jitter تصادفی این هم‌فازی را می‌شکند.
 *
 * نکتهٔ مهم دربارهٔ ایمنی: تلاش مجدد فقط برای عملیاتی امن است که یا خواندنی
 * باشد یا idempotent (تراکنش کامل که یا همه‌چیز اعمال می‌شود یا هیچ‌چیز).
 * به همین دلیل نوشتن‌های چندمرحله‌ای باید داخل `runInTransaction` بسته شوند تا
 * تلاش مجدد آن‌ها اثر جانبی نیمه‌کاره نگذارد.
 */

import { classifyDbError, describeDbError, isTransientDbError } from './errors';

export interface RetryOptions {
  /** حداکثر تعداد کل تلاش‌ها (شامل تلاش اول). پیش‌فرض ۴. */
  maxAttempts?: number;
  /** فاصلهٔ پایه برای عقب‌نشینی نمایی به میلی‌ثانیه. پیش‌فرض ۵۰. */
  baseDelayMs?: number;
  /** سقف فاصلهٔ هر تلاش به میلی‌ثانیه. پیش‌فرض ۱۰۰۰. */
  maxDelayMs?: number;
  /** سقف زمان کل (شامل همهٔ تلاش‌ها) به میلی‌ثانیه. پیش‌فرض ۱۰۰۰۰. */
  totalTimeoutMs?: number;
  /** برچسب عملیات برای لاگ‌های قابل ردیابی. */
  label?: string;
  /** تشخیص سفارشی خطای قابل تلاش مجدد (پیش‌فرض: خطاهای موقت دیتابیس). */
  isRetryable?: (error: unknown) => boolean;
  /** فراخوان اطلاع‌رسانی پیش از هر تلاش مجدد (برای تست/مانیتورینگ). */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown; label?: string }) => void;
  /** تابع تأخیر قابل تزریق (برای تست بدون انتظار واقعی). */
  sleep?: (ms: number) => Promise<void>;
  /** منبع عدد تصادفی قابل تزریق (برای تست قطعی). */
  random?: () => number;
  /** ساعت قابل تزریق (برای تست سقف زمان کل). */
  now?: () => number;
}

const DEFAULTS = {
  maxAttempts: 4,
  baseDelayMs: 50,
  maxDelayMs: 1_000,
  totalTimeoutMs: 10_000,
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * محاسبهٔ فاصلهٔ تلاش بعدی: عقب‌نشینی نمایی با «full jitter».
 * تلاش ۱ → ۰..۵۰ms، تلاش ۲ → ۰..۱۰۰ms، تلاش ۳ → ۰..۲۰۰ms و ...
 */
export function computeBackoffDelay(
  attempt: number,
  options: { baseDelayMs?: number; maxDelayMs?: number; random?: () => number } = {},
): number {
  const baseDelayMs = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const random = options.random ?? Math.random;
  const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  // حداقل یک میلی‌ثانیه تا حلقهٔ رویداد فرصت آزاد شدن قفل را بدهد.
  return Math.max(1, Math.round(random() * exponential));
}

/** خطای پوششی وقتی همهٔ تلاش‌ها ناموفق بمانند؛ خطای اصلی در `cause` حفظ می‌شود. */
export class DbRetryExhaustedError extends Error {
  readonly attempts: number;
  readonly label?: string;
  constructor(message: string, options: { cause: unknown; attempts: number; label?: string }) {
    super(message, { cause: options.cause });
    this.name = 'DbRetryExhaustedError';
    this.attempts = options.attempts;
    this.label = options.label;
  }
}

/**
 * اجرای یک عملیات با تلاش مجدد خودکار در برابر خطاهای موقت هم‌زمانی.
 *
 * @param operation تابعی که در هر تلاش اجرا می‌شود؛ شمارهٔ تلاش (از ۱) را دریافت می‌کند.
 */
export async function withDbRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULTS.maxAttempts);
  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULTS.totalTimeoutMs;
  const isRetryable = options.isRetryable ?? isTransientDbError;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const startedAt = now();

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt || !isRetryable(error)) throw error;

      const delayMs = computeBackoffDelay(attempt, options);
      // اگر خواب بعدی از سقف زمان کل عبور کند، همان‌جا خطای اصلی پرتاب می‌شود تا
      // درخواست کاربر بی‌نهایت معطل نماند.
      if (now() - startedAt + delayMs > totalTimeoutMs) throw error;

      options.onRetry?.({ attempt, delayMs, error, label: options.label });
      if (process.env.NODE_ENV !== 'test') {
        console.warn(
          `[db-retry] ${options.label || 'operation'} attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms — ${describeDbError(error)}`,
        );
      }
      await sleep(delayMs);
    }
  }

  // از نظر منطقی غیرقابل دسترسی است؛ برای کامل بودن نوع بازگشتی نگه داشته شده.
  throw new DbRetryExhaustedError(
    classifyDbError(lastError).userMessage,
    { cause: lastError, attempts: maxAttempts, label: options.label },
  );
}

/** پیش‌تنظیم‌های آمادهٔ Retry برای انواع عملیات. */
export const RETRY_PROFILES = {
  /** خواندن‌ها ارزان و کاملاً idempotent هستند: تلاش بیشتر، فاصلهٔ کوتاه‌تر. */
  read: { maxAttempts: 4, baseDelayMs: 40, maxDelayMs: 600, totalTimeoutMs: 8_000 },
  /** نوشتن تک‌عبارتی یا تراکنشی: تلاش متعادل. */
  write: { maxAttempts: 4, baseDelayMs: 60, maxDelayMs: 1_000, totalTimeoutMs: 10_000 },
  /** عملیات سنگین (حذف بخش، انتقال مدیریت): فاصلهٔ بیشتر و مهلت طولانی‌تر. */
  heavy: { maxAttempts: 3, baseDelayMs: 150, maxDelayMs: 2_000, totalTimeoutMs: 20_000 },
} as const satisfies Record<string, RetryOptions>;
