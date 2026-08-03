'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * مرز خطای سطح کامپوننت.
 *
 * ── چرا علاوه بر `app/error.tsx` لازم است؟ ──────────────────────────────────
 * مرز سطح مسیر، کل صفحه را با پیام خطا جایگزین می‌کند. اما وقتی فقط یک پنل
 * فرعی (مثل مرکز هشدارها یا کارنامه) خطا می‌دهد، از دست رفتن کل صفحهٔ کاری
 * سرپرستار واکنش بیش از حدی است.
 *
 * این مرز خطا را در همان ناحیه مهار می‌کند: بقیهٔ صفحه سالم می‌ماند و کاربر
 * می‌تواند فقط همان بخش را دوباره بارگذاری کند.
 *
 * ```tsx
 * <ErrorBoundary title="نمایش هشدارها ممکن نشد">
 *   <AlertCenter ... />
 * </ErrorBoundary>
 * ```
 *
 * نکته: مرز خطا در React فقط با کلاس‌کامپوننت ممکن است؛ هوک معادلی برای
 * `componentDidCatch` وجود ندارد.
 */

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** عنوان پیام جایگزین. */
  title?: string;
  /** رابط جایگزین سفارشی. اگر داده شود، رابط پیش‌فرض نادیده گرفته می‌شود. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  /**
   * با تغییر هر یک از این مقادیر، مرز به‌صورت خودکار بازنشانی می‌شود.
   * مثال: با عوض شدن ماه یا بخش، خطای قبلی دیگر معتبر نیست.
   */
  resetKeys?: ReadonlyArray<unknown>;
  /** برچسبی برای لاگ، تا منشأ خطا در کنسول قابل تشخیص باشد. */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[error-boundary${this.props.label ? `:${this.props.label}` : ''}]`,
      error,
      info.componentStack,
    );
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps) {
    if (!this.state.error) return;
    const previousKeys = previousProps.resetKeys;
    const nextKeys = this.props.resetKeys;
    if (!previousKeys || !nextKeys) return;
    // بازنشانی خودکار وقتی زمینهٔ خطا عوض شده (مثلاً کاربر ماه دیگری را باز کرد).
    const changed =
      previousKeys.length !== nextKeys.length ||
      previousKeys.some((key, index) => !Object.is(key, nextKeys[index]));
    if (changed) this.reset();
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div
        role="alert"
        dir="rtl"
        className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 text-center"
      >
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="text-xs font-black text-slate-800">
          {this.props.title || 'نمایش این بخش با خطا مواجه شد'}
        </p>
        <p className="mt-1.5 text-[11px] font-bold leading-5 text-slate-500">
          سایر بخش‌های صفحه سالم هستند و اطلاعات شما از دست نرفته است.
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-[11px] font-black text-slate-700 shadow-xs transition hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          بارگذاری دوبارهٔ این بخش
        </button>
      </div>
    );
  }
}
