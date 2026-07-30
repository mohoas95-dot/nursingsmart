import { NextResponse } from "next/server";
import {
  GEMINI_PROVIDER,
  GEMINI_VISION_MODEL,
  GROQ_MODEL,
  GROQ_PROVIDER,
  geminiKeyPool,
  getGeminiVisionModelChain,
  getGroqModelChain,
  groqKeyPool,
} from "@/lib/ai";

/**
 * مسیر تشخیصی سلامت هوش مصنوعی.
 *
 * برای پاسخ به این سؤال ساخته شده است: «آیا کلیدهایم در Vercel درست نشسته‌اند؟»
 * هیچ‌گاه مقدار کلیدها را برنمی‌گرداند — فقط تعداد، وضعیت سلامت و چهار رقم آخر
 * به‌صورت ماسک‌شده.
 *
 * نمونهٔ استفاده:  GET /api/ai/health
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const groqKeys = groqKeyPool.snapshot();
  const geminiKeys = geminiKeyPool.snapshot();

  const payload = {
    ok: groqKeys.length > 0 && geminiKeys.length > 0,
    checkedAt: new Date().toISOString(),
    text: {
      provider: GROQ_PROVIDER,
      role: "تحلیل پیام‌های متنی چت‌باکس",
      primaryModel: GROQ_MODEL,
      modelChain: getGroqModelChain(),
      keysConfigured: groqKeyPool.size(),
      keysAvailableNow: groqKeyPool.availableCount(),
      keys: groqKeys,
      envNames: ["GROQ_API_KEY", "GROQ_API_KEY_2", "GROQ_API_KEY_3"],
    },
    vision: {
      provider: GEMINI_PROVIDER,
      role: "تحلیل تصاویر ارسالی در چت‌باکس (OCR فارسی)",
      primaryModel: GEMINI_VISION_MODEL,
      modelChain: getGeminiVisionModelChain(),
      keysConfigured: geminiKeyPool.size(),
      keysAvailableNow: geminiKeyPool.availableCount(),
      keys: geminiKeys,
      envNames: ["GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3"],
    },
    hints: [] as string[],
  };

  if (groqKeyPool.size() === 0) {
    payload.hints.push("هیچ کلید Groq تنظیم نشده است؛ چت متنی کار نخواهد کرد. GROQ_API_KEY را در Vercel اضافه کنید.");
  } else if (groqKeyPool.size() < 3) {
    payload.hints.push(`فقط ${groqKeyPool.size()} کلید Groq تنظیم شده؛ برای پایداری بیشتر تا ۳ کلید اضافه کنید.`);
  }

  if (geminiKeyPool.size() === 0) {
    payload.hints.push("هیچ کلید Gemini تنظیم نشده است؛ تحلیل تصویر کار نخواهد کرد. GEMINI_API_KEY را در Vercel اضافه کنید.");
  } else if (geminiKeyPool.size() < 3) {
    payload.hints.push(`فقط ${geminiKeyPool.size()} کلید Gemini تنظیم شده؛ برای پایداری بیشتر تا ۳ کلید اضافه کنید.`);
  }

  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
