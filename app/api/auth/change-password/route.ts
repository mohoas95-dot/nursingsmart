import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { hashPassword, verifyPassword } from '../../../../lib/auth/password';
import { ChangePasswordSchema } from '../../../../lib/auth/validation';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../lib/auth/http';
import { requireCurrentUser, revokeOtherSessions } from '../../../../lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const sessionUser = await requireCurrentUser({ allowPasswordChangeRequired: true });
    const input = ChangePasswordSchema.parse(await request.json());
    const user = await prisma.user.findUniqueOrThrow({ where: { id: sessionUser.id } });
    if (!await verifyPassword(input.currentPassword, user.passwordHash)) {
      return authJson({ success: false, error: 'رمز عبور فعلی نادرست است.' }, { status: 400 });
    }

    const passwordHash = await hashPassword(input.newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, passwordResetAt: new Date() },
    });
    await revokeOtherSessions(user.id);
    return authJson({ success: true, redirectTo: '/' });
  } catch (error) {
    return authErrorResponse(error);
  }
}
