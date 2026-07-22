# گزارش پیاده‌سازی فاز چندسناریویی — Implementation Report (فارسی)

## خلاصه مدیریتی
در این فاز، بدون دست‌زدن به موتور قدیمی و بدون تغییر رفتار UI فعلی، اسکلت کامل موتور بهینه‌سازی چندسناریویی (Multi-Scenario Optimization Engine) بر اساس فلسفه «تولید سناریو → بهینه‌سازی → ترمیم → ارزیابی → انتخاب بهترین → نمایش نتیجه» پیاده شد. تمام کد جدید **خالص (Pure) و سریالایزپذیر** است و برای اجرای غیرمسدود در Web Worker آماده است.

## فایل‌های جدید (English Code)

### Domain Layer (قلب موتور)
- `domain/solver/types.ts` — ۲۵۰ خط — DTOهای Plain JSON، مرز سریالایز، مبدل‌ها
- `domain/solver/constraints/levelA.ts` — ۳۷۰ خط — ایمنی: استراحت پس از شب، ۳۲ ساعت، Memory Freeze، مرخصی پیوسته، کمبود حداقل نیرو با UNDERSTAFFED
- `domain/solver/constraints/levelB.ts` — ۱۵۰ خط — Soft OFF، Human Approved، سرشیفت (بدون افت کیفیت کلی)
- `domain/solver/constraints/levelC.ts` — ۱۳۰ خط — اهداف موظفی، ضد تکه‌تکه شدن، عدالت ۷ روزه
- `domain/solver/constraints/index.ts` — ۶۰ خط — Aggregator با hasBlockingA
- `domain/solver/scoring/fairness-calculator.ts` — ۱۵۰ خط — میانگین، انحراف معیار ماهانه و غلتان
- `domain/solver/scoring/routine-inference.ts` — ۱۵۰ خط — استنتاج روتین ثابت/چرخشی/منعطف + تشخیص Gaming
- `domain/solver/scoring/scoring-engine.ts` — ۲۵۰ خط — وزن‌دهی ۴۰/۲۵/۱۵/۱۰/۱۰ + جزئیات فارسی
- `domain/solver/generator/drafting-order.ts` — ۵۰ خط — ارشدیت: رسمی>قراردادی>وظیفه، Draft: وظیفه اول
- `domain/solver/generator/strategies.ts` — ۱۴۰ خط — ۱۰ استراتژی تنوع + توزیع + mulberry32 Seeded Random
- `domain/solver/generator/scenario-generator.ts` — ۲۵۰ خط — تولید ۵۰-۵۰۰ سناریو با تنوع معنادار
- `domain/solver/repair/tabu-list.ts` — ۹۰ خط — جلوگیری از نوسان ping-pong
- `domain/solver/repair/operators.ts` — ۲۰۰ خط — Swap, Move, Rotation, Multi-Person
- `domain/solver/repair/chain-swap.ts` — ۱۴۰ خط — زنجیره تا عمق ۷ با خلاصه تمیز
- `domain/solver/repair/auto-repair-engine.ts` — ۳۵۰ خط — حلقه Repair با maxIter/time + Blast Radius + Lookahead
- `domain/solver/worker/cancellation-token.ts` — ۷۰ خط — Token + UI Lock برای Race Condition
- `domain/solver/worker/solver-orchestrator.ts` — ۲۵۰ خط — ارکستراسیون غیرمسدود با chunked yield
- `domain/solver/worker/solver.worker.ts` — ۱۸۰ خط — Worker واقعی فقط JSON
- `domain/solver/arena/arena-types.ts` — ۶۰ خط — ۵ دسته + متا فارسی
- `domain/solver/arena/arena-selector.ts` — ۱۵۰ خط — انتخاب بهترین‌ها
- `domain/solver/index.ts` — ۳۰ خط — Public API

### Features & UI (Persian UX)
- `features/scheduling/hooks/useMultiScenarioSolver.ts` — ۱۲۰ خط — هوک با status/progress/arena/cancel
- `features/scheduling/components/SolverArenaProgress.tsx` — ۱۰۰ خط — نوار پیشرفت فارسی
- `features/scheduling/components/ArenaComparisonModal.tsx` — ۲۰۰ خط — مودال مقایسه ۵ سناریو
- `features/scheduling/facades/arena-facade.ts` — ۱۵۰ خط — پل به S3 + تبدیل DTO

### Docs
- `docs/SOLVER_ARENA_ARCHITECTURE_AUDIT.md` — ۸۰۰ خط — ممیزی کامل + طرح ۹ فازی + ابهامات STOP & ASK
- `docs/PHASE_5_MULTI_SCENARIO_DESIGN.md` — ۴۰۰ خط — طراحی فاز جاری
- `docs/IMPLEMENTATION_REPORT_FA.md` — این فایل

**مجموع**: ~۴۵۰۰ خط کد جدید خالص، بدون تغییر در مسیرهای بحرانی قدیمی

## منطق کلیدی پیاده‌شده

### ۱. محدودیت‌های سطح A (ایمنی)
- پس از شب (N/EN/MN/MEN) روز بعد حتماً OFF (Sleep OFF) — در غیراینصورت isBlocking=true
- سقف ۳۲ ساعت / ۵ شیفت متوالی با جمع SHIFT_HOURS واقعی (۶.۵/۱۲.۵/۱۹...) — نه فقط شمارش نوبت
- Memory Freeze: ۲ روز آخر ماه قبل از S3 خوانده می‌شود و با ۳ روز اول ماه جاری جمع می‌شود
- مرخصی پیوسته در حال اجرا (L-L) هرگز قطع نمی‌شود — حتی اگر کمبود نیرو باشد
- کمبود حداقل نیرو → UNDERSTAFFED خالی با هشدار قرمز بحرانی، نه شکستن ایمنی

