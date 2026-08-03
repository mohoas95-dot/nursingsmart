'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * محافظ ارسال (Submit Guard) — جلوگیری از درخواست‌های تکراری و هم‌زمان
 * ---------------------------------------------------------------------------
 * مشکل: کاربر روی «ذخیره» دوبار سریع کلیک می‌کند (یا دکمه در لحظهٔ کند بودن
 * شبکه چند بار فشرده می‌شود). دو درخواست هم‌زمان به سرور می‌رسد و باعث رکورد
 * تکراری، خطای تداخل یا حتی deadlock در پایگاه داده می‌شود.
 *
 * چرا `useState` تنها کافی نیست؟ چون به‌روزرسانی state در React ناهم‌زمان است:
 * دو کلیک در یک تیک، هر دو مقدار قدیمیِ `isSubmitting === false` را می‌بینند و
 * هر دو عبور می‌کنند. اینجا از `useRef` استفاده می‌شود که بلافاصله و به‌صورت
 * هم‌زمان (synchronous) به‌روز می‌شود و درِ ورود را در همان لحظه می‌بندد.
 *
 * ```tsx
 * const save = useSubmitGuard(async (data) => { await api.save(data); });
 * <button onClick={() => save.run(form)} disabled={save.isRunning}>ذخیره</button>
 * ```
 */

export interface SubmitGuardOptions {
  /**
   * وقتی عملیاتی در حال اجراست، کلیک بعدی چه شود؟
   *  - `ignore` (پیش‌فرض): نادیده گرفته شود؛ مناسب دکمه‌های ثبت.
   *  - `queue`: پس از پایان عملیات فعلی اجرا شود؛ مناسب ذخیرهٔ خودکار.
   */
  mode?: 'ignore' | 'queue';
  /**
   * حداقل فاصله بین دو اجرای موفق (ms). کلیک‌های سریع‌تر از این نادیده گرفته
   * می‌شوند. پیش‌فرض ۰ (غیرفعال).
   */
  cooldownMs?: number;
  /** فراخوان هنگام رد شدن یک کلیک تکراری (مثلاً برای نمایش پیام). */
  onBlocked?: (reason: 'in-flight' | 'cooldown') => void;
}

export interface SubmitGuardResult<TArgs extends unknown[], TResult> {
  /** اجرای محافظت‌شدهٔ عملیات. اگر مسدود شود `undefined` برمی‌گرداند. */
  run: (...args: TArgs) => Promise<TResult | undefined>;
  /** آیا عملیاتی در حال اجراست؟ (برای `disabled` کردن دکمه) */
  isRunning: boolean;
  /** آخرین خطای رخ‌داده؛ با اجرای موفق بعدی پاک می‌شود. */
  error: Error | null;
  /** پاک‌کردن دستی خطا. */
  clearError: () => void;
}

export function useSubmitGuard<TArgs extends unknown[], TResult>(
  operation: (...args: TArgs) => Promise<TResult>,
  options: SubmitGuardOptions = {},
): SubmitGuardResult<TArgs, TResult> {
  const { mode = 'ignore', cooldownMs = 0, onBlocked } = options;

  // ref هم‌زمان به‌روز می‌شود و برخلاف state، دو کلیک در یک تیک را هم می‌گیرد.
  const inFlightRef = useRef(false);
  const lastCompletedAtRef = useRef(0);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const mountedRef = useRef(true);
  const operationRef = useRef(operation);
  const onBlockedRef = useRef(onBlocked);

  // همیشه تازه‌ترین نسخهٔ تابع اجرا می‌شود، بدون آنکه `run` هویتش را از دست بدهد.
  useEffect(() => { operationRef.current = operation; });
  useEffect(() => { onBlockedRef.current = onBlocked; });
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const execute = useCallback(async (...args: TArgs): Promise<TResult | undefined> => {
    inFlightRef.current = true;
    // به‌روزرسانی state فقط برای رندر است؛ منطق قفل کاملاً به ref متکی است.
    if (mountedRef.current) setIsRunning(true);
    try {
      const result = await operationRef.current(...args);
      if (mountedRef.current) setError(null);
      return result;
    } catch (reason) {
      const normalized = reason instanceof Error ? reason : new Error(String(reason));
      if (mountedRef.current) setError(normalized);
      throw normalized;
    } finally {
      inFlightRef.current = false;
      lastCompletedAtRef.current = Date.now();
      // اگر کامپوننت در حین عملیات unmount شده باشد، setState هشدار می‌دهد.
      if (mountedRef.current) setIsRunning(false);
    }
  }, []);

  const run = useCallback(async (...args: TArgs): Promise<TResult | undefined> => {
    if (cooldownMs > 0 && Date.now() - lastCompletedAtRef.current < cooldownMs) {
      onBlockedRef.current?.('cooldown');
      return undefined;
    }

    if (inFlightRef.current) {
      if (mode === 'ignore') {
        onBlockedRef.current?.('in-flight');
        return undefined;
      }
      // حالت صف: عملیات بعدی پس از پایان فعلی اجرا می‌شود تا ترتیب حفظ شود و
      // دو نوشتن هم‌زمان روی یک منبع رخ ندهد.
      const queued = queueRef.current.then(() => execute(...args), () => execute(...args));
      queueRef.current = queued.catch(() => undefined);
      return queued as Promise<TResult | undefined>;
    }

    return execute(...args);
  }, [cooldownMs, execute, mode]);

  return { run, isRunning, error, clearError };
}

/**
 * نسخهٔ سبک‌تر: فقط قفل هم‌زمانی بدون مدیریت state خطا.
 * برای هندلرهایی که خودشان خطا را مدیریت می‌کنند (مثل هندلرهای موجود با alert).
 */
export function useConcurrencyLock() {
  const lockedRef = useRef(false);
  const [isLocked, setIsLocked] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /** اجرای عملیات فقط اگر قفل آزاد باشد؛ در غیر این صورت `undefined`. */
  const runExclusive = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
    if (lockedRef.current) return undefined;
    lockedRef.current = true;
    if (mountedRef.current) setIsLocked(true);
    try {
      return await operation();
    } finally {
      lockedRef.current = false;
      if (mountedRef.current) setIsLocked(false);
    }
  }, []);

  return { runExclusive, isLocked };
}
