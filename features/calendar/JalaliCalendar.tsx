'use client';

/**
 * features/calendar/JalaliCalendar.tsx
 * ---------------------------------------------------------------------------
 * تقویم شمسی گرافیکی سامانه — «تنها کامپوننت تقویم» رابط کاربری.
 *
 * الگوی طراحی از تقویم دیواری ایرانی گرفته شده است:
 *   • سربرگ رنگی با نام ماه و سال (رنگ بر اساس فصل)
 *   • نوار روزهای هفته از شنبه تا جمعه (راست‌چین)
 *   • سلول‌های درشت و واضح با عدد فارسی
 *   • جمعه‌ها و تعطیلات رسمی قرمز
 *   • فهرست مناسبت‌ها زیر تقویم با فونت ریز؛ مناسبت روز انتخاب‌شده بولد و بزرگ‌تر
 *
 * همهٔ داده‌ها (روزها، تعطیلات، مناسبت‌ها، روز آغاز هفته) از بیرون تزریق می‌شوند
 * و منبع آن‌ها همان Calendar SSOT پروژه (`/api/calendar` → `useOfficialCalendar`)
 * است؛ این کامپوننت هیچ داده‌ای hardcode نمی‌کند.
 *
 * قابلیت زیرشاخه: با `renderDayPanel` می‌توان زیر همان ردیفِ سلولِ کلیک‌شده،
 * یک پنل تمام‌عرض باز کرد (مانند انتخاب نوع شیفت در ویرایش/ثبت درخواست).
 */

import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, RotateCcw } from 'lucide-react';
import type { JalaliDateInfo } from '../../lib/types';
import { JALALI_MONTH_NAMES, WEEKDAYS } from '../../lib/jalali';
import { toPersianDigits } from '../../lib/persian-vocabulary';
import { getCalendarTheme, HOLIDAY_TONE } from './theme';

/** تاریخ امروز به وقت تهران در تقویم شمسی. */
export function todayJalali(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
    year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'Asia/Tehran',
  }).format(new Date()).split('/');
  return { year: Number(parts[0]), month: Number(parts[1]), day: Number(parts[2]) };
}

export interface CalendarDayDecoration {
  /** برچسب کوتاه زیر عدد روز (مثلاً کد شیفت انتخاب‌شده) */
  label?: string;
  /** کلاس رنگی سلول در حالت انتخاب‌شده/تخصیص‌یافته */
  className?: string;
  /** آیا این روز به‌عنوان انتخاب‌شده رنگ بگیرد؟ */
  selected?: boolean;
  /** غیرفعال کردن کلیک روی روز */
  disabled?: boolean;
}

export interface JalaliCalendarProps {
  year: number;
  month: number;
  /** روزهای ماه از منبع رسمی تقویم پروژه */
  days: JalaliDateInfo[];
  /** مناسبت‌های هر روز از منبع رسمی تقویم پروژه */
  occasions?: Record<number, string[]>;
  /** عنوان تعطیلی هر روز (رسمی کشور + انتخابی بخش) */
  holidays?: Record<number, string>;
  status?: 'loading' | 'ready' | 'error';

  onMonthChange?: (year: number, month: number) => void;
  /** نمایش کنترل‌های ماه/سال/امروز */
  showControls?: boolean;
  /** تعداد سال‌های قابل انتخاب پیش و پس از امروز */
  yearsBack?: number;
  yearsForward?: number;

  selectedDay?: number | null;
  onDayClick?: (day: number) => void;
  /** زیرشاخهٔ تمام‌عرض که دقیقاً زیر ردیف همان روز باز می‌شود */
  renderDayPanel?: (day: number) => React.ReactNode;
  /** رنگ/برچسب سفارشی برای هر روز (انتخاب چندتایی، کد شیفت و…) */
  getDayDecoration?: (day: JalaliDateInfo) => CalendarDayDecoration | undefined;

  size?: 'sm' | 'md' | 'lg';
  /** نمایش فهرست مناسبت‌ها زیر تقویم (با فونت ریز، مانند تقویم دیواری) */
  showOccasionList?: boolean;
  /** یادداشت کوتاه زیر عنوان */
  subtitle?: string;
  /** محتوای اضافه در نوار پایین تقویم */
  footerExtra?: React.ReactNode;
  className?: string;
  /** شناسهٔ یکتا برای کلیدهای React وقتی چند تقویم در یک صفحه هستند */
  idPrefix?: string;
}

