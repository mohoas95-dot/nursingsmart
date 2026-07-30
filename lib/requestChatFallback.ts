// Lightweight deterministic parser used only as a safety net when Gemini API is
// busy/slow or returns an empty structured result for an otherwise obvious
// scheduling request. It intentionally covers common Persian nursing-request
// phrases; Gemini remains the primary conversational engine.

export type FallbackRequestType = "shift" | "OFF" | "leave" | "pattern" | "avoid_shift";
export type FallbackShift = "M" | "E" | "N" | "ME" | "EN" | "MN" | "MEN" | "OFF" | "L";
export type FallbackScope = "all" | "even" | "odd" | "weekly_even" | "weekly_odd" | "custom_days" | "range";

export type FallbackCalendarDay = {
  day: number;
  dayOfWeek?: number;
  weekdayName?: string;
  isHoliday?: boolean;
};

export type FallbackShiftRequest = {
  requestType: FallbackRequestType;
  preferredShift?: FallbackShift;
  patternSteps?: FallbackShift[];
  isEssential: boolean;
  offHardness?: "hard" | "soft";
  scope: FallbackScope;
  startDate?: string;
  endDate?: string;
  selectedDays?: number[];
  description?: string;
};

type ParsedScope = {
  scope: FallbackScope;
  selectedDays?: number[];
};

const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

const DAY_WORDS: Array<[number, string[]]> = [
  [1, ["اول", "یکم"]],
  [2, ["دوم"]],
  [3, ["سوم"]],
  [4, ["چهارم"]],
  [5, ["پنجم"]],
  [6, ["ششم"]],
  [7, ["هفتم"]],
  [8, ["هشتم"]],
  [9, ["نهم"]],
  [10, ["دهم"]],
  [11, ["یازدهم"]],
  [12, ["دوازدهم"]],
  [13, ["سیزدهم"]],
  [14, ["چهاردهم"]],
  [15, ["پانزدهم"]],
  [16, ["شانزدهم"]],
  [17, ["هفدهم"]],
  [18, ["هجدهم"]],
  [19, ["نوزدهم"]],
  [20, ["بیستم"]],
  [21, ["بیست و یکم", "بیست‌ویکم"]],
  [22, ["بیست و دوم", "بیست‌ودوم"]],
  [23, ["بیست و سوم", "بیست‌وسوم"]],
  [24, ["بیست و چهارم", "بیست‌وچهارم"]],
  [25, ["بیست و پنجم", "بیست‌وپنجم"]],
  [26, ["بیست و ششم", "بیست‌وششم"]],
  [27, ["بیست و هفتم", "بیست‌وهفتم"]],
  [28, ["بیست و هشتم", "بیست‌وهشتم"]],
  [29, ["بیست و نهم", "بیست‌ونهم"]],
  [30, ["سی‌ام", "سی ام", "سیم"]],
  [31, ["سی و یکم", "سی‌ویکم"]],
];

const WEEKDAY_ALIASES: Array<[number, RegExp]> = [
  [1, /(^|\s)یک\s*شنبه(?:ها|‌ها)?(?=\s|$)/],
  [2, /(^|\s)دو\s*شنبه(?:ها|‌ها)?(?=\s|$)/],
  [3, /(^|\s)سه\s*شنبه(?:ها|‌ها)?(?=\s|$)/],
  [4, /(^|\s)چهار\s*شنبه(?:ها|‌ها)?(?=\s|$)/],
  [5, /(^|\s)پنج\s*شنبه(?:ها|‌ها)?(?=\s|$)/],
  [6, /(^|\s)جمعه(?:ها|‌ها)?(?=\s|$)/],
  [0, /(^|\s)شنبه(?:ها|‌ها)?(?=\s|$)/],
];

const SHIFT_LABELS: Record<FallbackShift, string> = {
  M: "صبح",
  E: "عصر",
  N: "شب",
  ME: "لانگ/صبح‌عصر",
  EN: "عصر و شب",
  MN: "شب و صبح",
  MEN: "۲۴ ساعته",
  OFF: "آف",
  L: "مرخصی",
};

function toEnglishDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, digit => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String(ARABIC_DIGITS.indexOf(digit)));
}

function normalizeText(value: string): string {
  return toEnglishDigits(value)
    .replace(/[ي]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[ۀة]/g, "ه")
    .replace(/\u200c/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueSortedDays(days: number[], totalDays: number): number[] {
  return Array.from(new Set(days))
    .filter(day => Number.isInteger(day) && day >= 1 && day <= totalDays)
    .sort((a, b) => a - b);
}

function protectShiftConjunctions(text: string): string {
  return text
    .replace(/صبح\s*(?:و|-)\s*عصر\s*(?:و|-)\s*شب/g, "صبح_عصر_شب")
    .replace(/عصر\s*(?:و|-)\s*شب/g, "عصر_شب")
    .replace(/صبح\s*(?:و|-)\s*عصر/g, "صبح_عصر")
    .replace(/صبح\s*(?:و|-)\s*شب/g, "صبح_شب");
}

function restoreProtectedText(text: string): string {
  return text
    .replace(/صبح_عصر_شب/g, "صبح و عصر و شب")
    .replace(/عصر_شب/g, "عصر و شب")
    .replace(/صبح_عصر/g, "صبح و عصر")
    .replace(/صبح_شب/g, "صبح و شب");
}

function hasActionCue(text: string): boolean {
  return !!detectShift(text) || isLeave(text) || isOff(text) || isAvoidance(text);
}

function startsLikeNewRequest(text: string): boolean {
  const normalized = normalizeText(text);
  return /^(?:روز(?:های)?\s*)?(?:\d{1,2}(?:\s*(?:ام|اُم|م|مین))?|اول|یکم|دوم|سوم|چهارم|پنجم|ششم|هفتم|هشتم|نهم|دهم|یازدهم|دوازدهم|سیزدهم|چهاردهم|پانزدهم|شانزدهم|هفدهم|هجدهم|نوزدهم|بیستم|بیست|سی|شنبه|یک\s*شنبه|دو\s*شنبه|سه\s*شنبه|چهار\s*شنبه|پنج\s*شنبه|جمعه|تعطیلات|تعطیل|غیر\s*تعطیل|کل|تمام|همه|زوج|فرد)(?:\s|$)/.test(normalized);
}

function splitActionConjunctions(protectedChunk: string): string[] {
  const parts = protectedChunk.split(/\s+و\s+/).filter(Boolean);
  if (parts.length <= 1) return [restoreProtectedText(protectedChunk).trim()].filter(Boolean);

  const result: string[] = [];
  let current = parts[0];

  for (let index = 1; index < parts.length; index++) {
    const next = parts[index];
    const currentText = restoreProtectedText(current);
    const nextText = restoreProtectedText(next);

    if (hasActionCue(currentText) && hasActionCue(nextText) && startsLikeNewRequest(nextText)) {
      result.push(currentText.trim());
      current = next;
    } else {
      current = `${current} و ${next}`;
    }
  }

  result.push(restoreProtectedText(current).trim());
  return result.filter(Boolean);
}

function splitIntoRequestChunks(text: string): string[] {
  const normalized = protectShiftConjunctions(normalizeText(text));
  return normalized
    .split(/[،,؛;\n]+/g)
    .flatMap(chunk => splitActionConjunctions(chunk.trim()))
    .filter(Boolean);
}

function textIncludesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

function detectShift(text: string): FallbackShift | undefined {
  const normalized = normalizeText(text).toLowerCase();

  if (/صبح\s*(?:و|-)\s*عصر\s*(?:و|-)\s*شب|\bmen\b|24\s*ساعته|۲۴\s*ساعته|شیفت\s*24|شیفت\s*۲۴|بیست\s*و\s*چهار\s*ساعته/.test(normalized)) {
    return "MEN";
  }
  if (/عصر\s*(?:و|-)\s*شب|عصرشب|\ben\b/.test(normalized)) {
    return "EN";
  }
  if (/صبح\s*(?:و|-)\s*عصر|صبحعصر|لانگ|long|\bme\b/.test(normalized)) {
    return "ME";
  }
  if (/صبح\s*(?:و|-)\s*شب|صبحشب|\bmn\b/.test(normalized)) {
    return "MN";
  }
  if (/صبح\s*تک|شیفت\s*صبح|\bm\b|مورنینگ/.test(normalized) || /(^|\s)صبح($|\s)/.test(normalized)) {
    return "M";
  }
  if (/عصر\s*تک|شیفت\s*عصر|\be\b|ایونینگ/.test(normalized) || /(^|\s)عصر($|\s)/.test(normalized)) {
    return "E";
  }
  if (/شب\s*تک|شیفت\s*شب|\bn\b|نایت/.test(normalized) || /(^|\s)شب($|\s)/.test(normalized)) {
    return "N";
  }
  return undefined;
}

function isAvoidance(text: string): boolean {
  return textIncludesAny(normalizeText(text), [
    /نباشم|نباشد|نباشه|نبودن|نذار(?:ید)?|نگذار(?:ید)?|نمی\s*خوام|نمیخواهم|نمی\s*خواهم/,
    /اجتناب|پرهیز|عدم\s+حضور|بدون\s+شیفت/,
  ]);
}

function isLeave(text: string): boolean {
  return /مرخصی|استحقاقی|استعلاجی|leave/i.test(normalizeText(text));
}

function isOff(text: string): boolean {
  const normalized = normalizeText(text).toLowerCase();
  return /(^|\s)(آف|اف|off)(?=\s|$)|تعطیل\s*(?:باش|بذار|بگذار|می\s*خوام|میخوام)|کشیک\s+نباش|استراحت/.test(normalized);
}

function isEssential(text: string): boolean {
  return /حتما|حتمی|ضروری|اجباری|قطعی|خیلی\s+مهم|الزامی|must/i.test(normalizeText(text));
}

function offHardness(text: string): "hard" | "soft" {
  const normalized = normalizeText(text);
  if (/ترجیح|اگه\s+شد|اگر\s+شد|در\s+صورت\s+امکان|ممکنه|امکانش\s+هست/.test(normalized)) return "soft";
  return "hard";
}

function getDaysForWeekday(calendarDays: FallbackCalendarDay[], weekday: number, totalDays: number): number[] {
  return uniqueSortedDays(
    calendarDays
      .filter(day => day.dayOfWeek === weekday)
      .map(day => Number(day.day)),
    totalDays,
  );
}

function extractNumericDays(text: string, totalDays: number): number[] {
  // Remove unambiguous 24-hour shift expressions so they are not mistaken for
  // day 24. Expressions like "روز 24" or "24ام" remain intact.
  const source = normalizeText(text)
    .replace(/(?:شیفت\s*)?24\s*ساعته/g, " ")
    .replace(/شیفت\s*24(?!\s*(?:ام|اُم|م|مین))/g, " ");
  const days: number[] = [];

  for (const match of source.matchAll(/\d{1,2}(?:\s*(?:ام|اُم|م|مین))?/g)) {
    const raw = match[0];
    const value = Number(raw.match(/\d{1,2}/)?.[0]);
    if (!Number.isInteger(value)) continue;
    const index = match.index || 0;
    const before = source.slice(Math.max(0, index - 10), index);
    const after = source.slice(index + raw.length, index + raw.length + 12);
    if (/سال|ماه|ساعت/.test(before) || /ساعت|ساعته/.test(after)) continue;
    if (value >= 1 && value <= totalDays) days.push(value);
  }

  return uniqueSortedDays(days, totalDays);
}

function extractWordDays(text: string, totalDays: number): number[] {
  const normalized = normalizeText(text);
  const found: number[] = [];
  const entries = DAY_WORDS.flatMap(([day, aliases]) => aliases.map(alias => [day, normalizeText(alias)] as [number, string]))
    .sort((a, b) => b[1].length - a[1].length);

  for (const [day, alias] of entries) {
    if (day > totalDays) continue;
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matcher = new RegExp(`(^|\\s)${escaped}(?=\\s|$|،|,|و)`, "g");
    if (matcher.test(normalized)) found.push(day);
  }
  return uniqueSortedDays(found, totalDays);
}

function extractRangeDays(text: string, totalDays: number): number[] {
  const normalized = normalizeText(text);
  const match = normalized.match(/(\d{1,2})(?:\s*(?:ام|اُم|م|مین))?\s*(?:تا|الی|-)\s*(\d{1,2})(?:\s*(?:ام|اُم|م|مین))?/);
  if (!match) return [];
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return [];
  const from = Math.max(1, Math.min(start, end));
  const to = Math.min(totalDays, Math.max(start, end));
  return uniqueSortedDays(Array.from({ length: to - from + 1 }, (_, index) => from + index), totalDays);
}

function detectScope(text: string, calendarDays: FallbackCalendarDay[], totalDays: number): ParsedScope | null {
  const normalized = normalizeText(text);

  if (/(کل|تمام|همه)\s+(?:ماه|روزها)|سرتاسر\s+ماه/.test(normalized)) {
    return { scope: "all" };
  }
  if (/روزهای\s+زوج\s+هفته|شیفتهای\s+زوج\s+هفته/.test(normalized)) {
    return { scope: "weekly_even" };
  }
  if (/روزهای\s+فرد\s+هفته|شیفتهای\s+فرد\s+هفته/.test(normalized)) {
    return { scope: "weekly_odd" };
  }
  if (/روزهای\s+زوج|تاریخ(?:های)?\s+زوج/.test(normalized)) {
    return { scope: "even" };
  }
  if (/روزهای\s+فرد|تاریخ(?:های)?\s+فرد/.test(normalized)) {
    return { scope: "odd" };
  }

  const holidayDays = /غیر\s*تعطیل|غیرتعطیل/.test(normalized)
    ? calendarDays.filter(day => !day.isHoliday).map(day => Number(day.day))
    : /تعطیلات|تعطیل(?:ها|‌ها)|روزهای\s+تعطیل|جمعه\s*ها|جمعه‌ها/.test(normalized)
      ? calendarDays.filter(day => day.isHoliday || day.dayOfWeek === 6).map(day => Number(day.day))
      : [];
  if (holidayDays.length > 0) {
    return { scope: "custom_days", selectedDays: uniqueSortedDays(holidayDays, totalDays) };
  }

  const weekdayDays: number[] = [];
  for (const [weekday, matcher] of WEEKDAY_ALIASES) {
    if (matcher.test(normalized)) {
      weekdayDays.push(...getDaysForWeekday(calendarDays, weekday, totalDays));
    }
  }
  if (weekdayDays.length > 0) {
    return { scope: "custom_days", selectedDays: uniqueSortedDays(weekdayDays, totalDays) };
  }

  const days = uniqueSortedDays([
    ...extractRangeDays(normalized, totalDays),
    ...extractNumericDays(normalized, totalDays),
    ...extractWordDays(normalized, totalDays),
  ], totalDays);
  if (days.length > 0) {
    return { scope: "custom_days", selectedDays: days };
  }

  return null;
}

function inferRequestFromChunk(chunk: string, calendarDays: FallbackCalendarDay[], totalDays: number): FallbackShiftRequest | null {
  const scope = detectScope(chunk, calendarDays, totalDays);
  if (!scope) return null;

  const shift = detectShift(chunk);
  const leave = isLeave(chunk);
  const off = isOff(chunk);
  const avoid = isAvoidance(chunk);
  const essential = isEssential(chunk);

  let requestType: FallbackRequestType | null = null;
  let preferredShift: FallbackShift | undefined;

  if (leave) {
    requestType = "leave";
    preferredShift = "L";
  } else if (off || (avoid && !shift)) {
    requestType = "OFF";
    preferredShift = "OFF";
  } else if (avoid && shift) {
    requestType = "avoid_shift";
    preferredShift = shift;
  } else if (shift) {
    requestType = "shift";
    preferredShift = shift;
  }

  if (!requestType) return null;

  const request: FallbackShiftRequest = {
    requestType,
    preferredShift,
    isEssential: essential,
    offHardness: requestType === "OFF" ? offHardness(chunk) : undefined,
    scope: scope.scope,
    selectedDays: scope.scope === "custom_days" ? scope.selectedDays : undefined,
    description: buildRequestDescription({
      requestType,
      preferredShift,
      isEssential: essential,
      offHardness: requestType === "OFF" ? offHardness(chunk) : undefined,
      scope: scope.scope,
      selectedDays: scope.scope === "custom_days" ? scope.selectedDays : undefined,
    }),
  };

  if (request.scope === "custom_days" && (!request.selectedDays || request.selectedDays.length === 0)) {
    return null;
  }
  if ((request.requestType === "shift" || request.requestType === "avoid_shift") && !request.preferredShift) {
    return null;
  }

  return request;
}

function dedupeRequests(requests: FallbackShiftRequest[]): FallbackShiftRequest[] {
  const seen = new Set<string>();
  const result: FallbackShiftRequest[] = [];
  for (const request of requests) {
    const key = JSON.stringify({
      requestType: request.requestType,
      preferredShift: request.preferredShift,
      scope: request.scope,
      selectedDays: request.selectedDays,
      patternSteps: request.patternSteps,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(request);
  }
  return result;
}

export function parseShiftRequestsFallback(
  text: string,
  options: { totalDays: number; calendarDays?: FallbackCalendarDay[] },
): FallbackShiftRequest[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const totalDays = Number.isInteger(options.totalDays) && options.totalDays > 0 ? options.totalDays : 31;
  const calendarDays = Array.isArray(options.calendarDays) ? options.calendarDays : [];
  const chunks = splitIntoRequestChunks(normalized);
  const parsed: FallbackShiftRequest[] = [];

  for (const chunk of chunks) {
    const request = inferRequestFromChunk(chunk, calendarDays, totalDays);
    if (request) parsed.push(request);
  }

  // If punctuation-free text contains one obvious request, parsing the whole
  // message often recovers cases like "دهم و دوازدهم آف".
  if (parsed.length === 0 && chunks.length !== 1) {
    const request = inferRequestFromChunk(normalized, calendarDays, totalDays);
    if (request) parsed.push(request);
  }

  return dedupeRequests(parsed);
}

function formatDays(days?: number[]): string {
  if (!days || days.length === 0) return "";
  if (days.length === 1) return `روز ${days[0]}`;
  return `روزهای ${days.join("، ")}`;
}

function formatScope(request: Pick<FallbackShiftRequest, "scope" | "selectedDays">): string {
  switch (request.scope) {
    case "all":
      return "کل ماه";
    case "even":
      return "روزهای زوج ماه";
    case "odd":
      return "روزهای فرد ماه";
    case "weekly_even":
      return "شنبه/دوشنبه/چهارشنبه";
    case "weekly_odd":
      return "یکشنبه/سه‌شنبه/پنجشنبه";
    case "custom_days":
      return formatDays(request.selectedDays);
    default:
      return "بازهٔ انتخابی";
  }
}

export function buildRequestDescription(request: FallbackShiftRequest): string {
  const scopeText = formatScope(request);
  if (request.requestType === "OFF") return `آف ${scopeText}`.trim();
  if (request.requestType === "leave") return `مرخصی ${scopeText}`.trim();
  if (request.requestType === "avoid_shift") return `نبودن در شیفت ${SHIFT_LABELS[request.preferredShift || "M"]} ${scopeText}`.trim();
  if (request.requestType === "shift") return `شیفت ${SHIFT_LABELS[request.preferredShift || "M"]} ${scopeText}`.trim();
  return `الگوی شیفت ${scopeText}`.trim();
}

export function buildFallbackChatReply(requests: FallbackShiftRequest[], firstName?: string): { reply: string; summary: string } {
  const parts = requests.map((request, index) => `${index + 1}. ${buildRequestDescription(request)}`);
  const prefix = firstName ? `${firstName} جان، ` : "";
  const summary = parts.join(" | ");
  return {
    reply: `${prefix}این درخواست‌ها را آماده کردم: ${summary}. اگر درست است، دکمهٔ «تأیید و ثبت نهایی» را بزن؛ اگر نه، همین‌جا اصلاحش کن.`,
    summary: `منظور شما این است؟ ${summary}`,
  };
}
