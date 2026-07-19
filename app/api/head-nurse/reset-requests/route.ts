import { prisma } from '../../../../lib/prisma';
import { authErrorResponse, authJson } from '../../../../lib/auth/http';
import { AuthenticationError, requireCurrentUser } from '../../../../lib/auth/session';

export async function GET() {
  try {
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    if (actor.role === 'HEAD_NURSE' && !actor.departmentId) {
      throw new AuthenticationError(403, 'برای حساب سرپرستار بخش مشخص نشده است.');
    }

    const users = await prisma.user.findMany({
      where: {
        hasResetRequest: true,
        active: true,
        ...(actor.role === 'HEAD_NURSE' ? { departmentId: actor.departmentId } : {}),
      },
      select: {
        id: true,
        nationalId: true,
        firstName: true,
        lastName: true,
        departmentId: true,
        resetRequestedAt: true,
      },
      orderBy: [{ resetRequestedAt: 'asc' }, { lastName: 'asc' }],
    });
    return authJson({ success: true, users });
  } catch (error) {
    return authErrorResponse(error);
  }
}
