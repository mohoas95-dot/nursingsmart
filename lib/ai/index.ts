/**
 * lib/ai/index.ts
 * ---------------------------------------------------------------------------
 * نقطهٔ ورود واحد لایهٔ هوش مصنوعی چت‌باکس.
 *
 * تقسیم کار (سیاست ثابت سیستم):
 *   ┌──────────────┬──────────────────────────┬────────────────────────────┐
 *   │ ورودی کاربر  │ سرویس                    │ کلیدها                     │
 *   ├──────────────┼──────────────────────────┼────────────────────────────┤
 *   │ متن          │ Groq — Llama 3.3 70B     │ GROQ_API_KEY[_2,_3]        │
 *   │ تصویر        │ Gemini — 2.5 Flash       │ GEMINI_API_KEY[_2,_3]      │
 *   └──────────────┴──────────────────────────┴────────────────────────────┘
 *
 * این دو مسیر هیچ منبع مشترکی ندارند: نه کلید، نه شمارندهٔ سهمیه، نه cooldown.
 * پس اتمام سهمیهٔ یکی هرگز باعث از کار افتادن دیگری نمی‌شود.
 */

export * from "./errors";
export * from "./json";
export {
  ApiKeyPool,
  classifyFailure,
  parseRetryAfterMs,
  type KeyFailureKind,
} from "./key-pool";
export {
  GROQ_PROVIDER,
  GROQ_MODEL,
  generateGroqJson,
  getGroqModelChain,
  groqKeyPool,
  type GroqMessage,
  type GroqJsonOptions,
  type GroqJsonResult,
} from "./groq";
export {
  GEMINI_PROVIDER,
  GEMINI_VISION_MODEL,
  generateGeminiVision,
  getGeminiVisionModelChain,
  geminiKeyPool,
  type GeminiVisionResult,
} from "./gemini-vision";
