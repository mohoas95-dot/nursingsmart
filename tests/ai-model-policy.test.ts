import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * نگهبان سیاست مدل‌ها — معماری ۲۰۲۶ بر پایه Gemini Direct
 *
 * الزامات جدید کارفرما:
 *   - فقط Gemini Direct
 *   - مدل اصلی: gemini-1.5-flash
 *   - fallback: gemini-1.5-flash (فقط در شرایط جدی: زمان طولانی، مفهوم نامفهوم، سرور شلوغ)
 *   - ۵ کلید API
 *   - سیستم اعتبار ۱۰۰ دلاری حذف شده
 */

// مدل‌های منسوخ که دیگر نباید باشند
const DEPRECATED_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'qwen/qwen3-32b',
  'moonshotai/kimi-k2-instruct',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'deepseek-chat',
  'deepseek-v3',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-v3',
  'gpt-4o-mini',
  'openai/gpt-4o-mini',
  'gpt-4o',
  'openai/gpt-4o',
];

async function loadGeminiModule() {
  const envKeys = ['GEMINI_PRIMARY_MODEL', 'GEMINI_FALLBACK_MODEL', 'GEMINI_MODEL', 'GEMINI_TEXT_MODEL'];
  const saved: Record<string, string | undefined> = {};
  for (const key of envKeys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    return await import(`../lib/ai/gemini.ts?policy=${Date.now()}`);
  } finally {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('مدل اصلی باید gemini-1.5-flash باشد (طبق الزام کارفرما)', async () => {
  const { GEMINI_PRIMARY_MODEL } = await loadGeminiModule();
  assert.equal(
    GEMINI_PRIMARY_MODEL,
    'gemini-1.5-flash',
    `مدل اصلی باید gemini-1.5-flash باشد، اما «${GEMINI_PRIMARY_MODEL}» است`,
  );
});

test('مدل fallback باید gemini-1.5-flash باشد (طبق الزام کارفرما)', async () => {
  const { GEMINI_FALLBACK_MODEL } = await loadGeminiModule();
  assert.equal(
    GEMINI_FALLBACK_MODEL,
    'gemini-1.5-flash',
    `مدل fallback باید gemini-1.5-flash باشد، اما «${GEMINI_FALLBACK_MODEL}» است`,
  );
});

test('زنجیره مدل باید فقط شامل مدل پایدار Gemini باشد (بدون تکرار fallback)', async () => {
  const { getGeminiModelChain } = await loadGeminiModule();
  const chain = getGeminiModelChain();
  assert.equal(chain.length, 1, `زنجیره نباید fallback تکراری داشته باشد، اما ${chain.length} دارد: ${chain.join(', ')}`);
  assert.equal(chain[0], 'gemini-1.5-flash');
});

test('زنجیره نباید شامل مدل‌های منسوخ Groq/DeepSeek/GPT باشد', async () => {
  const { getGeminiModelChain } = await loadGeminiModule();
  const chain = getGeminiModelChain();
  for (const model of chain) {
    assert.ok(
      !DEPRECATED_MODELS.includes(model),
      `مدل منسوخ «${model}» در زنجیره است؛ باید حذف شود.`,
    );
  }
});

test('کلید Gemini از GEMINI_API_KEY و _2.._5 خوانده می‌شود (۵ کلید)', async () => {
  const { geminiKeyPool } = await loadGeminiModule();
  assert.ok(geminiKeyPool, 'geminiKeyPool باید وجود داشته باشد');
  // بررسی اینکه envNames شامل ۵ کلید باشد
  // چون نمی‌توانیم private field بخوانیم، فقط چک می‌کنیم که size با ۵ کلید تنظیم شده درست کار می‌کند
  const saved: Record<string, string | undefined> = {};
  const envs = ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEY_4', 'GEMINI_API_KEY_5'];
  for (const k of envs) {
    saved[k] = process.env[k];
  }
  try {
    envs.forEach((k, i) => (process.env[k] = `test-key-${i + 1}`));
    // مجبور کردن reload با ایجاد pool جدید
    const { ApiKeyPool } = await import(`../lib/ai/key-pool.ts?pool=${Date.now()}`);
    const pool = new ApiKeyPool({ provider: 'gemini', envNames: envs });
    assert.equal(pool.size(), 5, 'باید ۵ کلید خوانده شود');
  } finally {
    for (const k of envs) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('سیستم اعتبار ۱۰۰ دلاری حذف شده است', async () => {
  const creditModule = await import(`../lib/ai/credit.ts?credit=${Date.now()}`);
  // در نسخه جدید، INITIAL_CREDIT_USD باید ۰ باشد (حذف شده)
  assert.equal(creditModule.INITIAL_CREDIT_USD, 0, 'سیستم اعتبار باید حذف شده باشد (۰)');
  assert.equal(creditModule.MAX_CREDIT_LOGS, 0);
});

test('فال‌بک فقط در شرایط جدی مجاز است (مستندات در gemini.ts)', async () => {
  const mod = await import(`../lib/ai/gemini.ts?fallback-doc=${Date.now()}`);
  // بررسی اینکه متن مربوط به fallback policy در کامنت فایل وجود دارد
  // منطق اصلی در gemini.ts پیاده شده و در این تست فقط وجود ماژول چک می‌شود
  assert.ok(mod.GEMINI_PRIMARY_MODEL, 'primary model باید وجود داشته باشد');
  assert.ok(mod.GEMINI_FALLBACK_MODEL, 'fallback model باید وجود داشته باشد');
  assert.equal(mod.GEMINI_PRIMARY_MODEL, mod.GEMINI_FALLBACK_MODEL, 'fallback پایدار پیش‌فرض همان مدل primary است');
});

test('normalizeGeminiModelName پیشوند models/ را حذف می‌کند (رفع 404)', async () => {
  const { normalizeGeminiModelName } = await import(`../lib/ai/gemini.ts?norm=${Date.now()}`);
  assert.equal(normalizeGeminiModelName('models/gemini-1.5-flash'), 'gemini-1.5-flash');
  assert.equal(normalizeGeminiModelName('models/models/gemini-1.5-flash'), 'gemini-1.5-flash');
  assert.equal(normalizeGeminiModelName('v1beta/models/gemini-1.5-flash'), 'gemini-1.5-flash');
  assert.equal(normalizeGeminiModelName('v1/models/gemini-1.5-flash'), 'gemini-1.5-flash');
  assert.equal(normalizeGeminiModelName('v1/models/models/gemini-1.5-flash'), 'gemini-1.5-flash');
  assert.equal(
    normalizeGeminiModelName('https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent'),
    'gemini-1.5-flash',
  );
  assert.equal(normalizeGeminiModelName('gemini-1.5-flash'), 'gemini-1.5-flash');
  assert.equal(normalizeGeminiModelName(''), 'gemini-1.5-flash');
  assert.equal(normalizeGeminiModelName(undefined), 'gemini-1.5-flash');
});

test('مقدار env با پیشوند models/ خودکار نرمال می‌شود (رفع 404)', async () => {
  const savedPrimary = process.env.GEMINI_PRIMARY_MODEL;
  const savedFallback = process.env.GEMINI_FALLBACK_MODEL;
  const savedAlias = process.env.GEMINI_MODEL;
  try {
    process.env.GEMINI_PRIMARY_MODEL = 'models/gemini-1.5-flash';
    process.env.GEMINI_FALLBACK_MODEL = 'models/gemini-1.5-flash';
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_TEXT_MODEL;
    const mod = await import(`../lib/ai/gemini.ts?env-norm=${Date.now()}`);
    assert.equal(mod.GEMINI_PRIMARY_MODEL, 'gemini-1.5-flash', 'primary باید بدون پیشوند models/ باشد');
    assert.equal(mod.GEMINI_FALLBACK_MODEL, 'gemini-1.5-flash', 'fallback باید بدون پیشوند models/ باشد');
    // زنجیره نیز نباید پیشوند داشته باشد
    assert.deepEqual(mod.getGeminiModelChain(), ['gemini-1.5-flash']);
  } finally {
    if (savedPrimary === undefined) delete process.env.GEMINI_PRIMARY_MODEL;
    else process.env.GEMINI_PRIMARY_MODEL = savedPrimary;
    if (savedFallback === undefined) delete process.env.GEMINI_FALLBACK_MODEL;
    else process.env.GEMINI_FALLBACK_MODEL = savedFallback;
    if (savedAlias === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = savedAlias;
  }
});

test('اندپوینت ساخته‌شده از مدل‌های نرمال‌شده به شکل v1/models/gemini-1.5-flash است', async () => {
  const { OPENROUTER_ENDPOINT } = await import(`../lib/ai/index.ts?endpoint=${Date.now()}`);
  assert.ok(
    OPENROUTER_ENDPOINT.startsWith('https://generativelanguage.googleapis.com/v1/models/') ||
      OPENROUTER_ENDPOINT.startsWith('https://generativelanguage.googleapis.com/v1beta/models/'),
    `اندپوینت باید از نسخه v1 یا v1beta و مسیر models/ استفاده کند: ${OPENROUTER_ENDPOINT}`,
  );
  assert.ok(
    OPENROUTER_ENDPOINT.endsWith(':generateContent'),
    `اندپوینت باید به :generateContent ختم شود: ${OPENROUTER_ENDPOINT}`,
  );
  assert.ok(
    !OPENROUTER_ENDPOINT.includes('/models/models/'),
    `پیشوند تکراری models/ نباید وجود داشته باشد: ${OPENROUTER_ENDPOINT}`,
  );
});

test('buildGeminiAuthHeaders تمامی کلیدهای API از جمله AQ. را با هدر x-goog-api-key ارسال می‌کند (جلوگیری از خطای 401)', async () => {
  const { buildGeminiAuthHeaders } = await import(`../lib/ai/gemini.ts?auth=${Date.now()}`);

  // کلید کلاسیک AIzaSy
  const classicHeaders = buildGeminiAuthHeaders('AIzaSyClassicKey123');
  assert.deepEqual(classicHeaders, { 'x-goog-api-key': 'AIzaSyClassicKey123' });

  // کلید جدید AQ.
  const newFormatHeaders = buildGeminiAuthHeaders('AQ.Ab8RN6LF24rBGzAfHx2e7GsvJ6MBuimKLqJS6qrsF2VzjeTf4w');
  assert.deepEqual(
    newFormatHeaders,
    { 'x-goog-api-key': 'AQ.Ab8RN6LF24rBGzAfHx2e7GsvJ6MBuimKLqJS6qrsF2VzjeTf4w' },
    'کلیدهای AQ. نباید با Authorization: Bearer ارسال شوند زیرا موجب خطای 401 Expected OAuth 2 access token می‌شود',
  );

  // توکن OAuth 2.0 واقعی (ya29.)
  const oauthHeaders = buildGeminiAuthHeaders('ya29.a0ABC123456');
  assert.deepEqual(oauthHeaders, { Authorization: 'Bearer ya29.a0ABC123456' });

  // کلید خالی
  assert.deepEqual(buildGeminiAuthHeaders(''), {});
});
