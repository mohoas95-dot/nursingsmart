# گزارش مهاجرت هوش مصنوعی به Gemini Direct — NursePlan 2026

تاریخ: 2026-07-31
شاخه: arena/019fb8dc-nursingsmart

## خلاصه تغییرات درخواستی کارفرما

### 1. حذف کامل هوش‌های قبلی متصل به چت‌باکس
- **حذف شد**: Groq (`groq.ts`), OpenRouter/Bluesminds (`openrouter.ts`), DeepSeek (`deepseek-chat`), GPT-4o-mini / GPT-4o, سیستم اعتبار ۱۰۰ دلاری (`credit.ts`)
- **حذف از UI**:
  - `AiEngineBadge` که DeepSeek + GPT-4o-mini نشان می‌داد → بازنویسی شده به نشان ساده Gemini 2.5 Flash / fallback 3.5 Flash
  - متن‌های قدیمی در `app/page.tsx`:
    - `متن‌ها با Groq و تصویرها با Gemini تحلیل می‌شوند.` → حذف، جایگزین: `پیام‌های متنی و تصویری با هوش مصنوعی تحلیل می‌شوند.`
    - `دارم با Groq دقیق بررسی می‌کنم...` → `در حال بررسی دقیق درخواست...`
    - `در حال خواندن متن داخل تصویر با Gemini 2.5 Flash...` → `در حال خواندن متن داخل تصویر...`
    - `title="پیوست تصویر (تحلیل متن فارسی داخل عکس با Gemini 2.5 Flash)"` → `پیوست تصویر برای تحلیل`
  - کامنت قدیمی `ارسال به موتور بینایی (Gemini 2.5 Flash). چرخش بین ۳ کلید Gemini` → `ارسال به موتور بینایی Gemini. چرخش بین ۵ کلید Gemini`

### 2. استقرار Gemini 2.5 Flash با فال‌بک Gemini 3.5 Flash
- **فایل جدید اصلی**: `lib/ai/gemini.ts`
  - `GEMINI_PRIMARY_MODEL = gemini-1.5-flash` (پیش‌فرض, قابل override با `GEMINI_PRIMARY_MODEL`)
  - `GEMINI_FALLBACK_MODEL = gemini-1.5-flash` (موجود در کاتالوگ گوگل از May 2026)
  - تابع `getGeminiModelChain()` → `['gemini-1.5-flash', 'gemini-1.5-flash']`
  - هر دو قابلیت متنی و تصویری با همین دو مدل انجام می‌شود (Gemini multimodal)

- **معماری درخواست**: 
  - Endpoint: `https://generativelanguage.googleapis.com/v1/models/{model}:generateContent` — احراز هویت با هدر استاندارد گوگل: `x-goog-api-key: <KEY>` برای تمامی کلیدهای API (چه کلیدهای کلاسیک `AIzaSy...` و چه کلیدهای جدید `AQ....`). (ارسال کلیدهای API در هدر `Authorization: Bearer` ممنوع است زیرا موجب خطای 401 Expected OAuth 2 access token می‌شود).
  - `systemInstruction` + `contents` + `generationConfig: { responseMimeType: 'application/json' }`
  - Vision: `inlineData: { mimeType, data: base64 }`

### 3. منطق سوئیچ به fallback — ممنوعیت سوئیچ سریع
**فقط در این شرایط سیستم از 2.5 به 3.5 سوئیچ می‌کند:**
- زمان تحلیل بسیار طولانی (`abort` / timeout > PER_CALL_TIMEOUT)
- مفاهیم استخراج‌شده نامفهوم (`extractJsonObject` = null → `sawUnclear`)
- سرور شلوغ (`503`, `overloaded`, `high demand` → `sawBusy`)
- مشکلات جدی (404 model not found, 500, ...)

**قانون طلایی:** ابتدا هر ۵ کلید روی مدل اصلی `gemini-1.5-flash` امتحان می‌شود. اگر هیچ‌کدام موفق نشد و حداقل یکی از شرایط بالا رخ داده بود، آنگاه هر ۵ کلید روی `gemini-1.5-flash` امتحان می‌شود. سوئیچ سریع بدون امتحان کلیدها ممنوع.

کد در `generateGeminiJson` و `generateGeminiVision`:
```ts
// فاز اول: فقط primary
for key in pool.order() try primary
if !success and (sawBusy||sawTimeout||sawUnclear) → فاز fallback
```

### 4. پایداری با ۵ API Key
- **استخر جدید**: `geminiKeyPool` در `lib/ai/gemini.ts`
- envNames:
  ```
  GEMINI_API_KEY
  GEMINI_API_KEY_2
  GEMINI_API_KEY_3
  GEMINI_API_KEY_4
  GEMINI_API_KEY_5
  GEMINI_API_KEYS (comma separated)
  GOOGLE_API_KEY ... (سازگاری)
  ```
