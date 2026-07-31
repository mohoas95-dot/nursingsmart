'use client';

import React from 'react';

/**
 * AiEngineBadge — نسخه ۲۰۲۶
 *
 * طبق درخواست کارفرما:
 *   - تمامی نوشته‌های مربوط به هوش‌های قبلی (Groq, DeepSeek, OpenAI...) حذف شده.
 *   - فقط Gemini Direct نمایش داده می‌شود: primary gemini-2.5-flash با fallback gemini-3.5-flash
 *   - برای حفظ حریم UI، badge بسیار ساده و بدون جزئیات فنی زیاد.
 *   - اگر کارفرما بخواهد هیچ نوشته‌ای از AI در UI نباشد، می‌تواند این کامپوننت را
 *     کلا render نکند؛ اما در حالت پیش‌فرض یک نشان کوچک و تمیز از Gemini نشان می‌دهد.
 */

export type AiEngineBadgeSize = 'compact' | 'full';

interface AiEngineBadgeProps {
  size?: AiEngineBadgeSize;
  className?: string;
  /** اگر true باشد، هیچ چیزی render نمی‌شود (برای حالت حذف کامل نوشته‌ها) */
  hidden?: boolean;
}

function GeminiMark({ className, gradientId }: { className?: string; gradientId: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Gemini" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="50%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill={`url(#${gradientId})`} />
      <path
        d="M12 6l2.2 4.5L18.5 12 14.2 16.5 12 21l-2.2-4.5L5.5 12 9.8 10.5 12 6z"
        fill="white"
        opacity="0.95"
      />
    </svg>
  );
}

export function AiEngineBadge({ size = 'full', className = '', hidden = false }: AiEngineBadgeProps) {
  if (hidden) return null;

  const isCompact = size === 'compact';
  const uid = React.useId().replace(/[:]/g, '');
  const gradientId = `gemini-badge-${uid}`;

  const shellClass = isCompact
    ? 'inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/15 px-1.5 py-0.5 backdrop-blur-sm'
    : 'inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-2 py-1 shadow-sm backdrop-blur-sm';

  const markClass = isCompact ? 'w-3 h-3 shrink-0' : 'w-3.5 h-3.5 shrink-0';
  const nameClass = isCompact ? 'text-[9px] font-black leading-none' : 'text-[10px] font-black leading-none';
  const roleClass = 'text-[8px] font-bold leading-none text-white/70 mt-0.5';

  return (
    <span
      dir="ltr"
      className={`${shellClass} ${className}`}
      title="هوش مصنوعی: Gemini 2.5 Flash (primary) با fallback به Gemini 3.5 Flash در شرایط شلوغی/تاخیر/مفهوم نامفهوم"
    >
      <span className="inline-flex items-center justify-center rounded-full bg-white/90 p-[3px] shadow-xs">
        <GeminiMark className={markClass} gradientId={gradientId} />
      </span>
      <span className="inline-flex flex-col items-start">
        <span className={`${nameClass} text-white`}>Gemini 2.5 Flash</span>
        {!isCompact && <span className={roleClass}>fallback: 3.5 Flash</span>}
      </span>
    </span>
  );
}

export default AiEngineBadge;
