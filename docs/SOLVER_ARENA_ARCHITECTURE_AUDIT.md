# گزارش ممیزی معماری و طرح مهاجرت تدریجی به موتور بهینه‌سازی چندسناریویی
## NursingSmart — Multi-Scenario Optimization Engine

**تاریخ:** ۱۴۰۵/۰۵/۰۱ (2026-07-22)  
**نقش:** Principal Software Engineer & System Architect  
**وضعیت:** سیستم فعلی **عملیاتی، تست‌شده و مستقر داخلی** است — هرگونه تغییر باید با اصل **Do No Harm** انجام شود.

---

### ۱. خلاصه اجرایی

سیستم NursingSmart در حال حاضر یک موتور زمان‌بندی **تک‌سناریویی حریصانه (Greedy)** دارد (`lib/solver.ts` ~۱۵۸۰ خط) که بلافاصله پس از تولید هشدار می‌دهد. هدف جدید ارتقا به **Generate Scenarios → Optimize → Repair → Evaluate → Select Best → Show Result** است با توان تولید ۵۰ تا ۵۰۰ سناریو واقعاً متنوع و انتخاب هوشمندانه.

**فلسفه جدید امتیازدهی:**

- ایمنی و محدودیت‌های سخت (Level A / قانونی): ۴۰٪
- پوشش حداقل نیرو و الزامات Staffing: ۲۵٪
- رضایت درخواست‌ها (مرخصی/OFF): ۱۵٪
- عدالت و حفظ روتین: ۱۰٪
- پایداری و حداقل تغییرات: ۱۰٪

**نتیجه ممیزی اولیه:** معماری فعلی در فازهای ۱ تا ۶ قبلی بهبود یافته (Domain Layer خالص، Facade، هوک‌ها، کامپوننت‌های مستقل) اما هنوز یک فایل خدای ۵۹۴۵ خطی `app/page.tsx` داریم که قلب تپنده و در عین حال ریسک اصلی سیستم است.

---

### ۲. ممیزی دقیق `app/page.tsx` (۵۹۴۵ خط)

#### ۲.۱ ابعاد و ساختار
- **۵۹۴۵ خط، ۳۱۳ کیلوبایت** — هر تغییر ریسک Regression دارد.
- **۸۵+ useState** باقی‌مانده (از ۱۱۱ اولیه) — برخی هنوز پراکنده‌اند.
- **چند مسئولیتی:** احراز هویت، مدیریت دپارتمان، S3 storage با ETag و optimistic concurrency، مدیریت پرسنل، درخواست‌ها، تقویم رسمی، تنظیمات موظفی، بهینه‌ساز، صادرات اکسل، رندر جدول.

#### ۲.۲ ریسک‌های شناسایی‌شده

| سطح | شرح ریسک | پیامد | راهکار تدریجی |
|-----|----------|--------|----------------|
| **بحرانی** | منطق ذخیره‌سازی S3 با صف `saveQueueRef` و `storageVersionsRef` مستقیماً در کامپوننت UI قرار دارد. هر اشتباه در ETag منجر به قفل fail-closed و نیاز به رفرش صفحه می‌شود. | از دست رفتن داده یا بلاک نوشتن | استخراج به `features/storage/` به عنوان سرویس مستقل با اینترفیس `StoragePersistence` (الگوی Facade فعلی قابل توسعه است) |
| **بحرانی** | `solveNursingSchedule` به صورت همگام (sync) در رندر/ایونت هندلر اجرا می‌شود. تولید ۵۰۰ سناریو = ۵۰۰× پیچیدگی فعلی → فریز UI و تایم‌اوت Next.js API | کرش مرورگر، تجربه کاربری فاجعه | **باید Web Worker اجباری شود**. سریالایز فقط DTOهای Plain JSON |
| **بالا** | `saveState` دارای منطق `preserve_current / refresh_personnel / full_resolve` است که با `normalizeScheduleAssignments` ترکیب شده. این منطق باید در Domain باشد نه UI | نقض Clean Architecture | انتقال به `domain/scheduling/schedule-operations.ts` (بخشی انجام شده) |
| **بالا** | وابستگی به `localStorage` برای انتخاب دپارتمان و ماه، بدون اعتبارسنجی | ناسازگاری پس از حذف دپارتمان | اعتبارسنجی در لایه Domain + Server truthing |
| **متوسط** | اکسل‌سازی با `exceljs` داخل هندلر صفحه (import داینامیک) — حجم باندل | کندی لود | استخراج به `features/reporting/export-excel.ts` |
| **متوسط** | چاپ تقویم با CSS print داخل همین فایل | سختی نگهداری | کامپوننت Print اختصاصی |

