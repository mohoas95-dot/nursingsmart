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
import { prisma } from '../../../../lib/prisma';
import { departmentExistsInIndex } from '../../../../lib/s3Storage';

// انتقال امن مدیریت بخش: جایگزینی سرپرستار/مدیر فعلی با سرپرستار جدید تنها با
// تأیید امنیتی سرپرستار قبلی (کد ملی + رمز عبور خودِ او) انجام می‌شود. پس از انتقال،
// حساب سرپرستار قبلی غیرفعال و تمام نشست‌های او ابطال می‌گردد.

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

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

    // تأیید امنیتی سرپرستار قبلی: کد ملی و رمز عبور باید متعلق به سرپرستار فعالِ فعلیِ
    // همین بخش باشد و اگر خود سرپرستار درخواست می‌دهد، هویت باید با نشست او یکی باشد.
    const previousHeadNurse = await prisma.user.findUnique({ where: { nationalId: input.previousNationalId } });
    const passwordIsValid = await verifyPassword(input.previousPassword, previousHeadNurse?.passwordHash);
    const isCurrentManager = !!previousHeadNurse &&
      previousHeadNurse.active &&
      previousHeadNurse.role === 'HEAD_NURSE' &&
      previousHeadNurse.departmentId === targetDepartmentId;
    const isAuthorizedActor = actor.role === 'ADMIN' || previousHeadNurse?.id === actor.id;
    if (!isCurrentManager || !isAuthorizedActor || !passwordIsValid) {
      if (previousHeadNurse && isCurrentManager) {
        await registerFailedAttempt(
          previousHeadNurse.id,
          previousHeadNurse.failedLoginAttempts,
          previousHeadNurse.lockedUntil,
        );
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

    const existingNewUser = await prisma.user.findUnique({
      where: { nationalId: input.newHeadNurse.nationalId },
    });
    if (existingNewUser?.active) {
      return authJson({ success: false, error: 'برای این کد ملی قبلاً حساب کاربری فعال ساخته شده است.' }, { status: 409 });
    }
    if (existingNewUser && existingNewUser.role !== 'HEAD_NURSE') {
      return authJson({ success: false, error: 'این کد ملی قابل ثبت به‌عنوان سرپرستار نیست.' }, { status: 409 });
    }

    const passwordHash = await hashPassword(DEFAULT_INITIAL_PASSWORD);
    // ساخت یا فعال‌سازی مجدد حساب سرپرستار جدید و غیرفعال‌سازی امن حساب سرپرستار قبلی.
    await prisma.$transaction([
      existingNewUser
        ? prisma.user.update({
            where: { id: existingNewUser.id },
            data: {
              passwordHash,
              firstName: input.newHeadNurse.firstName,
              lastName: input.newHeadNurse.lastName,
              role: 'HEAD_NURSE' as const,
              departmentId: targetDepartmentId,
              personnelId: null,
              active: true,
              mustChangePassword: true,
              hasResetRequest: false,
              resetRequestedAt: null,
              failedLoginAttempts: 0,
              lockedUntil: null,
            },
          })
        : prisma.user.create({
            data: {
              nationalId: input.newHeadNurse.nationalId,
              passwordHash,
              firstName: input.newHeadNurse.firstName,
              lastName: input.newHeadNurse.lastName,
              role: 'HEAD_NURSE' as const,
              departmentId: targetDepartmentId,
              active: true,
              mustChangePassword: true,
              hasResetRequest: false,
            },
          }),
      ...(existingNewUser
        ? [prisma.session.deleteMany({ where: { userId: existingNewUser.id } })]
        : []),
      prisma.session.deleteMany({ where: { userId: previousHeadNurse.id } }),
      prisma.user.update({
        where: { id: previousHeadNurse.id },
        data: {
          active: false,
          hasResetRequest: false,
          resetRequestedAt: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
    ]);

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
  } catch (error) {
    return authErrorResponse(error);
  }
}
