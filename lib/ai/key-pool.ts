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

export type KeyFailureKind = "quota" | "daily_quota" | "invalid" | "busy" | "network";

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

/**
 * مدت قرنطینه پس از خوردن به سقف سهمیه.
 *
 * ⚠️ درس گران‌قیمت: این مقدار قبلاً ۱۰ دقیقه بود و فاجعه ساخت.
 * سقف‌های رایگان عمدتاً **دقیقه‌ای** هستند (TPM/RPM)، نه روزانه. وقتی Groq
 * می‌گوید «۷ ثانیهٔ دیگر دوباره امتحان کن»، کنار گذاشتن کلید برای ۱۰ دقیقه
 * یعنی هر سه کلید پشت سر هم می‌سوزند و کاربر پیام «سهمیهٔ هر سه کلید تمام شد»
 * می‌گیرد، در حالی که در واقعیت فقط باید چند ثانیه صبر می‌کرد.
 *
 * حالا پیش‌فرض ۳۰ ثانیه است و مهم‌تر از آن، اگر سرویس هدر `retry-after` بدهد
 * **دقیقاً به همان مقدار** احترام گذاشته می‌شود (نه بیشتر).
 */
const QUOTA_COOLDOWN_MS = Math.max(
  1_000,
  Number(process.env.AI_KEY_QUOTA_COOLDOWN_MS) || 30_000,
);

/**
 * سقف قرنطینه برای خطای سهمیه. حتی اگر سرویس عدد بزرگی پیشنهاد دهد، بیش از این
 * کلید را کنار نمی‌گذاریم مگر آنکه واقعاً سهمیهٔ روزانه تمام شده باشد.
 */
const QUOTA_COOLDOWN_MAX_MS = Math.max(
  QUOTA_COOLDOWN_MS,
  Number(process.env.AI_KEY_QUOTA_COOLDOWN_MAX_MS) || 5 * 60_000,
);

/** قرنطینهٔ بلند فقط وقتی سرویس صریحاً از تمام‌شدن سهمیهٔ روزانه خبر دهد. */
const DAILY_QUOTA_COOLDOWN_MS = Math.max(
  60_000,
  Number(process.env.AI_KEY_DAILY_QUOTA_COOLDOWN_MS) || 30 * 60_000,
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
    case "daily_quota":
      return DAILY_QUOTA_COOLDOWN_MS;
    case "invalid":
      return INVALID_KEY_COOLDOWN_MS;
    case "busy":
    case "network":
    default:
      return BUSY_COOLDOWN_MS;
  }
}

/**
 * محاسبهٔ مدت قرنطینه.
 *
 * قاعدهٔ کلیدی: اگر سرویس گفت «X ثانیه دیگر»، **دقیقاً همان** را رعایت کن.
 * قبلاً از Math.max استفاده می‌شد که یعنی پیشنهاد ۷ ثانیه‌ای سرویس نادیده
 * گرفته می‌شد و کلید ۱۰ دقیقه می‌خوابید. حالا:
 *   - retry-after موجود  → همان مقدار (با کمی حاشیه) و محدود به سقف
 *   - retry-after نبود   → مقدار پیش‌فرض همان نوع خطا
 */
function resolveCooldown(kind: KeyFailureKind, retryAfterMs?: number): number {
  if (typeof retryAfterMs === "number" && retryAfterMs > 0) {
    // ۲۵۰ms حاشیه تا دقیقاً لبهٔ پنجرهٔ سرویس نخوریم
    const suggested = retryAfterMs + 250;
    if (kind === "quota") return Math.min(suggested, QUOTA_COOLDOWN_MAX_MS);
    if (kind === "busy" || kind === "network") return Math.min(suggested, QUOTA_COOLDOWN_MAX_MS);
    return suggested;
  }
  return cooldownFor(kind);
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
    const cooldown = resolveCooldown(kind, retryAfterMs);
    state.cooldownUntil = Date.now() + cooldown;
    state.lastFailure = kind;
    state.failures++;
    console.warn(
      `[${this.provider}] کلید ${state.label} به دلیل «${kind}» برای ${Math.round(cooldown / 1000)} ثانیه کنار گذاشته شد.`,
    );
  }

  /**
   * مجموع فراخوانی‌های موفق و ناموفق از زمان بالا آمدن این نمونه.
   * برای پاسخ به «واقعاً چند درخواست فرستادم؟» در مسیر /api/ai/health.
   */
  totals(): { successes: number; failures: number } {
    this.ensureLoaded();
    return this.keys.reduce(
      (accumulator, state) => ({
        successes: accumulator.successes + state.successes,
        failures: accumulator.failures + state.failures,
      }),
      { successes: 0, failures: 0 },
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

/**
 * تشخیص نوع خطا از روی وضعیت HTTP و متن پیام سرویس.
 *
 * تفکیک «سقف دقیقه‌ای» از «سقف روزانه» حیاتی است:
 *   - سقف دقیقه‌ای (TPM/RPM) چند ثانیه بعد آزاد می‌شود → قرنطینهٔ کوتاه
 *   - سقف روزانه (RPD/TPD) تا فردا آزاد نمی‌شود → قرنطینهٔ بلند
 * اگر هر دو را یکسان بگیریم، یک محدودیت گذرای چندثانیه‌ای باعث می‌شود
 * هر سه کلید دقایق طولانی از دسترس خارج شوند.
 */
export function classifyFailure(status: number | undefined, message: string): KeyFailureKind {
  const text = String(message || "");
  if (status === 401 || status === 403) return "invalid";
  if (/api key not valid|invalid api key|unauthorized|permission denied|api_key_invalid/i.test(text)) {
    return "invalid";
  }
  // سقف روزانه — فقط وقتی سرویس صریحاً «per day / daily» گفته باشد
  if (/per ?day|daily|RPD|TPD|requests per day|tokens per day/i.test(text)) {
    return "daily_quota";
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
  const CAP_MS = 60 * 60_000;

  if (headerValue) {
    // معمولاً ثانیهٔ ساده («2») است، اما گاهی پسوند دارد («7.66s»)
    const numeric = Number(String(headerValue).replace(/[^\d.]/g, ""));
    if (Number.isFinite(numeric) && numeric > 0) return Math.min(numeric * 1000, CAP_MS);
  }

  const text = String(message || "");

  // «Please try again in 7.66s» / «try again in 2 minutes»
  const tryAgain = /try again in\s*([\d.]+)\s*(ms|s|sec|seconds|m|min|minutes|h|hours)?/i.exec(text);
  if (tryAgain) {
    const amount = Number(tryAgain[1]);
    if (Number.isFinite(amount) && amount > 0) {
      const unit = (tryAgain[2] || "s").toLowerCase();
      const multiplier = unit.startsWith("h")
        ? 3_600_000
        : unit.startsWith("m") && unit !== "ms"
          ? 60_000
          : unit === "ms"
            ? 1
            : 1000;
      return Math.min(amount * multiplier, CAP_MS);
    }
  }

  // Gemini: «retryDelay":"13s"» داخل بدنهٔ خطا
  const retryDelay = /"?retry_?delay"?\s*[:=]\s*"?([\d.]+)\s*(ms|s|m)?"?/i.exec(text);
  if (retryDelay) {
    const amount = Number(retryDelay[1]);
    if (Number.isFinite(amount) && amount > 0) {
      const unit = (retryDelay[2] || "s").toLowerCase();
      const multiplier = unit === "ms" ? 1 : unit === "m" ? 60_000 : 1000;
      return Math.min(amount * multiplier, CAP_MS);
    }
  }

  return undefined;
}