#### ۲.۳ نقاط قوت فعلی که باید حفظ شوند
- سیستم Concurrency با `If-Match / If-None-Match` و مرج خودکار یک مرحله‌ای هنگام تداخل ETag بسیار خوب طراحی شده و **نباید دستکاری شود**.
- `BusyOverlay` و `blockingDbSaveCount` تجربه کاربری را هنگام ذخیره S3 حفظ می‌کند.
- `useScheduleState` و `usePersonnelForm` نمونه موفق جداسازی هستند.

#### ۲.۴ قانون DO NO HARM برای این فایل
- **ممنوعیت بازنویسی یکباره:** هرگونه استخراج کامپوننت باید با Strangler Fig و با حفظ Backward Compatibility انجام شود.
- **حفظ رفتار موجود UI:** جدول، لاک ردیف، لاگ تغییرات، مدیریت درخواست‌ها باید بدون تغییر بمانند تا زمانی که جایگزین تست‌شده آماده شود.

---

### ۳. ممیزی `lib/solver.ts` (۱۵۸۲ خط)

#### ۳.۱ منطق فعلی
- **الگوریتم:** تک‌گذره (Single-pass) روز به روز، با `fillGroupGaps` برای پر کردن کمبود.
- **اولویت‌بندی داخل `fillGroupGaps`:** بهترین تلاش برای رعایت درخواست‌ها، موظفی، seniority قراردادی، جلوگیری از شیفت‌های سنگین متوالی.
- **R1:** درخواست‌های Leave و OFF و Pattern قبل از پر کردن Demand اعمال می‌شوند.
- **R2:** محدودیت‌هایی مانند منع کار پس از شب، دو شب متوالی، OFF متوالی >۳، آف بعد از مرخصی بررسی می‌شوند اما بیشتر به صورت Post-Process.
- **R3:** انتخاب سرشیفت بر اساس حضور staff و قابلیت `canBeShiftLeader`.

#### ۳.۲ نقاط ضعف نسبت به فلسفه جدید

1. **تک‌سناریویی:** هیچ گونه تنوع (Diversity) ندارد. یکبار اجرا = یک نتیجه.
2. **بدون امتیازدهی:** فقط هشدار تولید می‌کند، نه Score.
3. **بدون Auto-Repair:** به جای Repair، Overstaffing یا Coverage Shortage را Warning می‌دهد.
4. **بدون حافظه مرزی (Memory Freeze):** ۱-۲ روز آخر ماه قبل بررسی نمی‌شود.
5. **بدون Rolling Fairness:** عدالت فقط ماهانه محاسبه می‌شود، نه پنجره ۷ روزه.
6. **بدون Routine Inference:** الگوها فقط از درخواست صریح می‌آیند، نه استنتاج تاریخی.
7. **بدون Tabu / Oscillation Prevention:** Chain-Swap وجود ندارد.
8. **گردش شیفت (Shift Clustering) و Anti-Fragmentation اجرا نمی‌شود** به صورت سیستماتیک.
9. **همگام (Sync):** در ترد اصلی UI اجرا می‌شود.
10. **سریالایز ناپذیر:** مستقیماً از `Personnel` کلاس‌گونه استفاده می‌کند (هرچند Plain Object است) اما وابسته به closures تقویم است.

#### ۳.۳ بخش‌های پایدار و ممنوعه برای تغییر (Do No Harm)
- توابع حقوقی: `getShiftHours`, `getLeaveHours`, `getSeniorityHours`, `calculateShiftProductivity`, `checkProductivityEligibility`, `generatePersonnelReports` **بسیار حساس و تست‌شده‌اند** و هرگونه تغییر باید با تست حقوقی و تایید کاربر انجام شود.
- فرمول موظفی: `(X*7 - Y*2)` و `contract = official+14` با تقویم رسمی لینک است و باید حفظ شود.

