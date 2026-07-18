'use client';

import React, { useState, useEffect } from 'react';
import { toPersianDigits, JALALI_MONTH_NAMES, WEEKDAYS } from '@/lib/jalali';

interface TehranDateTimeProps {
  className?: string;
  compact?: boolean;
}

export default function TehranDateTime({ className = '', compact = false }: TehranDateTimeProps) {
  const [dateTime, setDateTime] = useState<{
    jalaliDate: string;
    jalaliWeekday: string;
    jalaliMonth: string;
    jalaliYear: string;
    jalaliDay: string;
    time: string;
    seconds: string;
  } | null>(null);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();

      // Get Tehran time
      const tehranTime = new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
        timeZone: 'Asia/Tehran',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(now);

      const tehranSeconds = new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
        timeZone: 'Asia/Tehran',
        second: '2-digit',
      }).format(now);

      // Get Jalali date parts
      const dateParts = new Intl.DateTimeFormat('fa-IR-u-nu-latn', {
        timeZone: 'Asia/Tehran',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
      }).format(now).split('/');

      const year = parseInt(dateParts[0], 10);
      const month = parseInt(dateParts[1], 10);
      const day = parseInt(dateParts[2], 10);

      // Get weekday
      const weekdayNum = now.toLocaleDateString('fa-IR', { 
        timeZone: 'Asia/Tehran', 
        weekday: 'long' 
      });

      setDateTime({
        jalaliDate: `${year}/${month < 10 ? '0' + month : month}/${day < 10 ? '0' + day : day}`,
        jalaliWeekday: weekdayNum,
        jalaliMonth: JALALI_MONTH_NAMES[month - 1] || '',
        jalaliYear: String(year),
        jalaliDay: String(day),
        time: tehranTime,
        seconds: tehranSeconds,
      });
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!dateTime) {
    return (
      <div className={`bg-white rounded-2xl shadow-lg p-4 animate-pulse ${className}`}>
        <div className="h-16 bg-slate-200 rounded-xl" />
      </div>
    );
  }

  if (compact) {
    return (
      <div className={`bg-gradient-to-l from-indigo-600 to-purple-700 rounded-xl shadow-lg px-4 py-3 text-white ${className}`} dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-300" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zM4 8h12v8H4V8z" />
            </svg>
            <span className="text-sm font-medium">
              {dateTime.jalaliWeekday} {toPersianDigits(dateTime.jalaliDay)} {dateTime.jalaliMonth} {toPersianDigits(dateTime.jalaliYear)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4 text-emerald-300" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
            <span className="text-sm font-mono font-bold tabular-nums">
              {toPersianDigits(dateTime.time)}
              <span className="text-white/60 text-xs">:{toPersianDigits(dateTime.seconds)}</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-white rounded-2xl shadow-lg overflow-hidden ${className}`} dir="rtl">
      {/* Top gradient bar */}
      <div className="bg-gradient-to-l from-indigo-600 via-indigo-700 to-purple-700 px-5 py-4">
        <div className="flex items-center justify-between text-white">
          {/* Date section */}
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-xl flex flex-col items-center justify-center">
              <span className="text-lg font-black leading-none">{toPersianDigits(dateTime.jalaliDay)}</span>
              <span className="text-[10px] font-medium leading-none mt-0.5">{dateTime.jalaliMonth}</span>
            </div>
            <div>
              <div className="text-base font-bold">{dateTime.jalaliWeekday}</div>
              <div className="text-xs text-white/80">
                {toPersianDigits(dateTime.jalaliDay)} {dateTime.jalaliMonth} {toPersianDigits(dateTime.jalaliYear)}
              </div>
            </div>
          </div>

          {/* Time section */}
          <div className="text-left">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black font-mono tabular-nums tracking-tight">
                {toPersianDigits(dateTime.time)}
              </span>
              <span className="text-sm text-white/60 font-mono">
                :{toPersianDigits(dateTime.seconds)}
              </span>
            </div>
            <div className="text-[10px] text-white/70 text-left flex items-center gap-1 justify-end">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
              <span>به وقت تهران</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom info bar */}
      <div className="px-5 py-2.5 bg-gradient-to-l from-slate-50 to-white flex items-center justify-between border-t border-slate-100">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          <span>آنلاین و به‌روز</span>
        </div>
        <div className="text-xs text-slate-400">
          تقویم رسمی جمهوری اسلامی ایران
        </div>
      </div>
    </div>
  );
}
