/**
 * SystemEvents — Domain Layer (Pure Functions)
 *
 * RESPONSIBILITY:
 *   مدل دادهٔ «لاگ‌ها و اتفاقات» سامانه: ثبت ساخت‌یافتهٔ هشدارها، رویدادها و
 *   گزارش پردازش موتور هوشمند (solver) به‌همراه سقف نگهداری.
 *
 * چرا لازم است؟
 *   پیش از این فقط چند رویداد قفل/مهلت به‌صورت رشتهٔ آزاد در `changeLogs` ذخیره
 *   می‌شد؛ نه زمان دقیق داشت، نه شدت (severity)، نه دسته‌بندی و نه سقف رشد. با
 *   افزایش رویدادها، سند ماهانه در فضای ذخیره‌سازی بی‌وقفه بزرگ می‌شد.
 *
 * قواعد:
 *   ۱) فقط MAX_SYSTEM_EVENT_LOGS (۳۰) رویداد آخر نگهداری می‌شود؛ قدیمی‌ترها
 *      به‌کلی از سامانه حذف می‌شوند تا فضای ذخیره‌سازی پر نشود.
 *   ۲) رویدادهای تکراری پشت‌سرهم (همان عنوان و جزئیات در بازهٔ کوتاه) یک‌بار
 *      ثبت می‌شوند تا سهمیهٔ ۳۰تایی با نویز پر نشود.
 *   ۳) رشته‌های قدیمی `changeLogs` بدون از دست رفتن اطلاعات به رویداد ساخت‌یافته
 *      تبدیل می‌شوند.
 *
 * PURE: بدون وابستگی به React، Next.js، شبکه یا I/O.
 */

/** سقف نگهداری رویدادها در هر برنامهٔ ماهانه. */
export const MAX_SYSTEM_EVENT_LOGS = 30;

/** بازه‌ای که دو رویداد کاملاً یکسان، تکراری محسوب می‌شوند (میلی‌ثانیه). */
const DUPLICATE_WINDOW_MS = 1_500;

const MAX_TITLE_LENGTH = 300;
const MAX_DETAIL_LENGTH = 1_500;
const MAX_ACTOR_LENGTH = 120;

export const SYSTEM_EVENT_CATEGORIES = [
  'solver',
  'schedule',
  'alert',
  'lock',
  'requests',
  'personnel',
  'settings',
  'calendar',
  'storage',
] as const;

export type SystemEventCategory = (typeof SYSTEM_EVENT_CATEGORIES)[number];

export const SYSTEM_EVENT_SEVERITIES = ['info', 'success', 'warning', 'error'] as const;

export type SystemEventSeverity = (typeof SYSTEM_EVENT_SEVERITIES)[number];

/** یک رویداد ثبت‌شده در «لاگ‌ها و اتفاقات». */
export interface SystemEventLog {
  /** شناسهٔ یکتا؛ برای جلوگیری از ثبت دوباره هنگام ادغام. */
  id: string;
  /** زمان ثبت به‌صورت ISO؛ برای رکوردهای قدیمیِ مهاجرت‌شده خالی است. */
  at: string;
  category: SystemEventCategory;
  severity: SystemEventSeverity;
  title: string;
  detail?: string;
  /** کاربر یا نقشی که رویداد را ایجاد کرده است. */
  actor?: string;
}

/** ورودی ساخت رویداد؛ شناسه و زمان به‌صورت خودکار تکمیل می‌شوند. */
export interface SystemEventInput {
  category: SystemEventCategory;
  severity?: SystemEventSeverity;
  title: string;
  detail?: string;
  actor?: string;
  at?: string;
  id?: string;
}

function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function isCategory(value: unknown): value is SystemEventCategory {
  return typeof value === 'string' && (SYSTEM_EVENT_CATEGORIES as readonly string[]).includes(value);
}

function isSeverity(value: unknown): value is SystemEventSeverity {
  return typeof value === 'string' && (SYSTEM_EVENT_SEVERITIES as readonly string[]).includes(value);
}

let sequence = 0;

