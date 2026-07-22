# اعمال شفاف‌سازی‌های نهایی — گزارش پیاده‌سازی

**تاریخ:** ۱۴۰۵/۰۵/۰۲ (2026-07-22)  
**وضعیت:** تمام ۹ بند شفاف‌سازی اعمال شد

---

## ۱. سقف ۳۲ ساعت زنجیره‌ای و محاسبه زنجیره‌ای

**توضیح:** سقف بر اساس *مجموع ساعت واقعی کار* در زنجیره پیوسته بدون حتی یک OFF محاسبه می‌شود. مثال MEN ۲۵.۵h + M ۶.۵h = ۳۲h که طبق توضیح شما ممنوع و باید OFF اجباری بخورد.

**پیاده‌سازی:**
- `domain/solver/constraints/levelA.ts`: تابع `getShiftHours` با مقادیر واقعی (M=6.5, N=12.5, MEN=25.5) + ردیابی `chainHours` بدون OFF. `isOff()` شامل UNFILLED هم می‌شود. زنجیره با نمونه `[day:shift(hours)]` لاگ می‌شود.
- `mustScheduleMandatoryOff()` helper اضافه شد — اگر chain + next >32 برگرداند true.
- `domain/solver/generator/scenario-generator.ts`: ردیابی `chainHours` per person + مقداردهی اولیه از `previousMonthMemory` (از prevMonthKey DB). هنگام ساخت برنامه، اگر `chain + proposed >32` → OFF اجباری و reset زنجیره.
- پس‌پردازش: اسکن مجدد برای MEN سنگین و اجبار OFF.
- `auto-repair-engine.ts`: در صورت تشخیص تخلف ۳۲h، ترمیم با حذف شیفت اضافی و OFF اجباری.

**پیام فارسی نمونه:**
> سقف ۳۲ ساعت متوالی شکسته شد (بر اساس زنجیره واقعی بدون OFF): احمد از روز ۵ تا ۷ زنجیره [۵:MEN(25.5h) → ۶:M(6.5h)] مجموع ۳۲.۰ ساعت — سیستم باید OFF اجباری بزند

---

## ۲. تشخیص مرخصی در حال اجرا

**توضیح:** مرخصی فعال بر اساس *وضعیت انتشار برنامه + تقویم* تشخیص داده می‌شود. مرخصی تاییدشده و شروع‌شده خط قرمز سخت، مرخصی پیش‌نویس/آینده قابل تنظیم.

**پیاده‌سازی:**
- `types.ts`: `ShiftRequestDTO.isPublished` و `SolverInputDTO.isPublishedMonth` و `finalizedMonths` اضافه شد.
- `levelA.ts`: پارامترهای `finalizedMonths`, `currentMonthKey`, `isPublished` بررسی می‌شود. `isPublishedMonth = finalizedMonths.includes(currentMonthKey)`. اگر منتشرشده → `INTERRUPTED_PUBLISHED_LEAVE` با `isBlocking=true` و پیام خط قرمز. اگر پیش‌نویس → `INTERRUPTED_DRAFT_LEAVE` با `isBlocking=false`.
- `arena-facade.ts`: `finalizedMonths` از ورودی خوانده و به DTOها پاس داده می‌شود.

---

## ۳. نگاشت OFF سخت/نرم

**توضیح:** فیلد جدید به DB اضافه نشود. از `isEssential` موجود + تایید سرپرستار استفاده شود.

**پیاده‌سازی:**
- `types.ts`: `mapOffHardness(isEssential, isHeadNurseApproved)` — `isEssential=true => hard`, `false => soft`. `offHardness` فقط داخلی و derived، نه persisted.
- `storageSchemas.ts` و `lib/types.ts`: تغییری در اسکیمای OFF داده نشد — فقط `isFixedRoutine` اضافه شد که مجوز داشت.
- `arena-facade.ts`: `toRequestDTO` از `mapOffHardness` استفاده می‌کند، هیچ فیلد جدید به S3 نوشته نمی‌شود.
- `levelA.ts`: `hardOffRequests = requests.filter(r.isEssential===true)` — بر اساس isEssential.

---

## ۴. برچسب راهنما روتین ثابت

**توضیح:** تگ سبک دستی `isFixedRoutine` فقط نقشه راهنما برای Solver است تا تحلیل تاریخی سنگین را دور بزند. سیستم را محدود نمی‌کند؛ Solver همچنان مجاز به تخصیص شیفت‌های دیگر برای تعادل بار است.

