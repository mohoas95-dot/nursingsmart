/**
 * RosterInheritance — Domain Layer (Pure Functions)
 *
 * RESPONSIBILITY:
 *   پیاده‌سازی اصل معماری «برنامه مبنا = تنها منبع حقیقت سیستم».
 *
 *   ── اصل معماری ────────────────────────────────────────────────────────────
 *   برنامهٔ مبنا (Working Roster) تنها نسخهٔ مرجع سیستم است. سناریوهای A/B/C
 *   صرفاً «پیشنهاد»های موتور هوشمند هستند که از روی برنامهٔ مبنا ساخته می‌شوند
 *   و هرگز مرجع را تغییر نمی‌دهند. قفل ماهانه متعلق به «پرسنل» است نه سناریو:
 *   ردیف پرسنل قفل‌شده در همهٔ سناریوها همیشه از همان برنامهٔ مبنا به‌صورت
 *   زنده ارث‌بری می‌شود، نه اینکه یک نسخهٔ مستقل از آن کپی شود.
 *   ─────────────────────────────────────────────────────────────────────────
 *
 *   این ماژول سه قرارداد اصلی را در قالب تابع خالص ارائه می‌دهد:
 *
 *   ۱) ارث‌بری قفل‌ها از برنامهٔ مبنا (inheritLockedRowsFromBase /
 *      overlayLockedInheritance): نمایش هر سناریو = تخصیص‌های سناریو + ردیف
 *      قفل‌شده که مستقیماً از برنامهٔ مبنا خوانده می‌شود.
 *
 *   ۲) محاسبهٔ Diff/Patch نسبت به برنامهٔ مبنا (diffAgainstBaseRoster /
 *      partitionDiffByLocks): تنها سلول‌هایی شناسایی می‌شوند که نسبت به مرجع
 *      تغییر کرده‌اند؛ تغییرهای مربوط به پرسنل قفل‌شده همین‌جا «رد» می‌شوند.
 *
 *   ۳) Merge مرجع‌محور (computeScenarioMerge): اعمال یک سناریو روی برنامهٔ
 *      مبنا = برنامهٔ مبنا + فقط تغییرهای مجاز همان سناریو؛ بدون بازنویسی
 *      کامل و بدون دست‌خوردگی پرسنل قفل‌شده یا خارج از گروه هدف.
 *
 * PURE: بدون وابستگی به React، Next.js یا I/O.
 *
 * نکتهٔ مهم: هیچ‌کدام از قوانین موتور زمان‌بندی، امتیازدهی یا حقوق و دستمزد در
 * این ماژول تغییر نکرده است؛ این فایل فقط «منشأ و مسیر جریان داده» را تعریف
 * می‌کند.
 */

import type { JobGroup, ShiftType, MonthlySchedule } from '../types';
import type { Personnel } from '../../lib/types';
import { isPersonnelRowLocked } from '../guards/shift-edit-guards';

// ============================================================================
// Types
// ============================================================================

/** یک تغییر سطح‌سلول: شیفت یک پرسنل در یک روز نسبت به برنامهٔ مبنا. */
export interface RosterDiffEntry {
  personnelId: string;
  day: number;
  fromShift: ShiftType;
  toShift: ShiftType;
}

export interface RosterDiffOptions {
  /** تعداد روزهای ماه (۱ تا ۳۱). */
  totalDays: number;
  /**
   * فهرست شناسه‌های پرسنلی که Diff فقط برای آن‌ها محاسبه می‌شود (مثلاً پرسنل
   * آزادِ گروه هدف). وقتی تعیین نشود، همهٔ ردیف‌های مشترک دو برنامه بررسی
   * می‌شوند.
   */
  scopePersonnelIds?: ReadonlyArray<string>;
}

export interface RosterDiffPartition {
  /** تغییرهای قابل‌اعمال (پرسنل آزاد). */
  applicable: RosterDiffEntry[];
  /** تغییرهای ردشده (پرسنل قفل‌شده) — هرگز اعمال نمی‌شوند. */
  rejected: RosterDiffEntry[];
}

export interface ScenarioMergeOptions {
  /** شناسهٔ پرسنل قفل‌شدهٔ ماهانه (قفل متعلق به پرسنل است نه سناریو). */
  lockedRows: ReadonlyArray<string>;
  /** فهرست کامل پرسنل برای تعیین دامنهٔ گروه هدف. */
  personnelList: ReadonlyArray<Personnel>;
  /**
   * گروه هدف سناریو. Merge فقط ردیف‌های همین گروه را از سناریو می‌خواند؛
   * ردیف‌های گروه دیگر هرگونه‌که در برنامهٔ مبنا هستند باقی می‌مانند.
   * اگر تعیین نشود، روی همهٔ ردیف‌های مشترک اعمال می‌شود.
   */
  jobGroup?: JobGroup;
  /** تعداد روزهای ماه. */
  totalDays: number;
}