---

### ۴. ممیزی سایر لایه‌ها

#### ۴.۱ `domain/` (نقطه قوت)
- Pure، بدون Side Effect، تست‌شده (۶۷ تست).
- `isDayInRequestScope` جامع‌تر از نسخه قدیمی در `balanceChecker`.
- `duty-hours-calculator` عدم وابستگی به React را اثبات کرده.
- **مسیر آینده:** تمام منطق جدید Solver باید ابتدا اینجا به صورت Pure پیاده شود.

#### ۴.۲ `features/scheduling/facades/shift-write-facade.ts`
- الگوی Facade با DI به درستی پیاده شده.
- `solveWithPriority` هنوز signature mutable دارد (رکورد CRITICAL_REVIEW). باید به `readonly` تبدیل شود (انجام شد؟ نیاز به بررسی).
- مسیر Strangler Fig برای جایگزینی با Server Actions هموار است.

#### ۴.۳ `lib/storageSchemas.ts` و S3
- Zod validation کامل و سختگیرانه.
- granular object layout خوب است ولی برای ۵۰۰ سناریو باید سناریوها را **در حافظه Worker نگه داشت، نه در S3**.
- برای فاز نهایی ذخیره باید **Prisma $transaction اتمیک** اجباری شود (الزامات سند). فعلاً S3 است، ولی قرارداد تراکنش باید در Facade تعریف شود.

#### ۴.۴ `lib/balanceChecker.ts` و `smartSuggestion.ts`
- `balanceChecker` تا حدی با Domain duplicate دارد و باید به تدریج منسوخ شود.
- `smartSuggestion` شروع خوبی برای DSS است اما heuristic است، نه مبتنی بر امتیاز.

#### ۴.۵ Performance & Architecture Quality (الویت ۵)
- باندل شامل `exceljs` سنگین است.
- نبود Web Worker = بزرگترین تهدید برای فاز Multi-Scenario.

---

### ۵. تحلیل ریسک کلی (سلسله مراتب Instruction Precedence رعایت شده)

#### ریسک‌های Level A (ایمنی بیمار)
- **نقض استراحت اجباری پس از شب:** اگر Repair اجباری منجر به تجویز شیفت بلافاصله پس از شب شود، جان بیمار به خطر می‌افتد. هر Auto-Repair باید Level A را مجدداً Validate کند.
- **شکستن سقف ۳۲ ساعت متوالی:** الگوریتم فعلی فقط N متوالی را محدود می‌کند، نه مجموع ساعت. موتور جدید باید `SHIFT_HOURS` + `getLeaveHours` را جمع بزند و از ۳۲ ساعت عبور نکند.
- **Memory Freeze:** بدون در نظر گرفتن ۲ روز آخر ماه قبل، ممکن است پرستاری ۵ شب متوالی مرز ماه داشته باشد.

**راهکار:** یک ماژول مستقل `domain/solver/constraints/levelA.ts` با تابع `validateLevelA` که هیچ سناریویی بدون عبور از آن امتیاز نمی‌گیرد.

#### ریسک‌های Data Integrity
- ذخیره نهایی باید اتمیک باشد. اگر ۵۰۰ سناریو تولید شد اما ذخیره یکی نصفه بماند، برنامه بهم می‌ریزد.
- راهکار: Facade ذخیره باید `Prisma.$transaction` (یا S3 batch با rollback منطقی) را پیاده کند. فعلاً S3 fail-closed خوب است ولی کافی نیست.

#### ریسک‌های Business Rules & Payroll
- تغییر ناخواسته در `generatePersonnelReports` باعث خطای حقوق می‌شود.
- راهکار: این ماژول تا اطلاع ثانوی **فریز** و فقط از طریق Adapter صدا زده شود.

---

### ۶. طرح مهاجرت تدریجی (Incremental, No Big Bang)

#### اصل: Strangler Fig + Modularity + Feature Flags