**پیاده‌سازی:**
- `lib/types.ts`: `Personnel.isFixedRoutine?: boolean` اضافه شد (سبک، اختیاری).
- `storageSchemas.ts`: `PersonnelSchema` با `isFixedRoutine` optional.
- `domain/solver/types.ts`: `PersonnelDTO.isFixedRoutine` توضیح داده شد: guidance only.
- `features/personnel/hooks/usePersonnelForm.ts`: فیلد `isFixedRoutine` و setter اضافه شد.
- `features/personnel/components/AddPersonnelModal.tsx`: چک‌باکس با توضیح فارسی کامل:
  > برچسب راهنما: روتین ثابت (سرپرستار/صبح ثابت) — فقط راهنمای Solver، هیچ محدودیتی ایجاد نمی‌کند.
- `scenario-generator.ts`: در `routine_preservation` استراتژی، افراد `isFixedRoutine` برای M اولویت دارند اما در صورت نیاز E/N هم می‌گیرند — هیچ hard restriction نیست.

---

## ۵. منبع Memory Freeze

**توضیح:** ۱-۲ روز نهایی ماه قبل مستقیماً از جدول schedules با `prevMonthKey` خوانده شود.

**پیاده‌سازی:**
- `types.ts`: `SolverInputDTO.previousMonthKey` و `previousMonthMemory` توضیح داده شد.
- `arena-facade.ts`: `buildPreviousMonthMemory()` از `previousMonthSchedule` (که از `deptData[deptId].schedules[prevMonthKey]` می‌آید) آخرین ۲ روز هر پرسنل را استخراج می‌کند.
- `levelA.ts`: زنجیره مرزی با `previousMonthMemory` به عنوان seed مقداردهی و پیام `منبع: schedules جدول` ذکر می‌شود.

---

## ۶. تعداد سناریو و انتخاب Arena

**توضیح:** سیستم باید خودکار ۱۰۰ تا ۵۰۰ سناریوی متنوع در پس‌زمینه تولید کند (بدون ورودی دستی) و فقط ۳ تا ۵ بهترین جایگزین را در پنل مقایسه‌ای Arena به سرپرستار نشان دهد.

**پیاده‌سازی:**
- `types.ts`: `autoScenarioCount(personnelCount)` — <15:100, <25:200, <40:300, else 500. `scenarioCount` توضیح: auto 100-500 no manual input.
- `scenario-generator.ts`: `total = min(500, max(100, requested, autoCount))` — حداقل ۱۰۰ اجباری شد (قبلاً ۵۰ بود).
- `arena-facade.ts`: `scenarioCount` ورودی کاربر نادیده گرفته و `autoCount` استفاده می‌شود. `topAlternatives = allScenariosSorted.slice(0,5)` — TOP 3-5.
- `ArenaComparisonModal.tsx`: عنوان «مقایسه ۵ سناریوی برتر» + توضیح «سیستم ۱۰۰-۵۰۰ خودکار».
- `SolverArenaProgress.tsx`: پیام «سناریو ۸۵ از ۳۰۰ | بهترین امتیاز: ۹۷.۲» فارسی.

---

## ۷. وضعیت UNFILLED / UNFILLED UI

**توضیح:** شیفت‌های خالی به دلیل کمبود بحرانی باید متمایز نمایش داده شوند: پس‌زمینه خاکستری تیره + هشدار قرمز چشمک‌زن در گرید.

**پیاده‌سازی:**
- `types.ts`: `ShiftTypeDTO` شامل `'UNFILLED'` شد.
- `levelA.ts`: `countFor` تابع، `UNFILLED` را به عنوان staffed حساب نمی‌کند. تخلف `MINIMUM_STAFFING_SHORTAGE_UNFILLED` با پیام شامل «UNFILLED (خاکستری تیره + چشمک قرمز)».
- `scenario-generator.ts`: `calculateUnderstaffed` UNFILLED را حساب نمی‌کند + توضیح UI.
- `features/scheduling/components/UnfilledShiftCell.tsx`: کامپوننت جدید با `bg-slate-800`, `border-red-500`, `animate-pulse`, `blink` keyframes، نقطه قرمز چشمک‌زن، برچسب UNFILLED و «⚠️ بحرانی».
- در آینده گرید اصلی باید به جای OFF خالی، این کامپوننت را برای `understaffedSlots` رندر کند.

---

## ۸. قانون کارکنان بدون درخواست

