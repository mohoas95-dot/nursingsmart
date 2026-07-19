import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from '../../../../../lib/auth/password';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../../lib/auth/http';
import {
  AuthenticationError,
  requireCurrentUser,
  revokeAllUserSessions,
} from '../../../../../lib/auth/session';

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    const { userId } = await context.params;
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target || !target.hasResetRequest) {
      return authJson({ success: false, error: 'درخواست بازیابی پیدا نشد.' }, { status: 404 });
    }
    if (actor.role === 'HEAD_NURSE' && (!actor.departmentId || actor.departmentId !== target.departmentId)) {
      throw new AuthenticationError(403, 'اجازه بازنشانی رمز این کاربر را ندارید.');
    }

    const passwordHash = await hashPassword(DEFAULT_INITIAL_PASSWORD);
    await prisma.user.update({
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
    await revokeAllUserSessions(target.id);

    return authJson({
      success: true,
      message: 'رمز عبور کاربر به ۱۲۳۴ بازنشانی شد.',
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
