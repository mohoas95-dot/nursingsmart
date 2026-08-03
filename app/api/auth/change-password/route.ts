import { NextRequest } from 'next/server';
import { dbRead, dbWrite, withMutex } from '../../../../lib/db';
import { hashPassword, verifyPassword } from '../../../../lib/auth/password';
import { ChangePasswordSchema } from '../../../../lib/auth/validation';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../lib/auth/http';
import { requireCurrentUser, revokeOtherSessions } from '../../../../lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const sessionUser = await requireCurrentUser({ allowPasswordChangeRequired: true });
    const input = ChangePasswordSchema.parse(await request.json());

    // کلیک دوباره روی «ثبت رمز جدید» پیش از رسیدن پاسخ اول، باعث می‌شد درخواست
    // دوم با «رمز عبور فعلی نادرست است» رد شود (چون رمز همان لحظه عوض شده بود).
    // سریال‌سازی به‌ازای هر کاربر این تداخل را حذف می‌کند.
    return await withMutex(`change-password:${sessionUser.id}`, async () => {
      const user = await dbRead(client => client.user.findUnique({ where: { id: sessionUser.id } }), {
        label: 'change-password-lookup',
      });
      if (!user) {
        return authJson({ success: false, error: 'حساب کاربری یافت نشد؛ دوباره وارد شوید.' }, { status: 401 });
      }
      if (!await verifyPassword(input.currentPassword, user.passwordHash)) {
        return authJson({ success: false, error: 'رمز عبور فعلی نادرست است.' }, { status: 400 });
      }

      // مقایسه و هش‌کردن bcrypt عمداً بیرون از تراکنش انجام می‌شود: هر کدام صدها
      // میلی‌ثانیه CPU می‌خواهند و اجرای آن‌ها با قفل باز، اتصال‌ها را بند می‌آورد.
      const passwordHash = await hashPassword(input.newPassword);

      // کنترل هم‌زمانی خوش‌بینانه: به‌روزرسانی فقط وقتی اعمال می‌شود که هش رمز
      // هنوز همان مقداری باشد که خواندیم. اگر درخواست دیگری در همین فاصله رمز را
      // عوض کرده باشد، شرط برقرار نیست و به‌جای بازنویسی خاموش، پیام شفاف
      // برمی‌گردد. `updateMany` استفاده می‌شود چون شرط روی فیلد غیریکتاست.
      const applied = await dbWrite(client => client.user.updateMany({
        where: { id: user.id, passwordHash: user.passwordHash },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordResetAt: new Date(),
        },
      }), { label: 'change-password-apply' });

      if (applied.count === 0) {
        return authJson({
          success: false,
          error: 'رمز عبور این حساب هم‌زمان توسط درخواست دیگری تغییر کرد؛ لطفاً دوباره تلاش کنید.',
        }, { status: 409 });
      }

      // ابطال سایر نشست‌ها خارج از مسیر اصلی است تا خطای احتمالی آن، تغییر رمزِ
      // موفق را بی‌اعتبار نکند.
      await revokeOtherSessions(sessionUser.id).catch(error => {
        console.warn('[change-password] ابطال سایر نشست‌ها انجام نشد:', error);
      });
      return authJson({ success: true, redirectTo: '/' });
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
