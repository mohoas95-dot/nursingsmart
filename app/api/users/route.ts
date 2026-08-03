import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../lib/auth/http';
import { AuthenticationError, requireCurrentUser } from '../../../lib/auth/session';
import { dbRead, runInTransaction, withMutex, isUniqueConstraintError } from '../../../lib/db';
import { createUserWithDefaultPassword } from '../../../lib/auth/userService';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from '../../../lib/auth/password';
import { NationalIdSchema } from '../../../lib/auth/validation';
import {
  AccountLinkConflictError,
  createOrAdoptPersonnelAccount,
  isAdoptableAccount,
} from '../../../lib/auth/accountLinking';

const CreateUserSchema = z.object({
  nationalId: NationalIdSchema,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  role: z.enum(['ADMIN', 'HEAD_NURSE', 'PERSONNEL']).default('PERSONNEL'),
  departmentId: z.string().min(1).max(128).nullable().optional(),
  personnelId: z.string().min(1).max(128).nullable().optional(),
}).strict();

/** فیلدهای عمومی حساب؛ ارسال کل رکورد، هشِ رمز عبور را لو می‌داد. */
function publicUser(user: {
  id: string; nationalId: string; firstName: string; lastName: string;
  role: string; mustChangePassword: boolean;
}) {
  return {
    id: user.id,
    nationalId: user.nationalId,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    const input = CreateUserSchema.parse(await request.json());
    if (actor.role === 'HEAD_NURSE') {
      if (input.role !== 'PERSONNEL' || !actor.departmentId || input.departmentId !== actor.departmentId) {
        throw new AuthenticationError(403, 'سرپرستار فقط می‌تواند برای پرسنل بخش خود حساب بسازد.');
      }
    }

    // همهٔ مسیرهای این هندلر الگوی «بخوان → تصمیم بگیر → بنویس» دارند. بدون
    // سریال‌سازی، دو کلیک روی «ثبت پرسنل» دو حساب رقیب یا خطای «کد ملی تکراری»
    // می‌ساخت. کلید قفل همان کلید یکتای پایگاه داده (کد ملی) است.
    return await withMutex(`user:nationalId:${input.nationalId}`, async () => {
      const requestedDepartmentId = input.departmentId || null;
      const existing = await dbRead(
        client => client.user.findUnique({ where: { nationalId: input.nationalId } }),
        { label: 'user-create-precheck' },
      );

      if (!existing) {
        // createUserWithDefaultPassword خودش در برابر رقابت مقاوم است و در صورت
        // ساخت هم‌زمان، همان رکورد موجود را برمی‌گرداند.
        const user = await createUserWithDefaultPassword(input);
        return authJson({
          success: true,
          user: publicUser(user),
          message: 'حساب کاربری با رمز اولیه ۱۲۳۴ ساخته شد.',
        }, { status: 201 });
      }

      if (!existing.active && existing.role === 'PERSONNEL' && input.role === 'PERSONNEL' &&
          existing.departmentId === requestedDepartmentId) {
        // هش رمز پیش از تراکنش آماده می‌شود تا bcrypt قفل ردیف را نگه ندارد.
        const passwordHash = await hashPassword(DEFAULT_INITIAL_PASSWORD);
        const reactivated = await runInTransaction(tx => tx.user.update({
          where: { id: existing.id },
          data: {
            personnelId: input.personnelId || null,
            firstName: input.firstName,
            lastName: input.lastName,
            passwordHash,
            active: true,
            mustChangePassword: true,
            hasResetRequest: false,
          },
        }), { label: 'user-reactivate' });
        return authJson({
          success: true,
          user: publicUser(reactivated),
          message: 'حساب پرسنل با رمز اولیه ۱۲۳۴ دوباره فعال شد.',
        });
      }

      // حساب «متصل‌نشده»: هنگام اولین ورود پرسنل یا ثبت درخواست بازیابی رمز، حسابی با
      // همین کد ملی ساخته می‌شود که هنوز به هیچ پروندهٔ پرسنلی وصل نیست. اکنون که سرپرستار
      // پرونده را ثبت می‌کند، همان حساب به پرونده وصل و نام واقعی روی آن ثبت می‌شود؛ در
      // غیر این صورت کاربر با خطای «این کد ملی قبلاً ثبت شده است» روبه‌رو می‌شد.
      if (input.personnelId &&
          requestedDepartmentId &&
          input.role === 'PERSONNEL' &&
          isAdoptableAccount(existing, requestedDepartmentId)) {
        const linked = await createOrAdoptPersonnelAccount({
          nationalId: input.nationalId,
          firstName: input.firstName,
          lastName: input.lastName,
          departmentId: requestedDepartmentId,
          personnelId: input.personnelId,
        });
        return authJson({
          success: true,
          user: publicUser(linked.user),
          message: linked.passwordReset
            ? 'حساب ورود این کد ملی دوباره فعال و به پروندهٔ پرسنل متصل شد؛ رمز عبور به ۱۲۳۴ بازنشانی گردید.'
            : 'حساب ورود موجود با این کد ملی به پروندهٔ این پرسنل متصل شد؛ رمز فعلی کاربر تغییر نکرد.',
        });
      }

      // If the existing user is the head nurse (sarparastar) of this department, link their personnelId
      if (existing.role === 'HEAD_NURSE' && existing.departmentId === requestedDepartmentId) {
        const updated = await runInTransaction(tx => tx.user.update({
          where: { id: existing.id },
          data: { personnelId: input.personnelId || existing.personnelId || null },
        }), { label: 'user-link-headnurse' });
        return authJson({
          success: true,
          user: publicUser(updated),
          message: 'حساب سرپرستار با موفقیت به پرسنل بخش متصل گردید.',
        });
      }

      const isSameAccount = existing.role === input.role &&
        existing.departmentId === requestedDepartmentId &&
        existing.personnelId === (input.personnelId || null);
      if (!isSameAccount) {
        return authJson({ success: false, error: 'این کد ملی قبلاً برای حساب دیگری ثبت شده است.' }, { status: 409 });
      }
      // درخواست تکراری با همان مشخصات: پاسخ موفق (idempotent) تا کلیک دوم خطا ندهد.
      return authJson({
        success: true,
        user: publicUser(existing),
        message: 'حساب کاربری پرسنل قبلاً ایجاد شده و آماده استفاده است.',
      });
    });
  } catch (error) {
    if (error instanceof AccountLinkConflictError) {
      return authJson({ success: false, error: error.message }, { status: 409 });
    }
    // رقابت بین چند نمونهٔ سرور روی همان کد ملی: پیام شفاف به‌جای خطای ۵۰۰.
    if (isUniqueConstraintError(error)) {
      return authJson({ success: false, error: 'این کد ملی قبلاً برای حساب دیگری ثبت شده است.' }, { status: 409 });
    }
    return authErrorResponse(error);
  }
}
