'use client';

import { useEffect } from 'react';

/**
 * آخرین خط دفاع در برابر صفحهٔ سفید.
 *
 * `app/error.tsx` خطاهای داخل صفحه را می‌گیرد، اما اگر خطا در خود layout ریشه
 * رخ دهد آن مرز هرگز اجرا نمی‌شود. این فایل آن حالت را پوشش می‌دهد و به همین
 * دلیل باید تگ‌های `<html>` و `<body>` خودش را داشته باشد.
 *
 * عمداً بدون هیچ وابستگی است (نه آیکون، نه فونت سفارشی، نه کامپوننت مشترک):
 * وقتی layout ریشه شکسته، نمی‌توان فرض کرد بارگذاری دارایی‌ها یا CSS کار می‌کند.
 * تمام استایل به‌صورت inline نوشته شده تا در بدترین حالت هم قابل نمایش باشد.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global-error]', error.digest ? `digest=${error.digest}` : '', error);
  }, [error]);

  return (
    <html lang="fa" dir="rtl">
      <body style={{ margin: 0, background: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
        <div
          role="alert"
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            style={{
              maxWidth: '480px',
              width: '100%',
              background: '#ffffff',
              border: '1px solid #fecdd3',
              borderRadius: '24px',
              padding: '32px',
              textAlign: 'center',
              boxShadow: '0 20px 40px rgba(15, 23, 42, 0.08)',
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: '64px',
                height: '64px',
                margin: '0 auto 20px',
                borderRadius: '16px',
                background: '#fff1f2',
                color: '#e11d48',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '32px',
              }}
            >
              !
            </div>

            <h1 style={{ fontSize: '18px', fontWeight: 900, color: '#0f172a', margin: 0 }}>
              سامانه با خطای غیرمنتظره متوقف شد
            </h1>
            <p style={{ marginTop: '12px', fontSize: '13px', lineHeight: 1.9, color: '#64748b', fontWeight: 700 }}>
              اطلاعات ذخیره‌شدهٔ شما در امان است. لطفاً صفحه را دوباره بارگذاری کنید.
              اگر مشکل ادامه داشت، کد پیگیری زیر را به پشتیبانی اعلام کنید.
            </p>

            {error.digest && (
              <p style={{ marginTop: '12px', fontSize: '11px', color: '#94a3b8', fontWeight: 700 }}>
                کد پیگیری: <span style={{ fontFamily: 'monospace' }} dir="ltr">{error.digest}</span>
              </p>
            )}

            <div style={{ marginTop: '24px', display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={reset}
                style={{
                  background: '#4f46e5',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '12px 20px',
                  fontSize: '13px',
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                تلاش مجدد
              </button>
              <button
                type="button"
                onClick={() => { window.location.href = '/'; }}
                style={{
                  background: '#ffffff',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  borderRadius: '12px',
                  padding: '12px 20px',
                  fontSize: '13px',
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                بازگشت به صفحهٔ اصلی
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
