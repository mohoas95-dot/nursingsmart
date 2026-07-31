'use client';

import React from 'react';

/**
 * AiEngineBadge — Presentational Component (معماری جدید OpenRouter)
 *
 * RESPONSIBILITY:
 *   تگ ترکیبی «Gemini 2.5 Flash + Gemini 2.5 Flash» برای هدر چت‌باکس.
 *
 *   معماری جدید بر پایه Gemini (جایگزین Groq + Gemini direct):
 *     • متن  → gemini-2.5-flash      (Text Analysis)
 *     • تصویر → gemini-2.5-flash         (Vision/OCR) با fallback به gemini-3.5-flash
 *   این کامپوننت هر دو را با لوگو و نقش‌شان به‌صورت شکیل نمایش می‌دهد تا کاربر
 *   بداند کدام موتور پشت کدام قابلیت است.
 *
 * طراحی:
 *   قرص شیشه‌ای (glass pill) روی هدر گرادیانی چت، با دو نشان کوچک که هرکدام
 *   لوگوی برند + نام + نقش را در خود دارند و یک جداکننده نازک بین‌شان.
 */

export type AiEngineBadgeSize = 'compact' | 'full';

interface AiEngineBadgeProps {
  size?: AiEngineBadgeSize;
  className?: string;
}

/**
 * نشان Gemini 2.5 Flash — گرادیان آبی-نیلی با حرف D انتزاعی (بر اساس هویت بصری Gemini 2.5 Flash)
 */
function Gemini 2.5 FlashMark({ className, gradientId }: { className?: string; gradientId: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Gemini 2.5 Flash" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4A90E2" />
          <stop offset="50%" stopColor="#357ABD" />
          <stop offset="100%" stopColor="#1E5A8A" />
        </linearGradient>
      </defs>
      {/* دایره پس‌زمینه + حرف D خلاقانه */}
      <circle cx="12" cy="12" r="10" fill={`url(#${gradientId})`} />
      <path
        d="M8 7.5h3.2c2.8 0 4.8 1.8 4.8 4.5s-2 4.5-4.8 4.5H8V7.5Zm2 2v5h1.1c1.5 0 2.6-1 2.6-2.5S12.6 9.5 11.1 9.5H10Z"
        fill="white"
      />
    </svg>
  );
}

/**
 * نشان OpenAI (برای Gemini 2.5 Flash) — لوگوی ساده‌سازی‌شده OpenAI با گرادیان سبز-خاکستری
 */
function OpenAIMark({ className, gradientId }: { className?: string; gradientId: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="OpenAI GPT-4o" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#10A37F" />
          <stop offset="50%" stopColor="#0D8A6A" />
          <stop offset="100%" stopColor="#065F46" />
        </linearGradient>
      </defs>
      {/* شش‌ضلعی انتزاعی OpenAI */}
      <path
        fill={`url(#${gradientId})`}
        d="M12 2.2l7.8 4.5v9L12 20.2 4.2 15.7v-9L12 2.2Zm0 2.2L6.2 7.7v6.6L12 17.6l5.8-3.3V7.7L12 4.4Z"
      />
      <circle cx="12" cy="12" r="2.2" fill={`url(#${gradientId})`} />
    </svg>
  );
}

export function AiEngineBadge({ size = 'full', className = '' }: AiEngineBadgeProps) {
  const isCompact = size === 'compact';

  const uid = React.useId().replace(/[:]/g, '');
  const deepSeekGradientId = `ai-badge-deepseek-${uid}`;
  const openAIGradientId = `ai-badge-openai-${uid}`;

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
      title="تحلیل متن با Gemini 2.5 Flash (gemini-2.5-flash) و تحلیل تصویر با Gemini 2.5 Flash (fallback به GPT-4o) از طریق OpenRouter — اعتبار ۱۰۰ دلاری"
    >
      {/* موتور متن — Gemini 2.5 Flash */}
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded-full bg-white/90 p-[3px] shadow-xs">
          <Gemini 2.5 FlashMark className={markClass} gradientId={deepSeekGradientId} />
        </span>
        <span className="inline-flex flex-col items-start">
          <span className={`${nameClass} text-white`}>Gemini 2.5 Flash</span>
          {!isCompact && <span className={roleClass}>متن</span>}
        </span>
      </span>

      {/* جداکننده */}
      <span aria-hidden="true" className={`${isCompact ? 'h-3' : 'h-4'} w-px bg-white/30`} />

      {/* موتور تصویر — Gemini 2.5 Flash */}
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded-full bg-white/90 p-[3px] shadow-xs">
          <OpenAIMark className={markClass} gradientId={openAIGradientId} />
        </span>
        <span className="inline-flex flex-col items-start">
          <span className={`${nameClass} text-white`}>Gemini 2.5 Flash</span>
          {!isCompact && <span className={roleClass}>تصویر</span>}
        </span>
      </span>
    </span>
  );
}

export default AiEngineBadge;
