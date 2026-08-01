'use client';

import React, { useMemo } from 'react';
import { 
  ChevronLeft, ChevronRight, Calendar as CalendarIcon, 
  ArrowLeft, ArrowRight 
} from 'lucide-react';
import { 
  JALALI_MONTH_NAMES, WEEKDAYS 
} from '../../../lib/jalali';
import type { JalaliDateInfo } from '../../../lib/types';

interface PersianCalendarProps {
  year: number;
  month: number;
  setYear: (y: number) => void;
  setMonth: (m: number) => void;
  calendarDays: JalaliDateInfo[];
  holidays: Record<number, string>;
  occasions: Record<number, string[]>;
  selectedDay?: number | null;
  onDayClick?: (day: number) => void;
  onDayShiftSelect?: (day: number, shift: string) => void;
  showShiftSubmenuForDay?: number | null;
  shiftOptions?: Array<{ code: string; label: string; className: string }>;
  showTodayButton?: boolean;
  onTodayClick?: () => void;
  interactive?: boolean;
  highlightOccasions?: boolean;
  className?: string;
  // For seasonal theming
  theme?: 'auto' | 'green' | 'orange' | 'blue' | 'rose';
}

const MONTH_COLORS: Record<number, { primary: string; accent: string; header: string; bg: string; cellBg: string; holiday: string }> = {
  1: { primary: '#16a34a', accent: '#4ade80', header: '#166534', bg: '#f0fdf4', cellBg: '#ffffff', holiday: '#ef4444' }, // Farvardin - Spring green
  2: { primary: '#16a34a', accent: '#4ade80', header: '#166534', bg: '#f0fdf4', cellBg: '#ffffff', holiday: '#ef4444' },
  3: { primary: '#15803d', accent: '#4ade80', header: '#14532d', bg: '#f0fdf4', cellBg: '#ffffff', holiday: '#ef4444' },
  4: { primary: '#ca8a04', accent: '#fde047', header: '#854d0e', bg: '#fefce8', cellBg: '#ffffff', holiday: '#ef4444' }, // Tir - Summer yellow
  5: { primary: '#ca8a04', accent: '#fde047', header: '#854d0e', bg: '#fefce8', cellBg: '#ffffff', holiday: '#ef4444' },
  6: { primary: '#b45309', accent: '#fcd34d', header: '#78350f', bg: '#fefce8', cellBg: '#ffffff', holiday: '#ef4444' },
  7: { primary: '#c2410f', accent: '#fb923c', header: '#9a3412', bg: '#fff7ed', cellBg: '#ffffff', holiday: '#ef4444' }, // Mehr - Autumn orange
  8: { primary: '#c2410f', accent: '#fb923c', header: '#9a3412', bg: '#fff7ed', cellBg: '#ffffff', holiday: '#ef4444' },
  9: { primary: '#9f1239', accent: '#fda4af', header: '#881337', bg: '#fff1f2', cellBg: '#ffffff', holiday: '#ef4444' },
  10: { primary: '#1e40af', accent: '#93c5fd', header: '#1e3a8a', bg: '#eff6ff', cellBg: '#ffffff', holiday: '#ef4444' }, // Dey - Winter blue
  11: { primary: '#1e40af', accent: '#93c5fd', header: '#1e3a8a', bg: '#eff6ff', cellBg: '#ffffff', holiday: '#ef4444' },
  12: { primary: '#166534', accent: '#4ade80', header: '#14532d', bg: '#f0fdf4', cellBg: '#ffffff', holiday: '#ef4444' }, // Esfand - Winter green (match image)
};

function getSeasonalTheme(month: number) {
  return MONTH_COLORS[month] || MONTH_COLORS[12];
}

