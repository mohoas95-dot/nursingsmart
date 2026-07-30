import { GoogleGenAI, GenerateContentParameters, GenerateContentResponse } from "@google/genai";

/**
 * Model selection strategy
 * -----------------------------------------------------------------------
 * The public Gemini app and the Gemini API are not the same product surface:
 * the app can silently route a request to private/fallback models, while our
 * app must name concrete API models and is limited by the API key quota.  For
 * that reason this module keeps a conservative, stable model chain and retries
 * transient capacity errors before the user ever sees a failure.
 *
 * Important: the previous defaults referenced preview/future model names. When
 * an API key cannot access those names, the request burns time before reaching a
 * usable model and users see “busy / try later”.  Default to generally available
 * Flash models instead; deployment can still override every name with env vars.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
export const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || GEMINI_MODEL;

// Ordered fallback chain for text/chat requests. Override with a comma-separated
// GEMINI_FALLBACK_MODELS env var.
const DEFAULT_TEXT_FALLBACK_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
];

// OCR/vision quality is noticeably worse on some lite models, so image parsing
// uses a separate chain. Override with GEMINI_VISION_FALLBACK_MODELS when your
// Google project has access to a stronger model (for example gemini-2.5-pro).
const DEFAULT_VISION_FALLBACK_MODELS = [
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
];

function parseModelList(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map(model => model.trim())
    .filter(Boolean);
}

export const GEMINI_FALLBACK_MODELS = parseModelList(process.env.GEMINI_FALLBACK_MODELS);
export const GEMINI_VISION_FALLBACK_MODELS = parseModelList(process.env.GEMINI_VISION_FALLBACK_MODELS);

const TEXT_MODEL_CHAIN = Array.from(new Set([
  GEMINI_MODEL,
  ...(GEMINI_FALLBACK_MODELS.length > 0 ? GEMINI_FALLBACK_MODELS : DEFAULT_TEXT_FALLBACK_MODELS),
]));

const VISION_MODEL_CHAIN = Array.from(new Set([
  GEMINI_VISION_MODEL,
  ...(GEMINI_VISION_FALLBACK_MODELS.length > 0 ? GEMINI_VISION_FALLBACK_MODELS : DEFAULT_VISION_FALLBACK_MODELS),
]));

export type GeminiTaskKind = "text" | "vision";

export function getModelChain(task: GeminiTaskKind = "text"): string[] {
  return [...(task === "vision" ? VISION_MODEL_CHAIN : TEXT_MODEL_CHAIN)];
}

// Persian messages shown to the user when all automatic recovery attempts fail.
export const MODEL_BUSY_MESSAGE =
  "ظرفیت/سهمیهٔ Gemini API موقتاً در دسترس نیست؛ چند لحظه دیگر دوباره تلاش کنید.";

export const MODEL_TIMEOUT_MESSAGE =
  "پاسخ Gemini بیش از حد طول کشید؛ لطفاً دوباره تلاش کنید (در صورت امکان پیام یا تصویر را کوتاه‌تر/واضح‌تر ارسال کنید).";

export const MODEL_CONFIGURATION_MESSAGE =
  "مدل‌های Gemini تنظیم‌شده برای این پروژه در API در دسترس نیستند. لطفاً مقدار GEMINI_MODEL یا GEMINI_VISION_MODEL را بررسی کنید.";

export class ModelBusyError extends Error {
  constructor(message: string = MODEL_BUSY_MESSAGE) {
    super(message);
    this.name = "ModelBusyError";
  }
}

export class ModelTimeoutError extends Error {
  constructor(message: string = MODEL_TIMEOUT_MESSAGE) {
    super(message);
    this.name = "ModelTimeoutError";
  }
}

export class ModelConfigurationError extends Error {
  constructor(message: string = MODEL_CONFIGURATION_MESSAGE) {
    super(message);
    this.name = "ModelConfigurationError";
  }
}

export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not defined in environment variables.");
  }
  return new GoogleGenAI({ apiKey });
}

// Detects transient capacity errors from the Gemini API: HTTP 503 (model
// overloaded / high demand), 429 (quota / rate limit) and 500/504 blips.
function isModelBusyError(error: unknown): boolean {
  const candidate = error as { status?: number | string; code?: number | string; message?: string } | null;
  const status = Number(candidate?.status ?? candidate?.code);
  if (status === 429 || status === 500 || status === 503 || status === 504) return true;
  const message = String(candidate?.message ?? error ?? "");
  return /high demand|unavailable|overloaded|resource_exhausted|quota|rate.?limit|deadline|internal error|\b429\b|\b500\b|\b503\b|\b504\b/i.test(message);
}

// A model name that this project/key does not have access to (404 / 400
// "not found"): skip straight to the next model instead of burning retries.
function isModelUnavailableError(error: unknown): boolean {
  const candidate = error as { status?: number | string; code?: number | string; message?: string } | null;
  const status = Number(candidate?.status ?? candidate?.code);
  const message = String(candidate?.message ?? error ?? "");
  if (status === 404) return true;
  return /not found|is not supported|does not exist|unsupported model|model .*permission denied|permission denied.*model/i.test(message);
}

// Some models reject the thinkingConfig knob; in that case retry without it.
function isThinkingConfigError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? error ?? "");
  return /thinking|thinking_config|thinkingLevel|thinkingBudget/i.test(message)
    && /invalid|unknown|not supported|unsupported/i.test(message);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ATTEMPTS_PER_MODEL = Math.max(1, Number(process.env.GEMINI_ATTEMPTS_PER_MODEL) || 2);

// Hard ceiling for one logical text request (all models + retries). Kept under
// the route maxDuration so we can return JSON instead of letting Vercel kill us.
const TOTAL_BUDGET_MS = Math.max(5000, Number(process.env.GEMINI_TOTAL_BUDGET_MS) || 34_000);

// OCR/vision needs more time than text. The handwritten route passes this value
// explicitly and has a 60s function cap.
export const GEMINI_VISION_TOTAL_BUDGET_MS = Math.max(
  10_000,
  Number(process.env.GEMINI_VISION_TOTAL_BUDGET_MS) || 52_000,
);

// Per single API call timeout — prevents one hanging call from eating the
// whole budget.
const PER_CALL_TIMEOUT_MS = Math.max(4000, Number(process.env.GEMINI_CALL_TIMEOUT_MS) || 16_000);
export const GEMINI_VISION_CALL_TIMEOUT_MS = Math.max(
  8000,
  Number(process.env.GEMINI_VISION_CALL_TIMEOUT_MS) || 24_000,
);

// Most currently stable API models either do not need a thinking config for
// this extraction task or use model-specific fields. Defaulting to OFF avoids an
// avoidable invalid-config retry. Set GEMINI_THINKING_LEVEL=low|medium|high if
// your selected model supports this exact field.
const THINKING_LEVEL = (process.env.GEMINI_THINKING_LEVEL || "off").toLowerCase();

function withThinkingConfig(params: Omit<GenerateContentParameters, "model">) {
  if (THINKING_LEVEL === "off" || THINKING_LEVEL === "none") return params;
  const config = (params as { config?: Record<string, unknown> }).config || {};
  if (config.thinkingConfig) return params;
  return {
    ...params,
    config: { ...config, thinkingConfig: { thinkingLevel: THINKING_LEVEL.toUpperCase() } },
  } as Omit<GenerateContentParameters, "model">;
}

function withoutThinkingConfig(params: Omit<GenerateContentParameters, "model">) {
  const config = { ...((params as { config?: Record<string, unknown> }).config || {}) };
  delete config.thinkingConfig;
  return { ...params, config } as Omit<GenerateContentParameters, "model">;
}

async function callWithTimeout(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, "model">,
  model: string,
  timeoutMs: number,
): Promise<GenerateContentResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const timeoutError = new Error(`Gemini call timed out after ${timeoutMs}ms`);
      timeoutError.name = "AbortError";
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    const config = {
      ...((params as { config?: Record<string, unknown> }).config || {}),
      abortSignal: controller.signal,
    };
    const generationPromise = ai.models.generateContent({ ...params, config, model } as GenerateContentParameters);
    return await Promise.race([generationPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  const candidate = error as { name?: string; message?: string } | null;
  return candidate?.name === "AbortError" || /abort|timed out|timeout/i.test(String(candidate?.message || ""));
}

export type GenerateContentRetryOptions = {
  /** Use getModelChain("vision") for image/OCR routes. */
  modelChain?: string[];
  attemptsPerModel?: number;
  totalBudgetMs?: number;
  perCallTimeoutMs?: number;
  taskName?: string;
};

