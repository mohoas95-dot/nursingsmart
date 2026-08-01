'use client';

/**
 * کارت «امروز به وقت ایران» — نسخهٔ پریمیوم
 * ---------------------------------------------------------------------------
 * فقط ظاهر بازطراحی شده است. منطق تاریخ/ساعت (Asia/Tehran)، فرمترها،
 * تیک هر ثانیه و محاسبهٔ زاویهٔ عقربه‌ها بدون تغییر باقی مانده‌اند.
 */

import { CalendarDays } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const dateFormatter = new Intl.DateTimeFormat('fa-IR', {
  timeZone: 'Asia/Tehran', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});
const timeFormatter = new Intl.DateTimeFormat('fa-IR', {
  timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});
/** نسخهٔ کوتاه تاریخ برای بج پایین (بدون نام روز هفته) */
const shortDateFormatter = new Intl.DateTimeFormat('fa-IR', {
  timeZone: 'Asia/Tehran', day: 'numeric', month: 'long', year: 'numeric'
});

export default function TehranDateTime({ lastSync: _lastSync }: { lastSync?: string | null }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = now?.getSeconds() || 0;
  const minutes = now?.getMinutes() || 0;
  const hours = (now?.getHours() || 0) % 12;

  const tickMarks = useMemo(
    () => Array.from({ length: 60 }, (_, i) => i),
    []
  );

  return (
    <section
      dir="rtl"
      aria-label="تاریخ و ساعت تهران"
      className="tdt-card group relative overflow-hidden rounded-[26px] px-7 py-7 text-white"
      style={{
        background: 'linear-gradient(135deg, #0B7A67 0%, #0F9D7A 48%, #1BBF8A 100%)',
        boxShadow: '0 18px 45px rgba(0, 0, 0, 0.12)',
      }}
    >
      {/* ================= موج‌های متحرک پس‌زمینه (سبک و آرام) ================= */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <svg
          className="tdt-wave tdt-wave-1 absolute -bottom-6 left-[-10%] h-[140%] w-[140%]"
          viewBox="0 0 1200 400"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0 220 C150 160, 300 280, 450 210 C600 140, 750 260, 900 200 C1050 140, 1120 180, 1200 170 L1200 400 L0 400 Z"
            fill="rgba(255,255,255,0.08)"
          />
        </svg>
        <svg
          className="tdt-wave tdt-wave-2 absolute -bottom-10 left-[-15%] h-[150%] w-[150%]"
          viewBox="0 0 1200 400"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0 250 C180 190, 320 310, 500 240 C680 170, 820 300, 980 230 C1100 180, 1160 220, 1200 210 L1200 400 L0 400 Z"
            fill="rgba(255,255,255,0.06)"
          />
        </svg>
        <svg
          className="tdt-wave tdt-wave-3 absolute -top-8 right-[-12%] h-[120%] w-[140%]"
          viewBox="0 0 1200 400"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0 80 C200 140, 360 20, 540 90 C720 160, 880 40, 1040 100 C1120 130, 1170 90, 1200 100 L1200 0 L0 0 Z"
            fill="rgba(255,255,255,0.05)"
          />
        </svg>
        {/* هاله‌های نور نرم */}
        <div className="absolute -left-16 top-1/2 h-48 w-48 -translate-y-1/2 rounded-full bg-white/[0.07] blur-3xl" />
        <div className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-emerald-200/10 blur-3xl" />
      </div>

      {/* ================= محتوای اصلی ================= */}
      <div className="relative flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-between sm:gap-5 lg:gap-8">

        {/* ----- ساعت آنالوگ (چپ بصری در دسکتاپ) ----- */}
        <div className="order-1 flex shrink-0 items-center justify-center sm:order-3">
          <div
            className="tdt-clock relative h-[130px] w-[130px] sm:h-[136px] sm:w-[136px] lg:h-[145px] lg:w-[145px] rounded-full bg-white"
            style={{
              boxShadow:
                '0 14px 36px rgba(0,0,0,0.18), 0 2px 0 rgba(255,255,255,0.9) inset, 0 -1px 0 rgba(0,0,0,0.04) inset',
            }}
            aria-label="ساعت عقربه‌ای تهران"
            role="img"
          >
            {/* حلقه داخلی ظریف */}
            <div className="absolute inset-[6px] rounded-full border border-[#E8F1EE]/80" />

            {/* نشانه‌های دقیقه / ساعت */}
            {tickMarks.map((i) => {
              const angle = (i * 6 * Math.PI) / 180;
              const isHour = i % 5 === 0;
              const radius = isHour ? 40 : 41.5;
              return (
                <i
                  key={i}
                  className={`absolute rounded-full ${
                    isHour
                      ? 'h-[8px] w-[2.5px] bg-[#0B7A67]'
                      : 'h-[4px] w-px bg-[#0F9D7A]/45'
                  }`}
                  style={{
                    left: `calc(50% + ${Math.sin(angle) * radius}%)`,
                    top: `calc(50% - ${Math.cos(angle) * radius}%)`,
                    transform: `translate(-50%, -50%) rotate(${i * 6}deg)`,
                  }}
                />
              );
            })}

            {/* عقربه ساعت — سبز تیره */}
            <span
              className="absolute left-1/2 top-1/2 h-[27%] w-[3.5px] origin-bottom rounded-full bg-[#064E3B] shadow-sm"
              style={{ transform: `translate(-50%, -100%) rotate(${hours * 30 + minutes / 2}deg)` }}
            />
            {/* عقربه دقیقه — سبز تیره */}
            <span
              className="absolute left-1/2 top-1/2 h-[35%] w-[2.5px] origin-bottom rounded-full bg-[#0B7A67] shadow-sm"
              style={{ transform: `translate(-50%, -100%) rotate(${minutes * 6}deg)` }}
            />
            {/* عقربه ثانیه — قرمز روشن؛ transition خطی ۱ثانیه‌ای = حرکت پیوسته */}
            <span
              className="tdt-second-hand absolute left-1/2 top-1/2 h-[39%] w-[1.5px] origin-bottom rounded-full bg-[#EF4444]"
              style={{ transform: `translate(-50%, -100%) rotate(${seconds * 6}deg)` }}
            />
            {/* مرکز فلزی تیره */}
            <span
              className="absolute left-1/2 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{
                background: 'linear-gradient(145deg, #1F2937 0%, #0B7A67 55%, #064E3B 100%)',
              }}
            />
          </div>
        </div>

        {/* ----- اطلاعات تاریخ و ساعت دیجیتال (مرکز) ----- */}
        <div className="order-2 flex min-w-0 flex-1 flex-col items-center text-center sm:px-1">
          <p className="text-[12px] sm:text-[13px] font-medium tracking-wide text-white/85">
            امروز به وقت ایران
          </p>

          <p
            className="mt-2 text-[22px] leading-snug font-bold text-white sm:text-[26px] lg:text-[28px]"
            style={{ fontFamily: 'var(--font-titr), var(--font-vazirmatn), sans-serif' }}
          >
            {now ? dateFormatter.format(now) : 'در حال دریافت تاریخ…'}
          </p>

          <p
            className="mt-1 font-mono text-[40px] font-extrabold leading-none tracking-tight text-white tabular-nums sm:text-[48px] lg:text-[52px]"
            style={{ fontFamily: 'var(--font-vazirmatn), ui-sans-serif, system-ui, sans-serif', fontWeight: 800 }}
            dir="ltr"
            aria-live="polite"
          >
            {now ? timeFormatter.format(now) : '--:--:--'}
          </p>

          {/* بج/چیپ تاریخ کوتاه */}
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/15 px-3.5 py-1.5 text-[12px] font-bold text-white/95 backdrop-blur-sm">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 opacity-90" strokeWidth={2} aria-hidden="true" />
            <span>{now ? shortDateFormatter.format(now) : '—'}</span>
          </div>
        </div>

        {/* ----- دکمهٔ تقویم شیشه‌ای (راست بصری) — فقط آیکون ----- */}
        <div className="order-3 flex shrink-0 items-center justify-center sm:order-1">
          <button
            type="button"
            tabIndex={0}
            aria-label="تقویم امروز"
            title="امروز به وقت ایران"
            className="tdt-cal-btn relative grid h-[64px] w-[64px] place-items-center overflow-hidden rounded-full border border-white/25 bg-white/20 text-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur-md transition-transform duration-200 ease-out hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B7A67] active:scale-95 lg:h-[72px] lg:w-[72px] cursor-default"
          >
            <CalendarDays className="relative z-[1] h-7 w-7 lg:h-8 lg:w-8" strokeWidth={1.75} aria-hidden="true" />
            {/* ripple تزئینی روی کلیک (CSS) */}
            <span className="tdt-ripple" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
