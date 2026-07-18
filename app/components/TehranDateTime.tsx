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

        <div className="relative h-20 w-20 shrink-0 rounded-full border-4 border-white/25 bg-slate-900/25 shadow-inner sm:h-24 sm:w-24" aria-label="ساعت عقربه‌ای تهران">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => (
            <span key={i} className="absolute left-1/2 top-1/2 h-[2px] w-1.5 origin-[-30px] rounded bg-white/70 sm:origin-[-38px]" style={{ transform: `translate(30px,-1px) rotate(${i * 30}deg)` }} />
          ))}
          <span className="absolute left-1/2 top-1/2 h-[25%] w-1 -translate-x-1/2 -translate-y-full origin-bottom rounded-full bg-white" style={{ transform: `translate(-50%, -100%) rotate(${hours * 30 + minutes / 2}deg)` }} />
          <span className="absolute left-1/2 top-1/2 h-[34%] w-0.5 -translate-x-1/2 -translate-y-full origin-bottom rounded-full bg-emerald-200" style={{ transform: `translate(-50%, -100%) rotate(${minutes * 6}deg)` }} />
          <span className="absolute left-1/2 top-1/2 h-[38%] w-px -translate-x-1/2 -translate-y-full origin-bottom bg-rose-400" style={{ transform: `translate(-50%, -100%) rotate(${seconds * 6}deg)` }} />
          <span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-emerald-200 bg-white" />
        </div>
      </div>
    </section>
  );
}
