/**
 * طبقه‌بندی خطاهای پایگاه‌داده (Prisma / PostgreSQL / SQLite)
 * ---------------------------------------------------------------------------
 * هدف: یک نقطهٔ واحد برای تشخیص اینکه یک خطا «موقتی» (قابل تلاش مجدد) است یا
 * «دائمی»، و تبدیل آن به پیام و کد وضعیت HTTP امن و استاندارد.
 *
 * چرا لازم است؟ خطاهای هم‌زمانی (deadlock، serialization failure، قفل شدن
 * دیتابیس، پرشدن connection pool، قطع موقت اتصال) در لحظهٔ کلیک‌های سریع کاربر
 * یا درخواست‌های هم‌زمان رخ می‌دهند و تقریباً همیشه با یک تلاش مجدد کوتاه برطرف
 * می‌شوند. بدون طبقه‌بندی، این خطاها به‌صورت «خطای داخلی سرور» به کاربر نمایش
 * داده می‌شدند و عملیات معتبر او از دست می‌رفت.
 *
 * این ماژول عمداً هیچ وابستگی‌ای به Prisma Client یا `server-only` ندارد تا هم در
 * تست‌های Node و هم در محیط سرور قابل استفاده باشد.
 */

export type DbErrorKind =
  /** نقض قید یکتایی (مثلاً کد ملی تکراری) — رقابت دو درخواست هم‌زمان روی ساخت یک رکورد */
  | 'unique_constraint'
  /** رکورد هدف پیدا نشد (ممکن است هم‌زمان حذف شده باشد) */
  | 'not_found'
  /** نقض کلید خارجی */
  | 'foreign_key'
  /** بن‌بست یا شکست سریال‌سازی تراکنش — کلاسیک‌ترین خطای هم‌زمانی */
  | 'write_conflict'
  /** قفل شدن جدول/دیتابیس یا انقضای مهلت قفل */
  | 'lock_timeout'
  /** قطع/عدم دسترسی موقت به سرور دیتابیس */
  | 'connection'
  /** پر شدن یا تایم‌اوت گرفتن اتصال از connection pool */
  | 'pool_timeout'
  /** خطای چرخهٔ عمر تراکنش (انقضای تراکنش تعاملی) */
  | 'transaction'
  /** خطای اعتبارسنجی ورودی کوئری */
  | 'validation'
  | 'unknown';

export interface DbErrorInfo {
  kind: DbErrorKind;
  /** کد Prisma (Pxxxx) یا کد SQLSTATE در صورت وجود */
  code: string | null;
  /** آیا تلاش مجدد خودکار منطقی است؟ */
  retryable: boolean;
  /** کد وضعیت HTTP پیشنهادی برای پاسخ به کاربر */
  httpStatus: number;
  /** پیام فارسی امن برای نمایش به کاربر (بدون افشای جزئیات داخلی) */
  userMessage: string;
  /** در خطاهای موقت: پیشنهاد فاصله تا تلاش بعدی (ثانیه) برای هدر Retry-After */
  retryAfterSeconds?: number;
}

/** کدهای Prisma که تقریباً همیشه با تلاش مجدد برطرف می‌شوند. */
const RETRYABLE_PRISMA_CODES = new Set([
  'P1001', // Can't reach database server
  'P1002', // Database server timed out
  'P1008', // Operations timed out
  'P1017', // Server has closed the connection
  'P2024', // Timed out fetching a new connection from the connection pool
  'P2028', // Transaction API error (تراکنش تعاملی منقضی شد)
  'P2034', // Transaction failed due to a write conflict or a deadlock
]);

/** کدهای SQLSTATE پستگرس که خطای هم‌زمانی/اتصال موقت هستند. */
const RETRYABLE_SQLSTATES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '55006', // object_in_use
  '57014', // query_canceled
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
  '53400', // configuration_limit_exceeded
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '08007', // transaction_resolution_unknown
  '08P01', // protocol_violation
]);

