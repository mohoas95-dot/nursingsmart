'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

/**
 * مرز خطای سطح صفحه (Route Error Boundary).
 *
 * ── چرا حیاتی است؟ ──────────────────────────────────────────────────────────
 * پیش از این هیچ مرز خطایی در پروژه وجود نداشت. یک استثنای پیش‌بینی‌نشده در
 * رندر (مثلاً خواندن ویژگی از یک شیء تهی در داده‌ای که شکل غیرمنتظره دارد) کل
 * درخت React را unmount می‌کرد و کاربر یک **صفحهٔ کاملاً سفید** می‌دید، بدون
 * هیچ راه بازگشتی جز بستن مرورگر.
 *
 * این کامپوننت خطا را می‌گیرد و مسیر خروج امن می‌دهد: تلاش مجدد (که فقط همان
 * بخش را دوباره رندر می‌کند، نه کل برنامه) یا بازگشت به خانه.
 *
 * توجه: در Next.js این فایل فقط خطاهای رندر سمت کلاینت در همین مسیر را می‌گیرد.
 * خطاهای خود layout ریشه با `global-error.tsx` پوشش داده می‌شوند.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // ثبت در کنسول سرور/مرورگر برای ردیابی. `digest` شناسه‌ای است که Next.js
    // برای خطاهای سمت سرور می‌سازد و آن را به لاگ سرور وصل می‌کند.
    console.error('[route-error]', error.digest ? `digest=${error.digest}` : '', error);
  }, [error]);

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-slate-50 p-6"
      dir="rtl"
      role="alert"
    >
      <div className="w-full max-w-lg rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
          <AlertTriangle className="h-8 w-8" aria-hidden="true" />
        </div>

        <h1 className="text-lg font-black text-slate-900">
          خطای پیش‌بینی‌نشده‌ای رخ داد
        </h1>
        <p className="mt-3 text-xs font-bold leading-6 text-slate-500">
          مشکلی در نمایش این بخش پیش آمد. اطلاعات ذخیره‌شدهٔ شما در امان است.
          می‌توانید دوباره تلاش کنید یا به صفحهٔ اصلی بازگردید.
        </p>

        {/*
          جزئیات فنی فقط در محیط توسعه نمایش داده می‌شود؛ در تولید، پیام خطای
          داخلی می‌تواند ساختار سامانه را برای کاربر نهایی افشا کند.
        */}
        {process.env.NODE_ENV === 'development' && (
          <pre className="mt-4 max-h-40 overflow-auto rounded-xl bg-slate-900 p-3 text-right text-[10px] leading-5 text-rose-300" dir="ltr">
            {error.message}
          </pre>
        )}

        {error.digest && (
          <p className="mt-3 text-[10px] font-bold text-slate-400">
            کد پیگیری: <span className="font-mono" dir="ltr">{error.digest}</span>
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-xs font-black text-white transition hover:bg-indigo-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            تلاش مجدد
          </button>
          <button
            type="button"
            onClick={() => { window.location.href = '/'; }}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-xs font-black text-slate-700 transition hover:bg-slate-50"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            بازگشت به صفحهٔ اصلی
          </button>
        </div>
      </div>
    </div>
  );
}
