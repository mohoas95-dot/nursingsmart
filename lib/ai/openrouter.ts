/**
 * lib/ai/openrouter.ts
 * ---------------------------------------------------------------------------
 * منسوخ شده در معماری ۲۰۲۶ — جایگزین: Gemini Direct (lib/ai/gemini.ts)
 * این فایل فقط برای سازگاری با importهای قدیمی باقی مانده و همه را به Gemini نگاشت می‌کند.
 */

export * from './gemini';
import {
  GEMINI_PROVIDER,
  GEMINI_PRIMARY_MODEL,
  GEMINI_FALLBACK_MODEL,
  geminiKeyPool,
  getGeminiModelChain,
  generateGeminiJson,
  generateGeminiVision,
} from './gemini';

export const OPENROUTER_PROVIDER = GEMINI_PROVIDER;
export const OPENROUTER_BASE_URL = 'https://generativelanguage.googleapis.com';
export const OPENROUTER_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PRIMARY_MODEL}:generateContent`;
export const TEXT_MODEL = GEMINI_PRIMARY_MODEL;
export const TEXT_MODEL_FALLBACK = GEMINI_FALLBACK_MODEL;
export const VISION_MODEL = GEMINI_PRIMARY_MODEL;
export const VISION_FALLBACK_MODEL = GEMINI_FALLBACK_MODEL;
export const openRouterKeyPool = geminiKeyPool;
export function getTextModelChain() { return getGeminiModelChain(); }
export function getVisionModelChain() { return getGeminiModelChain(); }
export const generateOpenRouterJson = async (opts: any) => {
  const mapped = (opts.messages || []).map((m: any) => ({
    role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
  }));
  const r = await generateGeminiJson({ systemPrompt: opts.systemPrompt, messages: mapped, maxTokens: opts.maxTokens });
  return { data: r.data, model: r.model, keyLabel: r.keyLabel, usage: { inputTokens: r.usage?.promptTokens || 0, outputTokens: r.usage?.completionTokens || 0, totalTokens: r.usage?.totalTokens || 0, cost: 0, remainingCredit: 0 } };
};
export const generateOpenRouterVision = async (opts: any) => {
  const r = await generateGeminiVision({ systemPrompt: opts.systemPrompt, userText: opts.userText, imageBase64: opts.imageBase64, mimeType: opts.mimeType, maxTokens: opts.maxTokens });
  return { data: r.data, model: r.model, keyLabel: r.keyLabel, usedFallback: r.usedFallback, usage: { inputTokens: r.usage?.promptTokens || 0, outputTokens: r.usage?.completionTokens || 0, totalTokens: r.usage?.totalTokens || 0, cost: 0, remainingCredit: 0 } };
};
export function getCreditState() { return null as any; }
export function getCreditDisplayInfo() { return null as any; }
export function deductCredit() { return { cost: 0, remaining: 0, status: 'ok' } as any; }
export function calculateCostUSD() { return 0; }
export function rechargeCredit() { return null as any; }
export function resetCredit() { return null as any; }
export function addCredit() { return null as any; }
export function applyCreditAction() { return { ok: false, statusCode: 410 } as any; }
