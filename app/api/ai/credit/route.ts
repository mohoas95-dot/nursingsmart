import { NextRequest, NextResponse } from "next/server";

/**
 * /api/ai/credit — منسوخ شده در معماری ۲۰۲۶
 *
 * سیستم اعتبار ۱۰۰ دلاری کاملاً حذف شده است (طبق درخواست کارفرما).
 * هزینه‌ها مستقیماً در کنسول Google AI Studio مدیریت می‌شود.
 *
 * این مسیر برای جلوگیری از شکست کلاینت‌های قدیمی، پاسخ 410 برمی‌گرداند.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      deprecated: true,
      message: "سیستم اعتبار ۱۰۰ دلاری حذف شده است. در معماری جدید (Gemini Direct) مدیریت هزینه در کنسول گوگل انجام می‌شود.",
      credit: null,
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function POST(req: NextRequest) {
  return NextResponse.json(
    {
      ok: false,
      deprecated: true,
      error: "این endpoint منسوخ شده است. سیستم اعتبار ۱۰۰ دلاری حذف شده و دیگر قابل شارژ نیست.",
    },
    { status: 410 },
  );
}
