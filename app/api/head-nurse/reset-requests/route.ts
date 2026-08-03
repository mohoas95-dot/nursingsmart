import { dbRead } from '../../../../lib/db';
import { authErrorResponse, authJson } from '../../../../lib/auth/http';
import { AuthenticationError, requireCurrentUser } from '../../../../lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const actor = await requireCurrentUser({ roles: ['ADMIN', 'HEAD_NURSE'] });
    if (actor.role === 'HEAD_NURSE' && !actor.departmentId) {
      throw new AuthenticationError(403, 'برای حساب سرپرستار بخش مشخص نشده است.');
    }

    // این مسیر هر ۲۰ ثانیه از چند تب فراخوانی می‌شود؛ تلاش مجدد خودکار مانع از
    // آن می‌شود که یک اختلال لحظه‌ای، فهرست درخواست‌ها را در پنل خالی نشان دهد.
    const users = await dbRead(client => client.user.findMany({
      where: {
        hasResetRequest: true,
        // حساب‌های غیرفعال هم نمایش داده می‌شوند؛ در غیر این صورت درخواست پرسنلی که
        // حسابش موقتاً غیرفعال شده بی‌صدا ناپدید می‌شد و سرپرستار متوجه آن نمی‌شد.
        ...(actor.role === 'HEAD_NURSE' ? { departmentId: actor.departmentId } : {}),
      },
      select: {
        id: true,
        nationalId: true,
        firstName: true,
        lastName: true,
        departmentId: true,
        personnelId: true,
        active: true,
        resetRequestedAt: true,
      },
      orderBy: [{ resetRequestedAt: 'asc' }, { lastName: 'asc' }],
    }), { label: 'reset-requests-list' });
    return authJson({ success: true, users, count: users.length });
  } catch (error) {
    return authErrorResponse(error);
  }
}
