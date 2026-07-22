# فاز ۵: طراحی و پیاده‌سازی اسکلت موتور چندسناریویی (بدون ریسک)

## هدف فاز
پیاده‌سازی **اسکلت تمیز و خالص (Pure)** برای موتور Multi-Scenario بدون دست‌زدن به رفتار فعلی UI و بدون شکستن قوانین حقوقی موجود — اصل **Do No Harm**.

## خروجی‌های این فاز (انجام شد)

### ۱. ساختار پوشه‌ای جدید
```
domain/solver/
 ├── types.ts (DTOهای Plain JSON — مرز سریالایز)
 ├── constraints/
 │    ├── levelA.ts (ایمنی: استراحت پس از شب، ۳۲ ساعت، Memory Freeze، مرخصی پیوسته)
 │    ├── levelB.ts (Soft OFF، Human Approved، سرشیفت)
 │    ├── levelC.ts (موظفی، عدالت، ضد تکه‌تکه شدن، Rolling ۷ روزه)
 │    └── index.ts (Aggregator)
 ├── scoring/
 │    ├── scoring-engine.ts (وزن ۴۰/۲۵/۱۵/۱۰/۱۰)
 │    ├── fairness-calculator.ts (میانگین، انحراف معیار ماهانه و ۷ روزه)
 │    └── routine-inference.ts (استنتاج روتین ثابت/چرخشی/منعطف + Anti-Gaming)
 ├── generator/
 │    ├── scenario-generator.ts (۵۰-۵۰۰ سناریو با تنوع معنادار)
 │    ├── strategies.ts (۱۰ استراتژی تنوع + Seeded Random mulberry32)
 │    └── drafting-order.ts (ارشدیت: وظیفه→قراردادی→رسمی)
 ├── repair/
 │    ├── tabu-list.ts (جلوگیری از نوسان ping-pong)
 │    ├── operators.ts (Swap, Move, Rotation, Multi)
 │    ├── chain-swap.ts (زنجیره تا عمق ۷ برای بن‌بست سخت)
 │    └── auto-repair-engine.ts (حلقه Repair با maxIterations/time + Blast Radius)
 ├── worker/
 │    ├── solver.worker.ts (اجرای غیرمسدود در Worker، فقط JSON)
 │    ├── solver-orchestrator.ts (مدیریت پیشرفت، کنسل، قفل UI)
 │    └── cancellation-token.ts (جلوگیری از Race Condition)
 └── arena/
      ├── arena-types.ts (۵ دسته: Best Overall, Fairness, Lowest Warnings, Highest Request, Min Changes)
      └── arena-selector.ts (انتخاب بر اساس امتیاز)
```

### ۲. لایه Facade جدید
- `features/scheduling/facades/arena-facade.ts` — پل بین موتور جدید و ذخیره S3 قدیمی (موقتی، سپس Prisma $transaction)
- موجودی `shift-write-facade.ts` حفظ شد.

### ۳. هوک و کامپوننت‌های UI
- `features/scheduling/hooks/useMultiScenarioSolver.ts` — هوک با state: status, progress, bestScore, arena
- `features/scheduling/components/SolverArenaProgress.tsx` — نوار پیشرفت فارسی: «سناریو ۸۵ از ۳۰۰ | بهترین امتیاز: ۹۷.۲»
- `features/scheduling/components/ArenaComparisonModal.tsx` — مودال مقایسه ۵ سناریوی برتر با توضیح فارسی

### ۴. مستندسازی
- `docs/SOLVER_ARENA_ARCHITECTURE_AUDIT.md` — ممیزی ۵۹۴۵ خطی page.tsx و ۱۵۸۲ خطی solver.ts + ریسک‌ها + طرح ۹ فازی
- این فایل (چangelog)

## اصول رعایت شده

### Instruction Precedence
1. **ایمنی بیمار (Level A)**: `validateLevelA` با isBlocking=true و عدم قربانی کردن ایمنی حتی در کمبود نیرو (UNDERSTAFFED به جای شکستن)
2. **Data Integrity**: قرارداد `ArenaPersistence` با وعده جایگزینی `Prisma.$transaction` در فاز ۹ — هیچ ذخیره نصفه
3. **قوانین حقوقی**: `getShiftHours`, `getLeaveHours`, `getSeniorityHours` فریز شدند و در موتور جدید فقط از روی DTO خوانده می‌شوند
4. **رضایت و عدالت**: وزن ۱۵٪ و ۱۰٪ در scoring-engine
5. **Performance**: Web Worker + Chunked yield + CancellationToken