تمام کد جدید در `domain/solver/` و `features/scheduling/arena/` ساخته می‌شود **به موازات موتور قدیمی**. موتور قدیمی تا زمانی که موتور جدید ۱۰۰٪ تست و تایید شد، فعال می‌ماند. تغییر مسیر با Feature Flag `USE_MULTI_SCENARIO_ENGINE=false|true`.

---

#### فاز ۰: تثبیت و مستندسازی (این سند) ✅
- ممیزی کامل، شناسایی ریسک، تعریف قراردادهای DTO.
- **خروجی:** همین فایل + اسکلت `domain/solver/`.

#### فاز ۱: ایزوله‌سازی قراردادهای Solver (۱ هفته، ریسک پایین)
**هدف:** تعریف مرز سریالایز DTO.

**اقدامات:**
- ایجاد `domain/solver/types.ts` با Plain JSON DTOها: `PersonnelDTO`, `ShiftRequestDTO`, `StaffingDemandDTO`, `CalendarDayDTO`, `ScenarioDTO`, `ScenarioScoreDTO`, `ConstraintViolationDTO`.
- مبدل `toDTO` و `fromDTO` برای تبدیل `Personnel` فعلی به DTO بدون Mutation.
- هیچ تغییر در `solver.ts` فعلی.
- تست: `npm run test:auth` و `tsc --noEmit`.

**معیار پذیرش:** `domain/solver/types.ts` خالص، بدون import از React، با ۹۵٪ پوشش تست.

#### فاز ۲: طراحی Validation لایه‌ای Level A/B/C (۱ هفته، ریسک متوسط)
**هدف:** پیاده‌سازی `validateLevelA`, `validateLevelB`, `validateLevelC` به صورت Pure.

**اقدامات:**
- `domain/solver/constraints/levelA.ts`: بررسی استراحت پس از شب، سقف ۳۲ ساعت/۵ شیفت، Memory Freeze، حداقل پرستار الزامی، OFF سخت/قفل/مرخصی پیوسته.
- `levelB.ts`: Soft OFF، نیاز سرشیفت، تغییرات تاییدشده انسانی.
- `levelC.ts`: اهداف ساعت موظفی، عدالت، توزیع.
- هر تابع ورودی `ScenarioDTO` و خروجی `ConstraintViolation[]` خالص.
- تست Exhaustive برای هر Rule.

**Do No Harm:** این ماژول‌ها **موازی** کار می‌کنند و موتور قدیمی را صدا نمی‌زنند.

#### فاز ۳: معماری غیرمسدود (Non-Blocking) — Web Worker (۱ هفته، ریسک بالا ولی ایزوله)
**هدف:** جلوگیری از فریز UI.

**اقدامات:**
- ایجاد `domain/solver/worker/solver.worker.ts` — یک Worker خالص که فقط پیام `SolverInputDTO` می‌گیرد و `SolverProgress` و `SolverResultDTO` برمی‌گرداند.
- `domain/solver/worker/solver-orchestrator.ts` در ترد اصلی: مدیریت CancellationToken، UI Lock برای جلوگیری از Race Condition هنگام Override دستی.
- سریالایز Boundary: فقط JSON.
- Fallback: اگر Worker پشتیبانی نشود، اجرای Async با `requestIdleCallback` و chunked.

**پیاده‌سازی اولیه (همین PR):**
- اسکلت Worker با پیام‌های `START`, `PROGRESS (Scenario 85/300 | Best Score 97.2)`, `DONE`, `ERROR`, `CANCEL`.
- هوک `useMultiScenarioSolver` با state: `status`, `progress`, `bestScore`, `scenarios`.

#### فاز ۴: مولد سناریوهای متنوع (Scenario Generation Engine) (۲ هفته، ریسک متوسط)
**هدف:** ۵۰-۵۰۰ سناریو با تنوع معنادار، نه تصادفی کور.

