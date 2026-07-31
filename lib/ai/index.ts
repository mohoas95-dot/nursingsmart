/**
 * lib/ai/index.ts
 * ---------------------------------------------------------------------------
 * نقطه ورود واحد لایه هوش مصنوعی — معماری جدید بر پایه OpenRouter
 *
 * تقسیم هوشمند کار (طبق الزامات جدید):
 *   ┌──────────────────┬─────────────────────────────┬─────────────────────────────┐
 *   │ ورودی کاربر       │ مدل Bluesminds             │ قیمت‌گذاری                   │
 *   ├──────────────────┼─────────────────────────────┼─────────────────────────────┤
 *   │ متن (Text)       │ deepseek-chat               │ $0.27 / $1.10 per 1M tokens │
 *   │ تصویر (Vision)   │ gpt-4o-mini                 │ $0.15 / $0.60 per 1M tokens │
 *   │ fallback تصویر   │ gpt-4o                      │ $2.50 / $10 per 1M tokens   │
 *   └──────────────────┴─────────────────────────────┴─────────────────────────────┘
 *
 * همه درخواست‌ها از یک استخر کلید مشترک (OPENROUTER_API_KEY) استفاده می‌کنند
 * و سیستم مدیریت اعتبار ۱۰۰ دلاری به‌صورت خودکار مصرف را ردیابی و کسر می‌کند.
 */

export * from './errors';
export * from './json';
export {
  ApiKeyPool,
  classifyFailure,
  parseRetryAfterMs,
  type KeyFailureKind,
} from './key-pool';

// هسته جدید OpenRouter
export {
  OPENROUTER_PROVIDER,
  OPENROUTER_BASE_URL,
  OPENROUTER_ENDPOINT,
  TEXT_MODEL,
  TEXT_MODEL_FALLBACK,
  VISION_MODEL,
  VISION_FALLBACK_MODEL,
  openRouterKeyPool,
  getTextModelChain,
  getVisionModelChain,
  generateOpenRouterJson,
  generateOpenRouterVision,
  getCreditState,
  getCreditDisplayInfo,
  deductCredit,
  calculateCostUSD,
  type OpenRouterMessage,
  type OpenRouterJsonOptions,
  type OpenRouterJsonResult,
  type OpenRouterVisionOptions,
  type OpenRouterVisionResult,
  type CreditState,
  type CreditDisplayInfo,
  type CreditStatusLevel,
} from './openrouter';

export {
  INITIAL_CREDIT_USD,
  WARNING_THRESHOLD_USD,
  CRITICAL_THRESHOLD_USD,
  MAX_CREDIT_LOGS,
  MODEL_PRICING,
  getCreditStatusLevel,
  resetCredit,
  addCredit,
  rechargeCredit,
  applyCreditAction,
  type CreditLogEntry,
  type CreditActionResult,
} from './credit';

// سازگاری با کد قدیمی — این‌ها حالا wrapper روی OpenRouter هستند
export {
  GROQ_PROVIDER,
  GROQ_MODEL,
  generateGroqJson,
  getGroqModelChain,
  groqKeyPool,
  type GroqMessage,
  type GroqJsonOptions,
  type GroqJsonResult,
} from './groq';

export {
  GEMINI_PROVIDER,
  GEMINI_VISION_MODEL,
  generateGeminiVision,
  getGeminiVisionModelChain,
  geminiKeyPool,
  type GeminiVisionResult,
} from './gemini-vision';
