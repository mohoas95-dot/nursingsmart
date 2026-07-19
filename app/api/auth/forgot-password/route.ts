import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { ForgotPasswordSchema } from '../../../../lib/auth/validation';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../lib/auth/http';

const CONFIRMATION_MESSAGE = 'رمز عبور جدید به زودی برات ارسال میشه!';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const { nationalId } = ForgotPasswordSchema.parse(await request.json());
    // updateMany avoids throwing for an unknown ID. The response intentionally stays
    // identical so the endpoint cannot be used to enumerate hospital personnel.
    await prisma.user.updateMany({
      where: { nationalId, active: true },
      data: { hasResetRequest: true, resetRequestedAt: new Date() },
    });
    return authJson({ success: true, message: CONFIRMATION_MESSAGE });
  } catch (error) {
    return authErrorResponse(error);
  }
}
