import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../lib/auth/http';
import { AuthenticationError, requireCurrentUser } from '../../../lib/auth/session';
import { prisma } from '../../../lib/prisma';
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
    const existing = await prisma.user.findUnique({ where: { nationalId: input.nationalId } });
    if (existing) {
      const requestedDepartmentId = input.departmentId || null;
      if (!existing.active && existing.role === 'PERSONNEL' && input.role === 'PERSONNEL' && existing.departmentId === requestedDepartmentId) {
        const reactivated = await prisma.user.update({
          where: { id: existing.id },
          data: {
            personnelId: input.personnelId || null,
            firstName: input.firstName,
            lastName: input.lastName,
            passwordHash: await hashPassword(DEFAULT_INITIAL_PASSWORD),
            active: true,
            mustChangePassword: true,
            hasResetRequest: false,
          },
        });
        // فقط فیلدهای عمومی برگردانده می‌شود؛ ارسال کل رکورد، هشِ رمز عبور را لو می‌داد.
        return authJson({
          success: true,
          user: {
            id: reactivated.id,
            nationalId: reactivated.nationalId,
            firstName: reactivated.firstName,
            lastName: reactivated.lastName,
            role: reactivated.role,
            mustChangePassword: reactivated.mustChangePassword,
          },
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
          user: {
            id: linked.user.id,
            nationalId: linked.user.nationalId,
            firstName: linked.user.firstName,
            lastName: linked.user.lastName,
            role: linked.user.role,
            mustChangePassword: linked.user.mustChangePassword,
          },
          message: linked.passwordReset
            ? 'حساب ورود این کد ملی دوباره فعال و به پروندهٔ پرسنل متصل شد؛ رمز عبور به ۱۲۳۴ بازنشانی گردید.'
            : 'حساب ورود موجود با این کد ملی به پروندهٔ این پرسنل متصل شد؛ رمز فعلی کاربر تغییر نکرد.',
        });
      }

      // If the existing user is the head nurse (sarparastar) of this department, link their personnelId
      if (existing.role === 'HEAD_NURSE' && existing.departmentId === requestedDepartmentId) {
        const updated = await prisma.user.update({
          where: { id: existing.id },
          data: {
            personnelId: input.personnelId || existing.personnelId || null,
          },
        });
        return authJson({
          success: true,
          user: {
            id: updated.id,
            nationalId: updated.nationalId,
            firstName: updated.firstName,
            lastName: updated.lastName,
            role: updated.role,
            mustChangePassword: updated.mustChangePassword,
          },
          message: 'حساب سرپرستار با موفقیت به پرسنل بخش متصل گردید.',
        });
      }

      const isSameAccount = existing.role === input.role &&
        existing.departmentId === requestedDepartmentId &&
        existing.personnelId === (input.personnelId || null);
      if (!isSameAccount) {
        return authJson({ success: false, error: 'این کد ملی قبلاً برای حساب دیگری ثبت شده است.' }, { status: 409 });
      }
      return authJson({
        success: true,
        user: {
          id: existing.id,
          nationalId: existing.nationalId,
          firstName: existing.firstName,
          lastName: existing.lastName,
          role: existing.role,
          mustChangePassword: existing.mustChangePassword,
        },
        message: 'حساب کاربری پرسنل قبلاً ایجاد شده و آماده استفاده است.',
      });
    }
    const user = await createUserWithDefaultPassword(input);
    return authJson({
      success: true,
      user: {
        id: user.id,
        nationalId: user.nationalId,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      message: 'حساب کاربری با رمز اولیه ۱۲۳۴ ساخته شد.',
    }, { status: 201 });
  } catch (error) {
    if (error instanceof AccountLinkConflictError) {
      return authJson({ success: false, error: error.message }, { status: 409 });
    }
    return authErrorResponse(error);
  }
}