- `ApiKeyPool` همان کلاس قبلی است ولی حالا ۵ کلید را پشتیبانی می‌کند، تکراری‌ها حذف، round-robin.

### 5. برخورد به سقف روزانه → سوئیچ بی‌معطلی به کلید بعدی
- در `key-pool.ts`: `reportFailure` با نوع `quota` → quarantine کوتاه (۳۰ ثانیه پیش‌فرض + احترام به `retry-after`)
- `order()` اول کلیدهای سالم را می‌دهد (round-robin)، سپس کلیدهای در قرنطینه به عنوان آخرین راه‌چاره.
- در `gemini.ts` پس از هر failure: `reportFailure` و بلافاصله `continue` به کلید بعدی بدون `sleep` طولانی (فقط برای busy حداکثر ۴۰۰ms).

### 6. اتمام اعتبار همه کلیدها → نمایش مدت انتظار در چت‌باکس
- اگر `availableCount() === 0` و `sawQuota`:
  - `nextAvailableInMs()` → کوتاه‌ترین زمان باقی‌مانده تا آزاد شدن کلید
  - `buildQuotaMessage(provider, waitMs)` → پیام فارسی با ثانیه/دقیقه
    - مثلا: `سرویس Gemini همین الان ظرفیت خالی ندارد. حدود ۱۲ ثانیه دیگر دوباره بفرست 🙂`
  - `QuotaExhaustedError` شامل `retryAfterMs` است
  - در `app/api/ai/*` این مقدار در JSON به کلاینت برمی‌گردد: `{ error, retryAfterMs }`
  - در چت‌باکس (`app/page.tsx`) به صورت حباب assistant نمایش داده می‌شود، کاربر می‌تواند با دکمه «تلاش مجدد» دوباره بفرستد.

### 7. حذف لاگ اعتبار ۱۰۰ دلاری در صفحه گزارشات
- `features/shared/components/AiCreditPanel.tsx` → کاملاً stub شده، `return null`
- `features/reports/components/EventLogPanel.tsx` → حذف import `AiCreditPanel`, حذف props `showCreditPanel`, `creditData`, `onCreditRecharged`, حذف UI مربوط به Credit
- `app/api/ai/credit/route.ts` → پاسخ `410 Deprecated` با پیام `سیستم اعتبار ۱۰۰ دلاری حذف شده`
- `lib/ai/credit.ts` → stub خالی (INITIAL_CREDIT = 0, MAX_LOGS =0, همه توابع ۰ برمی‌گردانند)
- `app/page.tsx`:
  - state `aiCreditBanner` و `useEffect fetchCreditForBanner` حذف شد
  - بنر `{aiCreditBanner && (...)}` حذف شد
  - `<EventLogPanel showCreditPanel={true} ... setAiCreditBanner>` → `<EventLogPanel events={...} monthLabel={...} />`

### 8. فایل‌های سیستمی — چه چیزی را در Vercel حذف/اضافه کنید

#### در Vercel Dashboard → Project Settings → Environment Variables:

**حذف کنید (Delete):**
```
OPENROUTER_API_KEY
OPENROUTER_API_KEY_2
OPENROUTER_API_KEY_3
OPENROUTER_API_KEYS
OPENROUTER_BASE_URL
OPENROUTER_TEXT_MODEL
OPENROUTER_TEXT_FALLBACK_MODEL
OPENROUTER_VISION_MODEL
OPENROUTER_VISION_FALLBACK_MODEL
OPENROUTER_HTTP_REFERER
OPENROUTER_APP_TITLE
OPENROUTER_CALL_TIMEOUT_MS
OPENROUTER_TOTAL_BUDGET_MS
OPENROUTER_MAX_CALLS_PER_REQUEST
OPENROUTER_MAX_OUTPUT_TOKENS
OPENROUTER_TEMPERATURE
GROQ_API_KEY
GROQ_API_KEY_2
GROQ_API_KEY_3
GROQ_API_KEYS
GROQ_MODEL
GEMINI_VISION_MODEL (قدیمی)
AI_INITIAL_CREDIT_USD
AI_CREDIT_WARNING_THRESHOLD
AI_CREDIT_CRITICAL_THRESHOLD
PRICING_DEEPSEEK_INPUT
PRICING_DEEPSEEK_OUTPUT
PRICING_GPT4O_MINI_INPUT
PRICING_GPT4O_MINI_OUTPUT
PRICING_GPT4O_INPUT
PRICING_GPT4O_OUTPUT
AI_KEY_QUOTA_COOLDOWN_MS (اختیاری — اگر می‌خواهید پیش‌فرض جدید بماند حذف کنید، در غیر این صورت می‌تواند بماند)
... هر متغیری که با PRICING_ یا OPENROUTER_ یا GROQ_ شروع می‌شود
```

