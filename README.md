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
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
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

## پایداری دستیار هوشمند Gemini (تنظیمات محیطی)

چت عمومی Gemini و Gemini API دقیقاً یک سطح سرویس نیستند: اپلیکیشن Gemini می‌تواند پشت‌صحنه بین مدل‌ها و ظرفیت‌های داخلی Google جابه‌جا شود، اما این پروژه با API key شما یک مدل مشخص را صدا می‌زند و به سهمیه/محدودیت همان پروژه وابسته است. برای کاهش خطاهای «شلوغی»، «تایم‌اوت» و افت کیفیت OCR، زنجیرهٔ مدل‌های پیش‌فرض به مدل‌های پایدار API تغییر کرده و مسیر تصویر از مسیر متن جدا شده است.

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `GEMINI_MODEL` | `gemini-2.5-flash` | مدل اصلی چت متنی |
| `GEMINI_FALLBACK_MODELS` | `gemini-2.0-flash,gemini-2.5-flash-lite,gemini-2.0-flash-lite` | زنجیرهٔ جایگزین متن (با کاما) |
| `GEMINI_VISION_MODEL` | `gemini-2.5-flash` | مدل اصلی OCR/تصویر دست‌نوشته |
| `GEMINI_VISION_FALLBACK_MODELS` | `gemini-2.0-flash,gemini-2.5-flash-lite` | زنجیرهٔ جایگزین تصویر |
| `GEMINI_ATTEMPTS_PER_MODEL` | `2` | تعداد تلاش برای هر مدل متنی |
| `GEMINI_CALL_TIMEOUT_MS` | `16000` | تایم‌اوت هر فراخوانی مدل متنی |
| `GEMINI_TOTAL_BUDGET_MS` | `34000` | سقف کل زمان چت متنی |
| `GEMINI_VISION_CALL_TIMEOUT_MS` | `24000` | تایم‌اوت هر فراخوانی OCR |
| `GEMINI_VISION_TOTAL_BUDGET_MS` | `52000` | سقف کل زمان OCR، کمتر از `maxDuration=60` |
| `GEMINI_THINKING_LEVEL` | `off` | فقط اگر مدل انتخابی دقیقاً پشتیبانی می‌کند، `low`/`medium`/`high` بگذارید |

برای نزدیک‌ترین تجربه به Gemini، در Google AI Studio/Cloud از یک API key با Billing و quota کافی استفاده کنید و در صورت دسترسی می‌توانید مدل قوی‌تر را در Vercel تنظیم کنید، مثلاً:
`GEMINI_MODEL=gemini-2.5-pro` و `GEMINI_VISION_MODEL=gemini-2.5-pro`.