/**
 * الگوهای متنی خطاهای موقت. لازم است چون برخی درایورها/آداپترها کد ساخت‌یافته
 * برنمی‌گردانند و فقط پیام متنی دارند (به‌ویژه SQLite و خطاهای شبکه).
 */
const RETRYABLE_MESSAGE_PATTERNS: RegExp[] = [
  /deadlock/i,
  /could not serialize access/i,
  /serialization failure/i,
  /database is locked/i,
  /database table is locked/i,
  /SQLITE_BUSY/i,
  /SQLITE_LOCKED/i,
  /lock wait timeout/i,
  /lock timeout/i,
  /connection pool/i,
  /too many connections/i,
  /connection (?:terminated|closed|reset|refused)/i,
  /server has closed the connection/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /ETIMEDOUT/i,
  /EPIPE/i,
  /socket hang up/i,
  /Timed out fetching a new connection/i,
  /Transaction (?:already closed|not found|API error)/i,
  /Can't reach database server/i,
];

const NON_RETRYABLE_MESSAGE_PATTERNS: RegExp[] = [
  /Unique constraint failed/i,
  /Foreign key constraint/i,
];

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  meta?: Record<string, unknown> | null;
  cause?: unknown;
  clientVersion?: unknown;
}

function asErrorLike(error: unknown): ErrorLike {
  return (typeof error === 'object' && error !== null ? error : {}) as ErrorLike;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** متن کامل خطا شامل علت‌های تودرتو، برای تطبیق الگوهای متنی. */
function collectMessages(error: unknown, depth = 0): string {
  if (depth > 4 || error === null || error === undefined) return '';
  if (typeof error === 'string') return error;
  const candidate = asErrorLike(error);
  const parts: string[] = [];
  const message = readString(candidate.message);
  if (message) parts.push(message);
  const meta = candidate.meta as Record<string, unknown> | null | undefined;
  const metaCause = meta ? readString(meta.cause) : null;
  if (metaCause) parts.push(metaCause);
  const metaMessage = meta ? readString(meta.message) : null;
  if (metaMessage) parts.push(metaMessage);
  if (candidate.cause) parts.push(collectMessages(candidate.cause, depth + 1));
  return parts.join(' | ');
}

/** استخراج کد Prisma یا SQLSTATE از هر جای ساختار خطا. */
export function extractDbErrorCode(error: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  const candidate = asErrorLike(error);
  const direct = readString(candidate.code);
  if (direct) return direct;
  const meta = candidate.meta as Record<string, unknown> | null | undefined;
  if (meta) {
    const metaCode = readString(meta.code);
    if (metaCode) return metaCode;
    // برخی درایورها (Prisma driver adapters) کد اصلی SQLSTATE را یک لایه
    // پایین‌تر و داخل `meta.driverAdapterError` قرار می‌دهند.
    const adapterCode = meta.driverAdapterError
      ? readString(asErrorLike(meta.driverAdapterError).code)
      : null;
    if (adapterCode) return adapterCode;
  }
  if (candidate.cause) return extractDbErrorCode(candidate.cause, depth + 1);
  return null;
}

/** آیا این خطا یک خطای شناخته‌شدهٔ Prisma است؟ (بدون وابستگی به instanceof) */
export function isPrismaKnownError(error: unknown): boolean {
  const candidate = asErrorLike(error);
  const name = readString(candidate.name);
  const code = readString(candidate.code);
  return (
    (name?.startsWith('PrismaClient') ?? false) ||
    (code !== null && /^P\d{4}$/.test(code))
  );
}

/** آیا خطا نقض قید یکتایی است؟ (رقابت دو درخواست هم‌زمان روی ساخت رکورد) */
export function isUniqueConstraintError(error: unknown): boolean {
  return extractDbErrorCode(error) === 'P2002' ||
    /Unique constraint failed/i.test(collectMessages(error));
}

/** آیا رکورد هدف عملیات وجود ندارد (احتمالاً هم‌زمان حذف شده)؟ */
export function isRecordNotFoundError(error: unknown): boolean {
  const code = extractDbErrorCode(error);
  return code === 'P2025' || code === 'P2015' || code === 'P2018';
}

/** فیلد(های) درگیر در نقض قید یکتایی، برای پیام دقیق‌تر به کاربر. */
export function uniqueConstraintTargets(error: unknown): string[] {
  const candidate = asErrorLike(error);
  const target = candidate.meta ? (candidate.meta as Record<string, unknown>).target : undefined;
  if (Array.isArray(target)) return target.filter((item): item is string => typeof item === 'string');
  if (typeof target === 'string') return [target];
  return [];
}

/**
 * تشخیص خطاهای موقتِ هم‌زمانی که تلاش مجدد برای آن‌ها منطقی است.
 * این تابع قلب مکانیزم Retry است.
 */
export function isTransientDbError(error: unknown): boolean {
  const code = extractDbErrorCode(error);
  if (code) {
    if (RETRYABLE_PRISMA_CODES.has(code)) return true;
    if (RETRYABLE_SQLSTATES.has(code)) return true;
    // سایر کدهای شناخته‌شدهٔ Prisma (P2002، P2025، ...) خطای منطقی‌اند نه موقتی.
    if (/^P\d{4}$/.test(code)) return false;
  }

  const name = readString(asErrorLike(error).name);
  // خطای راه‌اندازی کلاینت معمولاً هنگام بالا آمدن دیتابیس رخ می‌دهد و گذراست.
  if (name === 'PrismaClientInitializationError') return true;
  // پنیک موتور Rust با تلاش مجدد برطرف نمی‌شود و باید گزارش شود.
  if (name === 'PrismaClientRustPanicError') return false;
  if (name === 'PrismaClientValidationError') return false;

  const message = collectMessages(error);
  if (!message) return false;
  if (NON_RETRYABLE_MESSAGE_PATTERNS.some(pattern => pattern.test(message))) return false;
  return RETRYABLE_MESSAGE_PATTERNS.some(pattern => pattern.test(message));
}

const KIND_BY_PRISMA_CODE: Record<string, DbErrorKind> = {
  P2002: 'unique_constraint',
  P2003: 'foreign_key',
  P2014: 'foreign_key',
  P2015: 'not_found',
  P2018: 'not_found',
  P2025: 'not_found',
  P2034: 'write_conflict',
  P2028: 'transaction',
  P2024: 'pool_timeout',
  P1001: 'connection',
  P1002: 'connection',
  P1008: 'connection',
  P1017: 'connection',
};

/** طبقه‌بندی کامل خطا به‌همراه پیام فارسی و کد وضعیت HTTP امن. */
export function classifyDbError(error: unknown): DbErrorInfo {
  const code = extractDbErrorCode(error);
  const message = collectMessages(error);
  const retryable = isTransientDbError(error);

  let kind: DbErrorKind = (code && KIND_BY_PRISMA_CODE[code]) || 'unknown';
  if (kind === 'unknown') {
    if (code && RETRYABLE_SQLSTATES.has(code)) {
      kind = code === '40001' || code === '40P01' ? 'write_conflict'
        : code === '55P03' || code === '55006' ? 'lock_timeout'
        : 'connection';
    } else if (/deadlock|could not serialize|serialization failure/i.test(message)) {
      kind = 'write_conflict';
    } else if (/database is locked|table is locked|SQLITE_BUSY|SQLITE_LOCKED|lock wait timeout/i.test(message)) {
      kind = 'lock_timeout';
    } else if (/connection pool|Timed out fetching a new connection/i.test(message)) {
      kind = 'pool_timeout';
    } else if (/connection|ECONNRESET|ETIMEDOUT|socket hang up/i.test(message)) {
      kind = 'connection';
    } else if (readString(asErrorLike(error).name) === 'PrismaClientValidationError') {
      kind = 'validation';
    }
  }

  switch (kind) {
    case 'unique_constraint':
      return {
        kind, code, retryable: false, httpStatus: 409,
        userMessage: 'این اطلاعات قبلاً ثبت شده است؛ صفحه را تازه‌سازی کنید و دوباره تلاش کنید.',
      };
    case 'not_found':
      return {
        kind, code, retryable: false, httpStatus: 404,
        userMessage: 'رکورد موردنظر یافت نشد؛ ممکن است هم‌زمان توسط کاربر دیگری حذف شده باشد.',
      };
    case 'foreign_key':
      return {
        kind, code, retryable: false, httpStatus: 409,
        userMessage: 'این عملیات با داده‌های وابسته تداخل دارد؛ ابتدا موارد مرتبط را بررسی کنید.',
      };
    case 'write_conflict':
      return {
        kind, code, retryable: true, httpStatus: 409, retryAfterSeconds: 1,
        userMessage: 'به‌دلیل ثبت هم‌زمان اطلاعات، این عملیات انجام نشد؛ لطفاً چند لحظه بعد دوباره تلاش کنید.',
      };
    case 'lock_timeout':
      return {
        kind, code, retryable: true, httpStatus: 503, retryAfterSeconds: 2,
        userMessage: 'پایگاه داده لحظه‌ای قفل شده است؛ لطفاً چند ثانیهٔ دیگر دوباره تلاش کنید.',
      };
    case 'pool_timeout':
      return {
        kind, code, retryable: true, httpStatus: 503, retryAfterSeconds: 3,
        userMessage: 'سامانه در حال حاضر درخواست‌های زیادی دارد؛ لطفاً کمی بعد دوباره تلاش کنید.',
      };
    case 'connection':
      return {
        kind, code, retryable: true, httpStatus: 503, retryAfterSeconds: 3,
        userMessage: 'ارتباط با پایگاه داده موقتاً برقرار نیست؛ لطفاً کمی بعد دوباره تلاش کنید.',
      };
    case 'transaction':
      return {
        kind, code, retryable: true, httpStatus: 503, retryAfterSeconds: 1,
        userMessage: 'ثبت اطلاعات به‌دلیل طولانی شدن پردازش کامل نشد؛ لطفاً دوباره تلاش کنید.',
      };
    case 'validation':
      return {
        kind, code, retryable: false, httpStatus: 400,
        userMessage: 'اطلاعات ارسال‌شده برای ثبت در پایگاه داده معتبر نیست.',
      };
    default:
      return {
        kind: 'unknown', code, retryable,
        httpStatus: retryable ? 503 : 500,
        retryAfterSeconds: retryable ? 2 : undefined,
        userMessage: retryable
          ? 'اختلال موقت در پایگاه داده؛ لطفاً چند لحظه بعد دوباره تلاش کنید.'
          : 'خطای داخلی سرور؛ دوباره تلاش کنید.',
      };
  }
}

/** آیا خطا مربوط به پایگاه داده است؟ (برای تصمیم‌گیری در لایهٔ پاسخ HTTP) */
export function isDatabaseError(error: unknown): boolean {
  if (isPrismaKnownError(error)) return true;
  const code = extractDbErrorCode(error);
  if (code && (RETRYABLE_SQLSTATES.has(code) || /^P\d{4}$/.test(code))) return true;
  return isTransientDbError(error);
}

/** خلاصهٔ کوتاه و بدون داده‌ی حساس برای لاگ سرور. */
export function describeDbError(error: unknown): string {
  const info = classifyDbError(error);
  const message = collectMessages(error).split('\n')[0]?.slice(0, 240) || 'unknown error';
  return `[db:${info.kind}${info.code ? `:${info.code}` : ''}${info.retryable ? ':retryable' : ''}] ${message}`;
}
