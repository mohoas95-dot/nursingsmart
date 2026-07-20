import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../lib/auth/http';
import { verifyPassword } from '../../../../lib/auth/password';
import {
  AuthenticationError,
  destroyCurrentSession,
  requireCurrentUser,
} from '../../../../lib/auth/session';
import { NationalIdSchema, PasswordInputSchema } from '../../../../lib/auth/validation';
import { prisma } from '../../../../lib/prisma';
import {
  deleteDepartmentStorage,
  departmentExistsInIndex,
} from '../../../../lib/s3Storage';

// حذف قطعی و دائمی بخش: تمام اسناد ذخیره‌سازی ابری (پرسنل، درخواست‌ها، تنظیمات،
// تعطیلات و تمام شیفت‌های ماهانه) و تمام رکوردهای پایگاه‌داده (کاربران و نشست‌ها)
// مرتبط با بخش برای همیشه پاک می‌شوند. این عملیات غیرقابل بازگشت است.

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const DeleteDepartmentSchema = z.object({
  nationalId: NationalIdSchema,
  password: PasswordInputSchema,
  departmentId: z.string().min(1).max(128).optional(),
}).strict();

async function registerFailedAttempt(userId: string, currentAttempts: number, lockedUntil: Date | null) {
  const attempts = currentAttempts + 1;
  await prisma.user.update({
    where: { id: userId },
    data: {
      failedLoginAttempts: attempts >= MAX_FAILED_ATTEMPTS ? 0 : attempts,
      lockedUntil: attempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCK_MINUTES * 60_000)
        : lockedUntil,
    },
  });
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    const input = DeleteDepartmentSchema.parse(await request.json());

    const targetDepartmentId = actor.role === 'HEAD_NURSE'
      ? actor.departmentId
      : input.departmentId;
    if (!targetDepartmentId) {
      throw new AuthenticationError(403, 'برای حذف، بخش موردنظر مشخص نشده است.');
    }

    // احراز هویت مجدد اجباری: کد ملی واردشده باید دقیقاً متعلق به همان کاربر نشست فعلی باشد.
    const reAuthUser = await prisma.user.findUnique({ where: { nationalId: input.nationalId } });
    const passwordIsValid = await verifyPassword(input.password, reAuthUser?.passwordHash);
    const isSameIdentity = !!reAuthUser && reAuthUser.id === actor.id && reAuthUser.active;
    if (!isSameIdentity || !passwordIsValid) {
      if (reAuthUser && reAuthUser.id === actor.id) {
        await registerFailedAttempt(reAuthUser.id, reAuthUser.failedLoginAttempts, reAuthUser.lockedUntil);
      }
      return authJson({ success: false, error: 'احراز هویت مجدد ناموفق بود؛ کد ملی یا رمز عبور نادرست است.' }, { status: 401 });
    }
    if (reAuthUser.lockedUntil && reAuthUser.lockedUntil > new Date()) {
      return authJson({
        success: false,
        error: 'به‌دلیل تلاش‌های ناموفق، این حساب موقتاً مسدود شده است. کمی بعد دوباره تلاش کنید.',
      }, { status: 429 });
    }

    if (!(await departmentExistsInIndex(targetDepartmentId))) {
      return authJson({ success: false, error: 'بخش موردنظر در فهرست بخش‌ها یافت نشد.' }, { status: 404 });
    }

    // ابتدا اسناد ابری بخش به‌صورت دائمی پاک می‌شوند؛ اگر این مرحله خطا بدهد، حساب‌های
    // کاربری دست‌نخورده باقی می‌مانند و امکان تلاش مجدد وجود دارد.
    await deleteDepartmentStorage(targetDepartmentId);

    // سپس تمام رکوردهای پایگاه‌داده مرتبط با بخش (نشست‌ها و کاربران) حذف قطعی می‌شوند.
    const departmentUsers = await prisma.user.findMany({
      where: { departmentId: targetDepartmentId },
      select: { id: true },
    });
    const userIds = departmentUsers.map((user: { id: string }) => user.id);
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { userId: { in: userIds } } }),
      prisma.user.deleteMany({ where: { departmentId: targetDepartmentId } }),
    ]);

    // اگر مدیر، بخش خودش را حذف کرده، نشست او بلافاصله ابطال می‌شود.
    if (actor.departmentId === targetDepartmentId) {
      await destroyCurrentSession().catch(() => undefined);
    }

    return authJson({
      success: true,
      deletedDepartmentId: targetDepartmentId,
      removedAccounts: userIds.length,
      ownAccountRemoved: actor.departmentId === targetDepartmentId,
      message: 'بخش و تمام سوابق و حساب‌های مرتبط با آن به‌صورت دائمی حذف شد.',
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
