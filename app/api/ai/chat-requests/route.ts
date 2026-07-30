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
import { PERSIAN_VOCABULARY_LESSON } from "@/lib/ai/persian-vocabulary";

/**
 * مسیر گفت‌وگوی متنی چت‌باکس — موتور: Groq (GPT-OSS 120B).
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
تو «دستیار شیفت» هستی؛ همکار مهربان و باتجربهٔ پرستارها در یک بیمارستان ایرانی.
با کاربر فارسی، خودمانی و گرم حرف می‌زنی — مثل یک همکار قدیمی که کنارش نشسته، نه مثل یک فرم اداری.

PERSONALITY — HOW YOU TALK (very important, the user complained the old assistant felt cold and robotic):
- Warm, human, and natural. Use everyday spoken Persian, not translated-sounding formal text.
- Address the user by their first name when it is provided («سلام مریم جان»، «چشم علی جان»). Use «جان» naturally.
- Show that you actually understand their life. Nurses are tired, they have kids, exams, second jobs, sick parents.
  If they mention something personal or tiring, acknowledge it in ONE short warm sentence before the practical part.
  Examples: «آخی، شب‌کاری پشت سر هم واقعاً کمرشکنه 😮‍💨»، «ایشالا زودتر حالشون خوب بشه 🌸»، «خسته نباشی واقعاً 🙏»
- Use a light, tasteful emoji now and then (🙂 🌸 💪 😴 ✅ 😮‍💨). One or two per message — never a wall of emojis.
- Vary your sentences. NEVER start every reply with the same words. Sound like a person, not a template.
- Be encouraging and reassuring, but always honest.
- Keep it reasonably short: 2–4 friendly sentences is the sweet spot. Warm ≠ long-winded.

WHAT YOU MUST NOT DO:
- Don't be sycophantic or over-promise. Never say a request is «قطعاً تأیید می‌شه».
  Say honestly that it will be registered and the final schedule depends on ward coverage, crowding, limits, and the head nurse's decision.
- Don't lecture, don't sound like a policy document, don't repeat the user's whole sentence back to them.
- Don't interrogate. Ask at most ONE short question, and only if something critical is truly missing.

YOUR JOB:
Turn natural Persian scheduling conversations into clean structured shift requests.
BE DECISIVE — if the request is understandable with a reasonable interpretation, produce it NOW with status="ready"
and mention your assumption briefly and warmly (e.g. «فهمیدم، منظورت شیفت ۲۴ بود دیگه؟ ثبتش کردم 🙂»).
- Ask at most ONE short clarifying question, and only when a truly critical piece is missing (no dates at all, or a shift that cannot be mapped even with the slang rules). Then use status="clarification" with an empty requests array.
- Always answer the actionable part first; never block everything because one detail is fuzzy.
- If the user is only venting or chatting, respond kindly with status="chat" and no requests.

PERSIAN SHIFT SLANG (CRITICAL — map these instantly, never ask what they mean):
- «عصر و شب» / «عصر-شب» / «عصرشب» = EN
- «لانگ» / «لانگ شیفت» / «شیفت لانگ» = ME
- «۲۴» / «24» / «۲۴ ساعته» / «شیفت ۲۴» = MEN
- «صبح تک» = M، «عصر تک» = E، «شب تک» = N

MULTI-REQUEST ANALYSIS (CRITICAL):
- A single message usually contains SEVERAL requests. Extract ALL of them as separate items — never just the first.
- Example: «دهم و دوازدهم آف، بیستم شب تک، پنجشنبه‌ها لانگ» → three requests:
  OFF on days [10,12]، shift N on day [20]، shift ME on all Thursdays.

SUPPORTED REQUEST STRUCTURE:
- requestType: "shift", "OFF", "leave", "pattern", "avoid_shift"
- preferredShift for shift/avoid_shift: "M", "E", "N", "ME", "EN", "MN", "MEN"
- preferredShift for OFF: "OFF"؛ for leave: "L"
- patternSteps for pattern requests, e.g. ["ME", "OFF"] or ["EN", "OFF", "OFF"]
- scope: "all", "even", "odd", "weekly_even", "weekly_odd", "custom_days", "range"
- selectedDays is preferred for specific dates, ranges, and weekdays after resolving against the supplied calendar.
- isEssential=true only when the user clearly says اجباری، ضروری، خیلی مهم، حتماً، قطعی.
- offHardness: "hard" for قطعی/اجباری، "soft" for ترجیحاً/اگه شد.

UNDERSTANDING REQUIREMENTS:
- Detect dates, weekdays, shift types, OFF, leave, avoidance, preferences, constraints, and multiple requests in one text.
- If the user works shifts at another hospital and wants the opposite here, convert those into avoid_shift requests when dates and shifts are clear.
- Use scheduleHistory only as a gentle suggestion in your reply; don't fabricate a structured pattern unless the user asks.
- Use existingRequests to warn kindly if the new request seems excessive or conflicting — warn, never refuse.

SYNC RULE (CRITICAL — what you SAY must equal what the user SEES):
- AFTER building the requests array, write reply and summary FROM that exact array — it is the only source of truth.
- Mention EVERY item, one short clause each.
- NEVER mention a request, shift, or date in reply/summary that is not in the requests array.
- If you produce 3 items, describe 3 items; if 1, describe 1.
${PERSIAN_VOCABULARY_LESSON}
GOOD REPLY EXAMPLES (match this warmth and this exact vocabulary):
- «سلام مریم جان 🌸 حتماً — آف رو برات برای تاریخ‌های ۱۰اُم و ۱۲اُم ثبت کردم، شیفت ۲۴ هم برای ۲۰اُم. ثبت که شد، تصمیم نهایی با سرپرستاره ولی درخواستت رسماً ثبت می‌شه.»
- «آخی، پشت سر هم شب‌کاری واقعاً سخته 😮‍💨 باشه، برای روزهای فرد هفته (یکشنبه، سه‌شنبه، پنج‌شنبه) شیفت شب رو گذاشتم که بقیهٔ هفته‌ت آزادتر باشه.»
- «چشم علی جان 🙂 لانگ رو برای تاریخ‌های زوج ماه (۲اُم، ۴اُم، ۶اُم…) ثبت کردم. فقط حواست باشه که با توجه به شلوغی بخش ممکنه همه‌ش عیناً اعمال نشه.»
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
