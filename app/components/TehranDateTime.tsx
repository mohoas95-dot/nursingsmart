'use client';

import { CalendarDays, Clock3, Wifi } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const dateFormatter = new Intl.DateTimeFormat('fa-IR', {
  timeZone: 'Asia/Tehran', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});
const timeFormatter = new Intl.DateTimeFormat('fa-IR', {
  timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});

export default function TehranDateTime({ lastSync }: { lastSync?: string | null }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const syncLabel = useMemo(() => lastSync ? 'تقویم رسمی همگام است' : 'در حال همگام‌سازی تقویم', [lastSync]);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-emerald-200/70 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-800 px-4 py-3 text-white shadow-lg shadow-emerald-900/10" aria-label="تاریخ و ساعت تهران">
      <div className="absolute -left-8 -top-10 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-white/10"><CalendarDays className="h-5 w-5" /></span>
          <div>
            <p className="text-[10px] font-bold text-emerald-100">امروز به وقت ایران</p>
            <p className="mt-0.5 text-sm font-black">{now ? dateFormatter.format(now) : 'در حال دریافت تاریخ…'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/10 px-3 py-2 backdrop-blur-sm">
          <Clock3 className="h-5 w-5 text-emerald-200" />
          <div className="text-left" dir="ltr">
            <p className="font-mono text-xl font-black tracking-wider">{now ? timeFormatter.format(now) : '--:--:--'}</p>
            <p className="text-[9px] font-bold text-emerald-100" dir="rtl">ساعت رسمی شهر تهران</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] font-bold text-emerald-100"><Wifi className={`h-3.5 w-3.5 ${lastSync ? '' : 'animate-pulse'}`} />{syncLabel}</div>
      </div>
    </section>
  );
}
