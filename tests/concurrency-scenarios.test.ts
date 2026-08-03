import assert from 'node:assert/strict';
import test from 'node:test';
import { withMutex } from '../lib/db/mutex';
import { withDbRetry } from '../lib/db/retry';
import { classifyDbError, isUniqueConstraintError } from '../lib/db/errors';

/**
 * سناریوهای واقعیِ گزارش‌شده توسط کاربران، به‌صورت شبیه‌سازی‌شده.
 *
 * این تست‌ها به پایگاه دادهٔ واقعی نیاز ندارند؛ به‌جای آن یک «پایگاه دادهٔ
 * درون‌حافظه‌ای» با همان رفتارهای مسئله‌ساز (قید یکتایی، بن‌بست، تأخیر) می‌سازند
 * تا ثابت شود لایه‌های محافظ واقعاً مشکل را حل می‌کنند.
 */

/** پایگاه دادهٔ ساختگی با قید یکتایی روی کد ملی. */
function createFakeDb() {
  const users = new Map<string, { id: string; nationalId: string; name: string }>();
  let sequence = 0;

  return {
    users,
    async findByNationalId(nationalId: string) {
      // تأخیر عمدی: پنجرهٔ رقابتی بین «خواندن» و «نوشتن» را باز می‌کند.
      await new Promise(resolve => setTimeout(resolve, 5));
      return users.get(nationalId) ?? null;
    },
    async create(nationalId: string, name: string) {
      await new Promise(resolve => setTimeout(resolve, 5));
      if (users.has(nationalId)) {
        const error = new Error('Unique constraint failed on the fields: (`nationalId`)') as Error & {
          code: string; meta: { target: string[] }; name: string;
        };
        error.name = 'PrismaClientKnownRequestError';
        error.code = 'P2002';
        error.meta = { target: ['nationalId'] };
        throw error;
      }
      const user = { id: `u${++sequence}`, nationalId, name };
      users.set(nationalId, user);
      return user;
    },
  };
}

// ===========================================================================
// سناریو ۱ — دو کلیک سریع روی «ثبت پرسنل»
// ===========================================================================

test('سناریو: بدون محافظ، دو کلیک سریع خطای «کد ملی تکراری» می‌سازد', async () => {
  const db = createFakeDb();

  const unguardedCreate = async () => {
    const existing = await db.findByNationalId('0010000003');
    if (existing) return existing;
    return db.create('0010000003', 'پرسنل نمونه');
  };

  const results = await Promise.allSettled([unguardedCreate(), unguardedCreate()]);
  const failures = results.filter(r => r.status === 'rejected');

  // این همان باگی است که کاربران گزارش کرده بودند.
  assert.equal(failures.length, 1, 'یکی از دو درخواست باید با نقض یکتایی شکست بخورد');
  assert.equal(isUniqueConstraintError((failures[0] as PromiseRejectedResult).reason), true);
});

test('سناریو: با withMutex، دو کلیک سریع فقط یک رکورد می‌سازد و هر دو موفق‌اند', async () => {
  const db = createFakeDb();

  const guardedCreate = () => withMutex('user:nationalId:0010000003', async () => {
    const existing = await db.findByNationalId('0010000003');
    if (existing) return existing;
    return db.create('0010000003', 'پرسنل نمونه');
  });

  const [first, second] = await Promise.all([guardedCreate(), guardedCreate()]);

  assert.equal(db.users.size, 1, 'فقط یک رکورد باید ساخته شود');
  assert.equal(first.id, second.id, 'هر دو کلیک باید همان حساب را بگیرند');
});

test('سناریو: بازیابی از نقض یکتایی، رفتار idempotent می‌دهد', async () => {
  const db = createFakeDb();
  // شبیه‌سازی رقابت بین دو نمونهٔ سرور که قفل درون‌پردازه‌ای آن را نمی‌گیرد.
  await db.create('0010000003', 'ساخته‌شده توسط سرور دیگر');

  const createWithRecovery = async () => {
    try {
      return await db.create('0010000003', 'تلاش این سرور');
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existing = await db.findByNationalId('0010000003');
        if (existing) return existing;
      }
      throw error;
    }
  };

  const user = await createWithRecovery();
  assert.equal(user.name, 'ساخته‌شده توسط سرور دیگر', 'باید همان رکورد موجود برگردد');
  assert.equal(db.users.size, 1);
});

