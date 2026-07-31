import { NextResponse } from "next/server";
import {
  PUTER_MODEL,
  PUTER_PROVIDER,
  PUTER_VISION_MODEL,
  getPuterModelChain,
  getPuterVisionModelChain,
  puterKeyPool,
} from "@/lib/ai";

/**
 * مسیر تشخیصی سلامت هوش مصنوعی.
 *
 * برای پاسخ به این سؤال ساخته شده است: «آیا توکن‌های Puter در Vercel درست
 * نشسته‌اند؟» هیچ‌گاه مقدار توکن‌ها را برنمی‌گرداند — فقط تعداد، وضعیت سلامت
 * و چهار رقم آخر به‌صورت ماسک‌شده.
 *
 * نمونهٔ استفاده:  GET /api/ai/health
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const keys = puterKeyPool.snapshot();

  const payload = {
    ok: keys.length > 0,
    checkedAt: new Date().toISOString(),
    puter: {
      provider: PUTER_PROVIDER,
      role: "تحلیل پیام‌های متنی و تصویری چت‌باکس (Puter.js)",
      textModel: PUTER_MODEL,
      textModelChain: getPuterModelChain(),
      visionModel: PUTER_VISION_MODEL,
      visionModelChain: getPuterVisionModelChain(),
      tokensConfigured: puterKeyPool.size(),
      tokensAvailableNow: puterKeyPool.availableCount(),
      // شمارش واقعی فراخوانی‌ها از زمان آخرین راه‌اندازی این نمونه.
      callsSinceStart: puterKeyPool.totals(),
      nextTokenFreeInSeconds: Math.ceil((puterKeyPool.nextAvailableInMs() ?? 0) / 1000),
      keys,
      envNames: ["PUTER_AUTH_TOKEN", "PUTER_AUTH_TOKEN_2", "PUTER_AUTH_TOKEN_3"],
    },
    hints: [] as string[],
  };

  if (puterKeyPool.size() === 0) {
    payload.hints.push(
      "هیچ توکن Puter تنظیم نشده است؛ چت‌باکس کار نخواهد کرد. PUTER_AUTH_TOKEN را در Vercel اضافه کنید (از puter.com/dashboard#account → API token → Create token).",
    );
  } else if (puterKeyPool.size() < 2) {
    payload.hints.push(
      `فقط ${puterKeyPool.size()} توکن Puter تنظیم شده؛ برای پایداری و سهمیهٔ بیشتر، توکن حساب‌های دیگر را هم به‌عنوان PUTER_AUTH_TOKEN_2 / _3 اضافه کنید.`,
    );
  }

  // ⚠️ نکتهٔ حیاتی: هر توکن Puter به یک حساب Puter تعلق دارد. چند توکن فقط
  // وقتی سهمیه را چند برابر می‌کند که هر کدام از یک حساب Puter جداگانه باشد.
  if (puterKeyPool.size() > 1) {
    payload.hints.push(
      "یادآوری: سهمیهٔ رایگان ماهانهٔ Puter در سطح حساب کاربری حساب می‌شود. برای چند برابر شدن واقعی سهمیه، هر توکن باید از یک حساب Puter جدا باشد.",
    );
  }

  return NextResponse.json(payload, {
    status: payload.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
