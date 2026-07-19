import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../lib/auth/http';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from '../../../../lib/auth/password';
import { NationalIdSchema } from '../../../../lib/auth/validation';
import { INITIAL_SETTINGS } from '../../../../lib/mockData';
import { prisma } from '../../../../lib/prisma';
import {
  createDepartmentStorage,
  StorageConflictError,
  StorageUnavailableError,
  StorageValidationError,
} from '../../../../lib/s3Storage';

const HeadNurseOnboardingSchema = z.object({
  departmentName: z.string().trim().min(2, 'نام بخش را وارد کنید.').max(200),
  firstName: z.string().trim().min(2, 'نام را وارد کنید.').max(100),
  lastName: z.string().trim().min(2, 'نام خانوادگی را وارد کنید.').max(100),
  nationalId: NationalIdSchema,
}).strict();

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = HeadNurseOnboardingSchema.parse(await request.json());
    const existingUser = await prisma.user.findUnique({ where: { nationalId: input.nationalId } });
    if (existingUser?.active) {
      return authJson({ success: false, error: 'برای این کد ملی قبلاً حساب کاربری ساخته شده است.' }, { status: 409 });
    }
    if (existingUser && existingUser.role !== 'HEAD_NURSE') {
      return authJson({ success: false, error: 'این کد ملی قابل ثبت به‌عنوان سرپرستار نیست.' }, { status: 409 });
    }

    const departmentId = existingUser?.departmentId || `dept_${randomUUID().replaceAll('-', '')}`;
    const user = existingUser || await prisma.user.create({
      data: {
        nationalId: input.nationalId,
        passwordHash: await hashPassword(DEFAULT_INITIAL_PASSWORD),
        firstName: input.firstName,
        lastName: input.lastName,
        role: 'HEAD_NURSE',
        departmentId,
        active: false,
        mustChangePassword: true,
        hasResetRequest: false,
      },
    });

    await createDepartmentStorage({
      id: departmentId,
      name: input.departmentName,
      settings: {
        activeYear: 1405,
        settings_system: INITIAL_SETTINGS,
        // Kept only for compatibility with the legacy JSON shape; no secret is stored here.
        settings_credentials: { username: 'prisma-managed', password: '' },
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        departmentId,
        role: 'HEAD_NURSE',
        active: true,
        mustChangePassword: true,
        hasResetRequest: false,
      },
    });

    return authJson({
      success: true,
      department: { id: departmentId, name: input.departmentName },
      message: 'بخش و حساب سرپرستار با موفقیت ساخته شد. با رمز اولیه ۱۲۳۴ وارد شوید.',
    }, { status: 201 });
  } catch (error) {
    if (error instanceof StorageConflictError) {
      return authJson({ success: false, error: 'نام این بخش قبلاً ثبت شده است.' }, { status: 409 });
    }
    if (error instanceof StorageValidationError) {
      return authJson({ success: false, error: 'اطلاعات بخش معتبر نیست.' }, { status: 422 });
    }
    if (error instanceof StorageUnavailableError) {
      return authJson({ success: false, error: 'فضای ذخیره‌سازی موقتاً در دسترس نیست.' }, { status: 503 });
    }
    return authErrorResponse(error);
  }
}
