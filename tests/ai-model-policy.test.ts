import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * نگهبان سیاست مدل‌ها.
 *
 * چرا این تست وجود دارد؟
 *   Groq مدل‌ها را با اعلام قبلی خاموش می‌کند. در تاریخ ۲۰۲۶/۰۸/۱۶ هر دو مدل
 *   `llama-3.3-70b-versatile` و `llama-3.1-8b-instant` از سرویس خارج می‌شوند.
 *   اگر کسی (یا نسخهٔ آیندهٔ همین کد) دوباره آن‌ها را به‌عنوان پیش‌فرض بگذارد،
 *   چت‌باکس در تاریخ خاموشی بی‌صدا از کار می‌افتد. این تست جلوی آن را می‌گیرد.
 *
 * منبع: https://console.groq.com/docs/deprecations
 */

/** مدل‌هایی که Groq اعلام کرده خاموش می‌شوند یا شده‌اند. */
const DEPRECATED_GROQ_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'qwen/qwen3-32b',
  'moonshotai/kimi-k2-instruct',
  'moonshotai/kimi-k2-instruct-0905',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
  'meta-llama/llama-guard-4-12b',
];

/** بارگذاری تازهٔ ماژول با محیط پاک (تا مقدار env روی نتیجه اثر نگذارد). */
async function loadGroqModule() {
  const envKeys = ['GROQ_MODEL', 'GROQ_FALLBACK_MODELS'];
  const saved: Record<string, string | undefined> = {};
  for (const key of envKeys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    // cache-busting تا پیش‌فرض‌ها دوباره ارزیابی شوند
    return await import(`../lib/ai/groq.ts?policy=${Date.now()}`);
  } finally {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('مدل اصلی Groq جزو مدل‌های منسوخ‌شده نیست', async () => {
  const { GROQ_MODEL } = await loadGroqModule();
  assert.ok(
    !DEPRECATED_GROQ_MODELS.includes(GROQ_MODEL),
    `مدل «${GROQ_MODEL}» منسوخ شده است و در تاریخ خاموشی، چت‌باکس از کار می‌افتد.`,
  );
});

test('هیچ مدلی در کل زنجیرهٔ Groq منسوخ نیست', async () => {
  const { getGroqModelChain } = await loadGroqModule();
  const chain: string[] = getGroqModelChain();
  for (const model of chain) {
    assert.ok(
      !DEPRECATED_GROQ_MODELS.includes(model),
      `مدل منسوخ «${model}» در زنجیرهٔ جایگزین است؛ آن را با یک مدل زنده عوض کنید.`,
    );
  }
});

test('زنجیرهٔ Groq حداقل دو مدل دارد تا در صورت اتمام سهمیه جایگزین بماند', async () => {
  const { getGroqModelChain } = await loadGroqModule();
  assert.ok(getGroqModelChain().length >= 2);
});

test('مدل اصلی، اولین عضو زنجیره است', async () => {
  const { GROQ_MODEL, getGroqModelChain } = await loadGroqModule();
  assert.equal(getGroqModelChain()[0], GROQ_MODEL);
});

test('زنجیره تکراری ندارد (هر مدل فقط یک بار امتحان می‌شود)', async () => {
  const { getGroqModelChain } = await loadGroqModule();
  const chain: string[] = getGroqModelChain();
  assert.equal(new Set(chain).size, chain.length);
});

test('مدل بینایی روی Gemini 2.5 Flash تنظیم است (تصمیم محصول)', async () => {
  const saved = process.env.GEMINI_VISION_MODEL;
  delete process.env.GEMINI_VISION_MODEL;
  try {
    const { GEMINI_VISION_MODEL } = await import(`../lib/ai/gemini-vision.ts?policy=${Date.now()}`);
    assert.equal(GEMINI_VISION_MODEL, 'gemini-2.5-flash');
  } finally {
    if (saved === undefined) delete process.env.GEMINI_VISION_MODEL;
    else process.env.GEMINI_VISION_MODEL = saved;
  }
});

test('موتور متن و موتور تصویر استخر کلید جدا دارند', async () => {
  const { groqKeyPool } = await import('../lib/ai/groq');
  const { geminiKeyPool } = await import('../lib/ai/gemini-vision');
  assert.notEqual(groqKeyPool, geminiKeyPool, 'دو سرویس نباید استخر کلید مشترک داشته باشند');
});
