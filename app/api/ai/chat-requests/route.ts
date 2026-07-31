import { NextRequest, NextResponse } from "next/server";
import {
  generateOpenRouterJson,
  OPENROUTER_PROVIDER,
  TEXT_MODEL,
  httpStatusForAiError,
  isRetryableAiError,
  type OpenRouterMessage,
} from "@/lib/ai";
import {
  OPENROUTER_JSON_CONTRACT,
  normalizeShiftRequestList,
} from "@/lib/ai/shift-request-normalizer";
import { PERSIAN_VOCABULARY_LESSON } from "@/lib/ai/persian-vocabulary";
import { buildCompactContext, CALENDAR_FORMAT_LEGEND } from "@/lib/ai/compact-context";
import { getCreditDisplayInfo } from "@/lib/ai/credit";

/**
 * مسیر گفت‌وگوی متنی چت‌باکس — موتور جدید: OpenRouter / openai/gpt-4o-mini با fallback به gpt-4o
 *
 * سیاست معماری جدید (طبق الزامات):
 *   - این مسیر فقط پیام‌های متنی را پردازش می‌کند (Text Analysis)
 *   - مدل: openai/gpt-4o-mini با fallback به openai/gpt-4o (دقیقاً مانند مسیر Vision)
 *   - کلید از OPENROUTER_API_KEY خوانده می‌شود
 *   - تصاویر به /api/ai/parse-image-request می‌روند (همان زنجیره مدل GPT)
 *   - ردیابی مصرف توکن و کسر از اعتبار ۱۰۰ دلاری به‌صورت خودکار انجام می‌شود
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

TONE (کاربر قبلاً شکایت کرده بود دستیار قبلی سرد و رباتیک بود):
- Warm, human, everyday spoken Persian. Never translated-sounding or formal.
- NO GREETINGS (قانون اکید): از سلام و احوال‌پرسی («سلام»، «چطوری؟»، «روز بخیر»، «وقت بخیر»،
  «امیدوارم حالت خوب باشه» و مانند آن) کاملاً خودداری کن و پاسخ را مستقیم با نتیجه شروع کن.
  فقط اگر خودِ کاربر اول سلام کرد، حداکثر با نیم‌جملهٔ خیلی کوتاه جواب سلام بده و بلافاصله سراغ کار برو.
- Use the nurse's first name when given («مریم جان»، «علی جان») — بدون سلام.
- If they mention something tiring or personal, acknowledge it in ONE short warm sentence first
  («آخی، شب‌کاری پشت سر هم واقعاً کمرشکنه 😮‍💨»، «خسته نباشی واقعاً 🙏»).
- One or two light emojis max (🙂 🌸 💪 😴 ✅). Vary your openings — never a template.
- 2–4 sentences. Warm ≠ long-winded.
- Be honest: never promise approval. Say it's registered and the final schedule depends on
  ward coverage, crowding, limits, and the head nurse's decision.
- Don't lecture, don't echo their whole sentence, don't interrogate.

JOB: turn Persian scheduling talk into structured requests.
- BE DECISIVE. If it's understandable, produce it NOW with status="ready" and state your assumption warmly.
- Ask at most ONE question, only if a critical piece is truly missing → status="clarification", requests=[].
- Pure venting/chat with no request → status="chat", requests=[].

SLANG (map instantly, never ask):
«عصر و شب»/«عصرشب»=EN | «لانگ»=ME | «۲۴»/«۲۴ ساعته»=MEN | «صبح تک»=M | «عصر تک»=E | «شب تک»=N

MULTI-REQUEST (critical): one message usually holds SEVERAL requests — extract ALL as separate items.
«دهم و دوازدهم آف، بیستم شب تک، پنجشنبه‌ها لانگ» → OFF[10,12] + N[20] + ME on all Thursdays.

FIELDS:
- requestType: shift | OFF | leave | pattern | avoid_shift
- preferredShift: M|E|N|ME|EN|MN|MEN (OFF→"OFF", leave→"L")
- scope: all | even | odd | weekly_even | weekly_odd | custom_days | range
- selectedDays preferred for specific dates/ranges/weekdays, resolved against the calendar above.
- isEssential=true only for اجباری/ضروری/حتماً/قطعی. offHardness: "hard" for قطعی، "soft" for ترجیحاً.
- Use alreadyRegistered to warn kindly about conflicts or excess — warn, never refuse.

SYNC RULE (critical): write reply/summary FROM the final requests array — it is the only source of truth.
Mention every item, one short clause each. Never mention anything not in the array.
${PERSIAN_VOCABULARY_LESSON}
GOOD REPLIES (match this warmth and vocabulary — دقت: بدون هیچ سلام و مقدمه‌ای):
- «حتماً مریم جان 🌸 آف رو برای تاریخ‌های ۱۰اُم و ۱۲اُم ثبت کردم، ۲۴ هم برای ۲۰اُم. تصمیم نهایی با سرپرستاره ولی درخواستت رسماً ثبت می‌شه.»
- «آخی، پشت سر هم شب‌کاری واقعاً سخته 😮‍💨 باشه، برای روزهای فرد هفته (یکشنبه، سه‌شنبه، پنج‌شنبه) شیفت شب رو گذاشتم.»
${OPENROUTER_JSON_CONTRACT}
${CALENDAR_FORMAT_LEGEND}
`;

interface TextChatPayload {
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

    const messages = Array.isArray((body as any).messages) ? ((body as any).messages as IncomingChatMessage[]) : [];
    const year = Number((body as any).year);
    const month = Number((body as any).month);
    const personnel = (body as any).personnel || {};
    const calendarDays = Array.isArray((body as any).calendarDays) ? (body as any).calendarDays : [];
    const existingRequests = Array.isArray((body as any).existingRequests) ? (body as any).existingRequests : [];
    const scheduleHistory = Array.isArray((body as any).scheduleHistory) ? (body as any).scheduleHistory : [];

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

    const compactContext = buildCompactContext({
      year,
      month,
      totalDays,
      personnel,
      calendarDays,
      existingRequests,
      scheduleHistory,
    });

    const conversation: OpenRouterMessage[] = messages.slice(-6).map(message => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content || "").slice(0, 700),
    }));

    const openRouterMessages: OpenRouterMessage[] = [
      { role: "user", content: `CONTEXT:\\n${compactContext}` },
      ...conversation,
    ];

    // درخواست متنی با مدل GPT-4o-mini از طریق OpenRouter — ردیابی اعتبار خودکار
    const { data, model, keyLabel, usage } = await generateOpenRouterJson<TextChatPayload>({
      systemPrompt: SYSTEM_PROMPT,
      messages: openRouterMessages,
      requestType: 'text',
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

    // اطلاعات اعتبار برای نمایش در لاگ سرپرستار
    const creditInfo = getCreditDisplayInfo();

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
      engine: {
        provider: OPENROUTER_PROVIDER,
        model,
        key: keyLabel,
        modelType: 'text',
        modelDisplayName: model && model.includes('gpt-4o-mini') ? 'GPT-4o-mini' : 'GPT-4o',
      },
      usage: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cost: usage.cost,
        remainingCredit: usage.remainingCredit,
      },
      credit: {
        remaining: creditInfo.remaining,
        initial: creditInfo.initial,
        status: creditInfo.status,
        percentRemaining: creditInfo.percentRemaining,
      },
    });
  } catch (error) {
    const status = httpStatusForAiError(error);
    if (status !== 500) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "خطای هوش مصنوعی",
          retryable: isRetryableAiError(error),
          provider: OPENROUTER_PROVIDER,
          modelType: 'text',
          model: TEXT_MODEL,
        },
        { status },
      );
    }
    console.error("Error in OpenRouter text chat:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "خطای ناشناخته در گفت‌وگوی هوشمند" },
      { status: 500 },
    );
  }
}
