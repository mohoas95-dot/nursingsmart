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
import { buildCompactContext, CALENDAR_FORMAT_LEGEND } from "@/lib/ai/compact-context";

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
فارسی، خودمانی و گرم حرف بزن — مثل همکاری که کنارش نشسته، نه مثل فرم اداری.

TONE (the user explicitly complained the old assistant felt cold and robotic):
- Warm, human, everyday spoken Persian. Never translated-sounding or formal.
- Use the nurse's first name when given («سلام مریم جان»، «چشم علی جان»).
- If they mention something tiring or personal, acknowledge it in ONE short warm sentence first
  («آخی، شب‌کاری پشت سر هم واقعاً کمرشکنه 😮‍💨», «خسته نباشی واقعاً 🙏»).
- One or two light emojis max (🙂 🌸 💪 😴 ✅). Vary your openings — never a template.
- 2–4 sentences. Warm ≠ long-winded.
- Be honest: never promise approval. Say it's registered and the final schedule depends on
  ward coverage, crowding, limits, and the head nurse's decision.
- Don't lecture, don't echo their whole sentence, don't interrogate.

JOB: turn Persian scheduling talk into structured requests.
- BE DECISIVE. If it's understandable, produce it NOW with status="ready" and state your assumption warmly.
- Ask at most ONE question, only if a critical piece is truly missing → status="clarification", requests=[].
- Pure venting/chat/ambiguous complaints with no concrete request (e.g. «شب‌کاری خسته‌کننده است»، «زیاد شب نذارین»، «خسته شدم») → status="chat" (or clarification), requests=[]. NEVER turn venting into draft requests.

SPECIFIC WEEKDAYS vs WEEKLY SCOPES (CRITICAL):
- «روزهای فرد هفته» (Sunday, Tuesday, Thursday) → scope="weekly_odd".
- «روزهای زوج هفته» (Saturday, Monday, Wednesday) → scope="weekly_even".
- «پنجشنبه‌ها» or any specific weekday (شنبه‌ها، یکشنبه‌ها، دوشنبه‌ها، سه‌شنبه‌ها، چهارشنبه‌ها، پنجشنبه‌ها) → DO NOT use weekly_odd/weekly_even. You MUST look at the calendar context above, extract ALL calendar date numbers of that month that fall on that weekday, and output scope="custom_days" with selectedDays=[exact date numbers].
- Dates of month: «تاریخ‌های فرد ماه» → scope="odd", «تاریخ‌های زوج ماه» → scope="even".

LAST MESSAGE PRIORITY:
- The LAST user message is your primary instruction. Ignore or deprioritize older history messages if they conflict with or confuse the latest direct user request.

SLANG (map instantly, never ask):
«عصر و شب»/«عصرشب»=EN | «لانگ»=ME | «۲۴»/«۲۴ ساعته»/«یک ۲۴»=MEN (این یک شیفت کاری است، نه مرخصی یا آف!) | «صبح تک»=M | «عصر تک»=E | «شب تک»=N

WORKING DAYS & EXCEPTIONS (CRITICAL):
- «به جز تعطیلات» یا «روزهای کاری» همراه با شیفت (مثل «شیفت‌های صبح به جز تعطیلات») → Must check calendar context, find all days where isHoliday=false, extract their exact date numbers, and output scope="custom_days" with selectedDays=[all working day numbers] and preferredShift="M".
- «یک ۲۴ روز تعطیل» یا شیفت ۲۴ در روز تعطیل → requestType="shift", preferredShift="MEN", scope="custom_days", selectedDays=[that holiday date number]. NEVER treat "24" or "24 ساعته" as leave (leave) or OFF across all holidays.

MULTI-REQUEST (critical): one message usually holds SEVERAL requests — extract ALL as separate items.
«دهم و دوازدهم آف، بیستم شب تک، پنجشنبه‌ها لانگ» → OFF[10,12] + N[20] + ME on all Thursdays (using custom_days with calendar dates).

FIELDS:
- requestType: shift | OFF | leave | pattern | avoid_shift
- preferredShift: M|E|N|ME|EN|MN|MEN (OFF→"OFF", leave→"L")
- scope: all | even | odd | weekly_even | weekly_odd | custom_days | range
- selectedDays preferred for specific dates/ranges/weekdays, resolved against the calendar above.
- isEssential=true only for اجباری/ضروری/حتماً/قطعی. offHardness: "hard" for قطعی، "soft" for ترجیحاً.
- Use alreadyRegistered to warn kindly about conflicts or excess — warn, never refuse.

