import { NextRequest, NextResponse } from "next/server";
import {
  getCreditDisplayInfo,
  getCreditState,
  resetCredit,
  addCredit,
  getCreditStatusLevel,
} from "@/lib/ai/credit";

/**
 * GET /api/ai/credit
 * وضعیت اعتبار ۱۰۰ دلاری را برمی‌گرداند — برای UI سرپرستار
 *
 * پاسخ شامل:
 * - Credit: $84.50 / $100
 * - هشدار زرد < $15
 * - هشدار قرمز < $5
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
        thresholds: {
          warning: 15,
          critical: 5,
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
 * برای شارژ اعتبار یا ریست — فقط برای تست و مدیریت
 * body: { action: "add" | "reset", amount?: number }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "بدنه نامعتبر" }, { status: 400 });
    }

    const action = (body as any).action as string;
    const amount = Number((body as any).amount);

    if (action === "reset") {
      const newAmount = Number.isFinite(amount) && amount > 0 ? amount : 100;
      const state = resetCredit(newAmount);
      return NextResponse.json({
        ok: true,
        message: `اعتبار به $${newAmount.toFixed(2)} ریست شد.`,
        credit: getCreditDisplayInfo(),
      });
    }

    if (action === "add") {
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: "مبلغ شارژ معتبر نیست." }, { status: 400 });
      }
      const state = addCredit(amount);
      return NextResponse.json({
        ok: true,
        message: `$${amount.toFixed(2)} به اعتبار اضافه شد.`,
        credit: getCreditDisplayInfo(),
      });
    }

    return NextResponse.json({ error: "action نامعتبر (add | reset)" }, { status: 400 });
  } catch (error) {
    console.error("Error in credit API:", error);
    return NextResponse.json({ error: "خطای داخلی" }, { status: 500 });
  }
}
