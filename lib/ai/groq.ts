/**
 * lib/ai/groq.ts
 * ---------------------------------------------------------------------------
 * موتور تحلیل «متن» چت‌باکس: Groq (Llama).
 *
 * چرا Groq برای متن؟
 *   - مدل‌های Llama 3.3 70B / 3.1 8B روی سخت‌افزار LPU با سرعت بسیار بالا
 *     (چند صد توکن بر ثانیه) و در پلن رایگان اجرا می‌شوند.
 *   - سهمیهٔ رایگان روزانه سخاوتمندانه است و با ۳ کلید عملاً سه برابر می‌شود.
 *
 * قواعد جداسازی (مطابق معماری خواسته‌شده):
 *   - این ماژول *فقط* برای پیام‌های متنی استفاده می‌شود.
 *   - هیچ تصویری به Groq فرستاده نمی‌شود و هیچ کلید Gemini در اینجا خوانده نمی‌شود.
 *   - سهمیهٔ Groq و Gemini کاملاً مستقل مدیریت می‌شوند (دو استخر کلید جدا).
 *
 * پایداری:
 *   - چرخش خودکار بین ۳ کلید (GROQ_API_KEY / _2 / _3) هنگام ۴۲۹ یا اتمام سهمیه.
 *   - زنجیرهٔ مدل جایگزین وقتی همهٔ کلیدها روی مدل اول به سقف خورده‌اند.
 *   - تایم‌اوت هر فراخوانی + سقف بودجهٔ کل، تا مسیر API همیشه قبل از کشته‌شدن
 *     تابع سرورلس یک پاسخ JSON تمیز برگرداند.
 */

import { ApiKeyPool, classifyFailure, parseRetryAfterMs } from "./key-pool";
import {
  MissingApiKeyError,
  ModelBusyError,
  ModelTimeoutError,
  ProviderRequestError,
  QuotaExhaustedError,
} from "./errors";
import { extractJsonObject } from "./json";

export const GROQ_PROVIDER = "groq";

const GROQ_ENDPOINT = process.env.GROQ_BASE_URL
  ? `${process.env.GROQ_BASE_URL.replace(/\/+$/, "")}/chat/completions`
  : "https://api.groq.com/openai/v1/chat/completions";

/**
 * مدل اصلی متنی. پیش‌فرض روی Llama 3.3 70B (قوی‌ترین گزینهٔ رایگان Groq برای
 * درک محاوره و اصطلاحات فارسی پرستاری) تنظیم شده است.
 */
export const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

/**
 * زنجیرهٔ جایگزین: وقتی هر سه کلید روی مدل اصلی به سقف خوردند، مدل سبک‌تر با
 * سهمیهٔ روزانهٔ بسیار بالاتر (۸B) وارد عمل می‌شود تا چت‌باکس هرگز از کار نیفتد.
 */
const DEFAULT_GROQ_FALLBACK_MODELS = ["llama-3.1-8b-instant", "openai/gpt-oss-20b"];

const CONFIGURED_FALLBACKS = (process.env.GROQ_FALLBACK_MODELS || "")
  .split(",")
  .map(model => model.trim())
  .filter(Boolean);

const MODEL_CHAIN = Array.from(
  new Set([
    GROQ_MODEL,
    ...(CONFIGURED_FALLBACKS.length > 0 ? CONFIGURED_FALLBACKS : DEFAULT_GROQ_FALLBACK_MODELS),
  ]),
);

export function getGroqModelChain(): string[] {
  return [...MODEL_CHAIN];
}

/**
 * استخر کلیدهای Groq — سه کلید رایگان.
 * در Vercel این متغیرها را تعریف کنید:
 *   GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3
 * (به‌جای آن می‌توانید هر سه را با کاما داخل GROQ_API_KEYS بگذارید.)
 */
export const groqKeyPool = new ApiKeyPool({
  provider: GROQ_PROVIDER,
  envNames: ["GROQ_API_KEY", "GROQ_API_KEY_2", "GROQ_API_KEY_3", "GROQ_API_KEYS"],
});

/** تایم‌اوت هر فراخوانی (Groq معمولاً زیر ۵ ثانیه پاسخ می‌دهد). */
const PER_CALL_TIMEOUT_MS = Math.max(4_000, Number(process.env.GROQ_CALL_TIMEOUT_MS) || 20_000);

/** سقف کل بودجهٔ زمانی یک درخواست منطقی (کمتر از maxDuration مسیر API). */
const TOTAL_BUDGET_MS = Math.max(6_000, Number(process.env.GROQ_TOTAL_BUDGET_MS) || 42_000);

/** حداکثر توکن خروجی. */
const MAX_OUTPUT_TOKENS = Math.max(256, Number(process.env.GROQ_MAX_OUTPUT_TOKENS) || 2_048);

/** دمای پایین: خروجی ساختاریافته و قابل پیش‌بینی. */
const TEMPERATURE = Number.isFinite(Number(process.env.GROQ_TEMPERATURE))
  ? Number(process.env.GROQ_TEMPERATURE)
  : 0.2;

export interface GroqMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GroqJsonOptions {
  /** پیام‌های گفت‌وگو (بدون system؛ system جداگانه پاس داده می‌شود). */
  messages: GroqMessage[];
  /** دستور سیستمی. */
  systemPrompt: string;
  /** حداکثر توکن خروجی (اختیاری). */
  maxTokens?: number;
}

