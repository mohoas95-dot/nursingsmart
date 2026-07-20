'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { User } from 'lucide-react';
import type { AuthenticatedUser } from '../../../lib/auth/types';

/**
 * ProfileSection — Presentational Component
 *
 * RESPONSIBILITY:
 *   Render user profile information and password change button.
 *   This is a "dumb" component — it receives user data as props.
 *
 * Extracted from: app/page.tsx (Phase 6)
 */

export interface ProfileSectionProps {
  user: AuthenticatedUser;
}

export function ProfileSection({ user }: ProfileSectionProps) {
  const router = useRouter();

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return 'مدیر سامانه';
      case 'HEAD_NURSE':
        return 'سرپرستار بخش';
      default:
        return 'پرسنل';
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in print:hidden" dir="rtl">
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
              <User className="h-7 w-7" />
            </span>
            <div>
              <h3 className="text-lg font-black text-slate-900">
                {user.firstName} {user.lastName}
              </h3>
              <p className="mt-1 text-xs font-bold text-slate-500">
                کد ملی: <span className="font-mono" dir="ltr">{user.nationalId}</span>
              </p>
              <p className="mt-1 text-[11px] font-bold text-slate-400">
                سطح دسترسی: {getRoleLabel(user.role)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.push('/change-password')}
            className="rounded-xl bg-indigo-600 px-5 py-3 text-xs font-black text-white shadow-md transition hover:bg-indigo-700"
          >
            تغییر امن رمز عبور
          </button>
        </div>
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-bold leading-7 text-amber-800">
          رمز عبور در پایگاه داده امن و به‌صورت Hash نگهداری می‌شود و در هیچ بخش از رابط کاربری نمایش داده نخواهد شد.
        </div>
      </div>
    </div>
  );
}
