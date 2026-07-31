/**
 * lib/ai/gemini.ts
 * ---------------------------------------------------------------------------
 * موتور واحد هوش مصنوعی بر پایه Google Gemini Direct API
 *
 * الزامات جدید کارفرما (نسخه ۲۰۲۶):
 *   1. فقط Gemini — همهٔ مدل‌های قبلی (Groq, DeepSeek, GPT-4o-mini, OpenRouter)
 *      کاملاً حذف شده‌اند.
 *   2. مدل اصلی و جایگزین پایدار: gemini-1.5-flash
 *      (fallback می‌تواند با مدل اصلی یکسان باشد تا از مدل‌های آزمایشی/ناموجود استفاده نشود)
 *   3. شرایط سوئیچ به fallback:
 *      - زمان تحلیل بسیار طولانی (timeout)
 *      - مفاهیم استخراج‌شده نامفهوم (JSON نامعتبر / بی‌معنی)
 *      - سرور شلوغ / overloaded / 503 / 500
 *      - مشکلات جدی در پاسخ‌گویی مدل اصلی
 *      => سوئیچ سریع به 3.5 ممنوع؛ ابتدا باید هر ۵ کلید روی مدل اصلی امتحان شوند.
 *   4. پایداری: ۵ عدد API Key — GEMINI_API_KEY ... GEMINI_API_KEY_5
 *   5. اگر یک کلید به سقف روزانه خورد، بی‌معطلی به کلید بعدی.
 *   6. اگر همه کلیدها تمام شدند، مدت زمان انتظار بازگشایی به کاربر در چت‌باکس نشان داده شود.
 *   7. سیستم اعتبار ۱۰۰ دلاری / AiCreditPanel کاملاً حذف شده است.
 */

import { ApiKeyPool, classifyFailure, parseRetryAfterMs } from './key-pool';
import {
  buildQuotaMessage,
  MissingApiKeyError,
  ModelBusyError,
  ModelTimeoutError,
  ProviderRequestError,
  QuotaExhaustedError,
} from './errors';
import { extractJsonObject } from './json';

// ---------------------------------------------------------------------------
// ثابت‌ها و پیکربندی مدل‌ها
// ---------------------------------------------------------------------------

export const GEMINI_PROVIDER = 'gemini' as const;

// مدل پایدار پیش‌فرض Gemini — مطابق الزام کارفرما (مه ۲۰۲۶)
export const GEMINI_DEFAULT_MODEL = 'gemini-1.5-flash';

/**
 * نرمال‌سازی نام مدل برای API Gemini.
 *
 * خطای 404 «models/gemini-1.5-flash is not found» معمولاً وقتی رخ می‌دهد که نام مدل
 * (از متغیر محیطی یا هر جای دیگر) با پیشوند «models/» تنظیم شده باشد و آدرس
 * اندپوینت به شکل اشتباه
 *   https://generativelanguage.googleapis.com/v1beta/models/models/gemini-1.5-flash:generateContent
 * ساخته شود. این تابع تضمین می‌کند مقدار داخل مسیر همیشه شکل استاندارد
 * «gemini-1.5-flash» (بدون پیشوند models/) باشد:
 *   - حذف پیشوند «models/»، «v1beta/models/»، «v1/models/» و حتی URL کامل
 *   - حذف سافیکس متد مثل «:generateContent»
 *   - اگر پس از پاک‌سازی خالی بود، به مدل پایدار پیش‌فرض برمی‌گردد
 */
