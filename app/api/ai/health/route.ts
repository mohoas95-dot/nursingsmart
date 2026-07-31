import { NextResponse } from "next/server";
import {
  OPENROUTER_PROVIDER,
  OPENROUTER_BASE_URL,
  OPENROUTER_ENDPOINT,
  TEXT_MODEL,
  TEXT_MODEL_FALLBACK,
  VISION_MODEL,
  VISION_FALLBACK_MODEL,
  getTextModelChain,
  getVisionModelChain,
  openRouterKeyPool,
} from "@/lib/ai";
import { getCreditDisplayInfo, getCreditState } from "@/lib/ai/credit";

/**
 * مسیر تشخیصی سلامت هوش مصنوعی — معماری جدید OpenRouter
 *
 * برای پاسخ به:
 * - آیا کلید OpenRouter در env درست تنظیم شده؟
 * - کدام مدل‌ها برای متن و تصویر استفاده می‌شوند؟
 * - وضعیت اعتبار ۱۰۰ دلاری چیست؟
 * - هشدارهای اعتبار (<15$ زرد، <5$ قرمز) فعال هستند؟
 *
 * هیچ‌گاه مقدار کلیدها را برنمی‌گرداند — فقط تعداد، وضعیت سلامت و چهار رقم آخر ماسک‌شده.
 *
 * نمونه استفاده: GET /api/ai/health
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const keySnapshots = openRouterKeyPool.snapshot();
  const creditInfo = getCreditDisplayInfo();
  const creditState = getCreditState();

  const payload = {
    ok: openRouterKeyPool.size() > 0 && creditInfo.status !== 'depleted',
    checkedAt: new Date().toISOString(),
    provider: OPENROUTER_PROVIDER,
    baseUrl: OPENROUTER_BASE_URL,
    endpoint: OPENROUTER_ENDPOINT,
    text: {
      provider: OPENROUTER_PROVIDER,
      role: "تحلیل پیام‌های متنی چت‌باکس (Text Analysis)",
      primaryModel: TEXT_MODEL,
      fallbackModel: TEXT_MODEL_FALLBACK,
      modelChain: getTextModelChain(),
      pricing: {
        model: TEXT_MODEL,
        inputPerMillion: "$0.27",
        outputPerMillion: "$1.10",
      },
    },
    vision: {
      provider: OPENROUTER_PROVIDER,
      role: "تحلیل تصاویر ارسالی در چت‌باکس (Vision / OCR)",
      primaryModel: VISION_MODEL,
      fallbackModel: VISION_FALLBACK_MODEL,
      modelChain: getVisionModelChain(),
      pricing: {
        primary: { model: VISION_MODEL, inputPerMillion: "$0.15", outputPerMillion: "$0.60" },
        fallback: { model: VISION_FALLBACK_MODEL, inputPerMillion: "$2.50", outputPerMillion: "$10.00" },
      },
      fallbackLogic: "در صورت تصویر شلوغ یا کم‌کیفیت، سوئیچ خودکار به gpt-4o انجام می‌شود",
    },
    keys: {
      configured: openRouterKeyPool.size(),
      availableNow: openRouterKeyPool.availableCount(),
      snapshots: keySnapshots,
      nextKeyFreeInSeconds: Math.ceil((openRouterKeyPool.nextAvailableInMs() ?? 0) / 1000),
      callsSinceStart: openRouterKeyPool.totals(),
      envNames: ["OPENROUTER_API_KEY", "OPENROUTER_API_KEY_2", "OPENROUTER_API_KEY_3"],
    },
    credit: {
      initial: creditInfo.initial,
      remaining: creditInfo.remaining,
      spent: creditInfo.spent,
      percentRemaining: creditInfo.percentRemaining,
      status: creditInfo.status,
      warningMessage: creditInfo.warningMessage,
      totalInputTokens: creditInfo.totalInputTokens,
      totalOutputTokens: creditInfo.totalOutputTokens,
      requestCount: creditInfo.requestCount,
      byModel: creditInfo.byModel,
      lastRequest: creditInfo.lastRequest,
      thresholds: {
        warning: 15,
        critical: 5,
        warningMessage: "⚠️ اعتبار API به پایان خود نزدیک است (باقی‌مانده: $X). لطفاً جهت جلوگیری از قطعی سرویس نسبت به شارژ اقدام کنید.",
        criticalMessage: "🚨 اعتبار API بحرانی است (باقی‌مانده: $X). سرویس به زودی قطع خواهد شد!",
      },
      display: `Credit: $${creditInfo.remaining.toFixed(2)} / $${creditInfo.initial.toFixed(2)}`,
    },
    hints: [] as string[],
  };

  if (openRouterKeyPool.size() === 0) {
    payload.hints.push("هیچ کلید OpenRouter تنظیم نشده است؛ چت متنی و تحلیل تصویر کار نخواهد کرد. OPENROUTER_API_KEY را در .env.local اضافه کنید.");
  } else if (openRouterKeyPool.size() < 2) {
    payload.hints.push(`فقط ${openRouterKeyPool.size()} کلید OpenRouter تنظیم شده؛ برای پایداری بیشتر تا ۳ کلید اضافه کنید (OPENROUTER_API_KEY_2, _3).`);
  }

  if (creditInfo.status === 'warning') {
    payload.hints.push(`⚠️ اعتبار API به ${creditInfo.percentRemaining.toFixed(1)}% رسیده است ($${creditInfo.remaining.toFixed(2)} باقی‌مانده). لطفاً شارژ کنید.`);
  } else if (creditInfo.status === 'critical') {
    payload.hints.push(`🚨 اعتبار API بحرانی است! فقط $${creditInfo.remaining.toFixed(2)} باقی‌مانده (${creditInfo.percentRemaining.toFixed(1)}%). سرویس در آستانه قطعی است.`);
  } else if (creditInfo.status === 'depleted') {
    payload.hints.push(`⛔ اعتبار API تمام شده است! سرویس هوش مصنوعی قطع خواهد شد. لطفاً فوراً شارژ کنید.`);
  }

  if (creditInfo.requestCount > 0) {
    const avgCost = creditInfo.spent / creditInfo.requestCount;
    payload.hints.push(`میانگین هزینه هر درخواست: $${avgCost.toFixed(4)} | مجموع درخواست‌ها: ${creditInfo.requestCount} | توکن‌های مصرفی: ${creditInfo.totalInputTokens + creditInfo.totalOutputTokens}`);
  }

  payload.hints.push(
    "معماری جدید: متن → DeepSeek Chat (deepseek-chat) و تصویر → GPT-4o-mini با fallback به GPT-4o از طریق Bluesminds API",
  );

  return NextResponse.json(payload, {
    status: payload.ok ? 200 : creditInfo.status === 'depleted' ? 402 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
