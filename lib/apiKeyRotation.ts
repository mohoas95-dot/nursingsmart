// ---------------------------------------------------------------------------
// Multi-Key Fallback / Round-Robin
// ---------------------------------------------------------------------------
// Generic helper implementing the "چرخی" (cyclic) try/catch pattern shared by
// both AI providers used in this project:
//   - DeepSeek  (DEEPSEEK_API_KEY_1/2/3) for text chat / structured parsing.
//   - Gemini    (GEMINI_API_KEY_1/2/3)   for vision / Persian handwriting OCR.
//
// Behaviour:
//   1. Always try the FIRST configured key first.
//   2. If the call fails with a transient error (HTTP 429 rate-limit, quota
//      exceeded, 5xx unavailability, network hiccup, timeout, ...), move to
//      the NEXT key immediately and retry the exact same request — the user
//      never sees an interruption.
//   3. If every key has been exhausted, the last error is re-thrown so the
//      caller can surface a single, friendly "service busy" message.
//   4. Non-transient errors (bad request, auth/config errors that are not
//      rate-limit related, etc.) fail fast without wasting the other keys.
// ---------------------------------------------------------------------------

export type RetryableErrorPredicate = (error: unknown) => boolean;

export class NoApiKeysConfiguredError extends Error {
  constructor(providerName: string, envVarHint: string) {
    super(
      `${providerName}: هیچ کلید API معتبری تنظیم نشده است. لطفاً ${envVarHint} را در متغیرهای محیطی تنظیم کنید.`
    );
    this.name = "NoApiKeysConfiguredError";
  }
}

/**
 * Reads up to `count` numbered environment variables (e.g. FOO_API_KEY_1,
 * FOO_API_KEY_2, FOO_API_KEY_3) plus an optional set of legacy/singular
 * fallback variable names, and returns the non-empty values in priority
 * order (numbered keys first, in order, then legacy names).
 */
export function loadApiKeys(options: {
  envPrefix: string; // e.g. "DEEPSEEK_API_KEY" -> DEEPSEEK_API_KEY_1..N
  count?: number; // default 3
  legacyEnvNames?: string[]; // e.g. ["DEEPSEEK_API_KEY", "OLD_VAR"]
}): string[] {
  const { envPrefix, count = 3, legacyEnvNames = [] } = options;
  const keys: string[] = [];
  const seen = new Set<string>();

  for (let i = 1; i <= count; i++) {
    const value = process.env[`${envPrefix}_${i}`];
    if (value && value.trim() && !seen.has(value.trim())) {
      keys.push(value.trim());
      seen.add(value.trim());
    }
  }

  for (const name of legacyEnvNames) {
    const value = process.env[name];
    if (value && value.trim() && !seen.has(value.trim())) {
      keys.push(value.trim());
      seen.add(value.trim());
    }
  }

  return keys;
}

/**
 * Runs `attempt` against each API key in order (first key first). On a
 * transient/rate-limit-style error it automatically rotates to the next key
 * without interrupting the caller — this is the core Multi-Key Fallback /
 * Round-Robin mechanism. Only after every key has failed does it throw.
 */
export async function withApiKeyRotation<T>(
  providerLabel: string,
  apiKeys: string[],
  attempt: (apiKey: string, keyIndex: number) => Promise<T>,
  isRetryable: RetryableErrorPredicate
): Promise<T> {
  if (apiKeys.length === 0) {
    throw new NoApiKeysConfiguredError(providerLabel, `${providerLabel}_API_KEY_1..3`);
  }

  let lastError: unknown;

  for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
    try {
      return await attempt(apiKeys[keyIndex], keyIndex);
    } catch (error) {
      lastError = error;

      if (!isRetryable(error)) {
        // Non-transient error (bad request, invalid schema, ...): fail fast,
        // rotating keys would not help and would only add latency.
        throw error;
      }

      const isLastKey = keyIndex === apiKeys.length - 1;
      console.warn(
        `[${providerLabel}] کلید API شماره ${keyIndex + 1}/${apiKeys.length} با خطای گذرا مواجه شد` +
          (isLastKey ? " (کلید آخر بود)." : "؛ به‌صورت خودکار به کلید بعدی سوییچ می‌شود."),
        error instanceof Error ? error.message : error
      );
    }
  }

  console.error(`[${providerLabel}] همهٔ ${apiKeys.length} کلید API با شکست مواجه شدند.`, lastError);
  throw lastError;
}
