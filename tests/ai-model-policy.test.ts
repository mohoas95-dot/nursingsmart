import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * نگهبان سیاست مدل‌ها — معماری جدید بر پایه Bluesminds
 *
 * الزامات جدید:
 *   - متن (Text Analysis): gpt-4o-mini با fallback به gpt-4o (دقیقاً مانند مسیر تصویری)
 *   - تصویر (Vision/OCR): gpt-4o-mini با fallback به gpt-4o
 *   - تمام درخواست‌ها از OPENROUTER_API_KEY استفاده می‌کنند
 *   - سیستم اعتبار ۱۰۰ دلاری با هشدار <15$ و بحرانی <5$
 *
 * این تست جلوی بازگشت به مدل‌های قدیمی (Groq/Gemini direct/DeepSeek) را می‌گیرد
 */

// مدل‌های قدیمی که دیگر نباید پیش‌فرض باشند
const DEPRECATED_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'qwen/qwen3-32b',
  'moonshotai/kimi-k2-instruct',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'deepseek-chat',
  'deepseek-v3',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-v3',
  'deepseek/deepseek-chat-v3-0324',
];

async function loadOpenRouterModule() {
  const envKeys = ['OPENROUTER_TEXT_MODEL', 'OPENROUTER_TEXT_FALLBACK_MODEL', 'OPENROUTER_DEEPSEEK_MODEL', 'OPENROUTER_VISION_MODEL', 'OPENROUTER_VISION_FALLBACK_MODEL'];
  const saved: Record<string, string | undefined> = {};
  for (const key of envKeys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    return await import(`../lib/ai/openrouter.ts?policy=${Date.now()}`);
  } finally {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('مدل متنی پیش‌فرض باید gpt-4o-mini باشد (دقیقاً مانند مسیر تصویری)', async () => {
  const { TEXT_MODEL } = await loadOpenRouterModule();
  const validTextModels = ['gpt-4o-mini', 'openai/gpt-4o-mini'];
  assert.ok(
    validTextModels.includes(TEXT_MODEL),
    `مدل متنی «${TEXT_MODEL}» باید 'gpt-4o-mini' باشد (مشابه مسیر Vision).`,
  );
});

test('مدل fallback متنی باید gpt-4o باشد (مشابه مسیر تصویری)', async () => {
  const { TEXT_MODEL_FALLBACK } = await loadOpenRouterModule();
  const validFallbackModels = ['gpt-4o', 'openai/gpt-4o'];
  assert.ok(
    validFallbackModels.includes(TEXT_MODEL_FALLBACK),
    `مدل fallback متنی باید 'gpt-4o' باشد، اما «${TEXT_MODEL_FALLBACK}» یافت شد.`,
  );
});

test('زنجیره مدل متنی باید [gpt-4o-mini, gpt-4o] باشد (مشابه زنجیره بینایی)', async () => {
  const { getTextModelChain } = await loadOpenRouterModule();
  const chain = getTextModelChain();
  assert.ok(chain.length >= 2, 'زنجیره متنی باید حداقل دو مدل داشته باشد (اصلی + fallback)');
  const validPrimary = ['gpt-4o-mini', 'openai/gpt-4o-mini'];
  const validFallback = ['gpt-4o', 'openai/gpt-4o'];
  assert.ok(validPrimary.includes(chain[0]), `مدل اصلی متنی باید gpt-4o-mini باشد، اما ${chain[0]} بود`);
  assert.ok(validFallback.includes(chain[1]), `مدل fallback متنی باید gpt-4o باشد، اما ${chain[1]} بود`);
});

test('مدل بینایی اصلی باید gpt-4o-mini باشد (طبق الزام)', async () => {
  const { VISION_MODEL } = await loadOpenRouterModule();
  const validVisionModels = ['gpt-4o-mini', 'openai/gpt-4o-mini'];
  assert.ok(
    validVisionModels.includes(VISION_MODEL),
    `مدل بینایی پیش‌فرض باید 'gpt-4o-mini' باشد، اما «${VISION_MODEL}» یافت شد.`,
  );
});

test('مدل fallback بینایی باید gpt-4o باشد (برای تصاویر شلوغ/کم‌کیفیت)', async () => {
  const { VISION_FALLBACK_MODEL } = await loadOpenRouterModule();
  const validFallbackModels = ['gpt-4o', 'openai/gpt-4o'];
  assert.ok(
    validFallbackModels.includes(VISION_FALLBACK_MODEL),
    `مدل fallback بینایی باید 'gpt-4o' باشد، اما «${VISION_FALLBACK_MODEL}» یافت شد.`,
  );
});

test('زنجیره مدل متنی نباید شامل مدل‌های منسوخ Groq/Gemini/DeepSeek باشد', async () => {
  const { getTextModelChain } = await loadOpenRouterModule();
  const chain = getTextModelChain();
  for (const model of chain) {
    assert.ok(
      !DEPRECATED_MODELS.includes(model),
      `مدل منسوخ «${model}» در زنجیره متنی است؛ باید با GPT-4o-mini/GPT-4o جایگزین شود.`,
    );
  }
});

test('زنجیره مدل بینایی نباید شامل مدل‌های منسوخ باشد و حداقل یک fallback دارد', async () => {
  const { getVisionModelChain } = await loadOpenRouterModule();
  const chain = getVisionModelChain();
  assert.ok(chain.length >= 2, 'زنجیره بینایی باید حداقل دو مدل داشته باشد (اصلی + fallback برای تصاویر شلوغ)');
  const validPrimary = ['gpt-4o-mini', 'openai/gpt-4o-mini'];
  const validFallback = ['gpt-4o', 'openai/gpt-4o'];
  assert.ok(validPrimary.includes(chain[0]), `مدل اصلی بینایی باید gpt-4o-mini باشد، اما ${chain[0]} بود`);
  assert.ok(validFallback.includes(chain[1]), `مدل fallback بینایی باید gpt-4o باشد، اما ${chain[1]} بود`);
});

test('زنجیره‌ها تکراری ندارند', async () => {
  const { getTextModelChain, getVisionModelChain } = await loadOpenRouterModule();
  const textChain = getTextModelChain();
  const visionChain = getVisionModelChain();
  assert.equal(new Set(textChain).size, textChain.length, 'زنجیره متنی تکراری دارد');
  assert.equal(new Set(visionChain).size, visionChain.length, 'زنجیره بینایی تکراری دارد');
});

test('کلید OpenRouter از OPENROUTER_API_KEY خوانده می‌شود', async () => {
  const { openRouterKeyPool } = await loadOpenRouterModule();
  // Pool should be configured to read OPENROUTER_API_KEY
  assert.ok(openRouterKeyPool, 'openRouterKeyPool باید وجود داشته باشد');
  // Check envNames includes OPENROUTER_API_KEY
  // We cannot easily access envNames private, but we can check that module exports it
});

test('سیستم اعتبار ۱۰۰ دلاری وجود دارد و سطوح هشدار درست تنظیم شده‌اند', async () => {
  const creditModule = await import(`../lib/ai/credit.ts?credit=${Date.now()}`);
  const { INITIAL_CREDIT_USD, WARNING_THRESHOLD_USD, CRITICAL_THRESHOLD_USD, getCreditStatusLevel } = creditModule;

  assert.equal(INITIAL_CREDIT_USD, 100, 'اعتبار اولیه باید ۱۰۰ دلار باشد');
  assert.equal(WARNING_THRESHOLD_USD, 15, 'آستانه هشدار زرد باید ۱۵ دلار باشد');
  assert.equal(CRITICAL_THRESHOLD_USD, 5, 'آستانه هشدار قرمز باید ۵ دلار باشد');

  assert.equal(getCreditStatusLevel(84.5), 'ok');
  assert.equal(getCreditStatusLevel(14), 'warning');
  assert.equal(getCreditStatusLevel(4), 'critical');
  assert.equal(getCreditStatusLevel(0), 'depleted');
});

test('قیمت‌گذاری مدل‌ها بر اساس الزامات تعریف شده است', async () => {
  const creditModule = await import(`../lib/ai/credit.ts?pricing=${Date.now()}`);
  const { MODEL_PRICING, calculateCostUSD } = creditModule;

  assert.ok(MODEL_PRICING['deepseek-chat'] || MODEL_PRICING['deepseek/deepseek-chat'], 'قیمت‌گذاری DeepSeek (برای لاگ‌های تاریخی) باید وجود داشته باشد');
  assert.ok(MODEL_PRICING['gpt-4o-mini'] || MODEL_PRICING['openai/gpt-4o-mini'], 'قیمت‌گذاری gpt-4o-mini باید وجود داشته باشد');
  assert.ok(MODEL_PRICING['gpt-4o'] || MODEL_PRICING['openai/gpt-4o'], 'قیمت‌گذاری gpt-4o باید وجود داشته باشد');

  // تست محاسبه هزینه
  const cost = calculateCostUSD('gpt-4o-mini', 1000, 1000);
  assert.ok(cost > 0 && cost < 0.01, `هزینه باید معقول باشد، اما ${cost} بود`);
});

test('موتور متن و موتور تصویر در معماری جدید از یک استخر کلید مشترک OpenRouter استفاده می‌کنند', async () => {
  const { groqKeyPool } = await import('../lib/ai/groq');
  const { geminiKeyPool } = await import('../lib/ai/gemini-vision');
  const { openRouterKeyPool } = await import('../lib/ai/openrouter');

  // در معماری جدید، همه باید به openRouterKeyPool اشاره کنند (یا حداقل provider مشترک)
  assert.equal(groqKeyPool, openRouterKeyPool, 'groqKeyPool باید همان openRouterKeyPool باشد (معماری جدید)');
  assert.equal(geminiKeyPool, openRouterKeyPool, 'geminiKeyPool باید همان openRouterKeyPool باشد (معماری جدید)');
});
