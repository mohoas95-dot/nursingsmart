'use client';

import React from 'react';
import { Activity } from 'lucide-react';
import { ProgressMeter } from './ProgressMeter';

/**
 * BusyOverlay — Presentational Component
 *
 * RESPONSIBILITY:
 *   Render a compact overlay card when the app is busy (solving, saving,
 *   AI processing) — به‌همراه نوار پیشرفت ۰ تا ۱۰۰ درصد که با مراحل واقعی
 *   پردازش هم‌گام است.
 *
 * طراحی عمداً فشرده است: کارت کوچک با یک عنوان کوتاه، حلقهٔ درصد و برچسب
 *   مرحله. فهرست کامل مراحل و متن‌های توضیحی بلند حذف شده‌اند تا پنجرهٔ
 *   لودینگ بخش کوچکی از صفحه را بگیرد.
 *
 * Extracted from: app/page.tsx (Phase 6)
 */

export interface BusyOverlayProps {
  subtitle: string;
  /** درصد پیشرفت (۰ تا ۱۰۰). اگر تعریف نشود فقط انیمیشن نامعین نمایش داده می‌شود. */
  percent?: number;
  /** برچسب مرحلهٔ جاری. */
  phaseLabel?: string;
  phaseNumber?: number;
  phaseCount?: number;
  /** متن زمان باقی‌مانده. */
  remainingLabel?: string;
  /** عنوان کوتاه بالای کارت. */
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
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 backdrop-blur-md p-4 cursor-progress">
      <div className="relative w-full max-w-[19rem] overflow-hidden rounded-3xl border border-white/50 bg-white/90 shadow-2xl shadow-slate-900/25">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-l from-indigo-500 via-sky-500 to-emerald-500" />

        <div
          className="relative flex flex-col items-center gap-3 px-6 py-6 text-center"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          {/* عنوان کوتاه عملیات در حال انجام */}
          <h3 className="text-sm font-black text-slate-800">{subtitle}</h3>

          {hasProgress ? (
            <ProgressMeter
              percent={percent as number}
              phaseLabel={phaseLabel}
              phaseNumber={phaseNumber}
              phaseCount={phaseCount}
              remainingLabel={remainingLabel}
              size={104}
            />
          ) : (
            <div className="relative flex h-16 w-16 items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-indigo-200/80" />
              <div className="absolute inset-1 rounded-full border-[3px] border-transparent border-t-indigo-600 border-r-sky-500 animate-spin" />
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 via-sky-500 to-emerald-500 text-white shadow-md shadow-sky-500/30">
                <Activity className="h-4 w-4 animate-pulse" />
              </div>
            </div>
          )}

          <p className="text-[11px] font-bold text-slate-400">{title}</p>
        </div>
      </div>
    </div>
  );
}
