/**
 * lib/ai/openrouter.ts — منسوخ شده, به Gemini نگاشت می‌شود
 */

export {
  GEMINI_PROVIDER as OPENROUTER_PROVIDER,
  GEMINI_PRIMARY_MODEL as TEXT_MODEL,
  GEMINI_FALLBACK_MODEL as TEXT_MODEL_FALLBACK,
  GEMINI_PRIMARY_MODEL as VISION_MODEL,
  GEMINI_FALLBACK_MODEL as VISION_FALLBACK_MODEL,
  GEMINI_PRIMARY_MODEL as GEMINI_VISION_MODEL,
  GEMINI_FALLBACK_MODEL as GEMINI_VISION_FALLBACK_MODEL,
  geminiKeyPool as openRouterKeyPool,
  getGeminiModelChain as getTextModelChain,
  getGeminiModelChain as getVisionModelChain,
  getGeminiModelChain as getGeminiVisionModelChain,
  generateGeminiJson as generateOpenRouterJson,
  generateGeminiVision as generateOpenRouterVision,
  geminiKeyPool,
  GEMINI_PROVIDER,
  GEMINI_PRIMARY_MODEL,
  GEMINI_FALLBACK_MODEL,
} from './gemini';

// استاب‌های اعتبار (حذف شده)
export function getCreditState() { return null as any; }
export function getCreditDisplayInfo() { return null as any; }
export function deductCredit() { return { cost: 0, remaining: 0, status: 'ok' } as any; }
export function calculateCostUSD() { return 0; }
export function rechargeCredit() { return null as any; }
export function resetCredit() { return null as any; }
export function addCredit() { return null as any; }
export function applyCreditAction() { return { ok: false, statusCode: 410 } as any; }
export const INITIAL_CREDIT_USD = 0;
export const WARNING_THRESHOLD_USD = 0;
export const CRITICAL_THRESHOLD_USD = 0;
export const MAX_CREDIT_LOGS = 0;
export const MODEL_PRICING: Record<string, any> = {};
export const OPENROUTER_BASE_URL = 'https://generativelanguage.googleapis.com';
export const OPENROUTER_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
