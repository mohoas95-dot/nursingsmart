import { NextRequest, NextResponse } from "next/server";
import {
  OPENROUTER_PROVIDER,
  VISION_MODEL,
  VISION_FALLBACK_MODEL,
  generateOpenRouterVision,
  httpStatusForAiError,
  isRetryableAiError,
} from "@/lib/ai";
import { normalizeShiftRequestList, VISION_JSON_CONTRACT } from "@/lib/ai/shift-request-normalizer";
import { PERSIAN_VOCABULARY_LESSON } from "@/lib/ai/persian-vocabulary";
import { buildCompactContext, CALENDAR_FORMAT_LEGEND } from "@/lib/ai/compact-context";
import { getCreditDisplayInfo } from "@/lib/ai/credit";

/**
 * مسیر تحلیل «تصویر» چت‌باکس — موتور جدید: OpenRouter / openai/gpt-4o-mini با fallback به gpt-4o
 *
 * سیاست معماری جدید:
 *   - این مسیر تنها مسیری است که تصویر می‌پذیرد (Vision / OCR)
 *   - مدل اصلی: openai/gpt-4o-mini (سریع و کم‌هزینه)
 *   - fallback: openai/gpt-4o در صورت تصویر شلوغ/کم‌کیفیت یا خطای مدل اول
 *   - کلید از OPENROUTER_API_KEY خوانده می‌شود
 *   - ردیابی مصرف توکن و کسر از اعتبار ۱۰۰ دلاری
 *
 * بهینه‌سازی OCR جدول‌های شیفت (۳۱ مرداد ۱۴۰۵):
 *   - پی‌لود تصویر با detail:"high" ارسال می‌شود (VISION_IMAGE_DETAIL در lib/ai/openrouter.ts)
 *     تا متن ریز سلول‌ها با بالاترین کیفیت اسکن شود.
 *   - فرانت‌اند تصویر را پیش از ارسال نرمال می‌کند: حداکثر ۲۰۴۸px و کیفیت JPEG ≥ ۰٫۸۵
 *     (lib/image-file.ts → prepareImageForVisionUpload) — بدون ریزایز شدید.
 *   - پرامپت سیستمی: OCR حرفه‌ای فارسی متمرکز بر جدول — خوانش ستون‌به‌ستون،
 *     عدم حدس‌زدن و علامت‌گذاری [نامفهوم]، خروجی دقیق در قالب JSON پروژه.
 *
 * حریم خصوصی و حافظه:
 *   - تصویر به‌صورت base64 در بدنه JSON می‌آید و به‌شکل inline URL در حافظه به OpenRouter داده می‌شود
 *   - هیچ‌گاه روی دیسک نوشته نمی‌شود، در پایان تابع پاک‌سازی می‌شود
 */