**اضافه کنید (Add) — حداقل ۱، توصیه ۵:**
```
GEMINI_API_KEY=AIzaSy... (کلید اول)
GEMINI_API_KEY_2=AIzaSy... (کلید دوم)
GEMINI_API_KEY_3=AIzaSy...
GEMINI_API_KEY_4=AIzaSy...
GEMINI_API_KEY_5=AIzaSy...

# یا اگر ترجیح می‌دهید در یک متغیر:
GEMINI_API_KEYS=AIzaSy...1,AIzaSy...2,AIzaSy...3,AIzaSy...4,AIzaSy...5

# مدل‌ها — اختیاری، پیش‌فرض‌ها درست هستند:
GEMINI_PRIMARY_MODEL=gemini-1.5-flash
GEMINI_FALLBACK_MODEL=gemini-1.5-flash

# تنظیمات اختیاری تایم‌اوت (اختیاری):
GEMINI_CALL_TIMEOUT_MS=28000
GEMINI_TOTAL_BUDGET_MS=55000
GEMINI_MAX_CALLS_PER_REQUEST=12
GEMINI_MAX_OUTPUT_TOKENS=2500
GEMINI_TEMPERATURE=0.4
```

**نکات مهم Vercel:**
- `DATABASE_URL`، `AUTH_*` و سایر متغیرهای غیر-AI را دست نزنید — باقی بمانند.
- پس از افزودن کلیدهای جدید Gemini، حتماً **Redeploy** کنید (Vercel → Deployments → Redeploy) تا `geminiKeyPool` کلیدهای جدید را بخواند.
- سلامت سیستم را از `GET /api/ai/health` چک کنید:
  - باید `configured: 5`, `availableNow: 5`, `primaryModel: gemini-1.5-flash`, `fallbackModel: gemini-1.5-flash` باشد.
  - اگر `configured: 0` دیدید، یعنی هیچ کلید GEMINI_* تنظیم نشده.
- مسیر `/api/ai/credit` حالا `410` برمی‌گرداند — طبیعی است، چون حذف شده. اگر مانیتورینگ دارید که به آن ping می‌زند، آن چک را حذف کنید.
- فایل `lib/ai/credit.ts` و `AiCreditPanel` همچنان وجود دارند ولی stub هستند تا build نشکند؛ نیازی به حذف فیزیکی از Vercel نیست.

#### فایل‌های کد که تغییر کردند (برای Code Review):
- **جدید / بازنویسی اساسی**:
  - `lib/ai/gemini.ts` (جدید — هسته اصلی)
  - `lib/ai/index.ts` (فقط Gemini export)
  - `lib/ai/groq.ts`, `lib/ai/openrouter.ts`, `lib/ai/gemini-vision.ts`, `lib/ai/credit.ts` (همگی stub به Gemini)
  - `app/api/ai/chat-requests/route.ts`, `parse-text-request`, `parse-image-request`, `health`, `credit`
  - `features/shared/components/AiEngineBadge.tsx` (ساده شده به Gemini)
  - `features/shared/components/AiCreditPanel.tsx` (حذف کامل UI)
  - `features/reports/components/EventLogPanel.tsx` (حذف اعتبار)
  - `app/page.tsx` (حذف بنر اعتبار, حذف متن Groq, تغییر کامنت‌ها)
  - `.env.example` (به‌روزرسانی به ۵ کلید Gemini)
  - `tests/ai-model-policy.test.ts`, `tests/ai-credit-system.test.ts` (به‌روزرسانی به معماری جدید)

#### فایل‌های سیستمی که **نیازی نیست** در Vercel تغییر دهید:
- `next.config.ts` — بدون تغییر (standalone output باقی)
- `firebase.json`, `firestore.rules` — بدون تغییر
- `prisma/schema.prisma` — بدون تغییر
- `public/*` — بدون تغییر

#### چک‌لیست نهایی Deploy:
1. در Vercel متغیرهای قدیمی OPENROUTER/GROQ/PRICING را حذف کن
2. ۵ کلید GEMINI_API_KEY_* را اضافه کن
3. Redeploy بزن
4. `/api/ai/health` را باز کن — باید ۵ کلید سالم نشان دهد
5. یک پیام متنی در چت‌باکس بفرست — باید با gemini-1.5-flash پاسخ دهد
6. یک عکس دست‌نوشته فارسی بفرست — باید با همان مدل تحلیل شود
7. برای تست quota: یک کلید را عمداً خراب وارد کن، پیام بفرست — باید بی‌درنگ به کلید بعدی برود و کاربر خطای quota نبیند
8. برای تست اتمام همه کلیدها: همه کلیدها را موقتاً به سقف بزن (یا کلید نامعتبر بگذار) — باید در چت‌باکس پیام `حدود X ثانیه دیگر` نشان داده شود

---
**نویسنده**: Agent Arena — تغییرات عمده AI
