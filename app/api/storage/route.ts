import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getCircuitBreakerStatus,
  getS3Client,
  readDatabaseState,
  resourceVersionId,
  StorageConfigurationError,
  StorageConflictError,
  StorageUnavailableError,
  StorageValidationError,
  writeResource,
  readResourceIfExists,
  writeResourceResolvingConflict,
} from '../../../lib/s3Storage';
import { StorageResourceSchema, type StorageResource } from '../../../lib/storageSchemas';
import {
  AuthenticationError,
  requireCurrentUser,
} from '../../../lib/auth/session';
import { assertSameOrigin } from '../../../lib/auth/http';
import {
  assertRequestOwnership,
  authorizeResourceWrite,
} from '../../../lib/auth/resource-authorization';
import { classifyDbError, describeDbError, isDatabaseError } from '../../../lib/db/errors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_REQUEST_BYTES = 5 * 1024 * 1024;
const WriteRequestSchema = z.object({
  resource: StorageResourceSchema,
  data: z.unknown(),
}).strict();

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthenticationError) {
    return noStoreJson({ success: false, code: 'AUTHORIZATION_FAILED', error: error.message }, { status: error.status });
  }
  if (error instanceof StorageConflictError) {
    return noStoreJson({ success: false, code: 'ETAG_CONFLICT', error: error.message }, { status: 409 });
  }
  if (error instanceof StorageValidationError) {
    return noStoreJson({
      success: false,
      code: 'VALIDATION_FAILED',
      error: error.message,
      issues: error.issues,
    }, { status: 422 });
  }
  if (error instanceof StorageUnavailableError || error instanceof StorageConfigurationError) {
    const circuit = getCircuitBreakerStatus();
    const response = noStoreJson({
      success: false,
      code: 'STORAGE_UNAVAILABLE',
      error: error.message,
      circuit: circuit.state,
      // پیکربندی ناقص با تلاش مجدد درست نمی‌شود؛ فقط قطعی موقت گذراست.
      retryable: error instanceof StorageUnavailableError,
    }, { status: 503 });
    const retryAfterSeconds = circuit.retryAfterMs > 0
      ? Math.max(1, Math.ceil(circuit.retryAfterMs / 1000))
      : (error instanceof StorageUnavailableError ? 3 : 0);
    if (retryAfterSeconds > 0) {
      response.headers.set('Retry-After', String(retryAfterSeconds));
    }
    return response;
  }

  // احراز هویت این مسیر به پایگاه داده وابسته است، پس خطای گذرای دیتابیس هم
  // ممکن است اینجا ظاهر شود و نباید به ۵۰۰ تبدیل گردد.
  if (isDatabaseError(error)) {
    const info = classifyDbError(error);
    console.error('[storage-api] خطای پایگاه داده:', describeDbError(error));
    const response = noStoreJson({
      success: false,
      code: info.retryable ? 'DB_TEMPORARILY_UNAVAILABLE' : `DB_${info.kind.toUpperCase()}`,
      error: info.userMessage,
      retryable: info.retryable,
    }, { status: info.httpStatus });
    if (info.retryAfterSeconds) {
      response.headers.set('Retry-After', String(info.retryAfterSeconds));
    }
    return response;
  }

  console.error('Unexpected storage API error:', error);
  return noStoreJson({
    success: false,
    code: 'INTERNAL_ERROR',
    error: 'خطای داخلی سرور',
  }, { status: 500 });
}

/** اعتبارسنجی کلید ماه (`YYYY_M`) پیش از استفاده در مسیر شیء S3. */
const MONTH_KEY_PATTERN = /^\d{4}_(?:[1-9]|1[0-2])$/;

