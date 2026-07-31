/**
 * lib/ai/index.ts
 * ---------------------------------------------------------------------------
 * نقطه ورود واحد لایه هوش مصنوعی — معماری جدید صرفاً بر پایه Gemini Direct
 *
 * الزامات ۲۰۲۶:
 *   - تمامی هوش‌های قبلی (Groq, DeepSeek, GPT-4o-mini, OpenRouter, Bluesminds)
 *     کاملاً حذف شده‌اند.
 *   - فقط Gemini Direct API:
 *       primary: gemini-1.5-flash
 *       fallback: gemini-1.5-flash (فقط در شرایط جدی)
 *   - پایداری: ۵ کلید API با چرخش خودکار بدون معطلی
 *   - نمایش مدت انتظار بازگشایی در صورت اتمام همه کلیدها
 *   - سیستم اعتبار ۱۰۰ دلاری حذف شده است.
 */

export * from './errors';
export * from './json';
export {
  ApiKeyPool,
  classifyFailure,
  parseRetryAfterMs,
  type KeyFailureKind,
} from './key-pool';

// هسته جدید Gemini Direct
export {
  GEMINI_PROVIDER,
  GEMINI_PRIMARY_MODEL,
  GEMINI_FALLBACK_MODEL,
  TEXT_MODEL,
  VISION_MODEL,
  TEXT_MODEL_FALLBACK,
  VISION_FALLBACK_MODEL,
  GEMINI_VISION_MODEL,
  GEMINI_VISION_FALLBACK_MODEL,
  geminiKeyPool,
  getGeminiModelChain,
  getTextModelChain,
  getVisionModelChain,
  getGeminiVisionModelChain,
  generateGeminiJson,
  generateGeminiVision,
  type GeminiChatMessage,
  type GeminiJsonOptions,
  type GeminiJsonResult,
  type GeminiVisionOptions,
  type GeminiVisionResult,
} from './gemini';

// برای سازگاری با importهای قدیمی
import {
  GEMINI_PROVIDER as _PROVIDER,
  GEMINI_PRIMARY_MODEL as _PRIMARY,
  GEMINI_FALLBACK_MODEL as _FALLBACK,
  geminiKeyPool as _pool,
  getGeminiModelChain as _chain,
  generateGeminiJson as _genJson,
  generateGeminiVision as _genVision,
} from './gemini';

