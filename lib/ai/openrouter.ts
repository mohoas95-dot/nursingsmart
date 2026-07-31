/**
 * lib/ai/openrouter.ts
 * ---------------------------------------------------------------------------
 * موتور واحد هوش مصنوعی بر پایه OpenRouter (جایگزین Groq + Gemini direct)
 *
 * الزامات جدید:
 *   1. ارائه‌دهنده: تمام درخواست‌ها از طریق OpenRouter / Bluesminds ارسال می‌شوند.
 *      - Base URL اختصاصی Bluesminds از OPENROUTER_BASE_URL خوانده می‌شود
 *        (پیش‌فرض: https://api.bluesminds.com/v1)
 *      - کلید از OPENROUTER_API_KEY خوانده می‌شود
 *   2. تفکیک هوشمند مدل‌ها:
 *      - متنی (Text Analysis): deepseek-chat (یا deepseek-v3)
 *      - تصویری (Vision/OCR): gpt-4o-mini با fallback به gpt-4o
 *   3. مدیریت اعتبار ۱۰۰ دلاری و ردیابی توکن‌ها
 *
 * این فایل نقطه مرکزی است و تمام مسیرهای API باید از اینجا استفاده کنند.
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
import { deductCredit, getCreditStatusLevel } from './credit';

// ---------------------------------------------------------------------------
// ثابت‌ها و پیکربندی
// ---------------------------------------------------------------------------

export const OPENROUTER_PROVIDER = 'openrouter';

/**
 * Base URL اختصاصی Bluesminds.
 *
 * از متغیر محیطی `OPENROUTER_BASE_URL` خوانده می‌شود؛ اگر تنظیم نشده باشد
 * پیش‌فرض این پروژه (Bluesminds) استفاده می‌شود. این مقدار دقیقاً معادل
 * پارامتر `baseURL` در SDK های OpenAI / OpenRouter است:
 *
 *   const client = new OpenAI({
 *     apiKey: process.env.OPENROUTER_API_KEY,
 *     baseURL: process.env.OPENROUTER_BASE_URL,   // → Bluesminds
 *   });
 *
 * کلاینت این پروژه fetch-محور است و همین مقدار در ساخت endpoint استفاده می‌شود،
 * بنابراین همهٔ درخواست‌های API به Bluesminds ارسال می‌شوند.
 */
export const OPENROUTER_BASE_URL: string = (
  process.env.OPENROUTER_BASE_URL || 'https://api.bluesminds.com/v1'
).replace(/\/+$/, '');

// Endpoint نهایی درخواست‌های API — بر پایهٔ OPENROUTER_BASE_URL ساخته می‌شود
export const OPENROUTER_ENDPOINT: string = `${OPENROUTER_BASE_URL}/chat/completions`;

// مدل‌های هوشمند بر اساس نوع ورودی
export const TEXT_MODEL = process.env.OPENROUTER_TEXT_MODEL || process.env.OPENROUTER_DEEPSEEK_MODEL || 'deepseek-chat';
export const TEXT_MODEL_FALLBACK = process.env.OPENROUTER_TEXT_FALLBACK_MODEL || 'deepseek-v3';

export const VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || 'gpt-4o-mini';
export const VISION_FALLBACK_MODEL = process.env.OPENROUTER_VISION_FALLBACK_MODEL || 'gpt-4o';

export function getTextModelChain(): string[] {
  return Array.from(new Set([TEXT_MODEL, TEXT_MODEL_FALLBACK]));
}

export function getVisionModelChain(): string[] {
  return Array.from(new Set([VISION_MODEL, VISION_FALLBACK_MODEL]));
}

// استخر کلید OpenRouter — می‌تواند چند کلید داشته باشد
export const openRouterKeyPool = new ApiKeyPool({
  provider: OPENROUTER_PROVIDER,
  envNames: [
    'OPENROUTER_API_KEY',
    'OPENROUTER_API_KEY_2',
    'OPENROUTER_API_KEY_3',
    'OPENROUTER_API_KEYS',
  ],
});

