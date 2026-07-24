import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { ForgotPasswordSchema } from '../../../../lib/auth/validation';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../lib/auth/http';
import { createUnlinkedStaffAccount } from '../../../../lib/auth/accountLinking';

const CONFIRMATION_MESSAGE = 'درخواست شما ثبت شد؛ سرپرستار بخش رمز عبور شما را بازنشانی می‌کند.';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const parsed = ForgotPasswordSchema.parse(await request.json());
    const { nationalId, departmentId } = parsed;

    const existingUser = await prisma.user.findUnique({ where: { nationalId } });

    if (!existingUser) {
      // پرسنلی که هنوز حساب ورود ندارد: یک حساب «متصل‌نشده» با پرچم درخواست بازیابی
      // ساخته می‌شود تا درخواست او بلافاصله در پنل سرپرستار همان بخش دیده شود.
      // بدون این کار، درخواست در هیچ جدولی ثبت نمی‌شد و پنل سرپرستار خالی می‌ماند.
      if (departmentId) {
        await createUnlinkedStaffAccount({ nationalId, departmentId, withResetRequest: true });
      }
      // پاسخ برای کد ملی موجود و ناموجود عمداً یکسان است تا امکان شناسایی پرسنل نباشد.
      return authJson({ success: true, message: CONFIRMATION_MESSAGE });
    }

    await prisma.user.update({
      where: { id: existingUser.id },
      data: {
        hasResetRequest: true,
        resetRequestedAt: new Date(),
        // حساب غیرفعال‌شده به‌طور خودکار فعال نمی‌شود؛ تصمیم با سرپرستار است.
        // بخشِ حساب هم بازنویسی نمی‌شود مگر اینکه اصلاً بخشی نداشته باشد، تا انتخاب
        // اشتباه بخش در صفحهٔ ورود، پرسنل را از بخش خودش جدا نکند.
        ...(existingUser.departmentId || !departmentId ? {} : { departmentId }),
      },
    });

    return authJson({ success: true, message: CONFIRMATION_MESSAGE });
  } catch (error) {
    return authErrorResponse(error);
  }
}
