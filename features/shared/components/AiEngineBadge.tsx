'use client';

import React from 'react';

/**
 * AiEngineBadge — Presentational Component
 *
 * RESPONSIBILITY:
 *   تگ ترکیبی «Groq + Gemini» برای هدر چت‌باکس.
 *
 *   چت‌باکس دیگر تک‌موتوره نیست؛ دو موتور مستقل دارد:
 *     • Groq (Llama)      → تحلیل پیام‌های متنی
 *     • Gemini 2.5 Flash  → تحلیل تصاویر و OCR فارسی
 *   این کامپوننت هر دو را با لوگو و نقش‌شان به‌صورت شکیل نمایش می‌دهد تا کاربر
 *   بداند کدام موتور پشت کدام قابلیت است.
 *
 * طراحی:
 *   قرص شیشه‌ای (glass pill) روی هدر گرادیانی چت، با دو نشان کوچک که هرکدام
 *   لوگوی برند + نام + نقش را در خود دارند و یک جداکنندهٔ نازک بین‌شان.
 *   در حالت فشرده (تمام‌صفحه/موبایل) فقط لوگوها و نام‌ها می‌مانند.
 *
 * لوگوها به‌صورت SVG درون‌خطی رسم شده‌اند (بدون فایل باینری و بدون درخواست
 * شبکه) تا هم سبک باشند، هم در حالت آفلاین/PWA سالم بمانند و هم رنگ‌شان با
 * تم هدر هماهنگ شود.
 */

export type AiEngineBadgeSize = 'compact' | 'full';

interface AiEngineBadgeProps {
  /** compact برای هدر تمام‌صفحه و موبایل، full برای هدر معمولی. */
  size?: AiEngineBadgeSize;
  className?: string;
}

/**
 * نشان Groq — الهام‌گرفته از هویت بصری برند: دایرهٔ نارنجی/مرجانی با
 * حفرهٔ مرکزی و «دم» مشخصهٔ حرف q.
 */
function GroqMark({ className, gradientId }: { className?: string; gradientId: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Groq" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FF8A4C" />
          <stop offset="55%" stopColor="#F55036" />
          <stop offset="100%" stopColor="#D93A25" />
        </linearGradient>
      </defs>
      {/* حلقهٔ اصلی */}
      <path
        fill={`url(#${gradientId})`}
        d="M12 2.4a9.6 9.6 0 1 0 0 19.2 9.6 9.6 0 0 0 0-19.2Zm0 3.55a6.05 6.05 0 1 1 0 12.1 6.05 6.05 0 0 1 0-12.1Z"
      />
      {/* دم مشخصهٔ حرف q — طول و ضخامتش طوری تنظیم شده که در ۱۲ پیکسل هم خوانا بماند */}
      <path
        fill={`url(#${gradientId})`}
        d="M13.1 12.2h3.4v7.9a1.7 1.7 0 0 1-3.4 0V12.2Z"
      />
    </svg>
  );
}

/**
 * نشان Gemini — ستارهٔ چهارپرِ مشخصهٔ برند با گرادیان آبی-بنفش گوگل.
 */
function GeminiMark({ className, gradientId }: { className?: string; gradientId: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Gemini" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#4796E3" />
          <stop offset="50%" stopColor="#8C6BE8" />
          <stop offset="100%" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradientId})`}
        d="M12 1.5c.34 4.02 1.7 6.9 4.08 8.63 1.28.93 3.09 1.55 5.42 1.87-2.33.32-4.14.94-5.42 1.87-2.38 1.73-3.74 4.61-4.08 8.63-.34-4.02-1.7-6.9-4.08-8.63-1.28-.93-3.09-1.55-5.42-1.87 2.33-.32 4.14-.94 5.42-1.87C10.3 8.4 11.66 5.52 12 1.5Z"
      />
    </svg>
  );
}

export function AiEngineBadge({ size = 'full', className = '' }: AiEngineBadgeProps) {
  const isCompact = size === 'compact';

  // شناسهٔ یکتا برای gradient ها: اگر چند نمونه از این تگ هم‌زمان در DOM باشند
  // (مثلاً هدر معمولی و هدر تمام‌صفحه)، شناسه‌های تکراری باعث نمی‌شود مرورگر
  // گرادیان اشتباه را روی نشان‌ها اعمال کند.
  const uid = React.useId().replace(/[:]/g, '');
  const groqGradientId = `ai-badge-groq-${uid}`;
  const geminiGradientId = `ai-badge-gemini-${uid}`;

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
      title="تحلیل متن با Groq (Llama) و تحلیل تصویر با Gemini 2.5 Flash"
    >
      {/* موتور متن */}
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded-full bg-white/90 p-[3px] shadow-xs">
          <GroqMark className={markClass} gradientId={groqGradientId} />
        </span>
        <span className="inline-flex flex-col items-start">
          <span className={`${nameClass} text-white`}>Groq</span>
          {!isCompact && <span className={roleClass}>متن</span>}
        </span>
      </span>

      {/* جداکننده */}
      <span aria-hidden="true" className={`${isCompact ? 'h-3' : 'h-4'} w-px bg-white/30`} />

      {/* موتور تصویر */}
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded-full bg-white/90 p-[3px] shadow-xs">
          <GeminiMark className={markClass} gradientId={geminiGradientId} />
        </span>
        <span className="inline-flex flex-col items-start">
          <span className={`${nameClass} text-white`}>Gemini</span>
          {!isCompact && <span className={roleClass}>تصویر</span>}
        </span>
      </span>
    </span>
  );
}

export default AiEngineBadge;