**استراتژی‌های تنوع (Diversity Strategies):**
- `seededRandom` با `mulberry32` برای تکرارپذیری.
- `Strategy/ShuffleDraftOrder`: تغییر ترتیب Draft پرسنل (وظیفه اول) با وزن‌دهی تجربه.
- `Strategy/RequestPriorityJitter`: جابجایی اولویت درخواست‌های هم‌سطح.
- `Strategy/StaffingGreedyTilt`: یکبار Morning-First، یکبار Night-First.
- `Strategy/FairnessTilt`: وزن عدالت را موقتاً افزایش ده.
- `Strategy/RoutinePreservation`: یک سناریو کاملاً روتین‌محور.
- `Strategy/LookaheadSacrifice`: قربانی پیشگیرانه — عمداً یک OFF نرم را زودتر فدا کن تا بن‌بست Level A آخر ماه جلوگیری شود.

**خروجی:** لیست `ScenarioDTO[]` با `meta.strategy` برای شفافیت.

#### فاز ۵: موتور امتیازدهی (Scoring Engine) (۱ هفته، ریسک پایین)
**پیاده‌سازی وزن‌ها:**
```
Score = 0.40 * SafetyScore + 0.25 * CoverageScore + 0.15 * RequestScore + 0.10 * FairnessScore + 0.10 * StabilityScore
```
- هر Score ۰-۱۰۰.
- `SafetyScore`: ۱۰۰ اگر هیچ تخلف Level A نداشته باشد، وگرنه ۰ و سناریو رد می‌شود مگر در حالت UNDERSTAFFED مجاز.
- `CoverageScore`: درصد پوشش Demand.
- `RequestScore`: Leave > OFF > Shift (وزن‌دهی).
- `FairnessScore`: انحراف معیار ساعت و ۷ روز Rolling.
- `StabilityScore`: تعداد تغییرات نسبت به برنامه منتشرشده قبلی (حداقل تغییرات).

**تست:** مقایسه دستی Head Nurse.

#### فاز ۶: Auto Repair Engine + Tabu + Chain Swap (۲ هفته، ریسک بالا)
**هدف:** حل مشکلات قبل از هشدار.

**عملگرهای Repair:**
- `Swap`: جابجایی دو شیفت بین دو نفر در یک روز.
- `Move`: انتقال شیفت از فرد پرکار به کم‌کار.
- `Rotation`: چرخش شیفت‌های یک فرد برای رفع Fragmentation (M→OFF→N→OFF).
- `Multi-Person`: همزمان ۳ نفر.
- `ChainSwap`: زنجیره‌ای تا عمق قابل تنظیم (پیش‌فرض ۳، حداکثر ۷ برای بن‌بست سخت).

**ایمنی:**
- `TabuList`: حافظه ۵۰-۱۰۰ حالت اخیر برای جلوگیری از نوسان ping-pong.
- `maxIterations=100`, `maxTimeMs=2000` به ازای هر سناریو.
- `blastRadius`: برای Mid-Month Min-Disruption فقط ±۳ روز اطراف Override دستی اجازه تغییر دارد.
- پس از هر Repair، `validateLevelA` دوباره اجرا شود.

**لاگ:** خلاصه تمیز به فارسی، نه Trace گیج‌کننده.

#### فاز ۷: Routine Inference + Anti-Fragmentation + Fairness (۱ هفته، ریسک متوسط)
- `routine-inference.ts`: تحلیل تاریخچه ۳ ماهه + درخواست‌ها برای حدس روتین چرخشی/ثابت.
- `Shift Clustering`: جریمه Checkerboard (M-OFF-N-OFF) جز برای کارکنان ثابت روزانه (سرپرستار، Morning-Staff).
- `RollingWindowFairness`: عدالت ۷ روزه.
- `Anti-Gaming`: شناسایی افرادی که فقط درخواست‌های سبک می‌دهند و اعمال Rotation هدفمند فقط روی همان فرد.
- `HolidaySubjectivity`: جمعه/تعطیل را ریاضی یکسان نکن، بر اساس درخواست OFF/Shift پخش کن.

#### فاز ۸: AI Schedule Arena — انتخاب و نمایش (۱ هفته، ریسک پایین)
**دسته‌ها:**
- Best Overall (بالاترین امتیاز وزنی)
- Fairness Optimized (بالاترین FairnessScore)
- Lowest Warning Count
- Highest Request Satisfaction
- Minimum Changes

**حالت پیش‌فرض:** فقط بهترین را نشان بده. حالت پیشرفته: ۳-۵ جایگزین برتر.

