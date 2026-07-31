/**
 * lib/ai/puter.ts
 * ---------------------------------------------------------------------------
 * موتور واحد چت‌باکس: Puter.js — از طریق endpoint سازگار با OpenAI که
 * Puter.com ارائه می‌دهد (https://api.puter.com/puterai/openai/v1).
 *
 * چرا Puter به‌جای Groq/Gemini جداگانه؟
 *   - Puter از مدل «User-Pays» استفاده می‌کند: هر توکن Puter (Auth Token) به
 *     یک حساب Puter متصل است و مصرف از سهمیهٔ رایگان ماهانهٔ همان حساب کم
 *     می‌شود؛ این سهمیه به‌مراتب سخاوتمندانه‌تر از سقف روزانهٔ کلیدهای رایگان
 *     Groq/Gemini است.
 *   - یک endpoint واحد و سازگار با OpenAI هم متن و هم تصویر (vision) را
 *     پشتیبانی می‌کند، پس دیگر لازم نیست دو سرویس کاملاً جدا نگه داریم.
 *
 * معماری (ادامهٔ همان الگوی قبلی، فقط تک‌موتوره):
 *   - استخر توکن با چرخش خودکار بین چند توکن Puter (چند حساب Puter، اگر کاربر
 *     چند اکانت در اختیار بگذارد) دقیقاً مثل ApiKeyPool قبلی.
 *   - زنجیرهٔ مدل جایگزین برای وقتی یک مدل موقتاً پاسخ نمی‌دهد یا برای توکن
 *     فعلی در دسترس نیست.
 *   - تایم‌اوت هر فراخوانی + سقف بودجهٔ کل، تا مسیر API همیشه قبل از کشته‌شدن
 *     تابع سرورلس یک پاسخ JSON تمیز برگرداند.
 *
 * نحوهٔ گرفتن توکن (برای کاربر پروژه):
 *   1. وارد https://puter.com/dashboard#account شوید (یا حساب بسازید).
 *   2. در بخش «API token» روی «Create token» بزنید.
 *   3. مقدار را در PUTER_AUTH_TOKEN بگذارید (یا _2 / _3 برای چند حساب).
 */

import { ApiKeyPool, classifyFailure, parseRetryAfterMs } from "./key-pool";
import {
  buildQuotaMessage,
  MissingApiKeyError,
  ModelBusyError,
  ModelTimeoutError,
  ProviderRequestError,
  QuotaExhaustedError,
} from "./errors";
import { extractJsonObject } from "./json";

export const PUTER_PROVIDER = "puter";

const PUTER_ENDPOINT = process.env.PUTER_BASE_URL
  ? `${process.env.PUTER_BASE_URL.replace(/\/+$/, "")}/chat/completions`
  : "https://api.puter.com/puterai/openai/v1/chat/completions";

/**
 * مدل اصلی گفت‌وگوی متنی. `gpt-5.4-nano` سریع، رایگان‌ترین ردهٔ مدل‌های
 * Puter و برای این کار (تبدیل جملهٔ فارسی به JSON ساختاریافته) کاملاً کافی
 * است؛ در صورت نیاز به لحن گرم‌تر می‌توان با PUTER_MODEL مدل قوی‌تری گذاشت.
 */
export const PUTER_MODEL = process.env.PUTER_MODEL || "gpt-5.4-nano";

/** زنجیرهٔ جایگزین متن — همه از فروشندگان مختلف تا شلوغی یکی روی بقیه اثر نگذارد. */
const DEFAULT_PUTER_TEXT_FALLBACKS = ["gpt-5.3-chat", "google/gemini-3.5-flash-lite"];

const CONFIGURED_TEXT_FALLBACKS = (process.env.PUTER_FALLBACK_MODELS || "")
  .split(",")
  .map(model => model.trim())
  .filter(Boolean);