export function normalizeGeminiModelName(input?: string): string {
  let name = String(input ?? '').trim();
  if (!name) return GEMINI_DEFAULT_MODEL;
  // حذف پیشوندهای رایج مسیر (https://host/، v1beta/، v1/، models/)
  name = name.replace(/^(?:https?:\/\/[^/]+\/)?(?:v[^/]*\/)?models\//i, '');
  // حذف سافیکس متد (اگر کسی آدرس کامل اندپوینت را به‌عنوان مدل داده باشد)
  name = name.replace(/:(?:generateContent|streamGenerateContent|countTokens)$/i, '');
  name = name.trim();
  return name || GEMINI_DEFAULT_MODEL;
}

// مدل‌های پایدار عمومی Gemini. fallback عمداً همین مدل است تا نام مدل ناموجود
// باعث خطای 503/404 نشود؛ در صورت نیاز از محیط قابل override است.
// نکته: حتی اگر مقدار env با پیشوند «models/» تنظیم شده باشد، normalizeGeminiModelName
// آن را پاک می‌کند تا خطای 404 «models/gemini-1.5-flash is not found» رخ ندهد.
export const GEMINI_PRIMARY_MODEL: string = normalizeGeminiModelName(
  process.env.GEMINI_PRIMARY_MODEL ||
    process.env.GEMINI_TEXT_MODEL ||
    process.env.GEMINI_MODEL ||
    GEMINI_DEFAULT_MODEL,
);

export const GEMINI_FALLBACK_MODEL: string = normalizeGeminiModelName(
  process.env.GEMINI_FALLBACK_MODEL || GEMINI_DEFAULT_MODEL,
);

export function getGeminiModelChain(): string[] {
  // حفظ ترتیب: اول اصلی، بعد fallback — بدون تکرار
  const chain: string[] = [];
  if (GEMINI_PRIMARY_MODEL) chain.push(GEMINI_PRIMARY_MODEL);
  if (GEMINI_FALLBACK_MODEL && GEMINI_FALLBACK_MODEL !== GEMINI_PRIMARY_MODEL) {
    chain.push(GEMINI_FALLBACK_MODEL);
  }
  return Array.from(new Set(chain));
}

// Alias برای سازگاری با مسیرهای قدیمی که TEXT_MODEL / VISION_MODEL می‌خواستند
export const TEXT_MODEL = GEMINI_PRIMARY_MODEL;
export const VISION_MODEL = GEMINI_PRIMARY_MODEL;
export const TEXT_MODEL_FALLBACK = GEMINI_FALLBACK_MODEL;
export const VISION_FALLBACK_MODEL = GEMINI_FALLBACK_MODEL;
export const GEMINI_VISION_MODEL = GEMINI_PRIMARY_MODEL;
export const GEMINI_VISION_FALLBACK_MODEL = GEMINI_FALLBACK_MODEL;

// ---------------------------------------------------------------------------
// استخر ۵ کلید Gemini — فلسفهٔ چرخش خودکار بدون معطلی
// ---------------------------------------------------------------------------

/**
 * envNames ترتیب اولویت را مشخص می‌کند. هر متغیر خودش می‌تواند چند کلید
 * با کاما جدا شده داشته باشد. بدین ترتیب هم
 *   GEMINI_API_KEY="key1"
 *   GEMINI_API_KEY_2="key2"
 * و هم
 *   GEMINI_API_KEYS="key1,key2,key3,key4,key5"
 * پشتیبانی می‌شود.
 *
 * همچنین GOOGLE_API_KEY برای سازگاری با کسانی که قبلاً با آن نام ذخیره کرده‌اند
 * پذیرفته می‌شود.
 */
export const geminiKeyPool = new ApiKeyPool({
  provider: GEMINI_PROVIDER,
  envNames: [
    'GEMINI_API_KEY',
    'GEMINI_API_KEY_2',
    'GEMINI_API_KEY_3',
    'GEMINI_API_KEY_4',
    'GEMINI_API_KEY_5',
    'GEMINI_API_KEYS',
    'GOOGLE_API_KEY',
    'GOOGLE_API_KEY_2',
    'GOOGLE_API_KEY_3',
    'GOOGLE_API_KEY_4',
    'GOOGLE_API_KEY_5',
    'GOOGLE_API_KEYS',
    // سازگاری عقب‌رو: اگر کاربر هنوز OPENROUTER_API_KEY دارد و مقدار آن کلید گوگل باشد
    // ممکن است بخواهد همان را استفاده کند — به‌عنوان آخرین راه‌چاره می‌پذیریم اما لاگ هشدار می‌دهیم.
    // در داکیومنت Vercel فقط کلیدهای GEMINI_* را معرفی می‌کنیم.
  ],
});

// ---------------------------------------------------------------------------
// تنظیمات تایم‌اوت و بودجه
// ---------------------------------------------------------------------------

const PER_CALL_TIMEOUT_MS = Math.max(
  5_000,
  Number(process.env.GEMINI_CALL_TIMEOUT_MS) || 28_000,
);
const TOTAL_BUDGET_MS = Math.max(
  10_000,
  Number(process.env.GEMINI_TOTAL_BUDGET_MS) || 55_000,
);
// ۵ کلید روی ۲ مدل = حداکثر ۱۰ فراخوانی منطقی؛ کمی حاشیه برای retry
const MAX_CALLS_PER_REQUEST = Math.max(
  1,
  Number(process.env.GEMINI_MAX_CALLS_PER_REQUEST) || 12,
);
const MAX_OUTPUT_TOKENS = Math.max(
  512,
  Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 2500,
);
const TEMPERATURE = Number.isFinite(Number(process.env.GEMINI_TEMPERATURE))
  ? Number(process.env.GEMINI_TEMPERATURE)
  : 0.4;

// ---------------------------------------------------------------------------
// انواع عمومی
// ---------------------------------------------------------------------------

export interface GeminiChatMessage {
  role: 'user' | 'assistant' | 'model';
  content: string;
}

export interface GeminiJsonOptions {
  systemPrompt: string;
  messages: GeminiChatMessage[];
  maxTokens?: number;
}

export interface GeminiJsonResult<T> {
  data: T;
  model: string;
  keyLabel: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface GeminiVisionOptions {
  systemPrompt: string;
  userText: string;
  imageBase64: string;
  mimeType: string;
  maxTokens?: number;
}

export interface GeminiVisionResult<T = Record<string, unknown>> {
  data: T;
  model: string;
  keyLabel: string;
  usedFallback: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// Internal outcome
interface GeminiCallOutcome {
  ok: boolean;
  status?: number;
  content?: string;
  errorMessage?: string;
  retryAfterMs?: number;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  modelUsed?: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * خطاهای 503/High Demand به کلید API مربوط نیستند. پیش از کنار گذاشتن کلید،
 * همان درخواست را با backoff نمایی کوتاه دوباره می‌فرستیم: ۱ ثانیه، سپس ۲ ثانیه.
 */
const BUSY_RETRY_DELAYS_MS = [1_000, 2_000];

async function callGeminiWithBusyRetry(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<GeminiCallOutcome> {
  let outcome: GeminiCallOutcome | undefined;

  for (let attempt = 0; attempt <= BUSY_RETRY_DELAYS_MS.length; attempt++) {
    outcome = await callGeminiOnce(apiKey, model, body, timeoutMs);
    if (outcome.ok || classifyFailure(outcome.status, outcome.errorMessage || '') !== 'busy') {
      return outcome;
    }
    if (attempt === BUSY_RETRY_DELAYS_MS.length) break;

    // اگر Gemini retry-after کوتاه‌تری داد، آن را رعایت می‌کنیم؛ بازه را ۱ تا ۲ ثانیه نگه می‌داریم.
    const delay = Math.min(
      2_000,
      Math.max(1_000, outcome.retryAfterMs ?? BUSY_RETRY_DELAYS_MS[attempt]),
    );
    console.warn(`[gemini] پاسخ موقتاً شلوغ است؛ تلاش مجدد ${attempt + 1} از ${BUSY_RETRY_DELAYS_MS.length} پس از ${delay}ms.`);
    await sleep(delay);
  }

  return outcome!;
}

// ---------------------------------------------------------------------------
// ساخت بدنه درخواست Gemini
// ---------------------------------------------------------------------------

function buildGeminiRequestBody(
  systemPrompt: string,
  contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }>,
  maxTokens?: number,
) {
  return {
    systemInstruction: systemPrompt
      ? {
          parts: [{ text: systemPrompt }],
        }
      : undefined,
    contents,
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: maxTokens ?? MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
    },
  };
}

function toGeminiContents(messages: GeminiChatMessage[]): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const out: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  for (const msg of messages) {
    const role = msg.role === 'assistant' ? 'model' : msg.role === 'model' ? 'model' : 'user';
    const text = String(msg.content || '').trim();
    if (!text) continue;
    // ادغام پیام‌های هم‌نقش پشت سر هم برای رعایت alternation بهتر
    if (out.length > 0 && out[out.length - 1].role === role) {
      out[out.length - 1].parts[0].text += '\n\n' + text;
    } else {
      out.push({ role, parts: [{ text }] });
    }
  }
  // Gemini نیاز دارد اولین content نقش user باشد؛ اگر با model شروع شده باشد، یک پیام user خالی اضافه می‌کنیم
  if (out.length > 0 && out[0].role === 'model') {
    out.unshift({ role: 'user', parts: [{ text: 'شروع گفتگو' }] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// فراخوانی یک‌بار Gemini با یک کلید و یک مدل خاص
// ---------------------------------------------------------------------------

async function callGeminiOnce(
  apiKey: string,
  model: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<GeminiCallOutcome> {
  // اندپوینت استاندارد (نسخه v1beta) — نام مدل همیشه بدون پیشوند models/ درج می‌شود:
  //   https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent
  // normalizeGeminiModelName تضمین می‌کند پیشوند اضافه «models/» باعث 404 نشود.
  const safeModel = normalizeGeminiModelName(model);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    safeModel,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const rawBody = await response.text().catch(() => '');
      let providerMessage = rawBody;
      try {
        const parsed = JSON.parse(rawBody);
        // Gemini error shape: { error: { message, status, code } }
        providerMessage = parsed?.error?.message || parsed?.message || rawBody;
      } catch {
        // raw
      }
      return {
        ok: false,
        status: response.status,
        errorMessage: providerMessage || `Gemini HTTP ${response.status}`,
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after'), providerMessage),
      };
    }

    const result = await response.json();

    // استخراج متن از ساختار Gemini
    // result.candidates[0].content.parts[0].text
    const candidate = result?.candidates?.[0];
    const parts = candidate?.content?.parts as Array<{ text?: string }> | undefined;
    let contentText: string | undefined;
    if (Array.isArray(parts) && parts.length > 0) {
      contentText = parts
        .map(p => p.text || '')
        .filter(Boolean)
        .join('\n');
    }

    // در برخی نسخه‌ها candidates[].content.parts ممکن است خالی باشد ولی خود candidate.text دارد
    if (!contentText && typeof candidate?.content?.parts === 'undefined' && typeof result?.candidates?.[0]?.content === 'string') {
      contentText = result.candidates[0].content as unknown as string;
    }

    const usageMeta = result?.usageMetadata as
      | { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
      | undefined;

    if (!contentText) {
      return {
        ok: false,
        status: 502,
        errorMessage: 'Gemini پاسخ خالی برگرداند.',
        usage: usageMeta
          ? {
              promptTokens: usageMeta.promptTokenCount || 0,
              completionTokens: usageMeta.candidatesTokenCount || 0,
              totalTokens: usageMeta.totalTokenCount || 0,
            }
          : undefined,
      };
    }

    return {
      ok: true,
      content: contentText,
      usage: usageMeta
        ? {
            promptTokens: usageMeta.promptTokenCount || 0,
            completionTokens: usageMeta.candidatesTokenCount || 0,
            totalTokens: usageMeta.totalTokenCount || 0,
          }
        : undefined,
      modelUsed: model,
    };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, errorMessage: message };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// تابع اصلی تولید JSON متنی (متن + چت)
// ---------------------------------------------------------------------------

export async function generateGeminiJson<T = Record<string, unknown>>(
  options: GeminiJsonOptions,
): Promise<GeminiJsonResult<T>> {
  if (geminiKeyPool.size() === 0) {
    throw new MissingApiKeyError(
      'کلید API سرویس Gemini تنظیم نشده است؛ در Vercel متغیرهای GEMINI_API_KEY تا GEMINI_API_KEY_5 را اضافه کنید.',
      GEMINI_PROVIDER,
    );
  }

  const startedAt = Date.now();
  const remainingBudget = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  let sawQuota = false;
  let sawDailyQuota = false;
  let sawBusy = false;
  let sawTimeout = false;
  let sawUnclear = false;
  let sawInvalid = false;
  let lastError: string | undefined;
  let lastStatus: number | undefined;
  let callsMade = 0;

  // فاز اول: فقط مدل اصلی (gemini-1.5-flash) با هر ۵ کلید
  const primaryModel = GEMINI_PRIMARY_MODEL;
  const fallbackModel = GEMINI_FALLBACK_MODEL;

  // --- فاز اصلی ---
  {
    const keys = geminiKeyPool.order();
    for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
      const keyState = keys[keyIdx];
      if (callsMade >= MAX_CALLS_PER_REQUEST) {
        console.warn(`[gemini:text] سقف ${MAX_CALLS_PER_REQUEST} فراخوانی برای این درخواست پر شد.`);
        break;
      }
      if (remainingBudget() <= 3_000) {
        console.warn(`[gemini:text] بودجه زمانی کل به پایان رسید.`);
        break;
      }
      callsMade++;

      const contents = toGeminiContents(options.messages);
      const body = buildGeminiRequestBody(options.systemPrompt, contents as any, options.maxTokens);

      const callStart = Date.now();
      const outcome = await callGeminiWithBusyRetry(
        keyState.value,
        primaryModel,
        body as any,
        Math.min(PER_CALL_TIMEOUT_MS, Math.max(5_000, remainingBudget() - 800)),
      );
      const callDuration = Date.now() - callStart;

      // تشخیص زمان تحلیل بسیار طولانی (مثلاً > 22 ثانیه حتی اگر موفق باشد، برای لاگ)
      if (callDuration > 22_000) {
        console.warn(`[gemini:text] فراخوانی کلید ${keyState.label} روی مدل «${primaryModel}» ${Math.round(callDuration / 1000)} ثانیه طول کشید (بسیار طولانی).`);
        // اگر موفق بود اما خیلی طول کشید، آن را به‌عنوان نشانه برای fallback بعدی در نظر می‌گیریم
        // اما همین نتیجه را برمی‌گردانیم چون موفقیت کسب شده است.
      }

      if (outcome.ok && outcome.content) {
        const parsed = extractJsonObject<T>(outcome.content);
        if (parsed) {
          geminiKeyPool.reportSuccess(keyState.value);
          return {
            data: parsed,
            model: outcome.modelUsed || primaryModel,
            keyLabel: keyState.label,
            usage: outcome.usage,
          };
        }
        // JSON نامعتبر → مفهوم نامفهوم
        sawUnclear = true;
        geminiKeyPool.reportSuccess(keyState.value); // کلید سالم است، مدل نامفهوم داد
        lastError = 'خروجی مدل اصلی JSON معتبر نبود (مفهوم نامفهوم).';
        console.warn(`[gemini:text] مدل «${primaryModel}» با کلید ${keyState.label} JSON نامعتبر داد؛ تلاش با کلید بعدی همین مدل. مدت زمان: ${callDuration}ms`);
        continue;
      }

      // شکست
      lastError = outcome.errorMessage;
      lastStatus = outcome.status;
      const kind = classifyFailure(outcome.status, outcome.errorMessage || '');

      if (kind === 'quota') sawQuota = true;
      if (kind === 'daily_quota') {
        sawQuota = true;
        sawDailyQuota = true;
      }
      if (kind === 'busy') sawBusy = true;
      if (kind === 'invalid') sawInvalid = true;
      if (/abort/i.test(outcome.errorMessage || '') || callDuration >= PER_CALL_TIMEOUT_MS - 500) {
        sawTimeout = true;
      }

      // اگر مدل پیدا نشد (404) → مستقیم برو fallback (مدل منسوخ یا اشتباه تایپی)
      if (outcome.status === 404 || /model.*(not found|does not exist|not supported|is not found)/i.test(outcome.errorMessage || '')) {
        console.warn(`[gemini:text] مدل «${primaryModel}» یافت نشد؛ انتقال فوری به fallback «${fallbackModel}» با توجه به مشکل جدی مدل.`);
        sawBusy = true; // به‌عنوان مشکل جدی تلقی می‌شود
        break; // خروج از حلقه کلیدهای اصلی و رفتن به fallback
      }

      if (outcome.status === 400 && !/quota|rate|billing/i.test(outcome.errorMessage || '')) {
        // درخواست نامعتبر غیرقابل بازیابی (مثلاً systemInstruction غیرمجاز)
        throw new ProviderRequestError(
          `درخواست ارسالی به Gemini معتبر نبود: ${outcome.errorMessage}`,
          GEMINI_PROVIDER,
          400,
        );
      }

      geminiKeyPool.reportFailure(keyState.value, kind, outcome.retryAfterMs);
      console.warn(
        `[gemini:text] مدل «${primaryModel}» با کلید ${keyState.label} ناموفق بود (${kind}); ${keyIdx + 1 < keys.length ? 'چرخش بی‌درنگ به کلید بعدی' : 'پایان کلیدهای مدل اصلی'}.`,
      );

    }
  }

  // بررسی اتمام اعتبار همه کلیدها — طبق درخواست ۶ باید مدت انتظار را نشان دهیم
  const availableNow = geminiKeyPool.availableCount();
  const nextFreeMs = geminiKeyPool.nextAvailableInMs();

  if (availableNow === 0 && (sawQuota || sawDailyQuota)) {
    // اگر همه کلیدها به سقف خورده‌اند، دیگر fallback هم فایده ندارد (همان کلیدها)
    console.error(`[gemini:text] همه ${geminiKeyPool.size()} کلید به سقف خورده‌اند؛ انتظار ${nextFreeMs}ms`);
    throw new QuotaExhaustedError(
      buildQuotaMessage('Gemini', nextFreeMs),
      GEMINI_PROVIDER,
      nextFreeMs,
    );
  }

  // تصمیم برای fallback — فقط در صورت مشکلات جدی و طبق درخواست کارفرما «بدون سوئیچ سریع»
  // منطق: اگر primary تمام ۵ کلید را امتحان کرد و حداقل یکی از اینها رخ داد، آنگاه fallback مجاز است:
  // - busy (سرور شلوغ)
  // - timeout (زمان تحلیل بسیار طولانی)
  // - unclear (مفاهیم استخراج‌شده نامفهوم)
  // - invalid model / 404 / مشکلات جدی پاسخ‌گویی
  const shouldTryFallback =
    (sawBusy || sawTimeout || sawUnclear || lastStatus === 404) && fallbackModel !== primaryModel;

  if (!shouldTryFallback) {
    // اگر هیچ دلیل جدی نداشته‌ایم و فقط quota بوده که already handled شد، خطای مناسب پرتاب کن
    console.error(`[gemini:text] مدل اصلی «${primaryModel}» ناموفق بود ولی شرایط fallback احراز نشد. آخرین خطا (${lastStatus ?? '-'}): ${lastError}`);
    if (sawQuota) {
      throw new QuotaExhaustedError(buildQuotaMessage('Gemini', nextFreeMs), GEMINI_PROVIDER, nextFreeMs);
    }
    if (sawTimeout) {
      throw new ModelTimeoutError(undefined, GEMINI_PROVIDER);
    }
    if (sawInvalid && geminiKeyPool.size() > 0 && availableNow === 0) {
      throw new MissingApiKeyError(undefined, GEMINI_PROVIDER);
    }
    throw new ModelBusyError(undefined, GEMINI_PROVIDER);
  }

  // --- فاز دوم: fallback (gemini-1.5-flash) — فقط پس از احراز شرایط جدی ---
  console.warn(
    `[gemini:text] شرایط سوئیچ به fallback احراز شد (busy=${sawBusy} timeout=${sawTimeout} unclear=${sawUnclear} status=${lastStatus}). شروع تلاش با مدل fallback «${fallbackModel}» روی ${geminiKeyPool.size()} کلید.`,
  );

  {
    const keys = geminiKeyPool.order(); // ترتیب تازه پس از reportFailureهای قبلی
    for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
      const keyState = keys[keyIdx];
      if (callsMade >= MAX_CALLS_PER_REQUEST) {
        console.warn(`[gemini:text:fallback] سقف فراخوانی پر شد.`);
        break;
      }
      if (remainingBudget() <= 3_000) break;
      callsMade++;

      const contents = toGeminiContents(options.messages);
      const body = buildGeminiRequestBody(options.systemPrompt, contents as any, options.maxTokens);

      const outcome = await callGeminiWithBusyRetry(
        keyState.value,
        fallbackModel,
        body as any,
        Math.min(PER_CALL_TIMEOUT_MS, Math.max(5_000, remainingBudget() - 800)),
      );

      if (outcome.ok && outcome.content) {
        const parsed = extractJsonObject<T>(outcome.content);
        if (parsed) {
          geminiKeyPool.reportSuccess(keyState.value);
          console.log(`[gemini:text:fallback] مدل «${fallbackModel}» با کلید ${keyState.label} موفق بود (پس از شکست مدل اصلی).`);
          return {
            data: parsed,
            model: outcome.modelUsed || fallbackModel,
            keyLabel: keyState.label,
            usage: outcome.usage,
          };
        }
        // fallback هم JSON نامعتبر داد → همچنان نامفهوم
        lastError = 'خروجی مدل fallback هم JSON معتبر نبود.';
        geminiKeyPool.reportSuccess(keyState.value);
        console.warn(`[gemini:text:fallback] مدل «${fallbackModel}» JSON نامعتبر داد.`);
        continue;
      }

      lastError = outcome.errorMessage;
      lastStatus = outcome.status;
      const kind = classifyFailure(outcome.status, outcome.errorMessage || '');

      if (kind === 'quota') sawQuota = true;
      if (kind === 'daily_quota') sawDailyQuota = true;
      if (kind === 'busy') sawBusy = true;
      if (/abort/i.test(outcome.errorMessage || '')) sawTimeout = true;

      geminiKeyPool.reportFailure(keyState.value, kind, outcome.retryAfterMs);

      if (outcome.status === 400 && !/quota|rate/i.test(outcome.errorMessage || '')) {
        throw new ProviderRequestError(
          `درخواست fallback به Gemini نامعتبر بود: ${outcome.errorMessage}`,
          GEMINI_PROVIDER,
          400,
        );
      }

      console.warn(
        `[gemini:text:fallback] مدل «${fallbackModel}» با کلید ${keyState.label} ناموفق بود (${kind}).`,
      );
    }
  }

  // اگر به اینجا رسیدیم، هر دو مدل روی همه کلیدها ناموفق بوده‌اند
  console.error(
    `[gemini:text] همه کلیدها روی هر دو مدل ناموفق بودند. آخرین خطا (${lastStatus ?? '-'}): ${lastError}`,
  );

  if (geminiKeyPool.availableCount() === 0 && sawQuota) {
    const waitMs = geminiKeyPool.nextAvailableInMs();
    throw new QuotaExhaustedError(buildQuotaMessage('Gemini', waitMs), GEMINI_PROVIDER, waitMs);
  }
  if (sawTimeout) throw new ModelTimeoutError(undefined, GEMINI_PROVIDER);
  throw new ModelBusyError(undefined, GEMINI_PROVIDER);
}

// ---------------------------------------------------------------------------
// تابع تصویری (Vision / OCR) — همان موتور Gemini اما با inlineData تصویر
// ---------------------------------------------------------------------------

export async function generateGeminiVision<T = Record<string, unknown>>(
  options: GeminiVisionOptions,
): Promise<GeminiVisionResult<T>> {
  if (geminiKeyPool.size() === 0) {
    throw new MissingApiKeyError(
      'کلید API سرویس Gemini تنظیم نشده است؛ در Vercel متغیرهای GEMINI_API_KEY تا GEMINI_API_KEY_5 را اضافه کنید.',
      GEMINI_PROVIDER,
    );
  }

  const startedAt = Date.now();
  const remainingBudget = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  let sawQuota = false;
  let sawDailyQuota = false;
  let sawBusy = false;
  let sawTimeout = false;
  let sawUnclear = false;
  let lastError: string | undefined;
  let lastStatus: number | undefined;
  let callsMade = 0;

  const primaryModel = GEMINI_PRIMARY_MODEL;
  const fallbackModel = GEMINI_FALLBACK_MODEL;

  // helper برای ساخت body تصویر
  const buildVisionBody = (systemPrompt: string, userText: string, imageBase64: string, mimeType: string, maxTokens?: number) => {
    const contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }> = [
      {
        role: 'user',
        parts: [
          { text: userText },
          {
            inlineData: {
              mimeType,
              data: imageBase64,
            },
          },
        ],
      },
    ];
    return buildGeminiRequestBody(systemPrompt, contents, maxTokens);
  };

  // --- فاز اصلی: gemini-1.5-flash با هر ۵ کلید ---
  for (let keyIdx = 0; keyIdx < geminiKeyPool.order().length; keyIdx++) {
    const keyState = geminiKeyPool.order()[keyIdx];
    if (callsMade >= MAX_CALLS_PER_REQUEST) break;
    if (remainingBudget() <= 3_500) break;
    callsMade++;

    const body = buildVisionBody(options.systemPrompt, options.userText, options.imageBase64, options.mimeType, options.maxTokens);

    const callStart = Date.now();
    const outcome = await callGeminiWithBusyRetry(
      keyState.value,
      primaryModel,
      body as any,
      Math.min(PER_CALL_TIMEOUT_MS, Math.max(6_000, remainingBudget() - 1_000)),
    );
    const callDuration = Date.now() - callStart;

    if (outcome.ok && outcome.content) {
      const parsed = extractJsonObject<T>(outcome.content);
      if (parsed) {
        geminiKeyPool.reportSuccess(keyState.value);
        return {
          data: parsed,
          model: outcome.modelUsed || primaryModel,
          keyLabel: keyState.label,
          usedFallback: false,
          usage: outcome.usage,
        };
      }
      sawUnclear = true;
      geminiKeyPool.reportSuccess(keyState.value);
      lastError = 'خروجی بینایی مدل اصلی JSON نامعتبر بود.';
      console.warn(`[gemini:vision] مدل «${primaryModel}» تصویر را خواند ولی JSON نامعتبر داد (${callDuration}ms)؛ سعی با کلید بعدی.`);
      continue;
    }

    lastError = outcome.errorMessage;
    lastStatus = outcome.status;
    const kind = classifyFailure(outcome.status, outcome.errorMessage || '');

    if (kind === 'quota') sawQuota = true;
    if (kind === 'daily_quota') {
      sawQuota = true;
      sawDailyQuota = true;
    }
    if (kind === 'busy') sawBusy = true;
    if (/abort/i.test(outcome.errorMessage || '') || callDuration >= PER_CALL_TIMEOUT_MS - 500) sawTimeout = true;

    if (outcome.status === 404 || /model.*(not found|does not exist)/i.test(outcome.errorMessage || '')) {
      console.warn(`[gemini:vision] مدل «${primaryModel}» یافت نشد؛ سوئیچ فوری به fallback.`);
      sawBusy = true;
      break;
    }

    if (outcome.status === 400 && !/quota|rate/i.test(outcome.errorMessage || '')) {
      // ممکن است به دلیل فرمت تصویر نامعتبر باشد — برای بینایی، به fallback شانس می‌دهیم
      if (primaryModel !== fallbackModel) {
        console.warn(`[gemini:vision] مدل «${primaryModel}» درخواست تصویر را نپذیرفت؛ تست fallback.`);
        sawBusy = true;
        break;
      }
      throw new ProviderRequestError(
        `درخواست تصویری به Gemini معتبر نبود: ${outcome.errorMessage}`,
        GEMINI_PROVIDER,
        400,
      );
    }

    geminiKeyPool.reportFailure(keyState.value, kind, outcome.retryAfterMs);
    console.warn(`[gemini:vision] مدل «${primaryModel}» با کلید ${keyState.label} ناموفق بود (${kind}).`);

  }

  const availableNow = geminiKeyPool.availableCount();
  const nextFreeMs = geminiKeyPool.nextAvailableInMs();

  if (availableNow === 0 && (sawQuota || sawDailyQuota)) {
    throw new QuotaExhaustedError(
      buildQuotaMessage('تحلیل تصویر Gemini', nextFreeMs),
      GEMINI_PROVIDER,
      nextFreeMs,
    );
  }

  const shouldTryFallback =
    (sawBusy || sawTimeout || sawUnclear || lastStatus === 404 || lastStatus === 400) &&
    fallbackModel !== primaryModel;

  if (!shouldTryFallback) {
    if (sawQuota) {
      throw new QuotaExhaustedError(buildQuotaMessage('تحلیل تصویر Gemini', nextFreeMs), GEMINI_PROVIDER, nextFreeMs);
    }
    if (sawTimeout) throw new ModelTimeoutError(undefined, GEMINI_PROVIDER);
    throw new ModelBusyError(undefined, GEMINI_PROVIDER);
  }

  console.warn(
    `[gemini:vision] سوئیچ به fallback «${fallbackModel}» (busy=${sawBusy} timeout=${sawTimeout} unclear=${sawUnclear})`,
  );

  // --- فاز fallback: gemini-1.5-flash ---
  for (let keyIdx = 0; keyIdx < geminiKeyPool.order().length; keyIdx++) {
    const keyState = geminiKeyPool.order()[keyIdx];
    if (callsMade >= MAX_CALLS_PER_REQUEST) break;
    if (remainingBudget() <= 3_500) break;
    callsMade++;

    const body = buildVisionBody(
      options.systemPrompt,
      options.userText,
      options.imageBase64,
      options.mimeType,
      options.maxTokens,
    );

    const outcome = await callGeminiWithBusyRetry(
      keyState.value,
      fallbackModel,
      body as any,
      Math.min(PER_CALL_TIMEOUT_MS, Math.max(6_000, remainingBudget() - 1_000)),
    );

    if (outcome.ok && outcome.content) {
      const parsed = extractJsonObject<T>(outcome.content);
      if (parsed) {
        geminiKeyPool.reportSuccess(keyState.value);
        console.log(`[gemini:vision] fallback «${fallbackModel}» موفق بود.`);
        return {
          data: parsed,
          model: outcome.modelUsed || fallbackModel,
          keyLabel: keyState.label,
          usedFallback: true,
          usage: outcome.usage,
        };
      }
      lastError = 'fallback هم JSON نامعتبر داد.';
      geminiKeyPool.reportSuccess(keyState.value);
      continue;
    }

    lastError = outcome.errorMessage;
    lastStatus = outcome.status;
    const kind = classifyFailure(outcome.status, outcome.errorMessage || '');
    if (kind === 'quota') sawQuota = true;
    if (kind === 'busy') sawBusy = true;
    if (/abort/i.test(outcome.errorMessage || '')) sawTimeout = true;

    geminiKeyPool.reportFailure(keyState.value, kind, outcome.retryAfterMs);
  }

  console.error(`[gemini:vision] هر دو مدل روی همه کلیدها ناموفق بودند؛ آخرین خطا: ${lastError}`);

  if (geminiKeyPool.availableCount() === 0 && sawQuota) {
    const waitMs = geminiKeyPool.nextAvailableInMs();
    throw new QuotaExhaustedError(
      `${buildQuotaMessage('تحلیل تصویر Gemini', waitMs)} اگر عجله داری، همان درخواست را متنی بنویس.`,
      GEMINI_PROVIDER,
      waitMs,
    );
  }
  if (sawTimeout) throw new ModelTimeoutError(undefined, GEMINI_PROVIDER);
  throw new ModelBusyError(undefined, GEMINI_PROVIDER);
}

// ---------------------------------------------------------------------------
// سازگاری با نام‌های قدیمی (برای اینکه مسیرهای API قدیمی نشکنند)
// ---------------------------------------------------------------------------

export const GEMINI_PROVIDER_ALIAS = GEMINI_PROVIDER;
export const geminiKeyPoolAlias = geminiKeyPool;

export function getTextModelChain(): string[] {
  return getGeminiModelChain();
}
export function getVisionModelChain(): string[] {
  return getGeminiModelChain();
}
export function getGeminiVisionModelChain(): string[] {
  return getGeminiModelChain();
}

// Types برای export در index.ts
export type GeminiVisionResultAlias<T = Record<string, unknown>> = GeminiVisionResult<T>;
