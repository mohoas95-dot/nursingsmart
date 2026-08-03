/**
 * حذف درخواست‌های تکراری (Idempotency / Request De-duplication)
 * ---------------------------------------------------------------------------
 * سناریوی واقعی: کاربر روی «ثبت» دوبار سریع کلیک می‌کند، یا شبکه کند است و
 * مرورگر درخواست را دوباره می‌فرستد. سرور دو بار همان عملیات را اجرا می‌کند و
 * نتیجه یا رکورد تکراری است یا خطای تداخل.
 *
 * راهکار: نتیجهٔ اولین اجرا برای یک «کلید یکتا» کوتاه‌مدت نگه داشته می‌شود.
 * درخواست دوم با همان کلید، به‌جای اجرای دوباره، همان نتیجه (همان Promise) را
 * دریافت می‌کند. بنابراین:
 *   - دو کلیک سریع → یک نوشتن در پایگاه داده، دو پاسخ موفق یکسان.
 *   - رفتار کاربر تغییری نمی‌کند و خطای گیج‌کننده نمی‌بیند.
 *
 * ⚠️ محدودیت آگاهانه: کش درون‌حافظه‌ای و مخصوص همان پردازه است. برای استقرار
 * چندنمونه‌ای، این لایه فشار را کم می‌کند اما ضمانت نهایی همچنان قیدهای یکتایی
 * پایگاه داده و تراکنش‌های سریالی هستند.
 */

interface CacheEntry<T = unknown> {
  promise: Promise<T>;
  /** زمان انقضا؛ پس از آن رکورد بی‌اعتبار است. */
  expiresAt: number;
  /** آیا عملیات با خطا تمام شد؟ نتیجهٔ ناموفق نباید کش شود. */
  failed: boolean;
}

const cache = new Map<string, CacheEntry>();

/** مدت اعتبار نتیجهٔ موفق (ms). پنجرهٔ کلیک‌های تکراری معمولاً چند ثانیه است. */
const DEFAULT_TTL_MS = 10_000;
/** سقف تعداد رکوردها تا حافظه بی‌مهار رشد نکند. */
const MAX_ENTRIES = 500;

function pruneExpired(now: number) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now || entry.failed) cache.delete(key);
  }
  if (cache.size <= MAX_ENTRIES) return;
  // هنوز بزرگ است: قدیمی‌ترین‌ها (ترتیب درج Map) حذف می‌شوند.
  const overflow = cache.size - MAX_ENTRIES;
  let removed = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    if (++removed >= overflow) break;
  }
}

export interface IdempotencyOptions {
  /** مدت نگهداری نتیجهٔ موفق (ms). پیش‌فرض ۱۰ ثانیه. */
  ttlMs?: number;
  /**
   * آیا نتایج ناموفق هم کش شوند؟ پیش‌فرض `false`: خطا نباید تلاش مجدد صادقانهٔ
   * کاربر را مسدود کند. (تلاش‌های هم‌زمانِ در حال اجرا همچنان به هم می‌پیوندند.)
   */
  cacheFailures?: boolean;
}

/**
 * اجرای `operation` به‌ازای هر `key` فقط یک‌بار در پنجرهٔ زمانی مشخص.
 * درخواست‌های هم‌زمان یا سریعِ بعدی همان نتیجه را دریافت می‌کنند.
 */
export function runIdempotent<T>(
  key: string,
  operation: () => Promise<T>,
  options: IdempotencyOptions = {},
): Promise<T> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();
  pruneExpired(now);

  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now && !existing.failed) {
    return existing.promise;
  }

  const entry: CacheEntry<T> = {
    promise: operation(),
    expiresAt: now + ttlMs,
    failed: false,
  };
  cache.set(key, entry as CacheEntry);

  entry.promise.catch(() => {
    entry.failed = true;
    if (!options.cacheFailures && cache.get(key) === (entry as CacheEntry)) {
      // خطا کش نمی‌شود تا کاربر بتواند بلافاصله دوباره تلاش کند.
      cache.delete(key);
    }
  });

  return entry.promise;
}

/** پاک‌کردن کش (برای تست یا ابطال دستی یک کلید). */
export function clearIdempotencyCache(key?: string) {
  if (key === undefined) cache.clear();
  else cache.delete(key);
}

/** تعداد رکوردهای فعال کش (برای تست و مانیتورینگ). */
export function idempotencyCacheSize(): number {
  return cache.size;
}
