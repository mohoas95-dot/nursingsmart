import { NextResponse } from 'next/server';
import { checkDatabaseHealth } from '../../../lib/db';
import { getCircuitBreakerStatus } from '../../../lib/s3Storage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * بررسی سلامت وابستگی‌ها (پایگاه داده + ذخیره‌سازی ابری).
 *
 * چرا لازم است؟ وقتی کاربر پیام «پایگاه داده آماده نیست» می‌گیرد، باید بتوان
 * سریع تشخیص داد که مشکل از پایگاه داده است یا ذخیره‌سازی ابری. همچنین
 * لودبالانسر/پلتفرم استقرار می‌تواند تا آماده شدن کامل، ترافیک نفرستد.
 *
 * این مسیر عمداً هیچ داده‌ای فاش نمی‌کند: فقط وضعیت و تأخیر.
 */
export async function GET() {
  const database = await checkDatabaseHealth();
  const storage = getCircuitBreakerStatus();

  const healthy = database.ok && storage.state !== 'open';
  const response = NextResponse.json({
    status: healthy ? 'ok' : 'degraded',
    database: {
      ok: database.ok,
      latencyMs: database.latencyMs,
      ...(database.ok ? {} : { error: database.error, retryable: database.retryable }),
    },
    storage: {
      circuit: storage.state,
      failures: storage.failures,
      ...(storage.retryAfterMs > 0 ? { retryAfterMs: storage.retryAfterMs } : {}),
    },
    checkedAt: new Date().toISOString(),
  }, { status: healthy ? 200 : 503 });

  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (!healthy) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(Math.max(storage.retryAfterMs, database.ok ? 0 : 3_000) / 1000),
    );
    response.headers.set('Retry-After', String(retryAfterSeconds));
  }
  return response;
}
