/**
 * lib/ai/gemini-vision.ts
 * ---------------------------------------------------------------------------
 * نسخه بازطراحی‌شده بر اساس OpenRouter — سازگار با معماری جدید NursePlan
 *
 * طبق الزامات جدید:
 *   - درخواست‌های تصویری (Vision/OCR) از طریق OpenRouter با مدل openai/gpt-4o-mini
 *   - در صورت تصویر شلوغ یا کم‌کیفیت، fallback به openai/gpt-4o
 *   - کلید از OPENROUTER_API_KEY خوانده می‌شود
 *   - این فایل برای سازگاری با کد قدیمی نگه داشته شده و به‌صورت wrapper
 *     روی openrouter.ts عمل می‌کند
 */

import { ApiKeyPool } from './key-pool';
import {
  OPENROUTER_PROVIDER,
  VISION_MODEL,
  VISION_FALLBACK_MODEL,
  openRouterKeyPool,
  getVisionModelChain,
  generateOpenRouterVision,
} from './openrouter';
import { extractJsonObject } from './json';

export const GEMINI_PROVIDER = OPENROUTER_PROVIDER;
export const GEMINI_VISION_MODEL = VISION_MODEL;
export const GEMINI_VISION_FALLBACK_MODEL = VISION_FALLBACK_MODEL;

export const geminiKeyPool: ApiKeyPool = openRouterKeyPool;

export function getGeminiVisionModelChain(): string[] {
  return getVisionModelChain();
}

// نوع قدیمی برای سازگاری — اما حالا با OpenRouter پیاده‌سازی شده
export interface GeminiVisionResult {
  response: { text: string };
  model: string;
  keyLabel: string;
}

/**
 * تابع قدیمی generateGeminiVision — signature قدیمی حفظ شده اما پیاده‌سازی جدید
 * این تابع دیگر GenerateContentParameters از Gemini نمی‌گیرد؛ به‌جای آن یک wrapper
 * برای مسیرهای قدیمی است که هنوز آن را صدا می‌زنند.
 *
 * برای کد جدید مستقیماً از generateOpenRouterVision استفاده کنید.
 */
export async function generateGeminiVision(params: {
  contents: Array<{
    role: string;
    parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  }>;
  config: {
    systemInstruction: string;
    responseMimeType?: string;
    responseSchema?: unknown;
  };
}): Promise<GeminiVisionResult> {
  // استخراج متن و تصویر از فرمت قدیمی Gemini
  const firstContent = params.contents?.[0];
  const textPart = firstContent?.parts?.find(p => typeof p.text === 'string')?.text || '';
  const imagePart = firstContent?.parts?.find(p => p.inlineData?.data)?.inlineData;

  const mimeType = imagePart?.mimeType || 'image/jpeg';
  const base64Data = imagePart?.data || '';

  if (!base64Data) {
    throw new Error('تصویری برای تحلیل ارسال نشده است.');
  }

  const result = await generateOpenRouterVision({
    systemPrompt: params.config?.systemInstruction || '',
    userText: textPart || 'Read the Persian text in the attached image and respond with the requested JSON object.',
    imageBase64: base64Data,
    mimeType,
  });

  // برای سازگاری با کد قدیمی که response.text را می‌خواند
  return {
    response: {
      text: JSON.stringify(result.data),
    },
    model: result.model,
    keyLabel: result.keyLabel,
  };
}

// تابع جدید و تمیز برای استفاده مستقیم (توصیه می‌شود)
export async function generateGeminiVisionJson<T = Record<string, unknown>>(options: {
  systemPrompt: string;
  userText: string;
  imageBase64: string;
  mimeType: string;
}) {
  const result = await generateOpenRouterVision<T>({
    systemPrompt: options.systemPrompt,
    userText: options.userText,
    imageBase64: options.imageBase64,
    mimeType: options.mimeType,
  });

  return result;
}
