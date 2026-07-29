import type { ProgressPhase } from '../../domain/progress/task-progress';

/**
 * ProgressPhases — تعریف مراحل واقعی هر عملیات سنگین سامانه
 *
 * وزن‌ها بر پایهٔ سهم واقعی هر مرحله از زمان کل تنظیم شده‌اند و مقدار
 * estimateMs یک برآورد اولیهٔ محافظه‌کارانه است؛ پس از نخستین اجرا، مدت واقعی
 * هر مرحله یاد گرفته و در localStorage نگه داشته می‌شود (useTaskProgress).
 *
 * قاعدهٔ مهم: هر مرحله در کد باید دقیقاً پیش از آغاز کار واقعی همان مرحله با
 * `beginPhase(id)` اعلام شود تا درصد نمایش‌داده‌شده با پردازش هم‌گام بماند.
 */

/**
 * تولید سه برنامهٔ پیشنهادی توسط موتور هوشمند (سنگین‌ترین عملیات سامانه).
 *
 * برآوردهای اولیه بر پایهٔ اندازه‌گیری واقعی روی یک بخش نمونه (۱۱ پرستار، کل ماه)
 * تنظیم شده‌اند؛ سه سناریو بخش عمدهٔ زمان را می‌گیرند. پس از نخستین اجرا، مدت
 * واقعی همین مراحل یاد گرفته و جایگزین این اعداد می‌شود.
 */
export const SOLVER_PHASES: ProgressPhase[] = [
  { id: 'prepare', label: 'آماده‌سازی داده‌های پرسنل، درخواست‌ها و تقویم', weight: 8, estimateMs: 700 },
  { id: 'scenario-a', label: 'تولید سناریوی A · درخواست‌محور', weight: 26, estimateMs: 6_500 },
  { id: 'scenario-b', label: 'تولید سناریوی B · عدالت‌محور', weight: 26, estimateMs: 6_500 },
  { id: 'scenario-c', label: 'تولید سناریوی C · تلفیقی', weight: 26, estimateMs: 6_500 },
  { id: 'scoring', label: 'امتیازدهی، سنجش اختلاف و بررسی هشدارها', weight: 8, estimateMs: 900 },
  { id: 'persist', label: 'ثبت برنامه‌ها در فضای ذخیره‌سازی امن', weight: 6, estimateMs: 1_100 },
];

/** ذخیره‌سازی تغییرات در فضای ابری (Arvan S3). */
export const SAVE_PHASES: ProgressPhase[] = [
  { id: 'validate', label: 'اعتبارسنجی و آماده‌سازی تغییرات', weight: 20, estimateMs: 350 },
  { id: 'upload', label: 'نوشتن امن داده‌ها در فضای ذخیره‌سازی', weight: 60, estimateMs: 1_400 },
  { id: 'sync', label: 'هم‌گام‌سازی نهایی وضعیت سامانه', weight: 20, estimateMs: 450 },
];

/** پردازش متن درخواست‌ها با هوش مصنوعی. */
export const AI_PHASES: ProgressPhase[] = [
  { id: 'send', label: 'ارسال متن درخواست به موتور هوش مصنوعی', weight: 20, estimateMs: 700 },
  { id: 'analyze', label: 'تحلیل زبانی و استخراج درخواست‌های شیفت', weight: 55, estimateMs: 3_000 },
  { id: 'normalize', label: 'اعتبارسنجی و آماده‌سازی نتایج', weight: 25, estimateMs: 800 },
];

/** ورود به سامانه و احراز هویت. */
export const LOGIN_PHASES: ProgressPhase[] = [
  { id: 'validate', label: 'بررسی کد ملی و رمز عبور', weight: 30, estimateMs: 500 },
  { id: 'authenticate', label: 'احراز هویت امن در سرور', weight: 45, estimateMs: 1_100 },
  { id: 'prepare', label: 'آماده‌سازی محیط کاربری شما', weight: 25, estimateMs: 600 },
];

/** بارگذاری اولیهٔ سامانه: نشست، تقویم رسمی و دادهٔ بخش. */
export const BOOT_PHASES: ProgressPhase[] = [
  { id: 'session', label: 'بررسی نشست امن کاربر', weight: 22, estimateMs: 700 },
  { id: 'calendar', label: 'همگام‌سازی تقویم رسمی و تعطیلات کشور', weight: 30, estimateMs: 1_200 },
  { id: 'department', label: 'دریافت اطلاعات بخش، پرسنل و درخواست‌ها', weight: 34, estimateMs: 1_600 },
  { id: 'render', label: 'چیدمان داشبورد و آماده‌سازی نمایش', weight: 14, estimateMs: 500 },
];