// استاب‌های سازگار با نام‌های قدیمی — همه به Gemini نگاشت می‌شوند
export const OPENROUTER_PROVIDER = _PROVIDER;
export const OPENROUTER_BASE_URL = 'https://generativelanguage.googleapis.com';
export const OPENROUTER_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${_PRIMARY}:generateContent`;
export const TEXT_MODEL_FALLBACK_ALIAS = _FALLBACK;
export const VISION_MODEL_ALIAS = _PRIMARY;

export const GROQ_PROVIDER = _PROVIDER;
export const GROQ_MODEL = _PRIMARY;
export const GEMINI_PROVIDER_ALIAS = _PROVIDER;

// Pools — همه یکی هستند (Gemini)
export const openRouterKeyPool = _pool;
export const groqKeyPool = _pool;

// Helper wrappers برای کد قدیمی که هنوز generateOpenRouterJson صدا می‌زند
export async function generateOpenRouterJson<T>(options: {
  systemPrompt: string;
  messages: Array<{ role: string; content: any }>;
  maxTokens?: number;
  requestType?: string;
}) {
  const mappedMessages = (options.messages || []).map(m => ({
    role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((c: any) => c.text || '').join('\n') : String(m.content),
  }));
  const result = await _genJson<T>({
    systemPrompt: options.systemPrompt,
    messages: mappedMessages,
    maxTokens: options.maxTokens,
  });
  return {
    data: result.data,
    model: result.model,
    keyLabel: result.keyLabel,
    usage: {
      inputTokens: result.usage?.promptTokens || 0,
      outputTokens: result.usage?.completionTokens || 0,
      totalTokens: result.usage?.totalTokens || 0,
      cost: 0,
      remainingCredit: 0,
    },
  };
}

export async function generateOpenRouterVision<T>(options: {
  systemPrompt: string;
  userText: string;
  imageBase64: string;
  mimeType: string;
  maxTokens?: number;
}) {
  const result = await _genVision<T>({
    systemPrompt: options.systemPrompt,
    userText: options.userText,
    imageBase64: options.imageBase64,
    mimeType: options.mimeType,
    maxTokens: options.maxTokens,
  });
  return {
    data: result.data,
    model: result.model,
    keyLabel: result.keyLabel,
    usedFallback: result.usedFallback,
    usage: {
      inputTokens: result.usage?.promptTokens || 0,
      outputTokens: result.usage?.completionTokens || 0,
      totalTokens: result.usage?.totalTokens || 0,
      cost: 0,
      remainingCredit: 0,
    },
  };
}

// Wrappers قدیمی Groq
export type GroqMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type GroqJsonOptions = { systemPrompt: string; messages: any[]; maxTokens?: number };
export type GroqJsonResult<T> = { data: T; model: string; keyLabel: string; usage: any };
export async function generateGroqJson<T>(options: GroqJsonOptions) {
  return generateOpenRouterJson<T>({
    systemPrompt: options.systemPrompt,
    messages: options.messages,
    maxTokens: options.maxTokens,
  });
}
export function getGroqModelChain() {
  return _chain();
}

// Wrapper قدیمی برای signature قدیمی Gemini Vision (contents/config) — برای سازگاری
// نام متفاوت انتخاب شده تا با generateGeminiVision اصلی تداخل نداشته باشد
export type GeminiVisionLegacyResult = { response: { text: string }; model: string; keyLabel: string };
export async function generateGeminiVisionLegacy(params: {
  contents: Array<{
    role: string;
    parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  }>;
  config: {
    systemInstruction: string;
    responseMimeType?: string;
    responseSchema?: unknown;
  };
}): Promise<GeminiVisionLegacyResult> {
  const firstContent = params.contents?.[0];
  const textPart = firstContent?.parts?.find(p => typeof p.text === 'string')?.text || '';
  const imagePart = firstContent?.parts?.find(p => p.inlineData?.data)?.inlineData;
  const mimeType = imagePart?.mimeType || 'image/jpeg';
  const base64Data = imagePart?.data || '';
  if (!base64Data) throw new Error('تصویری برای تحلیل ارسال نشده است.');
  const result = await _genVision({
    systemPrompt: params.config?.systemInstruction || '',
    userText: textPart || 'Read the image',
    imageBase64: base64Data,
    mimeType,
  });
  return {
    response: { text: JSON.stringify(result.data) },
    model: result.model,
    keyLabel: result.keyLabel,
  };
}

// برای سازگاری با import { generateGeminiVision } از نسخه قدیمی gemini-vision.ts که signature قدیمی داشت
// اگر کسی هنوز آن signature را صدا بزند، این wrapper کار می‌کند
export const geminiKeyPoolAlias = _pool;
export const GEMINI_PROVIDER_LEGACY = _PROVIDER;

// حذف کامل سیستم اعتبار — استاب خالی برای جلوگیری از شکست import
export const INITIAL_CREDIT_USD = 0;
export const WARNING_THRESHOLD_USD = 0;
export const CRITICAL_THRESHOLD_USD = 0;
export const MAX_CREDIT_LOGS = 0;
export const MODEL_PRICING: Record<string, any> = {};
export function getCreditStatusLevel() { return 'ok' as const; }
export function resetCredit() { return null as any; }
export function addCredit() { return null as any; }
export function rechargeCredit() { return null as any; }
export function applyCreditAction() { return { ok: false, statusCode: 410, credit: null } as any; }
export type CreditLogEntry = any;
export type CreditActionResult = any;
export type CreditState = any;
export type CreditDisplayInfo = any;
export type CreditStatusLevel = any;
export function getCreditState() { return null as any; }
export function getCreditDisplayInfo() { return null as any; }
export function deductCredit() { return { cost: 0, remaining: 0, status: 'ok', state: null } as any; }
export function calculateCostUSD() { return 0; }
export type OpenRouterMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type OpenRouterJsonOptions = any;
export type OpenRouterJsonResult<T> = any;
export type OpenRouterVisionOptions = any;
export type OpenRouterVisionResult<T> = any;
