'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import PersianCalendar from '@/components/PersianCalendar';
import TehranDateTime from '@/components/TehranDateTime';
import { toPersianDigits, JALALI_MONTH_NAMES, WEEKDAYS, getCurrentJalaliDate, getJalaliMonthDays, getJalaliWeekday } from '@/lib/jalali';
import { getMonthHolidays, getMonthAllEvents } from '@/lib/iranianHolidays';

// Types
type Role = 'guest' | 'headnurse' | 'personnel';
type TabType = 'dashboard' | 'calendar' | 'schedule' | 'requests' | 'personnel' | 'settings' | 'reports';

interface CalendarDay {
  day: number;
  dayOfWeek: number;
  isFriday: boolean;
  isHoliday: boolean;
  holidayTitle?: string;
  events: string[];
  isToday: boolean;
}

export default function Home() {
  const [role, setRole] = useState<Role>('guest');
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [isMounted, setIsMounted] = useState(false);

  // Login
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Calendar state
  const currentDate = getCurrentJalaliDate();
  const [currentYear, setCurrentYear] = useState(currentDate.year);
  const [currentMonth, setCurrentMonth] = useState(currentDate.month);
  const [onlineHolidays, setOnlineHolidays] = useState<{ [day: number]: string }>({});
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);

  // Staff calendar - for shift requests
  const [selectedCalendarDays, setSelectedCalendarDays] = useState<number[]>([]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fetch calendar data whenever year/month changes
  useEffect(() => {
    if (!isMounted) return;
    const fetchCalData = async () => {
      try {
        const res = await fetch(`/api/calendar?year=${currentYear}&month=${currentMonth}`);
        const data = await res.json();
        if (data.success) {
          setOnlineHolidays(data.holidays || {});
          setCalendarDays(data.days || []);
        }
      } catch {
        // Fallback: compute locally
        const holidays = getMonthHolidays(currentYear, currentMonth);
        setOnlineHolidays(holidays);
      }
    };
    fetchCalData();
  }, [currentYear, currentMonth, isMounted]);

  // Login handler
  const handleLogin = () => {
    if (loginUsername === 'headnurse' && loginPassword === '123456') {
      setRole('headnurse');
      setActiveTab('dashboard');
      setLoginError('');
    } else if (loginUsername === 'staff' && loginPassword === '123456') {
      setRole('personnel');
      setActiveTab('dashboard');
      setLoginError('');
    } else {
      setLoginError('نام کاربری یا رمز عبور اشتباه است');
    }
  };

  const handleLogout = () => {
    setRole('guest');
    setActiveTab('dashboard');
    setLoginUsername('');
    setLoginPassword('');
  };

  // Holiday count
  const holidayCount = useMemo(() => {
    return calendarDays.filter(d => d.isHoliday).length;
  }, [calendarDays]);

  const totalDays = useMemo(() => {
    return getJalaliMonthDays(currentYear, currentMonth);
  }, [currentYear, currentMonth]);

  if (!isMounted) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
          <span className="text-slate-500">در حال بارگذاری...</span>
        </div>
      </main>
    );
  }

  // === GUEST: Login Page ===
  if (role === 'guest') {
    return (
      <main className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          {/* Tehran DateTime widget on login page */}
          <TehranDateTime className="mb-6" />
          
          <div className="bg-white rounded-3xl shadow-2xl p-8">
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-lg">
                <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z" clipRule="evenodd" />
                </svg>
              </div>
              <h1 className="text-2xl font-black text-slate-800">نرسینگ‌اسمارت</h1>
              <p className="text-sm text-slate-500 mt-1">سامانه هوشمند شیفت‌بندی پرستاران</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-600 mb-1.5">نام کاربری</label>
                <input
                  type="text"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all text-sm"
                  placeholder="نام کاربری خود را وارد کنید"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-600 mb-1.5">رمز عبور</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all text-sm"
                  placeholder="رمز عبور خود را وارد کنید"
                  dir="ltr"
                />
              </div>

              {loginError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600 flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {loginError}
                </div>
              )}

              <button
                onClick={handleLogin}
                className="w-full bg-gradient-to-l from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-bold text-sm hover:shadow-lg hover:scale-[1.02] transition-all duration-200"
              >
                ورود به سامانه
              </button>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-100">
              <p className="text-xs text-slate-400 text-center leading-relaxed">
                سرپرستار: <span className="font-mono text-slate-500">headnurse / 123456</span>
                <br />
                پرسنل: <span className="font-mono text-slate-500">staff / 123456</span>
              </p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // === Tab definitions ===
  const headnurseTabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'داشبورد', icon: '🏠' },
    { id: 'calendar', label: 'تقویم', icon: '📅' },
    { id: 'schedule', label: 'شیفت‌بندی', icon: '📋' },
    { id: 'requests', label: 'درخواست‌ها', icon: '📝' },
    { id: 'personnel', label: 'پرسنل', icon: '👥' },
    { id: 'settings', label: 'تنظیمات', icon: '⚙️' },
    { id: 'reports', label: 'گزارشات', icon: '📊' },
  ];

  const personnelTabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'داشبورد', icon: '🏠' },
    { id: 'calendar', label: 'تقویم', icon: '📅' },
    { id: 'schedule', label: 'شیفت من', icon: '📋' },
    { id: 'requests', label: 'ثبت درخواست', icon: '📝' },
  ];

  const tabs = role === 'headnurse' ? headnurseTabs : personnelTabs;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Top Navigation Bar */}
      <nav className="bg-white shadow-sm border-b border-slate-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-black text-slate-800">نرسینگ‌اسمارت</h1>
              <p className="text-[10px] text-slate-400">
                {role === 'headnurse' ? 'پنل سرپرستار' : 'پنل پرسنل'}
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-slate-50 rounded-xl p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <span className="ml-1">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 text-xs font-bold transition-all"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
            </svg>
            خروج
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* === DASHBOARD TAB === */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            {/* Tehran DateTime - Big Widget */}
            <TehranDateTime />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Mini Calendar */}
              <div className="lg:col-span-2">
                <PersianCalendar
                  year={currentYear}
                  month={currentMonth}
                  onMonthChange={(y, m) => {
                    setCurrentYear(y);
                    setCurrentMonth(m);
                  }}
                  showEvents={true}
                />
              </div>

              {/* Quick Stats */}
              <div className="space-y-4">
                <div className="bg-white rounded-2xl shadow-lg p-5">
                  <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-indigo-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                    </svg>
                    خلاصه اطلاعات ماه
                  </h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 bg-indigo-50 rounded-xl">
                      <span className="text-xs font-bold text-indigo-700">تعداد روزهای ماه</span>
                      <span className="text-lg font-black text-indigo-800">{toPersianDigits(totalDays)}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-red-50 rounded-xl">
                      <span className="text-xs font-bold text-red-600">تعطیلات رسمی</span>
                      <span className="text-lg font-black text-red-700">{toPersianDigits(holidayCount)}</span>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl">
                      <span className="text-xs font-bold text-emerald-700">روزهای کاری</span>
                      <span className="text-lg font-black text-emerald-800">{toPersianDigits(totalDays - holidayCount)}</span>
                    </div>
                  </div>
                </div>

                {role === 'headnurse' && (
                  <div className="bg-white rounded-2xl shadow-lg p-5">
                    <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                      <svg className="w-5 h-5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      یادآوری‌ها
                    </h3>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-slate-600 bg-amber-50 rounded-lg p-2.5">
                        <span className="text-amber-500">⚡</span>
                        تقویم آنلاین فعال و به‌روز است
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-600 bg-emerald-50 rounded-lg p-2.5">
                        <span className="text-emerald-500">✓</span>
                        تعطیلات از تقویم رسمی دریافت شده
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* === CALENDAR TAB === */}
        {activeTab === 'calendar' && (
          <div className="space-y-6">
            <TehranDateTime compact />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <PersianCalendar
                  year={currentYear}
                  month={currentMonth}
                  onMonthChange={(y, m) => {
                    setCurrentYear(y);
                    setCurrentMonth(m);
                  }}
                  selectedDays={selectedCalendarDays}
                  onDayClick={(day, isHoliday) => {
                    if (role === 'personnel') {
                      setSelectedCalendarDays(prev =>
                        prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
                      );
                    }
                  }}
                  showEvents={true}
                />
              </div>

              <div className="space-y-4">
                {/* Month details card */}
                <div className="bg-white rounded-2xl shadow-lg p-5">
                  <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                    📊 آمار ماه {JALALI_MONTH_NAMES[currentMonth - 1]} {toPersianDigits(currentYear)}
                  </h3>
                  <div className="space-y-2">
                    <div className="flex justify-between items-center py-2 px-3 bg-slate-50 rounded-lg">
                      <span className="text-xs text-slate-600">کل روزها</span>
                      <span className="text-sm font-bold text-slate-800">{toPersianDigits(totalDays)} روز</span>
                    </div>
                    <div className="flex justify-between items-center py-2 px-3 bg-red-50 rounded-lg">
                      <span className="text-xs text-red-600">تعطیلات</span>
                      <span className="text-sm font-bold text-red-700">{toPersianDigits(holidayCount)} روز</span>
                    </div>
                    <div className="flex justify-between items-center py-2 px-3 bg-emerald-50 rounded-lg">
                      <span className="text-xs text-emerald-600">روزهای کاری</span>
                      <span className="text-sm font-bold text-emerald-700">{toPersianDigits(totalDays - holidayCount)} روز</span>
                    </div>
                  </div>
                </div>

                {/* Online holidays list */}
                <div className="bg-white rounded-2xl shadow-lg p-5">
                  <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                    🔴 تعطیلات رسمی دریافت‌شده از تقویم
                  </h3>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {Object.entries(onlineHolidays).length > 0 ? (
                      Object.entries(onlineHolidays).map(([day, title]) => (
                        <div key={day} className="flex items-center gap-2 text-xs py-1.5 px-2 bg-red-50 rounded-lg">
                          <span className="inline-flex items-center justify-center w-6 h-6 bg-red-100 text-red-700 font-bold rounded-lg text-[11px]">
                            {toPersianDigits(day)}
                          </span>
                          <span className="text-red-700">{title}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-400 text-center py-4">
                        تعطیل رسمی (غیر جمعه) در این ماه وجود ندارد
                      </div>
                    )}
                    {/* Fridays */}
                    <div className="mt-2 pt-2 border-t border-slate-100">
                      <div className="text-[10px] text-slate-400 mb-1">جمعه‌ها (تعطیل هفتگی)</div>
                      <div className="flex flex-wrap gap-1">
                        {calendarDays
                          .filter(d => d.isFriday)
                          .map(d => (
                            <span key={d.day} className="inline-flex items-center justify-center w-7 h-6 bg-slate-100 text-slate-500 font-bold rounded text-[11px]">
                              {toPersianDigits(d.day)}
                            </span>
                          ))}
                      </div>
                    </div>
                  </div>
                </div>

                {role === 'personnel' && selectedCalendarDays.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-lg p-5">
                    <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                      ✅ روزهای انتخاب‌شده ({toPersianDigits(selectedCalendarDays.length)})
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedCalendarDays.sort((a, b) => a - b).map(day => (
                        <span
                          key={day}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-lg border border-emerald-200 cursor-pointer hover:bg-emerald-100"
                          onClick={() => setSelectedCalendarDays(prev => prev.filter(d => d !== day))}
                        >
                          {toPersianDigits(day)}
                          <span className="text-emerald-400">×</span>
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => setSelectedCalendarDays([])}
                      className="mt-2 text-xs text-red-500 hover:text-red-700"
                    >
                      پاک کردن همه
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* === SCHEDULE TAB === */}
        {activeTab === 'schedule' && (
          <div className="space-y-6">
            <TehranDateTime compact />

            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              <div className="bg-gradient-to-l from-indigo-600 to-purple-700 text-white px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold">
                      {role === 'headnurse' ? 'برنامه شیفت‌بندی' : 'شیفت‌های من'}
                    </h2>
                    <p className="text-xs text-white/70 mt-1">
                      {JALALI_MONTH_NAMES[currentMonth - 1]} {toPersianDigits(currentYear)} • {toPersianDigits(totalDays)} روز • {toPersianDigits(holidayCount)} تعطیلی
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        let nm = currentMonth - 1;
                        let ny = currentYear;
                        if (nm < 1) { nm = 12; ny--; }
                        setCurrentMonth(nm);
                        setCurrentYear(ny);
                      }}
                      className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    <span className="text-sm font-bold px-3">
                      {JALALI_MONTH_NAMES[currentMonth - 1]} {toPersianDigits(currentYear)}
                    </span>
                    <button
                      onClick={() => {
                        let nm = currentMonth + 1;
                        let ny = currentYear;
                        if (nm > 12) { nm = 1; ny++; }
                        setCurrentMonth(nm);
                        setCurrentYear(ny);
                      }}
                      className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {/* Schedule Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="sticky right-0 bg-slate-50 z-10 px-3 py-2 text-right font-bold text-slate-600 border-b border-slate-200 min-w-[140px]">
                        پرسنل / روزهای ماه
                      </th>
                      {calendarDays.map(d => (
                        <th
                          key={d.day}
                          className={`px-1 py-2 text-center border-b border-slate-200 min-w-[38px] ${
                            d.isHoliday ? 'bg-red-50' : d.isToday ? 'bg-indigo-50' : ''
                          }`}
                        >
                          <div className={`font-bold ${d.isHoliday ? 'text-red-500' : d.isToday ? 'text-indigo-600' : 'text-slate-700'}`}>
                            {toPersianDigits(d.day)}
                          </div>
                          <div className={`text-[9px] ${d.isHoliday ? 'text-red-400' : 'text-slate-400'}`}>
                            {WEEKDAYS[d.dayOfWeek].substring(0, 2)}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Demo rows */}
                    {[
                      { name: 'حدیثه ماهپروی', code: '100010', role: 'سرپرستار' },
                      { name: 'سید محمد حسین عاشق', code: '100020', role: 'استاف' },
                      { name: 'رضا کاظمی', code: '100030', role: 'استاف' },
                      { name: 'زهرا قاسم‌پور', code: '100040', role: 'کارشناس' },
                      { name: 'احمد خوش‌قامت', code: '100050', role: 'کارشناس' },
                    ].filter((_, idx) => role === 'personnel' ? idx === 0 : true).map((person, idx) => (
                      <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50/50">
                        <td className="sticky right-0 bg-white z-10 px-3 py-2 border-l border-slate-100">
                          <div className="font-bold text-slate-800 text-[11px]">{person.name}</div>
                          <div className="text-[9px] text-slate-400">{person.code} • {person.role}</div>
                        </td>
                        {calendarDays.map(d => {
                          // Generate demo shift based on pattern
                          const shifts = ['M', 'E', 'N', 'OFF', 'M', 'M', 'OFF'];
                          const shift = d.isHoliday && (idx % 2 === 0) ? 'OFF' : shifts[(d.day + idx * 3) % shifts.length];
                          
                          const shiftStyles: Record<string, string> = {
                            'M': 'bg-blue-50 text-blue-700 border-blue-200',
                            'E': 'bg-amber-50 text-amber-700 border-amber-200',
                            'N': 'bg-purple-50 text-purple-700 border-purple-200',
                            'OFF': 'bg-slate-50 text-slate-300',
                            'ME': 'bg-gradient-to-r from-blue-50 to-amber-50 text-slate-700 border-indigo-200',
                          };

                          const shiftLabels: Record<string, string> = {
                            'M': 'صبح', 'E': 'عصر', 'N': 'شب', 'OFF': 'آف', 'ME': 'ME'
                          };

                          return (
                            <td
                              key={d.day}
                              className={`px-0.5 py-1.5 text-center ${
                                d.isHoliday ? 'bg-red-50/30' : d.isToday ? 'bg-indigo-50/30' : ''
                              }`}
                            >
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold border ${shiftStyles[shift] || shiftStyles['OFF']}`}>
                                {shiftLabels[shift] || shift}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Schedule Legend */}
              <div className="px-6 py-3 bg-slate-50 border-t border-slate-100">
                <div className="flex flex-wrap items-center gap-3 text-[10px]">
                  <span className="font-bold text-slate-500">راهنما:</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 bg-blue-100 border border-blue-200 rounded" /> صبح (M)</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 bg-amber-100 border border-amber-200 rounded" /> عصر (E)</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 bg-purple-100 border border-purple-200 rounded" /> شب (N)</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 bg-slate-100 rounded" /> آف (OFF)</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 bg-red-100 rounded" /> تعطیل</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* === REQUESTS TAB === */}
        {activeTab === 'requests' && (
          <div className="space-y-6">
            <TehranDateTime compact />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Calendar for selecting days */}
              <div className="lg:col-span-2">
                <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
                  <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                    📅 انتخاب روزها از تقویم
                    <span className="text-xs font-normal text-slate-400">
                      (روی روزهای مورد نظر کلیک کنید)
                    </span>
                  </h3>
                  <PersianCalendar
                    year={currentYear}
                    month={currentMonth}
                    onMonthChange={(y, m) => {
                      setCurrentYear(y);
                      setCurrentMonth(m);
                    }}
                    selectedDays={selectedCalendarDays}
                    onDayClick={(day) => {
                      setSelectedCalendarDays(prev =>
                        prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
                      );
                    }}
                    showEvents={false}
                    compact
                  />
                </div>

                <div className="bg-white rounded-2xl shadow-lg p-6">
                  <h3 className="text-sm font-bold text-slate-700 mb-4">📝 ثبت درخواست جدید</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1.5">نوع درخواست</label>
                      <select className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none">
                        <option value="OFF">آف (OFF)</option>
                        <option value="shift">درخواست شیفت</option>
                        <option value="leave">مرخصی</option>
                      </select>
                    </div>
                    {selectedCalendarDays.length > 0 && (
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1.5">روزهای انتخاب‌شده</label>
                        <div className="flex flex-wrap gap-1.5">
                          {selectedCalendarDays.sort((a, b) => a - b).map(day => (
                            <span key={day} className="inline-flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold rounded-lg border border-indigo-200">
                              {toPersianDigits(day)} {JALALI_MONTH_NAMES[currentMonth - 1]}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    <button className="w-full bg-gradient-to-l from-indigo-600 to-purple-600 text-white py-2.5 rounded-xl font-bold text-sm hover:shadow-lg transition-all">
                      ثبت درخواست
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-white rounded-2xl shadow-lg p-5">
                  <h3 className="text-sm font-bold text-slate-700 mb-3">📋 درخواست‌های ثبت‌شده</h3>
                  <div className="space-y-2">
                    <div className="text-xs text-slate-400 text-center py-4">
                      هنوز درخواستی ثبت نشده است
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* === PERSONNEL TAB (headnurse only) === */}
        {activeTab === 'personnel' && role === 'headnurse' && (
          <div className="space-y-6">
            <TehranDateTime compact />

            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100">
                <h2 className="text-lg font-bold text-slate-800">👥 مدیریت پرسنل</h2>
                <p className="text-xs text-slate-500 mt-1">لیست پرسنل فعال بخش</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-2.5 text-right font-bold text-slate-600">ردیف</th>
                      <th className="px-4 py-2.5 text-right font-bold text-slate-600">کد پرسنلی</th>
                      <th className="px-4 py-2.5 text-right font-bold text-slate-600">نام و نام‌خانوادگی</th>
                      <th className="px-4 py-2.5 text-right font-bold text-slate-600">سمت</th>
                      <th className="px-4 py-2.5 text-right font-bold text-slate-600">نوع استخدام</th>
                      <th className="px-4 py-2.5 text-right font-bold text-slate-600">وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { name: 'حدیثه ماهپروی', code: '100010', position: 'سرپرستار', emp: 'رسمی' },
                      { name: 'سید محمد حسین عاشق', code: '100020', position: 'استاف', emp: 'رسمی' },
                      { name: 'رضا کاظمی', code: '100030', position: 'استاف', emp: 'قراردادی' },
                      { name: 'زهرا قاسم‌پور', code: '100040', position: 'کارشناس عمومی', emp: 'رسمی' },
                      { name: 'احمد خوش‌قامت', code: '100050', position: 'کارشناس عمومی', emp: 'قراردادی' },
                      { name: 'مهدی جعفری', code: '100060', position: 'کارشناس عمومی', emp: 'طرح' },
                    ].map((p, idx) => (
                      <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-bold text-slate-400">{toPersianDigits(idx + 1)}</td>
                        <td className="px-4 py-2.5 font-mono text-slate-600">{p.code}</td>
                        <td className="px-4 py-2.5 font-bold text-slate-800">{p.name}</td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-lg text-[10px] font-bold">{p.position}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-lg text-[10px] font-bold">{p.emp}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="px-2 py-0.5 bg-green-50 text-green-600 rounded-lg text-[10px] font-bold">فعال</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* === SETTINGS TAB (headnurse only) === */}
        {activeTab === 'settings' && role === 'headnurse' && (
          <div className="space-y-6">
            <TehranDateTime compact />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl shadow-lg p-6">
                <h3 className="text-lg font-bold text-slate-800 mb-4">⚙️ تنظیمات سیستم</h3>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">ساعت موظفی رسمی</label>
                    <input type="number" defaultValue={165} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">ساعت موظفی قراردادی</label>
                    <input type="number" defaultValue={180} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1.5">ساعت موظفی طرح/وظیفه</label>
                    <input type="number" defaultValue={180} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-lg p-6">
                <h3 className="text-lg font-bold text-slate-800 mb-4">📅 تنظیمات تقویم</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-xl">
                    <span className="text-emerald-500">✓</span>
                    <span className="text-sm text-emerald-700 font-medium">تقویم آنلاین فعال</span>
                  </div>
                  <div className="flex items-center gap-2 p-3 bg-indigo-50 rounded-xl">
                    <span className="text-indigo-500">ℹ️</span>
                    <span className="text-sm text-indigo-700 font-medium">تعطیلات به صورت خودکار دریافت می‌شوند</span>
                  </div>
                  <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-xl">
                    <span className="text-amber-500">⏰</span>
                    <span className="text-sm text-amber-700 font-medium">ساعت بر اساس وقت تهران</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* === REPORTS TAB (headnurse only) === */}
        {activeTab === 'reports' && role === 'headnurse' && (
          <div className="space-y-6">
            <TehranDateTime compact />

            <div className="bg-white rounded-2xl shadow-lg p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4">📊 گزارشات ماهانه</h3>
              <p className="text-sm text-slate-500 mb-4">
                گزارش {JALALI_MONTH_NAMES[currentMonth - 1]} {toPersianDigits(currentYear)}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-3 py-2 text-right font-bold text-slate-600">نام</th>
                      <th className="px-3 py-2 text-center font-bold text-slate-600">صبح</th>
                      <th className="px-3 py-2 text-center font-bold text-slate-600">عصر</th>
                      <th className="px-3 py-2 text-center font-bold text-slate-600">شب</th>
                      <th className="px-3 py-2 text-center font-bold text-slate-600">آف</th>
                      <th className="px-3 py-2 text-center font-bold text-slate-600">ساعت کارکرد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { name: 'حدیثه ماهپروی', m: 20, e: 2, n: 1, off: 8, hours: 168 },
                      { name: 'سید محمد حسین عاشق', m: 15, e: 5, n: 5, off: 6, hours: 180 },
                      { name: 'رضا کاظمی', m: 10, e: 8, n: 7, off: 6, hours: 175 },
                    ].map((r, idx) => (
                      <tr key={idx} className="border-b border-slate-100">
                        <td className="px-3 py-2 font-bold text-slate-800">{r.name}</td>
                        <td className="px-3 py-2 text-center text-blue-600 font-bold">{toPersianDigits(r.m)}</td>
                        <td className="px-3 py-2 text-center text-amber-600 font-bold">{toPersianDigits(r.e)}</td>
                        <td className="px-3 py-2 text-center text-purple-600 font-bold">{toPersianDigits(r.n)}</td>
                        <td className="px-3 py-2 text-center text-slate-400 font-bold">{toPersianDigits(r.off)}</td>
                        <td className="px-3 py-2 text-center font-black text-slate-800">{toPersianDigits(r.hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