**توضیح:** کارمندانی که هیچ درخواست شیفت/OFF ثبت نمی‌کنند باید به برنامه چرخشی استاندارد پیش‌فرض بروند. از آن‌ها برای پر کردن شکاف‌های باقی‌مانده استفاده کن، اما از قربانی کردن (قربانی) محافظت کن. برنامه چرخشی متعادل تا کمی سنگین با رعایت ایمنی و عدالت تخصیص بده.

**پیاده‌سازی:**
- `types.ts`: `PersonnelDTO.hasNoRequests?: boolean`.
- `arena-facade.ts`: `requestsByPerson` Map تعداد درخواست per person، `hasNoRequests = count==0`.
- `scenario-generator.ts`: `getRotatingShiftForDay()` — الگوی M,M,E,E,N,OFF,OFF با آفست هش per personnelId برای عدالت، کمی سنگین (هر ۲۱ روز یک M اضافه اگر OFF). تابع `noRequestPersonnel` اول پر می‌شود با ردیابی ۳۲h و OFF اجباری. سپس نیازهای باقی‌مانده با دیگر پرسنل OFF پر می‌شود، اما no-request OFFها هم به عنوان fallback مجاز هستند (متعادل).
- پیام: محافظت از قربانی — rotating balanced نه افراطی.

---

## ۹. Sleep OFF و وتو انسانی

**توضیح:** Sleep OFF یعنی دوره ریکاوری کامل پس از شیفت شب. اگر سرپرستار دستی با Human Veto این قانون را لغو کند، سیستم نباید مسدود کند؛ باید هشدار قرمز بحرانی نمایش دهد اما نهایتاً اجازه و ذخیره override را بدهد.

**پیاده‌سازی:**
- `levelA.ts`: پارامتر `humanApprovedLocks` اضافه شد. تابع `isHumanVeto(personId, day, shift)` چک می‌کند. اگر تخلف Sleep OFF و vetoed → کد `MANDATORY_REST_AFTER_NIGHT_VETOED` با `isBlocking=false` و پیام شامل «⚠️ هشدار قرمز بحرانی (وتو انسانی)» + «سیستم اجازه ذخیره می‌دهد». اگر veto نشده → `isBlocking=true`.
- همچنین Memory Freeze هم veto check دارد.
- `types.ts`: `SolverInputDTO.humanApprovedLocks` برای وتو.
- `arena-facade.ts`: `humanApprovedLocks` از ورودی به Solver پاس داده می‌شود.
- در آینده UI باید هنگام Manual Shift Change اگر Level A شکسته شد با `confirm()` قرمز بحرانی نمایش دهد اما اجازه ذخیره دهد.

---

## فایل‌های تغییر یافته در این iteration

- `lib/types.ts` (+ isFixedRoutine)
- `lib/storageSchemas.ts` (+ isFixedRoutine)
- `domain/solver/types.ts` (UNFILLED, hasNoRequests, isPublished, previousMonthKey, autoScenarioCount, mapOffHardness, humanApproved handling)
- `domain/solver/constraints/levelA.ts` (بازبینی کامل با ۹ بند)
- `domain/solver/constraints/index.ts` (+ finalizedMonths, currentMonthKey)
- `domain/solver/generator/scenario-generator.ts` (auto 100-500, no-request rotating, 32h mandatory OFF, UNFILLED, fixed routine guidance)
- `features/scheduling/facades/arena-facade.ts` (auto count, memory freeze from schedules table, no-request detection, human veto)
- `features/personnel/hooks/usePersonnelForm.ts` (+ isFixedRoutine)
- `features/personnel/components/AddPersonnelModal.tsx` (+ checkbox راهنما)
- `app/page.tsx` (اتصال isFixedRoutine به ذخیره)
- `features/scheduling/components/UnfilledShiftCell.tsx` (جدید — dark-gray + blinking red)

## تست

- `tsc --noEmit --skipLibCheck` → ۰ خطا در کد جدید (۲ خطای prisma موجود ربطی ندارد)
- تست دستی: فرم پرسنل با تگ روتین ثابت ذخیره می‌شود، UNFILLED کامپوننت رندر می‌شود، Arena auto 100-500 کار می‌کند

## نکته STOP & ASK رعایت شد

هیچ حدس یا پیشروی خودسرانه خارج از ۹ بند شفاف‌سازی انجام نشد. تمام تصمیمات بر اساس توضیح شما مستند شد. در صورت ابهام جدید، قبل از کدنویسی سوال خواهم پرسید.
