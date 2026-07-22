'use client';

import React from 'react';
import type { SolverOrchestratorProgress } from '../../../domain/solver/worker/solver-orchestrator';

interface Props {
  progress: SolverOrchestratorProgress | null;
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  error?: string | null;
  onCancel?: () => void;
}

export function SolverArenaProgress({ progress, status, error, onCancel }: Props) {
  if (status === 'idle') return null;

  const percent = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="fixed bottom-6 left-6 right-6 md:left-auto md:right-6 md:w-[480px] bg-white border border-slate-200 rounded-2xl shadow-2xl p-5 z-[60] animate-slide-up" dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${status === 'running' ? 'bg-emerald-500 animate-pulse' : status === 'done' ? 'bg-emerald-600' : status === 'error' ? 'bg-red-500' : 'bg-amber-500'}`} />
          <span className="text-sm font-black text-slate-800">
            {status === 'running' && 'در حال تولید سناریوهای هوشمند'}
            {status === 'done' && 'تولید سناریوها تکمیل شد'}
            {status === 'error' && 'خطا در اجرای موتور'}
            {status === 'cancelled' && 'لغو شد'}
          </span>
        </div>
        {status === 'running' && onCancel && (
          <button
            onClick={onCancel}
            className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-xl font-bold transition-colors cursor-pointer"
          >
            لغو اجرا
          </button>
        )}
      </div>

      {progress && (
        <>
          <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden mb-2 border border-slate-200">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] font-bold text-slate-500 mb-1">
            <span>{progress.messageFa}</span>
            <span>{percent}٪</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono text-slate-400">
            <span>زمان سپری‌شده: {(progress.elapsedMs / 1000).toFixed(1)} ثانیه</span>
            <span>بهترین امتیاز: {progress.bestScore.toFixed(1)}</span>
          </div>
        </>
      )}

      {status === 'error' && error && (
        <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-bold">
          {error}
        </div>
      )}

      {status === 'done' && progress && (
        <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-black flex items-center gap-2">
          <span className="text-emerald-600">✓</span>
          {progress.messageFa}
        </div>
      )}
    </div>
  );
}
