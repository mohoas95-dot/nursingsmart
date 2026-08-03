import 'server-only';
import { dbWrite, runInTransaction, withMutex, isUniqueConstraintError } from '../db';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from './password';
import { NationalIdSchema } from './validation';

export type CreateUserInput = {
  nationalId: string;
  firstName: string;
  lastName: string;
  role?: 'ADMIN' | 'HEAD_NURSE' | 'PERSONNEL';
  departmentId?: string | null;
  personnelId?: string | null;
};

/**
 * ساخت حساب کاربری با رمز اولیه.
 *
 * در برابر ساخت هم‌زمانِ همان کد ملی مقاوم است: اگر رکورد در فاصلهٔ بررسی و
 * درج توسط درخواست دیگری ساخته شود، به‌جای خطای «کد ملی تکراری» همان رکورد
 * موجود برگردانده می‌شود (رفتار idempotent برای دو کلیک سریع).
 */
export async function createUserWithDefaultPassword(input: CreateUserInput) {
  const nationalId = NationalIdSchema.parse(input.nationalId);
  // bcrypt پیش از گرفتن قفل/تراکنش اجرا می‌شود تا اتصال دیتابیس معطل CPU نماند.
  const passwordHash = await hashPassword(DEFAULT_INITIAL_PASSWORD);

  const data = {
    nationalId,
    passwordHash,
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    role: input.role || 'PERSONNEL',
    departmentId: input.departmentId || null,
    personnelId: input.personnelId || null,
    mustChangePassword: true,
    hasResetRequest: false,
  };

  return withMutex(`user:nationalId:${nationalId}`, async () => {
    try {
      return await dbWrite(client => client.user.create({ data }), { label: 'user-create' });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const existing = await runInTransaction(
          tx => tx.user.findUnique({ where: { nationalId } }),
          { label: 'user-create-recover' },
        );
        if (existing) return existing;
      }
      throw error;
    }
  });
}
