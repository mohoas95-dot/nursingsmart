import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../lib/auth/http';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from '../../../../lib/auth/password';
import { NationalIdSchema } from '../../../../lib/auth/validation';
import { INITIAL_SETTINGS } from '../../../../lib/mockData';
import { runInTransaction, withMutex, isUniqueConstraintError } from '../../../../lib/db';
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

    // دو کلیک روی «ساخت بخش» می‌توانست دو بخش با نام یکسان و دو حساب سرپرستار
    // بسازد. قفل به‌ازای کد ملی، ساخت هم‌زمان را سریال می‌کند.
    return await withMutex(`onboarding:${input.nationalId}`, () => performOnboarding(input));
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}

async function performOnboarding(input: z.infer<typeof HeadNurseOnboardingSchema>) {
  // bcrypt پیش از هر تراکنشی اجرا می‌شود تا قفلی را معطل CPU نگه ندارد.
  const passwordHash = await hashPassword(DEFAULT_INITIAL_PASSWORD);

  // مرحلهٔ ۱ — رزرو حسابِ سرپرستار به‌صورت اتمیک، در وضعیت غیرفعال.
  // حساب عمداً `active: false` ساخته می‌شود: تا وقتی اسناد ابری بخش کامل نشده،
  // ورود با آن نباید ممکن باشد.
  const reservation = await runInTransaction(async (tx) => {
    const existingUser = await tx.user.findUnique({ where: { nationalId: input.nationalId } });
    if (existingUser?.active) return { status: 'active-account' as const };
    if (existingUser && existingUser.role !== 'HEAD_NURSE') return { status: 'not-eligible' as const };

    const departmentId = existingUser?.departmentId || `dept_${randomUUID().replaceAll('-', '')}`;
    if (existingUser) {
      // تلاش مجدد پس از یک شکست میانی: همان حساب رزروشده دوباره استفاده می‌شود.
      const user = await tx.user.update({
        where: { id: existingUser.id },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          departmentId,
          role: 'HEAD_NURSE',
        },
      });
      return { status: 'reserved' as const, userId: user.id, departmentId };
    }

    const user = await tx.user.create({
      data: {
        nationalId: input.nationalId,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: 'HEAD_NURSE',
        departmentId,
        active: false,
        mustChangePassword: true,
        hasResetRequest: false,
      },
    });
    return { status: 'reserved' as const, userId: user.id, departmentId };
  }, { label: 'onboarding-reserve-account' });

  if (reservation.status === 'active-account') {
    return authJson({ success: false, error: 'برای این کد ملی قبلاً حساب کاربری ساخته شده است.' }, { status: 409 });
  }
  if (reservation.status === 'not-eligible') {
    return authJson({ success: false, error: 'این کد ملی قابل ثبت به‌عنوان سرپرستار نیست.' }, { status: 409 });
  }

  const { userId, departmentId } = reservation;

  // مرحلهٔ ۲ — ساخت اسناد ابری بخش. عمداً بیرون از تراکنش پایگاه داده است:
  // فراخوانی شبکه‌ای کند داخل تراکنش، اتصال و قفل‌ها را برای ثانیه‌ها نگه می‌داشت
  // و منبع اصلی خطاهای «قفل شدن دیتابیس» زیر بار هم‌زمان است.
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

  // مرحلهٔ ۳ — فعال‌سازی حساب پس از آماده شدن کامل بخش.
  await runInTransaction(tx => tx.user.update({
    where: { id: userId },
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      departmentId,
      role: 'HEAD_NURSE',
      active: true,
      mustChangePassword: true,
      hasResetRequest: false,
    },
  }), { label: 'onboarding-activate-account' });

  return authJson({
    success: true,
    department: { id: departmentId, name: input.departmentName },
    message: 'بخش و حساب سرپرستار با موفقیت ساخته شد. با رمز اولیه ۱۲۳۴ وارد شوید.',
  }, { status: 201 });
}

function onboardingErrorResponse(error: unknown) {
  if (error instanceof StorageConflictError) {
    return authJson({ success: false, error: 'نام این بخش قبلاً ثبت شده است.' }, { status: 409 });
  }
  if (error instanceof StorageValidationError) {
    return authJson({ success: false, error: 'اطلاعات بخش معتبر نیست.' }, { status: 422 });
  }
  if (error instanceof StorageUnavailableError) {
    const response = authJson({
      success: false,
      error: 'فضای ذخیره‌سازی موقتاً در دسترس نیست.',
      retryable: true,
    }, { status: 503 });
    response.headers.set('Retry-After', '5');
    return response;
  }
  if (isUniqueConstraintError(error)) {
    return authJson({
      success: false,
      error: 'برای این کد ملی هم‌زمان حساب دیگری ساخته شد؛ لطفاً دوباره تلاش کنید.',
    }, { status: 409 });
  }
  return authErrorResponse(error);
}
