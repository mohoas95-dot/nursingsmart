// ---------------------------------------------------------------------------
// DeepSeek client — text chat & structured JSON extraction
// ---------------------------------------------------------------------------
// Uses DeepSeek's OpenAI-compatible REST endpoint (POST /chat/completions)
// directly via fetch, so no extra SDK dependency is required.
// Docs: https://api-docs.deepseek.com/api/create-chat-completion
//
// Multi-Key Fallback / Round-Robin:
//   DEEPSEEK_API_KEY_1, DEEPSEEK_API_KEY_2, DEEPSEEK_API_KEY_3 are tried in
//   order. On HTTP 429 (rate limit), quota-exceeded, 5xx, network error or
//   timeout, the request is retried automatically with the next key — the
//   user never sees an interruption. See lib/apiKeyRotation.ts.
// ---------------------------------------------------------------------------

import { loadApiKeys, withApiKeyRotation } from "./apiKeyRotation";
import { ModelBusyError, ModelTimeoutError } from "./aiErrors";

const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

// "deepseek-chat" is DeepSeek's OpenAI-compatible chat model alias. It stays
// overridable so this project can move to a newer model id (e.g.
// "deepseek-v4-flash") from environment variables without a code change if
// DeepSeek retires/renames the alias in the future.
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

const ATTEMPTS_PER_KEY = Math.max(1, Number(process.env.DEEPSEEK_ATTEMPTS_PER_KEY) || 1);
const PER_CALL_TIMEOUT_MS = Math.max(4000, Number(process.env.DEEPSEEK_CALL_TIMEOUT_MS) || 20000);
const TOTAL_BUDGET_MS = Math.max(5000, Number(process.env.DEEPSEEK_TOTAL_BUDGET_MS) || 40000);

export function loadDeepSeekKeys(): string[] {
  return loadApiKeys({
    envPrefix: "DEEPSEEK_API_KEY",
    count: 3,
    // Back-compat: also accept a single un-numbered DEEPSEEK_API_KEY.
    legacyEnvNames: ["DEEPSEEK_API_KEY"],
  });
}

export type DeepSeekChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type DeepSeekResponseFormat = "text" | "json_object";

export interface DeepSeekCallOptions {
  responseFormat?: DeepSeekResponseFormat;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

type DeepSeekHttpError = Error & { status?: number };

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Detects transient errors: HTTP 429 (rate limit / quota exceeded), 5xx
// (service unavailable), aborts/timeouts, and generic network failures.
// These are exactly the conditions that should trigger rotating to the next
// API key rather than failing the user's request outright.
function isDeepSeekRetryableError(error: unknown): boolean {
  const candidate = error as DeepSeekHttpError | null;
  const status = candidate?.status;
  if (status === 429 || (typeof status === "number" && status >= 500 && status <= 599)) {
    return true;
  }
  if (candidate?.name === "AbortError") return true;
  const message = String(candidate?.message ?? error ?? "");
  return /rate.?limit|quota|too many requests|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|timeout|timed out|network|fetch failed|ECONNRESET|ETIMEDOUT/i.test(
    message
  );
}

async function callDeepSeekOnce(
  apiKey: string,
  messages: DeepSeekChatMessage[],
  options: DeepSeekCallOptions,
  timeoutMs: number
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || DEEPSEEK_MODEL,
        messages,
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 2048,
        response_format: { type: options.responseFormat || "text" },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      const error: DeepSeekHttpError = new Error(
        `DeepSeek API error ${response.status}: ${bodyText || response.statusText}`
      );
      error.status = response.status;
      throw error;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("DeepSeek API returned an unexpected response shape (no message content).");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends a chat-completion request to DeepSeek, automatically rotating
 * through DEEPSEEK_API_KEY_1 → _2 → _3 (cyclic try/catch) whenever a key
 * hits a rate limit / quota / transient failure, and retrying a few times
 * per key for pure timeouts. Bounded by an overall time budget so the HTTP
 * route always answers before the serverless function is killed.
 */
export async function generateDeepSeekCompletion(
  messages: DeepSeekChatMessage[],
  options: DeepSeekCallOptions = {}
): Promise<string> {
  const apiKeys = loadDeepSeekKeys();
  const startedAt = Date.now();
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);

  try {
    return await withApiKeyRotation(
      "DEEPSEEK",
      apiKeys,
      async apiKey => {
        let lastError: unknown;
        for (let attempt = 0; attempt < ATTEMPTS_PER_KEY; attempt++) {
          if (remaining() <= 1500) {
            throw lastError ?? new ModelTimeoutError();
          }
          if (attempt > 0) {
            const backoff = Math.min(3000, 500 * 2 ** (attempt - 1)) + Math.random() * 300;
            await sleep(Math.min(backoff, Math.max(0, remaining() - 1000)));
          }
          try {
            return await callDeepSeekOnce(
              apiKey,
              messages,
              options,
              Math.min(PER_CALL_TIMEOUT_MS, Math.max(3000, remaining() - 500))
            );
          } catch (error) {
            lastError = error;
            if (!isDeepSeekRetryableError(error)) throw error;
          }
        }
        throw lastError;
      },
      isDeepSeekRetryableError
    );
  } catch (error) {
    if (isDeepSeekRetryableError(error)) {
      throw new ModelBusyError();
    }
    throw error;
  }
}

/**
 * Convenience wrapper for JSON-mode requests: forces response_format to
 * json_object and returns the parsed object directly.
 */
export async function generateDeepSeekJSON<T = any>(
  messages: DeepSeekChatMessage[],
  options: DeepSeekCallOptions = {}
): Promise<T> {
  const content = await generateDeepSeekCompletion(messages, {
    ...options,
    responseFormat: "json_object",
  });
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new Error("پاسخ DeepSeek قابل تبدیل به JSON نبود.");
  }
}

export { ModelBusyError, ModelTimeoutError } from "./aiErrors";
