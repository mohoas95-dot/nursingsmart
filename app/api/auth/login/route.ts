import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { verifyPassword, hashPassword, DEFAULT_INITIAL_PASSWORD } from '../../../../lib/auth/password';
import { createSession } from '../../../../lib/auth/session';
import { LoginSchema } from '../../../../lib/auth/validation';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../lib/auth/http';
import { evaluateLoginAttempt, LOGIN_ERROR_MESSAGES } from '../../../../lib/auth/loginPolicy';
import { createUnlinkedStaffAccount } from '../../../../lib/auth/accountLinking';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const credentials = LoginSchema.parse(await request.json());
    let user = await prisma.user.findUnique({ where: { nationalId: credentials.nationalId } });

    // مقایسهٔ bcrypt همیشه اجرا می‌شود (حتی برای کد ملی ناموجود) تا زمان پاسخ لو ندهد
    // که این کد ملی در سامانه ثبت شده است یا نه.
    let passwordIsValid = await verifyPassword(credentials.password, user?.passwordHash);

    // ورود نخستین‌بار پرسنلِ بدون حساب:
    // پرسنلی که پیش از راه‌اندازی احراز هویت در فهرست بخش ثبت شده رکورد User ندارد.
    // اگر با رمز اولیهٔ ۱۲۳۴ و از پرتال کادر درمان وارد شود، حساب او همان‌جا ساخته می‌شود.
    // نکته‌ی کلیدی: نتیجهٔ رمز باید هم‌زمان به true تغییر کند، وگرنه همان درخواست با
    // «کد ملی یا رمز عبور نادرست است» رد می‌شد — دقیقاً باگی که کاربران گزارش کرده بودند.
    if (!user && credentials.departmentId && credentials.portal === 'staff') {
      const usesInitialPassword = credentials.password === DEFAULT_INITIAL_PASSWORD;
      if (usesInitialPassword) {
        user = await createUnlinkedStaffAccount({
          nationalId: credentials.nationalId,
          departmentId: credentials.departmentId,
          passwordHash: await hashPassword(DEFAULT_INITIAL_PASSWORD),
        });
        // در حالت رقابتی ممکن است حساب هم‌زمان توسط درخواست دیگری ساخته شده باشد؛
        // بنابراین رمز دوباره با هشِ واقعیِ همان رکورد سنجیده می‌شود.
        passwordIsValid = await verifyPassword(credentials.password, user.passwordHash);
      }
    }

    const decision = evaluateLoginAttempt({
      user,
      passwordIsValid,
      departmentId: credentials.departmentId,
      portal: credentials.portal,
    });

    if (decision.outcome === 'locked') {
      return authJson({
        success: false,
        error: `به‌دلیل تلاش‌های ناموفق، ورود موقتاً مسدود شده است. حدود ${decision.retryAfterMinutes} دقیقهٔ دیگر دوباره تلاش کنید.`,
      }, { status: 429 });
    }

    if (decision.outcome === 'rejected') {
      if (decision.countFailedAttempt && user) {
        const attempts = user.failedLoginAttempts + 1;
        const reachedLimit = attempts >= MAX_FAILED_ATTEMPTS;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: reachedLimit ? 0 : attempts,
            lockedUntil: reachedLimit ? new Date(Date.now() + LOCK_MINUTES * 60_000) : user.lockedUntil,
          },
        });
      }
      return authJson({
        success: false,
        error: LOGIN_ERROR_MESSAGES[decision.reason],
      }, { status: decision.reason === 'credentials' ? 401 : 403 });
    }

    // ورود موفق: اتصال حساب بی‌بخش به بخش انتخاب‌شده + پاک‌سازی شمارندهٔ تلاش‌ها.
    user = await prisma.user.update({
      where: { id: user!.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        ...(decision.assignDepartmentId ? { departmentId: decision.assignDepartmentId } : {}),
      },
    });

    await createSession(user.id, {
      userAgent: request.headers.get('user-agent'),
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
    });

    return authJson({
      success: true,
      user: {
        id: user.id,
        nationalId: user.nationalId,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        departmentId: user.departmentId,
        personnelId: user.personnelId,
        mustChangePassword: user.mustChangePassword,
      },
      redirectTo: user.mustChangePassword ? '/change-password' : '/',
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
