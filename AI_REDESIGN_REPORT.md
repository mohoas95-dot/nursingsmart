# بازطراحی معماری سرویس AI پروژه NursePlan — گزارش تکمیلی

## خلاصه اجرایی
طبق الزامات جدید، تمام سرویس‌های هوش مصنوعی از ارائه‌دهنده‌های قبلی (Groq / Gemini direct) به API اختصاصی جدید بر پایه **OpenRouter** منتقل شد. تفکیک هوشمند مدل‌ها، سیستم مدیریت اعتبار ۱۰۰ دلاری با هشدار زرد/قرمز و به‌روزرسانی UI سرپرستار پیاده‌سازی گردید.

---

## ۱. تغییر ارائه‌دهنده سرویس AI (Provider Migration)

### قبل:
- متن → Groq `openai/gpt-oss-120b` با استخر کلید `GROQ_API_KEY`
- تصویر → Gemini `gemini-2.5-flash` با استخر کلید `GEMINI_API_KEY`
- دو استخر کلید مجزا، بدون ردیابی هزینه

### بعد (جدید):
- **ارائه‌دهنده واحد**: OpenRouter `https://openrouter.ai/api/v1/chat/completions`
- **کلید**: خوانده‌شده از `.env.local` تحت متغیر `OPENROUTER_API_KEY`
  - پشتیبانی از چند کلید: `OPENROUTER_API_KEY_2`, `OPENROUTER_API_KEY_3` و یا لیست کاماجدا در `OPENROUTER_API_KEYS`
- **فایل هسته**: `lib/ai/openrouter.ts`
  - `openRouterKeyPool`: استخر کلید مشترک با قابلیت چرخش خودکار روی 429/quota/busy
  - تایم‌اوت هر فراخوانی ۲۸ ثانیه، سقف کل ۵۵ ثانیه، سقف ۴ فراخوانی هر درخواست

### فایل‌های بازنویسی‌شده:
- `lib/ai/openrouter.ts` — **جدید** — هسته کامل
- `lib/ai/groq.ts` — بازنویسی به wrapper روی OpenRouter (سازگاری)
- `lib/ai/gemini-vision.ts` — بازنویسی به wrapper روی OpenRouter
- `lib/ai/index.ts` — نقطه ورود واحد، exportهای جدید + سازگاری قدیمی

---

## ۲. تفکیک هوشمند مدل‌ها (Model Selection Strategy)

### قانون جدید:

| نوع ورودی | مدل اصلی | قیمت (input/output per 1M) | توضیح |
|---|---|---|---|
| **متن** (Text Analysis) — چت، استخراج شیفت، قوانین تقویم | `deepseek/deepseek-chat` (fallback `deepseek-v3`) | $0.27 / $1.10 | تحلیل متنی فارسی، سریع، ارزان |
| **تصویر** (Vision/OCR) — اسکرین‌شات، جدول شیفت، دست‌نویس | `openai/gpt-4o-mini` | $0.15 / $0.60 | سریع و دقیق برای OCR |
| **fallback تصویر** — در صورت شلوغی یا کم‌کیفیت | `openai/gpt-4o` | $2.50 / $10.00 | پرقدرت برای تصاویر سخت |

### پیاده‌سازی fallback برای تصویر:
- زنجیره: `[gpt-4o-mini, gpt-4o]`
- اگر `gpt-4o-mini` با busy/quota/400 یا JSON نامعتبر پاسخ دهد → سوئیچ خودکار به `gpt-4o`
- تشخیص کیفیت پایین: اگر پاسخ خالی/illegible و fallback موجود → تلاش با fallback
- لاگ: `تصویر با مدل پرقدرت‌تر تحلیل شد (fallback به gpt-4o) به دلیل شلوغی یا کیفیت پایین`

### فایل‌های مرتبط:
- `lib/ai/openrouter.ts` → `getTextModelChain()`, `getVisionModelChain()`, `generateOpenRouterJson()`, `generateOpenRouterVision()`
- `app/api/ai/chat-requests/route.ts` → متن با DeepSeek
- `app/api/ai/parse-text-request/route.ts` → متن با DeepSeek
- `app/api/ai/parse-image-request/route.ts` → تصویر با gpt-4o-mini + fallback

---

## ۳. سیستم مدیریت اعتبار ۱۰۰ دلاری و هشدار به سرپرستار

