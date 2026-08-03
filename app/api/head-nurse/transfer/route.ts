import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../lib/auth/http';
import { DEFAULT_INITIAL_PASSWORD, hashPassword, verifyPassword } from '../../../../lib/auth/password';
import {
  AuthenticationError,
  destroyCurrentSession,
  requireCurrentUser,
} from '../../../../lib/auth/session';
import { NationalIdSchema, PasswordInputSchema } from '../../../../lib/auth/validation';
import { dbRead, runInTransaction, withMutex, isUniqueConstraintError } from '../../../../lib/db';
import { registerFailedAttempt } from '../../../../lib/auth/failedAttempts';
import { departmentExistsInIndex } from '../../../../lib/s3Storage';

// انتقال امن مدیریت بخش: جایگزینی سرپرستار/مدیر فعلی با سرپرستار جدید تنها با
// تأیید امنیتی سرپرستار قبلی (کد ملی + رمز عبور خودِ او) انجام می‌شود. پس از انتقال،
// حساب سرپرستار قبلی غیرفعال و تمام نشست‌های او ابطال می‌گردد.

const TransferHeadNurseSchema = z.object({
  departmentId: z.string().min(1).max(128).optional(),
  previousNationalId: NationalIdSchema,
  previousPassword: PasswordInputSchema,
  newHeadNurse: z.object({
    nationalId: NationalIdSchema,
    firstName: z.string().trim().min(2, 'نام را وارد کنید.').max(100),
    lastName: z.string().trim().min(2, 'نام خانوادگی را وارد کنید.').max(100),
  }).strict(),
}).strict();

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    const input = TransferHeadNurseSchema.parse(await request.json());

    const targetDepartmentId = actor.role === 'HEAD_NURSE'
      ? actor.departmentId
      : input.departmentId;
    if (!targetDepartmentId) {
      throw new AuthenticationError(403, 'برای انتقال مدیریت، بخش موردنظر مشخص نشده است.');
    }

    if (input.newHeadNurse.nationalId === input.previousNationalId) {
      return authJson({ success: false, error: 'کد ملی سرپرستار جدید با سرپرستار فعلی یکسان است.' }, { status: 400 });
    }

    // انتقال مدیریت یک عملیات حساس و چندمرحله‌ای است. دو ارسال هم‌زمان فرم
    // می‌توانست سرپرستار قبلی را دوبار غیرفعال یا دو حساب سرپرستار جدید بسازد.
    // قفل به‌ازای بخش، کل عملیات را سریال می‌کند.
    return await withMutex(`department-transfer:${targetDepartmentId}`, () =>
      performTransfer(actor, input, targetDepartmentId));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return authJson({
        success: false,
        error: 'این کد ملی هم‌زمان برای حساب دیگری ثبت شد؛ لطفاً دوباره تلاش کنید.',
      }, { status: 409 });
    }
    return authErrorResponse(error);
  }
}

