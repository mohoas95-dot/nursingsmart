/**
 * lib/ai/key-pool.ts
 * ---------------------------------------------------------------------------
 * مدیریت «استخر کلید» (API Key Pool) با چرخش خودکار.
 *
 * چرا؟
 *   سرویس‌های رایگان (Groq و Gemini) سقف روزانه/دقیقه‌ای دارند. با ۳ کلید رایگان
 *   برای هر سرویس، وقتی کلید اول به سقف بخورد (۴۲۹ / quota / rate limit) سیستم
 *   باید بی‌درنگ و بدون خطا سراغ کلید دوم و سپس سوم برود. کاربر هرگز نباید
 *   «خطای سهمیه» ببیند مادامی که حداقل یک کلید سالم باقی است.
 *
 * طراحی:
 *   - هر کلید یک وضعیت سلامت در حافظهٔ ماژول دارد (cooldown تا زمان مشخص).
 *   - خطای ۴۲۹/quota  → کلید برای QUOTA_COOLDOWN_MS در قرنطینه می‌رود.
 *   - خطای ۴۰۱/۴۰۳ (کلید باطل) → کلید برای مدت طولانی‌تری کنار گذاشته می‌شود.
 *   - خطای ۵۰۳/۵۰۰ (شلوغی موقت سرور) → کلید مقصر نیست؛ فقط cooldown کوتاه.
 *   - انتخاب کلید round-robin است تا بار بین کلیدها پخش شود و همیشه از کلیدی
 *     شروع کنیم که قبلاً موفق بوده (کاهش تأخیر «کلید سوخته» در هر درخواست).
 *
 * نکتهٔ سرورلس (Vercel):
 *   حافظهٔ ماژول بین فراخوانی‌های همان instance باقی می‌ماند (warm start) اما
 *   بین instance ها مشترک نیست. این کاملاً کافی است: بدترین حالت این است که یک
 *   instance تازه یک بار کلید سوخته را امتحان کند و فوراً به کلید بعدی برود.
 */

export type KeyFailureKind = "quota" | "invalid" | "busy" | "network";

export interface KeyPoolOptions {
  /** نام سرویس برای لاگ‌ها (مثلاً "groq" یا "gemini"). */
  provider: string;
  /**
   * نام متغیرهای محیطی به ترتیب اولویت. هر متغیر می‌تواند خودش چند کلید
   * جداشده با کاما داشته باشد (برای وقتی کاربر ترجیح می‌دهد همه را در یک
   * متغیر بگذارد).
   */
  envNames: string[];
}

interface KeyState {
  /** کلید خام. */
  value: string;
  /** برچسب امن برای لاگ (هیچ‌وقت خود کلید لاگ نمی‌شود). */
  label: string;
  /** تا این زمان (epoch ms) نباید استفاده شود. */
  cooldownUntil: number;
  /** آخرین دلیل خطا (برای پیام تشخیصی). */
  lastFailure?: KeyFailureKind;
  /** شمارندهٔ موفقیت/خطا صرفاً برای لاگ و تشخیص. */
  successes: number;
  failures: number;
}

/** مدت قرنطینه پس از خوردن به سقف سهمیه (پیش‌فرض ۱۰ دقیقه). */
const QUOTA_COOLDOWN_MS = Math.max(
  30_000,
  Number(process.env.AI_KEY_QUOTA_COOLDOWN_MS) || 10 * 60_000,
);

/** مدت قرنطینه برای کلید نامعتبر/باطل (پیش‌فرض ۶ ساعت). */
const INVALID_KEY_COOLDOWN_MS = Math.max(
  60_000,
  Number(process.env.AI_KEY_INVALID_COOLDOWN_MS) || 6 * 60 * 60_000,
);

/** مدت قرنطینهٔ کوتاه برای شلوغی موقت سرویس (پیش‌فرض ۲۰ ثانیه). */
const BUSY_COOLDOWN_MS = Math.max(
  1_000,
  Number(process.env.AI_KEY_BUSY_COOLDOWN_MS) || 20_000,
);