// تنظیمات تایم‌اوت
const PER_CALL_TIMEOUT_MS = Math.max(5_000, Number(process.env.OPENROUTER_CALL_TIMEOUT_MS) || 28_000);
const TOTAL_BUDGET_MS = Math.max(8_000, Number(process.env.OPENROUTER_TOTAL_BUDGET_MS) || 55_000);
const MAX_CALLS_PER_REQUEST = Math.max(1, Number(process.env.OPENROUTER_MAX_CALLS_PER_REQUEST) || 4);
const MAX_OUTPUT_TOKENS = Math.max(512, Number(process.env.OPENROUTER_MAX_OUTPUT_TOKENS) || 2000);
const TEMPERATURE = Number.isFinite(Number(process.env.OPENROUTER_TEMPERATURE))
  ? Number(process.env.OPENROUTER_TEMPERATURE)
  : 0.4;

// ---------------------------------------------------------------------------
// انواع
// ---------------------------------------------------------------------------

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

export interface OpenRouterJsonOptions {
  messages: OpenRouterMessage[];
  systemPrompt: string;
  maxTokens?: number;
  /** برای لاگ و انتخاب مدل، مشخص می‌کند این درخواست متنی است یا تصویری */
  requestType?: 'text' | 'vision';
}

export interface OpenRouterJsonResult<T> {
  data: T;
  model: string;
  keyLabel: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    remainingCredit: number;
  };
}

export interface OpenRouterVisionOptions {
  systemPrompt: string;
  userText: string;
  imageBase64: string;
  mimeType: string;
  maxTokens?: number;
}

export interface OpenRouterVisionResult<T = Record<string, unknown>> {
  data: T;
  model: string;
  keyLabel: string;
  usedFallback: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    remainingCredit: number;
  };
}

// ---------------------------------------------------------------------------
// ابزارهای داخلی
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface OpenRouterCallOutcome {
  ok: boolean;
  status?: number;
  content?: string;
  errorMessage?: string;
  retryAfterMs?: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  modelUsed?: string;
}

async function callOpenRouterOnce(
  apiKey: string,
  model: string,
  payload: {
    messages: OpenRouterMessage[];
    maxTokens?: number;
    responseFormat?: { type: 'json_object' };
    temperature?: number;
  },
  timeoutMs: number,
): Promise<OpenRouterCallOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body: Record<string, unknown> = {
      model,
      messages: payload.messages,
      temperature: payload.temperature ?? TEMPERATURE,
      max_tokens: payload.maxTokens ?? MAX_OUTPUT_TOKENS,
    };

    if (payload.responseFormat) {
      body.response_format = payload.responseFormat;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    // Optional headers for OpenRouter ranking
    if (process.env.OPENROUTER_HTTP_REFERER) {
      headers['HTTP-Referer'] = process.env.OPENROUTER_HTTP_REFERER;
    }
    if (process.env.OPENROUTER_APP_TITLE) {
      headers['X-Title'] = process.env.OPENROUTER_APP_TITLE;
    } else {
      headers['X-Title'] = 'NursePlan';
    }

    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const rawBody = await response.text().catch(() => '');
      let providerMessage = rawBody;
      try {
        const parsed = JSON.parse(rawBody);
        providerMessage = parsed?.error?.message || parsed?.message || rawBody;
      } catch {
        // raw
      }
      return {
        ok: false,
        status: response.status,
        errorMessage: providerMessage || `OpenRouter HTTP ${response.status}`,
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after'), providerMessage),
      };
    }

    const result = await response.json();
    const content: string | undefined = result?.choices?.[0]?.message?.content;
    const usage = result?.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
    const modelUsed = result?.model || model;

    if (!content) {
      return {
        ok: false,
        status: 502,
        errorMessage: 'OpenRouter پاسخ خالی برگرداند.',
        usage: usage
          ? {
              prompt_tokens: usage.prompt_tokens || 0,
              completion_tokens: usage.completion_tokens || 0,
              total_tokens: usage.total_tokens || 0,
            }
          : undefined,
      };
    }

    return {
      ok: true,
      content,
      usage: usage
        ? {
            prompt_tokens: usage.prompt_tokens || 0,
            completion_tokens: usage.completion_tokens || 0,
            total_tokens: usage.total_tokens || 0,
          }
        : undefined,
      modelUsed,
    };
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, errorMessage: message };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// درخواست متنی (Text Analysis) — مدل: deepseek-chat
// ---------------------------------------------------------------------------

