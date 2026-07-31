import { NextRequest, NextResponse } from "next/server";
import {
  getCreditDisplayInfo,
  applyCreditAction,
  WARNING_THRESHOLD_USD,
  CRITICAL_THRESHOLD_USD,
} from "@/lib/ai/credit";

/**
 * GET /api/ai/credit
 * وضعیت اعتبار ۱۰۰ دلاری را برمی‌گرداند — برای UI سرپرستار
 *
 * پاسخ شامل:
 * - Credit: $84.50 / $100
 * - هشدار زرد < $15
 * - هشدار قرمز < $5
 * - لاگ آخرین درخواست‌ها (مدل، توکن ورودی/خروجی، هزینه به دلار)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const creditInfo = getCreditDisplayInfo();

  // تعیین سطح هشدار برای UI
  const alertLevel = creditInfo.status; // ok | warning | critical | depleted
  const isWarning = alertLevel === 'warning';
  const isCritical = alertLevel === 'critical' || alertLevel === 'depleted';

  return NextResponse.json(
    {
      ok: alertLevel !== 'depleted',
      credit: {
        initial: creditInfo.initial,
        remaining: creditInfo.remaining,
        spent: creditInfo.spent,
        percentRemaining: creditInfo.percentRemaining,
        display: `Credit: $${creditInfo.remaining.toFixed(2)} / $${creditInfo.initial.toFixed(2)}`,
        status: creditInfo.status,
        alertLevel,
        isWarning,
        isCritical,
        warningMessage: creditInfo.warningMessage,
        totalInputTokens: creditInfo.totalInputTokens,
        totalOutputTokens: creditInfo.totalOutputTokens,
        requestCount: creditInfo.requestCount,
        byModel: creditInfo.byModel,
        lastRequest: creditInfo.lastRequest,
        logs: creditInfo.logs,
        thresholds: {
          warning: WARNING_THRESHOLD_USD,
          critical: CRITICAL_THRESHOLD_USD,
        },
        messages: {
          warning: `⚠️ اعتبار API به پایان خود نزدیک است (باقی‌مانده: $${creditInfo.remaining.toFixed(2)}). لطفاً جهت جلوگیری از قطعی سرویس نسبت به شارژ اقدام کنید.`,
          critical: `🚨 اعتبار API بحرانی است (باقی‌مانده: $${creditInfo.remaining.toFixed(2)}). سرویس به زودی قطع خواهد شد! لطفاً فوراً نسبت به شارژ اقدام کنید.`,
        },
      },
      timestamp: new Date().toISOString(),
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  );
}

/**
 * POST /api/ai/credit
 * مدیریت اعتبار — شارژ مجدد / افزودن / ریست
 *
 * بدنهٔ موردنظر دکمهٔ «شارژ مجدد ۱۰۰ دلار»:
 *   { "action": "recharge", "amount": 100 }
 *
 * رفتار:
 *   - recharge: اعتبار باقی‌مانده را دوباره به `amount` (پیش‌فرض ۱۰۰) بازمی‌گرداند
 *     و وضعیت بنرهای هشدار زرد/قرمز را به «عادی» ریست می‌کند.
 *   - add: مبلغی به اعتبار فعلی اضافه می‌کند (برای سازگاری).
 *   - reset: کل state را به `amount` ریست می‌کند (برای تست).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "بدنه نامعتبر" }, { status: 400 });
    }

    const action = String((body as { action?: unknown }).action || "").trim();
    const amount = (body as { amount?: unknown }).amount;

    const result = applyCreditAction(action, amount);

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.statusCode });
    }

    return NextResponse.json({
      ok: true,
      message: result.message,
      credit: result.credit,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error in credit API:", error);
    return NextResponse.json({ error: "خطای داخلی" }, { status: 500 });
  }
}