function maskKey(key: string, index: number): string {
  const tail = key.length >= 4 ? key.slice(-4) : "****";
  return `#${index + 1}(…${tail})`;
}

function cooldownFor(kind: KeyFailureKind): number {
  switch (kind) {
    case "quota":
      return QUOTA_COOLDOWN_MS;
    case "invalid":
      return INVALID_KEY_COOLDOWN_MS;
    case "busy":
    case "network":
    default:
      return BUSY_COOLDOWN_MS;
  }
}

/**
 * استخر کلید: کلیدها را از env می‌خواند، تکراری‌ها را حذف می‌کند و
 * ترتیب چرخشی سالم‌ترین کلیدها را ارائه می‌دهد.
 */
export class ApiKeyPool {
  private readonly provider: string;
  private readonly envNames: string[];
  private keys: KeyState[] = [];
  private cursor = 0;
  private loadedSignature = "";

  constructor(options: KeyPoolOptions) {
    this.provider = options.provider;
    this.envNames = options.envNames;
  }

  /**
   * خواندن (یا بازخوانی) کلیدها از محیط. اگر مقدار متغیرها عوض شود
   * (deploy جدید در Vercel) استخر به‌صورت خودکار بازسازی می‌شود.
   */
  private ensureLoaded(): void {
    const rawValues = this.envNames.map(name => process.env[name] || "");
    const signature = rawValues.join("|");
    if (signature === this.loadedSignature && this.keys.length > 0) return;

    const seen = new Set<string>();
    const nextKeys: KeyState[] = [];

    rawValues.forEach(raw => {
      raw
        .split(",")
        .map(part => part.trim())
        .filter(Boolean)
        .forEach(key => {
          if (seen.has(key)) return;
          seen.add(key);
          const previous = this.keys.find(state => state.value === key);
          nextKeys.push(
            previous ?? {
              value: key,
              label: maskKey(key, nextKeys.length),
              cooldownUntil: 0,
              successes: 0,
              failures: 0,
            },
          );
        });
    });

    // برچسب‌ها را با ترتیب فعلی هماهنگ نگه می‌داریم.
    nextKeys.forEach((state, index) => {
      state.label = maskKey(state.value, index);
    });

    this.keys = nextKeys;
    this.loadedSignature = signature;
    if (this.cursor >= this.keys.length) this.cursor = 0;
  }

  /** تعداد کل کلیدهای تنظیم‌شده. */
  size(): number {
    this.ensureLoaded();
    return this.keys.length;
  }

  /** تعداد کلیدهایی که همین الان قابل استفاده‌اند. */
  availableCount(): number {
    this.ensureLoaded();
    const now = Date.now();
    return this.keys.filter(state => state.cooldownUntil <= now).length;
  }

  /**
   * کوتاه‌ترین زمان باقی‌مانده تا آزاد شدن یک کلید (ms).
   * اگر کلیدی وجود نداشته باشد `undefined` برمی‌گرداند.
   */
  nextAvailableInMs(): number | undefined {
    this.ensureLoaded();
    if (this.keys.length === 0) return undefined;
    const now = Date.now();
    const waits = this.keys.map(state => Math.max(0, state.cooldownUntil - now));
    return Math.min(...waits);
  }

  /**
   * ترتیب امتحان کلیدها برای یک درخواست:
   *   اول کلیدهای سالم (به ترتیب چرخشی از cursor)، بعد کلیدهای در قرنطینه
   *   (به ترتیب نزدیک‌ترین زمان آزادی) به‌عنوان آخرین راه‌چاره.
   *
   * این «آخرین راه‌چاره» مهم است: اگر قرنطینه بر اساس یک خطای گذرا اشتباه
   * تنظیم شده باشد، سیستم باز هم به جای خطا دادن یک شانس دیگر می‌دهد.
   */
  order(): KeyState[] {
    this.ensureLoaded();
    if (this.keys.length === 0) return [];
    const now = Date.now();

    const rotated: KeyState[] = [];
    for (let offset = 0; offset < this.keys.length; offset++) {
      rotated.push(this.keys[(this.cursor + offset) % this.keys.length]);
    }

    const healthy = rotated.filter(state => state.cooldownUntil <= now);
    const cooling = rotated
      .filter(state => state.cooldownUntil > now)
      .sort((left, right) => left.cooldownUntil - right.cooldownUntil);

    return [...healthy, ...cooling];
  }