const TEXT_MODEL_CHAIN = Array.from(
  new Set([
    PUTER_MODEL,
    ...(CONFIGURED_TEXT_FALLBACKS.length > 0 ? CONFIGURED_TEXT_FALLBACKS : DEFAULT_PUTER_TEXT_FALLBACKS),
  ]),
);

export function getPuterModelChain(): string[] {
  return [...TEXT_MODEL_CHAIN];
}

/**
 * مدل اصلی بینایی (تحلیل تصویر). همان `gpt-5.4-nano` قابلیت vision دارد؛
 * برای پایداری بیشتر یک مدل Gemini سبک هم به‌عنوان جایگزین در نظر گرفته شده.
 */
export const PUTER_VISION_MODEL = process.env.PUTER_VISION_MODEL || "gpt-5.4-nano";

const DEFAULT_PUTER_VISION_FALLBACKS = ["google/gemini-3.5-flash-lite", "gpt-5.3-chat"];

const CONFIGURED_VISION_FALLBACKS = (process.env.PUTER_VISION_FALLBACK_MODELS || "")
  .split(",")
  .map(model => model.trim())
  .filter(Boolean);

const VISION_MODEL_CHAIN = Array.from(
  new Set([
    PUTER_VISION_MODEL,
    ...(CONFIGURED_VISION_FALLBACKS.length > 0 ? CONFIGURED_VISION_FALLBACKS : DEFAULT_PUTER_VISION_FALLBACKS),
  ]),
);

export function getPuterVisionModelChain(): string[] {
  return [...VISION_MODEL_CHAIN];
}

/**
 * استخر توکن‌های Puter. هر توکن به یک حساب Puter جداگانه تعلق دارد؛ اگر
 * کاربر چند حساب Puter در اختیار بگذارد، سهمیهٔ رایگان ماهانه عملاً چند
 * برابر می‌شود (دقیقاً مثل چرخش کلید Groq/Gemini قبلی).
 * در Vercel این متغیرها را تعریف کنید:
 *   PUTER_AUTH_TOKEN, PUTER_AUTH_TOKEN_2, PUTER_AUTH_TOKEN_3
 * (یا همه را با کاما داخل PUTER_AUTH_TOKENS.)
 */
export const puterKeyPool = new ApiKeyPool({
  provider: PUTER_PROVIDER,
  envNames: ["PUTER_AUTH_TOKEN", "PUTER_AUTH_TOKEN_2", "PUTER_AUTH_TOKEN_3", "PUTER_AUTH_TOKENS"],
});

/** تایم‌اوت هر فراخوانی. */
const PER_CALL_TIMEOUT_MS = Math.max(4_000, Number(process.env.PUTER_CALL_TIMEOUT_MS) || 22_000);

/** سقف کل بودجهٔ زمانی یک درخواست منطقی (کمتر از maxDuration مسیر API). */
const TOTAL_BUDGET_MS = Math.max(6_000, Number(process.env.PUTER_TOTAL_BUDGET_MS) || 45_000);

/** حداکثر توکن خروجی. */
const MAX_OUTPUT_TOKENS = Math.max(512, Number(process.env.PUTER_MAX_OUTPUT_TOKENS) || 1_500);

/** دما — بالاتر از صفر تا لحن خشک/تکراری نشود، ولی همچنان JSON پایدار بماند. */
const TEMPERATURE = Number.isFinite(Number(process.env.PUTER_TEMPERATURE))
  ? Number(process.env.PUTER_TEMPERATURE)
  : 0.6;

/** سقف تعداد فراخوانی واقعی برای یک درخواست کاربر (محافظ سهمیه/هزینه). */
const MAX_CALLS_PER_REQUEST = Math.max(1, Number(process.env.PUTER_MAX_CALLS_PER_REQUEST) || 4);

export type PuterContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface PuterMessage {
  role: "system" | "user" | "assistant";
  content: string | PuterContentPart[];
}