async function performTransfer(
  actor: Awaited<ReturnType<typeof requireCurrentUser>>,
  input: z.infer<typeof TransferHeadNurseSchema>,
  targetDepartmentId: string,
) {
  // تأیید امنیتی سرپرستار قبلی: کد ملی و رمز عبور باید متعلق به سرپرستار فعالِ فعلیِ
  // همین بخش باشد و اگر خود سرپرستار درخواست می‌دهد، هویت باید با نشست او یکی باشد.
  const previousHeadNurse = await dbRead(
    client => client.user.findUnique({ where: { nationalId: input.previousNationalId } }),
    { label: 'transfer-lookup-previous' },
  );
  const passwordIsValid = await verifyPassword(input.previousPassword, previousHeadNurse?.passwordHash);
  const isCurrentManager = !!previousHeadNurse &&
    previousHeadNurse.active &&
    previousHeadNurse.role === 'HEAD_NURSE' &&
    previousHeadNurse.departmentId === targetDepartmentId;
  const isAuthorizedActor = actor.role === 'ADMIN' || previousHeadNurse?.id === actor.id;
  if (!isCurrentManager || !isAuthorizedActor || !passwordIsValid) {
    if (previousHeadNurse && isCurrentManager) {
      await registerFailedAttempt(previousHeadNurse.id);
    }
    return authJson({ success: false, error: 'تأیید امنیتی سرپرستار قبلی ناموفق بود؛ کد ملی یا رمز عبور نادرست است.' }, { status: 401 });
  }
  if (previousHeadNurse.lockedUntil && previousHeadNurse.lockedUntil > new Date()) {
    return authJson({
      success: false,
      error: 'به‌دلیل تلاش‌های ناموفق، این حساب موقتاً مسدود شده است. کمی بعد دوباره تلاش کنید.',
    }, { status: 429 });
  }

  if (!(await departmentExistsInIndex(targetDepartmentId))) {
    return authJson({ success: false, error: 'بخش موردنظر در فهرست بخش‌ها یافت نشد.' }, { status: 404 });
  }

  // هش رمز اولیه پیش از تراکنش ساخته می‌شود تا bcrypt هیچ قفلی را نگه ندارد.
  const passwordHash = await hashPassword(DEFAULT_INITIAL_PASSWORD);

  // کل انتقال در یک تراکنش تعاملی انجام می‌شود. پیش‌تر از `$transaction([...])`
  // آرایه‌ای استفاده می‌شد که عملیات را اتمیک اجرا می‌کرد ولی تصمیم‌ها (وجود حساب
  // سرپرستار جدید، نقش او) بیرون از تراکنش گرفته شده بود؛ در فاصلهٔ بین بررسی و
  // اجرا، وضعیت می‌توانست تغییر کند. اکنون بررسی و اجرا در یک واحد اتمیک‌اند.
  const outcome = await runInTransaction(async (tx) => {
    const currentPrevious = await tx.user.findUnique({ where: { id: previousHeadNurse.id } });
    // بازبینی داخل تراکنش: ممکن است در همین فاصله سرپرستار عوض شده باشد.
    if (!currentPrevious || !currentPrevious.active ||
        currentPrevious.role !== 'HEAD_NURSE' ||
        currentPrevious.departmentId !== targetDepartmentId) {
      return { status: 'stale' as const };
    }

    const existingNewUser = await tx.user.findUnique({
      where: { nationalId: input.newHeadNurse.nationalId },
    });
    // مدیر سامانه (ADMIN) قابل تنزل به سرپرستار نیست.
    if (existingNewUser?.active && existingNewUser.role === 'ADMIN') {
      return { status: 'admin-target' as const };
    }
    // حساب غیرفعال فقط در صورتی قابل استفادهٔ مجدد است که قبلاً سرپرستار بوده باشد.
    if (existingNewUser && !existingNewUser.active && existingNewUser.role !== 'HEAD_NURSE') {
      return { status: 'not-eligible' as const };
    }

    // ساخت یا فعال‌سازی مجدد حساب سرپرستار جدید.
    if (existingNewUser) {
      await tx.user.update({
        where: { id: existingNewUser.id },
        data: {
          passwordHash,
          firstName: input.newHeadNurse.firstName,
          lastName: input.newHeadNurse.lastName,
          role: 'HEAD_NURSE',
          departmentId: targetDepartmentId,
          personnelId: null,
          active: true,
          mustChangePassword: true,
          hasResetRequest: false,
          resetRequestedAt: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      // نشست‌های قبلی حساب سرپرستار جدید ابطال می‌شود تا با نقش قدیمی ادامه ندهد.
      await tx.session.deleteMany({ where: { userId: existingNewUser.id } });
    } else {
      await tx.user.create({
        data: {
          nationalId: input.newHeadNurse.nationalId,
          passwordHash,
          firstName: input.newHeadNurse.firstName,
          lastName: input.newHeadNurse.lastName,
          role: 'HEAD_NURSE',
          departmentId: targetDepartmentId,
          active: true,
          mustChangePassword: true,
          hasResetRequest: false,
        },
      });
    }

    // غیرفعال‌سازی امن حساب سرپرستار قبلی و ابطال تمام نشست‌های او.
    await tx.session.deleteMany({ where: { userId: currentPrevious.id } });
    await tx.user.update({
      where: { id: currentPrevious.id },
      data: {
        active: false,
        hasResetRequest: false,
        resetRequestedAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    return { status: 'transferred' as const };
  }, { label: 'department-transfer', timeout: 20_000 });

  if (outcome.status === 'admin-target') {
    return authJson({ success: false, error: 'این کد ملی متعلق به مدیر سامانه است و نمی‌توان آن را به سرپرستار بخش تغییر داد.' }, { status: 409 });
  }
  if (outcome.status === 'not-eligible') {
    return authJson({ success: false, error: 'این کد ملی قابل ثبت به‌عنوان سرپرستار نیست.' }, { status: 409 });
  }
  if (outcome.status === 'stale') {
    return authJson({
      success: false,
      error: 'وضعیت مدیریت این بخش هم‌زمان تغییر کرد؛ صفحه را تازه‌سازی کنید و دوباره تلاش کنید.',
    }, { status: 409 });
  }

  // اگر درخواست‌دهنده خودِ سرپرستار قبلی است، کوکی نشست فعلی او نیز باطل می‌شود
  // (رکورد نشست‌ها در تراکنش بالا پاک شده است).
  if (previousHeadNurse.id === actor.id) {
    await destroyCurrentSession().catch(() => undefined);
  }

  return authJson({
    success: true,
    departmentId: targetDepartmentId,
    transferredByPreviousHeadNurse: previousHeadNurse.id === actor.id,
    message: `مدیریت بخش به ${input.newHeadNurse.firstName} ${input.newHeadNurse.lastName} منتقل شد. سرپرستار جدید می‌تواند با رمز اولیه ۱۲۳۴ وارد شود و حساب سرپرستار قبلی غیرفعال گردید.`,
  });
}
