import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../lib/auth/http';
import { AuthenticationError, requireCurrentUser } from '../../../lib/auth/session';
import { prisma } from '../../../lib/prisma';
import { createUserWithDefaultPassword } from '../../../lib/auth/userService';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from '../../../lib/auth/password';
import { NationalIdSchema } from '../../../lib/auth/validation';

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
        return authJson({ success: true, user: reactivated, message: 'حساب پرسنل با رمز اولیه ۱۲۳۴ دوباره فعال شد.' });
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
    return authErrorResponse(error);
  }
}
