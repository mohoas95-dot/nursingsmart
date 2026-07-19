import { NextRequest } from 'next/server';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../../lib/auth/http';
import { AuthenticationError, requireCurrentUser } from '../../../../../lib/auth/session';
import { prisma } from '../../../../../lib/prisma';

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
