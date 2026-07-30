// Shared error types used by both AI providers (DeepSeek for text chat,
// Gemini for vision/OCR) so that API routes can catch a single, consistent
// error shape regardless of which provider ultimately served (or failed to
// serve) the request.

export const MODEL_BUSY_MESSAGE =
  "سرور هوش مصنوعی فعلاً شلوغ است؛ لطفاً چند لحظه دیگر دوباره تلاش کنید.";

export const MODEL_TIMEOUT_MESSAGE =
  "پاسخ هوش مصنوعی بیش از حد طول کشید؛ لطفاً دوباره تلاش کنید (در صورت امکان پیام را کوتاه‌تر بنویسید).";

// Thrown once every configured API key (round-robin) has been exhausted due
// to rate limiting (429), quota exceeded, or the provider being otherwise
// unavailable (5xx).
export class ModelBusyError extends Error {
  constructor(message: string = MODEL_BUSY_MESSAGE) {
    super(message);
    this.name = "ModelBusyError";
  }
}

// Thrown when the whole retry/rotation budget is spent waiting on slow or
// hanging responses, across every key.
export class ModelTimeoutError extends Error {
  constructor(message: string = MODEL_TIMEOUT_MESSAGE) {
    super(message);
    this.name = "ModelTimeoutError";
  }
}
