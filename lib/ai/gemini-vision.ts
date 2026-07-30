/**
 * lib/ai/gemini-vision.ts
 * ---------------------------------------------------------------------------
 * موتور تحلیل «تصویر» چت‌باکس: Google Gemini 2.5 Flash.
 *
 * چرا Gemini برای تصویر؟
 *   - Groq در پلن رایگان برای OCR فارسیِ دست‌نوشته قابل اتکا نیست؛ Gemini 2.5
 *     Flash در خواندن دست‌خط فارسی و استخراج ساختار بسیار دقیق‌تر است و در عین
 *     حال از مدل‌های Pro کریدیت به‌مراتب کمتری مصرف می‌کند.
 *
 * قواعد جداسازی (مطابق معماری خواسته‌شده):
 *   - این ماژول *فقط* برای ورودی‌های تصویری استفاده می‌شود.
 *   - هیچ پیام متنیِ خالی از تصویر به Gemini نمی‌رود؛ متن سهم Groq است.
 *   - استخر کلید Gemini کاملاً از استخر Groq جداست: سوختن سهمیهٔ یکی هیچ اثری
 *     روی دیگری ندارد.
 *
 * پایداری:
 *   - چرخش خودکار بین ۳ کلید (GEMINI_API_KEY / _2 / _3).
 *   - زنجیرهٔ مدل جایگزین سبک‌تر وقتی همهٔ کلیدها روی مدل اصلی به سقف بخورند.
 *   - تایم‌اوت هر فراخوانی + سقف بودجهٔ کل.
 */

import { GoogleGenAI, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { ApiKeyPool, classifyFailure, parseRetryAfterMs } from "./key-pool";
import {
  MissingApiKeyError,
  ModelBusyError,
  ModelTimeoutError,
  ProviderRequestError,
  QuotaExhaustedError,
} from "./errors";

export const GEMINI_PROVIDER = "gemini";

/**
 * مدل بینایی. طبق تصمیم محصول روی «gemini-2.5-flash» ثابت است:
 * دقت بالا در OCR فارسی با مصرف کریدیت کم.
 */
export const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";

/** مدل‌های جایگزین با سهمیهٔ بالاتر برای زمانی که همهٔ کلیدها به سقف بخورند. */
const DEFAULT_VISION_FALLBACKS = ["gemini-2.5-flash-lite", "gemini-2.0-flash"];

const CONFIGURED_FALLBACKS = (process.env.GEMINI_VISION_FALLBACK_MODELS || "")
  .split(",")
  .map(model => model.trim())
  .filter(Boolean);

const MODEL_CHAIN = Array.from(
  new Set([
    GEMINI_VISION_MODEL,
    ...(CONFIGURED_FALLBACKS.length > 0 ? CONFIGURED_FALLBACKS : DEFAULT_VISION_FALLBACKS),
  ]),
);

export function getGeminiVisionModelChain(): string[] {
  return [...MODEL_CHAIN];
}

/**
 * استخر کلیدهای Gemini — سه کلید رایگان.
 * در Vercel این متغیرها را تعریف کنید:
 *   GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3
 * (نام‌های GOOGLE_GENAI_API_KEY و GEMINI_API_KEYS هم پشتیبانی می‌شوند.)
 */
export const geminiKeyPool = new ApiKeyPool({
  provider: GEMINI_PROVIDER,
  envNames: [
    "GEMINI_API_KEY",
    "GEMINI_API_KEY_2",
    "GEMINI_API_KEY_3",
    "GEMINI_API_KEYS",
    "GOOGLE_GENAI_API_KEY",
  ],
});

const PER_CALL_TIMEOUT_MS = Math.max(5_000, Number(process.env.GEMINI_CALL_TIMEOUT_MS) || 24_000);
const TOTAL_BUDGET_MS = Math.max(8_000, Number(process.env.GEMINI_TOTAL_BUDGET_MS) || 48_000);

/** کش کلاینت‌ها بر اساس کلید تا در هر فراخوانی شیء تازه ساخته نشود. */
const clientCache = new Map<string, GoogleGenAI>();

function clientFor(apiKey: string): GoogleGenAI {
  const cached = clientCache.get(apiKey);
  if (cached) return cached;
  const client = new GoogleGenAI({ apiKey });
  clientCache.set(apiKey, client);
  return client;
}

function errorStatus(error: unknown): number | undefined {
  const candidate = error as { status?: number | string; code?: number | string } | null;
  const status = Number(candidate?.status ?? candidate?.code);
  return Number.isFinite(status) ? status : undefined;
}

function errorMessage(error: unknown): string {
  const candidate = error as { message?: string } | null;
  return String(candidate?.message ?? error ?? "");
}

function isAbortError(error: unknown): boolean {
  const candidate = error as { name?: string; message?: string } | null;
  return candidate?.name === "AbortError" || /abort/i.test(String(candidate?.message || ""));
}

function isModelUnavailable(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 404) return true;
  return /not found|is not supported|does not exist|unsupported model/i.test(errorMessage(error));
}

