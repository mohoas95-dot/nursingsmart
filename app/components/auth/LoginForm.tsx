'use client';

import { FormEvent, useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import type { LoginResult } from '../../../lib/auth/types';

export function LoginForm({ onSuccess }: { onSuccess: (result: LoginResult) => void }) {
  const [nationalId, setNationalId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requestingReset, setRequestingReset] = useState(false);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nationalId, password }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'ورود انجام نشد.');
      onSuccess({ user: result.user, redirectTo: result.redirectTo });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'خطا در برقراری ارتباط با سرور.');
    } finally {
      setSubmitting(false);
    }
  };

  const forgotPassword = async () => {
    setError('');
    setNotice('');
    if (!nationalId.trim()) {
      setError('ابتدا کد ملی خود را وارد کنید.');
      return;
    }
    setRequestingReset(true);
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nationalId }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'ثبت درخواست انجام نشد.');
      setNotice('رمز عبور جدید به زودی برات ارسال میشه!');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'خطا در ثبت درخواست بازیابی.');
    } finally {
      setRequestingReset(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-[2rem] border border-white/70 bg-white/90 p-6 shadow-2xl shadow-slate-900/10 backdrop-blur-md sm:p-9" dir="rtl">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/20">
          <ShieldCheck className="h-8 w-8" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-black text-slate-900">ورود به سامانه پرستاری</h1>
        <p className="mt-2 text-xs font-bold leading-6 text-slate-500">برای ورود، کد ملی و رمز عبور خود را وارد کنید.</p>
      </div>

      <form className="space-y-4" onSubmit={login}>
        <div>
          <label htmlFor="national-id" className="mb-1.5 block text-xs font-black text-slate-700">کد ملی</label>
          <input
            id="national-id"
            value={nationalId}
            onChange={event => setNationalId(event.target.value)}
            inputMode="numeric"
            autoComplete="username"
            maxLength={10}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-center font-mono text-sm font-bold tracking-[0.25em] text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
            placeholder="کد ملی ۱۰ رقمی"
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-black text-slate-700">رمز عبور</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete="current-password"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-center font-mono text-sm font-bold text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
            placeholder="رمز عبور اولیه: ۱۲۳۴"
            required
          />
        </div>

        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center text-xs font-bold text-rose-700">{error}</p>}
        {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center text-xs font-black text-emerald-700">{notice}</p>}

        <button
          type="submit"
          disabled={submitting || requestingReset}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3.5 text-sm font-black text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
          {submitting ? 'در حال بررسی اطلاعات...' : 'ورود امن'}
        </button>

        <button
          type="button"
          onClick={forgotPassword}
          disabled={submitting || requestingReset}
          className="w-full rounded-xl px-4 py-2 text-xs font-black text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-60"
        >
          {requestingReset ? 'در حال ثبت درخواست...' : 'فراموشی رمز عبور'}
        </button>
      </form>
    </div>
  );
}
