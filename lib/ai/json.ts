/**
 * lib/ai/json.ts
 * ---------------------------------------------------------------------------
 * استخراج امن JSON از خروجی مدل‌های زبانی.
 *
 * مدل‌های Groq (Llama) حتی در حالت `response_format: json_object` گاهی خروجی را
 * داخل ```json ... ``` می‌پیچند یا یک جملهٔ توضیحی قبل/بعد از JSON اضافه می‌کنند.
 * این ماژول تضمین می‌کند که هیچ‌وقت یک `JSON.parse` خام باعث ۵۰۰ شدن مسیر API
 * (و در نتیجه قفل‌شدن چت‌باکس) نشود.
 */

/** حذف حصار کد (```json ... ```) از ابتدا و انتهای متن. */
function stripCodeFence(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith("```")) return text;
  return text
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/```\s*$/, "")
    .trim();
}

/**
 * اولین شیء JSON متعادل (balanced braces) داخل متن را برمی‌گرداند.
 * رشته‌های داخل JSON (و escape ها) نادیده گرفته می‌شوند تا آکولاد داخل رشته
 * باعث برش اشتباه نشود.
 */
function sliceBalancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

/**
 * تلاش چندمرحله‌ای برای تبدیل خروجی مدل به یک شیء JSON.
 * اگر هیچ‌کدام موفق نشد، `null` برمی‌گرداند (هرگز throw نمی‌کند).
 */
export function extractJsonObject<T = Record<string, unknown>>(raw: string | null | undefined): T | null {
  if (!raw || typeof raw !== "string") return null;

  const candidates: string[] = [];
  const unfenced = stripCodeFence(raw);
  candidates.push(unfenced);

  const balanced = sliceBalancedObject(unfenced);
  if (balanced && balanced !== unfenced) candidates.push(balanced);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed as T;
    } catch {
      // ادامه به کاندیدای بعدی
    }
  }

  return null;
}
