'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { resilientFetch } from '../../../lib/http/resilient-fetch';

/**
 * تعداد درخواست‌های باز بازیابی رمز عبور بخش جاری.
 *
 * فهرست درخواست‌ها فقط داخل تب «مدیریت پرسنل» دیده می‌شود؛ بدون این شمارنده، سرپرستار
 * تا وقتی آن تب را باز نکند اصلاً متوجه ثبت درخواست جدید نمی‌شد.
 *
 * ── مدیریت هم‌زمانی ──────────────────────────────────────────────────────────
 * این هوک از سه مسیر فراخوانی می‌شود: تایمر ۳۰ ثانیه‌ای، رویداد focus پنجره و
 * فراخوانی دستی. بدون محافظ، این مسیرها می‌توانستند چند درخواست هم‌پوشان بسازند
 * و پاسخ کهنه، شمارندهٔ تازه را بازنویسی کند. اکنون:
 *   - درخواست هم‌زمان اجرا نمی‌شود (inFlightRef)
 *   - فقط پاسخ آخرین درخواست در state می‌نشیند (generationRef)
 *   - درخواست در حال اجرا هنگام unmount لغو می‌شود (AbortController)
 */
export function useResetRequestCount(enabled: boolean) {
  const [count, setCount] = useState(0);
  const inFlightRef = useRef(false);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const load = useCallback(async () => {
    if (!enabled || inFlightRef.current) return;
    inFlightRef.current = true;
    const generation = ++generationRef.current;
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await resilientFetch('/api/head-nurse/reset-requests', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return;
      const result = await response.json();
      if (generation !== generationRef.current || !mountedRef.current) return;
      if (result?.success) setCount(Array.isArray(result.users) ? result.users.length : 0);
    } catch {
      // خطای شبکه نباید رابط کاربری را مختل کند؛ شمارنده در تلاش بعدی به‌روز می‌شود.
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    // بارگذاری اول عمداً به تیک بعدی موکول می‌شود تا setState داخل بدنهٔ افکت اجرا نشود.
    const initialLoad = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [enabled, load]);

  // وقتی کاربر خارج می‌شود یا نقش او پرسنل است، شمارنده نباید نمایش داده شود.
  return { count: enabled ? count : 0, refresh: load };
}
