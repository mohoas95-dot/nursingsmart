/**
 * lib/ai/index.ts
 * ---------------------------------------------------------------------------
 * نقطهٔ ورود واحد لایهٔ هوش مصنوعی چت‌باکس.
 *
 * معماری فعلی (تک‌موتوره، مطابق تصمیم محصول):
 *   هم پیام‌های متنی و هم تصاویر از طریق یک سرویس واحد پردازش می‌شوند:
 *   Puter.js (endpoint سازگار با OpenAI روی api.puter.com). دیگر خبری از دو
 *   سرویس جدا (Groq برای متن / Gemini برای تصویر) و دو استخر کلید مجزا نیست؛
 *   هر دو مسیر از همان استخر توکن Puter و همان منطق چرخش/تایم‌اوت استفاده
 *   می‌کنند، فقط با زنجیرهٔ مدل مناسب خودشان (متن یا vision).
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
  PUTER_PROVIDER,
  PUTER_MODEL,
  PUTER_VISION_MODEL,
  generatePuterJson,
  generatePuterVisionJson,
  getPuterModelChain,
  getPuterVisionModelChain,
  puterKeyPool,
  type PuterMessage,
  type PuterContentPart,
  type PuterJsonOptions,
  type PuterJsonResult,
} from "./puter";