export const runtime = "nodejs";
export const maxDuration = 60;

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

    // پرامپت سیستمی — بازطراحی‌شده برای OCR دقیق جدول‌های شیفت پرستاری.
    // ساختار: ۱) هستهٔ فارسی اکید ۲) پروتکل خوانش جدول ۳) نگاشت به قرارداد
    // JSON پروژه (requestType/scope/preferredShift/selectedDays) تا خروجی
    // مستقیم وارد نرمالایزر سمت سرور شود.
    const systemPrompt = `
تو یک سیستم حرفه‌ای OCR و استخراج داده از جدول‌های شیفت پرستاری هستی.
وظیفه تو استخراج دقیق سطور و ستون‌های جدول موجود در عکس است.

قوانین اکید:
- تمام اسامی، تواریخ، روزهای هفته و کلمات شیفت (صبح، عصر، شب، آف، لانگ) را ستون به ستون و سطر به سطر استخراج کن.
- اگر قسمتی از دست‌خط یا متن خوانا نبود، حدس نزن و آن را با [نامفهوم] مشخص کن.
- خروجی را دقیقاً در قالب فرمت JSON درخواستی پروژه بازگردان.

پروتکل خوانش جدول (TABLE READING):
۱. ابتدا ساختار جدول را تشخیص بده: معمولاً ستون اول «نام پرسنل» است و ستون‌های بعدی روزهای ماه (۱ تا ${totalDays})؛ ردیف سرستون شامل شمارهٔ روز و اغلب حرف روز هفته (ش=شنبه، ی=یکشنبه، د=دوشنبه، س=سه‌شنبه، چ=چهارشنبه، پ=پنجشنبه، ج=جمعه) است.
۲. تعداد ستون‌های روز را بشمار؛ باید دقیقاً ${totalDays} ستون باشد. پیش از خوانش مقادیر، تراز هر سلول را با شمارهٔ سرستونِ خودش بررسی کن — خطای رایج، جابه‌جایی یک خانه‌ای مقدارهاست.
۳. جدول را ستون‌به‌ستون بخوان (نه سطربه‌سطر شتاب‌زده): برای هر شمارهٔ روز، همان یک مقدار زیر آن سرستون را بخوان.
۴. پس از خوانش کامل، یک بار دیگر از ابتدا مرور کن و هر مقدار را با شماره روزش تطبیق بده؛ فقط مقادیری را خروجی بده که در هر دو مرور یکسان خوانده شده‌اند.
۵. اگر تصویر جدول کل بخش است (چند پرسنل)، فقط ردیفی را استخراج کن که نامش با نام پرسنلِ متقاضی در CONTEXT مطابقت دارد (تطبیق نام خانوادگی کافی است). اگر چنین ردیفی پیدا نشد، نام ردیف‌های دیده‌شده را در «warnings» بنویس و وضعیت را "clarification" بگذار.
۶. تصویر ممکن است به‌جای جدول، دست‌نوشته یا اسکرین‌شات پیام باشد؛ در آن حالت همان متن را خط‌به‌خط بخوان و درخواست‌ها را استخراج کن.

Shift codes you may see in cells (be liberal in reading, strict in output):
  - «صبح», «ص», "M"        → M (شیفت صبح)
  - «عصر», «ع», "E"        → E (شیفت عصر)
  - «شب», «ش», "N"         → N (شیفت شب)
  - «لانگ», «ص ع», "ME"    → ME (صبح-عصر)
  - «عصر و شب», "EN"       → EN (عصر-شب)
  - «۲۴», «٢٤», "MEN", "24" → MEN (کد ۲۴)
  - «آف», «استراحت», "OFF" → OFF
  - «مرخصی», "L"           → L
  - سلول خالی یا خط تیره = آن روز مقداری ندارد؛ در خروجی نیاور.
  - ارقام فارسی (۰-۹) را حتماً به لاتین (0-9) تبدیل کن.

CONTEXT FOR THE CURRENT MONTH:
  - Year: ${year}
  - Month: ${month}
  - Month total days: ${totalDays}
  - Weekdays are listed in the provided calendarDays array with their dayOfWeek (0=Saturday ... 6=Friday) and Persian weekday name.
  - If the text mentions a specific date (e.g. «دهم» or «۱۰ام»), map it to that day-of-month in the current month.
  - If the text mentions a weekday (e.g. «شنبه‌ها»، «پنجشنبه‌ها»), resolve to all matching days in the current month using calendarDays.

گروه‌بندی خروجی جدول (CRITICAL):
  - اگر در ردیف پرسنل یک شیفت در چند روز تکرار شده (مثلاً «شب» در روزهای ۲، ۵، ۹)، برای هر نوع شیفت فقط یک آیتم بساز: requestType="shift"، آن preferredShift، scope="custom_days" و selectedDays لیست همهٔ آن روزها.
  - روزهای «آف» هم همین‌طور در یک آیتم requestType="OFF" با selectedDays خودشان تجمیع شوند.
  - هرگز برای هر روز یک آیتم جدا نساز مگر این‌که متن، روز خاصی با شرایط متفاوت گفته باشد.
  - سلول‌های [نامفهوم]: شمارهٔ روزشان را در هیچ selectedDays نیاور؛ به‌جایش در «warnings» دقیق بنویس، مثلاً: «سلول روز ۱۲اُم خوانا نبود و به‌عنوان [نامفهوم] رد شد.»
  - status="illegible" فقط وقتی که هیچ‌چیز تصویر خوانا نباشد؛ اگر حتی بخشی از جدول خوانا است، همان بخش را با دقت استخراج کن.

قانون اعداد در دست‌خط (CRITICAL — اعداد تقریباً همیشه خوانا هستند):
  - تو در خواندن اعداد روی تصویر قوی هستی؛ حتی وقتی دست‌خط فارسی (کلمهٔ شیفت) خوانا نیست، شمارهٔ روزها معمولاً خواناست. این اعداد را حتماً استخراج کن و دور نریز.
  - اگر کلمهٔ شیفت ناخوانا بود ولی شمارهٔ روز(ها)ی کنارش خوانا بود: آیتمی بساز با requestType="shift"، scope="custom_days"، همان selectedDays خوانده‌شده و فیلد "needsClarification": true — و preferredShift را کاملاً حذف کن (خالی یا placeholder نگذار).
  - در description همان آیتم دقیق بنویس چه روزهایی خوانده شده و چه چیزی [نامفهوم] مانده، مثلاً: «روزهای ۵اُم و ۸اُم خوانده شد؛ نوع شیفت [نامفهوم] است».
  - در reply و warnings از کاربر بخواه منظور دقیقش را خودش اصلاح کند، مثلاً: «روزهای ۵اُم و ۸اُم رو خوندم ولی نوع شیفتش [نامفهوم] موند — لطفاً از دکمهٔ «ویرایش» نوع شیفتش رو انتخاب کن.»
  - فقط وقتی هیچ عدد قابل اتکایی هم خوانا نباشد، آن آیتم را کاملاً حذف کن و با [نامفهوم] در warnings گزارش بده.

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
  - Be PRECISE, not creative. Extract what is written; interpret only what is understandable with certainty.
  - Only mark status="illegible" when NOTHING in the image can be read.
  - هرگز برای سلول ناخوانا مقدار حدسی نساز — همان قانون اکید [نامفهوم].
  - Persian numerals (۰-۹) MUST be converted to Latin (0-9) in selectedDays / dates.
  - "isEssential" is true ONLY if the text clearly says «ضروری / اجباری / قطعی / حتماً / خیلی مهم».
  - "offHardness" is "hard" for «قطعی / اجباری», "soft" for «ترجیحاً / اگه شد».
  - "description" must be a short Persian recap, 5–15 words, suitable for showing back to the user.
  - "reply" must be a WARM, friendly, human Persian sentence telling the user what you read from the image —
    like a kind colleague, not a machine. Address them by first name if provided, and you may use one light emoji.
    ✅ Good: «خوندمش مریم جان 🙂 آف رو برای تاریخ‌های ۱۰اُم و ۱۲اُم و ۲۴ رو برای ۲۰اُم برداشت کردم.»
    ❌ Bad:  «تصویر پردازش شد. ۲ درخواست استخراج گردید.»
${PERSIAN_VOCABULARY_LESSON}

NEVER RETURN UNDEFINED OR BLANK FIELDS (CRITICAL):
  - NEVER use the string "undefined", "null", "?", or any placeholder for shift/scope/days.
  - For EACH request, you MUST be able to fill ALL of: requestType, scope, and (if shift/avoid_shift) preferredShift.
  - If you genuinely cannot determine a shift or scope, OMIT that request entirely from the array
    and add a Persian warning like «درخواست ناخوانا حذف شد» (با ذکر [نامفهوم] در صورت نیاز) به آرایهٔ "warnings".
  - It is FAR better to return 2 confident requests + 1 warning than 3 requests where one has
    "preferredShift": "undefined" or an empty selectedDays.

${VISION_JSON_CONTRACT}
`;

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

    const userText = `CONTEXT:\n${compactContext}\n\n${CALENDAR_FORMAT_LEGEND}\n\nعکس پیوست (جدول شیفت یا دست‌نوشتهٔ درخواست) را طبق پروتکل خوانش جدول، ستون‌به‌ستون و سطر‌به‌سطر بخوان و خروجی را دقیقاً در قالب JSON خواسته‌شده بده. قسمت‌های ناخوانا را حدس نزن؛ با [نامفهوم] در warnings گزارش کن. اگر تصویر جدول کل بخش است، فقط ردیف پرسنل متقاضی (نام در CONTEXT) را استخراج کن. اگر کاملاً ناخوانا بود status=\"illegible\" برگردان.`;

    // درخواست بینایی با مدل gpt-4o-mini و fallback خودکار به gpt-4o برای تصاویر شلوغ/کم‌کیفیت
    const { data: parsed, model, keyLabel, usedFallback, usage } = await generateOpenRouterVision<{
      status?: unknown;
      reply?: unknown;
      warnings?: unknown;
      requests?: unknown;
    }>({
      systemPrompt,
      userText,
      imageBase64: base64Payload,
      mimeType: normalizedMime,
    });

    const status =
      typeof parsed.status === "string" && ["ready", "clarification", "illegible"].includes(parsed.status)
        ? parsed.status
        : "ready";

    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item: unknown): item is string => typeof item === "string")
      : [];

    if (usedFallback) {
      warnings.push(`تصویر با مدل پرقدرت‌تر تحلیل شد (fallback به ${VISION_FALLBACK_MODEL}) به دلیل شلوغی یا کیفیت پایین تصویر اصلی.`);
    }

    const { requests, droppedCount } = normalizeShiftRequestList(parsed.requests, totalDays);
    if (droppedCount > 0) {
      warnings.push(`${droppedCount} مورد ناخوانا یا ناقص از نتیجه حذف شد.`);
    }

    // آیتم‌های نیازمند اصلاح کاربر: روزها خوانده شده‌اند ولی نوع شیفت [نامفهوم] است.
    // این آیتم‌ها با needsClarification به فرانت می‌رسند تا کاربر از «قسمت ویرایش» نوع شیفت را مشخص کند.
    const needsClarificationCount = requests.filter(request => request.needsClarification).length;
    if (needsClarificationCount > 0) {
      warnings.push(
        `${needsClarificationCount} مورد روزهایش خوانده شد ولی نوع شیفتشان [نامفهوم] است؛ لطفاً با دکمهٔ «ویرایش» نوع شیفت هر مورد را مشخص کن و بعد تأیید و ثبت نهایی را بزن.`,
      );
    }

    const creditInfo = getCreditDisplayInfo();

    return NextResponse.json({
      status,
      reply: typeof parsed.reply === "string" ? parsed.reply : "",
      warnings,
      requests,
      engine: {
        provider: OPENROUTER_PROVIDER,
        model,
        key: keyLabel,
        modelType: 'vision',
        modelDisplayName: usedFallback ? 'GPT-4o (Fallback)' : 'GPT-4o-mini',
        usedFallback,
        primaryModel: VISION_MODEL,
        fallbackModel: VISION_FALLBACK_MODEL,
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
          modelType: 'vision',
          model: VISION_MODEL,
          fallbackModel: VISION_FALLBACK_MODEL,
        },
        { status },
      );
    }
    console.error("Error parsing image request via OpenRouter:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "خطای ناشناخته در پردازش تصویر" },
      { status: 500 },
    );
  } finally {
    purgeBuffer(imageBuffer);
    imageBuffer = null;
  }
}
