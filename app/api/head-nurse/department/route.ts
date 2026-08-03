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
import { dbRead, runInTransaction, withMutex } from '../../../../lib/db';
import { registerFailedAttempt } from '../../../../lib/auth/failedAttempts';
import { invalidateDepartmentCache } from '../../../../lib/cache/department-index';
import {
  deleteDepartmentStorage,
  departmentExistsInIndex,
  StorageConflictError,
  StorageValidationError,
  StorageUnavailableError,
  StorageConfigurationError,
} from '../../../../lib/s3Storage';

// حذف قطعی و دائمی بخش: تمام اسناد ذخیره‌سازی ابری (پرسنل، درخواست‌ها، تنظیمات،
// تعطیلات و تمام شیفت‌های ماهانه) و تمام رکوردهای پایگاه‌داده (کاربران و نشست‌ها)
// مرتبط با بخش برای همیشه پاک می‌شوند. این عملیات غیرقابل بازگشت است.

const DeleteDepartmentSchema = z.object({
  nationalId: NationalIdSchema,
  password: PasswordInputSchema,
  departmentId: z.string().min(1).max(128).optional(),
}).strict();

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

    // حذف بخش عملیاتی طولانی (پاک‌سازی ابری + پایگاه داده) و غیرقابل بازگشت است.
    // دو ارسال هم‌زمان فرم باعث می‌شد نیمی از اسناد توسط یک درخواست و نیم دیگر
    // توسط درخواست دوم حذف شود و پیام‌های خطای متناقض تولید گردد.
    return await withMutex(`department-delete:${targetDepartmentId}`, () =>
      performDelete(actor, input, targetDepartmentId));
  } catch (error) {
    return departmentErrorResponse(error);
  }
}

async function performDelete(
  actor: Awaited<ReturnType<typeof requireCurrentUser>>,
  input: z.infer<typeof DeleteDepartmentSchema>,
  targetDepartmentId: string,
) {
  // احراز هویت مجدد اجباری: کد ملی واردشده باید دقیقاً متعلق به همان کاربر نشست فعلی باشد.
  const reAuthUser = await dbRead(
    client => client.user.findUnique({ where: { nationalId: input.nationalId } }),
    { label: 'department-delete-reauth' },
  );
  const passwordIsValid = await verifyPassword(input.password, reAuthUser?.passwordHash);
  const isSameIdentity = !!reAuthUser && reAuthUser.id === actor.id && reAuthUser.active;
  if (!isSameIdentity || !passwordIsValid) {
    if (reAuthUser && reAuthUser.id === actor.id) {
      await registerFailedAttempt(reAuthUser.id);
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
  // بخش حذف شد؛ کش فهرست عمومی بلافاصله باطل می‌شود تا بخشِ پاک‌شده در صفحهٔ
  // ورود نمایش داده نشود.
  invalidateDepartmentCache();

  // سپس تمام رکوردهای پایگاه‌داده مرتبط با بخش (نشست‌ها و کاربران) حذف قطعی می‌شوند.
  //
  // پیش‌تر فهرست کاربران بیرون از تراکنش خوانده می‌شد و سپس نشست‌ها بر اساس آن
  // فهرستِ احتمالاً کهنه حذف می‌گردید: کاربری که در همان فاصله به بخش اضافه
  // می‌شد، حسابش حذف ولی نشست فعالش باقی می‌ماند. اکنون خواندن و هر دو حذف در
  // یک تراکنش اتمیک و بر پایهٔ رابطهٔ خود بخش انجام می‌شود.
  const removedAccounts = await runInTransaction(async (tx) => {
    const departmentUsers = await tx.user.findMany({
      where: { departmentId: targetDepartmentId },
      select: { id: true },
    });
    const userIds = departmentUsers.map((user: { id: string }) => user.id);
    if (userIds.length > 0) {
      await tx.session.deleteMany({ where: { userId: { in: userIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    }
    return userIds.length;
  }, { label: 'department-delete-accounts', timeout: 30_000 });

  // اگر مدیر، بخش خودش را حذف کرده، نشست او بلافاصله ابطال می‌شود.
  const ownAccountRemoved = actor.departmentId === targetDepartmentId;
  if (ownAccountRemoved) {
    await destroyCurrentSession().catch(() => undefined);
  }

  return authJson({
    success: true,
    deletedDepartmentId: targetDepartmentId,
    removedAccounts,
    ownAccountRemoved,
    message: 'بخش و تمام سوابق و حساب‌های مرتبط با آن به‌صورت دائمی حذف شد.',
  });
}

/** تبدیل خطاهای ذخیره‌سازی ابری و پایگاه داده به پاسخ استاندارد و امن. */
function departmentErrorResponse(error: unknown) {
  if (error instanceof StorageConflictError) {
    const response = authJson({ success: false, error: 'خطای همزمانی در حذف اطلاعات ابری بخش؛ لطفاً دوباره تلاش کنید.', retryable: true }, { status: 409 });
    response.headers.set('Retry-After', '2');
    return response;
  }
  if (error instanceof StorageValidationError) {
    return authJson({ success: false, error: 'خطای اعتبارسنجی در اطلاعات ذخیره‌شده بخش.' }, { status: 422 });
  }
  if (error instanceof StorageUnavailableError) {
    const response = authJson({ success: false, error: 'فضای ذخیره‌سازی ابری موقتاً در دسترس نیست؛ لطفاً کمی بعد دوباره تلاش کنید.', retryable: true }, { status: 503 });
    response.headers.set('Retry-After', '5');
    return response;
  }
  if (error instanceof StorageConfigurationError) {
    return authJson({ success: false, error: 'پیکربندی فضای ذخیره‌سازی ابری ناقص یا اشتباه است.' }, { status: 503 });
  }
  return authErrorResponse(error);
}
