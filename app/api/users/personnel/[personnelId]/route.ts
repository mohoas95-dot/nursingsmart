import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../../lib/auth/http';
import { AuthenticationError, requireCurrentUser } from '../../../../../lib/auth/session';
import { NationalIdSchema } from '../../../../../lib/auth/validation';
import { prisma } from '../../../../../lib/prisma';

const UpdateNationalIdSchema = z.object({ nationalId: NationalIdSchema }).strict();

async function findManagedPersonnelUser(actor: Awaited<ReturnType<typeof requireCurrentUser>>, personnelId: string) {
  const user = await prisma.user.findUnique({ where: { personnelId } });
  if (!user) throw new AuthenticationError(403, 'حساب ورود این پرسنل پیدا نشد.');
  if (actor.role === 'HEAD_NURSE' && (!actor.departmentId || actor.departmentId !== user.departmentId)) {
    throw new AuthenticationError(403, 'اجازه مشاهده یا ویرایش حساب این پرسنل را ندارید.');
  }
  return user;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ personnelId: string }> },
) {
  try {
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    const { personnelId } = await context.params;
    const user = await findManagedPersonnelUser(actor, personnelId);
    return authJson({ success: true, nationalId: user.nationalId });
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

    if (user.nationalId !== input.nationalId) {
      const existing = await prisma.user.findUnique({ where: { nationalId: input.nationalId } });
      if (existing && existing.id !== user.id) {
        return authJson({ success: false, error: 'این کد ملی قبلاً برای حساب دیگری ثبت شده است.' }, { status: 409 });
      }
      await prisma.user.update({ where: { id: user.id }, data: { nationalId: input.nationalId } });
    }

    return authJson({ success: true, nationalId: input.nationalId });
  } catch (error) {
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
