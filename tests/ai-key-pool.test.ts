import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ApiKeyPool,
  classifyFailure,
  parseRetryAfterMs,
} from '../lib/ai/key-pool';
import { extractJsonObject } from '../lib/ai/json';
import {
  normalizeShiftRequest,
  normalizeShiftRequestList,
} from '../lib/ai/shift-request-normalizer';

// ============================================================================
// کمک‌تابع: ساخت استخر کلید ایزوله با متغیرهای محیطی موقت
// ============================================================================

function withEnv<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const ENV_NAMES = ['TEST_AI_KEY', 'TEST_AI_KEY_2', 'TEST_AI_KEY_3', 'TEST_AI_KEYS'];

function makePool() {
  return new ApiKeyPool({ provider: 'test', envNames: ENV_NAMES });
}

// ============================================================================
// بارگذاری کلیدها
// ============================================================================

test('سه کلید مجزا از سه متغیر محیطی خوانده می‌شوند', () => {
  withEnv(
    { TEST_AI_KEY: 'key-alpha', TEST_AI_KEY_2: 'key-beta', TEST_AI_KEY_3: 'key-gamma', TEST_AI_KEYS: undefined },
    () => {
      const pool = makePool();
      assert.equal(pool.size(), 3);
      assert.equal(pool.availableCount(), 3);
    },
  );
});

test('چند کلید داخل یک متغیر با کاما هم پشتیبانی می‌شود', () => {
  withEnv(
    { TEST_AI_KEY: undefined, TEST_AI_KEY_2: undefined, TEST_AI_KEY_3: undefined, TEST_AI_KEYS: 'a1, b2 , c3' },
    () => {
      const pool = makePool();
      assert.equal(pool.size(), 3);
    },
  );
});

test('کلیدهای تکراری فقط یک بار شمرده می‌شوند', () => {
  withEnv(
    { TEST_AI_KEY: 'same', TEST_AI_KEY_2: 'same', TEST_AI_KEY_3: 'other', TEST_AI_KEYS: undefined },
    () => {
      const pool = makePool();
      assert.equal(pool.size(), 2);
    },
  );
});

test('نبود کلید یعنی استخر خالی (مسیر API باید خطای واضح بدهد)', () => {
  withEnv(
    { TEST_AI_KEY: undefined, TEST_AI_KEY_2: undefined, TEST_AI_KEY_3: undefined, TEST_AI_KEYS: undefined },
    () => {
      const pool = makePool();
      assert.equal(pool.size(), 0);
      assert.deepEqual(pool.order(), []);
    },
  );
});

// ============================================================================
// چرخش کلید — قلب پایداری سیستم
// ============================================================================

test('پس از اتمام سهمیهٔ کلید اول، کلید دوم جلوی صف می‌آید', () => {
  withEnv(
    { TEST_AI_KEY: 'k1', TEST_AI_KEY_2: 'k2', TEST_AI_KEY_3: 'k3', TEST_AI_KEYS: undefined },
    () => {
      const pool = makePool();
      assert.equal(pool.order()[0].value, 'k1');

      pool.reportFailure('k1', 'quota');

      const order = pool.order();
      assert.equal(order[0].value, 'k2', 'کلید دوم باید اول امتحان شود');
      assert.equal(pool.availableCount(), 2);
      // کلید سوخته به‌عنوان آخرین راه‌چاره در انتهای صف باقی می‌ماند
      assert.equal(order[order.length - 1].value, 'k1');
    },
  );
});

test('وقتی هر سه کلید به سقف بخورند هیچ کلید سالمی نمی‌ماند اما صف خالی نمی‌شود', () => {
  withEnv(
    { TEST_AI_KEY: 'k1', TEST_AI_KEY_2: 'k2', TEST_AI_KEY_3: 'k3', TEST_AI_KEYS: undefined },
    () => {
      const pool = makePool();
      pool.reportFailure('k1', 'quota');
      pool.reportFailure('k2', 'quota');
      pool.reportFailure('k3', 'quota');

      assert.equal(pool.availableCount(), 0);
      // صف همچنان هر سه را برای «آخرین شانس» برمی‌گرداند
      assert.equal(pool.order().length, 3);
      assert.ok((pool.nextAvailableInMs() ?? 0) > 0);
    },
  );
});

