'use client';

import React from 'react';

interface Props {
  day: number;
  shift: 'M' | 'E' | 'N';
  jobGroup: 'nurse' | 'assistant';
  shortage: number;
}

/**
 * UNFILLED status — dark-gray background, blinking red warning
 * Per clarification #7: visually distinct for critical staffing shortages
 */
export function UnfilledShiftCell({ day, shift, jobGroup, shortage }: Props) {
  return (
    <div
      dir="rtl"
      className="relative flex flex-col items-center justify-center bg-slate-800 text-white border border-slate-900 rounded-lg p-1 min-h-[56px] overflow-hidden"
      title={`UNFILLED: روز ${day} شیفت ${shift} گروه ${jobGroup === 'nurse' ? 'پرستار' : 'کمک‌بهیار'} — کمبود ${shortage} نفر — پس‌زمینه خاکستری تیره + هشدار قرمز چشمک‌زن`}
    >
      {/* Blinking red dot */}
      <span className="absolute top-1 left-1 w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-[0_0_6px_rgba(239,68,68,0.9)]" />

      {/* Blinking red border animation via pseudo */}
      <span className="absolute inset-0 rounded-lg border-2 border-red-500/70 animate-[blink_1s_infinite] pointer-events-none" />

      <span className="text-[10px] font-black tracking-wider">UNFILLED</span>
      <span className="text-[9px] font-mono opacity-80">
        {shift} {jobGroup === 'nurse' ? 'پرستار' : 'کمک'} -{shortage}
      </span>
      <span className="text-[8px] font-bold text-red-300 animate-pulse mt-0.5">⚠️ بحرانی</span>

      <style jsx>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

/**
 * Legend for UNFILLED status — to be shown in schedule header
 */
export function UnfilledLegend() {
  return (
    <div className="flex items-center gap-2 text-[10px] font-bold text-slate-600" dir="rtl">
      <div className="flex items-center gap-1.5">
        <div className="w-4 h-4 bg-slate-800 border border-red-500 rounded animate-pulse" />
        <span>UNFILLED — شیفت خالی بحرانی (خاکستری تیره + چشمک قرمز)</span>
      </div>
    </div>
  );
}