/** شناسهٔ یکتا و پایدار برای هر رویداد (بدون وابستگی به crypto مرورگر). */
export function createSystemEventId(now: number = Date.now()): string {
  sequence = (sequence + 1) % 100_000;
  const random = Math.floor(Math.random() * 1_679_616).toString(36).padStart(4, '0');
  return `evt_${now.toString(36)}_${sequence.toString(36)}${random}`;
}

/** یک ورودی خام را به رویداد معتبر و نرمال‌شده تبدیل می‌کند. */
export function createSystemEventLog(input: SystemEventInput, now: Date = new Date()): SystemEventLog {
  const title = clamp(input.title || 'رویداد بدون عنوان', MAX_TITLE_LENGTH);
  const detail = input.detail ? clamp(input.detail, MAX_DETAIL_LENGTH) : undefined;
  const actor = input.actor ? clamp(input.actor, MAX_ACTOR_LENGTH) : undefined;
  return {
    id: input.id || createSystemEventId(now.getTime()),
    at: input.at ?? now.toISOString(),
    category: isCategory(input.category) ? input.category : 'schedule',
    severity: isSeverity(input.severity) ? input.severity : 'info',
    title,
    ...(detail ? { detail } : {}),
    ...(actor ? { actor } : {}),
  };
}

function coerceStoredEvent(value: unknown): SystemEventLog | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) return null;
  const at = typeof raw.at === 'string' ? raw.at : '';
  const detail = typeof raw.detail === 'string' && raw.detail.trim().length > 0
    ? clamp(raw.detail, MAX_DETAIL_LENGTH)
    : undefined;
  const actor = typeof raw.actor === 'string' && raw.actor.trim().length > 0
    ? clamp(raw.actor, MAX_ACTOR_LENGTH)
    : undefined;
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id.slice(0, 80) : createSystemEventId(),
    at,
    category: isCategory(raw.category) ? raw.category : 'schedule',
    severity: isSeverity(raw.severity) ? raw.severity : 'info',
    title: clamp(raw.title, MAX_TITLE_LENGTH),
    ...(detail ? { detail } : {}),
    ...(actor ? { actor } : {}),
  };
}

/**
 * رکوردهای متنی قدیمی (`changeLogs`) را بدون از دست رفتن اطلاعات به رویداد
 * ساخت‌یافته تبدیل می‌کند. چون زمان دقیق آن‌ها قابل بازیابی نیست، `at` خالی
 * می‌ماند و در رابط کاربری به‌عنوان «رویداد بایگانی‌شده» نمایش داده می‌شود.
 */
export function migrateLegacyChangeLogs(legacyLogs: ReadonlyArray<string> | undefined): SystemEventLog[] {
  if (!legacyLogs || legacyLogs.length === 0) return [];
  const seen = new Set<string>();
  const migrated: SystemEventLog[] = [];
  for (const [index, text] of legacyLogs.entries()) {
    if (typeof text !== 'string') continue;
    const title = clamp(text, MAX_TITLE_LENGTH);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const category: SystemEventCategory = title.includes('مهلت درخواست') ? 'requests' : 'lock';
    migrated.push({
      id: `legacy_${index}_${title.length.toString(36)}`,
      at: '',
      category,
      severity: 'info',
      title,
    });
  }
  return migrated;
}

function sortByTime(events: ReadonlyArray<SystemEventLog>): SystemEventLog[] {
  // رکوردهای بدون زمان (مهاجرت‌شده) همیشه قدیمی‌ترین در نظر گرفته می‌شوند.
  return [...events]
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const leftTime = left.event.at ? Date.parse(left.event.at) : Number.NEGATIVE_INFINITY;
      const rightTime = right.event.at ? Date.parse(right.event.at) : Number.NEGATIVE_INFINITY;
      const leftValue = Number.isNaN(leftTime) ? Number.NEGATIVE_INFINITY : leftTime;
      const rightValue = Number.isNaN(rightTime) ? Number.NEGATIVE_INFINITY : rightTime;
      if (leftValue !== rightValue) return leftValue - rightValue;
      return left.index - right.index;
    })
    .map(item => item.event);
}

