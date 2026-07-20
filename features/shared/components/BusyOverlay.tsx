'use client';

import React from 'react';
import { Activity } from 'lucide-react';

/**
 * BusyOverlay — Presentational Component
 *
 * RESPONSIBILITY:
 *   Render a full-screen overlay with loading animation when the app is busy
 *   (e.g., solving, saving, AI processing).
 *
 * Extracted from: app/page.tsx (Phase 6)
 */

export interface BusyOverlayProps {
  subtitle: string;
}

export function BusyOverlay({ subtitle }: BusyOverlayProps) {
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/35 backdrop-blur-md p-4 cursor-progress">
      <div className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-white/50 bg-white/80 shadow-2xl shadow-slate-900/25">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-l from-indigo-500 via-sky-500 to-emerald-500" />
        <div className="absolute -top-20 -right-16 h-44 w-44 rounded-full bg-sky-400/20 blur-3xl" />
        <div className="absolute -bottom-20 -left-12 h-40 w-40 rounded-full bg-emerald-400/20 blur-3xl" />

        <div
          className="relative flex flex-col items-center gap-5 px-8 py-9 text-center"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="relative flex h-24 w-24 items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-indigo-200/80" />
            <div className="absolute inset-2 rounded-full border-[3px] border-transparent border-t-indigo-600 border-r-sky-500 animate-spin" />
            <div className="absolute inset-5 rounded-full border-2 border-emerald-200/70 border-b-emerald-500 animate-spin [animation-direction:reverse] [animation-duration:1.4s]" />
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 via-sky-500 to-emerald-500 text-white shadow-lg shadow-sky-500/30">
              <Activity className="h-6 w-6 animate-pulse" />
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-2xl font-black text-slate-900">لطفا شکیبا باشید</h3>
            <p className="text-sm font-bold leading-7 text-slate-600">{subtitle}</p>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/70 px-4 py-2 text-[11px] font-extrabold text-slate-500 shadow-sm">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            در حال انجام عملیات، لطفاً صفحه را نبندید.
          </div>
        </div>
      </div>
    </div>
  );
}
