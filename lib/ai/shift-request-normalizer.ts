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
  /**
   * یعنی «روزها خوانده شده ولی نوع شیفت [نامفهوم] است» — مخصوص OCR تصاویر.
   * این آیتم‌ها حذف نمی‌شوند تا عددهای خوانده‌شده حفظ شوند؛ کاربر باید
   * در «قسمت ویرایش» نوع شیفت را مشخص کند و تا آن زمان ثبت نهایی مسدود است.
   */
  needsClarification?: boolean;
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

  const needsClarification = item.needsClarification === true;

  const requestType = typeof item.requestType === "string" && VALID_REQUEST_TYPES.has(item.requestType)
    ? item.requestType
    : null;
  if (!requestType) return null;

  // آیتم needsClarification ممکن است scope نداشته باشد؛ با selectedDays به custom_days ترمیم می‌شود.
  let scope = typeof item.scope === "string" && VALID_SCOPES.has(item.scope) ? item.scope : null;
  if (!scope && needsClarification) scope = "custom_days";
  if (!scope) return null;

  let preferredShift: string | undefined;
  if (!isPlaceholder(item.preferredShift) && typeof item.preferredShift === "string") {
    const candidate = item.preferredShift.trim().toUpperCase();
    if (VALID_SHIFTS.has(candidate)) preferredShift = candidate;
  }
  if ((requestType === "shift" || requestType === "avoid_shift") && !preferredShift && !needsClarification) {
    return null; // شیفت نامشخص → آیتم بی‌معناست (مگر اینکه الگوی «فقط عدد خوانده شده» باشد)
  }

  const selectedDays = normalizeDayList(item.selectedDays, totalDays);
  if (scope === "custom_days" && (!selectedDays || selectedDays.length === 0)) {
    return null;
  }

  // آیتم needsClarification بدون عدد خوانده‌شده فایده‌ای ندارد — همان قانونِ حذف.
  if (needsClarification) {
    if (!selectedDays || selectedDays.length === 0) return null;
    scope = "custom_days";
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
    : needsClarification
      ? "روزها خوانده شد؛ نوع شیفت [نامفهوم] است — از «ویرایش» مشخص کن"
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
    needsClarification: needsClarification || undefined,
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
 * توضیح متنی قرارداد JSON برای مدل‌های متنی OpenRouter (GPT-4o-mini / GPT-4o).
 * مدل‌های GPT نیاز به شرح دقیق JSON دارند — خروجی باید دقیقاً یک شیء JSON باشد.
 * Vision models (gpt-4o-mini / gpt-4o) هم همین قرارداد را می‌پذیرند وقتی response_format json_object باشد.
 */
export const GROQ_JSON_CONTRACT = `
OUTPUT — exactly one JSON object, no markdown, no prose outside it:
{"status":"ready|clarification|chat","reply":"<Persian>","summary":"<Persian>","warnings":[],"questions":[],
 "requests":[{"requestType":"shift|OFF|leave|pattern|avoid_shift","preferredShift":"M|E|N|ME|EN|MN|MEN|OFF|L",
 "patternSteps":[],"isEssential":false,"offHardness":"hard|soft","scope":"all|even|odd|weekly_even|weekly_odd|custom_days|range",
 "startDate":"","endDate":"","selectedDays":[],"description":"<Persian>"}]}
Rules: selectedDays REQUIRED when scope="custom_days", Latin digits only (1,2,3 — never ۱,۲,۳).
startDate/endDate only for scope="range". patternSteps only for requestType="pattern".
Never emit "undefined"/"null"/"?" as a value — omit the whole item instead.
`;

/** نام جدید برای معماری OpenRouter — همان قرارداد ولی با نام به‌روز */
export const OPENROUTER_JSON_CONTRACT = GROQ_JSON_CONTRACT;
export const DEEPSEEK_JSON_CONTRACT = GROQ_JSON_CONTRACT;
export const TEXT_JSON_CONTRACT = GROQ_JSON_CONTRACT;

/** قرارداد JSON برای مدل‌های بینایی (Vision / OCR) — شامل وضعیت illegible برای تصاویر ناخوانا */
export const VISION_JSON_CONTRACT = `
OUTPUT — exactly one JSON object, no markdown, no prose outside it:
{"status":"ready|clarification|illegible","reply":"<Persian>","warnings":[],
 "requests":[{"requestType":"shift|OFF|leave|pattern|avoid_shift","preferredShift":"M|E|N|ME|EN|MN|MEN|OFF|L",
 "patternSteps":[],"isEssential":false,"offHardness":"hard|soft","scope":"all|even|odd|weekly_even|weekly_odd|custom_days|range",
 "startDate":"","endDate":"","selectedDays":[],"description":"<Persian>","needsClarification":false}]}
Rules: selectedDays REQUIRED when scope="custom_days", Latin digits only (1,2,3 — never ۱,۲,۳).
needsClarification=true فقط وقتی روزها (اعداد) خوانده شده ولی کلمهٔ شیفت [نامفهوم] است؛ در این حالت preferredShift را کاملاً حذف کن و selectedDays را پر نگه دار.
If image is blurry/crowded or text is unreadable, return status="illegible" with empty requests and a warning in Persian.
Never emit "undefined"/"null"/"?" as a value — omit the whole item instead.
`;
