/**
 * لایهٔ ارتباط با پایگاه داده (Prisma) با مدیریت تراکنش و تلاش مجدد خودکار
 * ---------------------------------------------------------------------------
 * تمام مسیرهای برنامه باید از این ماژول استفاده کنند، نه مستقیماً از
 * `prisma.<model>.<op>()`. دلیل:
 *
 *  ۱) هر عملیات به‌صورت خودکار در برابر خطاهای موقت هم‌زمانی (deadlock، قفل شدن
 *     دیتابیس، تایم‌اوت connection pool) تلاش مجدد می‌شود.
 *  ۲) تراکنش‌ها مهلت (timeout) صریح و سطح ایزولاسیون مشخص دارند، بنابراین یک
 *     تراکنش کند هرگز اتصال‌ها را قفل نگه نمی‌دارد.
 *  ۳) در توسعه، فراخوانی‌های کند شناسایی و لاگ می‌شوند.
 *
 * قواعد استفاده:
 *  - خواندن ساده → `dbRead(...)`
 *  - نوشتن تک‌عبارتی → `dbWrite(...)`
 *  - چند نوشتن مرتبط → `runInTransaction(async (tx) => ...)`  (هرگز چند await جدا!)
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { RETRY_PROFILES, withDbRetry, type RetryOptions } from './retry';
import { classifyDbError, describeDbError } from './errors';

/**
 * مهلت‌های تراکنش. مقادیر عمداً کوتاه‌اند: یک تراکنش که بیش از این طول بکشد
 * نشانهٔ کار سنگین داخل تراکنش است و باید بیرون از آن انجام شود، وگرنه قفل‌ها را
 * نگه می‌دارد و باعث deadlock درخواست‌های دیگر می‌شود.
 */
export const TRANSACTION_DEFAULTS = {
  /** حداکثر انتظار برای گرفتن اتصال از pool پیش از شروع تراکنش (ms). */
  maxWait: 5_000,
  /** حداکثر مدت اجرای خود تراکنش (ms). */
  timeout: 10_000,
} as const;

/** آستانهٔ لاگ‌کردن کوئری کند در محیط توسعه (ms). */
const SLOW_QUERY_THRESHOLD_MS = 2_000;

type GlobalWithPrisma = typeof globalThis & { __nursingsmartPrisma?: PrismaClient };
const globalForPrisma = globalThis as GlobalWithPrisma;

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    // خطاهای کوتاه‌شده در تولید از افشای ساختار پرس‌وجو جلوگیری می‌کند.
    errorFormat: process.env.NODE_ENV === 'production' ? 'minimal' : 'colorless',
  });
}

/**
 * یک نمونهٔ واحد Prisma برای کل فرایند.
 *
 * در حالت توسعه، Hot Reload ماژول‌ها را دوباره اجرا می‌کند؛ بدون نگهداری نمونه
 * روی `globalThis` هر بار یک PrismaClient تازه ساخته می‌شد و connection pool
 * پایگاه داده سریعاً پر می‌شد — یکی از علت‌های رایج خطای «آماده نبودن دیتابیس».
 */
export const prisma: PrismaClient = globalForPrisma.__nursingsmartPrisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__nursingsmartPrisma = prisma;

/** کلاینت داخل تراکنش: همان API مدل‌ها بدون امکان تراکنش تودرتو. */
export type TransactionClient = Prisma.TransactionClient;

/**
 * سطوح ایزولاسیون پشتیبانی‌شده توسط PostgreSQL.
 *
 * عمداً به‌صورت اتحاد رشته‌ای محلی تعریف شده و از `Prisma.TransactionIsolationLevel`
 * وارد نمی‌شود: آن نوع فقط پس از `prisma generate` با دسترسی به موتورها وجود دارد
 * و در محیط‌های CI/بدون شبکه، بررسی نوع را می‌شکست.
 */
export type TransactionIsolationLevel =
  | 'ReadUncommitted'
  | 'ReadCommitted'
  | 'RepeatableRead'
  | 'Serializable';

/** هر چیزی که بتوان روی آن کوئری زد (کلاینت اصلی یا کلاینت تراکنش). */
export type DbClient = PrismaClient | TransactionClient;

function logSlowOperation(label: string, durationMs: number) {
  if (durationMs < SLOW_QUERY_THRESHOLD_MS) return;
  console.warn(`[db-slow] ${label} took ${Math.round(durationMs)}ms — بررسی کنید که کار سنگین داخل تراکنش نباشد.`);
}

/**
 * اجرای یک عملیات خواندنی با تلاش مجدد خودکار.
 * خواندن‌ها ذاتاً idempotent هستند، پس تلاش مجدد کاملاً امن است.
 */
export function dbRead<T>(
  operation: (client: PrismaClient) => T | Promise<T>,
  options: { label?: string } & RetryOptions = {},
): Promise<Awaited<T>> {
  const label = options.label || 'db-read';
  return withDbRetry(async (): Promise<Awaited<T>> => {
    const startedAt = Date.now();
    try {
      return await operation(prisma);
    } finally {
      logSlowOperation(label, Date.now() - startedAt);
    }
  }, { ...RETRY_PROFILES.read, ...options, label });
}

/**
 * اجرای یک نوشتن تک‌عبارتی با تلاش مجدد خودکار.
 *
 * ⚠️ فقط برای عملیات تک‌عبارتی (یک update/create/delete) استفاده شود؛ چون
 * PostgreSQL هر عبارت را اتمیک اجرا می‌کند، تلاش مجدد اثر جانبی نیمه‌کاره
 * نمی‌گذارد. برای چند نوشتن مرتبط حتماً از `runInTransaction` استفاده کنید.
 */
