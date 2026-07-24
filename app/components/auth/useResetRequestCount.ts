'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * تعداد درخواست‌های باز بازیابی رمز عبور بخش جاری.
 *
 * فهرست درخواست‌ها فقط داخل تب «مدیریت پرسنل» دیده می‌شود؛ بدون این شمارنده، سرپرستار
 * تا وقتی آن تب را باز نکند اصلاً متوجه ثبت درخواست جدید نمی‌شد.
 */
export function useResetRequestCount(enabled: boolean) {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await fetch('/api/head-nurse/reset-requests', { cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json();
      if (result?.success) setCount(Array.isArray(result.users) ? result.users.length : 0);
    } catch {
      // خطای شبکه نباید رابط کاربری را مختل کند؛ شمارنده در تلاش بعدی به‌روز می‌شود.
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
