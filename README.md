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
2. Set the AI keys in [.env.local](.env.local): `GROQ_API_KEY` (text chat) and `GEMINI_API_KEY` (image OCR). Add `_2`/`_3` variants for automatic quota failover — see [هوش مصنوعی چت‌باکس](#هوش-مصنوعی-چتباکس--معماری-دو-موتوره-groq--gemini).
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

## هوش مصنوعی چت‌باکس — معماری دو موتوره (Groq + Gemini)

چت‌باکس از **دو سرویس هوش مصنوعی کاملاً مستقل** استفاده می‌کند تا محدودیت‌های
سهمیهٔ رایگان هرگز باعث از کار افتادن آن نشود:

| ورودی کاربر | سرویس | مدل پیش‌فرض | مسیر API | کلیدها |
|---|---|---|---|---|
| پیام **متنی** | Groq | `openai/gpt-oss-120b` | `POST /api/ai/chat-requests` | `GROQ_API_KEY`, `GROQ_API_KEY_2`, `GROQ_API_KEY_3` |
| **تصویر** (OCR فارسی) | Google Gemini | `gemini-2.5-flash` | `POST /api/ai/parse-image-request` | `GEMINI_API_KEY`, `GEMINI_API_KEY_2`, `GEMINI_API_KEY_3` |

> **چرا GPT-OSS 120B و نه Llama؟** سه دلیل: لحن فارسی به‌مراتب گرم‌تر و طبیعی‌تر،
> سرعت تقریباً دو برابر (~۵۰۰ در برابر ~۲۸۰ توکن بر ثانیه)، و مهم‌تر از همه
> **بقا** — Groq اعلام کرده `llama-3.3-70b-versatile` و `llama-3.1-8b-instant`
> در تاریخ **۲۰۲۶/۰۸/۱۶** خاموش می‌شوند و جانشین رسمی‌شان همین GPT-OSS است.
> تست `tests/ai-model-policy.test.ts` نگهبان این موضوع است و اگر کسی مدل
> منسوخ‌شده‌ای را برگرداند، بیلد را قرمز می‌کند.

### جداسازی کامل دو موتور

- Groq **فقط** متن را می‌بیند؛ هیچ تصویری به آن ارسال نمی‌شود.
- Gemini **فقط** تصویر را می‌بیند؛ هیچ پیام متنی خالی به آن ارسال نمی‌شود.
- هر سرویس استخر کلید، شمارندهٔ سهمیه و cooldown مستقل خودش را دارد
  (`lib/ai/key-pool.ts`). تمام‌شدن کریدیت یکی هیچ اثری روی دیگری ندارد.

### چرخش خودکار کلید (Failover)

برای هر سرویس تا سه کلید رایگان تعریف می‌شود. رفتار سیستم:

1. درخواست با **کلید ۱** ارسال می‌شود.
2. اگر پاسخ `429`/`quota`/`rate limit` بود، کلید ۱ برای مدتی قرنطینه می‌شود و
   همان درخواست بی‌درنگ با **کلید ۲** تکرار می‌شود؛ سپس **کلید ۳**.
3. اگر هر سه کلید روی مدل اصلی به سقف خوردند، سیستم به **مدل جایگزین** سبک‌تر
   با سهمیهٔ بالاتر سوییچ می‌کند و دوباره هر سه کلید را امتحان می‌کند.
4. فقط اگر همهٔ ترکیب‌ها شکست بخورند، یک پیام فارسی قابل‌فهم با کد ۴۲۹ به
   کاربر برمی‌گردد (نه خطای ۵۰۰ و نه چت قفل‌شده).

مدت قرنطینه بر اساس نوع خطا فرق می‌کند: سهمیه ۱۰ دقیقه، کلید باطل ۶ ساعت،
شلوغی موقت ۲۰ ثانیه. کلید قرنطینه‌شده به‌عنوان «آخرین شانس» در انتهای صف
باقی می‌ماند تا یک قرنطینهٔ اشتباه هرگز سرویس را از کار نیندازد.

### ⚠️ مهم: چند کلید همیشه یعنی چند برابر سهمیه نیست

سقف مصرف در **سطح حساب/پروژه** اعمال می‌شود، نه در سطح کلید:

| سرویس | سهمیه بر اساس | یعنی |
|---|---|---|
| Groq | سازمان/حساب | سه کلید از **یک حساب** = یک سهمیه |
| Gemini | پروژهٔ Google Cloud | سه کلید از **یک پروژه** = یک سهمیه |

برای اینکه سه کلید واقعاً سه برابر ظرفیت بدهند، هر کلید باید از یک
**حساب Groq جدا** و یک **پروژهٔ Google Cloud جدا** ساخته شده باشد. اگر همه از
یک حساب باشند، چرخش کلید فقط در برابر خطای موقت کمک می‌کند، نه کمبود سهمیه.

### مصرف توکن — چرا مهم است

سقف رایگان عمدتاً **توکن در دقیقه** است، نه تعداد درخواست
(`openai/gpt-oss-120b`: فقط ۸٬۰۰۰ TPM). بنابراین سیستم عمداً کم‌مصرف طراحی شده:

- زمینه به‌صورت فشرده ارسال می‌شود، نه JSON خام (`lib/ai/compact-context.ts`).
  تقویم یک ماه به‌جای ۲٬۱۲۴ کاراکتر، در ۱۱۸ کاراکتر جا می‌شود (۹۴٪ کمتر).
- `max_completion_tokens` روی ۱٬۵۰۰ است نه ۴٬۰۹۶ — چون Groq این مقدار را
  **رزرو** می‌کند حتی اگر مدل آن‌قدر تولید نکند.
- سقف سخت **۴ فراخوانی** برای هر پیام کاربر (`GROQ_MAX_CALLS_PER_REQUEST`).
- کلاینت روی خطای ۴۲۹ **تلاش مجدد نمی‌کند** — این کار فقط سهمیه را زودتر
  می‌سوزاند. کاربر دکمهٔ «تلاش مجدد» دارد.

مجموع این‌ها مصرف بدترین‌حالت هر پیام را از ~۲۵۱٬۰۰۰ توکن به ~۱۴٬۰۰۰ توکن
رساند (۹۴٪ کاهش).

### بررسی سلامت کلیدها

```
GET /api/ai/health
```

تعداد کلیدهای تنظیم‌شده، کلیدهای سالم در همین لحظه، مدل فعال و زمان باقی‌ماندهٔ
قرنطینه را برمی‌گرداند. **هیچ‌گاه مقدار کلیدها را نشان نمی‌دهد** — فقط چهار رقم
آخر به‌صورت ماسک‌شده.

### متغیرهای محیطی

کلیدها **فقط** در متغیرهای محیطی (Vercel → Settings → Environment Variables)
تعریف می‌شوند؛ هیچ کلیدی نباید داخل فایل‌های سورس نوشته شود.

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `GROQ_API_KEY` / `_2` / `_3` | — | سه کلید رایگان Groq (متن) |
| `GEMINI_API_KEY` / `_2` / `_3` | — | سه کلید رایگان Gemini (تصویر) |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | مدل متنی اصلی |
| `GROQ_FALLBACK_MODELS` | `openai/gpt-oss-20b,qwen/qwen3.6-27b` | زنجیرهٔ جایگزین متن (با کاما) |
| `GROQ_TEMPERATURE` | `0.6` | دما؛ پایین‌تر = خشک‌تر، بالاتر = خلاق‌تر |
| `GROQ_REASONING_EFFORT` | `low` | عمق تفکر مدل: `low`/`medium`/`high` |
| `GROQ_CALL_TIMEOUT_MS` | `20000` | تایم‌اوت هر فراخوانی Groq |
| `GROQ_TOTAL_BUDGET_MS` | `42000` | سقف کل زمان متن (کمتر از `maxDuration=60`) |
| `GEMINI_VISION_MODEL` | `gemini-2.5-flash` | مدل بینایی اصلی |
| `GEMINI_VISION_FALLBACK_MODELS` | `gemini-2.5-flash-lite,gemini-2.0-flash` | زنجیرهٔ جایگزین تصویر |
| `GEMINI_CALL_TIMEOUT_MS` | `24000` | تایم‌اوت هر فراخوانی Gemini |
| `GEMINI_TOTAL_BUDGET_MS` | `48000` | سقف کل زمان تصویر |
| `AI_KEY_QUOTA_COOLDOWN_MS` | `600000` | مدت قرنطینهٔ کلیدی که به سقف خورده |
| `AI_KEY_INVALID_COOLDOWN_MS` | `21600000` | مدت قرنطینهٔ کلید باطل |
| `AI_KEY_BUSY_COOLDOWN_MS` | `20000` | مدت قرنطینه هنگام شلوغی موقت سرویس |

می‌توانید به‌جای سه متغیر جدا، هر سه کلید را با کاما در یک متغیر بگذارید:
`GROQ_API_KEYS="k1,k2,k3"` و `GEMINI_API_KEYS="k1,k2,k3"`.