const SIZE_MAP = {
  sm: {
    cell: 'min-h-[52px] sm:min-h-[58px]',
    day: 'text-lg sm:text-xl',
    weekday: 'text-[9px] sm:text-[10px] py-1.5',
    gap: 'gap-1',
    title: 'text-base sm:text-lg',
  },
  md: {
    cell: 'min-h-[66px] sm:min-h-[76px]',
    day: 'text-xl sm:text-2xl',
    weekday: 'text-[10px] sm:text-xs py-2',
    gap: 'gap-1.5',
    title: 'text-lg sm:text-xl',
  },
  lg: {
    cell: 'min-h-[80px] sm:min-h-[104px]',
    day: 'text-2xl sm:text-4xl',
    weekday: 'text-[11px] sm:text-sm py-2.5',
    gap: 'gap-1.5 sm:gap-2',
    title: 'text-xl sm:text-3xl',
  },
} as const;

export default function JalaliCalendar({
  year,
  month,
  days,
  occasions = {},
  holidays = {},
  status = 'ready',
  onMonthChange,
  showControls = true,
  yearsBack = 2,
  yearsForward = 20,
  selectedDay = null,
  onDayClick,
  renderDayPanel,
  getDayDecoration,
  size = 'lg',
  showOccasionList = true,
  subtitle,
  footerExtra,
  className = '',
  idPrefix = 'cal',
}: JalaliCalendarProps) {
  const theme = getCalendarTheme(month);
  const dims = SIZE_MAP[size];
  const today = useMemo(() => todayJalali(), []);
  const isCurrentMonth = today.year === year && today.month === month;

  const yearOptions = useMemo(() => {
    const from = today.year - yearsBack;
    const to = today.year + yearsForward;
    const list: number[] = [];
    for (let candidate = from; candidate <= to; candidate++) list.push(candidate);
    // اگر سال جاریِ نمایش خارج از بازه بود (مثلاً از حافظهٔ مرورگر آمده) اضافه می‌شود
    if (!list.includes(year)) list.push(year);
    return list.sort((a, b) => a - b);
  }, [today.year, year, yearsBack, yearsForward]);

  const leadingBlanks = days.length > 0 ? days[0].dayOfWeek : 0;

  const goMonth = (delta: number) => {
    if (!onMonthChange) return;
    let nextMonth = month + delta;
    let nextYear = year;
    if (nextMonth > 12) { nextMonth = 1; nextYear += 1; }
    if (nextMonth < 1) { nextMonth = 12; nextYear -= 1; }
    onMonthChange(nextYear, nextMonth);
  };

  /** فهرست مناسبت‌های ماه؛ عنوان تعطیلی هم به‌عنوان مناسبت شمرده می‌شود. */
  const occasionEntries = useMemo(() => {
    return days
      .map(dayInfo => {
        const titles = [...new Set([
          ...(occasions[dayInfo.day] || []),
          ...(holidays[dayInfo.day] ? [holidays[dayInfo.day]] : []),
        ].map(item => item.trim()).filter(Boolean))];
        return { day: dayInfo.day, titles, isHoliday: dayInfo.isHoliday && !dayInfo.isFriday };
      })
      .filter(entry => entry.titles.length > 0);
  }, [days, occasions, holidays]);

  return (
    <div
      dir="rtl"
      className={`overflow-hidden rounded-[1.75rem] border-2 shadow-lg ${theme.frameBorder} ${theme.frameBackground} ${className}`}
    >
      {/* ================= سربرگ ماه ================= */}
      <div className={`bg-gradient-to-l ${theme.headerGradient} px-4 py-3 sm:px-6 sm:py-4 text-white`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
              <CalendarDays className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3
                className={`font-black leading-tight drop-shadow-sm ${dims.title}`}
                style={{ fontFamily: 'var(--font-titr), var(--font-vazirmatn), sans-serif' }}
              >
                {JALALI_MONTH_NAMES[month - 1]} {toPersianDigits(year)}
              </h3>
              <p className="mt-0.5 text-[10px] font-bold text-white/85 sm:text-[11px]">
                {subtitle || `${theme.seasonLabel} • ${toPersianDigits(days.length || 0)} روز`}
              </p>
            </div>
          </div>

          {showControls && onMonthChange && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onMonthChange(today.year, today.month)}
                className={`flex items-center gap-1.5 rounded-full border border-white/40 bg-white/20 px-3 py-1.5 text-[11px] font-black text-white transition-all hover:bg-white/30 cursor-pointer ${
                  isCurrentMonth ? 'ring-2 ring-white/60' : ''
                }`}
                title="بازگشت به ماه جاری"
              >
                <RotateCcw className="h-3.5 w-3.5" /> امروز
              </button>

              <select
                value={year}
                onChange={event => onMonthChange(Number(event.target.value), month)}
                className="cursor-pointer rounded-full border border-white/40 bg-white/20 px-3 py-1.5 text-[11px] font-black text-white outline-none backdrop-blur-sm [&>option]:text-slate-800"
                aria-label="انتخاب سال"
              >
                {yearOptions.map(option => (
                  <option key={`${idPrefix}-year-${option}`} value={option}>{toPersianDigits(option)}</option>
                ))}
              </select>

              <select
                value={month}
                onChange={event => onMonthChange(year, Number(event.target.value))}
                className="cursor-pointer rounded-full border border-white/40 bg-white/20 px-3 py-1.5 text-[11px] font-black text-white outline-none backdrop-blur-sm [&>option]:text-slate-800"
                aria-label="انتخاب ماه"
              >
                {JALALI_MONTH_NAMES.map((name, index) => (
                  <option key={`${idPrefix}-month-${name}`} value={index + 1}>{name}</option>
                ))}
              </select>

              <div className="flex items-center gap-1 rounded-full border border-white/40 bg-white/20 px-1 py-1">
                <button
                  type="button"
                  onClick={() => goMonth(-1)}
                  className="rounded-full p-1 transition-colors hover:bg-white/25 cursor-pointer"
                  title="ماه قبل"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => goMonth(1)}
                  className="rounded-full p-1 transition-colors hover:bg-white/25 cursor-pointer"
                  title="ماه بعد"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ================= نوار روزهای هفته ================= */}
      <div className={`grid grid-cols-7 bg-gradient-to-l ${theme.weekdayBar} px-2 sm:px-3`}>
        {WEEKDAYS.map((weekday, index) => (
          <div
            key={`${idPrefix}-weekday-${weekday}`}
            className={`text-center font-black ${dims.weekday} ${index === 6 ? 'text-rose-100' : theme.weekdayText}`}
          >
            <span className="hidden sm:inline">{weekday}</span>
            <span className="sm:hidden">{weekday.replace('‌', '').slice(0, 2)}</span>
          </div>
        ))}
      </div>

      {/* ================= شبکهٔ روزها ================= */}
      <div className="bg-white/80 p-2 sm:p-3">
        {status === 'loading' && days.length === 0 ? (
          <div className={`grid grid-cols-7 ${dims.gap}`}>
            {Array.from({ length: 35 }).map((_, index) => (
              <div key={`${idPrefix}-skeleton-${index}`} className={`animate-pulse rounded-2xl bg-slate-100 ${dims.cell}`} />
            ))}
          </div>
        ) : status === 'error' && days.length === 0 ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-xs font-black text-rose-700">
            اتصال به تقویم رسمی کشور برقرار نشد؛ اتصال اینترنت را بررسی و صفحه را تازه‌سازی کنید.
          </div>
        ) : (
          <div className={`grid grid-cols-7 ${dims.gap}`}>
            {Array.from({ length: leadingBlanks }).map((_, index) => (
              <span key={`${idPrefix}-blank-${index}`} className="rounded-2xl bg-slate-50/40" />
            ))}

            {days.map(dayInfo => {
              const decoration = getDayDecoration?.(dayInfo);
              const isSelected = decoration?.selected ?? selectedDay === dayInfo.day;
              const isToday = isCurrentMonth && today.day === dayInfo.day;
              const dayOccasions = [...new Set([
                ...(occasions[dayInfo.day] || []),
                ...(holidays[dayInfo.day] ? [holidays[dayInfo.day]] : []),
              ])];
              const isPanelOpen = Boolean(renderDayPanel) && selectedDay === dayInfo.day;

              const baseTone = dayInfo.isHoliday
                ? `${HOLIDAY_TONE.cell} ${HOLIDAY_TONE.text}`
                : `${theme.cellIdle} ${theme.dayText}`;
              const activeTone = decoration?.className
                || (dayInfo.isHoliday ? HOLIDAY_TONE.active : theme.cellActive);

              return (
                <React.Fragment key={`${idPrefix}-day-${dayInfo.day}`}>
                  <button
                    type="button"
                    disabled={decoration?.disabled}
                    onClick={() => !decoration?.disabled && onDayClick?.(dayInfo.day)}
                    aria-expanded={isPanelOpen}
                    aria-pressed={isSelected}
                    aria-label={`${toPersianDigits(dayInfo.day)} ${JALALI_MONTH_NAMES[month - 1]}${dayInfo.isHoliday ? '، تعطیل' : ''}`}
                    title={dayOccasions.join(' — ') || (dayInfo.isHoliday ? 'تعطیل' : 'روز عادی')}
                    className={`group relative flex flex-col items-center justify-center rounded-2xl border-2 px-1 py-1.5 transition-all duration-200 ${dims.cell} ${
                      decoration?.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
                    } ${
                      isSelected
                        ? `${activeTone} scale-[1.07] shadow-xl font-black z-10`
                        : `${baseTone} ${decoration?.disabled ? '' : theme.cellHover} hover:scale-[1.03] hover:shadow-md`
                    } ${isToday && !isSelected ? `ring-2 ring-offset-1 ${theme.ring}` : ''}`}
                  >
                    {isToday && (
                      <span className={`absolute right-1.5 top-1.5 rounded-full px-1.5 py-px text-[7px] font-black ${
                        isSelected ? 'bg-white/25 text-white' : `${theme.chip} border`
                      }`}>
                        امروز
                      </span>
                    )}

                    <span
                      className={`leading-none ${dims.day} ${isSelected ? 'font-black drop-shadow' : 'font-black'}`}
                      style={{ fontFamily: 'var(--font-titr), var(--font-vazirmatn), sans-serif' }}
                    >
                      {toPersianDigits(dayInfo.day)}
                    </span>

                    {decoration?.label ? (
                      <span className="mt-1 max-w-full truncate text-[9px] font-black opacity-90 sm:text-[10px]">
                        {decoration.label}
                      </span>
                    ) : (
                      <span className="mt-1 text-[8px] font-bold opacity-60 sm:text-[9px]">
                        {WEEKDAYS[dayInfo.dayOfWeek]}
                      </span>
                    )}

                    {dayOccasions.length > 0 && (
                      <span
                        className={`absolute bottom-1.5 left-1.5 h-1.5 w-1.5 rounded-full ${
                          isSelected ? 'bg-white' : dayInfo.isHoliday ? HOLIDAY_TONE.dot : theme.occasionDot
                        }`}
                      />
                    )}
                  </button>

                  {isPanelOpen && (
                    <div className="col-span-7 animate-fade-in">
                      {renderDayPanel?.(dayInfo.day)}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* ================= راهنمای رنگ‌ها ================= */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-dashed border-slate-200 bg-white/70 px-4 py-2 text-[9px] font-bold text-slate-500">
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded bg-rose-100 ring-1 ring-rose-300" /> جمعه و تعطیل رسمی</span>
        <span className="flex items-center gap-1"><i className={`h-2 w-2 rounded-full ${theme.occasionDot}`} /> دارای مناسبت</span>
        <span className="flex items-center gap-1"><i className={`h-2.5 w-2.5 rounded ring-2 ${theme.ring}`} /> امروز</span>
        {footerExtra}
      </div>

      {/* ================= فهرست مناسبت‌ها (فونت ریز، مانند تقویم دیواری) ================= */}
      {showOccasionList && (
        <div className="border-t-2 border-dotted border-slate-200 bg-white px-4 py-3">
          {occasionEntries.length === 0 ? (
            <p className="text-center text-[10px] font-bold text-slate-400">
              مناسبت رسمی برای این ماه ثبت نشده است.
            </p>
          ) : (
            <p className="text-justify text-[10px] leading-6 text-slate-600 sm:text-[11px] sm:leading-7">
              {occasionEntries.map((entry, index) => {
                const isActive = selectedDay === entry.day;
                return (
                  <React.Fragment key={`${idPrefix}-occasion-${entry.day}`}>
                    <span
                      onClick={() => onDayClick?.(entry.day)}
                      className={`cursor-pointer transition-all ${
                        isActive
                          ? `text-[13px] font-black sm:text-[15px] ${entry.isHoliday ? 'text-rose-600' : theme.accentText}`
                          : entry.isHoliday
                            ? 'font-bold text-rose-500'
                            : 'font-medium text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {toPersianDigits(entry.day)}-{entry.titles.join(' / ')}
                      {entry.isHoliday ? '(تعطیل)' : ''}
                    </span>
                    {index < occasionEntries.length - 1 && <span className="mx-1 text-slate-300">|</span>}
                  </React.Fragment>
                );
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