// ===========================================================================
// سناریو ۲ — بن‌بست گذرا هنگام درخواست‌های هم‌زمان
// ===========================================================================

test('سناریو: بن‌بست گذرا به‌صورت خودکار جبران می‌شود و کاربر خطا نمی‌بیند', async () => {
  let attempts = 0;
  const flakyWrite = async () => {
    attempts += 1;
    if (attempts <= 2) {
      const error = new Error('deadlock detected') as Error & { code: string };
      error.code = '40P01';
      throw error;
    }
    return 'ذخیره شد';
  };

  const result = await withDbRetry(flakyWrite, { sleep: async () => {}, label: 'save' });
  assert.equal(result, 'ذخیره شد');
  assert.equal(attempts, 3, 'باید دو بار تلاش مجدد کرده باشد');
});

test('سناریو: قفل شدن دیتابیس زیر بار، پس از آزاد شدن قفل موفق می‌شود', async () => {
  let locked = true;
  setTimeout(() => { locked = false; }, 15);

  const result = await withDbRetry(async () => {
    if (locked) throw new Error('database is locked');
    return 'نوشته شد';
  }, { baseDelayMs: 10, label: 'locked-db' });

  assert.equal(result, 'نوشته شد');
});

// ===========================================================================
// سناریو ۳ — پیام خطای درست به کاربر
// ===========================================================================

test('سناریو: خطای هم‌زمانی پیام فارسی و کد HTTP درست می‌گیرد، نه ۵۰۰', () => {
  const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
  const info = classifyDbError(deadlock);

  assert.notEqual(info.httpStatus, 500, 'خطای گذرا نباید ۵۰۰ باشد');
  assert.equal(info.retryable, true);
  assert.ok(/فارسی|هم‌زمان|تلاش/.test(info.userMessage), 'پیام باید فارسی و راهنما باشد');
  assert.ok(!info.userMessage.includes('deadlock'), 'جزئیات داخلی نباید فاش شود');
});

test('سناریو: نقض یکتایی پیام مشخص می‌گیرد و تلاش مجدد نمی‌شود', () => {
  const error = Object.assign(new Error('Unique constraint failed'), {
    code: 'P2002', name: 'PrismaClientKnownRequestError', meta: { target: ['nationalId'] },
  });
  const info = classifyDbError(error);

  assert.equal(info.httpStatus, 409);
  assert.equal(info.retryable, false, 'تکرار این عملیات هرگز موفق نمی‌شود');
});

// ===========================================================================
// سناریو ۴ — عملیات چندمرحله‌ای و ترتیب
// ===========================================================================

test('سناریو: ذخیره‌های پیاپی یک کاربر ترتیب خود را حفظ می‌کنند', async () => {
  const applied: number[] = [];
  const save = (version: number) => withMutex('schedule:1404_5', async () => {
    // تأخیر معکوس: بدون قفل، نسخهٔ بعدی زودتر تمام می‌شد و نسخهٔ قدیمی‌تر
    // آخرین نوشته می‌شد (lost update).
    await new Promise(resolve => setTimeout(resolve, 20 - version * 5));
    applied.push(version);
  });

  await Promise.all([save(1), save(2), save(3)]);
  assert.deepEqual(applied, [1, 2, 3], 'ترتیب ذخیره‌ها باید حفظ شود');
});

test('سناریو: عملیات روی بخش‌های مختلف یکدیگر را کند نمی‌کنند', async () => {
  const startedAt = Date.now();
  await Promise.all([
    withMutex('dept:a', () => new Promise(resolve => setTimeout(resolve, 30))),
    withMutex('dept:b', () => new Promise(resolve => setTimeout(resolve, 30))),
    withMutex('dept:c', () => new Promise(resolve => setTimeout(resolve, 30))),
  ]);
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed < 80, `باید موازی اجرا شوند (طول کشید: ${elapsed}ms)`);
});
