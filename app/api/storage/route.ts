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
  writeResourceResolvingConflict,
} from '../../../lib/s3Storage';
import { StorageResourceSchema, type StorageResource } from '../../../lib/storageSchemas';
import {
  AuthenticationError,
  requireCurrentUser,
} from '../../../lib/auth/session';
import type { AuthenticatedUser } from '../../../lib/auth/types';
import { assertSameOrigin } from '../../../lib/auth/http';

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
    }, { status: 503 });
    if (circuit.retryAfterMs > 0) {
      response.headers.set('Retry-After', String(Math.max(1, Math.ceil(circuit.retryAfterMs / 1000))));
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

function authorizeResourceWrite(user: AuthenticatedUser, resource: StorageResource) {
  if (user.role === 'ADMIN') return;
  if (resource.type === 'departments') {
    throw new AuthenticationError(403, 'فقط مدیر سامانه اجازه تغییر فهرست بخش‌ها را دارد.');
  }
  if (!user.departmentId || user.departmentId !== resource.departmentId) {
    throw new AuthenticationError(403, 'اجازه تغییر اطلاعات این بخش را ندارید.');
  }
  if (user.role === 'PERSONNEL' && resource.type !== 'requests' && resource.type !== 'schedule') {
    throw new AuthenticationError(403, 'پرسنل فقط اجازه ثبت درخواست‌های شیفت خود را دارند.');
  }
}

export async function GET() {
  try {
    const actor = await requireCurrentUser();
    if (actor.role !== 'ADMIN' && !actor.departmentId) {
      throw new AuthenticationError(403, 'برای حساب کاربری بخش مشخص نشده است.');
    }
    const { bucket, environment } = getS3Client();
    const result = await readDatabaseState(actor.role === 'ADMIN'
      ? undefined
      : { departmentIds: [actor.departmentId!] });
    return noStoreJson({
      success: true,
      isConfigured: true,
      bucket,
      environment,
      source: result.source,
      state: result.state,
      versions: result.versions,
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
    authorizeResourceWrite(actor, resource);
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
