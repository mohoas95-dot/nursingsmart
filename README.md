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
2. Copy `.env.example` to `.env.local` and set `DEEPSEEK_API_KEY_1` (text chat) and `GEMINI_API_KEY_1` (handwriting OCR) — see [پایداری دستیار هوشمند](#پایداری-دستیار-هوشمند-deepseek--gemini-تنظیمات-محیطی) below for the full multi-key setup.
3. Configure PostgreSQL and initialize authentication:
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

## پایداری دستیار هوشمند: DeepSeek + Gemini (تنظیمات محیطی)

سیستم چت هوشمند از یک معماری **ترکیبی (Hybrid)** استفاده می‌کند:

- **چت متنی و استخراج درخواست‌های شیفت** (`/api/deepseek/chat-requests`،
  `/api/deepseek/parse-requests`) → **DeepSeek** (مدل `deepseek-chat`، فرمت
  OpenAI-compatible REST روی `https://api.deepseek.com/chat/completions`).
- **OCR و تحلیل تصویر دست‌نوشتهٔ فارسی** (`/api/gemini/parse-handwritten-shift`)
  → **Google Gemini** (مدل `gemini-2.5-flash`)، چون در حال حاضر بالاترین دقت
  را برای خواندن خط دست‌نویس فارسی دارد.

### Multi-Key Fallback / Round-Robin

هر دو سرویس تا **۳ کلید API** را پشتیبانی می‌کنند. برای هر درخواست، ابتدا
کلید اول امتحان می‌شود؛ اگر با خطای Rate Limit (۴۲۹)، Quota Exceeded، یا هر
خطای گذرای دیگر (۵xx، تایم‌اوت، قطعی شبکه) مواجه شود، به‌صورت خودکار و بدون
وقفه در تجربهٔ کاربر به کلید بعدی سوییچ می‌کند (کلید ۲ و در صورت نیاز کلید
۳). این منطق در `lib/apiKeyRotation.ts` پیاده‌سازی شده و توسط
`lib/deepseek.ts` (DeepSeek) و `lib/gemini.ts` (Gemini) استفاده می‌شود.

فقط وقتی **هر سه کلید** یک سرویس شکست بخورند، خطای «سرور هوش مصنوعی فعلاً
شلوغ است» به کاربر نمایش داده می‌شود.

### متغیرهای محیطی

```env
# DeepSeek Keys (Text Chat)
DEEPSEEK_API_KEY_1=your_key_here
DEEPSEEK_API_KEY_2=your_key_here
DEEPSEEK_API_KEY_3=your_key_here

# Gemini Keys (Vision & Persian Handwriting OCR)
GEMINI_API_KEY_1=your_key_here
GEMINI_API_KEY_2=your_key_here
GEMINI_API_KEY_3=your_key_here
GEMINI_MODEL=gemini-2.5-flash
```

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `DEEPSEEK_API_KEY_1/2/3` | — | کلیدهای DeepSeek برای چرخش خودکار (حداقل یکی الزامی) |
| `DEEPSEEK_MODEL` | `deepseek-chat` | مدل DeepSeek برای چت متنی |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | Base URL سازگار با OpenAI |
| `DEEPSEEK_ATTEMPTS_PER_KEY` | `1` | تعداد تلاش تایم‌اوتی روی هر کلید قبل از رفتن به کلید بعدی |
| `DEEPSEEK_CALL_TIMEOUT_MS` | `20000` | تایم‌اوت هر فراخوانی |
| `DEEPSEEK_TOTAL_BUDGET_MS` | `40000` | سقف کل زمان (کمتر از `maxDuration=60`) |
| `GEMINI_API_KEY_1/2/3` | — | کلیدهای Gemini برای چرخش خودکار (حداقل یکی الزامی) |
| `GEMINI_MODEL` | `gemini-2.5-flash` | مدل اصلی OCR/دست‌نویس |
| `GEMINI_FALLBACK_MODELS` | `gemini-2.5-flash,gemini-2.5-flash-lite,gemini-1.5-flash` | زنجیرهٔ جایگزین مدل (با کاما)، بعد از چرخش کلید امتحان می‌شود |
| `GEMINI_ATTEMPTS_PER_MODEL` | `2` | تعداد تلاش برای هر مدل |
| `GEMINI_CALL_TIMEOUT_MS` | `14000` | تایم‌اوت هر فراخوانی مدل |
| `GEMINI_TOTAL_BUDGET_MS` | `26000` | سقف کل زمان (کمتر از `maxDuration=60`) |
| `GEMINI_THINKING_LEVEL` | `low` | `low`/`medium`/`high` یا `off` برای حذف کامل |
