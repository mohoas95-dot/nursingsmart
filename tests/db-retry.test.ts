import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeBackoffDelay,
  DbRetryExhaustedError,
  withDbRetry,
} from '../lib/db/retry';

/** تأخیر ساختگی: بدون انتظار واقعی، فقط ثبت می‌کند چقدر خوابیده‌ایم. */
function fakeSleep(recorded: number[]) {
  return async (ms: number) => { recorded.push(ms); };
}

function transientError(message = 'deadlock detected') {
  const error = new Error(message) as Error & { code: string };
  error.code = '40P01';
  return error;
}

function permanentError() {
  const error = new Error('Unique constraint failed') as Error & { code: string };
  error.code = 'P2002';
  return error;
}

// ===========================================================================
// رفتار پایه
// ===========================================================================

test('عملیات موفق در تلاش اول بدون هیچ تأخیری اجرا می‌شود', async () => {
  const delays: number[] = [];
  let calls = 0;
  const result = await withDbRetry(async () => { calls += 1; return 'ok'; }, {
    sleep: fakeSleep(delays),
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test('خطای موقت تلاش مجدد می‌شود و در تلاش بعدی موفق می‌گردد', async () => {
  const delays: number[] = [];
  let calls = 0;
  const result = await withDbRetry(async (attempt) => {
    calls += 1;
    if (attempt < 3) throw transientError();
    return `succeeded-on-${attempt}`;
  }, { sleep: fakeSleep(delays), random: () => 1, label: 'test-op' });

  assert.equal(result, 'succeeded-on-3');
  assert.equal(calls, 3);
  assert.equal(delays.length, 2, 'بین سه تلاش باید دو بار تأخیر باشد');
});

test('خطای دائمی هرگز تلاش مجدد نمی‌شود و بلافاصله پرتاب می‌گردد', async () => {
  const delays: number[] = [];
  let calls = 0;
  await assert.rejects(
    () => withDbRetry(async () => { calls += 1; throw permanentError(); }, { sleep: fakeSleep(delays) }),
    (error: unknown) => (error as { code?: string }).code === 'P2002',
  );
  assert.equal(calls, 1, 'خطای منطقی نباید تکرار شود');
  assert.deepEqual(delays, []);
});

test('پس از پایان همهٔ تلاش‌ها، آخرین خطای اصلی پرتاب می‌شود', async () => {
  const delays: number[] = [];
  let calls = 0;
  await assert.rejects(
    () => withDbRetry(async () => { calls += 1; throw transientError('deadlock detected'); }, {
      maxAttempts: 3,
      sleep: fakeSleep(delays),
    }),
    (error: unknown) => (error as Error).message === 'deadlock detected',
  );
  assert.equal(calls, 3);
  assert.equal(delays.length, 2);
});

// ===========================================================================
// عقب‌نشینی نمایی و jitter
// ===========================================================================

test('عقب‌نشینی نمایی است و از سقف عبور نمی‌کند', () => {
  const options = { baseDelayMs: 100, maxDelayMs: 800, random: () => 1 };
  assert.equal(computeBackoffDelay(1, options), 100);
  assert.equal(computeBackoffDelay(2, options), 200);
  assert.equal(computeBackoffDelay(3, options), 400);
  assert.equal(computeBackoffDelay(4, options), 800);
  assert.equal(computeBackoffDelay(9, options), 800, 'باید روی سقف بماند');
});

test('jitter تأخیر را تصادفی می‌کند تا درخواست‌ها هم‌فاز نشوند', () => {
  const low = computeBackoffDelay(3, { baseDelayMs: 100, maxDelayMs: 5_000, random: () => 0 });
  const high = computeBackoffDelay(3, { baseDelayMs: 100, maxDelayMs: 5_000, random: () => 1 });
  assert.ok(low < high, 'random متفاوت باید تأخیر متفاوت بدهد');
  assert.ok(low >= 1, 'تأخیر هرگز صفر نیست تا حلقهٔ رویداد فرصت آزاد شدن قفل بدهد');
});

// ===========================================================================
// سقف زمان کل
// ===========================================================================

test('سقف زمان کل از معطل ماندن بی‌پایان درخواست کاربر جلوگیری می‌کند', async () => {
  const delays: number[] = [];
  let now = 0;
  let calls = 0;
  await assert.rejects(
    () => withDbRetry(async () => { calls += 1; throw transientError(); }, {
      maxAttempts: 10,
      baseDelayMs: 500,
      totalTimeoutMs: 900,
      random: () => 1,
      now: () => now,
      sleep: async (ms) => { delays.push(ms); now += ms; },
    }),
    (error: unknown) => (error as Error).message === 'deadlock detected',
  );
  // تلاش اول (۰ms) → خواب ۵۰۰ms → تلاش دوم (۵۰۰ms) → خواب بعدی ۱۰۰۰ms از سقف
  // ۹۰۰ms عبور می‌کند، پس همان‌جا متوقف می‌شود.
  assert.equal(calls, 2);
  assert.deepEqual(delays, [500]);
});

// ===========================================================================
// قابلیت تنظیم
// ===========================================================================

test('onRetry برای مانیتورینگ هر تلاش مجدد فراخوانی می‌شود', async () => {
  const events: Array<{ attempt: number; label?: string }> = [];
  await withDbRetry(async (attempt) => {
    if (attempt < 3) throw transientError();
    return 'done';
  }, {
    sleep: async () => {},
    label: 'account-link',
    onRetry: info => events.push({ attempt: info.attempt, label: info.label }),
  });
  assert.deepEqual(events, [
    { attempt: 1, label: 'account-link' },
    { attempt: 2, label: 'account-link' },
  ]);
});

test('isRetryable سفارشی می‌تواند خطاهای غیر دیتابیسی را هم پوشش دهد', async () => {
  let calls = 0;
  const result = await withDbRetry(async () => {
    calls += 1;
    if (calls < 2) throw new Error('CUSTOM_TRANSIENT');
    return 'ok';
  }, {
    sleep: async () => {},
    isRetryable: error => (error as Error).message === 'CUSTOM_TRANSIENT',
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});

test('DbRetryExhaustedError خطای اصلی را در cause نگه می‌دارد', () => {
  const cause = transientError();
  const error = new DbRetryExhaustedError('failed', { cause, attempts: 4, label: 'op' });
  assert.equal(error.attempts, 4);
  assert.equal(error.label, 'op');
  assert.equal(error.cause, cause);
});