test('موفقیت، کلید را از قرنطینه خارج و بار را روی کلید بعدی می‌چرخاند', () => {
  withEnv(
    { TEST_AI_KEY: 'k1', TEST_AI_KEY_2: 'k2', TEST_AI_KEY_3: 'k3', TEST_AI_KEYS: undefined },
    () => {
      const pool = makePool();
      pool.reportFailure('k1', 'quota');
      assert.equal(pool.availableCount(), 2);

      pool.reportSuccess('k1');
      assert.equal(pool.availableCount(), 3, 'موفقیت باید قرنطینه را لغو کند');

      // round-robin: بعد از موفقیت k1، نوبت k2 است
      assert.equal(pool.order()[0].value, 'k2');
    },
  );
});

test('کلید نامعتبر بسیار طولانی‌تر از کلید پرمصرف قرنطینه می‌شود', () => {
  withEnv(
    { TEST_AI_KEY: 'k1', TEST_AI_KEY_2: 'k2', TEST_AI_KEY_3: undefined, TEST_AI_KEYS: undefined },
    () => {
      const quotaPool = makePool();
      quotaPool.reportFailure('k1', 'quota');
      const quotaWait = quotaPool.snapshot().find(state => state.label.includes('1'))?.cooldownSeconds ?? 0;

      const invalidPool = makePool();
      invalidPool.reportFailure('k1', 'invalid');
      const invalidWait = invalidPool.snapshot().find(state => state.label.includes('1'))?.cooldownSeconds ?? 0;

      assert.ok(invalidWait > quotaWait, 'کلید باطل باید مدت بیشتری کنار گذاشته شود');
    },
  );
});

test('snapshot هرگز مقدار کلید را افشا نمی‌کند', () => {
  withEnv(
    { TEST_AI_KEY: 'super-secret-key-1234', TEST_AI_KEY_2: undefined, TEST_AI_KEY_3: undefined, TEST_AI_KEYS: undefined },
    () => {
      const pool = makePool();
      const serialized = JSON.stringify(pool.snapshot());
      assert.ok(!serialized.includes('super-secret'), 'کلید نباید در خروجی تشخیصی ظاهر شود');
      assert.ok(serialized.includes('1234'), 'فقط چهار رقم آخر برای شناسایی نمایش داده می‌شود');
    },
  );
});

test('تغییر متغیرهای محیطی باعث بازخوانی استخر می‌شود', () => {
  const pool = makePool();
  withEnv({ TEST_AI_KEY: 'only-one', TEST_AI_KEY_2: undefined, TEST_AI_KEY_3: undefined, TEST_AI_KEYS: undefined }, () => {
    assert.equal(pool.size(), 1);
  });
  withEnv({ TEST_AI_KEY: 'only-one', TEST_AI_KEY_2: 'second', TEST_AI_KEY_3: undefined, TEST_AI_KEYS: undefined }, () => {
    assert.equal(pool.size(), 2);
  });
});

// ============================================================================
// طبقه‌بندی خطاها
// ============================================================================

test('خطای ۴۲۹ و پیام‌های سهمیه به عنوان quota شناخته می‌شوند', () => {
  assert.equal(classifyFailure(429, 'Too Many Requests'), 'quota');
  assert.equal(classifyFailure(undefined, 'RESOURCE_EXHAUSTED: quota exceeded'), 'quota');
  assert.equal(classifyFailure(undefined, 'Rate limit reached for model'), 'quota');
});

test('خطای ۴۰۱/۴۰۳ به عنوان کلید نامعتبر شناخته می‌شود', () => {
  assert.equal(classifyFailure(401, 'Unauthorized'), 'invalid');
  assert.equal(classifyFailure(403, 'forbidden'), 'invalid');
  assert.equal(classifyFailure(undefined, 'API key not valid. Please pass a valid API key.'), 'invalid');
});

test('خطای ۵۰۳ و شلوغی به عنوان busy شناخته می‌شود (کلید مقصر نیست)', () => {
  assert.equal(classifyFailure(503, 'Service Unavailable'), 'busy');
  assert.equal(classifyFailure(undefined, 'The model is overloaded due to high demand'), 'busy');
});

test('retry-after از هدر و از متن پیام استخراج می‌شود', () => {
  assert.equal(parseRetryAfterMs('30'), 30_000);
  assert.equal(parseRetryAfterMs(null, 'Please try again in 2.5s'), 2_500);
  assert.equal(parseRetryAfterMs(null, 'try again in 3 minutes'), 180_000);
  assert.equal(parseRetryAfterMs(null, 'no hint here'), undefined);
});

// ============================================================================
// استخراج JSON از خروجی مدل‌های متنی
// ============================================================================

test('JSON ساده مستقیماً پارس می‌شود', () => {
  assert.deepEqual(extractJsonObject('{"status":"ready"}'), { status: 'ready' });
});

test('JSON داخل حصار کد ```json پارس می‌شود', () => {
  const raw = '```json\n{"status":"chat","reply":"سلام"}\n```';
  assert.deepEqual(extractJsonObject(raw), { status: 'chat', reply: 'سلام' });
});

