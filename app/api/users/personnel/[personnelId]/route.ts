import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../../lib/auth/http';
import { AuthenticationError, requireCurrentUser } from '../../../../../lib/auth/session';
import { NationalIdSchema } from '../../../../../lib/auth/validation';
import { prisma } from '../../../../../lib/prisma';
import {
  AccountLinkConflictError,
  createOrAdoptPersonnelAccount,
} from '../../../../../lib/auth/accountLinking';

const UpdateNationalIdSchema = z.object({
  nationalId: NationalIdSchema,
  // نام و نام خانوادگی فقط زمانی لازم است که حساب ورود هنوز ساخته نشده باشد.
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  departmentId: z.string().min(1).max(128).optional(),
}).strict();

type Actor = Awaited<ReturnType<typeof requireCurrentUser>>;

async function findManagedPersonnelUser(actor: Actor, personnelId: string) {
  const user = await prisma.user.findUnique({ where: { personnelId } });
  if (!user) return null;
  if (actor.role === 'HEAD_NURSE' && (!actor.departmentId || actor.departmentId !== user.departmentId)) {
    throw new AuthenticationError(403, 'اجازه مشاهده یا ویرایش حساب این پرسنل را ندارید.');
  }
  return user;
}

function resolveDepartmentId(actor: Actor, requested?: string) {
  const departmentId = actor.role === 'HEAD_NURSE' ? actor.departmentId : (requested || actor.departmentId);
  if (!departmentId) {
    throw new AuthenticationError(403, 'برای ساخت حساب ورود، بخش پرسنل مشخص نشده است.');
  }
  return departmentId;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ personnelId: string }> },
) {
  try {
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    const { personnelId } = await context.params;
    const user = await findManagedPersonnelUser(actor, personnelId);
    // پرسنل قدیمی ممکن است هنوز حساب ورود نداشته باشد. در این حالت به‌جای خطای ۴۰۳
    // (که ویرایش پرسنل را کاملاً مسدود می‌کرد) وضعیت «بدون حساب» برگردانده می‌شود تا
    // سرپرستار بتواند با ثبت کد ملی، حساب ورود او را همان‌جا بسازد.
    if (!user) {
      return authJson({ success: true, hasAccount: false, nationalId: '' });
    }
    return authJson({
      success: true,
      hasAccount: true,
      nationalId: user.nationalId,
      active: user.active,
      mustChangePassword: user.mustChangePassword,
      hasResetRequest: user.hasResetRequest,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ personnelId: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    const { personnelId } = await context.params;
    const input = UpdateNationalIdSchema.parse(await request.json());
    const user = await findManagedPersonnelUser(actor, personnelId);

    if (!user) {
      // حساب ورود وجود ندارد → ساخته می‌شود یا حساب متصل‌نشدهٔ موجود با همان کد ملی
      // (که هنگام ورود یا درخواست بازیابی ساخته شده) به این پرونده وصل می‌گردد.
      const departmentId = resolveDepartmentId(actor, input.departmentId);
      const created = await createOrAdoptPersonnelAccount({
        nationalId: input.nationalId,
        firstName: input.firstName || 'پرسنل',
        lastName: input.lastName || 'بخش',
        departmentId,
        personnelId,
      });
      return authJson({
        success: true,
        nationalId: input.nationalId,
        hasAccount: true,
        created: created.created,
        adopted: created.adopted,
        message: created.adopted
          ? (created.passwordReset
              ? 'حساب ورود این کد ملی دوباره فعال و به پرونده متصل شد؛ رمز عبور به ۱۲۳۴ بازنشانی گردید.'
              : 'حساب ورود موجود با این کد ملی به پروندهٔ این پرسنل متصل شد؛ رمز فعلی کاربر تغییر نکرد.')
          : 'حساب ورود این پرسنل با رمز اولیه ۱۲۳۴ ساخته شد.',
      });
    }

    if (user.nationalId !== input.nationalId) {
      const existing = await prisma.user.findUnique({ where: { nationalId: input.nationalId } });
      if (existing && existing.id !== user.id) {
        return authJson({ success: false, error: 'این کد ملی قبلاً برای حساب دیگری ثبت شده است.' }, { status: 409 });
      }
      await prisma.user.update({ where: { id: user.id }, data: { nationalId: input.nationalId } });
    }

    // نام حساب ورود با نام پروندهٔ پرسنلی هم‌راستا نگه داشته می‌شود تا در فهرست
    // درخواست‌های بازیابی رمز، نام واقعی پرسنل نمایش داده شود.
    if ((input.firstName && input.firstName !== user.firstName) ||
        (input.lastName && input.lastName !== user.lastName)) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          ...(input.firstName ? { firstName: input.firstName } : {}),
          ...(input.lastName ? { lastName: input.lastName } : {}),
        },
      });
    }

    return authJson({ success: true, nationalId: input.nationalId, hasAccount: true });
  } catch (error) {
    if (error instanceof AccountLinkConflictError) {
      return authJson({ success: false, error: error.message }, { status: 409 });
    }
    return authErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ personnelId: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    const { personnelId } = await context.params;
    const user = await prisma.user.findUnique({ where: { personnelId } });
    if (!user) return authJson({ success: true });
    if (actor.role === 'HEAD_NURSE' && (!actor.departmentId || actor.departmentId !== user.departmentId)) {
      throw new AuthenticationError(403, 'اجازه حذف حساب این پرسنل را ندارید.');
    }
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { userId: user.id } }),
      prisma.user.update({
        where: { id: user.id },
        data: { active: false, hasResetRequest: false, resetRequestedAt: null },
      }),
    ]);
    return authJson({ success: true, message: 'حساب ورود پرسنل غیرفعال شد.' });
  } catch (error) {
    return authErrorResponse(error);
  }
}
