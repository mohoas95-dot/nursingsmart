/**
 * lib/ai/groq.ts
 * ---------------------------------------------------------------------------
 * نسخه بازطراحی‌شده بر اساس OpenRouter — سازگار با معماری جدید NursePlan
 *
 * طبق الزامات جدید:
 *   - تمام درخواست‌های متنی از طریق Bluesminds با مدل gpt-4o-mini (fallback: gpt-4o)
 *   - کلید از OPENROUTER_API_KEY خوانده می‌شود
 *   - این فایل برای سازگاری با کد قدیمی نگه داشته شده و به‌صورت wrapper
 *     روی openrouter.ts عمل می‌کند
 *
 * برای کد جدید مستقیماً از lib/ai/openrouter استفاده کنید.
 */

import { ApiKeyPool } from './key-pool';
import {
  OPENROUTER_PROVIDER,
  TEXT_MODEL,
  openRouterKeyPool,
  getTextModelChain,
  generateOpenRouterJson,
  type OpenRouterMessage,
  type OpenRouterJsonOptions,
  type OpenRouterJsonResult,
} from './openrouter';

// برای سازگاری: همان نام‌های قبلی را export می‌کنیم اما با مقادیر جدید
export const GROQ_PROVIDER = OPENROUTER_PROVIDER;
export const GROQ_MODEL = TEXT_MODEL;

// استخر کلید در معماری جدید مشترک است (OpenRouter)
export const groqKeyPool: ApiKeyPool = openRouterKeyPool;

export function getGroqModelChain(): string[] {
  return getTextModelChain();
}

export type GroqMessage = OpenRouterMessage;
export type GroqJsonOptions = OpenRouterJsonOptions;
export type GroqJsonResult<T> = OpenRouterJsonResult<T>;

/**
 * تابع سازگار با نسخه قدیمی — در داخل از OpenRouter استفاده می‌کند
 */
export async function generateGroqJson<T = Record<string, unknown>>(
  options: GroqJsonOptions,
): Promise<GroqJsonResult<T>> {
  const result = await generateOpenRouterJson<T>({
    systemPrompt: options.systemPrompt,
    messages: options.messages,
    maxTokens: options.maxTokens,
    requestType: 'text',
  });
  return result;
}
