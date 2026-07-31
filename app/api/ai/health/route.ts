import { NextResponse } from "next/server";
import {
  GEMINI_PROVIDER,
  GEMINI_PRIMARY_MODEL,
  GEMINI_FALLBACK_MODEL,
  getGeminiModelChain,
  geminiKeyPool,
} from "@/lib/ai";

/**
 * مسیر تشخیصی سلامت هوش مصنوعی — معماری ۲۰۲۶ Gemini Direct
 *
 * - ۵ کلید Gemini
 * - مدل اصلی gemini-1.5-flash
 * - fallback gemini-1.5-flash فقط در شرایط جدی
 * - بدون سیستم اعتبار ۱۰۰ دلاری (حذف شده)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const keySnapshots = geminiKeyPool.snapshot();

  const payload = {
    ok: geminiKeyPool.size() > 0,
    checkedAt: new Date().toISOString(),
    provider: GEMINI_PROVIDER,
    primaryModel: GEMINI_PRIMARY_MODEL,
    fallbackModel: GEMINI_FALLBACK_MODEL,
    modelChain: getGeminiModelChain(),
    fallbackPolicy: {
      description: "سوئیچ به fallback فقط در صورت: زمان تحلیل بسیار طولانی، مفاهیم نامفهوم، سرور شلوغ، مشکلات جدی مدل اصلی",
      forbiddenQuickSwitch: true,
      primaryMustExhaustAllKeysFirst: true,
      requiredKeys: 5,
    },
    keys: {
      configured: geminiKeyPool.size(),
      required: 5,
      availableNow: geminiKeyPool.availableCount(),
      snapshots: keySnapshots,
      nextKeyFreeInSeconds: Math.ceil((geminiKeyPool.nextAvailableInMs() ?? 0) / 1000),
      callsSinceStart: geminiKeyPool.totals(),
      envNames: [
        "GEMINI_API_KEY",
        "GEMINI_API_KEY_2",
        "GEMINI_API_KEY_3",
        "GEMINI_API_KEY_4",
        "GEMINI_API_KEY_5",
        "GEMINI_API_KEYS (comma separated)",
      ],
      quotaHandling: "اگر یک کلید به سقف روزانه خورد، بی‌معطلی به کلید بعدی می‌رود. اگر همه تمام شدند، مدت انتظار به کاربر نشان داده می‌شود.",
    },
    hints: [] as string[],
  };

  if (geminiKeyPool.size() === 0) {
    payload.hints.push("هیچ کلید Gemini تنظیم نشده است؛ چت و تحلیل تصویر کار نخواهد کرد. در Vercel متغیرهای GEMINI_API_KEY تا GEMINI_API_KEY_5 را اضافه کنید.");
  } else if (geminiKeyPool.size() < 5) {
    payload.hints.push(`فقط ${geminiKeyPool.size()} کلید Gemini تنظیم شده؛ برای پایداری کامل ۵ کلید اضافه کنید (GEMINI_API_KEY_2 تا _5).`);
  }

  if (geminiKeyPool.size() >= 5) {
    payload.hints.push("۵ کلید Gemini فعال است — بیشترین پایداری ممکن.");
  }

  payload.hints.push(
    `معماری ۲۰۲۶: تمام تحلیل‌ها (متن و تصویر) با ${GEMINI_PRIMARY_MODEL} انجام می‌شود؛ در صورت مشکل جدی خودکار به ${GEMINI_FALLBACK_MODEL} سوئیچ می‌شود.`,
  );
  payload.hints.push("سیستم اعتبار ۱۰۰ دلاری حذف شده است؛ مدیریت هزینه مستقیماً در کنسول Google AI Studio انجام می‌شود.");

  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