### فایل هسته: `lib/ai/credit.ts`

#### ویژگی‌ها:
- **اعتبار اولیه**: $100 (از `AI_INITIAL_CREDIT_USD` قابل تنظیم)
- **آستانه‌ها**:
  - هشدار زرد: < $15 (۱۵٪) → `warning`
  - هشدار قرمز بحرانی: < $5 → `critical`
  - تمام‌شده: <= $0 → `depleted`

#### ردیابی توکن‌ها:
- هر درخواست API پس از موفقیت `usage.prompt_tokens` و `completion_tokens` را از OpenRouter دریافت می‌کند
- محاسبه هزینه: `(input/1M * inputPrice) + (output/1M * outputPrice)`
- کسر از اعتبار باقی‌مانده و به‌روزرسانی state در حافظه + ذخیره فایل (best-effort) در `data/ai-credit.json` و `/tmp`

#### API:
- `GET /api/ai/credit` → وضعیت فعلی اعتبار با `display: "Credit: $84.50 / $100"` و `warningMessage`
- `POST /api/ai/credit` → شارژ یا ریست (برای تست)
- `GET /api/ai/health` → شامل بخش `credit` با جزئیات کامل، درصد باقی‌مانده، تفکیک بر اساس مدل، آخرین درخواست

#### لاگ:
```ts
[ai-credit] model=deepseek/deepseek-chat in=5000 out=2000 cost=$0.003550 remaining=$99.9964 status=ok
[ai-credit] ⚠️ اعتبار API به پایان خود نزدیک است (باقی‌مانده: $14.00)...
[ai-credit] 🚨 اعتبار API بحرانی است (باقی‌مانده: $4.00)...
```

### UI سرپرستار (Head Nurse Dashboard):

#### ۱. کامپوننت جدید `AiCreditPanel`:
- مسیر: `features/shared/components/AiCreditPanel.tsx`
- نمایش:
  - `Credit: $84.50 / $100` با progress bar
  - درصد باقی‌مانده
  - هشدار زرد: `"⚠️ اعتبار API به پایان خود نزدیک است (باقی‌مانده: $X). لطفاً جهت جلوگیری از قطعی سرویس نسبت به شارژ اقدام کنید."`
  - هشدار قرمز: بحرانی با پس‌زمینه قرمز و توضیح تکمیلی
  - آمار: کل درخواست‌ها، توکن ورودی/خروجی، تفکیک بر اساس مدل، آخرین درخواست

#### ۲. ادغام در `EventLogPanel`:
- مسیر: `features/reports/components/EventLogPanel.tsx`
- بازنویسی کامل با:
  - نمایش `AiCreditPanel` در بالای لاگ‌ها برای سرپرستار/مدیر
  - نشانگر اعتبار در هدر لاگ‌ها
  - فیلتر جدید `ai` برای رویدادهای هوش مصنوعی
  - `useAiCredit` hook داخلی که هر ۶۰ ثانیه به‌روزرسانی می‌کند

#### ۳. بنر هشدار全局 در `app/page.tsx`:
- برای سرپرستار/مدیر، اگر اعتبار warning/critical باشد، بنری در بالای صفحه اصلی نمایش داده می‌شود
- بنر زرد برای < $15 و قرمز برای < $5
- قابل بستن، به‌روزرسانی هر ۲ دقیقه

#### ۴. `AiEngineBadge` بازطراحی:
- از `Groq + Gemini` به `DeepSeek + GPT-4o-mini`
- لوگوهای جدید SVG و توضیح tooltip با جزئیات اعتبار

---

## ۴. فایل‌های بازنویسی‌شده (خلاصه)

### سرویس AI:
- `lib/ai/openrouter.ts` **(جدید)**
- `lib/ai/credit.ts` **(جدید)**
- `lib/ai/groq.ts` (wrapper)
- `lib/ai/gemini-vision.ts` (wrapper)
- `lib/ai/index.ts` (نقطه ورود جدید)
- `lib/ai/shift-request-normalizer.ts` (افزودن `OPENROUTER_JSON_CONTRACT`, `VISION_JSON_CONTRACT`)

