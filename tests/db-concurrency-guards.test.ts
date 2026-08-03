import assert from 'node:assert/strict';
import test from 'node:test';
import { withMutex, isMutexBusy, MutexBusyError } from '../lib/db/mutex';
import { runIdempotent, clearIdempotencyCache, idempotencyCacheSize } from '../lib/db/idempotency';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));

// ===========================================================================
// قفل بر اساس کلید (Keyed Mutex)
// ===========================================================================

test('عملیات هم‌کلید سریال می‌شوند و هرگز هم‌پوشانی ندارند', async () => {
  const events: string[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;

  const operation = (name: string) => withMutex('same-key', async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    events.push(`start:${name}`);
    await tick();
    events.push(`end:${name}`);
    concurrent -= 1;
    return name;
  });

  // شبیه‌سازی سه کلیک سریع پشت سر هم.
  const results = await Promise.all([operation('a'), operation('b'), operation('c')]);

  assert.deepEqual(results, ['a', 'b', 'c']);
  assert.equal(maxConcurrent, 1, 'هیچ‌گاه دو عملیات هم‌کلید نباید هم‌زمان اجرا شوند');
  assert.deepEqual(events, [
    'start:a', 'end:a',
    'start:b', 'end:b',
    'start:c', 'end:c',
  ], 'ترتیب ورود باید حفظ شود');
});

test('کلیدهای متفاوت کاملاً موازی اجرا می‌شوند', async () => {
  let concurrent = 0;
  let maxConcurrent = 0;

  const operation = (key: string) => withMutex(key, async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await tick();
    concurrent -= 1;
  });

  await Promise.all([operation('user-1'), operation('user-2'), operation('user-3')]);
  assert.equal(maxConcurrent, 3, 'کاربران مختلف نباید یکدیگر را مسدود کنند');
});

test('خطا در یک عملیات، صف همان کلید را نمی‌شکند', async () => {
  const failing = withMutex('shared', async () => { throw new Error('boom'); });
  const following = withMutex('shared', async () => 'still-works');

  await assert.rejects(() => failing, /boom/);
  assert.equal(await following, 'still-works');
});

test('قفل پس از پایان همهٔ عملیات آزاد می‌شود (نشت حافظه ندارد)', async () => {
  assert.equal(isMutexBusy('cleanup-key'), false);
  const running = withMutex('cleanup-key', async () => { await tick(); });
  assert.equal(isMutexBusy('cleanup-key'), true);
  await running;
  assert.equal(isMutexBusy('cleanup-key'), false, 'رکورد قفل باید پاک شود');
});

test('صف بیش از حد طولانی با خطای ۴۲۹ رد می‌شود (محافظ سیل درخواست)', async () => {
  // یک «دروازهٔ» مشترک: تا وقتی باز نشود، هیچ عملیاتی تمام نمی‌شود و صف پر می‌ماند.
  let openGate!: () => void;
  const gate = new Promise<void>(resolve => { openGate = resolve; });

  const blocked = Array.from({ length: 3 }, () =>
    withMutex('flood', () => gate, { maxQueue: 3 }));

  // چهارمین درخواست از سقف صف عبور می‌کند و سریع رد می‌شود.
  await assert.rejects(
    () => withMutex('flood', async () => undefined, { maxQueue: 3 }),
    (error: unknown) => {
      assert.ok(error instanceof MutexBusyError);
      assert.equal((error as MutexBusyError).status, 429);
      assert.equal((error as MutexBusyError).retryAfterSeconds > 0, true);
      return true;
    },
  );

  openGate();
  await Promise.all(blocked);
  assert.equal(isMutexBusy('flood'), false, 'پس از تخلیهٔ صف، قفل باید آزاد شود');
});

test('مقدار بازگشتی عملیات دست‌نخورده منتقل می‌شود', async () => {
  const value = await withMutex('typed', async () => ({ id: 42, name: 'test' }));
  assert.deepEqual(value, { id: 42, name: 'test' });
});

// ===========================================================================
// حذف درخواست‌های تکراری (Idempotency)
// ===========================================================================

test('درخواست‌های هم‌زمان با یک کلید فقط یک‌بار اجرا می‌شوند', async () => {
  clearIdempotencyCache();
  let executions = 0;
  const operation = () => runIdempotent('dup-key', async () => {
    executions += 1;
    await tick();
    return executions;
  });

  const [first, second, third] = await Promise.all([operation(), operation(), operation()]);
  assert.equal(executions, 1, 'دو کلیک سریع باید فقط یک نوشتن تولید کند');
  assert.equal(first, 1);
  assert.equal(second, 1);
  assert.equal(third, 1, 'همهٔ فراخوانی‌ها باید همان نتیجه را بگیرند');
  clearIdempotencyCache();
});

test('نتیجهٔ موفق تا پایان TTL کش می‌شود و بعد دوباره اجرا می‌گردد', async () => {
  clearIdempotencyCache();
  let executions = 0;
  const operation = (ttlMs: number) => runIdempotent('ttl-key', async () => ++executions, { ttlMs });

  assert.equal(await operation(50), 1);
  assert.equal(await operation(50), 1, 'در بازهٔ TTL نباید دوباره اجرا شود');

  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(await operation(50), 2, 'پس از انقضا باید دوباره اجرا شود');
  clearIdempotencyCache();
});

test('نتیجهٔ ناموفق کش نمی‌شود تا کاربر بتواند بلافاصله دوباره تلاش کند', async () => {
  clearIdempotencyCache();
  let attempts = 0;
  const operation = () => runIdempotent('retry-key', async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('transient failure');
    return 'recovered';
  });

  await assert.rejects(() => operation(), /transient failure/);
  assert.equal(await operation(), 'recovered', 'تلاش دوم باید واقعاً اجرا شود');
  assert.equal(attempts, 2);
  clearIdempotencyCache();
});

test('کلیدهای متفاوت مستقل از هم اجرا می‌شوند', async () => {
  clearIdempotencyCache();
  let executions = 0;
  const run = (key: string) => runIdempotent(key, async () => ++executions);
  await Promise.all([run('a'), run('b'), run('c')]);
  assert.equal(executions, 3);
  clearIdempotencyCache();
});

test('clearIdempotencyCache کش را پاک می‌کند', async () => {
  clearIdempotencyCache();
  await runIdempotent('to-clear', async () => 'value');
  assert.ok(idempotencyCacheSize() >= 1);
  clearIdempotencyCache('to-clear');
  let executions = 0;
  await runIdempotent('to-clear', async () => { executions += 1; return 'again'; });
  assert.equal(executions, 1, 'پس از پاک‌سازی باید دوباره اجرا شود');
  clearIdempotencyCache();
});