  /** ثبت موفقیت: cursor روی کلید بعدی می‌رود تا بار پخش شود. */
  reportSuccess(key: string): void {
    // ensureLoaded حیاتی است: ممکن است اولین تعامل با استخر همین گزارش باشد
    // (مثلاً در تست یا در مسیری که order() صدا زده نشده) و آرایهٔ کلیدها هنوز خالی باشد.
    this.ensureLoaded();
    const index = this.keys.findIndex(state => state.value === key);
    if (index === -1) return;
    const state = this.keys[index];
    state.cooldownUntil = 0;
    state.lastFailure = undefined;
    state.successes++;
    this.cursor = (index + 1) % this.keys.length;
  }

  /** ثبت خطا و قرنطینهٔ کلید متناسب با نوع خطا. */
  reportFailure(key: string, kind: KeyFailureKind, retryAfterMs?: number): void {
    this.ensureLoaded();
    const state = this.keys.find(item => item.value === key);
    if (!state) return;
    const cooldown = Math.max(cooldownFor(kind), retryAfterMs ?? 0);
    state.cooldownUntil = Date.now() + cooldown;
    state.lastFailure = kind;
    state.failures++;
    console.warn(
      `[${this.provider}] کلید ${state.label} به دلیل «${kind}» برای ${Math.round(cooldown / 1000)} ثانیه کنار گذاشته شد.`,
    );
  }

  /** گزارش وضعیت برای مسیر تشخیصی (بدون افشای هیچ کلیدی). */
  snapshot(): Array<{ label: string; healthy: boolean; cooldownSeconds: number; lastFailure?: KeyFailureKind; successes: number; failures: number }> {
    this.ensureLoaded();
    const now = Date.now();
    return this.keys.map(state => ({
      label: state.label,
      healthy: state.cooldownUntil <= now,
      cooldownSeconds: Math.max(0, Math.round((state.cooldownUntil - now) / 1000)),
      lastFailure: state.lastFailure,
      successes: state.successes,
      failures: state.failures,
    }));
  }
}

/** تشخیص نوع خطا از روی وضعیت HTTP و متن پیام سرویس. */
export function classifyFailure(status: number | undefined, message: string): KeyFailureKind {
  const text = String(message || "");
  if (status === 401 || status === 403) return "invalid";
  if (/api key not valid|invalid api key|unauthorized|permission denied|api_key_invalid/i.test(text)) {
    return "invalid";
  }
  if (status === 429) return "quota";
  if (/quota|rate.?limit|resource_exhausted|too many requests|insufficient|billing/i.test(text)) {
    return "quota";
  }
  if (status === 500 || status === 502 || status === 503 || status === 504) return "busy";
  if (/overloaded|high demand|unavailable|internal error|deadline|timeout|abort|fetch failed|socket/i.test(text)) {
    return "busy";
  }
  return "network";
}

/** استخراج مقدار `retry-after` از هدر یا بدنهٔ خطا (ثانیه → میلی‌ثانیه). */
export function parseRetryAfterMs(headerValue: string | null | undefined, message?: string): number | undefined {
  if (headerValue) {
    const seconds = Number(headerValue);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 60 * 60_000);
  }
  const match = /try again in ([\d.]+)\s*(s|seconds|m|minutes)/i.exec(String(message || ""));
  if (match) {
    const amount = Number(match[1]);
    if (Number.isFinite(amount)) {
      const multiplier = /^m/i.test(match[2]) ? 60_000 : 1000;
      return Math.min(amount * multiplier, 60 * 60_000);
    }
  }
  return undefined;
}
