/**
 * lib/ai/groq.ts
 * ---------------------------------------------------------------------------
 * این فایل در معماری ۲۰۲۶ منسوخ شده است.
 * تمام درخواست‌ها مستقیماً با Gemini انجام می‌شود.
 * برای سازگاری با importهای قدیمی، همه چیز به gemini.ts نگاشت می‌شود.
 */

export * from './gemini';
import { geminiKeyPool, GEMINI_PRIMARY_MODEL, getGeminiModelChain, generateGeminiJson } from './gemini';

export const GROQ_PROVIDER = 'gemini';
export const GROQ_MODEL = GEMINI_PRIMARY_MODEL;
export const groqKeyPool = geminiKeyPool;
export function getGroqModelChain() { return getGeminiModelChain(); }
export const generateGroqJson = generateGeminiJson;