**UI:**
- نوار پیشرفت فارسی: `سناریو ۸۵ از ۳۰۰ | بهترین امتیاز: ۹۷.۲`
- خلاصه نهایی: کیفیت، هشدارها، % عدالت، % رضایت درخواست.
- Tooltip/Modal برای جزئیات، جدول تمیز باقی بماند.
- قفل UI و Cancellation Token هنگام Override دستی.

#### فاز ۹: تراکنش اتمیک + وتو انسانی + انتشار (۱ هفته، ریسک متوسط)
- پیاده‌سازی ذخیره نهایی با `Prisma.$transaction` (یا S3 transactional emulation فعلی).
- پیاده‌سازی `UNDERSTAFFED` (خالی گذاشتن شیفت + هشدار قرمز بحرانی) به جای شکستن ایمنی.
- پیاده‌سازی `Ultimate Human Veto`: اگر سرپرستار عمداً محدودیت سخت را شکست، هشدار قرمز بحرانی نمایش بده اما اجازه ذخیره بده.
- Feature Flag نهایی: `NEXT_PUBLIC_ENABLE_ARENA=true`.

---

### ۷. معماری پیشنهادی نهایی (Clean Architecture)

```
app/
 ├── page.tsx (Orchestrator سبک‌شده، <1500 خط هدف)
 └── api/
      └── solver/
           └── arena/route.ts (Background Job برای 500 سناریو سنگین)

domain/
 ├── calendar/
 ├── guards/
 ├── requests/
 ├── scheduling/ (موجود)
 └── solver/ (جدید - قلب موتور چندسناریویی)
      ├── types.ts (DTOs خالص)
      ├── constraints/
      │    ├── levelA.ts
      │    ├── levelB.ts
      │    ├── levelC.ts
      │    └── index.ts
      ├── scoring/
      │    ├── scoring-engine.ts
      │    ├── fairness-calculator.ts
      │    └── routine-inference.ts
      ├── generator/
      │    ├── scenario-generator.ts
      │    ├── strategies.ts
      │    └── drafting-order.ts
      ├── repair/
      │    ├── auto-repair-engine.ts
      │    ├── tabu-list.ts
      │    ├── chain-swap.ts
      │    └── operators.ts
      ├── worker/
      │    ├── solver.worker.ts
      │    ├── solver-orchestrator.ts
      │    └── cancellation-token.ts
      └── arena/
           ├── arena-selector.ts
           └── arena-types.ts

features/
 ├── scheduling/
 │    ├── components/
 │    │    ├── ScheduleGrid.tsx (هدف فاز ۷)
 │    │    ├── SolverArenaProgress.tsx (جدید)
 │    │    ├── ArenaComparisonModal.tsx (جدید)
 │    │    └── AlertCenter.tsx (موجود)
 │    ├── facades/
 │    │    ├── shift-write-facade.ts (موجود - حفظ شود)
 │    │    └── arena-facade.ts (جدید)
 │    └── hooks/
 │         ├── useScheduleState.ts (موجود)
 │         └── useMultiScenarioSolver.ts (جدید)
 └── storage/
      └── s3-transaction.ts (جدید - اتمیک)

lib/
 ├── solver.ts (قدیمی - فریز تا حذف نهایی)
 └── prisma.ts (برای $transaction)

```

**اصل Serialization Boundary:**
- Worker فقط `SolverInputDTO` (Plain JSON) می‌گیرد.
- هیچ نمونه کلاس یا تابع از مرز عبور نمی‌کند.
- خروجی `ScenarioDTO[]` سپس به `MonthlySchedule` تبدیل می‌شود.

---

### ۸. الزامات دامنه‌ای بحرانی (چک‌لیست پیاده‌سازی)

#### ایمنی و محدودیت‌ها
- [ ] Memory Freeze: ورودی `previousMonthLastTwoDays: ShiftType[]` به Solver.
- [ ] استراحت اجباری پس از شب: `N|EN|MN|MEN` → روز بعد باید `OFF` یا `L` باشد (Sleep OFF) مگر درخواست صریح و تایید انسانی با هشدار قرمز.
- [ ] سقف ۳۲ ساعت متوالی و ~۵ شیفت متوالی: جمع `SHIFT_HOURS` را چک کن.
- [ ] بررسی درخواست Leave پیوسته: هرگز یک مرخصی چندروزه در حال اجرا را قطع نکن.

