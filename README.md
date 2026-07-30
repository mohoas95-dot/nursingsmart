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

مدل‌های تازه‌منتشرشده «flash» بیشترین خطای ۵۰۳ (شلوغی/high demand) را می‌دهند.
به همین دلیل زنجیرهٔ پیش‌فرض مدل‌ها با یک مدل پایدار شروع می‌شود و به مدل‌های
سبک‌تر با سهمیهٔ بالاتر برمی‌گردد. همهٔ موارد از Vercel قابل تغییر است:

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `GEMINI_MODEL` | `gemini-3.5-flash` | مدل اصلی |
| `GEMINI_FALLBACK_MODELS` | `gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-2.5-flash` | زنجیرهٔ جایگزین (با کاما) |
| `GEMINI_ATTEMPTS_PER_MODEL` | `2` | تعداد تلاش برای هر مدل |
| `GEMINI_CALL_TIMEOUT_MS` | `14000` | تایم‌اوت هر فراخوانی مدل |
| `GEMINI_TOTAL_BUDGET_MS` | `26000` | سقف کل زمان (کمتر از `maxDuration=60`) |
| `GEMINI_THINKING_LEVEL` | `low` | `low`/`medium`/`high` یا `off` برای حذف کامل |

اگر باز هم شلوغی دیدید، سریع‌ترین راه‌حل بدون تغییر کد:
`GEMINI_MODEL=gemini-3.1-flash-lite` (پایدارترین و کم‌تأخیرترین گزینه).