export interface ScenarioMergeResult {
  /** تخصیص‌های نهایی برنامهٔ مبنا پس از اعمال Patch. */
  assignments: Record<string, Record<number, ShiftType>>;
  /** کل Diff محاسبه‌شدهٔ سناریو نسبت به برنامهٔ مبنا (در دامنهٔ موردنظر). */
  diff: RosterDiffEntry[];
  /** تغییرهایی که واقعاً روی برنامهٔ مبنا اعمال شد (پرسنل آزاد). */
  appliedChanges: RosterDiffEntry[];
  /** تغییرهایی که به‌دلیل قفل بودن پرسنل رد شدند. */
  rejectedChanges: RosterDiffEntry[];
}

type AssignmentReadMap = Readonly<Record<string, Readonly<Record<number, ShiftType>>>>;

// ============================================================================
// ۱) ارث‌بری قفل‌ها از برنامهٔ مبنا
// ============================================================================

/**
 * ردیف ماهانهٔ پرسنل قفل‌شده — دقیقاً همان‌طور که در برنامهٔ مبنا آمده است.
 *
 * این تابع تنها «منبع مجاز» خواندن شیفت پرسنل قفل‌شده برای سناریوهاست؛ یعنی
 * دادهٔ قفل‌شده همیشه از مرجع خوانده می‌شود و هیچ نسخهٔ مستقلی از آن ساخته
 * نمی‌شود.
 */
export function inheritLockedRowsFromBase(
  baseAssignments: AssignmentReadMap | null | undefined,
  lockedRows: ReadonlyArray<string>
): Record<string, Record<number, ShiftType>> {
  const inherited: Record<string, Record<number, ShiftType>> = {};
  if (!baseAssignments) return inherited;

  for (const personnelId of lockedRows) {
    const row = baseAssignments[personnelId];
    if (row) {
      inherited[personnelId] = { ...(row as Record<number, ShiftType>) };
    }
  }
  return inherited;
}

/**
 * دیدگاه (view) ارث‌بری از یک سناریو: تخصیص‌های سناریو **به‌جز** ردیف‌های
 * قفل‌شده که این‌جا و فقط از برنامهٔ مبنا خوانده می‌شوند.
 *
 * خروجی هرگز ورودی‌ها را تغییر نمی‌دهد (نقشهٔ تازه برمی‌گردد) و ردیف‌های
 * غیرقفلِ سناریو با همان ارجاع قبلی حفظ می‌شوند.
 */
export function overlayLockedInheritance(
  assignments: AssignmentReadMap,
  baseAssignments: AssignmentReadMap | null | undefined,
  lockedRows: ReadonlyArray<string>
): Record<string, Record<number, ShiftType>> {
  if (!baseAssignments || lockedRows.length === 0) {
    return { ...(assignments as Record<string, Record<number, ShiftType>>) };
  }

  const merged: Record<string, Record<number, ShiftType>> = {
    ...(assignments as Record<string, Record<number, ShiftType>>),
  };
  const inherited = inheritLockedRowsFromBase(baseAssignments, lockedRows);
  for (const [personnelId, row] of Object.entries(inherited)) {
    merged[personnelId] = row;
  }
  return merged;
}

// ============================================================================
// ۲) محاسبهٔ Diff/Patch نسبت به برنامهٔ مبنا
// ============================================================================

/**
 * فهرست قطعی و مرتب‌شدهٔ تغییرهای سلول‌سطح بین برنامهٔ مبنا و یک نامزد (سناریو).
 *
 * قرارداد سطح‌ردیف (مهم):
 *   · ردیفی که در نامزد به‌کلی غایب است = «بدون پیشنهاد» → هیچ Diffی تولید
 *     نمی‌شود و ردیف مرجع حفظ می‌ماند (غیبت در پچ هرگز صفرکردن مرجع نیست).
 *   · ردیفی که در نامزد حاضر است یک پچ کامل است → سلول غایب داخلش با OFF
 *     مقایسه می‌شود.
 *   · ردیفی که فقط در نامزد هست با مبنای OFF مقایسه و به‌عنوان ردیف تازه اعمال
 *     می‌شود.
 *
 * مرتب‌سازی: به‌ترتیب چیدمان دامنهٔ ورودی و سپس روز صعودی — تا خروجی برای ورودی
 * یکسان همیشه یکسان باشد (قابل‌تست و قابل‌تکثیر).
 */