/**
 * Calls generateContent with per-call timeout, jittered exponential backoff
 * and automatic model fallback.
 *
 * - Only transient errors (429/503/500/504/timeout) trigger retry/fallback.
 * - A model the key cannot access is skipped immediately.
 * - The whole operation is bounded, so the HTTP route answers before the
 *   serverless function times out.
 */
export async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, "model">,
  options: GenerateContentRetryOptions = {},
): Promise<GenerateContentResponse> {
  const startedAt = Date.now();
  const totalBudgetMs = Math.max(5000, options.totalBudgetMs ?? TOTAL_BUDGET_MS);
  const perCallTimeoutMs = Math.max(4000, options.perCallTimeoutMs ?? PER_CALL_TIMEOUT_MS);
  const attemptsPerModel = Math.max(1, options.attemptsPerModel ?? ATTEMPTS_PER_MODEL);
  const modelChain = options.modelChain && options.modelChain.length > 0 ? options.modelChain : TEXT_MODEL_CHAIN;
  const remaining = () => totalBudgetMs - (Date.now() - startedAt);
  let lastError: unknown;
  let sawBusy = false;
  let sawTimeout = false;
  let sawUnavailable = false;
  let requestParams = withThinkingConfig(params);

  for (const model of modelChain) {
    for (let attempt = 0; attempt < attemptsPerModel; attempt++) {
      if (remaining() <= 1500) {
        console.error(`Gemini retry budget exhausted before finishing the ${options.taskName || "request"} model chain.`);
        if (sawBusy) throw new ModelBusyError();
        if (sawTimeout) throw new ModelTimeoutError();
        if (sawUnavailable) throw new ModelConfigurationError();
        throw lastError instanceof Error ? lastError : new ModelTimeoutError();
      }
      if (attempt > 0) {
        // Exponential backoff with jitter: ~0.6s, ~1.4s, ~3s ...
        const backoff = Math.min(4000, 500 * 2 ** (attempt - 1)) + Math.random() * 400;
        await sleep(Math.min(backoff, Math.max(0, remaining() - 1500)));
      }
      try {
        return await callWithTimeout(
          ai,
          requestParams,
          model,
          Math.min(perCallTimeoutMs, Math.max(4000, remaining() - 500)),
        );
      } catch (error) {
        lastError = error;
        if (isThinkingConfigError(error)) {
          // Retry the same model once without the thinking knob.
          requestParams = withoutThinkingConfig(requestParams);
          console.warn(`Gemini model "${model}" rejected thinkingConfig; retrying without it.`);
          attempt--;
          continue;
        }
        if (isModelUnavailableError(error)) {
          sawUnavailable = true;
          console.warn(`Gemini model "${model}" is not available for this API key; skipping to next model.`);
          break;
        }
        if (isAbortError(error)) {
          sawTimeout = true;
          console.warn(`Gemini model "${model}" attempt ${attempt + 1}/${attemptsPerModel} timed out after ${perCallTimeoutMs}ms; moving on.`);
          continue;
        }
        if (!isModelBusyError(error)) {
          throw error;
        }
        sawBusy = true;
        console.warn(`Gemini model "${model}" attempt ${attempt + 1}/${attemptsPerModel} is busy; ${attempt + 1 < attemptsPerModel ? "retrying" : "trying next model"}.`);
      }
    }
  }

  console.error(`All Gemini models in the ${options.taskName || "request"} chain failed:`, lastError);
  if (sawBusy) throw new ModelBusyError();
  if (sawTimeout) throw new ModelTimeoutError();
  if (sawUnavailable) throw new ModelConfigurationError();
  throw lastError instanceof Error ? lastError : new ModelBusyError();
}
