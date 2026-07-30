import { GoogleGenAI, GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { loadApiKeys, withApiKeyRotation } from "./apiKeyRotation";
import { ModelBusyError, ModelTimeoutError, MODEL_BUSY_MESSAGE, MODEL_TIMEOUT_MESSAGE } from "./aiErrors";

/**
 * Model selection strategy
 * -----------------------------------------------------------------------
 * Gemini is now used ONLY for vision / OCR of Persian handwritten shift
 * notes (the hybrid architecture routes plain text chat to DeepSeek — see
 * lib/deepseek.ts). "gemini-2.5-flash" is the default because it currently
 * has the best accuracy for Persian handwriting recognition.
 *
 * The newest "flash" previews are sometimes throttled first (503 "model is
 * overloaded / high demand"), so a fallback chain is still kept and stays
 * fully overridable from environment variables.
 */
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Ordered fallback chain, used automatically when the primary model is
// temporarily unavailable (503 "high demand") or rate-limited (429).
// Override with a comma-separated GEMINI_FALLBACK_MODELS env var.
const DEFAULT_FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-1.5-flash",
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

// Re-exported for backward compatibility with existing imports across the
// codebase (routes import these directly from "@/lib/gemini").
export { MODEL_BUSY_MESSAGE, MODEL_TIMEOUT_MESSAGE, ModelBusyError, ModelTimeoutError };

// ---------------------------------------------------------------------------
// Multi-Key Fallback / Round-Robin for Gemini
// ---------------------------------------------------------------------------
// GEMINI_API_KEY_1, GEMINI_API_KEY_2, GEMINI_API_KEY_3 are tried in order.
// On a rate-limit (429), quota-exceeded, or any transient failure (5xx,
// timeout) the request automatically rotates to the next key — without
// interrupting the user — before eventually also rotating through the model
// fallback chain on the working key. See lib/apiKeyRotation.ts.
// ---------------------------------------------------------------------------

export function loadGeminiKeys(): string[] {
  return loadApiKeys({
    envPrefix: "GEMINI_API_KEY",
    count: 3,
    // Back-compat: also accept the legacy single-key env vars.
    legacyEnvNames: ["GEMINI_API_KEY", "GOOGLE_GENAI_API_KEY"],
  });
}

export function getGeminiClient(apiKey?: string) {
  const key = apiKey || loadGeminiKeys()[0];
  if (!key) {
    throw new Error(
      "هیچ کلید Gemini تنظیم نشده است. لطفاً GEMINI_API_KEY_1 (و در صورت نیاز _2/_3) را تنظیم کنید."
    );
  }
  return new GoogleGenAI({ apiKey: key });
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

// A key that is invalid / unauthorized / suspended: rotate to the next key
// immediately instead of retrying the same broken key.
function isKeyInvalidError(error: unknown): boolean {
  const candidate = error as { status?: number | string; code?: number | string; message?: string } | null;
  const status = Number(candidate?.status ?? candidate?.code);
  if (status === 401 || status === 403) return true;
  const message = String(candidate?.message ?? error ?? "");
  return /api key not valid|invalid api key|permission denied|unauthenticated|forbidden/i.test(message);
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

// Combined predicate used by the outer API-key rotation layer: any error
// that is either a busy/rate-limit condition OR an invalid-key condition
// should cause a rotation to the next GEMINI_API_KEY.
function isKeyRotationRetryableError(error: unknown): boolean {
  if (error instanceof ModelBusyError || error instanceof ModelTimeoutError) return true;
  return isModelBusyError(error) || isKeyInvalidError(error) || isAbortError(error);
}

// Some models reject the thinkingConfig knob; in that case retry without it.
function isThinkingConfigError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? error ?? "");
  return /thinking|thinking_config|thinkingLevel|thinkingBudget/i.test(message)
    && /invalid|unknown|not supported|unsupported/i.test(message);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ATTEMPTS_PER_MODEL = Math.max(1, Number(process.env.GEMINI_ATTEMPTS_PER_MODEL) || 2);

// Hard ceiling for one logical request (all keys + models + retries). Kept
// well under the serverless function's maxDuration so we can always return
// a friendly JSON error instead of letting Vercel kill the function.
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
 * Runs the model-fallback-chain loop (unchanged behaviour) against a single,
 * already-authenticated GoogleGenAI client/key.
 */
async function generateContentOnClient(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, "model">,
  startedAt: number,
): Promise<GenerateContentResponse> {
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
        if (isKeyInvalidError(error)) {
          // Let the outer key-rotation layer switch to the next API key.
          throw error;
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
  throw lastBusyError ?? new ModelBusyError();
}

/**
 * Calls generateContent with per-call timeout, jittered exponential backoff,
 * automatic model fallback, AND automatic API-key rotation.
 *
 * Multi-Key Fallback / Round-Robin: GEMINI_API_KEY_1 is tried first; on a
 * rate-limit (429), quota-exceeded, invalid-key, or any transient failure it
 * automatically rotates to GEMINI_API_KEY_2, then _3, WITHOUT interrupting
 * the user's request. Only after every key is exhausted is a friendly error
 * (ModelBusyError) thrown.
 *
 * - Only transient errors (429/503/500/504/timeout) trigger retry/fallback.
 * - A model the key cannot access is skipped immediately.
 * - The whole operation is bounded by TOTAL_BUDGET_MS, so the HTTP route
 *   always answers before the serverless function times out.
 */
export async function generateContentWithRetry(
  aiOrParams: GoogleGenAI | Omit<GenerateContentParameters, "model">,
  maybeParams?: Omit<GenerateContentParameters, "model">,
): Promise<GenerateContentResponse> {
  // Backward-compatible dual signature:
  //   generateContentWithRetry(ai, params)          -- legacy call sites
  //   generateContentWithRetry(params)               -- new call sites that
  //                                                      want key rotation
  const usingLegacySignature = maybeParams !== undefined;
  const params = usingLegacySignature ? maybeParams! : (aiOrParams as Omit<GenerateContentParameters, "model">);

  if (usingLegacySignature) {
    // Caller already built a client for a specific key (older code path);
    // just run the model-fallback loop on it, no key rotation possible.
    return generateContentOnClient(aiOrParams as GoogleGenAI, params, Date.now());
  }

  const apiKeys = loadGeminiKeys();
  const startedAt = Date.now();

  try {
    return await withApiKeyRotation(
      "GEMINI",
      apiKeys,
      async apiKey => {
        const ai = new GoogleGenAI({ apiKey });
        return generateContentOnClient(ai, params, startedAt);
      },
      isKeyRotationRetryableError,
    );
  } catch (error) {
    if (isModelBusyError(error) || isKeyInvalidError(error)) {
      throw new ModelBusyError();
    }
    if (isAbortError(error)) {
      throw new ModelTimeoutError();
    }
    throw error;
  }
}