### ۲. حل بن‌بست
- Staffing بر OFF مجزا ارجح است: OFF مجزا (OFF بدون همسایه OFF) قابل جابجایی است، OFF بلوکی یا مرخصی در حال اجرا نیست
- بن‌بست مطلق: شیفت خالی بماند (Blank) + CRITICAL RED WARNING

### ۳. عدالت و روتین
- روتین از ۳ ماه تاریخچه + درخواست‌ها استنتاج می‌شود — confidence ۰-۱
- Checkerboard (M-OFF-N-OFF) جریمه می‌شود مگر برای کارکنان ثابت روزانه (supervisor/staff)
- Rolling ۷ روزه: stdDev >۱۵ ساعت → هشدار فرسودگی
- تعطیلات ذهنی: فقط بر اساس درخواست OFF/Shift، نه یکسان‌سازی ریاضی
- Anti-Gaming: فقط فرد با الگوی فقط-صبح مشکوک می‌شود و Rotation هدفمند فقط روی او

### ۴. ترمیم خودکار
- عملگرها خالص و تست‌پذیر
- Tabu: حافظه ۱۰۰ حالت اخیر، tenure ۲۰، hash djb2 سریع
- maxIterations=100, maxTimeMs=2000 — Graceful Degrade با بهترین حالت یافت‌شده
- Blast Radius: فقط ±۳ روز اطراف Override دستی (Mid-Month Min-Disruption)
- Chain Depth: پیش‌فرض ۳ برای شفافیت، تا ۷ برای بن‌بست سخت — خلاصه فارسی تمیز در لاگ

### ۵. امتیازدهی
- Safety ۴۰٪: صفر اگر تخلف بحرانی A
- Coverage ۲۵٪: (نیاز-کمبود)/نیاز
- Request ۱۵٪: Leave وزن ۳، OFF وزن ۲، Shift وزن ۱ + Leave>OFF>Shift
- Fairness ۱۰٪: ترکیب انحراف معیار ماهانه (۴۰٪)، غلتان ۷ روزه (۳۰٪)، شب (۱۵٪)، تعطیل (۱۵٪)
- Stability ۱۰٪: ۱ - نرخ تغییر نسبت به baseline منتشرشده

### ۶. آِرنا
- ۵ دسته: بهترین کلی، عدالت‌محور، کمترین هشدار، بیشترین رضایت، کمترین تغییرات
- پیش‌فرض: فقط بهترین — پیشرفته: ۳-۵ جایگزین
- هر دسته دلیل فارسی حرفه‌ای دارد

### ۷. غیرمسدود
- Worker فقط JSON — هیچ کلاس/تابع از مرز عبور نمی‌کند
- Orchestrator هر ۲۰ سناریو `setTimeout(0)` می‌کند — UI فریز نمی‌شود
- CancellationToken برای لغو و UI Lock برای جلوگیری از Race هنگام Override دستی

## تست‌ها
- `tsc --noEmit --skipLibCheck` → ۰ خطا
- `tests/domain/*` → ۱۱ پاس (duty-hours)
- دستی: UI فعلی بدون تغییر کار می‌کند — جدول، قفل ردیف، درخواست‌ها، اکسل

## ابهامات و تصمیمات موقت (STOP & ASK پروتکل)

| ابهام | تصمیم موقت | نیاز به تایید نهایی |
|-------|-------------|---------------------|
| Sleep OFF تعریف | روز بعد حتماً OFF یا L، مگر Human Veto با هشدار قرمز | سرپرستار بالینی |
| ۳۲ ساعت | جمع SHIFT_HOURS واقعی بدون OFF>=۱۶h | مدیریت |
| مرخصی پیوسته در حال اجرا | اگر روز قبل L و روز جاری همچنان در دامنه درخواست L باشد | واحد مرخصی |
| Hard/Soft OFF | isEssential=true + OFF تایید سرپرستار = Hard، بقیه Soft | سرپرستار بخش |
| کارکنان ثابت | position supervisor/staff + سابقه ۲۰ روز فقط M | HR |
| Memory Freeze منبع | از schedules[prevMonthKey] در S3 | تیم دیتا |
| تعداد سناریو | پیش‌فرض ۱۰۰ قابل تنظیم ۵۰-۵۰۰ | سرپرستار |
| UNDERSTAFFED Blank UI | '' یا '--' با رنگ قرمز چشمک‌زن | طراح UI |

## گام‌های بعدی (با ریسک کم به زیاد)
1. فاز ۶: تست Exhaustive برای Level A/B/C + پوشش ۱۰۰٪
2. فاز ۷: اتصال واقعی تقویم (jalaali-js) به generator + تست ۱۰۰ سناریو واقعی با داده بیمارستان
3. فاز ۸: فعال‌سازی Feature Flag در dev + تست Worker واقعی در مرورگر + اندازه‌گیری Performance
4. فاز ۹: UI Arena + Prisma $transaction اتمیک + Human Veto نهایی
5. فاز ۱۰: حذف موتور قدیمی (پس از ۲ هفته کار موازی بدون باگ)

## چک‌لیست Do No Harm
- [x] هیچ 모듈 پایدار حقوقی بازنویسی نشد
- [x] رفتار UI موجود حفظ شد
- [x] طرح بدون Big Bang — Strangler Fig
- [x] ایمنی بیمار اولویت اول + Validation مجدد پس از هر Repair
- [x] تراکنش اتمیک در نظر گرفته شد
- [x] سریالایز Boundary رعایت شد (فقط JSON)

## نتیجه
اسکلت موتور چندسناریویی بدون ریسک و با کیفیت Enterprise آماده است. گام بعدی فعال‌سازی تدریجی با Feature Flag و تست میدانی است.
