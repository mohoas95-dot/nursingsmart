import 'server-only';
import { runInTransaction, withMutex, isUniqueConstraintError, type TransactionClient } from '../db';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from './password';

/**
 * ابزارهای مشترک «ساخت و اتصال حساب ورود پرسنل».
 *
 * چرا لازم است؟ بخشی از پرسنل بخش‌ها پیش از راه‌اندازی احراز هویت در فهرست پرسنل
 * ذخیره‌سازی ابری ثبت شده‌اند و هیچ رکورد `User` ندارند. همچنین وقتی پرسنل با کد ملی
 * و رمز پیش‌فرض وارد می‌شود یا «فراموشی رمز» می‌زند، یک حساب «متصل‌نشده»
 * (`personnelId = null`) ساخته می‌شود. این توابع اجازه می‌دهند سرپرستار همان حساب را
 * به پروندهٔ پرسنلی وصل کند، به‌جای اینکه با خطای «کد ملی تکراری» روبه‌رو شود.
 *
 * ── مدیریت هم‌زمانی ──────────────────────────────────────────────────────────
 * هر دو تابع این فایل الگوی خطرناک «بخوان → تصمیم بگیر → بنویس» دارند: بین خواندن
 * و نوشتن، درخواست دیگری می‌تواند همان کد ملی را بسازد یا تغییر دهد. راهکار
 * سه‌لایه:
 *   ۱) قفل درون‌پردازه‌ای بر اساس کد ملی → کلیک‌های سریع سریال می‌شوند.
 *   ۲) تراکنش اتمیک → خواندن و نوشتن یک واحد تجزیه‌ناپذیر است.
 *   ۳) مدیریت P2002 → اگر با وجود ۱ و ۲ باز هم رقابتی رخ داد (چند نمونهٔ سرور)،
 *      خطای «کد ملی تکراری» به کاربر نشان داده نمی‌شود و همان رکورد موجود
 *      برگردانده/به‌روزرسانی می‌شود.
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

/** کلید قفل هم‌زمانی برای عملیات مربوط به یک کد ملی مشخص. */
function accountLockKey(nationalId: string) {
  return `user:nationalId:${nationalId}`;
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

type LinkResult = {
  user: {
    id: string;
    nationalId: string;
    firstName: string;
    lastName: string;
    role: 'ADMIN' | 'HEAD_NURSE' | 'PERSONNEL';
    departmentId: string | null;
    personnelId: string | null;
    active: boolean;
    mustChangePassword: boolean;
  };
  created: boolean;
  adopted: boolean;
  passwordReset: boolean;
};

/**
 * بدنهٔ اصلی «ساخت یا اتصال»، اجراشده داخل یک تراکنش.
 * هش رمز عبور عمداً بیرون از تراکنش محاسبه و به اینجا پاس داده می‌شود: bcrypt
 * چند صد میلی‌ثانیه CPU می‌خواهد و اجرای آن داخل تراکنش، قفل‌ها را بی‌دلیل باز
 * نگه می‌داشت و دقیقاً همان چیزی است که به deadlock منجر می‌شود.
 */
async function linkAccountInTransaction(
  tx: TransactionClient,
  identity: PersonnelAccountIdentity,
  initialPasswordHash: string,
): Promise<LinkResult> {
  const existing = await tx.user.findUnique({ where: { nationalId: identity.nationalId } });

  if (!existing) {
    return {
      user: await tx.user.create({
        data: {
          nationalId: identity.nationalId,
          passwordHash: initialPasswordHash,
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
      user: await tx.user.update({
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
      user: await tx.user.update({
        where: { id: existing.id },
        data: {
          firstName: identity.firstName,
          lastName: identity.lastName,
          departmentId: identity.departmentId,
          personnelId: identity.personnelId,
          active: true,
          ...(reactivating
            ? {
                passwordHash: initialPasswordHash,
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

/**
 * حساب ورود پرسنل را می‌سازد یا حساب متصل‌نشدهٔ موجود با همان کد ملی را به پرونده وصل می‌کند.
 * اگر کد ملی به پروندهٔ دیگری متصل باشد، خطای تداخل پرتاب می‌شود.
 *
 * تمام مسیر (خواندن + ساخت/به‌روزرسانی) اتمیک است، بنابراین دو کلیک سریع
 * سرپرستار هرگز دو حساب یا یک خطای «کد ملی تکراری» تولید نمی‌کند.
 */
export async function createOrAdoptPersonnelAccount(
  identity: PersonnelAccountIdentity,
): Promise<LinkResult> {
  // bcrypt پیش از باز شدن تراکنش اجرا می‌شود تا هیچ قفلی منتظر CPU نماند.
  const initialPasswordHash = await hashPassword(DEFAULT_INITIAL_PASSWORD);

  return withMutex(accountLockKey(identity.nationalId), async () => {
    try {
      return await runInTransaction(
        tx => linkAccountInTransaction(tx, identity, initialPasswordHash),
        { label: 'account-link' },
      );
    } catch (error) {
      // آخرین خط دفاع در برابر رقابت بین چند نمونهٔ سرور: رکورد در فاصلهٔ بین
      // findUnique و create ساخته شده است. یک‌بار دیگر با وضعیت تازه تلاش می‌کنیم.
      if (isUniqueConstraintError(error)) {
        return runInTransaction(
          tx => linkAccountInTransaction(tx, identity, initialPasswordHash),
          { label: 'account-link-retry' },
        );
      }
      throw error;
    }
  });
}

/**
 * ساخت حساب پرسنلِ «متصل‌نشده» برای ورود اولیه یا درخواست بازیابی رمز.
 *
 * در شرایط رقابتی (دو کلیک سریع روی «ورود» یا «فراموشی رمز») تضمین می‌شود که
 * فقط یک حساب ساخته شود و هر دو درخواست همان حساب را دریافت کنند.
 */
export async function createUnlinkedStaffAccount(input: {
  nationalId: string;
  departmentId: string;
  passwordHash?: string;
  withResetRequest?: boolean;
}) {
  // هش رمز پیش از قفل و تراکنش آماده می‌شود (bcrypt کار سنگین CPU است).
  const passwordHash = input.passwordHash || await hashPassword(DEFAULT_INITIAL_PASSWORD);

  return withMutex(accountLockKey(input.nationalId), async () => {
    const createData = {
      nationalId: input.nationalId,
      passwordHash,
      // نام واقعی هنگام اتصال حساب به پروندهٔ پرسنلی توسط سرپرستار جایگزین می‌شود.
      firstName: 'پرسنل ثبت‌نشده',
      lastName: `(کد ملی ${input.nationalId})`,
      role: 'PERSONNEL' as const,
      departmentId: input.departmentId,
      active: true,
      mustChangePassword: true,
      hasResetRequest: !!input.withResetRequest,
      resetRequestedAt: input.withResetRequest ? new Date() : null,
    };

    try {
      return await runInTransaction(async (tx) => {
        // خواندن داخل همان تراکنشِ نوشتن انجام می‌شود تا پنجرهٔ رقابتی حذف شود.
        const existing = await tx.user.findUnique({ where: { nationalId: input.nationalId } });
        if (existing) {
          // حساب از قبل هست: فقط در صورت نیاز پرچم درخواست بازیابی ثبت می‌شود.
          if (input.withResetRequest && !existing.hasResetRequest) {
            return tx.user.update({
              where: { id: existing.id },
              data: { hasResetRequest: true, resetRequestedAt: new Date() },
            });
          }
          return existing;
        }
        return tx.user.create({ data: createData });
      }, { label: 'unlinked-staff-account' });
    } catch (error) {
      // شرایط رقابتی بین چند نمونهٔ سرور: همان کد ملی هم‌زمان ساخته شده است.
      // به‌جای خطای «کد ملی تکراری» همان حساب موجود برگردانده می‌شود.
      if (isUniqueConstraintError(error)) {
        const existing = await runInTransaction(
          tx => tx.user.findUnique({ where: { nationalId: input.nationalId } }),
          { label: 'unlinked-staff-account-recover' },
        );
        if (existing) return existing;
      }
      throw error;
    }
  });
}
