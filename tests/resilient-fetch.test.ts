import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchJson,
  HttpRequestError,
  parseRetryAfter,
  resilientFetch,
} from '../lib/http/resilient-fetch';

/** ساخت پاسخ ساختگی با بدنهٔ JSON. */
function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

/** یک fetch ساختگی که پاسخ‌ها را به‌ترتیب برمی‌گرداند و فراخوانی‌ها را می‌شمارد. */
function stubFetch(responses: Array<Response | Error>) {
  const calls: Array<{ input: unknown; init?: RequestInit }> = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    // Response فقط یک‌بار قابل خواندن است؛ برای فراخوانی‌های تکراری کلون می‌شود.
    return next.clone();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const noSleep = async () => {};

// ===========================================================================
// parseRetryAfter
// ===========================================================================

test('هدر Retry-After بر حسب ثانیه خوانده می‌شود', () => {
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter('0'), 0);
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter('garbage'), null);
});

test('Retry-After بیش از حد بزرگ به سقف ۳۰ ثانیه محدود می‌شود', () => {
  assert.equal(parseRetryAfter('9999'), 30_000);
});

// ===========================================================================
// تلاش مجدد در خواندن (idempotent)
// ===========================================================================

test('پاسخ موفق بدون تلاش مجدد برگردانده می‌شود', async () => {
  const { impl, calls } = stubFetch([jsonResponse({ success: true })]);
  const response = await resilientFetch('/api/test', { fetchImpl: impl, sleep: noSleep });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
});

test('وضعیت ۵۰۳ روی درخواست GET تلاش مجدد می‌شود', async () => {
  const { impl, calls } = stubFetch([
    jsonResponse({ success: false }, { status: 503 }),
    jsonResponse({ success: false }, { status: 503 }),
    jsonResponse({ success: true }),
  ]);
  const response = await resilientFetch('/api/test', { fetchImpl: impl, sleep: noSleep, maxAttempts: 3 });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 3);
});

