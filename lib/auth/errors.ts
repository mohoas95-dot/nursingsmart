/**
 * خطاهای احراز هویت و مجوزدهی.
 *
 * چرا از `session.ts` جدا شد؟ آن فایل `server-only` و `next/headers` را وارد
 * می‌کند، بنابراین هر ماژولی که فقط به این کلاس خطا نیاز داشت، ناخواسته کل
 * وابستگی‌های زمان‌اجرای سرور را هم با خود می‌کشید و خارج از محیط Next.js قابل
 * تست نبود. جداسازی، منطق خالص مجوزدهی را آزمون‌پذیر نگه می‌دارد.
 */

export class AuthenticationError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}
