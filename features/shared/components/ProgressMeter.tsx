'use client';

import React from 'react';
import { Activity } from 'lucide-react';

/**
 * ProgressMeter — Presentational Component
 *
 * RESPONSIBILITY:
 *   حلقهٔ پیشرفت ۰ تا ۱۰۰ درصد با گرادیان زندهٔ سامانه (نیلی → آبی → زمردی)،
 *   نشان ضربان (هویت بصری سامانه) در مرکز و نوار خطی با درخشش متحرک.
 *
 * چرا نشان ضربان به‌جای فایل لوگو؟
 *   نشان گرادیانی Activity همان عنصر هویتی نسخهٔ اصلی BusyOverlay است؛ سبک
 *   (بدون بار شبکه)، همیشه قابل رندر و در هر اندازه‌ای برداری و تیز می‌ماند.
 *   استفاده از فایل تصویری اینجا یعنی یک درخواست شبکهٔ اضافه در لحظه‌ای که
 *   کاربر منتظر است — دقیقاً همان چیزی که باید از آن پرهیز کرد.
 *   (نسخهٔ برداری اصلی لوگو در assets/source/logo.svg بایگانی شده است.)
 *
 * چرا ارقام لاتین؟
 *   عدد درصد با فونت mono و `tabular-nums` نمایش داده می‌شود تا ظاهری مدرن
 *   داشته باشد و هنگام تغییر سریع اعداد، عرض آن نلرزد.
 *
 * دسترس‌پذیری:
 *   role="progressbar" با aria-valuenow/min/max و متن جایگزین فارسی؛
 *   انیمیشن‌ها با prefers-reduced-motion خاموش می‌شوند (در globals.css).
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
  /** نمایش نشان ضربان سامانه در مرکز حلقه. */
  showBadge?: boolean;
  className?: string;
}

const RING_STROKE = 7;

function ProgressMeterComponent({
  percent,
  phaseLabel,
  phaseNumber,
  phaseCount,
  remainingLabel,
  size = 116,
  showBar = true,
  showBadge = true,
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
        {/* هالهٔ رنگی تنفس‌کننده پشت حلقه — عمق و پویایی */}
        <div
          className={`absolute inset-1 rounded-full bg-gradient-to-br from-indigo-500/25 via-sky-400/20 to-emerald-400/25 blur-xl ${
            isComplete ? '' : 'animate-soft-glow'
          }`}
        />

        <svg width={size} height={size} className="relative -rotate-90" aria-hidden="true">
          <defs>
            <linearGradient id="progress-meter-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#4f46e5" />
              <stop offset="50%" stopColor="#0ea5e9" />
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
            style={{ transition: 'stroke-dashoffset 240ms cubic-bezier(0.4, 0, 0.2, 1)' }}
          />
        </svg>

        {/* مرکز حلقه: نشان ضربان گرادیانی سامانه + عدد درصد لاتین */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
          {showBadge && (
            <span
              aria-hidden="true"
              className="flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 via-sky-500 to-emerald-500 text-white shadow-md shadow-sky-500/40"
            >
              <Activity className={`h-4 w-4 ${isComplete ? '' : 'animate-pulse'}`} />
            </span>
          )}
          <div className="flex items-baseline gap-px font-mono" dir="ltr">
            <span className="text-[1.6rem] font-black leading-none tracking-tight text-slate-900 tabular-nums">
              {rounded}
            </span>
            <span className="text-xs font-bold text-slate-400">%</span>
          </div>
        </div>
      </div>

      {showBar && (
        <div className="w-full space-y-1.5">
          <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-200/90 shadow-inner">
            <div
              className="relative h-full overflow-hidden rounded-full bg-gradient-to-l from-indigo-600 via-sky-500 to-emerald-500 shadow-sm shadow-sky-500/40"
              style={{ width: `${safePercent}%`, transition: 'width 240ms cubic-bezier(0.4, 0, 0.2, 1)' }}
            >
              {/* درخشش عبوری روی نوار — پویایی واقعی به‌جای pulse ساده */}
              {!isComplete && (
                <span className="absolute inset-y-0 -left-1/2 w-1/2 skew-x-12 bg-white/45 animate-progress-shimmer" />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-[10px] font-extrabold">
            <span className="truncate text-slate-600">{phaseLabel || 'در حال پردازش…'}</span>
            {phaseCount && phaseCount > 1 && phaseNumber ? (
              <span
                className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-slate-500 tabular-nums"
                dir="ltr"
              >
                {phaseNumber}/{phaseCount}
              </span>
            ) : null}
          </div>

          {remainingLabel && !isComplete && (
            <p className="text-center text-[10px] font-bold text-slate-400">{remainingLabel}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * تمام propها اولیه (عدد/رشته/بولین) هستند، پس مقایسهٔ سطحی React دقیقاً کار
 * می‌کند. این حلقه هنگام اجرای موتور هوشمند روی صفحه است و بدون memo با هر
 * تغییر state والد (که در حین پردازش مکرر است) بی‌دلیل دوباره رندر می‌شد.
 */
export const ProgressMeter = React.memo(ProgressMeterComponent);
