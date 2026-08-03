import 'server-only';
import { dbWrite } from '../db';

/**
 * شمارش اتمیک تلاش‌های ناموفق احراز هویت و قفل موقت حساب.
 *
 * چرا اتمیک؟ پیاده‌سازی قبلی مقدار خوانده‌شده در حافظه را «+۱» می‌کرد و
 * بازمی‌نوشت. با چند تلاش هم‌زمان (حملهٔ خودکار یا حتی چند تب باز) همهٔ آن‌ها
 * مقدار ۱ را می‌نوشتند و شمارنده هرگز به سقف نمی‌رسید — یعنی قفل حساب عملاً
 * غیرفعال بود (lost update). اکنون افزایش با `increment` در خود پایگاه داده و
 * زیر قفل ردیف انجام می‌شود.
 *
 * این عملیات «بهترین تلاش» است: خطای پایگاه داده در ثبت تلاش ناموفق نباید
 * پاسخ امنیتی (رد درخواست) را به خطای ۵۰۰ تبدیل کند.
 */

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

export async function registerFailedAttempt(userId: string): Promise<void> {
  try {
    const updated = await dbWrite(client => client.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    }), { label: 'failed-attempt-increment' });

    if (updated.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      await dbWrite(client => client.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000),
        },
      }), { label: 'failed-attempt-lock' });
    }
  } catch (error) {
    console.warn('[auth] ثبت تلاش ناموفق احراز هویت انجام نشد:', error);
  }
}
