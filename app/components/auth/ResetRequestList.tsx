'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, KeyRound, Loader2, RefreshCw, UserPlus } from 'lucide-react';
import { fetchJson } from '../../../lib/http/resilient-fetch';
import { useSubmitGuard } from '../../../features/shared/hooks/useSubmitGuard';

type ResetRequestUser = {
  id: string;
  nationalId: string;
  firstName: string;
  lastName: string;
  departmentId: string | null;
  personnelId: string | null;
  active: boolean;
  resetRequestedAt: string | null;
};

export function ResetRequestList() {
  const [users, setUsers] = useState<ResetRequestUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // ── محافظت در برابر بارگذاری‌های هم‌زمان ────────────────────────────────────
  // این فهرست هم با تایمر (هر ۲۰ ثانیه)، هم با focus پنجره و هم با دکمهٔ
  // «تازه‌سازی» بارگذاری می‌شد. چند فراخوانی هم‌پوشان می‌توانستند پاسخ‌ها را
  // خارج از ترتیب برگردانند و فهرستی کهنه را روی فهرست تازه بنشانند.
  //  - inFlightRef: از اجرای هم‌زمان جلوگیری می‌کند.
  //  - generationRef: فقط پاسخ آخرین درخواست اجازهٔ نوشتن در state را دارد.
  //  - abortRef: درخواست قبلی هنگام unmount لغو می‌شود.
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

  const load = useCallback(async (isManual = false) => {
    if (inFlightRef.current && !isManual) return;
    inFlightRef.current = true;
    const generation = ++generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setError('');
    setLoading(true);
    try {
      const result = await fetchJson<{ users: ResetRequestUser[] }>('/api/head-nurse/reset-requests', {
        cache: 'no-store',
        signal: controller.signal,
      });
      // پاسخ کهنه (درخواست جدیدتری آغاز شده) نادیده گرفته می‌شود.
      if (generation !== generationRef.current || !mountedRef.current) return;
      setUsers(result.users);
      if (isManual) {
        setMessage('فهرست درخواست‌ها با موفقیت به‌روزرسانی شد.');
        setTimeout(() => { if (mountedRef.current) setMessage(''); }, 3000);
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      if (generation !== generationRef.current || !mountedRef.current) return;
      setError(reason instanceof Error ? reason.message : 'خطا در دریافت درخواست‌ها.');
    } finally {
      inFlightRef.current = false;
      if (generation === generationRef.current && mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    // بازه کوتاه‌تر تازه‌سازی: درخواست پرسنل حداکثر ۲۰ ثانیه بعد در پنل دیده می‌شود.
    const refreshTimer = window.setInterval(() => void load(), 20_000);
    const refreshOnFocus = () => void load();
    window.addEventListener('focus', refreshOnFocus);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(refreshTimer);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, [load]);

  // بازنشانی رمز از طریق محافظ ارسال اجرا می‌شود: دو کلیک سریع روی یک ردیف
  // (یا روی دو ردیف مختلف) دیگر دو درخواست هم‌زمان تولید نمی‌کند.
  const resetGuard = useSubmitGuard(async (user: ResetRequestUser) => {
    setResettingId(user.id);
    setError('');
    setMessage('');
    try {
      const result = await fetchJson<{ message?: string }>(
        `/api/head-nurse/reset-requests/${encodeURIComponent(user.id)}`,
        { method: 'PATCH' },
      );
      if (!mountedRef.current) return;
      setUsers(current => current.filter(item => item.id !== user.id));
      setMessage(result.message || 'رمز عبور با موفقیت بازنشانی شد.');
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(reason instanceof Error ? reason.message : 'خطا در بازنشانی رمز عبور.');
      // وضعیت سرور ممکن است تغییر کرده باشد؛ فهرست دوباره همگام می‌شود.
      void load();
    } finally {
      if (mountedRef.current) setResettingId(null);
    }
  });

  const resetPassword = async (user: ResetRequestUser) => {
    if (!window.confirm(`رمز عبور ${user.firstName} ${user.lastName} به ۱۲۳۴ بازنشانی شود؟`)) return;
    await resetGuard.run(user);
  };

  return (
    <section className="rounded-3xl border border-amber-200 bg-white p-5 shadow-sm" aria-labelledby="reset-requests-title" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            <BellRing className="h-5 w-5" />
            {users.length > 0 && <span className="absolute -left-1 -top-1 min-w-5 rounded-full bg-rose-600 px-1.5 text-center text-[10px] font-black leading-5 text-white">{users.length}</span>}
          </span>
          <div>
            <h2 id="reset-requests-title" className="text-sm font-black text-slate-900">درخواست‌های فراموشی رمز عبور</h2>
            <p className="mt-1 text-[11px] font-bold text-slate-500">فقط درخواست‌های فعال بخش شما نمایش داده می‌شوند.</p>
          </div>
        </div>
        <button type="button" onClick={() => void load(true)} disabled={loading} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-[11px] font-black text-slate-700 hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-50 transition-all cursor-pointer shadow-xs active:scale-95">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-indigo-600' : ''}`} /> تازه‌سازی
        </button>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 p-3 text-xs font-bold text-rose-700">{error}</p>}
      {message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs font-black text-emerald-700">{message}</p>}

      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs font-bold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> در حال دریافت درخواست‌ها...</div>
        ) : users.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-200 py-8 text-center text-xs font-bold text-slate-400">درخواست بازیابی فعالی وجود ندارد.</p>
        ) : users.map(user => (
          <article key={user.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-black text-slate-800">{user.firstName} {user.lastName}</p>
              <p className="mt-1 text-[11px] font-bold text-slate-500">کد ملی: <span className="font-mono" dir="ltr">{user.nationalId}</span></p>
              {user.resetRequestedAt && <p className="mt-1 text-[10px] text-slate-400">زمان درخواست: {new Date(user.resetRequestedAt).toLocaleString('fa-IR')}</p>}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {!user.personnelId && (
                  <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-2 py-0.5 text-[10px] font-black text-indigo-700">
                    <UserPlus className="h-3 w-3" />
                    بدون پروندهٔ پرسنلی — پس از بازنشانی، این کد ملی را در فرم پرسنل ثبت کنید
                  </span>
                )}
                {!user.active && (
                  <span className="inline-flex items-center rounded-lg bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-600">
                    حساب غیرفعال
                  </span>
                )}
              </div>
            </div>
            <button type="button" onClick={() => void resetPassword(user)} disabled={resettingId !== null || resetGuard.isRunning} className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-60">
              {resettingId === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              بازنشانی رمز عبور
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