export function diffAgainstBaseRoster(
  baseAssignments: AssignmentReadMap,
  candidateAssignments: AssignmentReadMap,
  options: RosterDiffOptions
): RosterDiffEntry[] {
  const { totalDays, scopePersonnelIds } = options;

  const scope = scopePersonnelIds ?? Array.from(
    new Set([...Object.keys(baseAssignments), ...Object.keys(candidateAssignments)])
  );

  const diff: RosterDiffEntry[] = [];
  for (const personnelId of scope) {
    const baseRow = baseAssignments[personnelId];
    const candidateRow = candidateAssignments[personnelId];
    // غیبت کامل ردیف در نامزد = «بدون پیشنهاد» → ردیف مرجع دست‌نخورده می‌ماند
    // (غیبت در پچ هرگز به معنای صفرکردن ردیف مرجع نیست).
    if (!candidateRow) continue;
    for (let day = 1; day <= totalDays; day++) {
      const fromShift = baseRow?.[day] ?? 'OFF';
      // ردیف حاضر در نامزد یک پچ کامل است؛ سلول غایب داخل آن با OFF مقایسه می‌شود.
      const toShift = candidateRow[day] ?? 'OFF';
      if (fromShift !== toShift) {
        diff.push({ personnelId, day, fromShift, toShift });
      }
    }
  }
  return diff;
}

/**
 * تفکیک Diff به دو بخش «قابل‌اعمال» و «ردشده» بر اساس قفل ماهانهٔ پرسنل.
 *
 * قاعدهٔ بنیادین Merge: اگر پرسنل قفل باشد، تغییر او هرگز اعمال نمی‌شود —
 * حتی اگر سناریو چیز دیگری برایش ساخته باشد.
 */
export function partitionDiffByLocks(
  diff: ReadonlyArray<RosterDiffEntry>,
  lockedRows: ReadonlyArray<string>
): RosterDiffPartition {
  const applicable: RosterDiffEntry[] = [];
  const rejected: RosterDiffEntry[] = [];

  for (const entry of diff) {
    if (isPersonnelRowLocked(entry.personnelId, lockedRows)) {
      rejected.push(entry);
    } else {
      applicable.push(entry);
    }
  }
  return { applicable, rejected };
}

// ============================================================================
// ۳) Merge مرجع‌محور (انتخاب سناریو توسط سرپرستار)
// ============================================================================

/**
 * Merge کامل یک سناریو روی برنامهٔ مبنا با قرارداد Diff/Patch:
 *
 *   ۱) دامنهٔ Merge = ردیف‌های گروه هدف (jobGroup) — گروه دیگر دقیقاً همان‌طور
 *      که در برنامهٔ مبناست می‌ماند.
 *   ۲) Diff = فقط تغییرهایی که سناریو نسبت به برنامهٔ مبنا دارد.
 *   ۳) تغییرهای پرسنل قفل‌شده رد می‌شوند؛ باقی اعمال می‌گردند.
 *
 * نکته: این تابع فقط «تخصیص‌ها» را ادغام می‌کند. محاسبهٔ مجدد Constraintها،
 * بازتولید هشدارها و امتیازدهیِ پس از Merge وظیفهٔ لایهٔ Facade است (که از همین
 * تابع خالص و سپس از verifier موجود استفاده می‌کند) و هیچ قانون جدیدی به موتور
 * اضافه نمی‌شود.
 */
export function computeScenarioMerge(
  baseSchedule: MonthlySchedule,
  candidateSchedule: Pick<MonthlySchedule, 'assignments'>,
  options: ScenarioMergeOptions
): ScenarioMergeResult {
  const { lockedRows, personnelList, jobGroup, totalDays } = options;

  const scopePersonnelIds = jobGroup
    ? personnelList.filter(person => person.jobGroup === jobGroup).map(person => person.id)
    : undefined;

  const diff = diffAgainstBaseRoster(
    baseSchedule.assignments,
    candidateSchedule.assignments,
    { totalDays, scopePersonnelIds }
  );
  const { applicable, rejected } = partitionDiffByLocks(diff, lockedRows);

  const assignments: Record<string, Record<number, ShiftType>> = {};
  for (const [personnelId, row] of Object.entries(baseSchedule.assignments)) {
    assignments[personnelId] = { ...(row as Record<number, ShiftType>) };
  }

  for (const change of applicable) {
    if (!assignments[change.personnelId]) {
      assignments[change.personnelId] = {};
    }
    assignments[change.personnelId][change.day] = change.toShift;
  }

  return {
    assignments,
    diff,
    appliedChanges: applicable,
    rejectedChanges: rejected,
  };
}
