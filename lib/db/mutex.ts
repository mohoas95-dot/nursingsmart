/**
 * قفل درون‌پردازه‌ای بر اساس کلید (Keyed Mutex)
 * ---------------------------------------------------------------------------
 * وقتی کاربر روی یک دکمه دوبار سریع کلیک می‌کند، دو درخواست هم‌زمان به سرور
 * می‌رسند و هر دو الگوی «بخوان → تصمیم بگیر → بنویس» را اجرا می‌کنند. نتیجه:
 * رکورد تکراری، نقض قید یکتایی، یا در بدترین حالت deadlock در پایگاه داده.
 *
 * این ماژول عملیات هم‌کلید را در همان پردازه سریال می‌کند تا اصلاً به پایگاه
 * داده فشار هم‌زمان وارد نشود. ارزان، بدون وابستگی و بدون I/O است.
 *
 * ⚠️ محدودیت آگاهانه: این قفل فقط درون یک پردازه معتبر است. در استقرار
 * چندنمونه‌ای، ایمنی نهایی همچنان بر عهدهٔ قیدهای پایگاه داده (unique index) و
 * تراکنش‌های سریالی است؛ این قفل «لایهٔ اول دفاع» و کاهش‌دهندهٔ تداخل است.
 */

interface MutexEntry {
  /** زنجیرهٔ عملیات در حال اجرا برای این کلید. */
  tail: Promise<unknown>;
  /** تعداد عملیات منتظر یا در حال اجرا. */
  waiting: number;
}

const locks = new Map<string, MutexEntry>();

/** حداکثر تعداد عملیات در صف یک کلید؛ فراتر از آن، درخواست رد می‌شود. */
const DEFAULT_MAX_QUEUE = 16;

export class MutexBusyError extends Error {
  readonly status = 429;
  readonly retryAfterSeconds = 2;
  constructor(key: string) {
    super('درخواست‌های هم‌زمان زیادی برای این عملیات ثبت شده است؛ لطفاً چند لحظه بعد دوباره تلاش کنید.');
    this.name = 'MutexBusyError';
    this.key = key;
  }
  readonly key: string;
}

/** آیا برای این کلید عملیاتی در حال اجراست؟ */
export function isMutexBusy(key: string): boolean {
  return locks.has(key);
}

/**
 * اجرای `operation` به‌صورت انحصاری برای `key`.
 * عملیات هم‌کلید به‌ترتیب ورود اجرا می‌شوند؛ کلیدهای متفاوت کاملاً موازی‌اند.
 */
export async function withMutex<T>(
  key: string,
  operation: () => Promise<T>,
  options: { maxQueue?: number } = {},
): Promise<T> {
  const maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE;
  const existing = locks.get(key);

  if (existing && existing.waiting >= maxQueue) {
    // صف بیش از حد طولانی شده: به‌جای انباشت درخواست‌ها و تمام‌شدن اتصال‌های
    // پایگاه داده، سریع و شفاف رد می‌کنیم.
    throw new MutexBusyError(key);
  }

  const entry: MutexEntry = existing ?? { tail: Promise.resolve(), waiting: 0 };
  entry.waiting += 1;
  locks.set(key, entry);

  // نتیجهٔ اجرای قبلی هرچه باشد (موفق یا ناموفق) صف نباید بشکند.
  const run = entry.tail.then(operation, operation);
  entry.tail = run.then(
    () => undefined,
    () => undefined,
  );

  try {
    return await run;
  } finally {
    entry.waiting -= 1;
    // آخرین عملیات این کلید تمام شد → آزادسازی حافظه.
    if (entry.waiting === 0 && locks.get(key) === entry) locks.delete(key);
  }
}
