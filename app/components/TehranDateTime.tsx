'use client';

import { CalendarDays } from 'lucide-react';
import { useEffect, useState } from 'react';

const dateFormatter = new Intl.DateTimeFormat('fa-IR', {
  timeZone: 'Asia/Tehran', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});
const timeFormatter = new Intl.DateTimeFormat('fa-IR', {
  timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
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

  return (
    <section className="relative overflow-hidden rounded-2xl border border-emerald-200/70 bg-gradient-to-l from-emerald-700 via-teal-700 to-slate-800 px-4 py-3 text-white shadow-lg shadow-emerald-900/10" aria-label="تاریخ و ساعت تهران">
      <div className="absolute -left-8 -top-10 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/20 bg-white/10"><CalendarDays className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold text-emerald-100">امروز به وقت ایران</p>
            <p className="mt-0.5 truncate text-xs font-black sm:text-sm">{now ? dateFormatter.format(now) : 'در حال دریافت تاریخ…'}</p>
            <p className="mt-1 font-mono text-sm font-black tracking-wider" dir="ltr">{now ? timeFormatter.format(now) : '--:--:--'}</p>
          </div>
        </div>

        <div className="relative h-24 w-24 shrink-0 rounded-full border-[5px] border-slate-300 bg-white shadow-[inset_0_0_0_2px_#94a3b8,0_5px_16px_rgba(0,0,0,.3)] sm:h-28 sm:w-28" aria-label="ساعت عقربه‌ای تهران">
          {Array.from({ length: 60 }, (_, i) => {
            const angle = i * 6 * Math.PI / 180;
            const radius = i % 5 === 0 ? 41 : 42;
            return <i key={i} className={`absolute rounded-full bg-slate-800 ${i % 5 === 0 ? 'h-1.5 w-0.5' : 'h-1 w-px opacity-60'}`} style={{ left: `calc(50% + ${Math.sin(angle) * radius}%)`, top: `calc(50% - ${Math.cos(angle) * radius}%)`, transform: `translate(-50%,-50%) rotate(${i * 6}deg)` }} />;
          })}
          <b className="absolute left-1/2 top-[7%] -translate-x-1/2 text-[9px] font-black text-slate-900 sm:text-[10px]">۱۲</b>
          <b className="absolute right-[8%] top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-900 sm:text-[10px]">۳</b>
          <b className="absolute bottom-[5%] left-1/2 -translate-x-1/2 text-[9px] font-black text-slate-900 sm:text-[10px]">۶</b>
          <b className="absolute left-[8%] top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-900 sm:text-[10px]">۹</b>
          <span className="absolute left-1/2 top-1/2 h-[25%] w-1.5 origin-bottom rounded-full bg-slate-950 shadow" style={{ transform: `translate(-50%, -100%) rotate(${hours * 30 + minutes / 2}deg)` }} />
          <span className="absolute left-1/2 top-1/2 h-[34%] w-1 origin-bottom rounded-full bg-slate-900 shadow" style={{ transform: `translate(-50%, -100%) rotate(${minutes * 6}deg)` }} />
          <span className="absolute left-1/2 top-1/2 h-[38%] w-0.5 origin-bottom bg-red-500" style={{ transform: `translate(-50%, -100%) rotate(${seconds * 6}deg)` }} />
          <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-700 bg-slate-950 shadow" />
        </div>
      </div>
    </section>
  );
}
