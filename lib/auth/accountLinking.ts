import 'server-only';
import { prisma } from '../prisma';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from './password';

/**
 * ابزارهای مشترک «ساخت و اتصال حساب ورود پرسنل».
 *
 * چرا لازم است؟ بخشی از پرسنل بخش‌ها پیش از راه‌اندازی احراز هویت در فهرست پرسنل
 * ذخیره‌سازی ابری ثبت شده‌اند و هیچ رکورد `User` ندارند. همچنین وقتی پرسنل با کد ملی
 * و رمز پیش‌فرض وارد می‌شود یا «فراموشی رمز» می‌زند، یک حساب «متصل‌نشده»
 * (`personnelId = null`) ساخته می‌شود. این توابع اجازه می‌دهند سرپرستار همان حساب را
 * به پروندهٔ پرسنلی وصل کند، به‌جای اینکه با خطای «کد ملی تکراری» روبه‌رو شود.
 */

export type PersonnelAccountIdentity = {
  nationalId: string;
  firstName: string;
  lastName: string;
  departmentId: string;
  personnelId: string;
};

export class AccountLinkConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountLinkConflictError';
  }
}

/** آیا این حساب «متصل‌نشده» است و می‌توان آن را به یک پروندهٔ پرسنلی وصل کرد؟ */
export function isAdoptableAccount(
  user: { role: string; personnelId: string | null; departmentId: string | null },
  departmentId: string,
) {
  return user.role === 'PERSONNEL' &&
    !user.personnelId &&
    (!user.departmentId || user.departmentId === departmentId);
}

/**
 * حساب ورود پرسنل را می‌سازد یا حساب متصل‌نشدهٔ موجود با همان کد ملی را به پرونده وصل می‌کند.
 * اگر کد ملی به پروندهٔ دیگری متصل باشد، خطای تداخل پرتاب می‌شود.
 */
export async function createOrAdoptPersonnelAccount(identity: PersonnelAccountIdentity) {
  const existing = await prisma.user.findUnique({ where: { nationalId: identity.nationalId } });

  if (!existing) {
    return {
      user: await prisma.user.create({
        data: {
          nationalId: identity.nationalId,
          passwordHash: await hashPassword(DEFAULT_INITIAL_PASSWORD),
          firstName: identity.firstName,
          lastName: identity.lastName,
          role: 'PERSONNEL',
          departmentId: identity.departmentId,
          personnelId: identity.personnelId,
          active: true,
          mustChangePassword: true,
          hasResetRequest: false,
        },
      }),
      created: true,
      adopted: false,
      passwordReset: true,
    };
  }

  if (existing.personnelId === identity.personnelId) {
    return {
      user: await prisma.user.update({
        where: { id: existing.id },
        data: {
          firstName: identity.firstName,
          lastName: identity.lastName,
          departmentId: existing.departmentId || identity.departmentId,
        },
      }),
      created: false,
      adopted: false,
      passwordReset: false,
    };
  }

  if (isAdoptableAccount(existing, identity.departmentId)) {
    // حساب متصل‌نشده (ساخته‌شده هنگام ورود یا درخواست بازیابی) به پرونده وصل می‌شود.
    // اگر حساب فعال است رمز فعلی کاربر دست‌نخورده می‌ماند تا ورود او مختل نشود؛ اما
    // حساب غیرفعال هنگام فعال‌سازی مجدد رمز اولیه می‌گیرد تا رمز قدیمیِ رهاشده زنده نشود.
    const reactivating = !existing.active;
    return {
      user: await prisma.user.update({
        where: { id: existing.id },
        data: {
          firstName: identity.firstName,
          lastName: identity.lastName,
          departmentId: identity.departmentId,
          personnelId: identity.personnelId,
          active: true,
          ...(reactivating
            ? {
                passwordHash: await hashPassword(DEFAULT_INITIAL_PASSWORD),
                mustChangePassword: true,
                hasResetRequest: false,
                resetRequestedAt: null,
                failedLoginAttempts: 0,
                lockedUntil: null,
              }
            : {}),
        },
      }),
      created: false,
      adopted: true,
      passwordReset: reactivating,
    };
  }

  throw new AccountLinkConflictError('این کد ملی قبلاً برای حساب دیگری ثبت شده است.');
}

/** ساخت حساب پرسنلِ «متصل‌نشده» برای ورود اولیه یا درخواست بازیابی رمز. */
export async function createUnlinkedStaffAccount(input: {
  nationalId: string;
  departmentId: string;
  passwordHash?: string;
  withResetRequest?: boolean;
}) {
  try {
    return await prisma.user.create({
      data: {
        nationalId: input.nationalId,
        passwordHash: input.passwordHash || await hashPassword(DEFAULT_INITIAL_PASSWORD),
        // نام واقعی هنگام اتصال حساب به پروندهٔ پرسنلی توسط سرپرستار جایگزین می‌شود.
        firstName: 'پرسنل ثبت‌نشده',
        lastName: `(کد ملی ${input.nationalId})`,
        role: 'PERSONNEL',
        departmentId: input.departmentId,
        active: true,
        mustChangePassword: true,
        hasResetRequest: !!input.withResetRequest,
        resetRequestedAt: input.withResetRequest ? new Date() : null,
      },
    });
  } catch (error) {
    // شرایط رقابتی: اگر همان کد ملی هم‌زمان (مثلاً دو بار کلیک روی دکمهٔ ورود) ساخته شده
    // باشد، به‌جای خطای «کد ملی تکراری» همان حساب موجود برگردانده می‌شود.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      const existing = await prisma.user.findUnique({ where: { nationalId: input.nationalId } });
      if (existing) return existing;
    }
    throw error;
  }
}
