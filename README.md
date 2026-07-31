<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/14c85672-779a-484a-b7a3-7efb62cb4fb0

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the AI token in [.env.local](.env.local): `PUTER_AUTH_TOKEN` (used for both text chat and image OCR). Add `_2`/`_3` variants (tokens from other Puter accounts) for automatic quota failover — see [هوش مصنوعی چت‌باکس](#هوش-مصنوعی-چتباکس--موتور-puterjs).
3. Copy `.env.example` to `.env.local`, configure PostgreSQL, and initialize authentication:
   `npm run db:generate && npm run db:migrate && npm run db:seed`
4. Configure the environment-specific S3 variables described in [`docs/STORAGE_ARCHITECTURE.md`](docs/STORAGE_ARCHITECTURE.md).
5. Run the S3 conditional-write compatibility test:
   `npm run storage:test-conditional`
6. Run the app:
   `npm run dev`

## Storage architecture

The granular object layout, optimistic-locking contract, circuit breaker, and one-time migration procedure are documented in [`docs/STORAGE_ARCHITECTURE.md`](docs/STORAGE_ARCHITECTURE.md).

## Authentication

PostgreSQL/Prisma setup, national-ID login, session security, first-login password change, and the head-nurse password-reset workflow are documented in [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md).

## هوش مصنوعی چت‌باکس — موتور Puter.js

چت‌باکس یک **موتور واحد** دارد: [Puter.js](https://docs.puter.com/) — از طریق
endpoint سازگار با OpenAI که Puter.com ارائه می‌دهد. هم پیام‌های متنی و هم
تصاویر (OCR فارسی دست‌نوشته) از همین سرویس عبور می‌کنند:

| ورودی کاربر | سرویس | مدل پیش‌فرض | مسیر API | توکن‌ها |
|---|---|---|---|---|
| پیام **متنی** | Puter.js | `gpt-5.4-nano` | `POST /api/ai/chat-requests` | `PUTER_AUTH_TOKEN`, `PUTER_AUTH_TOKEN_2`, `PUTER_AUTH_TOKEN_3` |
| **تصویر** (OCR فارسی) | Puter.js | `gpt-5.4-nano` (vision) | `POST /api/ai/parse-image-request` | همان توکن‌های بالا |

> **چرا Puter.js؟** Puter از مدل «User-Pays» استفاده می‌کند: مصرف هر توکن از
> سهمیهٔ رایگان ماهانهٔ همان حساب Puter کم می‌شود، که به‌مراتب سخاوتمندانه‌تر
> از سقف روزانهٔ کلیدهای رایگان سرویس‌های دیگر است. یک endpoint واحد و سازگار
> با OpenAI هم متن و هم بینایی را پشتیبانی می‌کند، پس دیگر لازم نیست دو سرویس
> کاملاً جدا (با دو نوع کلید و دو محدودیت متفاوت) نگه داشته شوند.

### نحوهٔ گرفتن توکن

۱. وارد [puter.com/dashboard#account](https://puter.com/dashboard#account) شوید
   (یا یک حساب رایگان بسازید).
۲. در بخش **API token** روی **Create token** بزنید و مقدار را کپی کنید.
۳. آن را در `PUTER_AUTH_TOKEN` بگذارید. برای چند برابر کردن سهمیه، از حساب‌های
   دیگر Puter توکن بگیرید و در `PUTER_AUTH_TOKEN_2` / `PUTER_AUTH_TOKEN_3`
   قرار دهید.

### چرخش خودکار توکن (Failover)

می‌توانید تا سه توکن (از حساب‌های مختلف Puter) تعریف کنید. رفتار سیستم:

1. درخواست با **توکن ۱** ارسال می‌شود.
2. اگر پاسخ `429`/`quota`/`rate limit` بود، توکن ۱ برای مدتی قرنطینه می‌شود و
   همان درخواست بی‌درنگ با **توکن ۲** تکرار می‌شود؛ سپس **توکن ۳**.
3. اگر هر سه توکن روی مدل اصلی به سقف خوردند، سیستم به **مدل جایگزین** سبک‌تر
   سوییچ می‌کند و دوباره هر سه توکن را امتحان می‌کند.
4. فقط اگر همهٔ ترکیب‌ها شکست بخورند، یک پیام فارسی قابل‌فهم با کد ۴۲۹ به
   کاربر برمی‌گردد (نه خطای ۵۰۰ و نه چت قفل‌شده).

### ⚠️ مهم: چند توکن همیشه یعنی چند برابر سهمیه نیست

سقف مصرف رایگان Puter در **سطح حساب کاربری** اعمال می‌شود، نه در سطح توکن. برای
اینکه سه توکن واقعاً سه برابر ظرفیت بدهند، هر توکن باید از یک **حساب Puter
جداگانه** ساخته شده باشد. اگر همه از یک حساب باشند، چرخش توکن فقط در برابر
خطای موقت شبکه/سرویس کمک می‌کند، نه کمبود سهمیه.

### مصرف توکن — چرا مهم است

- زمینه به‌صورت فشرده ارسال می‌شود، نه JSON خام (`lib/ai/compact-context.ts`).
  تقویم یک ماه به‌جای ۲٬۱۲۴ کاراکتر، در ۱۱۸ کاراکتر جا می‌شود (۹۴٪ کمتر).
- `max_tokens` روی ۱٬۵۰۰ نگه داشته شده تا سقف رایگان زودتر از حد پر نشود.
- سقف سخت **۴ فراخوانی** برای هر پیام کاربر (`PUTER_MAX_CALLS_PER_REQUEST`).
- کلاینت روی خطای ۴۲۹ **تلاش مجدد نمی‌کند** — این کار فقط سهمیه را زودتر
  می‌سوزاند. کاربر دکمهٔ «تلاش مجدد» دارد.

### بررسی سلامت توکن‌ها

```
GET /api/ai/health
```

تعداد توکن‌های تنظیم‌شده، توکن‌های سالم در همین لحظه، مدل فعال و زمان
باقی‌ماندهٔ قرنطینه را برمی‌گرداند. **هیچ‌گاه مقدار توکن‌ها را نشان نمی‌دهد** —
فقط چهار رقم آخر به‌صورت ماسک‌شده.

### متغیرهای محیطی

توکن‌ها **فقط** در متغیرهای محیطی (Vercel → Settings → Environment Variables)
تعریف می‌شوند؛ هیچ توکنی نباید داخل فایل‌های سورس نوشته شود.

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `PUTER_AUTH_TOKEN` / `_2` / `_3` | — | تا سه توکن Puter (از حساب‌های جداگانه) |
| `PUTER_MODEL` | `gpt-5.4-nano` | مدل متنی اصلی |
| `PUTER_FALLBACK_MODELS` | `gpt-5.3-chat,google/gemini-3.5-flash-lite` | زنجیرهٔ جایگزین متن (با کاما) |
| `PUTER_VISION_MODEL` | `gpt-5.4-nano` | مدل بینایی اصلی |
| `PUTER_VISION_FALLBACK_MODELS` | `google/gemini-3.5-flash-lite,gpt-5.3-chat` | زنجیرهٔ جایگزین تصویر |
| `PUTER_TEMPERATURE` | `0.6` | دما؛ پایین‌تر = خشک‌تر، بالاتر = خلاق‌تر |
| `PUTER_CALL_TIMEOUT_MS` | `22000` | تایم‌اوت هر فراخوانی |
| `PUTER_TOTAL_BUDGET_MS` | `45000` | سقف کل زمان (کمتر از `maxDuration=60`) |
| `PUTER_MAX_OUTPUT_TOKENS` | `1500` | حداکثر توکن خروجی |
| `PUTER_MAX_CALLS_PER_REQUEST` | `4` | سقف فراخوانی برای هر پیام کاربر |
| `AI_KEY_QUOTA_COOLDOWN_MS` | `30000` | قرنطینه پس از سقف دقیقه‌ای |
| `AI_KEY_DAILY_QUOTA_COOLDOWN_MS` | `1800000` | قرنطینه پس از سقف روزانه |
| `AI_KEY_INVALID_COOLDOWN_MS` | `21600000` | مدت قرنطینهٔ توکن باطل |
| `AI_KEY_BUSY_COOLDOWN_MS` | `20000` | مدت قرنطینه هنگام شلوغی موقت سرویس |

می‌توانید به‌جای سه متغیر جدا، هر سه توکن را با کاما در یک متغیر بگذارید:
`PUTER_AUTH_TOKENS="t1,t2,t3"`.
