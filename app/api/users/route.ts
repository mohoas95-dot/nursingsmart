import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../lib/auth/http';
import { AuthenticationError, requireCurrentUser } from '../../../lib/auth/session';
import { createUserWithDefaultPassword } from '../../../lib/auth/userService';
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