export function dbWrite<T>(
  operation: (client: PrismaClient) => T | Promise<T>,
  options: { label?: string } & RetryOptions = {},
): Promise<Awaited<T>> {
  const label = options.label || 'db-write';
  return withDbRetry(async (): Promise<Awaited<T>> => {
    const startedAt = Date.now();
    try {
      return await operation(prisma);
    } finally {
      logSlowOperation(label, Date.now() - startedAt);
    }
  }, { ...RETRY_PROFILES.write, ...options, label });
}

export interface TransactionOptions extends RetryOptions {
  /** حداکثر انتظار برای گرفتن اتصال از pool (ms). */
  maxWait?: number;
  /** حداکثر مدت اجرای تراکنش (ms). پس از آن تراکنش rollback می‌شود. */
  timeout?: number;
  /**
   * سطح ایزولاسیون. پیش‌فرض عمداً تعیین نشده تا از پیش‌فرض پایگاه داده
   * (`ReadCommitted` در PostgreSQL) استفاده شود: کمترین احتمال قفل و
   * serialization failure. فقط وقتی «read-modify-write» واقعاً باید سریال شود
   * `Serializable` را انتخاب کنید — چون خودِ Retry اینجا هست، شکست سریال‌سازی
   * به‌صورت خودکار جبران می‌شود.
   */
  isolationLevel?: TransactionIsolationLevel;
}

/**
 * اجرای چند عملیات مرتبط در یک تراکنش اتمیک، با تلاش مجدد خودکار.
 *
 * چرا حیاتی است؟ چند `await prisma...` پشت سر هم، چند تراکنش مستقل هستند: اگر
 * دومی خطا بدهد، اولی برنمی‌گردد و داده ناسازگار می‌ماند. همچنین دو درخواست
 * هم‌زمان می‌توانند بین آن‌ها وارد شوند (شرایط رقابتی).
 *
 * ⚠️ داخل تراکنش هرگز کار کند و غیرپایگاه‌داده‌ای انجام ندهید (bcrypt، fetch،
 * S3). محاسبات سنگین را پیش از شروع تراکنش انجام دهید تا قفل‌ها زود آزاد شوند.
 */
export function runInTransaction<T>(
  operation: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const label = options.label || 'db-transaction';
  const { maxWait, timeout, isolationLevel, ...retryOptions } = options;

  return withDbRetry(async (): Promise<T> => {
    const startedAt = Date.now();
    try {
      // ⚠️ نوع `operation` عمداً دقیقاً `=> Promise<T>` است، نه `=> T | Promise<T>`.
      //
      // `$transaction` دو اورلود دارد: یکی آرایه‌ای (`PrismaPromise[]`) و یکی
      // تعاملی (`(tx) => Promise<R>`). اگر امضای ورودی را منعطف کنیم، تابع ما با
      // اورلود تعاملی تطبیق پیدا نمی‌کند و TypeScript به اورلود آرایه‌ای برمی‌گردد
      // که `unknown[]` برمی‌گرداند و کل استنتاج نوع می‌شکند.
      // (این خطا در build واقعی Vercel ظاهر شد و باید همین‌طور سخت‌گیرانه بماند.)
      return await prisma.$transaction(operation, {
        maxWait: maxWait ?? TRANSACTION_DEFAULTS.maxWait,
        timeout: timeout ?? TRANSACTION_DEFAULTS.timeout,
        ...(isolationLevel ? { isolationLevel } : {}),
      });
    } finally {
      logSlowOperation(label, Date.now() - startedAt);
    }
  }, { ...RETRY_PROFILES.write, ...retryOptions, label });
}

/**
 * اجرای یک تراکنش «سریالی» برای الگوی خواندن-تصمیم-نوشتن.
 *
 * وقتی درستی عملیات به این وابسته است که هیچ تراکنش دیگری هم‌زمان همان ردیف‌ها
 * را تغییر ندهد (مثل «اگر کاربر وجود ندارد بساز، وگرنه به‌روزرسانی کن»)، این
 * تابع سطح ایزولاسیون را روی `Serializable` می‌گذارد. شکست سریال‌سازی
 * (`40001`) به‌صورت خودکار تلاش مجدد می‌شود، پس این سخت‌گیری هزینه‌ای برای
 * کاربر ندارد.
 */
export function runInSerializableTransaction<T>(
  operation: (tx: TransactionClient) => Promise<T>,
  options: Omit<TransactionOptions, 'isolationLevel'> = {},
): Promise<T> {
  return runInTransaction(operation, {
    ...options,
    isolationLevel: 'Serializable',
    label: options.label || 'db-serializable-transaction',
    // شکست سریال‌سازی زیر بار هم‌زمان طبیعی است؛ تلاش بیشتری مجاز است.
    maxAttempts: options.maxAttempts ?? 6,
  });
}

/**
 * بررسی در دسترس بودن پایگاه داده (برای health check و پیام‌های شفاف به کاربر).
 * هرگز throw نمی‌کند.
 */
export async function checkDatabaseHealth(): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
  retryable?: boolean;
}> {
  const startedAt = Date.now();
  try {
    await withDbRetry(() => prisma.$queryRaw`SELECT 1`, {
      ...RETRY_PROFILES.read,
      maxAttempts: 2,
      label: 'db-health',
    });
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const info = classifyDbError(error);
    console.error('[db-health] پایگاه داده در دسترس نیست:', describeDbError(error));
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: info.userMessage,
      retryable: info.retryable,
    };
  }
}
