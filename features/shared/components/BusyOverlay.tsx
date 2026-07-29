'use client';

import React from 'react';
import { ArrowUp } from 'lucide-react';

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
  // شناسهٔ یکتا برای گرادیان‌های SVG تا با چند نمونهٔ هم‌زمان تداخل نکند
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const cloudPath = 'M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z';

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
          {/* ابر شیشه‌ای سه‌بعدی (فیروزه‌ای → بنفش) الهام‌گرفته از تصویر مرجع */}
          <div className="relative flex h-28 w-full items-center justify-center" aria-hidden="true">
            {/* نقاط رنگی هم‌رنگ پالت ابر با ضربان‌های نامتقارن */}
            <span className="absolute left-[16%] top-1 h-1.5 w-1.5 rounded-full bg-cyan-300 animate-pulse" style={{ animationDelay: '0.15s' }} />
            <span className="absolute left-[9%] top-1/2 h-2 w-2 rounded-full bg-sky-300 animate-pulse" style={{ animationDelay: '0.9s' }} />
            <span className="absolute left-[25%] bottom-3 h-1.5 w-1.5 rounded-full bg-violet-300 animate-pulse" style={{ animationDelay: '1.4s' }} />
            <span className="absolute right-[16%] top-0 h-1.5 w-1.5 rounded-full bg-teal-300 animate-pulse" style={{ animationDelay: '0.5s' }} />
            <span className="absolute right-[9%] top-1/3 h-1.5 w-1.5 rounded-full bg-fuchsia-300 animate-pulse" style={{ animationDelay: '1.1s' }} />
            <span className="absolute right-[23%] bottom-4 h-2 w-2 rounded-full bg-indigo-300 animate-pulse" style={{ animationDelay: '1.8s' }} />

            {/* بازتاب نور روی سطح زیر ابر — مثل تصویر مرجع */}
            <span className="absolute bottom-1 h-3 w-16 rounded-full bg-cyan-400/35 blur-md" style={{ left: 'calc(50% - 3.75rem)' }} />
            <span className="absolute bottom-1 h-3 w-16 rounded-full bg-violet-400/35 blur-md" style={{ right: 'calc(50% - 3.75rem)' }} />

            {/* گرادیان‌های ابر شیشه‌ای */}
            <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
              <defs>
                <linearGradient id={`${uid}-body`} x1="0" y1="0.15" x2="1" y2="0.85">
                  <stop offset="0%" stopColor="#22d3ee" />
                  <stop offset="42%" stopColor="#38bdf8" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
                <linearGradient id={`${uid}-rim`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#67e8f9" />
                  <stop offset="100%" stopColor="#c4b5fd" />
                </linearGradient>
                <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>
                <clipPath id={`${uid}-clip`}>
                  <path d={cloudPath} />
                </clipPath>
              </defs>
            </svg>

            <div className="animate-cloud-float relative">
              <svg
                viewBox="0 0 24 24"
                className="h-24 w-24"
                style={{ filter: 'drop-shadow(-5px 8px 14px rgba(34, 211, 238, 0.35)) drop-shadow(5px 8px 14px rgba(139, 92, 246, 0.35))' }}
              >
                {/* بدنهٔ ابر */}
                <path d={cloudPath} fill={`url(#${uid}-body)`} />
                {/* هایلایت‌های شیشه‌ای — فقط داخل قاب ابر */}
                <g clipPath={`url(#${uid}-clip)`}>
                  <ellipse cx="12" cy="6.1" rx="6" ry="2.4" fill={`url(#${uid}-sheen)`} />
                  <ellipse cx="6.9" cy="11.5" rx="2.5" ry="1.5" fill="#ffffff" opacity="0.35" />
                  <ellipse cx="17.3" cy="13.2" rx="2.3" ry="1.7" fill="#e9d5ff" opacity="0.4" />
                  <ellipse cx="12" cy="20.4" rx="8.5" ry="2.6" fill="#1e1b4b" opacity="0.16" />
                </g>
                {/* حاشیهٔ نورانی دور ابر */}
                <path d={cloudPath} fill="none" stroke={`url(#${uid}-rim)`} strokeWidth="0.55" opacity="0.9" />
              </svg>

              {/* فلش آپلود کلفت، هم‌رنگ جلوهٔ ابر و هم‌گام با شناوری آن */}
              <span className="absolute inset-0 flex items-center justify-center pt-2">
                <ArrowUp
                  className="animate-cloud-arrow h-9 w-9 text-white"
                  strokeWidth={3.5}
                  style={{ filter: 'drop-shadow(0 0 6px rgba(34, 211, 238, 0.85)) drop-shadow(0 2px 5px rgba(124, 58, 237, 0.5))' }}
                />
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
