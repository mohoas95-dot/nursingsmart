import { Type } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import {
  GEMINI_PROVIDER,
  generateGeminiVision,
  httpStatusForAiError,
  isRetryableAiError,
} from "@/lib/ai";
import { extractJsonObject } from "@/lib/ai/json";
import { normalizeShiftRequestList } from "@/lib/ai/shift-request-normalizer";
import { PERSIAN_VOCABULARY_LESSON } from "@/lib/ai/persian-vocabulary";
import { buildCompactContext, CALENDAR_FORMAT_LEGEND } from "@/lib/ai/compact-context";

/**
 * مسیر تحلیل «تصویر» چت‌باکس — موتور: Google Gemini 2.5 Flash.
 *
 * سیاست معماری:
 *   این مسیر تنها مسیری است که تصویر می‌پذیرد و تنها مسیری است که کلیدهای
 *   Gemini را مصرف می‌کند. پیام‌های متنی هرگز به اینجا نمی‌آیند (سهم Groq).
 *   نتیجه: کریدیت Gemini فقط صرف کاری می‌شود که واقعاً به بینایی نیاز دارد.
 *
 * حریم خصوصی و حافظه:
 *   - تصویر به‌صورت base64 در بدنهٔ JSON می‌آید و به‌شکل inlineData (در حافظه)
 *     به Gemini داده می‌شود؛ هیچ‌گاه روی دیسک نوشته نمی‌شود.
 *   - همهٔ ارجاع‌ها به بافر در پایان تابع پاک‌سازی (best-effort) می‌شوند.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

/** حداکثر حجم تصویر قابل قبول (۸ مگابایت) پس از base64-decode. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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

function purgeBuffer(buffer: Uint8Array | null) {
  if (!buffer) return;
  try {
    buffer.fill(0);
  } catch {
    // best-effort
  }
}

export async function POST(req: NextRequest) {
  let imageBuffer: Uint8Array | null = null;
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return badRequest("بدنهٔ درخواست نامعتبر است.");
    }

    const { image, mimeType, year, month, personnel, calendarDays, existingRequests, scheduleHistory, note } =
      body as {
        image?: string;
        mimeType?: string;
        year?: number;
        month?: number;
        personnel?: { firstName?: string; lastName?: string; jobGroup?: string; workRoutine?: string };
        calendarDays?: Array<{
          day: number;
          dayOfWeek: number;
          weekdayName: string;
          isHoliday: boolean;
          holidayTitle?: string;
        }>;
        existingRequests?: unknown[];
        scheduleHistory?: unknown[];
        note?: string;
      };

    if (typeof image !== "string" || image.length === 0) {
      return badRequest("تصویری ارسال نشده است.");
    }

    const normalizedMime = (typeof mimeType === "string" ? mimeType : "image/jpeg").toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
      return badRequest(`فرمت تصویر پشتیبانی نمی‌شود (${normalizedMime}). فقط JPG, PNG, WebP, HEIC مجاز است.`);
    }

    const base64Payload = image.includes(",") ? image.split(",").pop() || "" : image;
    if (!base64Payload || !/^[A-Za-z0-9+/=\s]+$/.test(base64Payload)) {
      return badRequest("تصویر ارسالی base64 معتبر نیست.");
    }

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

    const systemPrompt = `
You are an expert bilingual (Persian + English) AI assistant specialized in reading images of Persian/English nurse shift-request notes (handwritten, typed, screenshots of chat messages, or photos of paper forms) and converting them into structured data.

TASK:
You receive an image sent by a nurse inside a hospital scheduling chat box. The image contains one or more shift requests for a specific Persian calendar month, most often written in Persian. Read ALL Persian text in the image carefully — including handwriting — interpret it, and respond with a single JSON object containing an array of structured request objects.

The text typically mixes Persian and English, may use abbreviations, casual language, or Persian numerals (e.g. "۱۰", "۲۰"). Common shorthand:
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
A single image usually holds SEVERAL requests. Extract ALL of them as separate array items — never only the first.

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
  - Only mark status="illegible" when NOTHING in the image can be read.
  - When the handwriting is ambiguous, pick the most common interpretation in Iranian hospital practice and proceed.
  - Persian numerals (۰-۹) MUST be converted to Latin (0-9) in selectedDays / dates.
  - "isEssential" is true ONLY if the text clearly says «ضروری / اجباری / قطعی / حتماً / خیلی مهم».
  - "offHardness" is "hard" for «قطعی / اجباری», "soft" for «ترجیحاً / اگه شد».
  - "description" must be a short Persian recap, 5–15 words, suitable for showing back to the user.
  - "reply" must be a WARM, friendly, human Persian sentence telling the user what you read from the image —
    like a kind colleague, not a machine. Address them by first name if provided, and you may use one light emoji.
    ✅ Good: «خوندمش مریم جان 🙂 آف رو برای تاریخ‌های ۱۰اُم و ۱۲اُم و شیفت ۲۴ رو برای ۲۰اُم برداشت کردم.»
    ❌ Bad:  «تصویر پردازش شد. ۲ درخواست استخراج گردید.»
${PERSIAN_VOCABULARY_LESSON}

NEVER RETURN UNDEFINED OR BLANK FIELDS (CRITICAL):
  - NEVER use the string "undefined", "null", "?", or any placeholder for shift/scope/days.
  - For EACH request, you MUST be able to fill ALL of: requestType, scope, and (if shift/avoid_shift) preferredShift.
  - If you genuinely cannot determine a shift or scope, OMIT that request entirely from the array
    and add a Persian warning like "درخواست ناخوانا حذف شد" to the "warnings" array instead.
  - It is FAR better to return 2 confident requests + 1 warning than 3 requests where one has
    "preferredShift": "undefined" or an empty selectedDays.

OUTPUT RULES (CRITICAL):
Respond ONLY with a JSON object matching the response schema. Do not write any prose outside the JSON.
`;

    // زمینهٔ فشرده (نه JSON خام) — تصویر خودش گران است، پس متن همراهش
    // باید تا حد ممکن کم‌حجم باشد تا سهمیهٔ توکن هدر نرود.
    const compactContext = buildCompactContext({
      year: Number(year),
      month: Number(month),
      totalDays,
      personnel,
      calendarDays,
      existingRequests: existingRequests as never,
      scheduleHistory: scheduleHistory as never,
      note: typeof note === "string" ? note : undefined,
    });

    const { response, model, keyLabel } = await generateGeminiVision({
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "CONTEXT:\n" +
                compactContext +
                "\n\n" + CALENDAR_FORMAT_LEGEND +
                "\n\nRead the Persian text in the attached image and respond with the requested JSON object.",
            },
            {
              inlineData: {
                mimeType: normalizedMime,
                data: base64Payload,
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
            reply: { type: Type.STRING },
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

    const parsed = extractJsonObject<{
      status?: unknown;
      reply?: unknown;
      warnings?: unknown;
      requests?: unknown;
    }>(response.text) || {};

    const status = typeof parsed.status === "string" && ["ready", "clarification", "illegible"].includes(parsed.status)
      ? parsed.status
      : "ready";

    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item: unknown): item is string => typeof item === "string")
      : [];

    const { requests, droppedCount } = normalizeShiftRequestList(parsed.requests, totalDays);
    if (droppedCount > 0) {
      warnings.push(`${droppedCount} مورد ناخوانا یا ناقص از نتیجه حذف شد.`);
    }

    return NextResponse.json({
      status,
      reply: typeof parsed.reply === "string" ? parsed.reply : "",
      warnings,
      requests,
      engine: { provider: GEMINI_PROVIDER, model, key: keyLabel },
    });
  } catch (error) {
    const status = httpStatusForAiError(error);
    if (status !== 500) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "خطای هوش مصنوعی",
          retryable: isRetryableAiError(error),
          provider: GEMINI_PROVIDER,
        },
        { status },
      );
    }
    console.error("Error parsing image request via Gemini:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "خطای ناشناخته در پردازش تصویر" },
      { status: 500 },
    );
  } finally {
    purgeBuffer(imageBuffer);
    imageBuffer = null;
  }
}
