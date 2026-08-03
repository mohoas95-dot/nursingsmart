import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyDbError,
  describeDbError,
  extractDbErrorCode,
  isDatabaseError,
  isRecordNotFoundError,
  isTransientDbError,
  isUniqueConstraintError,
  uniqueConstraintTargets,
} from '../lib/db/errors';

/** ساخت خطای شبیه‌سازی‌شدهٔ Prisma. */
function prismaError(code: string, message = 'prisma failure', meta?: Record<string, unknown>) {
  const error = new Error(message) as Error & { code: string; meta?: Record<string, unknown>; name: string };
  error.name = 'PrismaClientKnownRequestError';
  error.code = code;
  if (meta) error.meta = meta;
  return error;
}

// ===========================================================================
// خطاهای موقت هم‌زمانی باید قابل تلاش مجدد شناخته شوند
// ===========================================================================

test('deadlock و شکست سریال‌سازی به‌عنوان خطای موقت شناسایی می‌شوند', () => {
  assert.equal(isTransientDbError(prismaError('P2034', 'write conflict or deadlock')), true);
  assert.equal(isTransientDbError(prismaError('40001')), true);
  assert.equal(isTransientDbError(prismaError('40P01')), true);
  assert.equal(isTransientDbError(new Error('deadlock detected')), true);
  assert.equal(isTransientDbError(new Error('could not serialize access due to concurrent update')), true);
});

test('قفل شدن پایگاه داده (SQLite/MySQL) خطای موقت است', () => {
  assert.equal(isTransientDbError(new Error('database is locked')), true);
  assert.equal(isTransientDbError(new Error('SQLITE_BUSY: database is locked')), true);
  assert.equal(isTransientDbError(new Error('Lock wait timeout exceeded')), true);
  assert.equal(isTransientDbError(prismaError('55P03')), true);
});

test('تایم‌اوت connection pool و قطع اتصال خطای موقت است', () => {
  assert.equal(isTransientDbError(prismaError('P2024', 'Timed out fetching a new connection from the connection pool')), true);
  assert.equal(isTransientDbError(prismaError('P1001', "Can't reach database server")), true);
  assert.equal(isTransientDbError(prismaError('P1017', 'Server has closed the connection')), true);
  assert.equal(isTransientDbError(new Error('ECONNRESET')), true);
  assert.equal(isTransientDbError(new Error('socket hang up')), true);
});

test('خطای راه‌اندازی کلاینت (پایگاه داده هنوز بالا نیامده) قابل تلاش مجدد است', () => {
  const error = new Error('Cannot connect') as Error & { name: string };
  error.name = 'PrismaClientInitializationError';
  assert.equal(isTransientDbError(error), true);
});

// ===========================================================================
// خطاهای منطقی هرگز نباید تلاش مجدد شوند
// ===========================================================================

test('نقض قید یکتایی خطای منطقی است و تلاش مجدد نمی‌شود', () => {
  const error = prismaError('P2002', 'Unique constraint failed', { target: ['nationalId'] });
  assert.equal(isTransientDbError(error), false);
  assert.equal(isUniqueConstraintError(error), true);
  assert.deepEqual(uniqueConstraintTargets(error), ['nationalId']);
});

test('رکورد پیدا نشد و نقض کلید خارجی تلاش مجدد نمی‌شوند', () => {
  assert.equal(isTransientDbError(prismaError('P2025')), false);
  assert.equal(isRecordNotFoundError(prismaError('P2025')), true);
  assert.equal(isTransientDbError(prismaError('P2003')), false);
});

test('خطای اعتبارسنجی و پنیک موتور تلاش مجدد نمی‌شوند', () => {
  const validation = new Error('Invalid argument') as Error & { name: string };
  validation.name = 'PrismaClientValidationError';
  assert.equal(isTransientDbError(validation), false);

  const panic = new Error('engine panic') as Error & { name: string };
  panic.name = 'PrismaClientRustPanicError';
  assert.equal(isTransientDbError(panic), false);
});

// ===========================================================================
// استخراج کد از ساختارهای تودرتو
// ===========================================================================

test('کد خطا از علت تودرتو و driverAdapterError استخراج می‌شود', () => {
  const nested = new Error('wrapper', { cause: prismaError('40001') });
  assert.equal(extractDbErrorCode(nested), '40001');
  assert.equal(isTransientDbError(nested), true);

  const adapter = prismaError('P2010', 'raw query failed', {
    driverAdapterError: { code: '40P01' },
  });
  assert.equal(extractDbErrorCode(adapter), 'P2010');
});

test('پیام علت تودرتو در تشخیص خطای موقت لحاظ می‌شود', () => {
  const wrapped = new Error('save failed', { cause: new Error('deadlock detected') });
  assert.equal(isTransientDbError(wrapped), true);
});

// ===========================================================================
// طبقه‌بندی: کد HTTP، پیام فارسی و Retry-After
// ===========================================================================

test('تداخل نوشتن به ۴۰۹ قابل تلاش مجدد با Retry-After نگاشت می‌شود', () => {
  const info = classifyDbError(prismaError('P2034'));
  assert.equal(info.kind, 'write_conflict');
  assert.equal(info.httpStatus, 409);
  assert.equal(info.retryable, true);
  assert.ok((info.retryAfterSeconds ?? 0) > 0);
  assert.ok(info.userMessage.includes('هم‌زمان'));
});

test('قفل شدن پایگاه داده به ۵۰۳ با پیام فارسی نگاشت می‌شود', () => {
  const info = classifyDbError(new Error('database is locked'));
  assert.equal(info.kind, 'lock_timeout');
  assert.equal(info.httpStatus, 503);
  assert.equal(info.retryable, true);
});

test('نقض یکتایی به ۴۰۹ غیرقابل تلاش مجدد نگاشت می‌شود', () => {
  const info = classifyDbError(prismaError('P2002', 'Unique constraint failed', { target: ['nationalId'] }));
  assert.equal(info.kind, 'unique_constraint');
  assert.equal(info.httpStatus, 409);
  assert.equal(info.retryable, false);
});

test('تایم‌اوت connection pool به ۵۰۳ نگاشت می‌شود', () => {
  const info = classifyDbError(prismaError('P2024'));
  assert.equal(info.kind, 'pool_timeout');
  assert.equal(info.httpStatus, 503);
  assert.equal(info.retryable, true);
});

test('خطای ناشناخته و غیرموقت به ۵۰۰ نگاشت می‌شود و پیام داخلی را فاش نمی‌کند', () => {
  const info = classifyDbError(new Error('something totally unexpected'));
  assert.equal(info.retryable, false);
  assert.equal(info.httpStatus, 500);
  assert.ok(!info.userMessage.includes('unexpected'));
});

test('isDatabaseError خطاهای دیتابیس را از خطاهای عمومی تفکیک می‌کند', () => {
  assert.equal(isDatabaseError(prismaError('P2002')), true);
  assert.equal(isDatabaseError(new Error('database is locked')), true);
  assert.equal(isDatabaseError(new Error('کاربر اجازه ندارد')), false);
});

test('describeDbError خلاصهٔ کوتاه و قابل ردیابی می‌سازد', () => {
  const summary = describeDbError(prismaError('P2034', 'write conflict'));
  assert.ok(summary.includes('write_conflict'));
  assert.ok(summary.includes('P2034'));
  assert.ok(summary.includes('retryable'));
});
