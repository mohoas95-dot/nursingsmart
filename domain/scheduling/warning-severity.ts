/**
 * WarningSeverity — Domain Layer (Pure Functions)
 *
 * RESPONSIBILITY:
 *   مدل سطح‌بندی هشدارهای سیستم (سطح A/B/C) و رفتار آن برای پرسنل قفل‌شده.
 *
 *   ── قرارداد معماری (بخش ۶ سند بازطراحی) ──────────────────────────────────
 *   · هشدارهای سطح A (Critical/bحرانی) هرگز مخفی نمی‌شوند و فقط با «رفع مشکل»
 *     یا «نادیده‌گرفتن توسط سرپرستار» ناپدید می‌شوند — حتی برای پرسنل قفل‌شده.
 *   · هشدارهای سطح B و C برای پرسنل قفل‌شده تولید/نمایش داده نمی‌شوند و در
 *     امتیازدهی سناریوها هم اثری ندارند؛ قفل کردن یک پرسنل یعنی تأیید مدیریتی
 *     تصمیم‌های غیربحرانی او.
 *   ─────────────────────────────────────────────────────────────────────────
 *
 *   نکتهٔ مهم: این ماژول هیچ قانون جدیدی به موتور زمان‌بندی اضافه نمی‌کد؛ فقط
 *   هشدارهایی را که موتورهای موجود (solver / verifyCoverageAndLeaders) تولید
 *   می‌کنند «رده‌بندی» و بر اساس وضعیت قفل «مصرف» می‌کند (Fail-Safe: هر هشدار
 *   ناشناخته بحرانی محسوب می‌شود تا هیچ هشدار قانون ساختی بی‌صدا مخفی نماند).
 *
 * PURE: بدون وابستگی به React، Next.js یا I/O.
 */

import type { Personnel } from '../../lib/types';
import { isPersonnelRowLocked } from '../guards/shift-edit-guards';

// ============================================================================
// Severity levels
// ============================================================================

/**
 * سطح هشدار:
 *  - 'A': بحرانی — نقض قوانین اجباری، کمبود نیروی ایمن، نقض سقف شیفت پشت‌سرهم،
 *    استراحت اجباری، نبود سرشیفت و هر قانون سخت از پیش‌تعریف‌شدهٔ سیستم.
 *  - 'B': قابل‌تایید مدیریتی — مربوط به یک پرسنل مشخص (عدم رعایت درخواست، سقف
 *    آف متوالی، پیوستگی مرخصی، شیفت تک).
 *  - 'C': اطلاع‌رسانی — اعلان جایگزینی/اصلاح خودکار انجام‌شده برای یک پرسنل.
 */
export type WarningSeverity = 'A' | 'B' | 'C';

/**
 * پیشوندهای بحرانی — همان قوانین سخت موجود سیستم
 * (`HARD_WARNING_PREFIXES` در lib/scoring) + پیام کمبود نیروی باقی‌ماندهٔ solver.
 * این فهرست طبق مستندات فعلی سیستم بحرانی تعریف می‌شود و در این بازطراحی
 * تغییری نمی‌کند.
 */
const CRITICAL_WARNING_PREFIXES: ReadonlyArray<string> = [
  'Coverage Shortage:', // کمبود نیروی ایمن
  'Overstaffing:', // نیروی مازاد (قانون سخت فعلی سیستم)
  'Missing Shift Leader:', // نبود سرشیفت
  'Max Consecutive:', // نقض سقف شیفت‌های پشت‌سرهم
  'Mandatory Rest:', // نقض استراحت اجباری
];

/** پیشوندهای سطح B — هشدارهای مدیریت‌پذیرِ متعلق به یک پرسنل مشخص. */
const MODERATE_WARNING_PREFIXES: ReadonlyArray<string> = [
  'Mismatched Request:', // عدم رعایت درخواست ثبت‌شدهٔ پرسنل
  'Consecutive OFFs:', // عدم رعایت سقف آف متوالی
  'Leave Continuity:', // نقض پیوستگی مرخصی
  'Isolated Shift:', // شیفت تک در میان الگوی متفاوت
];

/** پیشوندهای سطح C — اعلان‌های اصلاح/جایگزینی خودکار (اطلاع‌رسانی). */
const MINOR_WARNING_PREFIXES: ReadonlyArray<string> = [
  'Isolated Shift Fixed:', // شیفت تک به‌صورت خودکار منتقل شد
  'OFF Removed:', // آف/مرخصی به‌خاطر قانون توالی به‌صورت خودکار حذف شد
];

/**
 * کلیدواژه‌های بحرانیِ بدون پیشوند ثابت (مثل پیام باقی‌ماندهٔ کمبود نیروی
 * solver که با عبارت «کمبود نیرو» شروع/دیده می‌شود).
 */
