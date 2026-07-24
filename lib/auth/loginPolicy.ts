/**
 * تصمیم‌گیری خالص (بدون وابستگی به دیتابیس) دربارهٔ نتیجهٔ یک تلاش ورود.
 *
 * این منطق عمداً از مسیر API جدا شده تا:
 *  ۱) ترتیب بررسی‌ها (قفل حساب → اعتبار رمز → فعال بودن → بخش → پرتال) قابل تست باشد؛
 *  ۲) اشتباهاتی مثل «حساب تازه ساخته‌شده با رمز درست، باز هم رد شود» دیگر تکرار نشود.
 */

export type LoginRole = 'ADMIN' | 'HEAD_NURSE' | 'PERSONNEL';

export type LoginUserSnapshot = {
  active: boolean;
  role: LoginRole;
  departmentId: string | null;
  lockedUntil: Date | null;
};

export type LoginAttempt = {
  user: LoginUserSnapshot | null;
  /** نتیجهٔ نهایی مقایسهٔ رمز؛ برای حساب تازه‌ساخته‌شده باید true باشد. */
  passwordIsValid: boolean;
  departmentId?: string;
  portal?: 'staff' | 'head-nurse';
  now?: Date;
};

export type LoginDecision =
  | { outcome: 'locked'; retryAfterMinutes: number }
  | {
      outcome: 'rejected';
      reason: 'credentials' | 'inactive' | 'department' | 'portal';
      /** آیا این تلاش باید به‌عنوان «ورود ناموفق» شمرده شود؟ */
      countFailedAttempt: boolean;
    }
  | { outcome: 'accepted'; assignDepartmentId: string | null };

export function evaluateLoginAttempt(attempt: LoginAttempt): LoginDecision {
  const now = attempt.now ?? new Date();
  const user = attempt.user;

  // ۱) قفل موقت حساب پیش از هر چیز بررسی می‌شود تا کاربرِ قفل‌شده پیام درست ببیند
  //    و تلاش‌های او دوباره شمرده نشود.
  if (user && user.lockedUntil && user.lockedUntil > now) {
    const retryAfterMinutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000));
    return { outcome: 'locked', retryAfterMinutes };
  }

  // ۲) کد ملی ناموجود یا رمز نادرست؛ فقط وقتی حساب وجود دارد تلاش ناموفق شمرده می‌شود.
  if (!user || !attempt.passwordIsValid) {
    return { outcome: 'rejected', reason: 'credentials', countFailedAttempt: !!user };
  }

  // ۳) رمز درست است ولی حساب غیرفعال شده؛ چون هویت اثبات شده، پیام شفاف داده می‌شود.
  if (!user.active) {
    return { outcome: 'rejected', reason: 'inactive', countFailedAttempt: false };
  }

  // ۴) کنترل تعلق حساب به بخش انتخاب‌شده (مدیر سامانه از این قاعده مستثناست).
  let assignDepartmentId: string | null = null;
  if (attempt.departmentId && user.role !== 'ADMIN') {
    if (!user.departmentId) {
      // حساب هنوز به هیچ بخشی وصل نیست → به بخش انتخاب‌شده متصل می‌شود.
      assignDepartmentId = attempt.departmentId;
    } else if (user.departmentId !== attempt.departmentId) {
      return { outcome: 'rejected', reason: 'department', countFailedAttempt: false };
    }
  }

  // ۵) کنترل تطابق نقش با پرتال انتخاب‌شده.
  if (attempt.portal === 'staff' && user.role !== 'PERSONNEL') {
    return { outcome: 'rejected', reason: 'portal', countFailedAttempt: false };
  }
  if (attempt.portal === 'head-nurse' && user.role !== 'HEAD_NURSE' && user.role !== 'ADMIN') {
    return { outcome: 'rejected', reason: 'portal', countFailedAttempt: false };
  }

  return { outcome: 'accepted', assignDepartmentId };
}

export const LOGIN_ERROR_MESSAGES: Record<'credentials' | 'inactive' | 'department' | 'portal', string> = {
  credentials: 'کد ملی یا رمز عبور نادرست است.',
  inactive: 'حساب کاربری شما غیرفعال شده است؛ لطفاً با سرپرستار بخش تماس بگیرید.',
  department: 'این حساب به بخش انتخاب‌شده تعلق ندارد.',
  portal: 'این حساب اجازهٔ ورود از این پرتال را ندارد.',
};
