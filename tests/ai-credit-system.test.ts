import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * تست‌های سیستم محاسبه هزینهٔ API و کسر اعتبار (Credit System) — NursePlan
 *
 * الزامات تحت پوشش:
 *   ۱) فرمول هزینه بر اساس توکن (از res.usage شامل prompt_tokens و completion_tokens):
 *      - gpt-4o-mini : (prompt * 0.15 / 1M) + (completion * 0.60 / 1M)
 *      - gpt-4o      : (prompt * 2.50 / 1M) + (completion * 10.00 / 1M)
 *      - اولویت با متغیرهای محیطی PRICING_GPT4O_MINI_INPUT/OUTPUT و PRICING_GPT4O_INPUT/OUTPUT
 *   ۲) ذخیره و به‌روزرسانی اعتبار پس از هر درخواست + لاگ (مدل، توکن ورودی، توکن خروجی، هزینه به دلار)
 *   ۳) اکشن «شارژ مجدد ۱۰۰ دلار»: { action: "recharge", amount: 100 } →
 *      بازگشت اعتبار به $100.00 و ریست بنرهای هشدار زرد/قرمز به حالت عادی
 */

const CREDIT_FILE_PATHS = [
  path.join(process.cwd(), 'data', 'ai-credit.json'),
  path.join(process.cwd(), '.tmp', 'ai-credit.json'),
  '/tmp/nurseplan-ai-credit.json',
];

function cleanupCreditFiles() {
  for (const filePath of CREDIT_FILE_PATHS) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // ignore
    }
  }
}

beforeEach(() => {
  cleanupCreditFiles();
});

/** import تازه از ماژول credit (بدون state/file قبلی) */
async function freshCreditModule(tag: string) {
  cleanupCreditFiles();
  return await import(`../lib/ai/credit.ts?credit=${tag}-${Date.now()}`);
}

/** اجرا با متغیرهای محیطی موقت و بازیابی وضعیت قبلی (برای تابع async هم امن است) */
async function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ============================================================================
// ۱) فرمول محاسبه هزینه بر اساس توکن
// ============================================================================

test('فرمول gpt-4o-mini: (prompt*0.15/1M) + (completion*0.60/1M)', async () => {
  const { calculateCostUSD } = await freshCreditModule('mini');

  // ۱٬۰۰۰٬۰۰۰ توکن ورودی + ۵۰۰٬۰۰۰ توکن خروجی → 0.15 + 0.30 = 0.45
  const cost = calculateCostUSD('gpt-4o-mini', 1_000_000, 500_000);
  assert.ok(Math.abs(cost - 0.45) < 1e-9, `هزینهٔ موردانتظار 0.45 بود ولی ${cost} محاسبه شد`);

  // ۲٬۰۰۰٬۰۰۰ ورودی + ۱٬۰۰۰٬۰۰۰ خروجی → 0.30 + 0.60 = 0.90
  const cost2 = calculateCostUSD('gpt-4o-mini', 2_000_000, 1_000_000);
  assert.ok(Math.abs(cost2 - 0.90) < 1e-9, `هزینهٔ موردانتظار 0.90 بود ولی ${cost2} محاسبه شد`);

  // فرم پیشونددار openai/gpt-4o-mini هم باید همان تعرفه را داشته باشد
  const prefixed = calculateCostUSD('openai/gpt-4o-mini', 1_000_000, 500_000);
  assert.ok(Math.abs(prefixed - 0.45) < 1e-9, `تعرفهٔ openai/gpt-4o-mini باید یکسان باشد (${prefixed})`);
});

test('فرمول gpt-4o: (prompt*2.50/1M) + (completion*10.00/1M)', async () => {
  const { calculateCostUSD } = await freshCreditModule('gpt4o');

  // ۱٬۰۰۰٬۰۰۰ ورودی + ۵۰۰٬۰۰۰ خروجی → 2.50 + 5.00 = 7.50
  const cost = calculateCostUSD('gpt-4o', 1_000_000, 500_000);
  assert.ok(Math.abs(cost - 7.50) < 1e-9, `هزینهٔ موردانتظار 7.50 بود ولی ${cost} محاسبه شد`);

  // ۱٬۰۰۰٬۰۰۰ ورودی + ۱٬۰۰۰٬۰۰۰ خروجی → 2.50 + 10.00 = 12.50
  const cost2 = calculateCostUSD('gpt-4o', 1_000_000, 1_000_000);
  assert.ok(Math.abs(cost2 - 12.50) < 1e-9, `هزینهٔ موردانتظار 12.50 بود ولی ${cost2} محاسبه شد`);

  const prefixed = calculateCostUSD('openai/gpt-4o', 1_000_000, 500_000);
  assert.ok(Math.abs(prefixed - 7.50) < 1e-9, `تعرفهٔ openai/gpt-4o باید یکسان باشد (${prefixed})`);
});