#### بن‌بست‌ها
- [ ] Staffing vs OFF مجزا: کمبود نیرو بر OFF مجزا و مرخصی شروع‌نشده ارجح است. OFF مجزا را جابجا کن.
- [ ] بن‌بست مطلق: شیفت را خالی (`UNDERSTAFFED`) بگذار + هشدار قرمز بحرانی، نه شکستن ایمنی.

#### عدالت و روتین
- [ ] استنتاج روتین از تاریخچه + درخواست‌ها.
- [ ] جلوگیری از Checkerboard.
- [ ] استثناء کارکنان ثابت روزانه.
- [ ] Rolling Window ۷ روزه.
- [ ] جمعه/تعطیل ذهنی: فقط بر اساس درخواست.
- [ ] Anti-Gaming برای افراد خاص.

#### Drafting ارشدیت
- [ ] رتبه استخدام: رسمی > قراردادی > وظیفه (Tie-Breaker)
- [ ] ترتیب Draft برای شیفت ناخواسته: وظیفه → قراردادی → رسمی، کم‌تجربه → پرتجربه.

#### پیکربندی Staffing
- [ ] سرپرستار باید تعداد پرستار و کمک‌بهیار صبح/عصر/شب را جداگانه برای روز عادی و تعطیل تنظیم کند (موجود است - حفظ شود).

---

### ۹. UI/UX الزامات فارسی (بومی)

- تمام متون کاربری، خلاصه، نوار پیشرفت، توضیحات و هشدارها **باید فارسی طبیعی و حرفه‌ای** مخصوص سوپروایزر پرستاری ایرانی باشد (بدون ترجمه ماشینی).
- جدول تمیز، جزئیات در Tooltip/Modal.
- پیشرفت حین تولید: `سناریو ۸۵ از ۳۰۰ | بهترین امتیاز: ۹۷.۲`
- خلاصه نهایی: کیفیت، هشدارها، % عدالت، % رضایت.
- وتو انسانی: هشدار قرمز بحرانی اما اجازه ذخیره نهایی.

---

### ۱۰. پروتکل STOP & ASK — ابهامات شناسایی‌شده

طبق دستور، در صورت ابهام منطقی باید بایستیم و بپرسیم. موارد زیر نیاز به شفاف‌سازی دارند (در انتهای همین سند پاسخ موقت ارائه شده و برای تصمیم نهایی نیاز به تایید سرپرستار است):

1. **تعریف دقیق Sleep OFF پس از شب:** آیا استراحت اجباری ۲۴ ساعت است یا فقط OFF کردن روز بعد؟ آیا استثناء با تایید دستی مجاز است؟
2. **سقف ۳۲ ساعت متوالی:** آیا این مجموع ساعت کار بدون احتساب استراحت است یا شامل شیفت‌های ترکیبی MEN (۲۵.۵ ساعت) هم می‌شود؟ آیا ۵ شیفت متوالی منظور ۵ روز یا ۵ نوبت است؟
3. **تشخیص مرخصی پیوسته در حال اجرا:** چگونه بفهمیم مرخصی قبلاً شروع شده؟ آیا بر اساس تاریخ امروز یا وضعیت انتشار برنامه؟
4. **OFF Hard/Soft:** در حال حاضر `isEssential` داریم. آیا باید `OFF` به دو نوع `Hard OFF` (تایید سرپرستار) و `Soft OFF` (درخواست پرسنل) تفکیک شود؟ نگاشت فعلی چیست؟
5. **کارکنان ثابت روزانه:** چگونه کارکنان Fixed را تشخیص دهیم؟ آیا `position=supervisor|staff` و سابقه ۳۰ روز فقط M کافی است؟
6. **حافظه مرزی:** داده ۱-۲ روز آخر ماه قبل از کجا می‌آید؟ آیا از `schedules` قبلی S3 یا ورودی دستی؟
7. **پیکربندی ۵۰-۵۰۰ سناریو:** آیا کاربر باید تعداد را انتخاب کند یا سیستم بر اساس اندازه بخش (مثلاً ۲۰ پرسنل → ۱۰۰ سناریو) خودکار تعیین کند؟
8. **UNDERSTAFFED Blank:** در UI فعلی OFF نمایش داده می‌شود. آیا باید یک حالت جدید `UNFILLED` با رنگ خاکستری معرفی شود؟

