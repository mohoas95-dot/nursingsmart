'use client';

import React from 'react';
import { Cloud, ArrowUp } from 'lucide-react';

/**
 * BusyOverlay — Presentational Component
 *
 * RESPONSIBILITY:
 *   کارت لودینگ سراسری سامانه هنگام عملیات سنگین (تولید برنامه، ذخیره‌سازی،
 *   هوش مصنوعی) به‌همراه نوار پیشرفت ۰ تا ۱۰۰ درصد هم‌گام با مراحل واقعی.
 *
 * طراحی (نسخهٔ ابری):
 *   ابر بزرگ و نرم آبی با فلش آپلود سفید که پیوسته بالا و پایین می‌رود،
 *   نقاط رنگی شناور اطراف ابر، عدد درصد درشت آبی، عنوان «لطفا شکیبا باشید»،
 *   نوار پیشرفت گرادیانی سبز‌آبی با درخشش عبوری، برچسب مرحله + شماره مرحله
 *   و زمان تخمینی باقی‌مانده — دقیقاً در قالب تصویر مرجع کاربر.
 *
 * لایه (z-index) بالاتر از همهٔ اورلی‌های سامانه — از جمله چت تمام‌صفحه
 * (z-[210]) — قرار دارد تا لودینگ همیشه روی همان صفحه‌ای دیده شود که کاربر
 * در آن است، نه پشت آن.
 *
 * Extracted from: app/page.tsx (Phase 6)
 */

export interface BusyOverlayProps {
  /** نام کوتاه عملیات در حال انجام (مثلاً «تولید برنامه پرستاران»). */
  subtitle: string;
  /** درصد پیشرفت (۰ تا ۱۰۰). اگر تعریف نشود نوار نامعین متحرک نمایش داده می‌شود. */
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
  const safePercent = hasProgress ? Math.min(100, Math.max(0, percent as number)) : 0;
  const rounded = Math.round(safePercent);

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/45 backdrop-blur-md p-4 cursor-progress print:hidden">
      <div className="animate-overlay-pop relative w-full max-w-[21.5rem] overflow-hidden rounded-[2rem] border border-white/70 bg-white/95 shadow-2xl shadow-slate-900/25">
        {/* هالهٔ خیلی نرم پس‌زمینه برای حس ابری بودن */}
        <div className="pointer-events-none absolute -top-20 right-1/2 h-44 w-72 translate-x-1/2 rounded-full bg-sky-100/70 blur-3xl" />

        <div
          className="relative flex flex-col items-center gap-3 px-6 pb-6 pt-8 text-center"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          {/* ابر آپلود + نقاط رنگی شناور */}
          <div className="relative flex h-24 w-full items-center justify-center" aria-hidden="true">
            {/* نقاط رنگی با ضربان‌های نامتقارن — حس جشن و زنده بودن */}
            <span className="absolute left-[18%] top-1 h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" style={{ animationDelay: '0.15s' }} />
            <span className="absolute left-[10%] top-1/2 h-2 w-2 rounded-full bg-amber-400 animate-pulse" style={{ animationDelay: '0.9s' }} />
            <span className="absolute left-[26%] bottom-1 h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" style={{ animationDelay: '1.4s' }} />
            <span className="absolute right-[16%] top-0 h-1.5 w-1.5 rounded-full bg-sky-300 animate-pulse" style={{ animationDelay: '0.5s' }} />
            <span className="absolute right-[10%] top-1/3 h-1.5 w-1.5 rounded-full bg-teal-300 animate-pulse" style={{ animationDelay: '1.1s' }} />
            <span className="absolute right-[22%] bottom-2 h-2 w-2 rounded-full bg-rose-300 animate-pulse" style={{ animationDelay: '1.8s' }} />

            <div className="relative drop-shadow-xl">
              <Cloud className="h-24 w-24 fill-sky-200 text-sky-300" strokeWidth={1} />
              <span className="absolute inset-0 flex items-center justify-center pt-2">
                <ArrowUp className="animate-cloud-arrow h-8 w-8 text-white" strokeWidth={2.5} />
              </span>
            </div>
          </div>

          {/* درصد بزرگ آبی — ارقام لاتین با tabular-nums تا هنگام تغییر نلرزد */}
          {hasProgress && (
            <div className="font-mono text-4xl font-black leading-none tracking-tight text-sky-600 tabular-nums" dir="ltr">
              {rounded}%
            </div>
          )}

          <div className="space-y-1">
            <h3 className="text-lg font-black leading-tight text-slate-900">{title}</h3>
            <p className="text-[11px] font-extrabold text-slate-400">{subtitle}</p>
          </div>

          {/* نوار پیشرفت گرادیانی سبز‌آبی با درخشش متحرک */}
          <div className="w-full space-y-2">
            <div
              className="h-2.5 w-full overflow-hidden rounded-full bg-slate-200/80"
              dir="ltr"
              role="progressbar"
              aria-valuenow={hasProgress ? rounded : undefined}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={hasProgress ? `${rounded} درصد${phaseLabel ? ` — ${phaseLabel}` : ''}` : 'در حال انجام'}
            >
              {hasProgress ? (
                <div
                  className="relative h-full rounded-full bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-500 transition-[width] duration-500 ease-out"
                  style={{ width: `${safePercent}%` }}
                >
                  <div className="animate-progress-shimmer absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent" />
                </div>
              ) : (
                <div className="animate-indeterminate-bar h-full w-1/3 rounded-full bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-500" />
              )}
            </div>

            {/* برچسب مرحله + شماره مرحله — مانند تصویر مرجع */}
            {(phaseLabel || (phaseNumber && phaseCount)) && (
              <div className="flex items-center justify-between gap-3 text-[10px] font-extrabold text-slate-500">
                <span className="min-w-0 truncate">{phaseLabel}</span>
                {phaseNumber && phaseCount && (
                  <span className="shrink-0 font-mono tabular-nums text-slate-400" dir="ltr">
                    {phaseNumber}/{phaseCount}
                  </span>
                )}
              </div>
            )}

            {/* زمان باقی‌مانده */}
            {remainingLabel && (
              <p className="text-[10px] font-bold text-slate-400">{remainingLabel}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