async function callWithTimeout(
  client: GoogleGenAI,
  params: Omit<GenerateContentParameters, "model">,
  model: string,
  timeoutMs: number,
): Promise<GenerateContentResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const config = {
      ...((params as { config?: Record<string, unknown> }).config || {}),
      abortSignal: controller.signal,
    };
    return await client.models.generateContent({ ...params, config, model } as GenerateContentParameters);
  } finally {
    clearTimeout(timer);
  }
}

export interface GeminiVisionResult {
  response: GenerateContentResponse;
  model: string;
  keyLabel: string;
}

/**
 * فراخوانی Gemini برای ورودی چندوجهی (تصویر + متن) با چرخش کلید و مدل.
 *
 * ترتیب تلاش: مدل ۲.۵ Flash با کلید ۱ → ۲ → ۳، سپس مدل جایگزین با همان ترتیب.
 */
export async function generateGeminiVision(
  params: Omit<GenerateContentParameters, "model">,
): Promise<GeminiVisionResult> {
  if (geminiKeyPool.size() === 0) {
    throw new MissingApiKeyError(
      "کلید API سرویس Gemini تنظیم نشده است؛ متغیر GEMINI_API_KEY را در Vercel اضافه کنید.",
      GEMINI_PROVIDER,
    );
  }

  const startedAt = Date.now();
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  let sawQuota = false;
  let sawTimeout = false;
  let lastError: unknown;

  for (const model of MODEL_CHAIN) {
    const keys = geminiKeyPool.order();
    for (let index = 0; index < keys.length; index++) {
      const keyState = keys[index];
      if (remaining() <= 2_500) {
        throw sawQuota
          ? new QuotaExhaustedError(undefined, GEMINI_PROVIDER, geminiKeyPool.nextAvailableInMs())
          : new ModelTimeoutError(undefined, GEMINI_PROVIDER);
      }

      try {
        const response = await callWithTimeout(
          clientFor(keyState.value),
          params,
          model,
          Math.min(PER_CALL_TIMEOUT_MS, Math.max(4_000, remaining() - 1_000)),
        );
        geminiKeyPool.reportSuccess(keyState.value);
        return { response, model, keyLabel: keyState.label };
      } catch (error) {
        lastError = error;
        const status = errorStatus(error);
        const message = errorMessage(error);

        if (isModelUnavailable(error)) {
          console.warn(`[gemini] مدل «${model}» برای این کلید در دسترس نیست؛ رفتن به مدل بعدی.`);
          break;
        }

        if (status === 400 && !/api key/i.test(message)) {
          throw new ProviderRequestError(
            `درخواست ارسالی به Gemini معتبر نبود: ${message}`,
            GEMINI_PROVIDER,
            400,
          );
        }

        if (isAbortError(error)) {
          sawTimeout = true;
          // تایم‌اوت لزوماً تقصیر کلید نیست؛ cooldown کوتاه و رفتن به کلید بعدی.
          geminiKeyPool.reportFailure(keyState.value, "busy");
          console.warn(`[gemini] مدل «${model}» با کلید ${keyState.label} تایم‌اوت شد؛ کلید بعدی.`);
          continue;
        }

        const kind = classifyFailure(status, message);
        if (kind === "quota") sawQuota = true;
        geminiKeyPool.reportFailure(keyState.value, kind, parseRetryAfterMs(null, message));
        console.warn(
          `[gemini] مدل «${model}» با کلید ${keyState.label} ناموفق بود (${kind}); ${
            index + 1 < keys.length ? "چرخش به کلید بعدی" : "چرخش به مدل بعدی"
          }.`,
        );
      }
    }
  }

  console.error("[gemini] همهٔ کلیدها و مدل‌های بینایی ناموفق بودند:", lastError);

  if (sawQuota) {
    throw new QuotaExhaustedError(
      "سهمیهٔ رایگان هر سه کلید Gemini فعلاً تمام شده است؛ چند دقیقه دیگر دوباره تلاش کنید یا درخواست را متنی بنویسید.",
      GEMINI_PROVIDER,
      geminiKeyPool.nextAvailableInMs(),
    );
  }
  if (sawTimeout) {
    throw new ModelTimeoutError(undefined, GEMINI_PROVIDER);
  }
  throw new ModelBusyError(undefined, GEMINI_PROVIDER);
}
