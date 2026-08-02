'use client';

import React from 'react';

/**
 * ShiftLeaderBadge — آیکون سفارشی نشان سرشیفت
 *
 * جایگزین ایموجی تاج (👑) در سلول‌های جدول شیفت.
 * یک نشان (بج) ستاره‌ای با سپر که نماد مسئولیت شیفت است.
 * سایز: inline و هم‌اندازه ایموجی (۱em) تا ابعاد سلول‌ها تغییر نکند.
 */
export function ShiftLeaderBadge() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className="inline-block w-[1em] h-[1em] align-[-0.125em]"
      aria-label="سرشیفت"
      role="img"
    >
      {/* سپر */}
      <path
        d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.25C16.6 21.15 20 16.25 20 11V6l-8-4z"
        fill="#EAB308"
        stroke="#A16207"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {/* ستاره مرکزی */}
      <path
        d="M12 7.5l1.25 2.55 2.8.4-2.03 1.98.48 2.77L12 13.85l-2.5 1.35.48-2.77-2.03-1.98 2.8-.4z"
        fill="#FDE68A"
        stroke="#92400E"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * ShiftLeaderBadgeLarge — نسخه بزرگ‌تر برای استفاده در legend/راهنما
 */
export function ShiftLeaderBadgeLarge({ className = '' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      className={`inline-block w-5 h-5 ${className}`}
      aria-label="سرشیفت"
      role="img"
    >
      <path
        d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.25C16.6 21.15 20 16.25 20 11V6l-8-4z"
        fill="#EAB308"
        stroke="#A16207"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M12 7.5l1.25 2.55 2.8.4-2.03 1.98.48 2.77L12 13.85l-2.5 1.35.48-2.77-2.03-1.98 2.8-.4z"
        fill="#FDE68A"
        stroke="#92400E"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
