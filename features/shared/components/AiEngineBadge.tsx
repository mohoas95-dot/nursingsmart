'use client';

import React from 'react';

/**
 * AiEngineBadge — Presentational Component (معماری جدید OpenRouter)
 *
 * RESPONSIBILITY:
 *   تگ «GPT-4o-mini» برای هدر چت‌باکس.
 *
 *   معماری جدید بر پایه OpenRouter — متن و تصویر هر دو یک موتور دارند:
 *     • متن   → openai/gpt-4o-mini (Text Analysis) با fallback به gpt-4o
 *     • تصویر → openai/gpt-4o-mini (Vision/OCR)   با fallback به gpt-4o
 *   این کامپوننت موتور واحد را با نقش‌هایش (متن + تصویر) نمایش می‌دهد تا کاربر
 *   بداند کدام موتور پشت قابلیت‌های هوشمند است.
 *
 * طراحی:
 *   قرص شیشه‌ای (glass pill) روی هدر گرادیانی چت، با نشان OpenAI و نام مدل +
 *   نقش‌ها (متن و تصویر) و اشارهٔ کوتاه به fallback.
 */

export type AiEngineBadgeSize = 'compact' | 'full';

interface AiEngineBadgeProps {
  size?: AiEngineBadgeSize;
  className?: string;
}

/**
 * نشان OpenAI (برای GPT-4o-mini / GPT-4o) — لوگوی ساده‌سازی‌شده OpenAI با گرادیان سبز-خاکستری
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
      title="تحلیل متن و تصویر با GPT-4o-mini و fallback به GPT-4o برای موارد پیچیده از طریق OpenRouter — اعتبار ۱۰۰ دلاری"
    >
      {/* موتور واحد متن و تصویر — GPT-4o-mini */}
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex items-center justify-center rounded-full bg-white/90 p-[3px] shadow-xs">
          <OpenAIMark className={markClass} gradientId={openAIGradientId} />
        </span>
        <span className="inline-flex flex-col items-start">
          <span className={`${nameClass} text-white`}>GPT-4o-mini</span>
          {!isCompact && <span className={roleClass}>متن و تصویر</span>}
        </span>
      </span>
    </span>
  );
}

export default AiEngineBadge;
