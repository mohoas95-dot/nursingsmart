/**
 * کلاینت HTTP مقاوم در برابر خطاهای موقت
 * ---------------------------------------------------------------------------
 * سرور اکنون خطاهای گذرای هم‌زمانی را با کد ۴۰۹/۴۲۹/۵۰۳ و پرچم `retryable`
 * (به‌همراه هدر `Retry-After`) برمی‌گرداند. این ماژول همان قرارداد را در سمت
 * کلاینت پیاده می‌کند تا کاربر هرگز به‌خاطر یک تداخل لحظه‌ای پیام خطا نبیند.
 *
 * قواعد ایمنی:
 *  - فقط متدهای idempotent (GET/HEAD) به‌صورت پیش‌فرض تلاش مجدد می‌شوند.
 *  - متدهای تغییردهنده (POST/PATCH/DELETE/PUT) فقط وقتی تکرار می‌شوند که سرور
 *    صریحاً `retryable: true` گفته باشد یا وضعیت ۴۲۹/۵۰۳ باشد؛ یعنی جایی که
 *    قطعاً هیچ تغییری اعمال نشده است.
 *  - خطای شبکه‌ای روی درخواست تغییردهنده تکرار نمی‌شود مگر با اجازهٔ صریح، چون
 *    ممکن است درخواست به سرور رسیده و فقط پاسخ گم شده باشد.
 */

/** وضعیت‌هایی که همیشه نشانهٔ اختلال گذرا هستند. */
const TRANSIENT_STATUSES = new Set([429, 503, 504]);

export interface ResilientFetchOptions extends RequestInit {
  /** حداکثر تعداد کل تلاش‌ها. پیش‌فرض ۳ برای خواندن، ۲ برای نوشتن. */
  maxAttempts?: number;
  /** فاصلهٔ پایه برای عقب‌نشینی نمایی (ms). */
  baseDelayMs?: number;
  /** سقف فاصله بین تلاش‌ها (ms). */
  maxDelayMs?: number;
  /** اجازهٔ تلاش مجدد برای درخواست‌های تغییردهنده در خطای شبکه. پیش‌فرض false. */
  retryOnNetworkError?: boolean;
  /** فراخوان اطلاع‌رسانی پیش از هر تلاش مجدد (برای نمایش «در حال تلاش مجدد…»). */
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
  /** تابع تأخیر قابل تزریق (تست). */
  sleep?: (ms: number) => Promise<void>;
  /** تابع fetch قابل تزریق (تست). */
  fetchImpl?: typeof fetch;
}

function defaultSleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function isIdempotentMethod(method: string) {
  const upper = method.toUpperCase();
  return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS';
}

/** خواندن هدر Retry-After (ثانیه یا تاریخ HTTP) و تبدیل به میلی‌ثانیه. */
export function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(headerValue);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 30_000));
  return null;
}

function backoffDelay(attempt: number, base: number, max: number) {
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  // full jitter: از هم‌فاز شدن چند تب/کاربر جلوگیری می‌کند.
  return Math.max(50, Math.round(Math.random() * exponential));
}

/**
 * تشخیص اینکه آیا پاسخ سرور «قابل تلاش مجدد» است.
 * بدنه فقط برای وضعیت‌های خطا و یک‌بار خوانده می‌شود (پاسخ کلون می‌شود).
 */
async function responseIsRetryable(response: Response, allowMutating: boolean): Promise<boolean> {
  if (response.ok) return false;
  if (TRANSIENT_STATUSES.has(response.status)) return true;
  if (response.status < 500 && response.status !== 409) return false;
  if (response.status >= 500) return true;

  // وضعیت ۴۰۹: فقط اگر سرور صریحاً آن را گذرا اعلام کرده باشد.
  if (!allowMutating) return false;
  try {
    const body = await response.clone().json();
    return body?.retryable === true;
  } catch {
    return false;
  }
}

/**
 * `fetch` با تلاش مجدد خودکار و رعایت هدر `Retry-After`.
 * امضای آن با `fetch` سازگار است، پس جایگزینی مستقیم دارد.
 */
export async function resilientFetch(
  input: RequestInfo | URL,
  options: ResilientFetchOptions = {},
): Promise<Response> {
  const {
    maxAttempts,
    baseDelayMs = 200,
    maxDelayMs = 3_000,
    retryOnNetworkError,
    onRetry,
    sleep = defaultSleep,
    fetchImpl,
    ...requestInit
  } = options;

  const doFetch = fetchImpl ?? fetch;
  const method = (requestInit.method || 'GET').toUpperCase();
  const idempotent = isIdempotentMethod(method);
  const attempts = Math.max(1, maxAttempts ?? (idempotent ? 3 : 2));
  // درخواست تغییردهنده فقط با اجازهٔ صریح در خطای شبکه تکرار می‌شود، چون ممکن
  // است سرور آن را دریافت و اعمال کرده باشد و فقط پاسخ گم شده باشد.
  const retryNetwork = retryOnNetworkError ?? idempotent;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await doFetch(input, requestInit);
      if (attempt === attempts) return response;
      if (!(await responseIsRetryable(response, true))) return response;

      const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
      const delayMs = retryAfterMs ?? backoffDelay(attempt, baseDelayMs, maxDelayMs);
      onRetry?.({ attempt, delayMs, reason: `HTTP ${response.status}` });
      await sleep(delayMs);
    } catch (error) {
      lastError = error;
      // درخواست لغوشده (AbortController) هرگز تکرار نمی‌شود.
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (attempt === attempts || !retryNetwork) throw error;

      const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs);
      onRetry?.({ attempt, delayMs, reason: 'network' });
      await sleep(delayMs);
    }
  }

  throw lastError ?? new Error('resilientFetch: همهٔ تلاش‌ها ناموفق بود.');
}

/**
 * `resilientFetch` + خواندن JSON + یکسان‌سازی خطاها.
 * پیام خطای سرور (فیلد `error`) مستقیماً به کاربر قابل نمایش است.
 */
export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  options: ResilientFetchOptions = {},
): Promise<T> {
  const response = await resilientFetch(input, options);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // پاسخ بدون بدنهٔ JSON (مثلاً 502 از پروکسی).
  }

  const payload = body as { success?: boolean; error?: string; retryable?: boolean } | null;
  if (!response.ok || payload?.success === false) {
    const error = new HttpRequestError(
      payload?.error || `درخواست با خطای ${response.status} مواجه شد.`,
      response.status,
      payload,
    );
    throw error;
  }
  return body as T;
}

/** خطای درخواست HTTP با حفظ کد وضعیت و بدنهٔ پاسخ برای تصمیم‌گیری در UI. */
export class HttpRequestError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly retryable: boolean;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'HttpRequestError';
    this.status = status;
    this.body = body;
    this.retryable = (body as { retryable?: boolean } | null)?.retryable === true ||
      TRANSIENT_STATUSES.has(status);
  }
}
