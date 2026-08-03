import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, authErrorResponse, authJson } from '../../../../../lib/auth/http';
import { AuthenticationError, requireCurrentUser } from '../../../../../lib/auth/session';
import { NationalIdSchema } from '../../../../../lib/auth/validation';
import {
  dbRead,
  runInTransaction,
  withMutex,
  isUniqueConstraintError,
  type TransactionClient,
} from '../../../../../lib/db';
import {
  AccountLinkConflictError,
  createOrAdoptPersonnelAccount,
} from '../../../../../lib/auth/accountLinking';

const UpdateNationalIdSchema = z.object({
  nationalId: NationalIdSchema,
  // نام و نام خانوادگی فقط زمانی لازم است که حساب ورود هنوز ساخته نشده باشد.
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  departmentId: z.string().min(1).max(128).optional(),
}).strict();

type Actor = Awaited<ReturnType<typeof requireCurrentUser>>;
type ManagedUser = { id: string; departmentId: string | null; nationalId: string; firstName: string; lastName: string };

function assertCanManage(actor: Actor, user: { departmentId: string | null }, action: string) {
  if (actor.role === 'HEAD_NURSE' && (!actor.departmentId || actor.departmentId !== user.departmentId)) {
    throw new AuthenticationError(403, action);
  }
}

/** خواندن حساب پرسنل با کنترل دسترسی، از طریق کلاینت داده‌شده (اصلی یا تراکنش). */
async function findManagedPersonnelUser(
  client: { user: { findUnique: (args: { where: { personnelId: string } }) => Promise<ManagedUser | null> } },
  actor: Actor,
  personnelId: string,
  action = 'اجازه مشاهده یا ویرایش حساب این پرسنل را ندارید.',
) {
  const user = await client.user.findUnique({ where: { personnelId } });
  if (!user) return null;
  assertCanManage(actor, user, action);
  return user;
}