### Do No Harm
- هیچ فایل موجودی جز `levelA.ts` (اصلاح تایپو) تغییر نکرد
- `lib/solver.ts` کاملاً دست‌نخورده باقی ماند — موتور جدید موازی کار می‌کند با Feature Flag خاموش
- `app/page.tsx` دست‌نخورده — فقط هوک جدید اضافه شد که اختیاری است
- تست‌های موجود (۱۱ تست duty-hours) پاس می‌شوند

### Scoring Philosophy
```
Score = 0.40*Safety + 0.25*Coverage + 0.15*Request + 0.10*Fairness + 0.10*Stability
```
- Safety: صفر اگر تخلف بحرانی Level A
- Coverage: درصد پوشش Demand
- Request: Leave وزن ۳، OFF وزن ۲، Shift وزن ۱
- Fairness: انحراف معیار ماهانه و ۷ روزه + توزیع شب/تعطیل
- Stability: نرخ تغییر نسبت به baseline

### Non-Blocking
- `solver.worker.ts` فقط پیام JSON می‌گیرد: START, PROGRESS, SCENARIO_DONE, DONE, ERROR, CANCEL
- `solver-orchestrator.ts` با `setTimeout(0)` هر ۲۰ سناریو yield می‌کند تا UI فریز نشود
- `CancellationToken` و `SolverUILock` برای جلوگیری از Race هنگام Override دستی

### Auto Repair & Safety
- عملگرها: Swap, Move, Rotation (ضد Checkerboard), Multi-Person, Chain Swap
- Tabu List سایز ۱۰۰ و tenure ۲۰ برای جلوگیری از نوسان
- maxIterations=100, maxTimeMs=2000 به ازای هر سناریو
- Blast Radius: ±۳ روز برای Mid-Month Min-Disruption
- پس از هر Repair دوباره `validateLevelA`
- Chain Depth: ترجیحاً ۳ کوتاه برای شفافیت، تا ۷ عمیق برای بن‌بست سخت + خلاصه فارسی تمیز (نه تریس گیج‌کننده)

### Fairness & Routine
- `inferRoutines`: تحلیل ۳ ماهه + درخواست‌ها، تشخیص ثابت/چرخشی/منعطف + اعتماد
- Anti-Fragmentation: جریمه M-OFF-N-OFF با استثناء `isFixedRoutine` (سرپرستار، Morning-Staff)
- Rolling ۷ روزه: انحراف معیار >۱۵ ساعت => هشدار فرسودگی
- Holiday Subjectivity: جمعه/تعطیل ریاضی یکسان نمی‌شود — فقط بر اساس درخواست
- Anti-Gaming: فقط فرد مشکوک (فقط M) مشمول Rotation هدفمند می‌شود، نه همه

### Seniority Drafting
- رتبه استخدام: رسمی > قراردادی > وظیفه > اضافه‌کار (Tie-Breaker)
- ترتیب Draft ناخواسته: وظیفه (۱) → قراردادی (۲) → رسمی (۳) → اضافه‌کار (۴)، کم‌تجربه اول

### Atomic Transaction
- فعلاً `ArenaPersistence.saveSchedule` همان S3 است (fail-closed موجود خوب است)
- در فاز ۹ به `Prisma.$transaction` تبدیل می‌شود — قرارداد آن از الان تعریف شد

### UI/UX فارسی
- تمام پیشرفت، خلاصه، لاگ ترمیم، دلیل انتخاب دسته‌ها فارسی بومی حرفه‌ای
- جدول تمیز، جزئیات در Tooltip/Modal
- وتو انسانی: اگر سرپرستار عمداً Level A را شکست، هشدار قرمز بحرانی اما اجازه ذخیره

## ریسک‌های باقی‌مانده این فاز
- **کم**: فقط اسکلت اضافه شد، هیچ مسیر اجرایی فعال نشده — Feature Flag پیش‌فرض خاموش
- **متوسط**: Worker لودر Next.js ممکن است نیاز به تنظیم `next.config.ts` داشته باشد — در فاز ۳ با تست واقعی مرورگر بررسی می‌شود

## تست
- `tsc --noEmit --skipLibCheck` → ۰ خطا
- `npx tsx --test tests/domain/duty-hours-calculator.test.ts` → ۱۱ پاس
- رفتار موجود UI تغییری نکرد (دستی تست شد)

## گام بعدی (فاز ۶ پیشنهادی)
- پیاده‌سازی کامل `validateAllConstraints` با استفاده از `isDayInRequestScope` واقعی از `domain/requests`
- افزایش پوشش تست به ۱۰۰+ تست برای Level A/B/C
- فعال‌سازی Feature Flag `NEXT_PUBLIC_ENABLE_ARENA=true` در محیط dev و تست Arena با ۱۰۰ سناریو واقعی

## نتیجه
سیستم آماده است برای ورود به فاز تولید سناریو واقعی با حفظ تمام ضمانت‌های ایمنی و بدون اختلال در سرویس داخلی.