function duplicateKey(event: SystemEventLog): string {
  return `${event.category}|${event.severity}|${event.title}|${event.detail || ''}`;
}

/**
 * رویدادهای تازه را به فهرست موجود اضافه می‌کند و فقط `limit` رویداد آخر را
 * نگه می‌دارد. قدیمی‌ترها حذف می‌شوند تا فضای ذخیره‌سازی پر نشود.
 */
export function appendSystemEventLogs(
  existing: ReadonlyArray<SystemEventLog> | undefined,
  incoming: ReadonlyArray<SystemEventLog>,
  limit: number = MAX_SYSTEM_EVENT_LOGS
): SystemEventLog[] {
  const merged = sortByTime([...(existing || []), ...incoming]);
  const byId = new Set<string>();
  const deduped: SystemEventLog[] = [];

  for (const event of merged) {
    if (byId.has(event.id)) continue;

    const key = duplicateKey(event);
    const previous = deduped.length > 0 ? deduped[deduped.length - 1] : null;
    if (previous && duplicateKey(previous) === key) {
      const previousTime = previous.at ? Date.parse(previous.at) : NaN;
      const currentTime = event.at ? Date.parse(event.at) : NaN;
      const bothUndated = Number.isNaN(previousTime) && Number.isNaN(currentTime);
      const withinWindow = !Number.isNaN(previousTime)
        && !Number.isNaN(currentTime)
        && Math.abs(currentTime - previousTime) <= DUPLICATE_WINDOW_MS;
      if (bothUndated || withinWindow) {
        // جدیدترین نسخه جایگزین می‌شود تا زمان ثبت به‌روز بماند.
        deduped[deduped.length - 1] = event;
        byId.add(event.id);
        continue;
      }
    }

    byId.add(event.id);
    deduped.push(event);
  }

  const safeLimit = Math.max(1, Math.floor(limit));
  return deduped.length > safeLimit ? deduped.slice(deduped.length - safeLimit) : deduped;
}

/**
 * وضعیت ذخیره‌شدهٔ یک برنامهٔ ماهانه را به فهرست معتبر رویداد تبدیل می‌کند و
 * رکوردهای متنی قدیمی را هم در همان فهرست ادغام می‌نماید.
 */
export function normalizeSystemEventLogs(
  storedEvents: unknown,
  legacyChangeLogs?: ReadonlyArray<string>,
  limit: number = MAX_SYSTEM_EVENT_LOGS
): SystemEventLog[] {
  const structured: SystemEventLog[] = Array.isArray(storedEvents)
    ? storedEvents.map(coerceStoredEvent).filter((event): event is SystemEventLog => event !== null)
    : [];
  const legacy = migrateLegacyChangeLogs(legacyChangeLogs);
  return appendSystemEventLogs(legacy, structured, limit);
}

/** جدیدترین رویدادها در ابتدای فهرست (برای نمایش در رابط کاربری). */
export function orderEventLogsForDisplay(events: ReadonlyArray<SystemEventLog>): SystemEventLog[] {
  return sortByTime(events).reverse();
}

/** شمارش رویدادها بر اساس شدت؛ برای نمایش خلاصه در بالای پنل. */
export function summarizeEventLogs(events: ReadonlyArray<SystemEventLog>): Record<SystemEventSeverity, number> {
  const summary: Record<SystemEventSeverity, number> = { info: 0, success: 0, warning: 0, error: 0 };
  for (const event of events) summary[event.severity] += 1;
  return summary;
}

/** قالب‌بندی زمان رویداد به تاریخ و ساعت شمسی (منطقهٔ زمانی تهران). */
export function formatSystemEventTime(at: string): string {
  if (!at) return 'رویداد بایگانی‌شده (بدون زمان دقیق)';
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return 'زمان نامعتبر';
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      dateStyle: 'short',
      timeStyle: 'medium',
      timeZone: 'Asia/Tehran',
    }).format(parsed);
  } catch {
    return parsed.toISOString();
  }
}