export interface GroqJsonResult<T> {
  data: T;
  /** مدلی که واقعاً پاسخ داد (برای لاگ/تشخیص). */
  model: string;
  /** برچسب کلیدی که پاسخ داد (ماسک‌شده). */
  keyLabel: string;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface GroqCallOutcome {
  ok: boolean;
  status?: number;
  content?: string;
  errorMessage?: string;
  retryAfterMs?: number;
}

async function callGroqOnce(
  apiKey: string,
  model: string,
  options: GroqJsonOptions,
  timeoutMs: number,
): Promise<GroqCallOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: TEMPERATURE,
        max_tokens: options.maxTokens ?? MAX_OUTPUT_TOKENS,
        // JSON mode: خروجی همیشه یک شیء JSON معتبر است.
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: options.systemPrompt },
          ...options.messages,
        ],
      }),
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
        errorMessage: providerMessage || `Groq HTTP ${response.status}`,
        retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after"), providerMessage),
      };
    }

    const payload = await response.json();
    const content: string | undefined = payload?.choices?.[0]?.message?.content;
    if (!content) {
      return { ok: false, status: 502, errorMessage: "Groq پاسخ خالی برگرداند." };
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
 * فراخوانی Groq با چرخش کلید و مدل، و تضمین خروجی JSON.
 *
 * ترتیب تلاش (مطابق خواستهٔ محصول):
 *   مدل ۱ با کلید ۱ → کلید ۲ → کلید ۳ → مدل ۲ با کلید ۱ → …
 * یعنی اول همهٔ کلیدها روی بهترین مدل امتحان می‌شوند و فقط وقتی هر سه کلید
 * به سقف خوردند، مدل سبک‌تر جایگزین می‌شود.
 */
export async function generateGroqJson<T = Record<string, unknown>>(
  options: GroqJsonOptions,
): Promise<GroqJsonResult<T>> {
  if (groqKeyPool.size() === 0) {
    throw new MissingApiKeyError(
      "کلید API سرویس Groq تنظیم نشده است؛ متغیر GROQ_API_KEY را در Vercel اضافه کنید.",
      GROQ_PROVIDER,
    );
  }

  const startedAt = Date.now();
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  let sawQuota = false;
  let sawBusy = false;
  let sawTimeout = false;
  let lastError: string | undefined;
  let lastStatus: number | undefined;

  for (const model of MODEL_CHAIN) {
    const keys = groqKeyPool.order();
    for (let index = 0; index < keys.length; index++) {
      const keyState = keys[index];
      if (remaining() <= 2_000) {
        throw sawQuota
          ? new QuotaExhaustedError(undefined, GROQ_PROVIDER, groqKeyPool.nextAvailableInMs())
          : new ModelTimeoutError(undefined, GROQ_PROVIDER);
      }

      const outcome = await callGroqOnce(
        keyState.value,
        model,
        options,
        Math.min(PER_CALL_TIMEOUT_MS, Math.max(3_500, remaining() - 1_000)),
      );

      if (outcome.ok) {
        const parsed = extractJsonObject<T>(outcome.content);
        if (parsed) {
          groqKeyPool.reportSuccess(keyState.value);
          return { data: parsed, model, keyLabel: keyState.label };
        }
        // پاسخ آمد اما JSON معتبر نبود: کلید سالم است، فقط یک بار دیگر
        // (روی همین مدل/کلید بعدی) تلاش می‌کنیم.
        groqKeyPool.reportSuccess(keyState.value);
        lastError = "خروجی مدل JSON معتبر نبود.";
        console.warn(`[groq] مدل «${model}» خروجی غیر-JSON داد؛ تلاش بعدی.`);
        continue;
      }

      lastError = outcome.errorMessage;
      lastStatus = outcome.status;
      const kind = classifyFailure(outcome.status, outcome.errorMessage || "");

      if (kind === "quota") sawQuota = true;
      if (kind === "busy") sawBusy = true;
      if (/abort/i.test(outcome.errorMessage || "")) sawTimeout = true;

      // مدل ناشناخته برای این حساب → رفتن به مدل بعدی، نه کلید بعدی.
      if (outcome.status === 404 || /model.*(not found|does not exist|decommissioned)/i.test(outcome.errorMessage || "")) {
        console.warn(`[groq] مدل «${model}» در دسترس نیست؛ رفتن به مدل بعدی.`);
        break;
      }

      // درخواست نامعتبر (۴۰۰) ربطی به کلید ندارد: تلاش بیشتر بی‌فایده است.
      if (outcome.status === 400) {
        throw new ProviderRequestError(
          `درخواست ارسالی به Groq معتبر نبود: ${outcome.errorMessage}`,
          GROQ_PROVIDER,
          400,
        );
      }

      groqKeyPool.reportFailure(keyState.value, kind, outcome.retryAfterMs);
      console.warn(
        `[groq] مدل «${model}» با کلید ${keyState.label} ناموفق بود (${kind}); ${
          index + 1 < keys.length ? "چرخش به کلید بعدی" : "چرخش به مدل بعدی"
        }.`,
      );

      // مکث بسیار کوتاه فقط برای شلوغی موقت سرویس (نه برای سهمیه).
      if (kind === "busy" && remaining() > 4_000) {
        await sleep(Math.min(400, Math.max(0, remaining() - 3_000)));
      }
    }
  }

  console.error(
    `[groq] همهٔ کلیدها و مدل‌ها ناموفق بودند. آخرین خطا (${lastStatus ?? "-"}): ${lastError ?? "نامشخص"}`,
  );

  if (sawQuota) {
    throw new QuotaExhaustedError(
      "سهمیهٔ رایگان هر سه کلید Groq فعلاً تمام شده است؛ چند دقیقه دیگر دوباره تلاش کنید.",
      GROQ_PROVIDER,
      groqKeyPool.nextAvailableInMs(),
    );
  }
  if (sawTimeout && !sawBusy) {
    throw new ModelTimeoutError(undefined, GROQ_PROVIDER);
  }
  throw new ModelBusyError(undefined, GROQ_PROVIDER);
}
