import { Type } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { generateContentWithRetry, getGeminiClient, ModelBusyError, ModelTimeoutError } from "@/lib/gemini";

// Node runtime + generous ceiling: the retry/fallback logic in lib/gemini.ts
// keeps its own (shorter) budget, so we always answer before Vercel kills us.
//
// Architectural note (privacy & memory):
//   - The image is delivered as a base64 string in the JSON body of the request.
//   - We hand it to Gemini as `inlineData` (in-memory), NEVER write it to disk.
//   - All references to the buffer (base64 string, Uint8Array, mime) are scoped
//     to this function. The Node runtime garbage-collects them as soon as the
//     function returns; nothing is persisted to storage, log, or trace.
export const runtime = "nodejs";
export const maxDuration = 60;

// حداکثر حجم تصویر قابل قبول (۸ مگابایت) — Base64 تقریباً ۳۳٪ بزرگ‌تر می‌شود؛
// پس از base64-decode اندازهٔ واقعی بررسی می‌شود تا از حافظهٔ سرور سوءاستفاده نشود.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// MIME type های مجاز برای تصویر دست‌نوشته
const ALLOWED_MIME_TYPES = new Set<string>([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function purgeBuffer<T>(buf: T) {
  // Best-effort scrub: برای آرایه‌های عددی (Uint8Array)، همهٔ خانه‌ها را با صفر پر می‌کنیم.
  // این کار قطعی نیست (V8 ممکن است کپی نگه دارد) اما تلاشی است برای پاک‌سازی صریح.
  if (buf && typeof buf === "object" && "fill" in (buf as any) && typeof (buf as any).BYTES_PER_ELEMENT === "number") {
    try {
      (buf as unknown as { fill: (v: number) => void }).fill(0);
    } catch {
      // نادیده بگیر؛ buffer فقط یک تلاش best-effort است
    }
  }
}

export async function POST(req: NextRequest) {
  let imageBuffer: Uint8Array | null = null;
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return badRequest("بدنهٔ درخواست نامعتبر است.");
    }

    const { image, mimeType, year, month, personnel, calendarDays, existingRequests, scheduleHistory } = body as {
      image?: string;
      mimeType?: string;
      year?: number;
      month?: number;
      personnel?: { firstName?: string; lastName?: string; jobGroup?: string; workRoutine?: string };
      calendarDays?: Array<{ day: number; dayOfWeek: number; weekdayName: string; isHoliday: boolean; holidayTitle?: string }>;
      existingRequests?: unknown[];
      scheduleHistory?: unknown[];
    };

    if (typeof image !== "string" || image.length === 0) {
      return badRequest("تصویر دست‌نوشته ارسال نشده است.");
    }

    const normalizedMime = (typeof mimeType === "string" ? mimeType : "image/jpeg").toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
      return badRequest(`فرمت تصویر پشتیبانی نمی‌شود (${normalizedMime}). فقط JPG, PNG, WebP, HEIC مجاز است.`);
    }

    // image دقیقاً همان Data-URL کامل («data:image/png;base64,XYZ») یا فقط بخش
    // base64 خام باشد؛ هر دو پشتیبانی می‌شوند.
    const base64Payload = image.includes(",") ? image.split(",").pop() || "" : image;
    if (!base64Payload || !/^[A-Za-z0-9+/=\s]+$/.test(base64Payload)) {
      return badRequest("تصویر ارسالی base64 معتبر نیست.");
    }

    // base64 → Buffer در حافظهٔ RAM (هیچ فایلی روی دیسک نوشته نمی‌شود)
    imageBuffer = Uint8Array.from(Buffer.from(base64Payload, "base64"));
    if (imageBuffer.byteLength === 0) {
      return badRequest("تصویر ارسالی خالی است.");
    }
    if (imageBuffer.byteLength > MAX_IMAGE_BYTES) {
      purgeBuffer(imageBuffer);
      return badRequest("حجم تصویر بیش از ۸ مگابایت است؛ لطفاً تصویر کوچک‌تری انتخاب کنید.");
    }

    if (!Number.isFinite(Number(year)) || !Number.isFinite(Number(month))) {
      purgeBuffer(imageBuffer);
      return badRequest("ماه و سال درخواست معتبر نیست.");
    }

    const totalDays = Array.isArray(calendarDays) ? calendarDays.length || 31 : 31;

    const ai = getGeminiClient();

    const systemPrompt = `
You are an expert bilingual (Persian + English) AI assistant specialized in reading Persian/English nurse handwritten shift-request notes and converting them into structured data.

TASK:
You receive a photograph of a handwritten note written by a nurse. The note describes one or more shift requests for a specific Persian calendar month. Read the handwriting carefully, interpret it, and respond with a single JSON object that contains an array of structured request objects.

The handwritten note typically contains a mix of Persian and English, may have abbreviations, casual language, or even some numbers in Persian (e.g. "۱۰", "۲۰"). Examples of common shorthand you may see:
  - "صبح", "M"  →  Morning shift
  - "عصر", "E"  →  Afternoon shift
  - "شب", "N"   →  Night shift
  - "لانگ", "ME" →  Morning-Afternoon (long day)
  - "عصر و شب", "EN" →  Afternoon-Night
  - "۲۴", "MEN" →  24-hour whole-day shift
  - "آف", "OFF" →  Day off
  - "مرخصی", "L" →  Leave

CONTEXT FOR THE CURRENT MONTH:
  - Year: ${year}
  - Month: ${month}
  - Month total days: ${totalDays}
  - Weekdays are listed in the provided calendarDays array with their dayOfWeek (0=Saturday ... 6=Friday) and Persian weekday name.
  - If the note says a specific date (e.g. "دهم" or "۱۰ام"), map it to that day-of-month in the current month.
  - If the note says a weekday (e.g. "شنبه‌ها", "پنجشنبه‌ها"), resolve to all matching days in the current month using calendarDays.

REQUEST TYPES (you MUST classify each item into exactly one):
  - "shift"        — the nurse wants to BE ASSIGNED a specific shift on given days.
  - "OFF"          — the nurse wants a Day Off (must be specific days; not vague).
  - "leave"        — annual / sick leave (L).
  - "avoid_shift"  — the nurse wants to NOT be in a specific shift on given days.
  - "pattern"      — a repeating pattern such as [ME, OFF, OFF] or [EN, OFF, OFF].

MULTI-REQUEST HANDLING (CRITICAL):
A single note usually holds SEVERAL requests. Extract ALL of them as separate array items — never only the first.

PREFERRED SHIFT MAPPING:
  - For "shift": preferredShift ∈ {"M","E","N","ME","EN","MN","MEN"}
  - For "OFF":  preferredShift = "OFF"
  - For "leave": preferredShift = "L"
  - For "avoid_shift": preferredShift ∈ {"M","E","N","ME","EN"}

SCOPE MAPPING:
  - "all"             — applies to every day of the month
  - "even"            — even-numbered days of the month
  - "odd"             — odd-numbered days of the month
  - "weekly_even"     — Saturday / Monday / Wednesday (recurring weekdays)
  - "weekly_odd"      — Sunday / Tuesday / Thursday (recurring weekdays)
  - "custom_days"     — specific list of days, put them in "selectedDays" (1..${totalDays})
  - "range"           — startDate and endDate as Persian "YYYY/MM/DD" strings

READING GUIDELINES:
  - Be DECISIVE. If a request is understandable with reasonable interpretation, produce it now.
  - Only ask for clarification if a critical piece (days or shift) is genuinely missing for ALL items.
  - When the handwriting is ambiguous, pick the most common interpretation in Iranian hospital practice and proceed.
  - Persian numerals (۰-۹) MUST be converted to Latin (0-9) in selectedDays / dates.
  - Always return a JSON object with a "requests" array. If the note is illegible, return { "requests": [], "warnings": ["..."] }.
  - "isEssential" is true ONLY if the user clearly writes «ضروری / اجباری / قطعی / حتماً / خیلی مهم».
  - "offHardness" is "hard" for «قطعی / اجباری», "soft" for «ترجیحاً / اگه شد».
  - "description" must be a short Persian recap, 5–15 words, suitable for showing back to the user.

NEVER RETURN UNDEFINED OR BLANK FIELDS (CRITICAL):
  - NEVER use the string "undefined", "null", "?", or any placeholder for shift/scope/days.
  - For EACH request, you MUST be able to fill ALL of: requestType, scope, and (if shift/avoid_shift) preferredShift.
  - If you genuinely cannot determine a shift or scope, OMIT that request entirely from the array
    and add a Persian warning like "درخواست ناخوانا حذف شد" to the "warnings" array instead.
  - It is FAR better to return 2 confident requests + 1 warning than 3 requests where one has
    "preferredShift": "undefined" or an empty selectedDays.
  - When in doubt about a single word in the note, prefer the most common interpretation
    in Iranian hospital practice (M for morning صبح, E for عصر, N for شب, ME for لانگ, EN for عصر و شب,
    MEN for ۲۴/24 ساعته, OFF for آف, L for مرخصی).

OUTPUT RULES (CRITICAL):
Respond ONLY with a JSON object matching the response schema below. Do not write any prose outside the JSON.
`;

    const context = {
      targetMonth: { year, month, totalDays },
      personnel: personnel || null,
      calendarDays: Array.isArray(calendarDays)
        ? calendarDays.map((d: any) => ({
            day: d.day,
            dayOfWeek: d.dayOfWeek,
            weekdayName: d.weekdayName,
            isHoliday: d.isHoliday,
            holidayTitle: d.holidayTitle,
          }))
        : [],
      existingRequests: Array.isArray(existingRequests) ? existingRequests : [],
      scheduleHistory: Array.isArray(scheduleHistory) ? scheduleHistory : [],
    };

    // ارسال تصویر به‌صورت inlineData + متن دستورالعمل.
    // Gemini مدل multi-modal است و خودش OCR + تحلیل را انجام می‌دهد.
    const response = await generateContentWithRetry(ai, {
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "CONTEXT_JSON:\n" +
                JSON.stringify(context) +
                "\n\nRead the handwritten note in the attached image and respond with the requested JSON object.",
            },
            {
              inlineData: {
                mimeType: normalizedMime,
                data: base64Payload, // Gemini SDK خودش base64 را می‌پذیرد
              },
            },
          ],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            status: { type: Type.STRING, enum: ["ready", "clarification", "illegible"] },
            warnings: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            requests: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  requestType: {
                    type: Type.STRING,
                    enum: ["shift", "OFF", "leave", "pattern", "avoid_shift"],
                  },
                  preferredShift: {
                    type: Type.STRING,
                    enum: ["M", "E", "N", "ME", "EN", "MN", "MEN", "OFF", "L"],
                  },
                  patternSteps: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING, enum: ["M", "E", "N", "ME", "EN", "MN", "MEN", "OFF", "L"] },
                  },
                  isEssential: { type: Type.BOOLEAN },
                  offHardness: { type: Type.STRING, enum: ["hard", "soft"] },
                  scope: {
                    type: Type.STRING,
                    enum: ["all", "even", "odd", "weekly_even", "weekly_odd", "custom_days", "range"],
                  },
                  startDate: { type: Type.STRING },
                  endDate: { type: Type.STRING },
                  selectedDays: {
                    type: Type.ARRAY,
                    items: { type: Type.INTEGER },
                  },
                  description: { type: Type.STRING },
                },
                required: ["requestType", "scope"],
              },
            },
          },
          required: ["status", "requests"],
        },
      },
    });

    const parsed = JSON.parse(response.text || "{}");
    const status = ["ready", "clarification", "illegible"].includes(parsed.status) ? parsed.status : "ready";
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((w: unknown) => typeof w === "string")
      : [];
    const rawRequests = Array.isArray(parsed.requests) ? parsed.requests : [];

    // نرمال‌سازی سمت سرور: آیتم‌های ناقص/نامعتبر حذف می‌شوند و warning اضافه می‌شود
    const droppedWarnings: string[] = [];
    const normalizedRequests: any[] = [];
    for (const item of rawRequests) {
      const normalized = normalizeServerSide(item, totalDays);
      if (normalized === null) {
        droppedWarnings.push("یک درخواست ناخوانا یا ناقص از نتیجه حذف شد.");
        continue;
      }
      normalizedRequests.push(normalized);
    }

    return NextResponse.json({
      status,
      warnings: [...warnings, ...droppedWarnings],
      requests: normalizedRequests,
    });
  } catch (error) {
    if (error instanceof ModelBusyError) {
      return NextResponse.json({ error: error.message, retryable: true }, { status: 503 });
    }
    if (error instanceof ModelTimeoutError) {
      return NextResponse.json({ error: error.message, retryable: true }, { status: 504 });
    }
    console.error("Error parsing handwritten shift request:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "خطای ناشناخته در پردازش تصویر دست‌نوشته" },
      { status: 500 }
    );
  } finally {
    // پاک‌سازی صریح بافر تصویر از حافظه (best-effort)
    if (imageBuffer) {
      purgeBuffer(imageBuffer);
      imageBuffer = null;
    }
  }
}