test('اولویت قیمت‌گذاری با متغیرهای محیطی PRICING_GPT4O_* است', async () => {
  const mod = await withEnv(
    {
      PRICING_GPT4O_MINI_INPUT: '0.30',
      PRICING_GPT4O_MINI_OUTPUT: '1.20',
      PRICING_GPT4O_INPUT: '5.00',
      PRICING_GPT4O_OUTPUT: '20.00',
    },
    async () => {
      return await freshCreditModule('env');
    },
  );

  // gpt-4o-mini با تعرفهٔ env: 1M ورودی → 0.30 + 1M خروجی → 1.20 = 1.50
  const miniCost = mod.calculateCostUSD('gpt-4o-mini', 1_000_000, 1_000_000);
  assert.ok(Math.abs(miniCost - 1.50) < 1e-9, `تعرفهٔ env برای mini: ${miniCost}`);

  // gpt-4o با تعرفهٔ env: 1M ورودی → 5 + 1M خروجی → 20 = 25
  const gpt4oCost = mod.calculateCostUSD('gpt-4o', 1_000_000, 1_000_000);
  assert.ok(Math.abs(gpt4oCost - 25) < 1e-9, `تعرفهٔ env برای gpt-4o: ${gpt4oCost}`);
});

// ============================================================================
// ۲) کسر اعتبار، ذخیرهٔ state و لاگ هر درخواست
// ============================================================================

test('deductCredit هزینه را از اعتبار کسر کرده و لاگ کامل درخواست را ثبت می‌کند', async () => {
  const mod = await freshCreditModule('deduct');

  mod.resetCredit(100);
  assert.equal(mod.getCreditState().remaining, 100);

  // gpt-4o-mini: ۱٬۰۰۰٬۰۰۰ ورودی + ۵۰۰٬۰۰۰ خروجی → cost = 0.45
  const result = mod.deductCredit({
    model: 'gpt-4o-mini',
    inputTokens: 1_000_000,
    outputTokens: 500_000,
  });

  assert.ok(Math.abs(result.cost - 0.45) < 1e-9, `هزینه باید 0.45 باشد ولی ${result.cost} است`);
  assert.ok(Math.abs(result.remaining - 99.55) < 1e-9, `باقی‌مانده باید 99.55 باشد ولی ${result.remaining} است`);
  assert.equal(result.status, 'ok');
  assert.equal(result.state.requestCount, 1);
  assert.equal(result.state.totalInputTokens, 1_000_000);
  assert.equal(result.state.totalOutputTokens, 500_000);
  assert.ok(Math.abs(result.state.totalSpent - 0.45) < 1e-9);

  // لاگ هر درخواست باید شامل مدل، توکن ورودی، توکن خروجی و هزینهٔ کسرشده به دلار باشد
  assert.equal(result.state.logs.length, 1);
  const log = result.state.logs[0];
  assert.equal(log.kind, 'request');
  assert.equal(log.model, 'gpt-4o-mini');
  assert.equal(log.inputTokens, 1_000_000);
  assert.equal(log.outputTokens, 500_000);
  assert.ok(Math.abs(log.cost! - 0.45) < 1e-9);
  assert.ok(Math.abs(log.remaining - 99.55) < 1e-9);
  assert.ok(log.at, 'لاگ باید زمان داشته باشد');

  // display info هم لاگ‌ها را برمی‌گرداند (جدیدترین‌ها اول)
  const display = mod.getCreditDisplayInfo();
  assert.equal(display.logs.length, 1);
  assert.equal(display.logs[0].model, 'gpt-4o-mini');
});

