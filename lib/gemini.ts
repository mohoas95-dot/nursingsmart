import { GoogleGenAI, GenerateContentParameters, GenerateContentResponse } from "@google/genai";

// Primary model is configurable via the GEMINI_MODEL env var so it can be
// swapped from Vercel settings without a code change when Google deprecates
// a version.
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";

// Ordered fallback chain, used automatically when the primary model is
// temporarily unavailable (503 "high demand") or rate-limited (429).
// Override with a comma-separated GEMINI_FALLBACK_MODELS env var.
const DEFAULT_FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];

export const GEMINI_FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "")
  .split(",")
  .map(model => model.trim())
  .filter(Boolean);

const MODEL_CHAIN = Array.from(new Set([
  GEMINI_MODEL,
  ...(GEMINI_FALLBACK_MODELS.length > 0 ? GEMINI_FALLBACK_MODELS : DEFAULT_FALLBACK_MODELS),
]));

// Persian message shown to the user when every model in the chain is busy.
export const MODEL_BUSY_MESSAGE =
  "سرور هوش مصنوعی فعلاً شلوغ است؛ لطفاً چند لحظه دیگر دوباره تلاش کنید.";

export class ModelBusyError extends Error {
  constructor(message: string = MODEL_BUSY_MESSAGE) {
    super(message);
    this.name = "ModelBusyError";
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
// overloaded / high demand) and HTTP 429 (quota / rate limit spikes).
function isModelBusyError(error: unknown): boolean {
  const candidate = error as { status?: number | string; code?: number | string; message?: string } | null;
  const status = Number(candidate?.status ?? candidate?.code);
  if (status === 429 || status === 503) return true;
  const message = String(candidate?.message ?? error ?? "");
  return /high demand|unavailable|overloaded|resource_exhausted|quota|rate.?limit|429|503/i.test(message);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ATTEMPTS_PER_MODEL = 2;

/**
 * Calls generateContent with automatic retry + model fallback.
 * Tries the primary model, then each fallback model in MODEL_CHAIN, with a
 * short backoff between attempts — but only for transient busy errors
 * (429/503). Any other error (bad request, auth, ...) is thrown immediately.
 * If every model is busy, throws a ModelBusyError carrying MODEL_BUSY_MESSAGE.
 */
export async function generateContentWithRetry(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, "model">,
): Promise<GenerateContentResponse> {
  let lastBusyError: unknown;

  for (const model of MODEL_CHAIN) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt++) {
      if (attempt > 0) {
        await sleep(1000 * attempt);
      }
      try {
        return await ai.models.generateContent({ ...params, model });
      } catch (error) {
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
