'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2 } from 'lucide-react';

export function ChangePasswordForm({ isRequired = false }: { isRequired?: boolean }) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || 'تغییر رمز انجام نشد.');
      router.replace(result.redirectTo || '/');
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'خطا در تغییر رمز عبور.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-[2rem] border border-slate-200 bg-white p-7 shadow-xl sm:p-9" dir="rtl">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white"><KeyRound /></div>
        <h1 className="text-xl font-black text-slate-900">{isRequired ? 'تغییر رمز عبور اولیه' : 'تغییر رمز عبور'}</h1>
        <p className="mt-2 text-xs font-bold leading-6 text-slate-500">{isRequired ? 'برای حفظ امنیت حساب، پیش از ادامه رمز پیش‌فرض را تغییر دهید.' : 'رمز فعلی و رمز امن جدید را وارد کنید.'}</p>
      </div>
      <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} autoComplete="current-password" placeholder="رمز عبور فعلی" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center font-mono text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10" required />
      <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} autoComplete="new-password" placeholder="رمز عبور جدید؛ حداقل ۸ کاراکتر" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center font-mono text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10" required />
      <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" placeholder="تکرار رمز عبور جدید" className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center font-mono text-sm outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10" required />
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center text-xs font-bold text-rose-700">{error}</p>}
      <button type="submit" disabled={submitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60">
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitting ? 'در حال ثبت...' : 'ثبت رمز جدید و ادامه'}
      </button>
    </form>
  );
}
