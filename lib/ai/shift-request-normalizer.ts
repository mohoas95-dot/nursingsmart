/**
 * lib/ai/shift-request-normalizer.ts
 * ---------------------------------------------------------------------------
 * نرمال‌سازی و اعتبارسنجی سمت سرورِ خروجی هوش مصنوعی.
 *
 * چرا اینجا متمرکز شده؟
 *   هر سه مسیر (چت متنی با Groq، تحلیل تصویر با Gemini، و پارس متن ساده) باید
 *   دقیقاً یک قرارداد دادهٔ یکسان تولید کنند. اگر هر مسیر منطق خودش را داشته
 *   باشد، تفاوت‌های ریز باعث می‌شود درخواست‌های معیوب وارد پایگاه‌داده شوند.
 *
 * قاعدهٔ طلایی: «آیتم ناقص، حذف می‌شود؛ نه اینکه با placeholder ثبت شود.»
 * هیچ‌گاه مقدار "undefined" یا "?" به رابط کاربری نمی‌رسد.
 */

export const VALID_REQUEST_TYPES = new Set(["shift", "OFF", "leave", "pattern", "avoid_shift"]);
export const VALID_SHIFTS = new Set(["M", "E", "N", "ME", "EN", "MN", "MEN", "OFF", "L"]);
export const VALID_SCOPES = new Set([
  "all",
  "even",
  "odd",
  "weekly_even",
  "weekly_odd",
  "custom_days",
  "range",
]);
export const VALID_OFF_HARDNESS = new Set(["hard", "soft"]);

/** مقادیری که یعنی «مدل نفهمیده» و هرگز نباید به فرانت‌اند برسند. */
const PLACEHOLDER_VALUES = new Set([
  "",
  "undefined",
  "null",
  "none",
  "n/a",
  "?",
  "؟",
  "-",
  "—",
  "unknown",
  "نامشخص",
  "تعریف‌نشده",
  "نامعلوم",
  "ندارد",
]);

export function isPlaceholder(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  return PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

export interface NormalizedShiftRequest {
  requestType: string;
  preferredShift?: string;
  patternSteps?: string[];
  isEssential: boolean;
  offHardness?: string;
  scope: string;
  startDate?: string;
  endDate?: string;
  selectedDays?: number[];
  description?: string;
}

/** ارقام فارسی/عربی → لاتین (مدل‌ها گاهی «۱۲» برمی‌گردانند). */
function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function normalizeDayList(value: unknown, totalDays: number): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const days = Array.from(
    new Set(
      value
        .map(item => Number(typeof item === "string" ? toLatinDigits(item) : item))
        .filter(day => Number.isInteger(day) && day >= 1 && day <= totalDays),
    ),
  ).sort((left, right) => left - right);
  return days.length > 0 ? days : undefined;
}

/**
 * یک آیتم خام مدل را به ساختار معتبر تبدیل می‌کند.
 * اگر آیتم غیرقابل نجات باشد `null` برمی‌گردد تا حذف شود.
 */
export function normalizeShiftRequest(raw: unknown, totalDays: number): NormalizedShiftRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;

  const requestType = typeof item.requestType === "string" && VALID_REQUEST_TYPES.has(item.requestType)
    ? item.requestType
    : null;
  if (!requestType) return null;

  const scope = typeof item.scope === "string" && VALID_SCOPES.has(item.scope) ? item.scope : null;
  if (!scope) return null;

  let preferredShift: string | undefined;
  if (!isPlaceholder(item.preferredShift) && typeof item.preferredShift === "string") {
    const candidate = item.preferredShift.trim().toUpperCase();
    if (VALID_SHIFTS.has(candidate)) preferredShift = candidate;
  }
  if ((requestType === "shift" || requestType === "avoid_shift") && !preferredShift) {
    return null; // شیفت نامشخص → آیتم بی‌معناست
  }

  const selectedDays = normalizeDayList(item.selectedDays, totalDays);
  if (scope === "custom_days" && (!selectedDays || selectedDays.length === 0)) {
    return null;
  }

  const patternSteps = Array.isArray(item.patternSteps)
    ? item.patternSteps
        .map(step => String(step ?? "").trim().toUpperCase())
        .filter(step => VALID_SHIFTS.has(step))
    : undefined;
  if (requestType === "pattern" && (!patternSteps || patternSteps.length === 0)) {
    return null;
  }

  const description = typeof item.description === "string" && !isPlaceholder(item.description)
    ? item.description
    : undefined;

  const offHardnessRaw = typeof item.offHardness === "string" ? item.offHardness : undefined;

  return {
    requestType,
    preferredShift:
      requestType === "OFF" ? "OFF" : requestType === "leave" ? "L" : preferredShift,
    patternSteps: patternSteps && patternSteps.length > 0 ? patternSteps : undefined,
    isEssential: !!item.isEssential,
    offHardness:
      requestType === "OFF"
        ? offHardnessRaw && VALID_OFF_HARDNESS.has(offHardnessRaw)
          ? offHardnessRaw
          : "hard"
        : undefined,
    scope,
    startDate:
      typeof item.startDate === "string" && !isPlaceholder(item.startDate) ? item.startDate : undefined,
    endDate:
      typeof item.endDate === "string" && !isPlaceholder(item.endDate) ? item.endDate : undefined,
    selectedDays: scope === "custom_days" ? selectedDays : undefined,
    description,
  };
}

/** نرمال‌سازی یک آرایه + شمارش آیتم‌های حذف‌شده (برای هشدار به کاربر). */
export function normalizeShiftRequestList(
  rawList: unknown,
  totalDays: number,
): { requests: NormalizedShiftRequest[]; droppedCount: number } {
  const list = Array.isArray(rawList) ? rawList : [];
  const requests: NormalizedShiftRequest[] = [];
  let droppedCount = 0;

  for (const raw of list) {
    const normalized = normalizeShiftRequest(raw, totalDays);
    if (normalized) requests.push(normalized);
    else droppedCount++;
  }

  return { requests, droppedCount };
}

/**
 * توضیح متنی قرارداد JSON برای مدل‌های Groq.
 * (Gemini از responseSchema بومی استفاده می‌کند؛ Llama به یک شرح دقیق نیاز دارد.)
 */
export const GROQ_JSON_CONTRACT = `
OUTPUT CONTRACT — return EXACTLY one JSON object with this shape (no markdown, no prose outside JSON):
{
  "status": "ready" | "clarification" | "chat",
  "reply": string,                      // Persian chat bubble text (required)
  "summary": string,                    // short Persian recap (may be "")
  "warnings": string[],                 // may be []
  "questions": string[],                // may be []
  "requests": [
    {
      "requestType": "shift" | "OFF" | "leave" | "pattern" | "avoid_shift",
      "preferredShift": "M" | "E" | "N" | "ME" | "EN" | "MN" | "MEN" | "OFF" | "L",
      "patternSteps": string[],         // only for requestType="pattern"
      "isEssential": boolean,
      "offHardness": "hard" | "soft",   // only for requestType="OFF"
      "scope": "all" | "even" | "odd" | "weekly_even" | "weekly_odd" | "custom_days" | "range",
      "startDate": string,              // only for scope="range", Persian "YYYY/MM/DD"
      "endDate": string,                // only for scope="range"
      "selectedDays": number[],         // REQUIRED when scope="custom_days", Latin digits 1..totalDays
      "description": string             // short Persian recap of this single item
    }
  ]
}
Every key listed above must use exactly these names and value types.
Use Latin digits (1,2,3) inside selectedDays — never Persian digits.
Never output the literal strings "undefined", "null", "?" as a value; omit the item instead.
`;
