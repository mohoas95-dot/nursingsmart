/**
 * AlertLifecycle — Domain Layer (Pure Functions)
 *
 * RESPONSIBILITY:
 *   چرخهٔ عمر هشدارهای برنامهٔ ماهانه: تشخیص هشدارهای «رفع‌شده» و پاک‌سازی خودکار
 *   وضعیت نادیده‌گرفتن (dismiss) آن‌ها.
 *
 * چرا لازم است؟
 *   هشدارها با متنِ کامل خودشان به‌عنوان کلید ذخیره می‌شوند. اگر سرپرستار هشداری را
 *   نادیده بگیرد و سپس مشکل را واقعاً در برنامه اصلاح کند، آن متن دیگر در فهرست
 *   هشدارهای بازتولیدشده نیست؛ اما رکوردِ نادیده‌گرفتنِ آن تا ابد در پایگاه داده
 *   باقی می‌ماند. این باقی‌ماندن دو عارضه دارد:
 *     ۱) اگر همان تخلف بعداً دوباره ساخته شود (مثلاً پس از بازتولید هوشمند)، متنِ
 *        هشدار دقیقاً یکسان تولید می‌شود و به‌خاطر رکورد قدیمی «بی‌صدا» پنهان می‌ماند
 *        و سرپرستار هرگز از تخلف تازه باخبر نمی‌شود.
 *     ۲) فهرست نادیده‌گرفته‌ها بی‌وقفه رشد می‌کند و شمارندهٔ «بازیابی همه» عددی
 *        نامربوط به وضعیت فعلی برنامه نشان می‌دهد.
 *
 * راهکار: هر بار که هشدارها بازتولید و ذخیره می‌شوند، وضعیت نادیده‌گرفتن با فهرست
 * هشدارهای فعال هم‌تراز می‌شود؛ یعنی هشدارِ رفع‌شده به‌کلی از سیستم حذف می‌گردد.
 *
 * PURE: بدون وابستگی به React، Next.js یا I/O.
 */

/**
 * وضعیت نادیده‌گرفتن را با فهرست هشدارهای فعلی هم‌تراز می‌کند.
 *
 * فقط رکوردهایی نگه داشته می‌شوند که هشدارِ متناظرشان هنوز در برنامه فعال است.
 * هشدارهایی که سرپرستار مشکلشان را رفع کرده، خودکار از فهرست بیرون می‌روند تا
 * بروز دوبارهٔ همان تخلف در آینده حتماً دیده شود.
 *
 * @param activeWarnings فهرست هشدارهای بازتولیدشدهٔ فعلی برنامه
 * @param dismissedWarnings فهرست ذخیره‌شدهٔ هشدارهای نادیده‌گرفته‌شده
 * @returns زیرمجموعه‌ای از dismissedWarnings که هنوز معتبر است (بدون تکرار)
 */
export function pruneDismissedWarnings(
  activeWarnings: ReadonlyArray<string>,
  dismissedWarnings: ReadonlyArray<string>
): string[] {
  if (dismissedWarnings.length === 0) return [];
  const active = new Set(activeWarnings);
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const warning of dismissedWarnings) {
    if (!active.has(warning) || seen.has(warning)) continue;
    seen.add(warning);
    kept.push(warning);
  }
  return kept;
}

/**
 * همان هم‌ترازی، اما روی نگاشتِ درون‌حافظه‌ایِ رابط کاربری
 * (`{ [warningText]: true }`) که برای جلوه‌های آنی استفاده می‌شود.
 */
export function pruneDismissedWarningMap(
  activeWarnings: ReadonlyArray<string>,
  dismissedMap: Readonly<Record<string, boolean>>
): Record<string, boolean> {
  const active = new Set(activeWarnings);
  const next: Record<string, boolean> = {};
  for (const [warning, isDismissed] of Object.entries(dismissedMap)) {
    if (isDismissed && active.has(warning)) next[warning] = true;
  }
  return next;
}

/**
 * هشدارهایی که نسبت به وضعیت قبلی رفع شده‌اند (در فهرست قبلی بودند و اکنون نیستند).
 * برای گزارش‌دادن به کاربر یا ثبت در تاریخچهٔ تغییرات مفید است.
 */
export function findResolvedWarnings(
  previousWarnings: ReadonlyArray<string>,
  currentWarnings: ReadonlyArray<string>
): string[] {
  const current = new Set(currentWarnings);
  return previousWarnings.filter(warning => !current.has(warning));
}

/**
 * آیا هم‌ترازسازی، تغییری در فهرست نادیده‌گرفته‌ها ایجاد می‌کند؟
 * برای پرهیز از نوشتنِ بی‌مورد در پایگاه داده به کار می‌رود.
 */
export function dismissedWarningsChanged(
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>
): boolean {
  if (before.length !== after.length) return true;
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) return true;
  }
  return false;
}
