'use client';

/**
 * کارت «امروز به وقت ایران» — نسخهٔ پریمیوم (پس‌زمینه روشن)
 * ---------------------------------------------------------------------------
 * فقط ظاهر بازطراحی شده است. منطق تاریخ/ساعت (Asia/Tehran)، فرمترها
 * و تیک هر ثانیه بدون تغییر باقی مانده‌اند.
 *
 * عقربهٔ ثانیه با زاویهٔ تجمعی می‌چرخد تا هنگام عبور از ۵۹→۰
 * به‌جای چرخش معکوس، مسیر رو به جلو را ادامه دهد.
 */

import { CalendarDays } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

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
  // زاویهٔ تجمعی ثانیه (درجه) — هرگز به عقب برنمی‌گردد
  const [secondDeg, setSecondDeg] = useState(0);
  const secondBaseRef = useRef<number | null>(null);
  const lastSecondRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const date = new Date();
      setNow(date);
      const sec = date.getSeconds();
      if (secondBaseRef.current === null) {
        // مقدار اولیه: موقعیت فعلی روی صفحه
        secondBaseRef.current = sec * 6;
        lastSecondRef.current = sec;
        setSecondDeg(sec * 6);
        return;
      }
      const prev = lastSecondRef.current ?? sec;
      // اختلاف رو به جلو (۰…۵۹) تا wrap از ۵۹→۰ به‌صورت +۱ ثانیه دیده شود
      const delta = (sec - prev + 60) % 60;
      if (delta > 0) {
        secondBaseRef.current += delta * 6;
        setSecondDeg(secondBaseRef.current);
        lastSecondRef.current = sec;
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

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
      className="tdt-card group relative overflow-hidden rounded-2xl sm:rounded-[26px] border border-[#C8EBD9] px-3 py-3 sm:px-7 sm:py-7"
      style={{
        background: 'linear-gradient(135deg, #F3FBF7 0%, #E6F7EF 42%, #D4F3E6 100%)',
        boxShadow: '0 10px 32px rgba(15, 157, 122, 0.10)',
      }}
    >
      {/* ================= موج‌های متحرک روشن (شبیه عکس نمونه) ================= */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <svg
          className="tdt-wave tdt-wave-1 absolute inset-x-0 bottom-0 h-[85%] w-[160%] -left-[20%]"
          viewBox="0 0 1440 320"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0,192 C180,140 320,260 520,200 C720,140 860,80 1040,140 C1180,180 1320,220 1440,180 L1440,320 L0,320 Z"
            fill="rgba(15,157,122,0.10)"
          />
        </svg>
        <svg
          className="tdt-wave tdt-wave-2 absolute inset-x-0 bottom-0 h-[95%] w-[170%] -left-[25%]"
          viewBox="0 0 1440 320"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0,220 C200,170 360,280 560,210 C760,140 940,100 1120,160 C1260,200 1360,240 1440,210 L1440,320 L0,320 Z"
            fill="rgba(27,191,138,0.12)"
          />
        </svg>
        <svg
          className="tdt-wave tdt-wave-3 absolute inset-x-0 top-0 h-[70%] w-[160%] -left-[15%]"
          viewBox="0 0 1440 320"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0,80 C160,130 300,30 480,90 C660,150 820,40 1000,90 C1160,130 1300,70 1440,100 L1440,0 L0,0 Z"
            fill="rgba(11,122,103,0.07)"
          />
        </svg>
        <svg
          className="tdt-wave tdt-wave-4 absolute inset-x-0 bottom-[-8%] h-[70%] w-[180%] -left-[30%]"
          viewBox="0 0 1440 320"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M0,240 C220,200 400,290 620,240 C840,190 1020,150 1200,210 C1320,240 1400,260 1440,250 L1440,320 L0,320 Z"
            fill="rgba(184,235,212,0.55)"
          />
        </svg>
        {/* هاله‌های نور نرم */}
        <div className="absolute -left-10 top-1/2 h-36 w-36 -translate-y-1/2 rounded-full bg-white/60 blur-2xl sm:h-48 sm:w-48" />
        <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[#B8EBD4]/50 blur-2xl sm:h-40 sm:w-40" />
      </div>

      {/* ================= محتوای اصلی ================= */}
      <div className="relative flex items-center justify-between gap-2.5 sm:gap-5 lg:gap-8">

        {/* ----- ساعت آنالوگ (چپ بصری) ----- */}
        <div className="order-1 flex shrink-0 items-center justify-center sm:order-3">
          <div
            className="tdt-clock relative h-20 w-20 sm:h-[130px] sm:w-[130px] lg:h-[145px] lg:w-[145px] rounded-full bg-white"
            style={{
              boxShadow:
                '0 8px 22px rgba(15,157,122,0.16), 0 2px 0 rgba(255,255,255,0.95) inset, 0 -1px 0 rgba(0,0,0,0.03) inset',
            }}
            aria-label="ساعت عقربه‌ای تهران"
            role="img"
          >
            <div className="absolute inset-[4px] sm:inset-[6px] rounded-full border border-[#E8F1EE]/90" />

            {tickMarks.map((i) => {
              const angle = (i * 6 * Math.PI) / 180;
              const isHour = i % 5 === 0;
              const radius = isHour ? 40 : 41.5;
              return (
                <i
                  key={i}
                  className={`absolute rounded-full ${
                    isHour
                      ? 'h-[5px] w-[2px] sm:h-[8px] sm:w-[2.5px] bg-[#0B7A67]'
                      : 'h-[3px] w-px sm:h-[4px] bg-[#0F9D7A]/40'
                  }`}
                  style={{
                    left: `calc(50% + ${Math.sin(angle) * radius}%)`,
                    top: `calc(50% - ${Math.cos(angle) * radius}%)`,
                    transform: `translate(-50%, -50%) rotate(${i * 6}deg)`,
                  }}
                />
              );
            })}

            {/* عقربه ساعت */}
            <span
              className="absolute left-1/2 top-1/2 h-[26%] w-[2.5px] sm:w-[3.5px] origin-bottom rounded-full bg-[#064E3B] shadow-sm"
              style={{ transform: `translate(-50%, -100%) rotate(${hours * 30 + minutes / 2}deg)` }}
            />
            {/* عقربه دقیقه */}
            <span
              className="absolute left-1/2 top-1/2 h-[34%] w-[2px] sm:w-[2.5px] origin-bottom rounded-full bg-[#0B7A67] shadow-sm"
              style={{ transform: `translate(-50%, -100%) rotate(${minutes * 6}deg)` }}
            />
            {/* عقربه ثانیه — زاویهٔ تجمعی (بدون برگشت معکوس) */}
            <span
              className="tdt-second-hand absolute left-1/2 top-1/2 h-[38%] w-[1.5px] origin-bottom rounded-full bg-[#EF4444]"
              style={{ transform: `translate(-50%, -100%) rotate(${secondDeg}deg)` }}
            />
            {/* مرکز */}
            <span
              className="absolute left-1/2 top-1/2 h-2.5 w-2.5 sm:h-3.5 sm:w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{
                background: 'linear-gradient(145deg, #1F2937 0%, #0B7A67 55%, #064E3B 100%)',
              }}
            />
          </div>
        </div>

        {/* ----- اطلاعات تاریخ و ساعت دیجیتال (مرکز) ----- */}
        <div className="order-2 flex min-w-0 flex-1 flex-col items-center text-center px-0.5 sm:px-1">
          <p className="text-[10px] sm:text-[13px] font-medium tracking-wide text-[#5BB894]">
            امروز به وقت ایران
          </p>

          <p
            className="mt-0.5 sm:mt-2 text-xs sm:text-[26px] lg:text-[28px] leading-snug font-bold text-[#0B6B52] truncate max-w-full"
            style={{ fontFamily: 'var(--font-titr), var(--font-vazirmatn), sans-serif' }}
          >
            {now ? dateFormatter.format(now) : 'در حال دریافت تاریخ…'}
          </p>

          <p
            className="mt-0.5 sm:mt-1 font-mono text-xl sm:text-[48px] lg:text-[52px] font-extrabold leading-none tracking-tight text-[#0B6B52] tabular-nums"
            style={{ fontFamily: 'var(--font-vazirmatn), ui-sans-serif, system-ui, sans-serif', fontWeight: 800 }}
            dir="ltr"
            aria-live="polite"
          >
            {now ? timeFormatter.format(now) : '--:--:--'}
          </p>

          {/* بج تاریخ کوتاه — روی موبایل فشرده */}
          <div className="mt-1.5 sm:mt-4 inline-flex items-center gap-1 sm:gap-2 rounded-full border border-[#C6EBD9] bg-white/80 px-2 py-0.5 sm:px-3.5 sm:py-1.5 text-[10px] sm:text-[12px] font-bold text-[#0F9D7A] shadow-[0_2px_8px_rgba(15,157,122,0.08)] backdrop-blur-sm">
            <CalendarDays className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span>{now ? shortDateFormatter.format(now) : '—'}</span>
          </div>
        </div>

        {/* ----- دکمهٔ تقویم (راست) — روی موبایل کوچک‌تر ----- */}
        <div className="order-3 flex shrink-0 items-center justify-center sm:order-1">
          <button
            type="button"
            tabIndex={0}
            aria-label="تقویم امروز"
            title="امروز به وقت ایران"
            className="tdt-cal-btn relative grid h-10 w-10 sm:h-[64px] sm:w-[64px] lg:h-[72px] lg:w-[72px] place-items-center overflow-hidden rounded-full border border-[#C6EBD9] bg-white/75 text-[#0F9D7A] shadow-[0_4px_14px_rgba(15,157,122,0.12)] backdrop-blur-md transition-transform duration-200 ease-out hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F9D7A]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#E6F7EF] active:scale-95 cursor-default"
          >
            <CalendarDays className="relative z-[1] h-[18px] w-[18px] sm:h-7 sm:w-7 lg:h-8 lg:w-8" strokeWidth={1.75} aria-hidden="true" />
            <span className="tdt-ripple" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
