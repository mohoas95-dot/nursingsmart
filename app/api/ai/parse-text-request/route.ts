import { NextRequest, NextResponse } from "next/server";
import {
  PUTER_PROVIDER,
  generatePuterJson,
  httpStatusForAiError,
  isRetryableAiError,
} from "@/lib/ai";
import { normalizeShiftRequestList } from "@/lib/ai/shift-request-normalizer";
import { PERSIAN_VOCABULARY_LESSON } from "@/lib/ai/persian-vocabulary";

/**
 * پارس یک‌مرحله‌ای متن درخواست (بدون گفت‌وگو) — موتور: Puter.js.
 *
 * این مسیر برای فرم‌های «متن آزاد» استفاده می‌شود که فقط یک آرایهٔ درخواست
 * می‌خواهند و نیازی به پاسخ محاوره‌ای ندارند.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "بدنهٔ درخواست نامعتبر است." }, { status: 400 });
    }

    const { text, year, month, totalDays: rawTotalDays } = body as {
      text?: unknown;
      year?: unknown;
      month?: unknown;
      totalDays?: unknown;
    };

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "متن درخواست نمی‌تواند خالی باشد." }, { status: 400 });
    }

    const totalDays = Number.isInteger(Number(rawTotalDays)) && Number(rawTotalDays) > 0
      ? Number(rawTotalDays)
      : 31;

    const systemPrompt = `
You are an expert bilingual AI assistant for a Persian hospital nursing scheduling system.
Read a conversational scheduling request from a nurse (Persian or English) and parse it into an array of structured request objects.

CONTEXT:
- Target Persian month: month ${month} of year ${year}, with ${totalDays} days.

RULES FOR PARSING:
1. "M" = صبح, "E" = عصر, "N" = شب, "ME" = صبح-عصر (لانگ), "EN" = عصر-شب, "MN" = شب-صبح, "MEN" = ۲۴ ساعته.
2. Persian shift slang — map instantly:
   - «عصر و شب» / «عصر-شب» → EN
   - «لانگ» / «شیفت لانگ» → ME
   - «۲۴» / «24» / «۲۴ ساعته» → MEN
   - «صبح تک» → M، «عصر تک» → E، «شب تک» → N
3. MULTI-REQUEST: one message often holds several requests; extract ALL of them, never only the first.
4. «شیفت ... نباشم» → requestType="avoid_shift" with preferredShift = the shift to avoid.
5. «شیفت ... باشم» → requestType="shift" with the desired preferredShift.
6. «آف باشم» / «تعطیل باشم» → requestType="OFF", preferredShift="OFF".
7. «مرخصی» / «استحقاقی» → requestType="leave", preferredShift="L".
8. Day resolution:
   - «۱۰ام» / «دهم» / «10» → day 10
   - ranges like «۱۲ام تا ۱۵ام» → scope="custom_days", selectedDays=[12,13,14,15] (preferred and safest)
   - «کل ماه» → scope="all"
   - specific days «۳ و ۷ و ۹» → scope="custom_days", selectedDays=[3,7,9]
   - For odd/even, apply section (A) of the vocabulary lesson below EXACTLY:
     «روزهای فرد»/«روز فرد» → weekly_odd  |  «روزهای زوج»/«روز زوج» → weekly_even
     «تاریخ‌های فرد»/«تاریخ فرد» → odd     |  «تاریخ‌های زوج»/«تاریخ زوج» → even
${PERSIAN_VOCABULARY_LESSON}

CRITICAL — NEVER USE PLACEHOLDERS:
  - NEVER set any field to "undefined", "null", "?" or an empty placeholder.
  - NEVER leave selectedDays empty when scope="custom_days".
  - If a request is genuinely unclear, OMIT it entirely rather than emitting a broken item.

OUTPUT CONTRACT — return EXACTLY one JSON object (no markdown, no prose):
{
  "requests": [
    {
      "requestType": "shift" | "OFF" | "leave" | "avoid_shift" | "pattern",
      "preferredShift": "M" | "E" | "N" | "ME" | "EN" | "MN" | "MEN" | "OFF" | "L",
      "scope": "all" | "even" | "odd" | "weekly_even" | "weekly_odd" | "custom_days" | "range",
      "startDate": string,
      "endDate": string,
      "selectedDays": number[],
      "isEssential": boolean,
      "offHardness": "hard" | "soft",
      "description": string
    }
  ]
}
Use Latin digits inside selectedDays. Keep descriptions short and in Persian.
`;

    const { data, model, keyLabel } = await generatePuterJson<{ requests?: unknown }>({
      systemPrompt,
      messages: [{ role: "user", content: text.slice(0, 4000) }],
    });

    const { requests } = normalizeShiftRequestList(data.requests, totalDays);

    return NextResponse.json({
      requests,
      engine: { provider: PUTER_PROVIDER, model, key: keyLabel },
    });
  } catch (error) {
    const status = httpStatusForAiError(error);
    if (status !== 500) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "خطای هوش مصنوعی",
          retryable: isRetryableAiError(error),
          provider: PUTER_PROVIDER,
        },
        { status },
      );
    }
    console.error("Error parsing smart requests via Puter:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "خطای ناشناخته در پردازش هوش مصنوعی" },
      { status: 500 },
    );
  }
}