// ---------- کمک‌تابع‌های نرمال‌سازی سمت سرور ----------

// مقادیری که قطعاً نشان‌دهندهٔ «AI نفهمیده» هستند و نباید به فرانت‌اند بروند.
// این لیست شامل جایگزین‌های رایج «undefined»، placeholderها و رشتهٔ خالی است.
const PLACEHOLDER_VALUES = new Set([
  "",
  "undefined",
  "null",
  "none",
  "n/a",
  "?",
  "؟",
  "-",
  "—",
  "unknown",
  "نامشخص",
  "تعریف‌نشده",
  "نامعلوم",
  "ندارد",
]);

function isPlaceholder(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

function normalizeServerSide(raw: any, totalDays: number) {
  if (!raw || typeof raw !== "object") return null;

  const VALID_REQUEST_TYPES = new Set(["shift", "OFF", "leave", "pattern", "avoid_shift"]);
  const VALID_SHIFTS = new Set(["M", "E", "N", "ME", "EN", "MN", "MEN", "OFF", "L"]);
  const VALID_SCOPES = new Set(["all", "even", "odd", "weekly_even", "weekly_odd", "custom_days", "range"]);
  const VALID_OFF_HARDNESS = new Set(["hard", "soft"]);

  const requestType = VALID_REQUEST_TYPES.has(raw.requestType) ? raw.requestType : null;
  if (!requestType) return null;

  const scope = VALID_SCOPES.has(raw.scope) ? raw.scope : null;
  // scope هم حیاتی است؛ اگر نامعتبر بود، آیتم ناقص است و حذف می‌شود
  if (!scope) return null;

  // برای shift/avoid_shift حتماً باید preferredShift معتبر و غیر-placeholder باشد
  let preferredShift: string | undefined;
  if (!isPlaceholder(raw.preferredShift) && VALID_SHIFTS.has(raw.preferredShift)) {
    preferredShift = raw.preferredShift;
  }
  if (requestType === "shift" || requestType === "avoid_shift") {
    if (!preferredShift) return null; // شیفت نامشخص → حذف کل آیتم
  }

  // selectedDays فقط اگر scope = custom_days لازم است؛ در غیر این صورت نباید
  // selectedDays نامعتبر داشته باشیم (مثلاً undefined یا placeholder)
  let selectedDays: number[] | undefined;
  if (Array.isArray(raw.selectedDays)) {
    const filtered = raw.selectedDays
      .map((d: any) => Number(d))
      .filter((d: number) => Number.isInteger(d) && d >= 1 && d <= totalDays);
    const unique = (Array.from(new Set(filtered)) as number[]).sort((a, b) => a - b);
    selectedDays = unique.length > 0 ? unique : undefined;
  }

  // برای scope = custom_days، حتماً باید selectedDays معتبر وجود داشته باشد
  if (scope === "custom_days" && (!selectedDays || selectedDays.length === 0)) {
    return null;
  }

  // برای pattern باید patternSteps معتبر باشد
  const patternSteps = Array.isArray(raw.patternSteps)
    ? raw.patternSteps
        .map((s: any) => String(s || "").trim().toUpperCase())
        .filter((s: string) => VALID_SHIFTS.has(s))
    : undefined;
  if (requestType === "pattern" && (!patternSteps || patternSteps.length === 0)) {
    return null;
  }

  const description = typeof raw.description === "string" && !isPlaceholder(raw.description)
    ? raw.description
    : undefined;

  return {
    requestType,
    preferredShift:
      requestType === "OFF"
        ? "OFF"
        : requestType === "leave"
          ? "L"
          : preferredShift,
    patternSteps: patternSteps && patternSteps.length > 0 ? patternSteps : undefined,
    isEssential: !!raw.isEssential,
    offHardness:
      requestType === "OFF"
        ? VALID_OFF_HARDNESS.has(raw.offHardness)
          ? raw.offHardness
          : "hard"
        : undefined,
    scope,
    startDate: typeof raw.startDate === "string" && !isPlaceholder(raw.startDate)
      ? raw.startDate
      : undefined,
    endDate: typeof raw.endDate === "string" && !isPlaceholder(raw.endDate)
      ? raw.endDate
      : undefined,
    selectedDays: scope === "custom_days" ? selectedDays : undefined,
    description,
  };
}