test('JSON همراه با متن اضافی قبل و بعد استخراج می‌شود', () => {
  const raw = 'Here is the result:\n{"status":"ready","requests":[]}\nHope that helps!';
  assert.deepEqual(extractJsonObject(raw), { status: 'ready', requests: [] });
});

test('آکولاد داخل رشتهٔ فارسی باعث برش اشتباه نمی‌شود', () => {
  const raw = '{"reply":"از علامت } نترس","status":"chat"}';
  assert.deepEqual(extractJsonObject(raw), { reply: 'از علامت } نترس', status: 'chat' });
});

test('خروجی غیرقابل پارس به جای throw مقدار null می‌دهد', () => {
  assert.equal(extractJsonObject('نه JSON است نه چیزی'), null);
  assert.equal(extractJsonObject(''), null);
  assert.equal(extractJsonObject(undefined), null);
});

// ============================================================================
// نرمال‌سازی درخواست‌ها — قرارداد مشترک هر دو موتور
// ============================================================================

test('درخواست معتبر شیفت سالم عبور می‌کند', () => {
  const result = normalizeShiftRequest(
    { requestType: 'shift', preferredShift: 'N', scope: 'custom_days', selectedDays: [20] },
    31,
  );
  assert.equal(result?.requestType, 'shift');
  assert.equal(result?.preferredShift, 'N');
  assert.deepEqual(result?.selectedDays, [20]);
});

test('placeholder در preferredShift باعث حذف کامل آیتم می‌شود', () => {
  assert.equal(
    normalizeShiftRequest(
      { requestType: 'shift', preferredShift: 'undefined', scope: 'custom_days', selectedDays: [5] },
      31,
    ),
    null,
  );
});

test('custom_days بدون روز معتبر حذف می‌شود', () => {
  assert.equal(
    normalizeShiftRequest({ requestType: 'OFF', scope: 'custom_days', selectedDays: [] }, 31),
    null,
  );
});

test('روزهای خارج از محدودهٔ ماه فیلتر می‌شوند', () => {
  const result = normalizeShiftRequest(
    { requestType: 'OFF', scope: 'custom_days', selectedDays: [0, 3, 15, 40, 31] },
    31,
  );
  assert.deepEqual(result?.selectedDays, [3, 15, 31]);
});

test('ارقام فارسی در selectedDays به لاتین تبدیل می‌شوند', () => {
  const result = normalizeShiftRequest(
    { requestType: 'OFF', scope: 'custom_days', selectedDays: ['۱۲', '۱۵'] },
    31,
  );
  assert.deepEqual(result?.selectedDays, [12, 15]);
});

test('OFF همیشه preferredShift=OFF و leave همیشه L می‌گیرد', () => {
  const off = normalizeShiftRequest({ requestType: 'OFF', scope: 'all' }, 31);
  const leave = normalizeShiftRequest({ requestType: 'leave', scope: 'all' }, 31);
  assert.equal(off?.preferredShift, 'OFF');
  assert.equal(off?.offHardness, 'hard');
  assert.equal(leave?.preferredShift, 'L');
});

test('pattern بدون گام معتبر حذف می‌شود', () => {
  assert.equal(normalizeShiftRequest({ requestType: 'pattern', scope: 'all', patternSteps: [] }, 31), null);
  const valid = normalizeShiftRequest(
    { requestType: 'pattern', scope: 'all', patternSteps: ['me', 'off'] },
    31,
  );
  assert.deepEqual(valid?.patternSteps, ['ME', 'OFF']);
});

test('لیست ترکیبی: آیتم‌های سالم می‌مانند و ناقص‌ها شمرده می‌شوند', () => {
  const { requests, droppedCount } = normalizeShiftRequestList(
    [
      { requestType: 'shift', preferredShift: 'ME', scope: 'custom_days', selectedDays: [12] },
      { requestType: 'shift', preferredShift: '?', scope: 'custom_days', selectedDays: [13] },
      { requestType: 'bogus', scope: 'all' },
      { requestType: 'OFF', scope: 'custom_days', selectedDays: [1, 2] },
    ],
    31,
  );
  assert.equal(requests.length, 2);
  assert.equal(droppedCount, 2);
});

test('ورودی غیرآرایه به لیست خالی تبدیل می‌شود (بدون throw)', () => {
  assert.deepEqual(normalizeShiftRequestList(null, 31), { requests: [], droppedCount: 0 });
  assert.deepEqual(normalizeShiftRequestList('nope', 31), { requests: [], droppedCount: 0 });
});