### API Routes:
- `app/api/ai/chat-requests/route.ts` → DeepSeek
- `app/api/ai/parse-text-request/route.ts` → DeepSeek
- `app/api/ai/parse-image-request/route.ts` → GPT-4o-mini + fallback
- `app/api/ai/health/route.ts` → شامل اعتبار و مدل‌های جدید
- `app/api/ai/credit/route.ts` **(جدید)** → مدیریت اعتبار

### UI:
- `features/shared/components/AiEngineBadge.tsx` → DeepSeek + GPT-4o-mini
- `features/shared/components/AiCreditPanel.tsx` **(جدید)** → پنل اعتبار با هشدار زرد/قرمز
- `features/reports/components/EventLogPanel.tsx` → ادغام اعتبار + لاگ
- `app/page.tsx` → بنر هشدار اعتبار + پاس‌دهی userRole به EventLogPanel

### پیکربندی:
- `.env.example` → مستندسازی OpenRouter و اعتبار
- `.env.local` **(جدید)** → کلید واقعی برای توسعه محلی

### تست‌ها:
- `tests/ai-model-policy.test.ts` → بازنویسی برای معماری جدید OpenRouter + اعتبار ۱۰۰ دلاری

---

## ۵. نحوه تست

### تست اعتبار:
```bash
npx tsx --test tests/ai-model-policy.test.ts
```
- باید ۱۰ تست پاس شود (مدل متنی DeepSeek، بینایی gpt-4o-mini، fallback gpt-4o، اعتبار ۱۰۰ دلار)

### تست دستی API (با کلید واقعی):
```bash
curl -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/models | grep deepseek
GET /api/ai/health
GET /api/ai/credit
POST /api/ai/chat-requests
POST /api/ai/parse-image-request
```

### تست UI سرپرستار:
- ورود به‌عنوان سرپرستار → تب کارنامه و گزارشات → باید `AiCreditPanel` با `Credit: $X / $100` دیده شود
- شبیه‌سازی اعتبار کم: `POST /api/ai/credit { action: "reset", amount: 14 }` → باید بنر زرد با پیام دقیق نمایش داده شود
- `amount: 4` → بنر قرمز بحرانی

---

## ۶. نمونه خروجی اعتبار

### حالت عادی (ok):
```
Credit: $84.50 / $100 — 84.5% باقی‌مانده
وضعیت: عادی
```

### هشدار زرد (< $15):
```
⚠️ اعتبار API به پایان خود نزدیک است (باقی‌مانده: $12.34). لطفاً جهت جلوگیری از قطعی سرویس نسبت به شارژ اقدام کنید.
```
- پس‌زمینه زرد، border زرد، آیکن هشدار

### هشدار قرمز (< $5):
```
🚨 اعتبار API بحرانی است (باقی‌مانده: $3.21). سرویس به زودی قطع خواهد شد! لطفاً فوراً نسبت به شارژ اقدام کنید.
```
- پس‌زمینه قرمز، متن سفید، shadow قرمز، توضیح تکمیلی درباره قطعی چت و OCR

---

## ۷. مزایای معماری جدید

1. **هزینه بهینه**: DeepSeek بسیار ارزان‌تر از GPT-OSS 120B قبلی برای متن، و gpt-4o-mini ارزان برای تصویر
2. **پایداری**: یک استخر کلید مشترک، fallback هوشمند برای تصاویر شلوغ
3. **شفافیت مالی**: ردیابی دقیق هر توکن، نمایش هزینه هر درخواست، تفکیک بر اساس مدل
4. **پیشگیری از قطعی**: هشدار زرد و قرمز به سرپرستار قبل از اتمام اعتبار
5. **سازگاری**: کد قدیمی با importهای Groq/Gemini همچنان کار می‌کند (wrapper)

---

## ۸. اقدامات بعدی پیشنهادی

- اتصال پنل اعتبار به درگاه پرداخت OpenRouter برای شارژ مستقیم از UI سرپرستار
- ذخیره اعتبار در S3 به‌جای فایل محلی برای پایداری بین instanceهای Vercel
- اضافه کردن نمودار مصرف روزانه/هفتگی در `AiCreditPanel`
- لاگ کردن رویدادهای `ai` در `eventLogs` برای حسابرسی سرپرستار

---

**تاریخ بازطراحی**: ۱۴۰۴/۰۵/۰۹ (2026-07-31)
**معمار**: Agent Mode — Arena
**وضعیت**: ✅ پیاده‌سازی کامل + تست‌های مدل پاس شده
