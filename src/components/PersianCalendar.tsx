'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toPersianDigits, JALALI_MONTH_NAMES, WEEKDAYS } from '@/lib/jalali';

interface CalendarDay {
  day: number;
  dayOfWeek: number;
  dayName: string;
  isFriday: boolean;
  isHoliday: boolean;
  holidayTitle?: string;
  events: string[];
  isToday: boolean;
}

interface CalendarData {
  success: boolean;
  year: number;
  month: number;
  monthName: string;
  totalDays: number;
  firstDayOfWeek: number;
  holidays: { [day: number]: string };
  days: CalendarDay[];
  today: { year: number; month: number; day: number };
}

interface PersianCalendarProps {
  year?: number;
  month?: number;
  onMonthChange?: (year: number, month: number) => void;
  onDayClick?: (day: number, isHoliday: boolean) => void;
  selectedDays?: number[];
  compact?: boolean;
  showEvents?: boolean;
  className?: string;
}

export default function PersianCalendar({
  year: propYear,
  month: propMonth,
  onMonthChange,
  onDayClick,
  selectedDays = [],
  compact = false,
  showEvents = true,
  className = ''
}: PersianCalendarProps) {
  const [calendarData, setCalendarData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);
  const [tooltipDay, setTooltipDay] = useState<CalendarDay | null>(null);

  const fetchCalendar = useCallback(async (y: number, m: number) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/calendar?year=${y}&month=${m}`);
      const data = await res.json();
      if (data.success) {
        setCalendarData(data);
      }
    } catch (err) {
      console.error('Failed to fetch calendar:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (propYear && propMonth) {
      fetchCalendar(propYear, propMonth);
    } else {
      // Get current date from API
      fetchCalendar(0, 0).catch(() => {});
      fetch('/api/calendar')
        .then(r => r.json())
        .then(data => {
          if (data.success) setCalendarData(data);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [propYear, propMonth, fetchCalendar]);

  const goToPrevMonth = () => {
    if (!calendarData) return;
    let newMonth = calendarData.month - 1;
    let newYear = calendarData.year;
    if (newMonth < 1) {
      newMonth = 12;
      newYear -= 1;
    }
    fetchCalendar(newYear, newMonth);
    onMonthChange?.(newYear, newMonth);
  };

  const goToNextMonth = () => {
    if (!calendarData) return;
    let newMonth = calendarData.month + 1;
    let newYear = calendarData.year;
    if (newMonth > 12) {
      newMonth = 1;
      newYear += 1;
    }
    fetchCalendar(newYear, newMonth);
    onMonthChange?.(newYear, newMonth);
  };

  const goToToday = () => {
    fetch('/api/calendar')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setCalendarData(data);
          onMonthChange?.(data.year, data.month);
        }
      })
      .catch(() => {});
  };

  if (loading && !calendarData) {
    return (
      <div className={`bg-white rounded-2xl shadow-lg p-6 ${className}`}>
        <div className="flex items-center justify-center h-64">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
            <span className="text-sm text-slate-500">در حال بارگذاری تقویم...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!calendarData) return null;

  const dayHeaders = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
  const emptySlots = calendarData.firstDayOfWeek;

  // Find events for today's tooltip
  const hoveredDayData = calendarData.days.find(d => d.day === hoveredDay);

  return (
    <div className={`bg-white rounded-2xl shadow-lg overflow-hidden ${className}`} dir="rtl">
      {/* Header */}
      <div className="bg-gradient-to-l from-indigo-600 via-indigo-700 to-purple-700 text-white px-4 py-4">
        <div className="flex items-center justify-between">
          <button
            onClick={goToNextMonth}
            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all"
            title="ماه بعد"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <div className="text-center">
            <h2 className="text-xl font-bold">
              {calendarData.monthName} {toPersianDigits(calendarData.year)}
            </h2>
            {!compact && (
              <button
                onClick={goToToday}
                className="mt-1 text-xs bg-white/20 hover:bg-white/30 px-3 py-1 rounded-full transition-all"
              >
                برو به امروز
              </button>
            )}
          </div>

          <button
            onClick={goToPrevMonth}
            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all"
            title="ماه قبل"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Day Headers */}
      <div className="grid grid-cols-7 bg-slate-50 border-b border-slate-100">
        {dayHeaders.map((name, idx) => (
          <div
            key={idx}
            className={`text-center py-2 text-xs font-bold ${
              idx === 6 ? 'text-red-500' : 'text-slate-600'
            }`}
          >
            {name}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-px bg-slate-100 p-px">
        {/* Empty slots for start of month */}
        {Array.from({ length: emptySlots }).map((_, i) => (
          <div key={`empty-${i}`} className="bg-white aspect-square" />
        ))}

        {/* Days */}
        {calendarData.days.map((day) => {
          const isSelected = selectedDays.includes(day.day);
          const hasEvents = day.events.length > 0;
          const isHovered = hoveredDay === day.day;

          return (
            <div
              key={day.day}
              className={`
                bg-white relative flex flex-col items-center justify-center
                ${compact ? 'aspect-square' : 'min-h-[52px]'}
                cursor-pointer transition-all duration-200
                ${day.isToday ? 'ring-2 ring-indigo-500 ring-inset bg-indigo-50' : ''}
                ${isSelected ? 'bg-emerald-50 ring-2 ring-emerald-400 ring-inset' : ''}
                ${isHovered ? 'bg-blue-50' : ''}
                hover:bg-blue-50
              `}
              onClick={() => onDayClick?.(day.day, day.isHoliday)}
              onMouseEnter={() => {
                setHoveredDay(day.day);
                if (hasEvents || day.isHoliday) setTooltipDay(day);
              }}
              onMouseLeave={() => {
                setHoveredDay(null);
                setTooltipDay(null);
              }}
            >
              <span
                className={`
                  text-sm font-bold leading-none
                  ${day.isHoliday || day.isFriday ? 'text-red-500' : 'text-slate-800'}
                  ${day.isToday ? 'text-indigo-700' : ''}
                  ${isSelected ? 'text-emerald-700' : ''}
                `}
              >
                {toPersianDigits(day.day)}
              </span>

              {/* Event indicator dots */}
              {hasEvents && !compact && (
                <div className="flex gap-0.5 mt-1">
                  {day.events.slice(0, 3).map((_, idx) => (
                    <div
                      key={idx}
                      className={`w-1.5 h-1.5 rounded-full ${
                        day.isHoliday ? 'bg-red-400' : 'bg-emerald-400'
                      }`}
                    />
                  ))}
                </div>
              )}

              {/* Today badge */}
              {day.isToday && (
                <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 bg-indigo-600 rounded-full" />
              )}

              {/* Tooltip */}
              {isHovered && tooltipDay && tooltipDay.day === day.day && (hasEvents || day.holidayTitle) && (
                <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-slate-800 text-white text-xs rounded-lg p-2 shadow-xl pointer-events-none">
                  <div className="text-center font-bold mb-1 text-amber-300">
                    {toPersianDigits(day.day)} {calendarData.monthName}
                  </div>
                  {day.events.map((event, idx) => (
                    <div key={idx} className="flex items-start gap-1 mt-1">
                      <span className={day.isHoliday ? 'text-red-300' : 'text-emerald-300'}>●</span>
                      <span>{event}</span>
                    </div>
                  ))}
                  {day.isFriday && !day.events.length && (
                    <div className="flex items-start gap-1 mt-1">
                      <span className="text-red-300">●</span>
                      <span>تعطیل آخر هفته</span>
                    </div>
                  )}
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-800" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Events List */}
      {showEvents && !compact && (
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-100">
          <h3 className="text-xs font-bold text-slate-600 mb-2 flex items-center gap-1">
            <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zM4 8h12v8H4V8z" />
            </svg>
            مناسبت‌ها و تعطیلات این ماه
          </h3>
          <div className="space-y-1 max-h-36 overflow-y-auto">
            {calendarData.days
              .filter(d => d.events.length > 0)
              .map((day) => (
                <div key={day.day} className="flex items-center gap-2 text-xs">
                  <span className={`inline-flex items-center justify-center w-7 h-5 rounded font-bold ${
                    day.isHoliday ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {toPersianDigits(day.day)}
                  </span>
                  <span className={day.isHoliday ? 'text-red-600 font-medium' : 'text-slate-600'}>
                    {day.events.join(' / ')}
                  </span>
                  {day.isHoliday && (
                    <span className="text-[10px] bg-red-50 text-red-500 px-1.5 rounded border border-red-200">تعطیل</span>
                  )}
                </div>
              ))}
            {calendarData.days.filter(d => d.events.length > 0).length === 0 && (
              <div className="text-xs text-slate-400 text-center py-2">مناسبتی در این ماه ثبت نشده</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
