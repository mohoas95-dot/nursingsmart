'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react';
import type { Personnel, ShiftRequest } from '../../../lib/types';
import { toPersianDigits } from '../../../lib/persian-vocabulary';

/**
 * RequestCardStack — چیدمان «استک‌کارت» سه‌بعدی کارت‌های درخواست پرسنل
 *
 * به‌جای چینش افقی (Fanned)، کارت‌ها مانند یک دسته ورق روی هم قرار می‌گیرند:
 *  - کارت فعال در جلو، کارت‌های بعدی با translateZ در عمق صحنه عقب می‌روند و
 *    لبه‌ی بالایشان از پشت کارت جلویی دیده می‌شود (حس واقعی دسته کارت روی میز
 *    با ترکیب perspective و چرخش جزئی دور محور X).
 *  - جابه‌جایی با اسکرول عمودی روان و scroll-snap اجباری انجام می‌شود؛
 *    در هر توقف دقیقاً یک کارت در جلو قرار می‌گیرد.
 *  - کارتِ عبورشده به‌سمت دوربین پرتاب و محو می‌شود (translateZ مثبت).
 *  - پیمایش: چرخ موس، تاچ، کشیدن اسکرول‌بار، پیکان‌های کیبورد، دکمه‌های قبلی/بعدی
 *    و کلیک روی لبه‌ی کارت‌های عقبی.
 * تمام جزئیات کارت (نام، نقش، اولویت، تعداد، متن درخواست‌ها، توضیحات، تاریخ ثبت و
 * دکمه‌ی «باز کردن تمام صفحه») و رفتار بازشدن مودال جزئیات، بدون تغییر حفظ شده است.
 */

export interface RequestCardStackProps {
  /** ترتیب نمایش کارت‌ها (شناسه‌های پرسنلِ دارای درخواست) */
  personnelIds: string[];
  personnel: Personnel[];
  requests: ShiftRequest[];
  /** بازکردن مودال جزئیات کارت (همان رفتار قبلی، در page.tsx مدیریت می‌شود) */
  onOpenCard: (personnelId: string) => void;
  formatRequest: (r: ShiftRequest) => string;
  formatDate: (iso?: string) => string;
}

/** گرادیان نام هر کارت — همان پالت قبلی برای حفظ هویت بصری */
const NAME_COLOR_GRADIENTS = [
  'from-indigo-600 via-purple-600 to-pink-600',
  'from-emerald-600 via-teal-600 to-cyan-600',
  'from-rose-600 via-red-600 to-orange-600',
  'from-amber-600 via-orange-600 to-yellow-600',
  'from-blue-600 via-indigo-600 to-violet-600',
  'from-fuchsia-600 via-pink-600 to-rose-600',
];

/** هاله‌ی سایه‌ی رنگی هماهنگ با گرادیان هر کارت */
const CARD_GLOW_SHADOWS = [
  'rgba(99, 102, 241, 0.28)',
  'rgba(16, 185, 129, 0.26)',
  'rgba(244, 63, 94, 0.26)',
  'rgba(245, 158, 11, 0.28)',
  'rgba(59, 130, 246, 0.26)',
  'rgba(217, 70, 239, 0.26)',
];

/* ===== هندسه‌ی دسته کارت ===== */
/** عمق هر پله به‌سمت عقب (پیکسل) */
const DEPTH_Z_PX = 120;
/** مقدار شکاف بالای هر کارت عقبی (پیکسل) تا لبه‌اش بیرون بزند */
const DEPTH_Y_PX = -36;
/** حداکثر تعداد کارت‌های عقبی که قابل‌مشاهده‌اند */
const MAX_VISIBLE_DEPTH = 3;
/** زمان و منحنی حرکت — فنری و نرم */
const STACK_TRANSITION =
  'transform 0.55s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s ease, filter 0.55s ease';

