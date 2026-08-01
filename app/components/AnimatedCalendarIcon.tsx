'use client';

/**
 * آیکون سه‌بعدی تقویم با انیمیشن بسیار ملایم (SVG خالص — بدون وابستگی Lottie).
 * فقط برای تزئین کارت «انتخاب بازه برنامه‌ریزی» استفاده می‌شود.
 */
export default function AnimatedCalendarIcon({
  className = '',
  size = 96,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <div
      className={`relative shrink-0 select-none pointer-events-none ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* هاله نرم پس‌زمینه */}
      <div className="absolute inset-0 rounded-[28%] bg-gradient-to-br from-[#14B88A]/25 via-[#0F9D7A]/10 to-transparent blur-md animate-soft-glow" />

      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10 animate-cal-float drop-shadow-[0_12px_24px_rgba(15,157,122,0.22)]"
      >
        <defs>
          <linearGradient id="cal-body" x1="18" y1="22" x2="102" y2="108" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFFFFF" />
            <stop offset="1" stopColor="#F0FDF8" />
          </linearGradient>
          <linearGradient id="cal-top" x1="18" y1="18" x2="102" y2="48" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0F9D7A" />
            <stop offset="1" stopColor="#14B88A" />
          </linearGradient>
          <linearGradient id="cal-side" x1="90" y1="30" x2="112" y2="100" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0B7A5F" />
            <stop offset="1" stopColor="#0F9D7A" />
          </linearGradient>
          <linearGradient id="cal-check" x1="72" y1="72" x2="108" y2="108" gradientUnits="userSpaceOnUse">
            <stop stopColor="#0F9D7A" />
            <stop offset="1" stopColor="#14B88A" />
          </linearGradient>
          <filter id="cal-soft" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#0F9D7A" floodOpacity="0.18" />
          </filter>
        </defs>

        {/* سایه زمین */}
        <ellipse cx="58" cy="108" rx="34" ry="6" fill="#0F9D7A" opacity="0.12" className="animate-cal-shadow" />

        {/* بدنه سه‌بعدی (وجه کناری) */}
        <path
          d="M92 34 L108 42 L108 96 C108 102 103 106 96 106 L80 98 L80 42 C80 36 86 32 92 34Z"
          fill="url(#cal-side)"
          opacity="0.9"
        />

        {/* بدنه اصلی */}
        <g filter="url(#cal-soft)">
          <rect x="16" y="28" width="76" height="72" rx="16" fill="url(#cal-body)" stroke="#E8F1EE" strokeWidth="1.5" />
          {/* نوار بالای تقویم */}
          <path
            d="M16 44 V36 C16 31.6 19.6 28 24 28 H84 C88.4 28 92 31.6 92 36 V44 H16Z"
            fill="url(#cal-top)"
          />
          {/* قلاب‌های فلزی */}
          <rect x="34" y="20" width="7" height="18" rx="3.5" fill="#D1FAE5" stroke="#0F9D7A" strokeWidth="1.5" />
          <rect x="67" y="20" width="7" height="18" rx="3.5" fill="#D1FAE5" stroke="#0F9D7A" strokeWidth="1.5" />
          <rect x="34" y="18" width="7" height="8" rx="3.5" fill="#0F9D7A" />
          <rect x="67" y="18" width="7" height="8" rx="3.5" fill="#0F9D7A" />
        </g>

        {/* شبکه روزها */}
        <g opacity="0.9" className="animate-cal-grid">
          <rect x="28" y="54" width="10" height="8" rx="2" fill="#E8F1EE" />
          <rect x="44" y="54" width="10" height="8" rx="2" fill="#E8F1EE" />
          <rect x="60" y="54" width="10" height="8" rx="2" fill="#BBF7D0" />
          <rect x="76" y="54" width="10" height="8" rx="2" fill="#E8F1EE" />

          <rect x="28" y="68" width="10" height="8" rx="2" fill="#E8F1EE" />
          <rect x="44" y="68" width="10" height="8" rx="2" fill="#0F9D7A" className="animate-cal-pulse" />
          <rect x="60" y="68" width="10" height="8" rx="2" fill="#E8F1EE" />
          <rect x="76" y="68" width="10" height="8" rx="2" fill="#E8F1EE" />

          <rect x="28" y="82" width="10" height="8" rx="2" fill="#BBF7D0" />
          <rect x="44" y="82" width="10" height="8" rx="2" fill="#E8F1EE" />
          <rect x="60" y="82" width="10" height="8" rx="2" fill="#E8F1EE" />
          <rect x="76" y="82" width="10" height="8" rx="2" fill="#D1FAE5" />
        </g>

        {/* بج تیک سبز سه‌بعدی */}
        <g className="animate-cal-check origin-center" style={{ transformOrigin: '92px 92px' }}>
          <circle cx="92" cy="92" r="16" fill="url(#cal-check)" filter="url(#cal-soft)" />
          <circle cx="92" cy="92" r="16" fill="none" stroke="#FFFFFF" strokeOpacity="0.35" strokeWidth="2" />
          <path
            d="M84.5 92.5 L89.5 97.5 L100.5 86.5"
            stroke="white"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </g>
      </svg>
    </div>
  );
}
