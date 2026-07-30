import { GoogleGenAI, GenerateContentParameters, GenerateContentResponse } from "@google/genai";

/**
 * Model selection strategy
 * -----------------------------------------------------------------------
 * The newest "flash" previews are the ones Google throttles first: they are
 * the models that most often answer 503 "model is overloaded / high demand".
 * That is exactly what the Vercel logs were showing:
 *
 *   Gemini model "gemini-3.6-flash" attempt 1/2 is busy; retrying.
 *   Gemini model "gemini-3.5-flash" attempt 1/2 is busy; retrying.
 *
 * So the default chain now starts with a *stable, generally-available* model
 * and falls back to the even cheaper / higher-quota lite models, which are
 * almost never saturated. Everything stays overridable from Vercel env vars.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

// Ordered fallback chain, used automatically when the primary model is
// temporarily unavailable (503 "high demand") or rate-limited (429).
// Override with a comma-separated GEMINI_FALLBACK_MODELS env var.
const DEFAULT_FALLBACK_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-2.5-flash",
];

export const GEMINI_FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "")
  .split(",")
  .map(model => model.trim())
  .filter(Boolean);

const MODEL_CHAIN = Array.from(new Set([
  GEMINI_MODEL,
  ...(GEMINI_FALLBACK_MODELS.length > 0 ? GEMINI_FALLBACK_MODELS : DEFAULT_FALLBACK_MODELS),
]));

export function getModelChain(): string[] {
  return [...MODEL_CHAIN];
}

// Persian message shown to the user when every model in the chain is busy.
export const MODEL_BUSY_MESSAGE =
  "سرور هوش مصنوعی فعلاً شلوغ است؛ لطفاً چند لحظه دیگر دوباره تلاش کنید.";

export const MODEL_TIMEOUT_MESSAGE =
  "پاسخ هوش مصنوعی بیش از حد طول کشید؛ لطفاً دوباره تلاش کنید (در صورت امکان پیام را کوتاه‌تر بنویسید).";

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
  return /not found|is not supported|does not exist|unsupported model|permission denied/i.test(message);
}

// Some models reject the thinkingConfig knob; in that case retry without it.
function isThinkingConfigError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? error ?? "");
  return /thinking|thinking_config|thinkingLevel|thinkingBudget/i.test(message)
    && /invalid|unknown|not supported|unsupported/i.test(message);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ATTEMPTS_PER_MODEL = Math.max(1, Number(process.env.GEMINI_ATTEMPTS_PER_MODEL) || 2);

// Hard ceiling for one logical request (all models + retries). Kept well
// under the serverless function's maxDuration so we can always return a
// friendly JSON error instead of letting Vercel kill the function.
const TOTAL_BUDGET_MS = Math.max(5000, Number(process.env.GEMINI_TOTAL_BUDGET_MS) || 26000);

// Per single API call timeout — prevents one hanging call from eating the
// whole budget (this was the main cause of "very long wait, then failure").
const PER_CALL_TIMEOUT_MS = Math.max(4000, Number(process.env.GEMINI_CALL_TIMEOUT_MS) || 14000);

// "low" keeps latency low for this extraction task; set GEMINI_THINKING_LEVEL
// to "high"/"medium" or "off" (to remove the field entirely) from Vercel.
const THINKING_LEVEL = (process.env.GEMINI_THINKING_LEVEL || "low").toLowerCase();

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
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const config = {
      ...((params as { config?: Record<string, unknown> }).config || {}),
      abortSignal: controller.signal,
    };
    return await ai.models.generateContent({ ...params, config, model } as GenerateContentParameters);
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(error: unknown): boolean {
  const candidate = error as { name?: string; message?: string } | null;
  return candidate?.name === "AbortError" || /abort/i.test(String(candidate?.message || ""));
}

/**
 * Calls generateContent with per-call timeout, jittered exponential backoff
 * and automatic model fallback.
 *
 * - Only transient errors (429/503/500/504/timeout) trigger retry/fallback.
 * - A model the key cannot access is skipped immediately.
 * - The whole operation is bounded by TOTAL_BUDGET_MS, so the HTTP route
 *   always answers before the serverless function times out.
 */
export async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, "model">,
): Promise<GenerateContentResponse> {
  const startedAt = Date.now();
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);
  let lastBusyError: unknown;
  let requestParams = withThinkingConfig(params);

  for (const model of MODEL_CHAIN) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt++) {
      if (remaining() <= 1500) {
        console.error("Gemini retry budget exhausted before finishing the model chain.");
        throw lastBusyError ? new ModelBusyError() : new ModelTimeoutError();
      }
      if (attempt > 0) {
        // exponential backoff with jitter: ~0.6s, ~1.4s, ~3s ...
        const backoff = Math.min(4000, 500 * 2 ** (attempt - 1)) + Math.random() * 400;
        await sleep(Math.min(backoff, Math.max(0, remaining() - 1500)));
      }
      try {
        return await callWithTimeout(
          ai,
          requestParams,
          model,
          Math.min(PER_CALL_TIMEOUT_MS, Math.max(4000, remaining() - 500)),
        );
      } catch (error) {
        if (isThinkingConfigError(error)) {
          // Retry the same model once without the thinking knob.
          requestParams = withoutThinkingConfig(requestParams);
          console.warn(`Gemini model "${model}" rejected thinkingConfig; retrying without it.`);
          attempt--;
          continue;
        }
        if (isModelUnavailableError(error)) {
          console.warn(`Gemini model "${model}" is not available for this API key; skipping to next model.`);
          lastBusyError = lastBusyError ?? error;
          break;
        }
        if (isAbortError(error)) {
          lastBusyError = error;
          console.warn(`Gemini model "${model}" attempt ${attempt + 1}/${ATTEMPTS_PER_MODEL} timed out after ${PER_CALL_TIMEOUT_MS}ms; moving on.`);
          continue;
        }
        if (!isModelBusyError(error)) {
          throw error;
        }
        lastBusyError = error;
        console.warn(`Gemini model "${model}" attempt ${attempt + 1}/${ATTEMPTS_PER_MODEL} is busy; ${attempt + 1 < ATTEMPTS_PER_MODEL ? "retrying" : "trying next model"}.`);
      }
    }
  }

  console.error("All Gemini models in the chain are busy:", lastBusyError);
  throw new ModelBusyError();
}