**پیشنهاد موقت (برای ادامه فاز ۱ بدون بلوکه شدن):**
- Sleep OFF = روز بعد الزاماً OFF یا L، مگر Human Veto با هشدار قرمز.
- ۳۲ ساعت = جمع `SHIFT_HOURS` واقعی (M=6.5, N=12.5...) در بازه بدون OFF طولانی (>=16h).
- مرخصی پیوسته = اگر روز قبل L بوده و روز جاری هم L درخواستی دارد → در حال اجراست.
- `isEssential=true + درخواست OFF` + تایید سرپرستار = Hard OFF، بقیه Soft.
- کارکنان ثابت = سابقه ۲۰ روز گذشته فقط M و position supervisor/staff.
- Memory Freeze = از `schedules[prevMonthKey]` خوانده شود اگر وجود دارد.
- تعداد سناریو پیش‌فرض ۱۰۰، قابل تنظیم ۵۰-۵۰۰.
- `UNDERSTAFFED` = `''` یا `'--'` با استایل قرمز چشمک‌زن + هشدار CRITICAL.

---

### ۱۱. نتیجه‌گیری و توصیه نهایی

**وضعیت فعلی:** سیستم پایدار، تست‌شده، قابل اتکا برای پرستاران است. موتور قدیمی اگرچه ساده است اما قوانین حقوقی را درست محاسبه می‌کند.

**خطر بزرگ:** اگر موتور چندسناریویی بدون Worker و بدون Validation لایه‌ای Level A اضافه شود، هم UI فریز می‌شود و هم ایمنی بیمار به خطر می‌افتد.

**مسیر پیشنهادی:**
1. **همین PR:** اسکلت `domain/solver/` + Worker + Scoring + Arena Types را اضافه کن (بدون تغییر رفتار فعلی) — ریسک صفر.
2. **PR بعدی (فاز ۱-۲):** پیاده‌سازی Pure Validation Level A و تست Exhaustive.
3. **PR سوم (فاز ۳-۴):** فعال‌سازی Worker و تولید سناریو با Feature Flag خاموش به صورت پیش‌فرض.
4. **PR چهارم (فاز ۵-۶):** Auto-Repair + Tabu + Arena Selector.
5. **PR پنجم (فاز ۷-۹):** UI Arena فارسی + تراکنش اتمیک Prisma + Human Veto.

**برآورد زمانی:** ۶-۸ هفته با رویکرد تدریجی، بدون اختلال در سرویس داخلی.

**چک‌لیست Do No Harm رعایت شد:**
- [x] هیچ ماژول پایدار حقوقی بازنویسی نشد.
- [x] رفتار UI موجود حفظ شد.
- [x] طرح بدون Big Bang است.
- [x] تراکنش اتمیک در نظر گرفته شد.
- [x] ایمنی بیمار اولویت اول است.

---

### ۱۲. خروجی‌های تحویلی این فاز (همین Branch)

- [x] این سند ممیزی و طرح مهاجرت
- [x] اسکلت `domain/solver/` با DTOها و قراردادهای خالص (English Code, Persian Comments ممنوع — فقط English)
- [x] Worker Orchestrator با Cancellation Token و UI Lock
- [x] Scoring Engine با وزن‌های ۴۰/۲۵/۱۵/۱۰/۱۰
- [x] Arena Selector با ۵ دسته‌بندی
- [x] Auto-Repair Engine اسکلت با Tabu List و Chain Swap
- [x] هوک `useMultiScenarioSolver` برای UI
- [x] کامپوننت‌های پیشرفت و مقایسه Arena (Persian UI)

**منبع کد، نام متغیرها و کامنت‌های فنی انگلیسی باقی می‌مانند — فقط گزارش‌ها و UI فارسی هستند.**

---

*پایان گزارش — آماده برای بررسی سرپرستار فنی*