test('وضعیت ۴۲۹ (درخواست بیش از حد) تلاش مجدد می‌شود', async () => {
  const { impl, calls } = stubFetch([
    jsonResponse({ success: false }, { status: 429, headers: { 'Retry-After': '1' } }),
    jsonResponse({ success: true }),
  ]);
  const delays: number[] = [];
  await resilientFetch('/api/test', {
    fetchImpl: impl,
    sleep: async (ms) => { delays.push(ms); },
    maxAttempts: 2,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(delays, [1000], 'باید دقیقاً به اندازهٔ Retry-After صبر کند');
});

test('خطای ۴۰۴ هرگز تلاش مجدد نمی‌شود', async () => {
  const { impl, calls } = stubFetch([jsonResponse({ success: false }, { status: 404 })]);
  const response = await resilientFetch('/api/test', { fetchImpl: impl, sleep: noSleep, maxAttempts: 3 });
  assert.equal(response.status, 404);
  assert.equal(calls.length, 1, 'خطای منطقی نباید تکرار شود');
});

test('خطای شبکه روی GET تلاش مجدد می‌شود', async () => {
  let attempt = 0;
  const impl = (async () => {
    attempt += 1;
    if (attempt < 3) throw new TypeError('Failed to fetch');
    return jsonResponse({ success: true });
  }) as unknown as typeof fetch;

  const response = await resilientFetch('/api/test', { fetchImpl: impl, sleep: noSleep, maxAttempts: 3 });
  assert.equal(response.status, 200);
  assert.equal(attempt, 3);
});

// ===========================================================================
// ایمنی درخواست‌های تغییردهنده
// ===========================================================================

test('خطای شبکه روی POST به‌صورت پیش‌فرض تلاش مجدد نمی‌شود', async () => {
  // درخواست ممکن است به سرور رسیده و اعمال شده باشد و فقط پاسخ گم شده باشد؛
  // تکرار خودکار می‌توانست رکورد تکراری بسازد.
  let attempt = 0;
  const impl = (async () => {
    attempt += 1;
    throw new TypeError('Failed to fetch');
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => resilientFetch('/api/test', { method: 'POST', fetchImpl: impl, sleep: noSleep, maxAttempts: 3 }),
    /Failed to fetch/,
  );
  assert.equal(attempt, 1, 'POST نباید در خطای شبکه تکرار شود');
});

test('POST فقط وقتی تکرار می‌شود که سرور آن را گذرا اعلام کند', async () => {
  const { impl, calls } = stubFetch([
    jsonResponse({ success: false, retryable: true, error: 'تداخل هم‌زمانی' }, { status: 409 }),
    jsonResponse({ success: true }),
  ]);
  const response = await resilientFetch('/api/test', {
    method: 'POST', fetchImpl: impl, sleep: noSleep, maxAttempts: 2,
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
});

test('تداخل ۴۰۹ بدون پرچم retryable تکرار نمی‌شود', async () => {
  const { impl, calls } = stubFetch([
    jsonResponse({ success: false, error: 'این کد ملی قبلاً ثبت شده است.' }, { status: 409 }),
  ]);
  const response = await resilientFetch('/api/test', {
    method: 'POST', fetchImpl: impl, sleep: noSleep, maxAttempts: 3,
  });
  assert.equal(response.status, 409);
  assert.equal(calls.length, 1, 'تداخل واقعی نباید کورکورانه تکرار شود');
});

test('درخواست لغوشده (AbortError) هرگز تکرار نمی‌شود', async () => {
  let attempt = 0;
  const impl = (async () => {
    attempt += 1;
    throw new DOMException('Aborted', 'AbortError');
  }) as unknown as typeof fetch;

  await assert.rejects(
    () => resilientFetch('/api/test', { fetchImpl: impl, sleep: noSleep, maxAttempts: 3 }),
    (error: unknown) => (error as DOMException).name === 'AbortError',
  );
  assert.equal(attempt, 1);
});

// ===========================================================================
// fetchJson: یکسان‌سازی خطاها
// ===========================================================================

test('fetchJson بدنهٔ موفق را برمی‌گرداند', async () => {
  const { impl } = stubFetch([jsonResponse({ success: true, users: [1, 2, 3] })]);
  const result = await fetchJson<{ users: number[] }>('/api/test', { fetchImpl: impl, sleep: noSleep });
  assert.deepEqual(result.users, [1, 2, 3]);
});

test('fetchJson پیام خطای فارسی سرور را حفظ می‌کند', async () => {
  const { impl } = stubFetch([
    jsonResponse({ success: false, error: 'این کد ملی قبلاً ثبت شده است.' }, { status: 409 }),
  ]);
  await assert.rejects(
    () => fetchJson('/api/test', { method: 'POST', fetchImpl: impl, sleep: noSleep }),
    (error: unknown) => {
      assert.ok(error instanceof HttpRequestError);
      assert.equal((error as HttpRequestError).message, 'این کد ملی قبلاً ثبت شده است.');
      assert.equal((error as HttpRequestError).status, 409);
      assert.equal((error as HttpRequestError).retryable, false);
      return true;
    },
  );
});

test('fetchJson پاسخ success:false با وضعیت ۲۰۰ را هم خطا می‌شمارد', async () => {
  const { impl } = stubFetch([jsonResponse({ success: false, error: 'عملیات انجام نشد.' })]);
  await assert.rejects(
    () => fetchJson('/api/test', { method: 'POST', fetchImpl: impl, sleep: noSleep }),
    /عملیات انجام نشد/,
  );
});

test('fetchJson خطای گذرا را با پرچم retryable علامت می‌زند', async () => {
  const { impl } = stubFetch([
    jsonResponse({ success: false, error: 'پایگاه داده لحظه‌ای قفل شده است.', retryable: true }, { status: 503 }),
  ]);
  await assert.rejects(
    () => fetchJson('/api/test', { method: 'POST', fetchImpl: impl, sleep: noSleep, maxAttempts: 1 }),
    (error: unknown) => {
      assert.equal((error as HttpRequestError).retryable, true);
      return true;
    },
  );
});

test('پاسخ بدون بدنهٔ JSON (مثلاً ۵۰۲ از پروکسی) پیام عمومی می‌دهد', async () => {
  const impl = (async () => new Response('<html>Bad Gateway</html>', { status: 502 })) as unknown as typeof fetch;
  await assert.rejects(
    () => fetchJson('/api/test', { method: 'POST', fetchImpl: impl, sleep: noSleep, maxAttempts: 1 }),
    (error: unknown) => {
      assert.ok(error instanceof HttpRequestError);
      assert.equal((error as HttpRequestError).status, 502);
      return true;
    },
  );
});
