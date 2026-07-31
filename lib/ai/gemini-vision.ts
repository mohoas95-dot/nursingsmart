/**
 * lib/ai/gemini-vision.ts
 * ---------------------------------------------------------------------------
 * در معماری ۲۰۲۶، بینایی و متن هر دو با همان Gemini Direct انجام می‌شوند.
 * این فایل فقط wrapper روی gemini.ts است.
 */

export * from './gemini';
import { geminiKeyPool, GEMINI_PRIMARY_MODEL, GEMINI_FALLBACK_MODEL, getGeminiModelChain, generateGeminiVision } from './gemini';

export const GEMINI_PROVIDER = 'gemini';
export const GEMINI_VISION_MODEL = GEMINI_PRIMARY_MODEL;
export const GEMINI_VISION_FALLBACK_MODEL = GEMINI_FALLBACK_MODEL;
export const geminiKeyPoolAlias = geminiKeyPool;
export const geminiKeyPool = geminiKeyPool;
export function getGeminiVisionModelChain() { return getGeminiModelChain(); }
export const generateGeminiVisionJson = generateGeminiVision;

export async function generateGeminiVisionLegacy(params: {
  contents: Array<{ role: string; parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }>;
  config: { systemInstruction: string };
}) {
  const first = params.contents?.[0];
  const text = first?.parts?.find(p => p.text)?.text || '';
  const img = first?.parts?.find(p => p.inlineData?.data)?.inlineData;
  if (!img?.data) throw new Error('تصویر ارسال نشده');
  return generateGeminiVision({
    systemPrompt: params.config.systemInstruction,
    userText: text,
    imageBase64: img.data,
    mimeType: img.mimeType || 'image/jpeg',
  });
}
export const generateGeminiVisionWrapper = generateGeminiVisionLegacy;

// For index.ts compatibility
export async function generateGeminiVisionDirect(opts: any) {
  return generateGeminiVision(opts);
}