/**
 * دریافت وضعیت پایگاه داده.
 *
 * پارامتر اختیاری `months` (جداشده با کاما، مثل `?months=1404_5,1404_6`) دامنهٔ
 * برنامه‌های ماهانهٔ بارگذاری‌شده را محدود می‌کند.
 *
 * ── چرا این تغییر ضروری بود؟ ────────────────────────────────────────────────
 * پیش‌تر این مسیر **همهٔ** برنامه‌های ماهانهٔ تاریخچه را می‌خواند. بخشی با دو سال
 * سابقه ۲۴ سند دارد و هر سند شامل تخصیص شیفت تمام پرسنل، هشدارها و لاگ
 * رویدادهاست. یعنی هر بار تازه‌سازی صفحه ممکن بود صدها کیلوبایت داده‌ای دانلود
 * شود که رابط کاربری هرگز نمایش نمی‌دهد — چون فقط ماه جاری دیده می‌شود.
 *
 * اکنون کلاینت فقط ماه‌های موردنیازش را می‌خواهد و `availableMonths` به او
 * می‌گوید چه ماه‌های دیگری وجود دارد تا در صورت نیاز آن‌ها را تنبل بگیرد.
 * برای سازگاری عقب‌رو، نبودِ پارامتر یعنی «همه» (مسیر مهاجرت/صادرات).
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireCurrentUser();
    if (actor.role !== 'ADMIN' && !actor.departmentId) {
      throw new AuthenticationError(403, 'برای حساب کاربری بخش مشخص نشده است.');
    }

    const monthsParam = req.nextUrl.searchParams.get('months');
    let monthKeys: string[] | undefined;
    if (monthsParam !== null) {
      const requested = monthsParam.split(',').map(value => value.trim()).filter(Boolean);
      // کلیدهای بدشکل رد می‌شوند تا هیچ ورودی کاربر مستقیماً به مسیر شیء نرود.
      if (requested.some(monthKey => !MONTH_KEY_PATTERN.test(monthKey))) {
        return noStoreJson({
          success: false,
          code: 'INVALID_MONTH_KEY',
          error: 'قالب کلید ماه نامعتبر است.',
        }, { status: 400 });
      }
      // سقف حفاظتی: جلوگیری از درخواست عمدی صدها ماه در یک فراخوانی.
      monthKeys = requested.slice(0, 24);
    }

    const { bucket, environment } = getS3Client();
    const result = await readDatabaseState({
      ...(actor.role === 'ADMIN' ? {} : { departmentIds: [actor.departmentId!] }),
      ...(monthKeys ? { monthKeys } : {}),
    });
    return noStoreJson({
      success: true,
      isConfigured: true,
      bucket,
      environment,
      source: result.source,
      state: result.state,
      versions: result.versions,
      availableMonths: result.availableMonths,
      loadedMonths: result.loadedMonths,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const actor = await requireCurrentUser();
    const contentType = req.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return noStoreJson({ success: false, code: 'UNSUPPORTED_MEDIA_TYPE' }, { status: 415 });
    }

    const declaredLength = Number(req.headers.get('content-length') || 0);
    if (declaredLength > MAX_REQUEST_BYTES) {
      return noStoreJson({ success: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }

    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      return noStoreJson({ success: false, code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }
    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(rawBody);
    } catch {
      return noStoreJson({ success: false, code: 'MALFORMED_JSON' }, { status: 400 });
    }

    const requestBody = WriteRequestSchema.safeParse(jsonBody);
    if (!requestBody.success) {
      return noStoreJson({
        success: false,
        code: 'INVALID_REQUEST',
        issues: requestBody.error.issues,
      }, { status: 400 });
    }

    const ifMatch = req.headers.get('if-match');
    const ifNoneMatch = req.headers.get('if-none-match');
    if ((!ifMatch && ifNoneMatch !== '*') || (ifMatch && ifNoneMatch)) {
      return noStoreJson({
        success: false,
        code: 'PRECONDITION_REQUIRED',
        error: 'Send If-Match for updates or If-None-Match: * for creates',
      }, { status: 428 });
    }

    const { resource, data } = requestBody.data;
    // مرحلهٔ ۱ — کنترل دسترسی در سطح نوع منبع (چه کسی اجازهٔ لمس این سند را دارد).
    authorizeResourceWrite(actor, resource);

    // مرحلهٔ ۲ — کنترل مالکیت در سطح محتوا.
    // سند «درخواست‌ها» آرایه‌ای مشترک برای کل بخش است؛ بدون این بررسی یک پرسنل
    // می‌توانست نسخه‌ای بفرستد که درخواست‌های همکارانش در آن حذف یا دستکاری شده
    // باشد. سند فعلی خوانده و با نسخهٔ پیشنهادی مقایسه می‌شود.
    if (resource.type === 'requests' && actor.role === 'PERSONNEL') {
      const committed = await readResourceIfExists(resource);
      assertRequestOwnership(actor, committed?.data ?? [], data);
    }

    const result = await writeResourceResolvingConflict(resource, data, ifMatch || null);
    const response = noStoreJson({
      success: true,
      resource: resourceVersionId(resource),
      etag: result.etag,
      versionId: result.versionId,
      ...(result.resolvedFromConflict ? { resolvedFromConflict: true } : {}),
      ...(result.alreadyApplied ? { alreadyApplied: true } : {}),
    }, { status: ifNoneMatch === '*' ? 201 : 200 });
    response.headers.set('ETag', result.etag);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}

// The old endpoint accepted an entire database snapshot and silently overwrote it.
// It is intentionally fail-closed so old clients cannot damage granular storage.
export async function POST() {
  return noStoreJson({
    success: false,
    code: 'WHOLE_STATE_WRITES_REMOVED',
    error: 'Use resource-scoped PUT with an ETag precondition',
  }, { status: 410 });
}
