import { Type } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { generateContentWithRetry, getGeminiClient, ModelBusyError, ModelConfigurationError, ModelTimeoutError } from "@/lib/gemini";

// Node runtime + generous ceiling: the retry/fallback logic in lib/gemini.ts
// keeps its own (shorter) budget, so we always answer before Vercel kills us.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { text, year, month } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "متن درخواست نمی‌تواند خالی باشد." }, { status: 400 });
    }

    const ai = getGeminiClient();

    const systemPrompt = `
You are an expert bilingual AI assistant for a Persian hospital nursing scheduling system.
Your job is to read a conversational scheduling request from a nurse (in Persian or English) and parse it into an array of structured request objects.

CONTEXT:
- The target Persian month is: Month number ${month} of Year ${year}.
- The weekdays and calendar dates refer to this specific month.

RULES FOR PARSING:
1. "M" = Morning (صبح), "E" = Afternoon (عصر), "N" = Night (شب), "ME" = Morning-Afternoon (عصر-صبح), "EN" = Afternoon-Night (شب-عصر), "MN" = Night-Morning (شب-صبح), "MEN" = Whole day (ترکیبی کل روز).
2. Persian shift slang — map instantly, never ignore or misread them:
   - «عصر و شب» / «عصر-شب» -> EN
   - «لانگ» / «شیفت لانگ» -> ME
   - «۲۴» / «24» / «۲۴ ساعته» / «شیفت ۲۴» -> MEN
   - «صبح تک» -> M، «عصر تک» -> E، «شب تک» -> N
3. MULTI-REQUEST: one message often holds several requests; extract ALL of them as separate array items, never only the first.
4. If request is NOT TO BE in a shift (e.g. "در تاریخ... شیفت... نباشم"), map:
   - requestType = "avoid_shift"
   - preferredShift = the shift to avoid (e.g., "M", "E", "N", "ME", "EN")
5. If request is to be assigned a shift (e.g. "در تاریخ... شیفت... باشم"), map:
   - requestType = "shift"
   - preferredShift = the desired shift (M, E, N, ME, EN, MN, MEN)
6. If request is strict Off/Day off (e.g. "آف باشم", "تعطیل باشم", "کشیک نباشم کل روز"), map:
   - requestType = "OFF"
   - preferredShift = "OFF"
7. If request is for annual leave (e.g. "مرخصی باشم", "استحقاقی"), map:
   - requestType = "leave"
   - preferredShift = "L"
8. Identify the calendar days correctly:
   - "۱۰ام" or "دهم" or "10" -> day 10
   - "شنبه‌ها" -> find Saturday days of the month or just use are of selectedDays.
   - If a range is mentioned e.g., "۱۲ام تا ۱۵ام" -> you can specify scope: "custom_days" and list the selectedDays as [12, 13, 14, 15] or scope: "range" with startDate and endDate. Using scope: "custom_days" is preferred and safest.
   - "روزهای زوج" -> scope: "even"
   - "روزهای فرد" -> scope: "odd"
   - "روزهای زوج هفته" (Saturday, Monday, Wednesday) -> scope: "weekly_even"
   - "روزهای فرد هفته" (Sunday, Tuesday, Thursday) -> scope: "weekly_odd"
   - "کل ماه" / "تمام روزها" -> scope: "all"
   - For specific singular or multiple days (e.g. "روزهای ۳ و ۷ و ۹") -> scope: "custom_days" and selectedDays: [3, 7, 9].

EXAMPLES:
- User: "روزهای ۱۲ و ۱۵ آف قطعی می‌خواهم و روز ۲۰ام شیفت شب باشم"
  Parsed Array:
  [
    { "requestType": "OFF", "preferredShift": "OFF", "scope": "custom_days", "selectedDays": [12, 15], "description": "آف قطعی در روزهای ۱۲ و ۱۵" },
    { "requestType": "shift", "preferredShift": "N", "scope": "custom_days", "selectedDays": [20], "description": "شیفت شب در روز ۲۰" }
  ]

- User: "۲۰ام تا ۲۲ام مرخصی استحقاقی و ۵ام شیفت صبح و عصر نباشم"
  Parsed Array:
  [
    { "requestType": "leave", "preferredShift": "L", "scope": "custom_days", "selectedDays": [20, 21, 22], "description": "مرخصی روزانه از ۲۰ تا ۲۲ دهم" },
    { "requestType": "avoid_shift", "preferredShift": "ME", "scope": "custom_days", "selectedDays": [5], "description": "نبودن در شیفت صبح-عصر (ME) در روز ۵" }
  ]

- User: "۱۲ام لانگ باشم و ۱۸ و ۱۹ عصر و شب نباشم و ۲۵ام شیفت ۲۴ می‌خوام"
  Parsed Array:
  [
    { "requestType": "shift", "preferredShift": "ME", "scope": "custom_days", "selectedDays": [12], "description": "شیفت لانگ (ME) در روز ۱۲" },
    { "requestType": "avoid_shift", "preferredShift": "EN", "scope": "custom_days", "selectedDays": [18, 19], "description": "نبودن در شیفت عصر و شب (EN) در روزهای ۱۸ و ۱۹" },
    { "requestType": "shift", "preferredShift": "MEN", "scope": "custom_days", "selectedDays": [25], "description": "شیفت ۲۴ ساعته (MEN) در روز ۲۵" }
  ]

CRITICAL — NEVER USE PLACEHOLDERS:
  - NEVER set "preferredShift" to "undefined", "null", "?", or any placeholder value.
  - NEVER set "scope" to "undefined" or any placeholder value.
  - NEVER set "selectedDays" to an empty array when scope is "custom_days".
  - For EVERY request, you MUST be able to fill ALL of: requestType, scope, and (if shift/avoid_shift) preferredShift.
  - If a request is genuinely unclear (shift or days cannot be inferred even with reasonable interpretation),
    OMIT it from the array entirely. It is FAR better to return fewer but complete requests
    than to return one with "preferredShift": "undefined".
  - When in doubt about a single ambiguous word, pick the most common interpretation in Iranian
    hospital practice (M for morning صبح, E for عصر, N for شب, ME for لانگ, EN for عصر و شب,
    MEN for ۲۴/24 ساعته, OFF for آف, L for مرخصی).

Respond ONLY with the filled JSON array as defined in the response schema. Keep descriptions neat and in Persian.
`;

    const response = await generateContentWithRetry(ai, {
      contents: text,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0,
        topP: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            requests: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  requestType: {
                    type: Type.STRING,
                    enum: ["shift", "OFF", "leave", "avoid_shift"]
                  },
                  preferredShift: {
                    type: Type.STRING,
                    enum: ["M", "E", "N", "ME", "EN", "MN", "MEN", "OFF", "L"]
                  },
                  scope: {
                    type: Type.STRING,
                    enum: ["all", "even", "odd", "weekly_even", "weekly_odd", "custom_days", "range"]
                  },
                  startDate: { type: Type.STRING },
                  endDate: { type: Type.STRING },
                  selectedDays: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER }
                  },
                  description: { type: Type.STRING }
                },
                required: ["requestType", "scope"]
              }
            }
          },
          required: ["requests"]
        }
      }
    });

    const parsedData = JSON.parse(response.text || "{}");
    const rawRequests = Array.isArray(parsedData.requests) ? parsedData.requests : [];

    // حذف آیتم‌های ناقص: اگر requestType یا scope نامعتبر باشد، یا preferredShift placeholder باشد، حذف شود.
    const PLACEHOLDER_VALUES = new Set([
      "", "undefined", "null", "none", "n/a", "?", "؟", "-", "—", "unknown",
      "نامشخص", "تعریف‌نشده", "نامعلوم", "ندارد",
    ]);
    const isPlaceholder = (v: unknown) => {
      if (v === null || v === undefined) return true;
      if (typeof v !== "string") return false;
      return PLACEHOLDER_VALUES.has(v.trim().toLowerCase());
    };
    const VALID_REQUEST_TYPES = new Set(["shift", "OFF", "leave", "pattern", "avoid_shift"]);
    const VALID_SHIFTS = new Set(["M", "E", "N", "ME", "EN", "MN", "MEN", "OFF", "L"]);
    const VALID_SCOPES = new Set(["all", "even", "odd", "weekly_even", "weekly_odd", "custom_days", "range"]);

    const filteredRequests = rawRequests.filter((item: any) => {
      if (!item || typeof item !== "object") return false;
      if (!VALID_REQUEST_TYPES.has(item.requestType)) return false;
      if (!VALID_SCOPES.has(item.scope)) return false;
      if ((item.requestType === "shift" || item.requestType === "avoid_shift")) {
        if (isPlaceholder(item.preferredShift) || !VALID_SHIFTS.has(item.preferredShift)) return false;
      }
      if (item.scope === "custom_days" && (!Array.isArray(item.selectedDays) || item.selectedDays.length === 0)) {
        return false;
      }
      return true;
    });

    return NextResponse.json({ requests: filteredRequests });
  } catch (error) {
    if (error instanceof ModelBusyError) {
      return NextResponse.json({ error: error.message, retryable: true }, { status: 503 });
    }
    if (error instanceof ModelTimeoutError) {
      return NextResponse.json({ error: error.message, retryable: true }, { status: 504 });
    }
    if (error instanceof ModelConfigurationError) {
      return NextResponse.json({ error: error.message, retryable: false }, { status: 500 });
    }
    console.error("Error parsing smart requests via Gemini API:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "خطای ناشناخته در پردازش هوش مصنوعی" },
      { status: 500 }
    );
  }
}
