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
  { id: 'prepare', label: 'آماده‌سازی داده‌ها', weight: 8, estimateMs: 700 },
  { id: 'scenario-a', label: 'سناریوی A · درخواست‌محور', weight: 26, estimateMs: 6_500 },
  { id: 'scenario-b', label: 'سناریوی B · عدالت‌محور', weight: 26, estimateMs: 6_500 },
  { id: 'scenario-c', label: 'سناریوی C · تلفیقی', weight: 26, estimateMs: 6_500 },
  { id: 'scoring', label: 'امتیازدهی و بررسی هشدارها', weight: 8, estimateMs: 900 },
  { id: 'persist', label: 'ثبت برنامه‌ها', weight: 6, estimateMs: 1_100 },
];

/** ذخیره‌سازی تغییرات در فضای ابری (Arvan S3). */
export const SAVE_PHASES: ProgressPhase[] = [
  { id: 'validate', label: 'آماده‌سازی تغییرات', weight: 20, estimateMs: 350 },
  { id: 'upload', label: 'نوشتن داده‌ها در فضای ابری', weight: 60, estimateMs: 1_400 },
  { id: 'sync', label: 'هم‌گام‌سازی نهایی', weight: 20, estimateMs: 450 },
];

/** پردازش متن درخواست‌ها با هوش مصنوعی. */
export const AI_PHASES: ProgressPhase[] = [
  { id: 'send', label: 'ارسال متن درخواست', weight: 20, estimateMs: 700 },
  { id: 'analyze', label: 'تحلیل و استخراج درخواست‌ها', weight: 55, estimateMs: 3_000 },
  { id: 'normalize', label: 'آماده‌سازی نتایج', weight: 25, estimateMs: 800 },
];

// نکته: صفحهٔ ورود به سامانه و صفحات راه‌اندازی اولیه عمداً نوار درصدی ندارند.
// آن انتظارها کوتاه‌اند و اسپینر سبک، تجربهٔ سریع‌تری می‌دهد؛ نوار درصدی فقط
// برای عملیات واقعاً طولانی (تولید برنامه، ذخیره‌سازی، پردازش هوش مصنوعی) است.
