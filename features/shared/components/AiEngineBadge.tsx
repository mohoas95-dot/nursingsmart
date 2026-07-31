'use client';

import React from 'react';

/**
 * AiEngineBadge — Presentational Component
 *
 * RESPONSIBILITY:
 *   تگ موتور هوش مصنوعی چت‌باکس برای هدر.
 *
 *   چت‌باکس یک موتور واحد دارد: Puter.js — سرویسی که هم متن و هم تصویر را
 *   با مدل‌های متعدد (از جمله GPT و Gemini) و سهمیهٔ رایگان سخاوتمندانه
 *   تحلیل می‌کند.
 *
 * طراحی:
 *   قرص شیشه‌ای (glass pill) روی هدر گرادیانی چت، با یک نشان که لوگو + نام
 *   موتور را نشان می‌دهد. در حالت فشرده (تمام‌صفحه/موبایل) فقط لوگو و نام
 *   می‌مانند.
 *
 * لوگو به‌صورت SVG درون‌خطی رسم شده (بدون فایل باینری و بدون درخواست شبکه)
 * تا هم سبک باشد، هم در حالت آفلاین/PWA سالم بماند و هم رنگش با تم هدر
 * هماهنگ شود.
 */

export type AiEngineBadgeSize = 'compact' | 'full';

interface AiEngineBadgeProps {
  /** compact برای هدر تمام‌صفحه و موبایل، full برای هدر معمولی. */
  size?: AiEngineBadgeSize;
  className?: string;
}

/**
 * نشان Puter — یک ستارهٔ چهارپر با گرادیان بنفش-صورتی که هویت بصری برند
 * Puter.js را به‌صورت ساده و خوانا در اندازهٔ کوچک نمایش می‌دهد.
 */
function PuterMark({ className, gradientId }: { className?: string; gradientId: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Puter" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="55%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M12 1.8c.3 3.7 1.5 6.3 3.7 7.9 1.2.85 2.8 1.4 4.9 1.7-2.1.3-3.7.85-4.9 1.7-2.2 1.6-3.4 4.2-3.7 7.9-.3-3.7-1.5-6.3-3.7-7.9-1.2-.85-2.8-1.4-4.9-1.7 2.1-.3 3.7-.85 4.9-1.7C10.5 8.1 11.7 5.5 12 1.8Z"
      />
    </svg>
  );
}

export function AiEngineBadge({ size = 'full', className = '' }: AiEngineBadgeProps) {
  const isCompact = size === 'compact';

  // شناسهٔ یکتا برای gradient: اگر چند نمونه از این تگ هم‌زمان در DOM باشند
  // (مثلاً هدر معمولی و هدر تمام‌صفحه)، شناسه‌های تکراری باعث نمی‌شود مرورگر
  // گرادیان اشتباه را روی نشان اعمال کند.
  const uid = React.useId().replace(/[:]/g, '');
  const puterGradientId = `ai-badge-puter-${uid}`;

  const shellClass = isCompact
    ? 'inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/15 px-1.5 py-0.5 backdrop-blur-sm'
    : 'inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-2 py-1 shadow-sm backdrop-blur-sm';

  const markClass = isCompact ? 'w-3 h-3 shrink-0' : 'w-3.5 h-3.5 shrink-0';
  const nameClass = isCompact ? 'text-[8.5px] font-black leading-none' : 'text-[10px] font-black leading-none';
  const roleClass = 'text-[8px] font-bold leading-none text-white/70 mt-0.5';

  return (
    <span
      dir="ltr"
      className={`${shellClass} ${className}`}
      title="تحلیل متن و تصویر با Puter.js"
    >
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded-full bg-white/90 p-[3px] shadow-xs">
          <PuterMark className={markClass} gradientId={puterGradientId} />
        </span>
        <span className="inline-flex flex-col items-start">
          <span className={`${nameClass} text-white`}>Puter</span>
          {!isCompact && <span className={roleClass}>متن و تصویر</span>}
        </span>
      </span>
    </span>
  );
}

export default AiEngineBadge;