test('کسر اعتبار برای مدل gpt-4o با تعرفهٔ 2.50/10.00', async () => {
  const mod = await freshCreditModule('deduct4o');
  mod.resetCredit(100);

  const result = mod.deductCredit({ model: 'gpt-4o', inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.ok(Math.abs(result.cost - 12.50) < 1e-9);
  assert.ok(Math.abs(result.remaining - 87.50) < 1e-9);
  assert.equal(result.state.byModel['gpt-4o']?.count, 1);
});

// ============================================================================
// ۳) شارژ مجدد (Recharge $100) و ریست بنرهای هشدار
// ============================================================================

test('rechargeCredit اعتبار را به $100 بازمی‌گرداند و بنرهای هشدار را به حالت عادی ریست می‌کند', async () => {
  const mod = await freshCreditModule('recharge');
  mod.resetCredit(100);

  // مصرف تا زیر آستانهٔ بحرانی (باقی‌مانده = 1 دلار → قرمز)
  const deducted = mod.deductCredit({ model: 'gpt-4o', inputTokens: 39_600_000, outputTokens: 0 }); // cost=99
  assert.ok(Math.abs(deducted.remaining - 1) < 1e-9);
  assert.equal(mod.getCreditStatusLevel(deducted.remaining), 'critical');

  // شارژ مجدد ۱۰۰ دلاری
  const recharged = mod.rechargeCredit(100);
  assert.ok(Math.abs(recharged.remaining - 100) < 1e-9, `باقی‌مانده باید $100.00 باشد ولی ${recharged.remaining} است`);
  assert.equal(mod.getCreditStatusLevel(recharged.remaining), 'ok', 'وضعیت باید به عادی (ok) برگردد');

  // آمار مصرف حفظ می‌شود؛ فقط سقف اعتبار (initial) جابه‌جا می‌شود
  assert.ok(Math.abs(recharged.totalSpent - 99) < 1e-9, 'آمار مصرف نباید از بین برود');
  assert.ok(Math.abs(recharged.initial - 199) < 1e-9);

  // یک ردیف لاگ recharge ثبت می‌شود
  const rechargeLog = recharged.logs[recharged.logs.length - 1];
  assert.equal(rechargeLog.kind, 'recharge');
  assert.equal(rechargeLog.amount, 100);
  assert.ok(Math.abs(rechargeLog.remaining - 100) < 1e-9);

  // بنرهای هشدار از بین می‌روند
  const display = mod.getCreditDisplayInfo();
  assert.equal(display.status, 'ok');
  assert.equal(display.warningMessage, undefined);
});

test('applyCreditAction: اکشن recharge مطابق قرارداد POST /api/ai/credit', async () => {
  const mod = await freshCreditModule('action');
  mod.resetCredit(100);
  mod.deductCredit({ model: 'gpt-4o-mini', inputTokens: 10_000_000, outputTokens: 0 }); // cost=1.50

  const result = mod.applyCreditAction('recharge', 100);
  assert.equal(result.ok, true);
  assert.equal(result.statusCode, 200);
  assert.ok(result.message.includes('100.00'), `پیام: ${result.message}`);
  assert.ok(Math.abs(result.credit.remaining - 100) < 1e-9, `باقی‌مانده: ${result.credit.remaining}`);
  assert.equal(result.credit.status, 'ok');
});

test('applyCreditAction: اکشن‌های نامعتبر و مبالغ نامعتبر 400 برمی‌گردانند', async () => {
  const mod = await freshCreditModule('action-invalid');

  const badAction = mod.applyCreditAction('bogus', 100);
  assert.equal(badAction.ok, false);
  assert.equal(badAction.statusCode, 400);
  assert.ok(badAction.error);

  const badAmount = mod.applyCreditAction('add', -50);
  assert.equal(badAmount.ok, false);
  assert.equal(badAmount.statusCode, 400);

  const badRecharge = mod.applyCreditAction('recharge', -10);
  assert.equal(badRecharge.ok, true, 'amount نامعتبر → پیش‌فرض ۱۰۰ استفاده می‌شود');
  assert.ok(Math.abs(badRecharge.credit.remaining - 100) < 1e-9);
});

test('applyCreditAction: اکشن add مبلغ را به اعتبار فعلی اضافه می‌کند', async () => {
  const mod = await freshCreditModule('action-add');
  mod.resetCredit(100);

  const result = mod.applyCreditAction('add', 25);
  assert.equal(result.ok, true);
  assert.ok(Math.abs(result.credit.remaining - 125) < 1e-9);
});

// ============================================================================
// سطوح هشدار زرد/قرمز و سقف لاگ
// ============================================================================

test('سطوح هشدار: عادی >15، زرد <15، قرمز <5، اتمام 0', async () => {
  const mod = await freshCreditModule('levels');

  assert.equal(mod.getCreditStatusLevel(100), 'ok');
  assert.equal(mod.getCreditStatusLevel(15), 'ok');
  assert.equal(mod.getCreditStatusLevel(14.99), 'warning');
  assert.equal(mod.getCreditStatusLevel(5), 'warning');
  assert.equal(mod.getCreditStatusLevel(4.99), 'critical');
  assert.equal(mod.getCreditStatusLevel(0), 'depleted');
});

test('سقف لاگ MAX_CREDIT_LOGS رعایت می‌شود', async () => {
  const mod = await freshCreditModule('logcap');
  mod.resetCredit(100);

  for (let i = 0; i < 205; i++) {
    mod.deductCredit({ model: 'gpt-4o-mini', inputTokens: 1_000, outputTokens: 1_000 }); // cost ≈ 0.00075
  }

  const state = mod.getCreditState();
  assert.ok(state.logs.length <= mod.MAX_CREDIT_LOGS, `طول لاگ ${state.logs.length} نباید از ${mod.MAX_CREDIT_LOGS} بیشتر باشد`);
  assert.equal(state.logs.length, mod.MAX_CREDIT_LOGS, 'لاگ باید دقیقاً به اندازهٔ سقف باشد');
  assert.equal(state.requestCount, 205);
});

test('formula در lib/ai/index و openrouter به‌صورت یکسان export شده است', async () => {
  cleanupCreditFiles();
  const { calculateCostUSD: viaIndex } = await import(`../lib/ai/index.ts?credit-index=${Date.now()}`);
  const { calculateCostUSD: viaOpenRouter } = await import(`../lib/ai/openrouter.ts?credit-or=${Date.now()}`);

  const a = viaIndex('gpt-4o-mini', 1_000_000, 500_000);
  const b = viaOpenRouter('gpt-4o-mini', 1_000_000, 500_000);
  assert.ok(Math.abs(a - b) < 1e-12, 'محاسبه باید از هر دو مسیر یکسان باشد');
});
