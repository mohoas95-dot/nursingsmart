import { NextRequest } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { verifyPassword, hashPassword, DEFAULT_INITIAL_PASSWORD } from '../../../../lib/auth/password';
import { createSession } from '../../../../lib/auth/session';
import { LoginSchema } from '../../../../lib/auth/validation';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../lib/auth/http';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const credentials = LoginSchema.parse(await request.json());
    let user = await prisma.user.findUnique({ where: { nationalId: credentials.nationalId } });

    // Always run bcrypt, including for unknown users, to reduce account enumeration via timing.
    const passwordIsValid = await verifyPassword(credentials.password, user?.passwordHash);

    // ====== اصلاح: Auto-provisioning پرسنل ======
    // اگر کاربر با این nationalId در Prisma وجود ندارد ولی:
    // ۱) departmentId معتبر فرستاده شده
    // ۲) رمز عبور = رمز اولیه ۱۲۳۴
    // ۳) portal = 'staff'
    // → حساب PERSONNEL جدید با رمز اولیه می‌سازیم.
    // این حالت وقتی رخ می‌دهد که پرسنل‌های قدیمی (قبل از Prisma auth)
    // بدون حساب ورود هستند.
    if (!user && credentials.departmentId && credentials.portal === 'staff') {
      // بررسی: رمز ورود = رمز اولیه؟
      // verifyPassword با DUMMY_HASH مقایسه کرد (کاربر وجود نداشت) → همیشه false
      // باید مستقیماً با hash رمز اولیه مقایسه کنیم.
      const defaultPasswordHash = await hashPassword(DEFAULT_INITIAL_PASSWORD);
      const defaultPasswordValid = await verifyPassword(credentials.password, defaultPasswordHash);
      if (defaultPasswordValid) {
        user = await prisma.user.create({
          data: {
            nationalId: credentials.nationalId,
            passwordHash: defaultPasswordHash,
            firstName: 'پرسنل',
            lastName: `(${credentials.nationalId})`,
            role: 'PERSONNEL',
            departmentId: credentials.departmentId,
            active: true,
            mustChangePassword: true,
            hasResetRequest: false,
          },
        });
      }
    }

    if (!user || !passwordIsValid || !user.active) {
      if (user) {
        const attempts = user.failedLoginAttempts + 1;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: attempts >= MAX_FAILED_ATTEMPTS ? 0 : attempts,
            lockedUntil: attempts >= MAX_FAILED_ATTEMPTS
              ? new Date(Date.now() + LOCK_MINUTES * 60_000)
              : user.lockedUntil,
          },
        });
      }
      return authJson({ success: false, error: 'کد ملی یا رمز عبور نادرست است.' }, { status: 401 });
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      return authJson({
        success: false,
        error: 'به‌دلیل تلاش‌های ناموفق، ورود موقتاً مسدود شده است. کمی بعد دوباره تلاش کنید.',
      }, { status: 429 });
    }
    // ====== اصلاح: انتساب خودکار departmentId ======
    // اگر کاربر departmentId ندارد (null)، و کلاینت یک departmentId معتبر فرستاده،
    // آن را به کاربر اختصاص می‌دهیم. این حالت وقتی رخ می‌دهد که پرسنل از طریق فراموشی
    // رمز یا روش‌های دیگر حساب ساخته شده ولی به بخش متصل نشده.
    if (credentials.departmentId && user.role !== 'ADMIN' && !user.departmentId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { departmentId: credentials.departmentId },
      });
    }
    if (credentials.departmentId && user.role !== 'ADMIN' && user.departmentId !== credentials.departmentId) {
      return authJson({ success: false, error: 'این حساب به بخش انتخاب‌شده تعلق ندارد.' }, { status: 403 });
    }
    if (credentials.portal === 'staff' && user.role !== 'PERSONNEL') {
      return authJson({ success: false, error: 'این حساب متعلق به کادر درمان نیست.' }, { status: 403 });
    }
    if (credentials.portal === 'head-nurse' && user.role !== 'HEAD_NURSE' && user.role !== 'ADMIN') {
      return authJson({ success: false, error: 'این حساب دسترسی سرپرستار ندارد.' }, { status: 403 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
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
