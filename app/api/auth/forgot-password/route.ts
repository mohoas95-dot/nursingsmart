import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { ForgotPasswordSchema } from '../../../../lib/auth/validation';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../lib/auth/http';

const CONFIRMATION_MESSAGE = 'رمز عبور جدید به زودی برات ارسال میشه!';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const parsed = ForgotPasswordSchema.parse(await request.json());
    const { nationalId, departmentId } = parsed;

    // ====== اصلاح: انتساب departmentId به کاربر ======
    // اگر کاربر با این nationalId وجود دارد اما departmentId ندارد یا نادرست است،
    // آن را به بخش مشخص‌شده متصل می‌کند تا:
    // ۱) فراموشی رمز در پنل سرپرستار همان بخش نمایش داده شود
    // ۲) ورود با portal='staff' و departmentId به‌درستی کار کند
    const updateData: { hasResetRequest: true; resetRequestedAt: Date; departmentId?: string } = {
      hasResetRequest: true,
      resetRequestedAt: new Date(),
    };
    if (departmentId) {
      updateData.departmentId = departmentId;
    }

    // updateMany avoids throwing for an unknown ID. The response intentionally stays
    // identical so the endpoint cannot be used to enumerate hospital personnel.
    await prisma.user.updateMany({
      where: { nationalId, active: true },
      data: updateData,
    });
    return authJson({ success: true, message: CONFIRMATION_MESSAGE });
  } catch (error) {
    return authErrorResponse(error);
  }
}
