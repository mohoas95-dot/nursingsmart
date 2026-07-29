'use client';

import React from 'react';

/**
 * ProgressMeter — Presentational Component
 *
 * RESPONSIBILITY:
 *   نمایش فشرده و مدرن درصد پیشرفت ۰ تا ۱۰۰ به‌صورت حلقهٔ گرادیانی + نوار خطی،
 *   هماهنگ با زبان بصری سامانه (گرادیان نیلی/آبی/زمردی و گوشه‌های نرم).
 *
 * چرا ارقام لاتین؟
 *   عدد درصد با فونت mono و ارقام لاتین (tabular-nums) نمایش داده می‌شود تا
 *   ظاهری مدرن داشته باشد و هنگام تغییر سریع اعداد، عرض آن نلرزد.
 *
 * دسترس‌پذیری:
 *   ساختار role="progressbar" با aria-valuenow/min/max و متن جایگزین، تا
 *   صفحه‌خوان هم درصد را اعلام کند.
 */

export interface ProgressMeterProps {
  /** درصد فعلی (۰ تا ۱۰۰). */
  percent: number;
  /** برچسب مرحلهٔ جاری. */
  phaseLabel?: string;
  /** شمارهٔ مرحله (از ۱). */
  phaseNumber?: number;
  /** تعداد کل مراحل. */
  phaseCount?: number;
  /** متن زمان باقی‌مانده. */
  remainingLabel?: string;
  /** اندازهٔ حلقه بر حسب پیکسل. */
  size?: number;
  /** نمایش نوار خطی زیر حلقه. */
  showBar?: boolean;
  className?: string;
}

const RING_STROKE = 6;

export function ProgressMeter({
  percent,
  phaseLabel,
  phaseNumber,
  phaseCount,
  remainingLabel,
  size = 104,
  showBar = true,
  className = '',
}: ProgressMeterProps) {
  const safePercent = Math.min(100, Math.max(0, Number.isFinite(percent) ? percent : 0));
  const rounded = Math.round(safePercent);
  const radius = (size - RING_STROKE * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - safePercent / 100);
  const isComplete = rounded >= 100;

  return (
    <div className={`flex w-full flex-col items-center gap-3 ${className}`}>
      <div
        className="relative flex items-center justify-center"
        style={{ width: size, height: size }}
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${rounded} درصد${phaseLabel ? ` — ${phaseLabel}` : ''}`}
      >
        <svg width={size} height={size} className="relative -rotate-90" aria-hidden="true">
          <defs>
            <linearGradient id="progress-meter-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4f46e5" />
              <stop offset="55%" stopColor="#0ea5e9" />
              <stop offset="100%" stopColor="#10b981" />
            </linearGradient>
          </defs>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={RING_STROKE}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="url(#progress-meter-gradient)"
            strokeWidth={RING_STROKE}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 220ms cubic-bezier(0.4, 0, 0.2, 1)' }}
          />
        </svg>

        {/* عدد درصد: ارقام لاتین، فونت mono و عرض ثابت برای ظاهر مدرن و بدون لرزش */}
        <div className="absolute inset-0 flex items-center justify-center" dir="ltr">
          <div className="flex items-baseline gap-px font-mono">
            <span className="text-2xl font-black leading-none tracking-tight text-slate-900 tabular-nums">
              {rounded}
            </span>
            <span className="text-xs font-bold text-slate-400">%</span>
          </div>
        </div>
      </div>

      {showBar && (
        <div className="w-full space-y-1.5">
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-200/80">
            <div
              className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-indigo-600 via-sky-500 to-emerald-500"
              style={{ width: `${safePercent}%`, transition: 'width 220ms cubic-bezier(0.4, 0, 0.2, 1)' }}
            >
              {/* درخشش متحرک روی نوار تا حس «در حال انجام» منتقل شود */}
              {!isComplete && (
                <span className="absolute inset-0 animate-pulse rounded-full bg-white/25" />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-[10px] font-extrabold">
            <span className="truncate text-slate-600">{phaseLabel || 'در حال پردازش…'}</span>
            <span className="shrink-0 text-slate-400" dir="ltr">
              {phaseCount && phaseCount > 1 && phaseNumber ? `${phaseNumber}/${phaseCount}` : ''}
            </span>
          </div>

          {remainingLabel && !isComplete && (
            <p className="text-center text-[10px] font-bold text-slate-400">{remainingLabel}</p>
          )}
        </div>
      )}
    </div>
  );
}