export function PersianCalendar({
  year,
  month,
  setYear,
  setMonth,
  calendarDays,
  holidays,
  occasions,
  selectedDay = null,
  onDayClick,
  onDayShiftSelect,
  showShiftSubmenuForDay = null,
  shiftOptions = [],
  showTodayButton = true,
  onTodayClick,
  interactive = true,
  highlightOccasions = true,
  className = '',
  theme = 'auto'
}: PersianCalendarProps) {
  const themeColors = theme === 'auto' ? getSeasonalTheme(month) : MONTH_COLORS[12];

  const currentJalaliMonth = JALALI_MONTH_NAMES[month - 1];
  
  // Calculate Gregorian month approximation for header (as in image)
  const gregorianYear = year + 621; // rough, but for display only
  const gregorianMonthLabel = month <= 9 ? 'Feb/Mar' : 'Mar/Apr'; // placeholder, image uses it for Esfand

  const firstDay = calendarDays[0]?.dayOfWeek ?? 0;

  const allOccasionsList = useMemo(() => {
    return Object.entries(occasions).map(([d, titles]) => ({
      day: Number(d),
      titles: titles || []
    })).filter(o => o.titles.length > 0);
  }, [occasions]);

  const handlePrevMonth = () => {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  };

  const handleNextMonth = () => {
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  };

  const handleYearChange = (newYear: number) => {
    if (newYear >= 1300 && newYear <= 1500) {
      setYear(newYear);
    }
  };

  const handleDaySelect = (day: number) => {
    if (!interactive || !onDayClick) return;
    onDayClick(day);
  };

  const isSelected = (day: number) => selectedDay === day;
  const isSubmenuOpen = (day: number) => showShiftSubmenuForDay === day;

  // Generate year options: 10 years before, 5 after
  const yearOptions = Array.from({ length: 16 }, (_, i) => year - 10 + i).filter(y => y >= 1300 && y <= 1500);

  return (
    <div 
      className={`rounded-[2.25rem] overflow-hidden border-2 shadow-xl ${className}`}
      style={{ 
        borderColor: themeColors.primary,
        background: '#fff'
      }}
      dir="rtl"
    >
      {/* Header - Beautiful like image */}
      <div 
        className="px-5 pt-5 pb-3 text-center relative"
        style={{ background: `linear-gradient(180deg, ${themeColors.bg} 0%, #fff 100%)` }}
      >
        <div className="flex items-center justify-between mb-1 px-2">
          {/* Left: Gregorian + Jalali Year */}
          <div className="flex flex-col items-start">
            <div className="flex items-baseline gap-2 text-[13px] font-extrabold tracking-[1px]">
              <span style={{ color: themeColors.primary }}>{gregorianYear}</span>
              <span className="text-slate-400">•</span>
              <span className="font-black text-xl tabular-nums" style={{ color: '#166534' }}>{year}</span>
            </div>
            <div className="text-[10px] text-slate-500 font-bold -mt-0.5">Feb/Mar</div>
          </div>

          {/* Center: Big Persian Month Name */}
          <div className="flex-1 text-center">
            <div 
              className="text-[28px] leading-none font-black tracking-[-1px] select-none"
              style={{ color: themeColors.primary }}
            >
              {currentJalaliMonth}
            </div>
            <div className="text-[11px] font-bold text-slate-400 mt-0.5 tracking-[2px]">
              {toPersianDigits(month)} / {year}
            </div>
          </div>

          {/* Right: Hijri / Islamic label (as in image) */}
          <div className="flex flex-col items-end text-right">
            <div className="text-xs font-black text-emerald-700 tabular-nums">{toPersianDigits(year + 1)}</div>
            <div className="text-[10px] font-bold text-slate-500">رمضان</div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-3 px-1">
          <button
            onClick={handlePrevMonth}
            className="flex items-center gap-1 px-3 py-1.5 rounded-2xl bg-white border text-xs font-black hover:bg-slate-50 active:scale-[0.985] transition-all"
            style={{ borderColor: themeColors.primary + '40', color: themeColors.primary }}
          >
            <ChevronRight className="w-3.5 h-3.5" />
            <span>ماه قبل</span>
          </button>

          <div className="flex items-center gap-1.5">
            {/* Year selector */}
            <select
              value={year}
              onChange={(e) => handleYearChange(Number(e.target.value))}
              className="bg-white border text-xs font-extrabold rounded-2xl px-3 py-1 text-center tabular-nums focus:outline-none cursor-pointer"
              style={{ borderColor: themeColors.primary + '30', color: '#166534' }}
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{toPersianDigits(y)}</option>
              ))}
            </select>

            {/* Today button */}
            {showTodayButton && (
              <button
                onClick={() => {
                  if (onTodayClick) onTodayClick();
                  else {
                    const now = new Date();
                    const parts = new Intl.DateTimeFormat('fa-IR-u-nu-latn', { year: 'numeric', month: 'numeric', timeZone: 'Asia/Tehran' }).format(now).split('/');
                    const cy = Number(parts[0]);
                    const cm = Number(parts[1]);
                    if (cy) setYear(cy);
                    if (cm) setMonth(cm);
                  }
                }}
                className="flex items-center gap-1 text-xs font-black px-3 py-1 rounded-2xl border transition-all active:scale-95"
                style={{ 
                  borderColor: themeColors.primary, 
                  background: themeColors.bg,
                  color: themeColors.primary 
                }}
              >
                <CalendarIcon className="w-3.5 h-3.5" />
                امروز
              </button>
            )}
          </div>

          <button
            onClick={handleNextMonth}
            className="flex items-center gap-1 px-3 py-1.5 rounded-2xl bg-white border text-xs font-black hover:bg-slate-50 active:scale-[0.985] transition-all"
            style={{ borderColor: themeColors.primary + '40', color: themeColors.primary }}
          >
            <span>ماه بعد</span>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Weekday Header - Green like image */}
      <div 
        className="grid grid-cols-7 text-center text-[10px] font-extrabold py-2 px-1 border-b"
        style={{ 
          background: `linear-gradient(to left, ${themeColors.header}, ${themeColors.primary})`,
          color: '#fff'
        }}
      >
        {WEEKDAYS.map((wd, idx) => (
          <div 
            key={idx} 
            className={`py-1 tracking-wider ${idx === 6 ? 'text-rose-200' : ''}`}
          >
            {wd}
          </div>
        ))}
      </div>

      {/* Calendar Grid - Large beautiful cells */}
      <div className="grid grid-cols-7 gap-px p-2 bg-slate-100" style={{ background: themeColors.bg }}>
        {/* Empty padding for first day of week (شنبه = 0) */}
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`pad-${i}`} className="aspect-square" />
        ))}

        {calendarDays.map((dayInfo) => {
          const isHoliday = dayInfo.isFriday || !!holidays[dayInfo.day];
          const isSel = isSelected(dayInfo.day);
          const submenuOpen = isSubmenuOpen(dayInfo.day);
          const dayOccasions = occasions[dayInfo.day] || [];

          return (
            <React.Fragment key={dayInfo.day}>
              <button
                type="button"
                onClick={() => handleDaySelect(dayInfo.day)}
                disabled={!interactive}
                className={`
                  aspect-square rounded-2xl flex flex-col items-center justify-center 
                  text-center border transition-all duration-150 relative select-none
                  ${isSel ? 'scale-[1.06] shadow-xl ring-2 ring-offset-2' : ''}
                  ${isHoliday ? 'text-red-600' : 'text-slate-800'}
                  ${!interactive ? 'cursor-default' : 'cursor-pointer hover:scale-[1.03] active:scale-[0.98]'}
                `}
                style={{
                  background: isSel 
                    ? '#166534' 
                    : isHoliday 
                      ? '#fef2f2' 
                      : themeColors.cellBg,
                  borderColor: isSel 
                    ? '#166534' 
                    : isHoliday 
                      ? '#fecaca' 
                      : '#e2e8f0',
                  color: isSel ? '#fff' : (isHoliday ? '#b91c1c' : undefined),
                  boxShadow: isSel ? '0 10px 15px -3px rgb(0 0 0 / 0.15)' : undefined
                }}
              >
                {/* Big Persian day number */}
                <span 
                  className="font-black tabular-nums leading-none"
                  style={{ 
                    fontSize: isSel ? '22px' : '19px', 
                    fontFamily: 'system-ui, "Vazirmatn", sans-serif' 
                  }}
                >
                  {toPersianDigits(dayInfo.day)}
                </span>

                {/* Small weekday initial */}
                <span className="text-[8px] font-extrabold mt-0.5 opacity-70 tracking-[0.5px]">
                  {WEEKDAYS[dayInfo.dayOfWeek][0]}
                </span>

                {/* Holiday dot */}
                {isHoliday && !isSel && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-red-500" />
                )}

                {/* Occasion indicator dot */}
                {dayOccasions.length > 0 && !isHoliday && (
                  <span className="absolute bottom-1.5 right-1.5 w-1 h-1 rounded-full bg-emerald-500" />
                )}
              </button>

              {/* Submenu for shifts - opens below the cell row (col-span full) */}
              {submenuOpen && shiftOptions.length > 0 && onDayShiftSelect && (
                <div className="col-span-7 -mt-1 mb-1 px-2 py-2.5 bg-white border border-emerald-200 rounded-2xl shadow-inner">
                  <div className="text-[10px] font-black text-emerald-700 mb-1.5 px-1">انتخاب شیفت روز {toPersianDigits(dayInfo.day)}:</div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                    {shiftOptions.map(opt => (
                      <button
                        key={opt.code}
                        type="button"
                        onClick={() => onDayShiftSelect(dayInfo.day, opt.code)}
                        className={`text-[10px] font-black py-2 px-2 rounded-xl border transition-all active:scale-[0.985] ${opt.className}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <button 
                    onClick={() => onDayClick && onDayClick(dayInfo.day)}
                    className="mt-2 text-[9px] text-slate-500 hover:text-rose-600 w-full text-center font-bold"
                  >
                    بستن زیرشاخه
                  </button>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Occasions list at bottom - small font, exactly like image */}
      {highlightOccasions && allOccasionsList.length > 0 && (
        <div className="px-4 py-3 bg-white border-t text-[9.5px] leading-relaxed font-bold text-slate-600" style={{ fontFamily: 'system-ui, Vazirmatn, sans-serif' }}>
          {allOccasionsList.map((occ, idx) => {
            const isHighlighted = selectedDay === occ.day;
            return (
              <div 
                key={idx} 
                onClick={() => interactive && onDayClick && onDayClick(occ.day)}
                className={`mb-0.5 cursor-pointer transition-all ${isHighlighted ? 'font-extrabold text-emerald-700 scale-[1.01]' : ''}`}
              >
                {toPersianDigits(occ.day)}-{occ.titles.join('، ')}
                {isHighlighted && <span className="text-[8px] mr-1 text-emerald-600">• انتخاب‌شده</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer info */}
      <div className="px-4 py-2 text-[9px] bg-white border-t flex items-center justify-between text-slate-400 font-extrabold">
        <div>تعداد روز: {calendarDays.length} • تعطیل: {calendarDays.filter(d => d.isHoliday).length}</div>
        <div className="text-[8px] opacity-60">منبع: تقویم رسمی ایران</div>
      </div>
    </div>
  );
}

// Helper
function toPersianDigits(n: number | string): string {
  return String(n).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[parseInt(d)]);
}

export default PersianCalendar;