const CRITICAL_WARNING_KEYWORDS: ReadonlyArray<string> = ['کمبود نیرو'];

export const WARNING_SEVERITY_LABELS: Record<WarningSeverity, string> = {
  A: 'بحرانی',
  B: 'قابل تایید مدیریتی',
  C: 'اطلاع‌رسانی',
};

/**
 * رده‌بندی یک متن هشدار به سطح A/B/C.
 *
 * ترتیب ارزیابی مهم است: ابتدا پیشوندهای بحرانی، سپس C، بعد B، سپس کلیدواژه‌های
 * بحرانی، و در پایان **پیش‌فرض امن A** تا هیچ هشدار ناشناخته‌ای (مثل قوانین
 * بحرانی آینده یا قدیمیِ مهاجرت‌نشده) بی‌صدا برای پرسنل قفل‌شده مخفی نشود.
 */
export function classifyWarningSeverity(warning: string): WarningSeverity {
  for (const prefix of CRITICAL_WARNING_PREFIXES) {
    if (warning.startsWith(prefix)) return 'A';
  }
  for (const prefix of MINOR_WARNING_PREFIXES) {
    if (warning.startsWith(prefix)) return 'C';
  }
  for (const prefix of MODERATE_WARNING_PREFIXES) {
    if (warning.startsWith(prefix)) return 'B';
  }
  for (const keyword of CRITICAL_WARNING_KEYWORDS) {
    if (warning.includes(keyword)) return 'A';
  }
  return 'A';
}

export function isCriticalWarning(warning: string): boolean {
  return classifyWarningSeverity(warning) === 'A';
}

// ============================================================================
// Attribution — نسبت‌دادن هشدار به پرسنل
// ============================================================================

/**
 * شناسهٔ تمام پرسنلی که نام کاملشان («نام + نام‌خانوادگی») در متن هشدار دیده
 * می‌شود. برخلاف تجمیع‌گر قدیمی که اولین تطابق را برمی‌داشت، همهٔ تطابق‌ها
 * برگردانده می‌شود چون قانون حذف هشدارِ قفل‌شده فقط وقتی قابل اجراست که **همهٔ**
 * افراد نام‌برده‌شده قفل باشند.
 */
export function extractWarningPersonnelIds(
  warning: string,
  personnelList: ReadonlyArray<Personnel>
): string[] {
  const ids: string[] = [];
  for (const person of personnelList) {
    const fullName = `${person.firstName} ${person.lastName}`;
    if (warning.includes(fullName)) {
      ids.push(person.id);
    }
  }
  return ids;
}

// ============================================================================
// Suppression rule for locked personnel
// ============================================================================

/**
 * اعمال قرارداد سطح‌بندی برای پرسنل قفل‌شده:
 *
 *   · سطح A: هرگز حذف نمی‌شود (حتی اگر فقط پرسنل قفل‌شده را نام ببرد).
 *   · سطح B/C: فقط وقتی حذف می‌شود که **تمام** افراد نام‌برده‌شده در هشدار قفل
 *     باشند. اگر حتی یک نفر آزاد در متن هشدار باشد، هشدار می‌ماند.
 *   · هشدار بدون نسبت پرسنلی (عمومی) همیشه می‌ماند (Fail-Safe).
 *
 * با این کار «هشدارهای سطح B و C برای پرسنل قفل‌شده دیگر تولید نمی‌شوند» — از
 * منظر مصرف‌کننده (نمایش، ذخیره، امتیازدهی) عملاً تولیدی برای آن‌ها ثبت
 * نمی‌شود، بدون آنکه منطق تولید داخل موتور زمان‌بندی دست‌کاری شود.
 */
export function filterWarningsForLockedPersonnel(
  warnings: ReadonlyArray<string>,
  personnelList: ReadonlyArray<Personnel>,
  lockedRows: ReadonlyArray<string>
): string[] {
  if (lockedRows.length === 0) return [...warnings];

  return warnings.filter(warning => {
    if (classifyWarningSeverity(warning) === 'A') return true;
    const mentionedIds = extractWarningPersonnelIds(warning, personnelList);
    if (mentionedIds.length === 0) return true;
    return mentionedIds.some(id => !isPersonnelRowLocked(id, lockedRows));
  });
}

/**
 * خلاصهٔ JSON‌پذیر از وضعیت سطح‌بندی یک فهرست هشدار — برای لاگ و گزارش‌گری.
 */
export function summarizeWarningsBySeverity(
  warnings: ReadonlyArray<string>
): Record<WarningSeverity, number> {
  const summary: Record<WarningSeverity, number> = { A: 0, B: 0, C: 0 };
  for (const warning of warnings) {
    summary[classifyWarningSeverity(warning)] += 1;
  }
  return summary;
}
