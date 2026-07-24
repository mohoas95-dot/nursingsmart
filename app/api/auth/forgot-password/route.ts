import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { ForgotPasswordSchema } from '../../../../lib/auth/validation';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from '../../../../lib/auth/password';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../lib/auth/http';

const CONFIRMATION_MESSAGE = 'رمز عبور جدید به زودی برات ارسال میشه!';

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const parsed = ForgotPasswordSchema.parse(await request.json());
    const { nationalId, departmentId } = parsed;

    // ====== اصلاح: بررسی وجود کاربر و ایجاد خودکار ======
    // اگر کاربر با این nationalId در Prisma وجود ندارد، ولی departmentId مشخص شده،
    // یک حساب PERSONNEL جدید با رمز اولیه ۱۲۳۴ می‌سازیم تا:
    // ۱) فراموشی رمز در پنل سرپرستار همان بخش نمایش داده شود
    // ۲) ورود با portal='staff' و departmentId به‌درستی کار کند
    // ۳) پرسنل‌های قدیمی (قبل از اتصال Prisma) هم بتوانند وارد شوند
    const existingUser = await prisma.user.findUnique({ where: { nationalId } });

    if (!existingUser && departmentId) {
      // ====== Auto-provision: ایجاد حساب خودکار ======
      // کاربر وجود ندارد → حساب PERSONNEL جدید با رمز ۱۲۳۴ ایجاد می‌کنیم
      // نام اولیه از کد ملی استخراج می‌شود؛ سرپرستار می‌تواند بعداً اصلاح کند
      await prisma.user.create({
        data: {
          nationalId,
          passwordHash: await hashPassword(DEFAULT_INITIAL_PASSWORD),
          firstName: 'پرسنل',
          lastName: `(${nationalId})`,
          role: 'PERSONNEL',
          departmentId,
          active: true,
          mustChangePassword: true,
          hasResetRequest: true,
          resetRequestedAt: new Date(),
        },
      });
      return authJson({ success: true, message: CONFIRMATION_MESSAGE });
    }

    if (existingUser) {
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

      await prisma.user.update({
        where: { id: existingUser.id },
        data: updateData,
      });
    }
    // updateMany avoids throwing for an unknown ID. The response intentionally stays
    // identical so the endpoint cannot be used to enumerate hospital personnel.
    // Note: if !existingUser && !departmentId, we can't auto-provision, so the
    // reset request silently does nothing (same as before for security).
    return authJson({ success: true, message: CONFIRMATION_MESSAGE });
  } catch (error) {
    return authErrorResponse(error);
  }
}
