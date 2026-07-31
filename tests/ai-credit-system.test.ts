import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * تست‌های سیستم اعتبار — معماری ۲۰۲۶
 *
 * طبق درخواست کارفرما، سیستم اعتبار ۱۰۰ دلاری کاملاً حذف شده است.
 * این فایل فقط بررسی می‌کند که ماژول credit به صورت stub و خالی باشد
 * و دیگر هزینه‌ای محاسبه نکند.
 */

test('سیستم اعتبار ۱۰۰ دلاری حذف شده — INITIAL_CREDIT_USD باید ۰ باشد', async () => {
  const mod = await import(`../lib/ai/credit.ts?credit-removed=${Date.now()}`);
  assert.equal(mod.INITIAL_CREDIT_USD, 0);
  assert.equal(mod.MAX_CREDIT_LOGS, 0);
  assert.equal(mod.WARNING_THRESHOLD_USD, 0);
  assert.equal(mod.CRITICAL_THRESHOLD_USD, 0);
});

test('getCreditDisplayInfo باید خالی برگرداند و لاگ نداشته باشد', async () => {
  const mod = await import(`../lib/ai/credit.ts?credit-empty=${Date.now()}`);
  const info = mod.getCreditDisplayInfo();
  assert.equal(info.logs.length, 0, 'لاگ اعتبار باید حذف شده باشد');
  assert.equal(info.initial, 0);
  assert.equal(info.remaining, 0);
});

test('calculateCostUSD باید ۰ برگرداند چون هزینه در کنسول گوگل مدیریت می‌شود', async () => {
  const mod = await import(`../lib/ai/credit.ts?cost-zero=${Date.now()}`);
  const cost = mod.calculateCostUSD('gemini-1.5-flash', 1000000, 500000);
  assert.equal(cost, 0);
});

test('applyCreditAction باید ۴۱۰ برگرداند (منسوخ شده)', async () => {
  const mod = await import(`../lib/ai/credit.ts?action-deprecated=${Date.now()}`);
  const result = mod.applyCreditAction('recharge', 100);
  assert.equal(result.statusCode, 410);
  assert.equal(result.ok, false);
});
