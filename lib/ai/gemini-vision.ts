/**
 * lib/ai/gemini-vision.ts — منسوخ شده، wrapper روی gemini.ts
 * در معماری ۲۰۲۶ متن و تصویر هر دو با همان Gemini Direct انجام می‌شود
 */

export {
  GEMINI_PROVIDER,
  GEMINI_PRIMARY_MODEL as GEMINI_VISION_MODEL,
  GEMINI_FALLBACK_MODEL as GEMINI_VISION_FALLBACK_MODEL,
  geminiKeyPool,
  getGeminiModelChain as getGeminiVisionModelChain,
  generateGeminiVision,
  generateGeminiVision as generateGeminiVisionJson,
} from './gemini';