export async function generateOpenRouterJson<T = Record<string, unknown>>(
  options: OpenRouterJsonOptions,
): Promise<OpenRouterJsonResult<T>> {
  if (openRouterKeyPool.size() === 0) {
    throw new MissingApiKeyError(
      'کلید API سرویس OpenRouter تنظیم نشده است؛ متغیر OPENROUTER_API_KEY را در .env.local اضافه کنید.',
      OPENROUTER_PROVIDER,
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

  // زنجیره مدل متنی: deepseek-chat -> deepseek-v3 fallback
  const modelChain = getTextModelChain();

  for (const model of modelChain) {
    const keys = openRouterKeyPool.order();
    for (let index = 0; index < keys.length; index++) {
      const keyState = keys[index];

      if (callsMade >= MAX_CALLS_PER_REQUEST) {
        console.warn(`[openrouter:text] سقف ${MAX_CALLS_PER_REQUEST} فراخوانی برای این درخواست پر شد؛ توقف برای حفظ اعتبار.`);
        throw sawQuota
          ? new QuotaExhaustedError(undefined, OPENROUTER_PROVIDER, openRouterKeyPool.nextAvailableInMs())
          : new ModelBusyError(undefined, OPENROUTER_PROVIDER);
      }
      if (remaining() <= 2_500) {
        throw sawQuota
          ? new QuotaExhaustedError(undefined, OPENROUTER_PROVIDER, openRouterKeyPool.nextAvailableInMs())
          : new ModelTimeoutError(undefined, OPENROUTER_PROVIDER);
      }
      callsMade++;

      const messages: OpenRouterMessage[] = [
        { role: 'system', content: options.systemPrompt },
        ...options.messages,
      ];

      const outcome = await callOpenRouterOnce(
        keyState.value,
        model,
        {
          messages,
          maxTokens: options.maxTokens ?? MAX_OUTPUT_TOKENS,
          responseFormat: { type: 'json_object' },
        },
        Math.min(PER_CALL_TIMEOUT_MS, Math.max(4_000, remaining() - 1_000)),
      );

      if (outcome.ok && outcome.content) {
        const parsed = extractJsonObject<T>(outcome.content);
        if (parsed) {
          openRouterKeyPool.reportSuccess(keyState.value);

          const inputTokens = outcome.usage?.prompt_tokens || 0;
          const outputTokens = outcome.usage?.completion_tokens || 0;
          const creditResult = deductCredit({
            model: outcome.modelUsed || model,
            inputTokens,
            outputTokens,
          });

          return {
            data: parsed,
            model: outcome.modelUsed || model,
            keyLabel: keyState.label,
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: outcome.usage?.total_tokens || inputTokens + outputTokens,
              cost: creditResult.cost,
              remainingCredit: creditResult.remaining,
            },
          };
        }
        // JSON invalid but model succeeded
        openRouterKeyPool.reportSuccess(keyState.value);
        lastError = 'خروجی مدل JSON معتبر نبود.';
        console.warn(`[openrouter:text] مدل «${model}» خروجی غیر-JSON داد؛ تلاش بعدی.`);
        continue;
      }

      lastError = outcome.errorMessage;
      lastStatus = outcome.status;
      const kind = classifyFailure(outcome.status, outcome.errorMessage || '');

      if (kind === 'quota') sawQuota = true;
      if (kind === 'busy') sawBusy = true;
      if (/abort/i.test(outcome.errorMessage || '')) sawTimeout = true;

      if (outcome.status === 404 || /model.*(not found|does not exist|decommissioned)/i.test(outcome.errorMessage || '')) {
        console.warn(`[openrouter:text] مدل «${model}» در دسترس نیست؛ رفتن به مدل بعدی.`);
        break;
      }

      if (outcome.status === 400 && !/quota|rate/i.test(outcome.errorMessage || '')) {
        throw new ProviderRequestError(
          `درخواست ارسالی به OpenRouter معتبر نبود: ${outcome.errorMessage}`,
          OPENROUTER_PROVIDER,
          400,
        );
      }

      openRouterKeyPool.reportFailure(keyState.value, kind, outcome.retryAfterMs);
      console.warn(
        `[openrouter:text] مدل «${model}» با کلید ${keyState.label} ناموفق بود (${kind}); ${index + 1 < keys.length ? 'چرخش به کلید بعدی' : 'چرخش به مدل بعدی'}.`,
      );

      if (kind === 'busy' && remaining() > 4_000) {
        await sleep(Math.min(500, Math.max(0, remaining() - 3_000)));
      }
    }
  }

  console.error(`[openrouter:text] همه کلیدها و مدل‌ها ناموفق بودند. آخرین خطا (${lastStatus ?? '-'}): ${lastError ?? 'نامشخص'}`);

  if (sawQuota) {
    const waitMs = openRouterKeyPool.nextAvailableInMs();
    throw new QuotaExhaustedError(buildQuotaMessage('تحلیل متنی', waitMs), OPENROUTER_PROVIDER, waitMs);
  }
  if (sawTimeout && !sawBusy) {
    throw new ModelTimeoutError(undefined, OPENROUTER_PROVIDER);
  }
  throw new ModelBusyError(undefined, OPENROUTER_PROVIDER);
}

// ---------------------------------------------------------------------------
// درخواست تصویری (Vision / OCR) — مدل: gpt-4o-mini با fallback به gpt-4o
// ---------------------------------------------------------------------------

export async function generateOpenRouterVision<T = Record<string, unknown>>(
  options: OpenRouterVisionOptions,
): Promise<OpenRouterVisionResult<T>> {
  if (openRouterKeyPool.size() === 0) {
    throw new MissingApiKeyError(
      'کلید API سرویس OpenRouter تنظیم نشده است؛ متغیر OPENROUTER_API_KEY را در .env.local اضافه کنید.',
      OPENROUTER_PROVIDER,
    );
  }

  const startedAt = Date.now();
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  let sawQuota = false;
  let sawBusy = false;
  let sawTimeout = false;
  let lastError: string | undefined;
  let callsMade = 0;

  const modelChain = getVisionModelChain();

  for (let modelIdx = 0; modelIdx < modelChain.length; modelIdx++) {
    const model = modelChain[modelIdx];
    const isFallbackModel = modelIdx > 0;

    const keys = openRouterKeyPool.order();
    for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
      const keyState = keys[keyIdx];

      if (callsMade >= MAX_CALLS_PER_REQUEST) {
        console.warn(`[openrouter:vision] سقف ${MAX_CALLS_PER_REQUEST} فراخوانی برای این درخواست پر شد.`);
        throw sawQuota
          ? new QuotaExhaustedError(undefined, OPENROUTER_PROVIDER, openRouterKeyPool.nextAvailableInMs())
          : new ModelBusyError(undefined, OPENROUTER_PROVIDER);
      }
      if (remaining() <= 2_500) {
        throw sawQuota
          ? new QuotaExhaustedError(undefined, OPENROUTER_PROVIDER, openRouterKeyPool.nextAvailableInMs())
          : new ModelTimeoutError(undefined, OPENROUTER_PROVIDER);
      }
      callsMade++;

      const userContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
        {
          type: 'text',
          text: options.userText,
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${options.mimeType};base64,${options.imageBase64}`,
          },
        },
      ];

      const messages: OpenRouterMessage[] = [
        { role: 'system', content: options.systemPrompt },
        { role: 'user', content: userContent },
      ];

      const outcome = await callOpenRouterOnce(
        keyState.value,
        model,
        {
          messages,
          maxTokens: options.maxTokens ?? MAX_OUTPUT_TOKENS,
          responseFormat: { type: 'json_object' },
        },
        Math.min(PER_CALL_TIMEOUT_MS, Math.max(5_000, remaining() - 1_000)),
      );

      if (outcome.ok && outcome.content) {
        const parsed = extractJsonObject<T>(outcome.content);
        if (parsed) {
          openRouterKeyPool.reportSuccess(keyState.value);

          const inputTokens = outcome.usage?.prompt_tokens || 0;
          const outputTokens = outcome.usage?.completion_tokens || 0;

          const creditResult = deductCredit({
            model: outcome.modelUsed || model,
            inputTokens,
            outputTokens,
            isFallback: isFallbackModel,
          });

          // تشخیص کیفیت پایین: اگر مدل mini نتیجه illegible یا خالی برگرداند، به fallback سوئیچ کن
          // این منطق در لایه بالاتر هم قابل تشخیص است، اما اینجا فلگ fallback را برمی‌گردانیم
          return {
            data: parsed,
            model: outcome.modelUsed || model,
            keyLabel: keyState.label,
            usedFallback: isFallbackModel,
            usage: {
              inputTokens,
              outputTokens,
              totalTokens: outcome.usage?.total_tokens || inputTokens + outputTokens,
              cost: creditResult.cost,
              remainingCredit: creditResult.remaining,
            },
          };
        }

        // JSON invalid: اگر روی مدل اول هستیم و fallback داریم، تلاش با fallback
        if (!isFallbackModel && modelChain.length > 1) {
          console.warn(`[openrouter:vision] مدل «${model}» JSON نامعتبر داد؛ سوئیچ به fallback «${modelChain[1]}» به دلیل احتمال تصویر شلوغ/کم‌کیفیت.`);
          // ادامه حلقه بیرونی به مدل بعدی (fallback) می‌رود
          break;
        }

        openRouterKeyPool.reportSuccess(keyState.value);
        lastError = 'خروجی مدل بینایی JSON معتبر نبود.';
        console.warn(`[openrouter:vision] مدل «${model}» خروجی غیر-JSON داد؛ تلاش بعدی.`);
        continue;
      }

      lastError = outcome.errorMessage;
      const kind = classifyFailure(outcome.status, outcome.errorMessage || '');

      if (kind === 'quota') sawQuota = true;
      if (kind === 'busy') sawBusy = true;
      if (/abort/i.test(outcome.errorMessage || '')) sawTimeout = true;

      // اگر مدل mini busy یا خطای کیفیت، مستقیم fallback
      if (!isFallbackModel && (kind === 'busy' || kind === 'quota' || /image|vision|quality|low|blur/i.test(outcome.errorMessage || ''))) {
        console.warn(`[openrouter:vision] مدل «${model}» ناموفق بود (${kind}); سوئیچ خودکار به fallback پرقدرت «${VISION_FALLBACK_MODEL}» برای تصویر شلوغ/کم‌کیفیت.`);
        break; // برو مدل بعدی (fallback)
      }

      if (outcome.status === 404 || /model.*(not found|does not exist|decommissioned)/i.test(outcome.errorMessage || '')) {
        console.warn(`[openrouter:vision] مدل «${model}» در دسترس نیست؛ رفتن به مدل بعدی.`);
        break;
      }

      if (outcome.status === 400 && !/quota|rate/i.test(outcome.errorMessage || '')) {
        // برای تصویر، 400 ممکن است به دلیل فرمت نامعتبر باشد، نه درخواست نامعتبر کلی
        // اگر fallback داریم، آن را امتحان کن
        if (!isFallbackModel) {
          console.warn(`[openrouter:vision] مدل «${model}» درخواست را نپذیرفت؛ تست fallback.`);
          break;
        }
        throw new ProviderRequestError(
          `درخواست تصویری به OpenRouter معتبر نبود: ${outcome.errorMessage}`,
          OPENROUTER_PROVIDER,
          400,
        );
      }

      openRouterKeyPool.reportFailure(keyState.value, kind, outcome.retryAfterMs);
      console.warn(
        `[openrouter:vision] مدل «${model}» با کلید ${keyState.label} ناموفق بود (${kind}); ${keyIdx + 1 < keys.length ? 'کلید بعدی' : 'مدل بعدی'}.`,
      );

      if (kind === 'busy' && remaining() > 4_000) {
        await sleep(Math.min(600, Math.max(0, remaining() - 3_000)));
      }
    }
  }

  console.error(`[openrouter:vision] همه کلیدها و مدل‌های بینایی ناموفق بودند. آخرین خطا: ${lastError}`);

  if (sawQuota) {
    const waitMs = openRouterKeyPool.nextAvailableInMs();
    throw new QuotaExhaustedError(
      `${buildQuotaMessage('تحلیل تصویر', waitMs)} اگر عجله داری، همین درخواست را متنی بنویس — از سرویس DeepSeek استفاده می‌کند.`,
      OPENROUTER_PROVIDER,
      waitMs,
    );
  }
  if (sawTimeout) {
    throw new ModelTimeoutError(undefined, OPENROUTER_PROVIDER);
  }
  throw new ModelBusyError(undefined, OPENROUTER_PROVIDER);
}

// ---------------------------------------------------------------------------
// سازگاری و Exportهای مرتبط با اعتبار
// ---------------------------------------------------------------------------

export {
  getCreditState,
  getCreditDisplayInfo,
  deductCredit,
  calculateCostUSD,
  rechargeCredit,
  resetCredit,
  addCredit,
  applyCreditAction,
  MAX_CREDIT_LOGS,
} from './credit';
export type { CreditState, CreditDisplayInfo, CreditStatusLevel, CreditLogEntry, CreditActionResult } from './credit';
