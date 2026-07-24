'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, KeyRound, Loader2, RefreshCw, UserPlus } from 'lucide-react';

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

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch('/api/head-nurse/reset-requests', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'دریافت درخواست‌ها ناموفق بود.');
      setUsers(result.users);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'خطا در دریافت درخواست‌ها.');
    } finally {
      setLoading(false);
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

  const resetPassword = async (user: ResetRequestUser) => {
    if (!window.confirm(`رمز عبور ${user.firstName} ${user.lastName} به ۱۲۳۴ بازنشانی شود؟`)) return;
    setResettingId(user.id);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/head-nurse/reset-requests/${user.id}`, { method: 'PATCH' });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'بازنشانی رمز انجام نشد.');
      setUsers(current => current.filter(item => item.id !== user.id));
      setMessage(result.message || 'رمز عبور با موفقیت بازنشانی شد.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'خطا در بازنشانی رمز عبور.');
    } finally {
      setResettingId(null);
    }
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
        <button type="button" onClick={() => void load()} disabled={loading} className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> تازه‌سازی
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
            <button type="button" onClick={() => void resetPassword(user)} disabled={resettingId !== null} className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-60">
              {resettingId === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              بازنشانی رمز عبور
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
