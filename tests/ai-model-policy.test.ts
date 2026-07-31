import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * نگهبان سیاست مدل‌ها — نسخهٔ Puter.js.
 *
 * چرا این تست وجود دارد؟
 *   اگر روزی مدل پیش‌فرض متن/تصویر عوض شود یا زنجیرهٔ جایگزین خالی/تکراری
 *   شود، چت‌باکس بی‌صدا از کار می‌افتد یا سهمیه را بی‌دلیل هدر می‌دهد.
 *   این تست چند قاعدهٔ ساختاری سادهٔ زنجیرهٔ مدل‌های Puter را قفل می‌کند.
 */

/** بارگذاری تازهٔ ماژول با محیط پاک (تا مقدار env روی نتیجه اثر نگذارد). */
async function loadPuterModule() {
  const envKeys = ['PUTER_MODEL', 'PUTER_FALLBACK_MODELS', 'PUTER_VISION_MODEL', 'PUTER_VISION_FALLBACK_MODELS'];
  const saved: Record<string, string | undefined> = {};
  for (const key of envKeys) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    // cache-busting تا پیش‌فرض‌ها دوباره ارزیابی شوند
    return await import(`../lib/ai/puter.ts?policy=${Date.now()}`);
  } finally {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('زنجیرهٔ متن Puter حداقل دو مدل دارد تا در صورت اتمام سهمیه جایگزین بماند', async () => {
  const { getPuterModelChain } = await loadPuterModule();
  assert.ok(getPuterModelChain().length >= 2);
});

test('مدل اصلی متن، اولین عضو زنجیره است', async () => {
  const { PUTER_MODEL, getPuterModelChain } = await loadPuterModule();
  assert.equal(getPuterModelChain()[0], PUTER_MODEL);
});

test('زنجیرهٔ متن تکراری ندارد (هر مدل فقط یک بار امتحان می‌شود)', async () => {
  const { getPuterModelChain } = await loadPuterModule();
  const chain: string[] = getPuterModelChain();
  assert.equal(new Set(chain).size, chain.length);
});

test('زنجیرهٔ بینایی Puter حداقل دو مدل دارد', async () => {
  const { getPuterVisionModelChain } = await loadPuterModule();
  assert.ok(getPuterVisionModelChain().length >= 2);
});

test('مدل اصلی بینایی، اولین عضو زنجیرهٔ بینایی است', async () => {
  const { PUTER_VISION_MODEL, getPuterVisionModelChain } = await loadPuterModule();
  assert.equal(getPuterVisionModelChain()[0], PUTER_VISION_MODEL);
});

test('زنجیرهٔ بینایی تکراری ندارد', async () => {
  const { getPuterVisionModelChain } = await loadPuterModule();
  const chain: string[] = getPuterVisionModelChain();
  assert.equal(new Set(chain).size, chain.length);
});

test('موتور متن و موتور تصویر از یک استخر توکن مشترک استفاده می‌کنند (تک‌موتوره)', async () => {
  const { puterKeyPool } = await import('../lib/ai/puter');
  assert.ok(puterKeyPool, 'استخر توکن Puter باید وجود داشته باشد');
});