function resolveDepartmentId(actor: Actor, requested?: string) {
  const departmentId = actor.role === 'HEAD_NURSE' ? actor.departmentId : (requested || actor.departmentId);
  if (!departmentId) {
    throw new AuthenticationError(403, 'برای ساخت حساب ورود، بخش پرسنل مشخص نشده است.');
  }
  return departmentId;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ personnelId: string }> },
) {
  try {
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    const { personnelId } = await context.params;
    const user = await dbRead(client => client.user.findUnique({ where: { personnelId } }), {
      label: 'personnel-account-read',
    });
    // پرسنل قدیمی ممکن است هنوز حساب ورود نداشته باشد. در این حالت به‌جای خطای ۴۰۳
    // (که ویرایش پرسنل را کاملاً مسدود می‌کرد) وضعیت «بدون حساب» برگردانده می‌شود تا
    // سرپرستار بتواند با ثبت کد ملی، حساب ورود او را همان‌جا بسازد.
    if (!user) {
      return authJson({ success: true, hasAccount: false, nationalId: '' });
    }
    assertCanManage(actor, user, 'اجازه مشاهده یا ویرایش حساب این پرسنل را ندارید.');
    return authJson({
      success: true,
      hasAccount: true,
      nationalId: user.nationalId,
      active: user.active,
      mustChangePassword: user.mustChangePassword,
      hasResetRequest: user.hasResetRequest,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ personnelId: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    const { personnelId } = await context.params;
    const input = UpdateNationalIdSchema.parse(await request.json());

    // ثبت هم‌زمان همان پروندهٔ پرسنلی (دو کلیک روی «ذخیره») می‌توانست دو حساب یا
    // یک به‌روزرسانی نیمه‌کاره بسازد؛ عملیات به‌ازای پرونده سریال می‌شود.
    return await withMutex(`personnel-account:${personnelId}`, async () => {
      const existingUser = await dbRead(
        client => client.user.findUnique({ where: { personnelId } }),
        { label: 'personnel-account-precheck' },
      );

      if (!existingUser) {
        // حساب ورود وجود ندارد → ساخته می‌شود یا حساب متصل‌نشدهٔ موجود با همان کد ملی
        // (که هنگام ورود یا درخواست بازیابی ساخته شده) به این پرونده وصل می‌گردد.
        const departmentId = resolveDepartmentId(actor, input.departmentId);
        const created = await createOrAdoptPersonnelAccount({
          nationalId: input.nationalId,
          firstName: input.firstName || 'پرسنل',
          lastName: input.lastName || 'بخش',
          departmentId,
          personnelId,
        });
        return authJson({
          success: true,
          nationalId: input.nationalId,
          hasAccount: true,
          created: created.created,
          adopted: created.adopted,
          message: created.adopted
            ? (created.passwordReset
                ? 'حساب ورود این کد ملی دوباره فعال و به پرونده متصل شد؛ رمز عبور به ۱۲۳۴ بازنشانی گردید.'
                : 'حساب ورود موجود با این کد ملی به پروندهٔ این پرسنل متصل شد؛ رمز فعلی کاربر تغییر نکرد.')
            : 'حساب ورود این پرسنل با رمز اولیه ۱۲۳۴ ساخته شد.',
        });
      }

      assertCanManage(actor, existingUser, 'اجازه مشاهده یا ویرایش حساب این پرسنل را ندارید.');

      // پیش‌تر تغییر کد ملی و تغییر نام دو `update` جدا بودند: اگر دومی خطا می‌داد،
      // کد ملی عوض‌شده بود ولی نام قدیمی می‌ماند. اکنون همه در یک تراکنش اتمیک و
      // به‌صورت یک `update` واحد اعمال می‌شوند.
      try {
        const outcome = await runInTransaction(async (tx: TransactionClient) => {
          const user = await findManagedPersonnelUser(tx, actor, personnelId);
          if (!user) return { status: 'vanished' as const };

          const changes: Record<string, string> = {};
          if (user.nationalId !== input.nationalId) {
            const conflicting = await tx.user.findUnique({ where: { nationalId: input.nationalId } });
            if (conflicting && conflicting.id !== user.id) return { status: 'conflict' as const };
            changes.nationalId = input.nationalId;
          }
          // نام حساب ورود با نام پروندهٔ پرسنلی هم‌راستا نگه داشته می‌شود تا در فهرست
          // درخواست‌های بازیابی رمز، نام واقعی پرسنل نمایش داده شود.
          if (input.firstName && input.firstName !== user.firstName) changes.firstName = input.firstName;
          if (input.lastName && input.lastName !== user.lastName) changes.lastName = input.lastName;

          if (Object.keys(changes).length > 0) {
            await tx.user.update({ where: { id: user.id }, data: changes });
          }
          return { status: 'updated' as const };
        }, { label: 'personnel-account-update' });

        if (outcome.status === 'conflict') {
          return authJson({ success: false, error: 'این کد ملی قبلاً برای حساب دیگری ثبت شده است.' }, { status: 409 });
        }
        if (outcome.status === 'vanished') {
          return authJson({
            success: false,
            error: 'حساب این پرسنل هم‌زمان حذف شد؛ صفحه را تازه‌سازی کنید.',
          }, { status: 409 });
        }
      } catch (error) {
        // رقابت بین دو سرور روی همان کد ملی: پیام شفاف به‌جای خطای ۵۰۰.
        if (isUniqueConstraintError(error)) {
          return authJson({ success: false, error: 'این کد ملی قبلاً برای حساب دیگری ثبت شده است.' }, { status: 409 });
        }
        throw error;
      }

      return authJson({ success: true, nationalId: input.nationalId, hasAccount: true });
    });
  } catch (error) {
    if (error instanceof AccountLinkConflictError) {
      return authJson({ success: false, error: error.message }, { status: 409 });
    }
    return authErrorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ personnelId: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    const { personnelId } = await context.params;

    return await withMutex(`personnel-account:${personnelId}`, async () => {
      const outcome = await runInTransaction(async (tx) => {
        const user = await tx.user.findUnique({ where: { personnelId } });
        // حذف قبلاً انجام شده است: پاسخ موفق تا کلیک دوم خطا تولید نکند (idempotent).
        if (!user) return { status: 'absent' as const };
        if (actor.role === 'HEAD_NURSE' && (!actor.departmentId || actor.departmentId !== user.departmentId)) {
          return { status: 'forbidden' as const };
        }

        // غیرفعال‌سازی حساب و ابطال نشست‌ها باید اتمیک باشد، وگرنه کاربرِ
        // «غیرفعال‌شده» با نشست باقی‌مانده همچنان دسترسی داشت.
        await tx.session.deleteMany({ where: { userId: user.id } });
        await tx.user.update({
          where: { id: user.id },
          data: { active: false, hasResetRequest: false, resetRequestedAt: null },
        });
        return { status: 'deactivated' as const };
      }, { label: 'personnel-account-delete' });

      if (outcome.status === 'forbidden') {
        throw new AuthenticationError(403, 'اجازه حذف حساب این پرسنل را ندارید.');
      }
      if (outcome.status === 'absent') return authJson({ success: true });
      return authJson({ success: true, message: 'حساب ورود پرسنل غیرفعال شد.' });
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
