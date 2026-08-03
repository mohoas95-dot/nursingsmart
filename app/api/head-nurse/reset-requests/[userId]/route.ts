import { NextRequest } from 'next/server';
import { runInTransaction, withMutex } from '../../../../../lib/db';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from '../../../../../lib/auth/password';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../../lib/auth/http';
import {
  AuthenticationError,
  requireCurrentUser,
} from '../../../../../lib/auth/session';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    const { userId } = await context.params;

    // دو کلیک سریع روی «بازنشانی رمز» باعث می‌شد درخواست دوم با «درخواست بازیابی
    // پیدا نشد» شکست بخورد و سرپرستار پیام خطای گیج‌کننده ببیند.
    return await withMutex(`reset-request:${userId}`, async () => {
      // هش رمز اولیه پیش از تراکنش ساخته می‌شود تا bcrypt قفل ردیف را نگه ندارد.
      const passwordHash = await hashPassword(DEFAULT_INITIAL_PASSWORD);

      const outcome = await runInTransaction(async (tx) => {
        const target = await tx.user.findUnique({ where: { id: userId } });
        if (!target || !target.hasResetRequest) return { status: 'not-found' as const };

        if (actor.role === 'HEAD_NURSE' && (!actor.departmentId || actor.departmentId !== target.departmentId)) {
          return { status: 'forbidden' as const };
        }

        // بازنشانی رمز و ابطال نشست‌های کاربر باید اتمیک باشد: اگر رمز عوض شود
        // ولی نشست‌ها باقی بمانند، کاربر با رمز قدیمی همچنان دسترسی دارد.
        await tx.user.update({
          where: { id: target.id },
          data: {
            passwordHash,
            mustChangePassword: true,
            hasResetRequest: false,
            resetRequestedAt: null,
            passwordResetAt: new Date(),
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        });
        await tx.session.deleteMany({ where: { userId: target.id } });
        return { status: 'reset' as const };
      }, { label: 'reset-password' });

      if (outcome.status === 'forbidden') {
        throw new AuthenticationError(403, 'اجازه بازنشانی رمز این کاربر را ندارید.');
      }
      if (outcome.status === 'not-found') {
        return authJson({ success: false, error: 'درخواست بازیابی پیدا نشد.' }, { status: 404 });
      }

      return authJson({
        success: true,
        message: 'رمز عبور کاربر به ۱۲۳۴ بازنشانی شد.',
      });
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
