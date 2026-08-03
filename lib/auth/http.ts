import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AuthenticationError } from './session';
import {
  classifyDbError,
  describeDbError,
  isDatabaseError,
  isUniqueConstraintError,
  uniqueConstraintTargets,
} from '../db/errors';
import { DbRetryExhaustedError } from '../db/retry';
import { MutexBusyError } from '../db/mutex';

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') throw new AuthenticationError(403, 'درخواست غیرمجاز است.');
  if (origin && new URL(origin).host !== request.nextUrl.host) {
    throw new AuthenticationError(403, 'مبدأ درخواست معتبر نیست.');
  }
}

export function authJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/**
 * پاسخ استاندارد خطای موقت به‌همراه هدر `Retry-After`.
 * کلاینت با دیدن این هدر می‌داند که عملیات قابل تکرار است و چقدر باید صبر کند.
 */
function retryableJson(body: Record<string, unknown>, status: number, retryAfterSeconds?: number) {
  const response = authJson({ ...body, retryable: true }, { status });
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    response.headers.set('Retry-After', String(Math.ceil(retryAfterSeconds)));
  }
  return response;
}

/**
 * تبدیل هر خطای مسیرهای احراز هویت/کاربران به پاسخ HTTP امن و استاندارد.
 *
 * ترتیب بررسی اهمیت دارد: خطاهای معنادار دامنه پیش از خطاهای عمومی دیتابیس
 * بررسی می‌شوند تا پیام دقیق‌تری به کاربر برسد.
 */
export function authErrorResponse(error: unknown) {
  if (error instanceof AuthenticationError) {
    return authJson({ success: false, error: error.message }, { status: error.status });
  }

  if (error instanceof ZodError) {
    return authJson({
      success: false,
      error: error.issues[0]?.message || 'اطلاعات واردشده معتبر نیست.',
      issues: error.issues,
    }, { status: 400 });
  }

  // درخواست‌های هم‌زمان بیش از حد روی یک منبع (محافظ ضدِ کلیک سریع/سیل درخواست).
  if (error instanceof MutexBusyError) {
    return retryableJson(
      { success: false, code: 'CONCURRENT_REQUEST_LIMIT', error: error.message },
      error.status,
      error.retryAfterSeconds,
    );
  }

  // پس از پایان همهٔ تلاش‌های مجدد؛ خطای اصلی در cause نگهداری شده است.
  if (error instanceof DbRetryExhaustedError) {
    const info = classifyDbError(error.cause);
    console.error(`[auth-api] تلاش مجدد پایگاه داده ناموفق ماند (${error.attempts} تلاش):`, describeDbError(error.cause));
    return retryableJson(
      { success: false, code: 'DB_RETRY_EXHAUSTED', error: info.userMessage },
      info.httpStatus,
      info.retryAfterSeconds,
    );
  }

  // نقض قید یکتایی: پیام دقیق بر اساس فیلد درگیر.
  if (isUniqueConstraintError(error)) {
    const targets = uniqueConstraintTargets(error);
    const message = targets.some(target => target.toLowerCase().includes('nationalid'))
      ? 'این کد ملی قبلاً ثبت شده است.'
      : targets.some(target => target.toLowerCase().includes('personnelid'))
        ? 'برای این پروندهٔ پرسنلی قبلاً حساب ورود ساخته شده است.'
        : 'این اطلاعات قبلاً ثبت شده است.';
    return authJson({ success: false, code: 'UNIQUE_CONSTRAINT', error: message }, { status: 409 });
  }

  if (isDatabaseError(error)) {
    const info = classifyDbError(error);
    console.error('[auth-api] خطای پایگاه داده:', describeDbError(error));
    if (info.retryable) {
      return retryableJson(
        { success: false, code: 'DB_TEMPORARILY_UNAVAILABLE', error: info.userMessage },
        info.httpStatus,
        info.retryAfterSeconds,
      );
    }
    return authJson(
      { success: false, code: `DB_${info.kind.toUpperCase()}`, error: info.userMessage },
      { status: info.httpStatus },
    );
  }

  console.error('Authentication API error:', error);
  return authJson({ success: false, error: 'خطای داخلی سرور؛ دوباره تلاش کنید.' }, { status: 500 });
}