export const RequestCardStack: React.FC<RequestCardStackProps> = ({
  personnelIds,
  personnel,
  requests,
  onOpenCard,
  formatRequest,
  formatDate,
}) => {
  const count = personnelIds.length;
  const [rawActiveIndex, setActiveIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  /** ایندکس فعال همیشه در محدوده‌ی معتبر — بدون نیاز به افکتِ تصحیحی */
  const activeIndex = Math.min(rawActiveIndex, Math.max(0, count - 1));

  // دنبال‌کردن تغییر ترجیح کاهش حرکت کاربر (state اولیه در useState خوانده می‌شود)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /** ارتفاع هر پله‌ی اسکرول (پیکسل) */
  const stepHeight = useCallback((): number => {
    const el = scrollerRef.current;
    if (!el || count === 0) return 0;
    // محتوای اسکرول: N اسپیسر %45 + دُم %55 → محدوده‌ی اسکرول = (N-1)×step
    const scrollable = el.scrollHeight - el.clientHeight;
    return count > 1 ? scrollable / (count - 1) : scrollable;
  }, [count]);

  const scrollToCard = useCallback(
    (index: number, smooth = true) => {
      const el = scrollerRef.current;
      if (!el) return;
      const target = Math.min(Math.max(index, 0), count - 1) * stepHeight();
      el.scrollTo({ top: target, behavior: smooth && !reducedMotion ? 'smooth' : 'auto' });
    },
    [count, reducedMotion, stepHeight]
  );

  // به‌روزرسانی ایندکس فعال بر اساس موقعیت اسکرول (منبع واحد حقیقت) —
  // بدون رندرهای اضافی وقتی مقدار تغییر نکرده است
  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    if (scrollable <= 0 || count <= 1) {
      setActiveIndex((prev) => (prev === 0 ? prev : 0));
      return;
    }
    const step = scrollable / (count - 1);
    const idx = Math.min(Math.max(Math.round(el.scrollTop / step), 0), count - 1);
    setActiveIndex((prev) => (prev === idx ? prev : idx));
  }, [count]);

  /**
   * چرخ موس/ترک‌پد روی ناحیه‌ی صحنه: تا وقتی دسته جا دارد، اسکرول به دسته
   * اختصاص می‌یابد؛ در انتهای دسته، کنترل به اسکرول خود صفحه پس داده می‌شود.
   * (lystener غیر passive تا preventDefault واقعی اعمال شود)
   */
  useEffect(() => {
    const stage = stageRef.current;
    const scroller = scrollerRef.current;
    if (!stage || !scroller) return;

    const onWheel = (e: WheelEvent) => {
      if (count <= 1) return;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const atTop = scroller.scrollTop <= 0.5;
      const atBottom = scroller.scrollTop >= max - 0.5;
      const goingDown = e.deltaY > 0;
      if ((goingDown && atBottom) || (!goingDown && atTop)) return; // انتهای دسته → رها به صفحه
      e.preventDefault();
      scroller.scrollTop += e.deltaY;
    };

    // کشیدن لمسی روی کارت‌ها هم باید دسته را بچرخاند (تا آستانه‌ی انتها/ابتدا)
    let lastTouchY: number | null = null;
    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (count <= 1 || lastTouchY === null) return;
      const y = e.touches[0]?.clientY;
      if (typeof y !== 'number') return;
      const delta = lastTouchY - y;
      lastTouchY = y;
      const max = scroller.scrollHeight - scroller.clientHeight;
      const atTop = scroller.scrollTop <= 0.5;
      const atBottom = scroller.scrollTop >= max - 0.5;
      const goingDown = delta > 0;
      if ((goingDown && atBottom) || (!goingDown && atTop)) return;
      e.preventDefault();
      scroller.scrollTop += delta;
    };

    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('touchstart', onTouchStart, { passive: true });
    stage.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('touchstart', onTouchStart);
      stage.removeEventListener('touchmove', onTouchMove);
    };
  }, [count]);

  // پیمایش با کیبورد
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'PageDown') {
      e.preventDefault();
      scrollToCard(activeIndex + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'PageUp') {
      e.preventDefault();
      scrollToCard(activeIndex - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      scrollToCard(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      scrollToCard(count - 1);
    } else if ((e.key === 'Enter' || e.key === ' ') && count > 0) {
      e.preventDefault();
      onOpenCard(personnelIds[activeIndex]);
    }
  };

  if (count === 0) return null;

  const activePerson = personnel.find((p) => p.id === personnelIds[activeIndex]);
  const transition = reducedMotion ? 'none' : STACK_TRANSITION;

  return (
    <div className="w-full select-none">
      {/* ===== صحنه‌ی استک + اسکرول‌درایور نامرئی ===== */}
      <div ref={stageRef} className="relative h-[470px] sm:h-[560px]" dir="rtl">
        {/* لایه‌ی اسکرول: اسپیسرهای snap — نامرئی ولی فعال برای اسکرول/لمس/اسکرول‌نگار */}
        <div
          ref={scrollerRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-y-auto overscroll-contain snap-y snap-mandatory no-scrollbar z-10"
          aria-hidden="true"
        >
          {personnelIds.map((pid) => (
            <div key={`stack-spacer-${pid}`} className="snap-start snap-always" style={{ height: '45%' }} />
          ))}
          {/* دُم انتهایی تا آخرین کارت هم دقیقاً روی snap بنشیند */}
          <div style={{ height: '55%' }} />
        </div>

        {/* صحنه‌ی سه‌بعدی — رو هم قرار دارد ولی رویدادها را عبور می‌دهد مگر روی کارت‌ها */}
        <div
          className="absolute inset-0 z-20 outline-none"
          style={{ perspective: '1500px' }}
          role="group"
          aria-label={`استک کارت‌های درخواست — کارت ${toPersianDigits(activeIndex + 1)} از ${toPersianDigits(count)}؛ برای جابه‌جایی اسکرول کنید یا از پیکان‌ها استفاده کنید`}
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          <div
            className="absolute inset-0"
            style={{
              transformStyle: 'preserve-3d',
              transform: 'rotateX(10deg) scale(0.96)',
            }}
          >
            {personnelIds.map((pid, idx) => {
              const p = personnel.find((per) => per.id === pid);
              if (!p) return null;
              const pReqs = requests.filter((r) => r.personnelId === pid);
              const hasEssential = pReqs.some((r) => r.isEssential);
              const gradientIdx = idx % NAME_COLOR_GRADIENTS.length;
              const nameGradient = NAME_COLOR_GRADIENTS[gradientIdx];
              const glowShadow = CARD_GLOW_SHADOWS[gradientIdx];

              const createdAtDates = pReqs.map((r) => r.createdAt).filter(Boolean);
              const earliestCreated = createdAtDates.length > 0 ? createdAtDates.sort()[0] : undefined;
              const notesList = [...new Set(pReqs.map((r) => r.note?.trim()).filter(Boolean))];

              /** فاصله از کارت فعال: ۰=جلویی، مثبت=عقب، منفی=عبورشده */
              const d = idx - activeIndex;

              let transform: string;
              let opacity: number;
              let filterBrightness = '';
              let pointerEvents: 'auto' | 'none' = 'none';

              if (d < 0) {
                // کارت عبورشده — از مقابل دوربین رد و محو می‌شود
                transform =
                  'translate(-50%, -50%) translate3d(0, 26px, 340px) rotateZ(-5deg) scale(1.06)';
                opacity = 0;
              } else {
                const depth = Math.min(d, MAX_VISIBLE_DEPTH);
                const rotateZ = (idx % 2 === 0 ? -1 : 1) * depth * 1.6;
                transform = `translate(-50%, -50%) translate3d(0, ${depth * DEPTH_Y_PX}px, ${
                  -depth * DEPTH_Z_PX
                }px) rotateZ(${d === 0 ? 0 : rotateZ}deg)`;
                opacity = d > MAX_VISIBLE_DEPTH ? 0 : 1 - depth * 0.12;
                if (depth > 0) filterBrightness = `brightness(${1 - depth * 0.06})`;
                // کارت جلویی: بازکردن مودال؛ لبه‌ی دو کارت نزدیکِ عقب: پرش رو به جلو
                if (d <= 2) pointerEvents = 'auto';
              }

              return (
                <div
                  key={`stack-card-${pid}`}
                  className="absolute left-1/2 top-[54%] w-[300px] sm:w-[380px]"
                  style={{
                    transform,
                    opacity,
                    filter: filterBrightness || undefined,
                    transition,
                    transformStyle: 'preserve-3d',
                    zIndex: d < 0 ? 300 : 200 - d,
                    pointerEvents,
                    willChange: d >= -1 && d <= MAX_VISIBLE_DEPTH ? 'transform, opacity' : 'auto',
                  }}
                  onClick={d > 0 && d <= 2 ? () => scrollToCard(idx) : undefined}
                  aria-hidden={d !== 0}
                >
                  {/* بدنه‌ی کارت — تمام جزئیات قبلی حفظ شده است */}
                  <div
                    role={d === 0 ? 'button' : undefined}
                    tabIndex={d === 0 ? 0 : -1}
                    onKeyDown={
                      d === 0
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              onOpenCard(pid);
                            }
                          }
                        : undefined
                    }
                    onClick={d === 0 ? () => onOpenCard(pid) : undefined}
                    className={`group relative flex h-[280px] sm:h-[330px] w-full flex-col rounded-[2rem] border-2 bg-white text-slate-800 overflow-hidden transition-[transform,border-color,box-shadow] duration-300 ${
                      d === 0
                        ? 'cursor-pointer border-indigo-200 hover:border-indigo-400 hover:-translate-y-2'
                        : 'border-slate-200'
                    }`}
                    style={{
                      boxShadow:
                        d === 0
                          ? `0 30px 50px -12px rgba(15, 23, 42, 0.25), 0 0 42px -6px ${glowShadow}`
                          : '0 18px 34px -14px rgba(15, 23, 42, 0.22)',
                      transitionProperty: reducedMotion ? 'none' : undefined,
                    }}
                  >
                    {/* سربرگ کارت */}
                    <div className="p-5 border-b border-slate-100 bg-slate-50/80 flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <h5
                          className={`text-base sm:text-lg font-black bg-gradient-to-r ${nameGradient} bg-clip-text text-transparent drop-shadow-xs`}
                        >
                          {p.firstName} {p.lastName}
                        </h5>
                        <div className="text-[11px] font-extrabold text-slate-500 flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 font-bold border border-indigo-200/40">
                            {p.jobGroup === 'nurse' ? 'پرستار' : 'کمک‌بهیار'}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        {hasEssential ? (
                          <span className="text-[10px] font-black px-2.5 py-0.5 rounded-full bg-rose-500 text-white shadow-xs">
                            ★ دارای اولویت
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600">
                            عادی
                          </span>
                        )}
                        <span className="text-[10px] font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                          {toPersianDigits(pReqs.length)} درخواست
                        </span>
                      </div>
                    </div>

                    {/* پیش‌نمایش درخواست‌ها و توضیحات */}
                    <div className="flex-1 min-h-0 p-5 space-y-4 flex flex-col">
                      <div className="space-y-2 flex-1 min-h-0">
                        <p className="text-xs font-bold text-slate-600 leading-6 line-clamp-3 sm:line-clamp-4">
                          {pReqs.map((r) => formatRequest(r)).join(' — ')}
                        </p>

                        {notesList.length > 0 && (
                          <div className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 p-2.5 rounded-xl line-clamp-1">
                            📝 {notesList[0]}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[10px] font-bold text-slate-400 mt-auto">
                        <span>ثبت: {formatDate(earliestCreated)}</span>
                        {d === 0 && (
                          <span className="text-indigo-600 font-black group-hover:-translate-x-1 transition-transform">
                            باز کردن تمام صفحه ◄
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ===== کنترل‌های پیمایش (پایین صحنه) ===== */}
      {count > 1 && (
        <div className="mt-1 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => scrollToCard(activeIndex - 1)}
            disabled={activeIndex <= 0}
            className="flex items-center gap-1 px-3.5 py-2 rounded-xl text-[11px] font-black bg-white border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-xs active:scale-95"
            aria-label="کارت قبلی"
          >
            <ChevronRight className="w-3.5 h-3.5" />
            قبلی
          </button>

          <div className="flex items-center gap-2.5">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <div className="w-24 sm:w-36 h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500"
                style={{
                  width: `${((activeIndex + 1) / count) * 100}%`,
                  transition: reducedMotion ? 'none' : 'width 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              />
            </div>
            <span className="text-[11px] font-black text-slate-500 tabular-nums">
              {activePerson ? `${activePerson.firstName} ${activePerson.lastName} — ` : ''}
              {toPersianDigits(activeIndex + 1)} / {toPersianDigits(count)}
            </span>
          </div>

          <button
            type="button"
            onClick={() => scrollToCard(activeIndex + 1)}
            disabled={activeIndex >= count - 1}
            className="flex items-center gap-1 px-3.5 py-2 rounded-xl text-[11px] font-black bg-white border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer shadow-xs active:scale-95"
            aria-label="کارت بعدی"
          >
            بعدی
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

export default RequestCardStack;