export interface PuterJsonOptions {
  /** پیام‌های گفت‌وگو (بدون system؛ system جداگانه پاس داده می‌شود). */
  messages: PuterMessage[];
  /** دستور سیستمی. */
  systemPrompt: string;
  /** حداکثر توکن خروجی (اختیاری). */
  maxTokens?: number;
}

export interface PuterJsonResult<T> {
  data: T;
  /** مدلی که واقعاً پاسخ داد (برای لاگ/تشخیص). */
  model: string;
  /** برچسب توکنی که پاسخ داد (ماسک‌شده). */
  keyLabel: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface PuterCallOutcome {
  ok: boolean;
  status?: number;
  content?: string;
  errorMessage?: string;
  retryAfterMs?: number;
}

async function callPuterOnce(
  authToken: string,
  model: string,
  options: PuterJsonOptions,
  timeoutMs: number,
): Promise<PuterCallOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestBody: Record<string, unknown> = {
      model,
      temperature: TEMPERATURE,
      max_tokens: options.maxTokens ?? MAX_OUTPUT_TOKENS,
      // خروجی همیشه یک شیء JSON معتبر است.
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: options.systemPrompt }, ...options.messages],
    };

    const response = await fetch(PUTER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      signal: controller.signal,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const rawBody = await response.text().catch(() => "");
      let providerMessage = rawBody;
      try {
        const parsed = JSON.parse(rawBody);
        providerMessage = parsed?.error?.message || parsed?.message || rawBody;
      } catch {
        // بدنه JSON نبود؛ همان متن خام استفاده می‌شود.
      }
      return {
        ok: false,
        status: response.status,
        errorMessage: providerMessage || `Puter HTTP ${response.status}`,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after"), providerMessage),
      };
    }

    const payload = await response.json();
    const content: string | undefined = payload?.choices?.[0]?.message?.content;
    if (!content) {
      return { ok: false, status: 502, errorMessage: "Puter پاسخ خالی برگرداند." };
    }
    return { ok: true, content };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, errorMessage: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * هستهٔ مشترک: فراخوانی Puter با چرخش توکن و مدل، و تضمین خروجی JSON.
 *
 * ترتیب تلاش:
 *   مدل ۱ با توکن ۱ → توکن ۲ → توکن ۳ → مدل ۲ با توکن ۱ → …
 */