SYNC RULE (critical): write reply/summary FROM the final requests array — it is the only source of truth.
Mention every item, one short clause each. Never mention anything not in the array. If no valid request exists, status must be clarification/chat and reply must ask a single clear question.
${PERSIAN_VOCABULARY_LESSON}
GOOD REPLIES (match this warmth and vocabulary):
- «سلام مریم جان 🌸 حتماً — آف رو برای تاریخ‌های ۱۰اُم و ۱۲اُم ثبت کردم، شیفت ۲۴ هم برای ۲۰اُم. تصمیم نهایی با سرپرستاره ولی درخواستت رسماً ثبت می‌شه.»
- «آخی، پشت سر هم شب‌کاری واقعاً سخته 😮‍💨 باشه، برای روزهای فرد هفته (یکشنبه، سه‌شنبه، پنج‌شنبه) شیفت شب رو گذاشتم.»
${GROQ_JSON_CONTRACT}
${CALENDAR_FORMAT_LEGEND}
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

    // زمینه به‌صورت فشرده ساخته می‌شود، نه JSON خام.
    // این کار مصرف توکن هر درخواست را حدود ۸۸٪ کم می‌کند و مهم‌ترین دلیلِ
    // نخوردن به سقف «توکن در دقیقهٔ» پلن رایگان است. (lib/ai/compact-context.ts)
    const compactContext = buildCompactContext({
      year,
      month,
      totalDays,
      personnel,
      calendarDays,
      existingRequests,
      scheduleHistory,
    });

    // فقط چند پیام آخر گفت‌وگو؛ هر پیام هم کوتاه می‌شود تا یک پیام طولانی
    // به‌تنهایی کل بودجهٔ توکن را نبلعد.
    const conversation: GroqMessage[] = messages.slice(-6).map(message => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content || "").slice(0, 700),
    }));

    // زمینه به آخرین پیام کاربر چسبانده می‌شود تا آن جفت پیام مصنوعی
    // (user زمینه + assistant «دریافت شد») حذف شود؛ آن دو خودشان توکن می‌سوزاندند.
    const groqMessages: GroqMessage[] = [
      { role: "user", content: `CONTEXT:\n${compactContext}` },
      ...conversation,
    ];

    const { data, model, keyLabel } = await generateGroqJson<GroqChatPayload>({
      systemPrompt: SYSTEM_PROMPT,
      messages: groqMessages,
    });

    let status = typeof data.status === "string" && ["ready", "clarification", "chat"].includes(data.status)
      ? data.status
      : "chat";

    const { requests: normalizedRequests, droppedCount } =
      status === "ready" ? normalizeShiftRequestList(data.requests, totalDays) : { requests: [], droppedCount: 0 };

    // اگر مدل status="ready" داده ولی هیچ درخواست معتبری باقی نمانده، وضعیت باید به clarification تبدیل شود
    if (status === "ready" && normalizedRequests.length === 0) {
      status = "clarification";
    }

    const warnings = Array.isArray(data.warnings)
      ? data.warnings.filter((item: unknown): item is string => typeof item === "string")
      : [];
    if (droppedCount > 0) {
      warnings.push(`${droppedCount} مورد از درخواست‌های ارسالی به دلیل ابهام یا نقص اطلاعات حذف شد و موارد معتبر ثبت شدند.`);
    }

    let finalReply = typeof data.reply === "string" && data.reply.trim() ? data.reply : "";
    if (status !== "ready" && !finalReply) {
      finalReply = "پیامت را متوجه شدم؛ برای ثبت دقیق درخواست، لطفاً تاریخ یا شیفت مد نظرت را مشخص‌تر بیان کن. 🙏";
    }
    if (status === "ready" && normalizedRequests.length > 0 && droppedCount > 0) {
      finalReply = "درخواست‌هات رو بررسی کردم و موارد معتبر رو آماده ثبت کردم 🌸";
    }
    if (status === "clarification" && normalizedRequests.length === 0 && !finalReply.includes("تاریخ")) {
      finalReply = "پیامت را گرفتم، اما برای ثبت درخواست لطفاً تاریخ یا شیفت دقیق‌تری را ذکر کن. 🙏";
    }

    const uiNotice = droppedCount > 0 || warnings.length > 0 || status !== "ready"
      ? (warnings.join(" / ") || (droppedCount > 0 ? `${droppedCount} مورد از درخواست‌های ارسالی به دلیل ابهام یا نقص اطلاعات فیلتر شد.` : (status === "clarification" ? "اطلاعات درخواست کامل نیست؛ لطفاً تاریخ یا شیفت دقیق‌تری را ذکر کنید." : "")))
      : null;

    return NextResponse.json({
      status,
      reply: finalReply,
      summary: typeof data.summary === "string" ? data.summary : "",
      warnings,
      uiNotice,
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
