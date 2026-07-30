import { NextRequest, NextResponse } from "next/server";
import {
  generateGroqJson,
  GROQ_PROVIDER,
  httpStatusForAiError,
  isRetryableAiError,
  type GroqMessage,
} from "@/lib/ai";
import {
  GROQ_JSON_CONTRACT,
  normalizeShiftRequestList,
} from "@/lib/ai/shift-request-normalizer";

/**
 * مسیر گفت‌وگوی متنی چت‌باکس — موتور: Groq (Llama 3.3 70B).
 *
 * سیاست معماری:
 *   این مسیر فقط و فقط پیام‌های «متنی» را پردازش می‌کند. هیچ تصویری اینجا
 *   پذیرفته نمی‌شود؛ تصاویر به /api/ai/parse-image-request (Gemini) می‌روند.
 *   بنابراین سهمیهٔ Groq هرگز صرف OCR نمی‌شود و بالعکس.
 *
 * پایداری:
 *   lib/ai/groq.ts خودش بین ۳ کلید و زنجیرهٔ مدل می‌چرخد و بودجهٔ زمانی
 *   داخلی (۴۲ ثانیه) کمتر از maxDuration است، پس این مسیر همیشه یک پاسخ
 *   JSON تمیز برمی‌گرداند و چت‌باکس هرگز معلق نمی‌ماند.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

type ChatRole = "assistant" | "user";

type IncomingChatMessage = {
  role: ChatRole;
  content: string;
};

const SYSTEM_PROMPT = `
You are a warm Persian chat assistant for a hospital nursing scheduling app.
Speak conversational Persian, friendly and concise. The user is a nurse/personnel. If a first name is provided, greet and refer to them naturally by first name.

Your goal is to turn natural Persian scheduling conversations into clean structured shift requests.
BE DECISIVE — never interrogate the user with repeated questions.
- If the request is understandable with a reasonable interpretation, produce it NOW with status="ready" and briefly mention your assumption in reply/summary (e.g. «منظورت ... بود؟»).
- Ask at most ONE short clarifying question, and only when a truly critical piece is missing (e.g. no days/dates at all, or a shift that cannot be mapped even with the slang rules below). In that case set status="clarification" with an empty requests array.
- Always answer the actionable part of a message first; never block everything just because one detail is fuzzy.
If the user is venting, tired, or sharing personal context, respond empathetically and suggest practical request wording; only create requests when the user clearly asks for them.
Never promise that requests will definitely be approved. Say they will be registered and the final schedule depends on ward coverage, crowding, limits, and head-nurse decisions.

PERSIAN SHIFT SLANG (CRITICAL — map these instantly, never ask what they mean):
- «عصر و شب» / «عصر-شب» / «عصرشب» = EN
- «لانگ» / «لانگ شیفت» / «شیفت لانگ» = ME
- «۲۴» / «24» / «۲۴ ساعته» / «24 ساعته» / «شیفت ۲۴» = MEN
- «صبح تک» = M، «عصر تک» = E، «شب تک» = N (شیفت تکی همان بازه)

MULTI-REQUEST ANALYSIS (CRITICAL):
- A single message usually contains SEVERAL requests. Extract ALL of them into separate request items — never process just the first one.
- Example: «دهم و دوازدهم آف، بیستم شب تک، پنجشنبه‌ها لانگ» → three requests: OFF on days [10,12], shift N on day [20], shift ME on Thursdays.
- All extracted items must appear together in the requests array so the user sees every request in the results panel at once.

SUPPORTED REQUEST STRUCTURE:
- requestType: "shift", "OFF", "leave", "pattern", "avoid_shift"
- preferredShift for shift/avoid_shift: "M", "E", "N", "ME", "EN", "MN", "MEN"
- preferredShift for OFF: "OFF"
- preferredShift for leave: "L"
- patternSteps for pattern requests: array of shift codes such as ["ME", "OFF"] or ["EN", "OFF", "OFF"]
- scope: "all", "even", "odd", "weekly_even", "weekly_odd", "custom_days", "range"
- weekly_even means Saturday/Monday/Wednesday only; weekly_odd means Sunday/Tuesday/Thursday only; Friday is excluded from weekly_even/weekly_odd.
- selectedDays is preferred for specific dates, date ranges, and weekdays after resolving against the supplied calendar.
- isEssential=true only when the user clearly says اجباری، ضروری، خیلی مهم، حتماً، قطعی, or equivalent.
- offHardness: for OFF, use "hard" for قطعی/اجباری/مرخصی‌مانند, "soft" for ترجیحاً/اگه شد.

UNDERSTANDING REQUIREMENTS:
- Detect dates, weekdays, shift types, OFF, leave, avoidance/non-presence, preferences, constraints, mandatory requests, multiple requests in one text.
- If the user says they work shifts in another hospital and wants the opposite here, convert the outside-hospital shifts into avoid_shift requests for this hospital when dates and shift types are clear.
- Use scheduleHistory to infer likely routine/pattern only as a suggestion in reply. Do not fabricate a final structured pattern unless the user confirms or clearly asks for it.
- Use existingRequests to warn if the new request seems excessive or conflicting, but do not refuse; explain no guarantee.

status meanings:
- "ready": clean requests are extracted and ready for user confirmation.
- "clarification": ask AT MOST one question because a critical detail (dates/shift) is genuinely missing; requests must be [].
- "chat": supportive or advisory answer with no final requests yet.
reply should be what the chat bubble says to the user.
summary should be a compact Persian recap starting with or suitable after "منظور شما این است؟" when status="ready".

SYNC RULE (CRITICAL — reply/summary must match requests EXACTLY):
- AFTER building the requests array, write reply and summary FROM that exact array — treat the array as the only source of truth.
- Mention EVERY item of requests in reply/summary, one short clause per item (e.g. «صبح تک در روزهای غیرتعطیل»، «۲۴ ساعته برای ۱۳ مرداد»، «آف در مابقی تعطیلات»).
- NEVER announce a request, pattern or shift in reply/summary that is NOT present in the requests array. If something cannot be expressed as a structured item, leave it out of the spoken summary too (you may mention it only as a caveat in warnings).
- If you produce 3 items, describe 3 items; if 1, describe 1. What the assistant says must equal what the user sees in the analysis panel.
${GROQ_JSON_CONTRACT}
`;

interface GroqChatPayload {
  status?: unknown;
  reply?: unknown;
  summary?: unknown;
  warnings?: unknown;
  questions?: unknown;
  requests?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "بدنهٔ درخواست نامعتبر است." }, { status: 400 });
    }

    const messages = Array.isArray(body.messages) ? (body.messages as IncomingChatMessage[]) : [];
    const year = Number(body.year);
    const month = Number(body.month);
    const personnel = body.personnel || {};
    const calendarDays = Array.isArray(body.calendarDays) ? body.calendarDays : [];
    const existingRequests = Array.isArray(body.existingRequests) ? body.existingRequests : [];
    const scheduleHistory = Array.isArray(body.scheduleHistory) ? body.scheduleHistory : [];

    const lastUserMessage = [...messages]
      .reverse()
      .find(message => message.role === "user")
      ?.content?.trim();
    if (!lastUserMessage) {
      return NextResponse.json({ error: "متن پیام نمی‌تواند خالی باشد." }, { status: 400 });
    }
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      return NextResponse.json({ error: "ماه و سال درخواست معتبر نیست." }, { status: 400 });
    }

    const totalDays = calendarDays.length || 31;

    const context = {
      targetMonth: { year, month, totalDays },
      personnel: {
        firstName: personnel.firstName,
        lastName: personnel.lastName,
        jobGroup: personnel.jobGroup,
        workRoutine: personnel.workRoutine,
      },
      calendarDays,
      existingRequests,
      scheduleHistory,
    };

    // تاریخچهٔ گفت‌وگو به‌صورت پیام‌های واقعی chat فرستاده می‌شود (نه داخل یک
    // رشتهٔ بزرگ) تا مدل Llama نقش‌ها را درست تفکیک کند و توکن کمتری مصرف شود.
    const conversation: GroqMessage[] = messages.slice(-8).map(message => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content || "").slice(0, 2000),
    }));

    const groqMessages: GroqMessage[] = [
      {
        role: "user",
        content: `CONTEXT_JSON:\n${JSON.stringify(context)}\n\nاین اطلاعات زمینه است؛ به آن پاسخ نده. فقط برای تحلیل پیام‌های بعدی از آن استفاده کن.`,
      },
      {
        role: "assistant",
        content: '{"status":"chat","reply":"زمینه دریافت شد.","summary":"","warnings":[],"questions":[],"requests":[]}',
      },
      ...conversation,
      {
        role: "user",
        content: "Analyze the conversation above and respond with the single JSON object described in the output contract.",
      },
    ];

    const { data, model, keyLabel } = await generateGroqJson<GroqChatPayload>({
      systemPrompt: SYSTEM_PROMPT,
      messages: groqMessages,
    });

    const status = typeof data.status === "string" && ["ready", "clarification", "chat"].includes(data.status)
      ? data.status
      : "chat";

    const { requests: normalizedRequests, droppedCount } =
      status === "ready" ? normalizeShiftRequestList(data.requests, totalDays) : { requests: [], droppedCount: 0 };

    const warnings = Array.isArray(data.warnings)
      ? data.warnings.filter((item: unknown): item is string => typeof item === "string")
      : [];
    if (droppedCount > 0) {
      warnings.push(`${droppedCount} مورد ناقص از نتیجه حذف شد؛ لطفاً همان مورد را دقیق‌تر بنویس.`);
    }

    return NextResponse.json({
      status,
      reply:
        typeof data.reply === "string" && data.reply.trim()
          ? data.reply
          : "پیامت را گرفتم؛ برای ثبت تمیز درخواست، کمی دقیق‌تر بگو لطفاً.",
      summary: typeof data.summary === "string" ? data.summary : "",
      warnings,
      questions: Array.isArray(data.questions)
        ? data.questions.filter((item: unknown): item is string => typeof item === "string")
        : [],
      requests: normalizedRequests,
      // متادیتای شفافیت: کدام موتور/مدل پاسخ داد (در UI به‌صورت تگ نشان داده می‌شود).
      engine: { provider: GROQ_PROVIDER, model, key: keyLabel },
    });
  } catch (error) {
    const status = httpStatusForAiError(error);
    if (status !== 500) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "خطای هوش مصنوعی",
          retryable: isRetryableAiError(error),
          provider: GROQ_PROVIDER,
        },
        { status },
      );
    }
    console.error("Error in Groq request chat:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "خطای ناشناخته در گفت‌وگوی هوشمند" },
      { status: 500 },
    );
  }
}
