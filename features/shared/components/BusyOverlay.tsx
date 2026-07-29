'use client';

import React from 'react';
import { Activity } from 'lucide-react';
import { ProgressMeter } from './ProgressMeter';

/**
 * BusyOverlay — Presentational Component
 *
 * RESPONSIBILITY:
 *   کارت لودینگ سامانه هنگام عملیات سنگین (تولید برنامه، ذخیره‌سازی، هوش
 *   مصنوعی) به‌همراه نوار پیشرفت ۰ تا ۱۰۰ درصد هم‌گام با مراحل واقعی.
 *
 * تعادل طراحی:
 *   کارت فشرده می‌ماند (پهنای ~۲۰rem) اما رنگ، پویایی و هویت بصری سامانه
 *   حفظ شده است: نوار گرادیانی بالا، هاله‌های رنگی تنفس‌کننده، لوگوی
 *   بیمارستان در مرکز حلقه، عنوان درشت «لطفا شکیبا باشید» و نشان وضعیت زنده.
 *
 * Extracted from: app/page.tsx (Phase 6)
 */

export interface BusyOverlayProps {
  /** نام کوتاه عملیات در حال انجام (مثلاً «تولید برنامه پرستاران»). */
  subtitle: string;
  /** درصد پیشرفت (۰ تا ۱۰۰). اگر تعریف نشود انیمیشن نامعین نمایش داده می‌شود. */
  percent?: number;
  /** برچسب مرحلهٔ جاری. */
  phaseLabel?: string;
  phaseNumber?: number;
  phaseCount?: number;
  /** متن زمان باقی‌مانده. */
  remainingLabel?: string;
  /** عنوان اصلی کارت. */
  title?: string;
}

export function BusyOverlay({
  subtitle,
  percent,
  phaseLabel,
  phaseNumber,
  phaseCount,
  remainingLabel,
  title = 'لطفا شکیبا باشید',
}: BusyOverlayProps) {
  const hasProgress = typeof percent === 'number' && Number.isFinite(percent);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/40 backdrop-blur-md p-4 cursor-progress">
      <div className="animate-overlay-pop relative w-full max-w-[20.5rem] overflow-hidden rounded-[1.75rem] border border-white/60 bg-white/90 shadow-2xl shadow-slate-900/30">
        {/* نوار گرادیانی هویت سامانه */}
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-l from-indigo-500 via-sky-500 to-emerald-500" />

        {/* هاله‌های رنگی تنفس‌کننده — عمق و پویایی بدون اشغال فضا */}
        <div className="pointer-events-none absolute -top-16 -right-12 h-36 w-36 rounded-full bg-sky-400/25 blur-3xl animate-soft-glow" />
        <div
          className="pointer-events-none absolute -bottom-16 -left-10 h-32 w-32 rounded-full bg-emerald-400/25 blur-3xl animate-soft-glow"
          style={{ animationDelay: '1.2s' }}
        />

        <div
          className="relative flex flex-col items-center gap-3.5 px-6 pb-6 pt-7 text-center"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          {hasProgress ? (
            <ProgressMeter
              percent={percent as number}
              phaseLabel={phaseLabel}
              phaseNumber={phaseNumber}
              phaseCount={phaseCount}
              remainingLabel={remainingLabel}
              size={116}
            />
          ) : (
            /* حالت نامعین: همان حلقه‌های چرخان رنگی نسخهٔ اصلی */
            <div className="relative flex h-20 w-20 items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-indigo-200/80" />
              <div className="absolute inset-1.5 rounded-full border-[3px] border-transparent border-t-indigo-600 border-r-sky-500 animate-spin" />
              <div className="absolute inset-4 rounded-full border-2 border-emerald-200/70 border-b-emerald-500 animate-spin [animation-direction:reverse] [animation-duration:1.4s]" />
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 via-sky-500 to-emerald-500 text-white shadow-lg shadow-sky-500/30">
                <Activity className="h-5 w-5 animate-pulse" />
              </div>
            </div>
          )}

          {/* عنوان درشت و خوانا — همان تأکید بصری نسخهٔ اصلی */}
          <div className="space-y-1">
            <h3 className="text-xl font-black leading-tight text-slate-900">{title}</h3>
            <p className="text-xs font-extrabold text-slate-500">{subtitle}</p>
          </div>

          {/* نشان وضعیت زنده */}
          <div className="flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/80 px-3 py-1.5 text-[10px] font-extrabold text-slate-500 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            صفحه را نبندید
          </div>
        </div>
      </div>
    </div>
  );
}