async function generatePuterJsonWithChain<T = Record<string, unknown>>(
  options: PuterJsonOptions,
  modelChain: string[],
  roleLabel: string,
): Promise<PuterJsonResult<T>> {
  if (puterKeyPool.size() === 0) {
    throw new MissingApiKeyError(
      "هیچ توکن Puter تنظیم نشده است؛ متغیر PUTER_AUTH_TOKEN را در Vercel اضافه کنید (از puter.com/dashboard#account).",
      PUTER_PROVIDER,
    );
  }

  const startedAt = Date.now();
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  let sawQuota = false;
  let sawBusy = false;
  let sawTimeout = false;
  let lastError: string | undefined;
  let lastStatus: number | undefined;

  let callsMade = 0;

  for (const model of modelChain) {
    const keys = puterKeyPool.order();
    for (let index = 0; index < keys.length; index++) {
      const keyState = keys[index];
      if (callsMade >= MAX_CALLS_PER_REQUEST) {
        console.warn(`[puter] سقف ${MAX_CALLS_PER_REQUEST} فراخوانی برای این درخواست پر شد؛ توقف برای حفظ سهمیه.`);
        throw sawQuota
          ? new QuotaExhaustedError(undefined, PUTER_PROVIDER, puterKeyPool.nextAvailableInMs())
          : new ModelBusyError(undefined, PUTER_PROVIDER);
      }
      if (remaining() <= 2_000) {
        throw sawQuota
          ? new QuotaExhaustedError(undefined, PUTER_PROVIDER, puterKeyPool.nextAvailableInMs())
          : new ModelTimeoutError(undefined, PUTER_PROVIDER);
      }
      callsMade++;

      const outcome = await callPuterOnce(
        keyState.value,
        model,
        options,
        Math.min(PER_CALL_TIMEOUT_MS, Math.max(3_500, remaining() - 1_000)),
      );

      if (outcome.ok) {
        const parsed = extractJsonObject<T>(outcome.content);
        if (parsed) {
          puterKeyPool.reportSuccess(keyState.value);
          return { data: parsed, model, keyLabel: keyState.label };
        }
        puterKeyPool.reportSuccess(keyState.value);
        lastError = "خروجی مدل JSON معتبر نبود.";
        console.warn(`[puter] مدل «${model}» خروجی غیر-JSON داد؛ تلاش بعدی.`);
        continue;
      }

      lastError = outcome.errorMessage;
      lastStatus = outcome.status;
      const kind = classifyFailure(outcome.status, outcome.errorMessage || "");

      if (kind === "quota") sawQuota = true;
      if (kind === "busy") sawBusy = true;
      if (/abort/i.test(outcome.errorMessage || "")) sawTimeout = true;

      // مدل ناشناخته/غیرفعال برای این توکن → رفتن به مدل بعدی، نه توکن بعدی.
      if (outcome.status === 404 || /model.*(not found|does not exist|unsupported)/i.test(outcome.errorMessage || "")) {
        console.warn(`[puter] مدل «${model}» در دسترس نیست؛ رفتن به مدل بعدی.`);
        break;
      }

      // درخواست نامعتبر (۴۰۰) ربطی به توکن ندارد: تلاش بیشتر بی‌فایده است.
      if (outcome.status === 400) {
        throw new ProviderRequestError(
          `درخواست ارسالی به Puter معتبر نبود: ${outcome.errorMessage}`,
          PUTER_PROVIDER,
          400,
        );
      }

      puterKeyPool.reportFailure(keyState.value, kind, outcome.retryAfterMs);
      console.warn(
        `[puter] مدل «${model}» با توکن ${keyState.label} ناموفق بود (${kind}); ${
          index + 1 < keys.length ? "چرخش به توکن بعدی" : "چرخش به مدل بعدی"
        }.`,
      );

      if (kind === "busy" && remaining() > 4_000) {
        await sleep(Math.min(400, Math.max(0, remaining() - 3_000)));
      }
    }
  }

  console.error(
    `[puter] همهٔ توکن‌ها و مدل‌ها برای «${roleLabel}» ناموفق بودند. آخرین خطا (${lastStatus ?? "-"}): ${lastError ?? "نامشخص"}`,
  );

  if (sawQuota) {
    const waitMs = puterKeyPool.nextAvailableInMs();
    throw new QuotaExhaustedError(buildQuotaMessage(roleLabel, waitMs), PUTER_PROVIDER, waitMs);
  }
  if (sawTimeout && !sawBusy) {
    throw new ModelTimeoutError(undefined, PUTER_PROVIDER);
  }
  throw new ModelBusyError(undefined, PUTER_PROVIDER);
}

/** گفت‌وگوی متنی چت‌باکس (پیام‌های تایپ‌شده). */
export async function generatePuterJson<T = Record<string, unknown>>(
  options: PuterJsonOptions,
): Promise<PuterJsonResult<T>> {
  return generatePuterJsonWithChain<T>(options, TEXT_MODEL_CHAIN, "گفت‌وگوی متنی");
}

/** تحلیل تصویر ارسالی در چت‌باکس (همان endpoint، همان توکن‌ها، مدل‌های vision-capable). */
export async function generatePuterVisionJson<T = Record<string, unknown>>(
  options: PuterJsonOptions,
): Promise<PuterJsonResult<T>> {
  return generatePuterJsonWithChain<T>(options, VISION_MODEL_CHAIN, "تحلیل تصویر");
}
