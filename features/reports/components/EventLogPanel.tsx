'use client';

import React from 'react';
import {
  AlertTriangle,
  Bell,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  CloudUpload,
  History,
  Info,
  Lock,
  Settings2,
  Sparkles,
  Users,
  XCircle,
  DollarSign,
} from 'lucide-react';
import {
  MAX_SYSTEM_EVENT_LOGS,
  formatSystemEventTime,
  orderEventLogsForDisplay,
  summarizeEventLogs,
  type SystemEventCategory,
  type SystemEventLog,
  type SystemEventSeverity,
} from '../../../domain/logging/system-events';
import { AiCreditPanel, useAiCredit, type AiCreditData } from '../../shared/components/AiCreditPanel';

/**
 * EventLogPanel — Presentational Component (نسخه بازطراحی‌شده با سیستم اعتبار ۱۰۰ دلاری)
 *
 * RESPONSIBILITY:
 *   نمایش «لاگ‌ها و اتفاقات» در تب کارنامه و گزارشات: همهٔ هشدارها، رویدادها و
 *   گزارش پردازش موتور هوشمند (solver) با زمان دقیق، دسته و شدت.
 *
 *   + سیستم جدید مدیریت اعتبار API (۱۰۰ دلار):
 *     - نمایش Credit: $84.50 / $100 در بالای پنل برای سرپرستار
 *     - هشدار زرد < $15 : "⚠️ اعتبار API به پایان خود نزدیک است..."
 *     - هشدار قرمز < $5 : Critical Alert
 *
 * قاعدهٔ نگهداری: فقط ۳۰ رویداد آخر در سامانه می‌ماند و قدیمی‌ترها به‌صورت
 *   خودکار حذف می‌شوند تا فضای ذخیره‌سازی پر نشود.
 */

export interface EventLogPanelProps {
  events: ReadonlyArray<SystemEventLog>;
  /** برچسب ماه جاری برای عنوان پنل. */
  monthLabel?: string;
  /** آیا پنل اعتبار نمایش داده شود؟ (پیش‌فرض true برای سرپرستار) */
  showCreditPanel?: boolean;
  /** اطلاعات اعتبار از بیرون (اختیاری) — اگر داده نشود، خودش از /api/ai/credit می‌خواند */
  creditData?: AiCreditData | null;
  /** نقش کاربر جاری — اگر پرسنل باشد، پنل اعتبار مخفی می‌ماند */
  userRole?: 'admin' | 'headnurse' | 'personnel' | 'guest';
}

const CATEGORY_META: Record<SystemEventCategory, { label: string; icon: React.ReactNode }> = {
  solver: { label: 'موتور هوشمند', icon: <BrainCircuit className="h-3.5 w-3.5" /> },
  schedule: { label: 'برنامه شیفت', icon: <CalendarDays className="h-3.5 w-3.5" /> },
  alert: { label: 'هشدار', icon: <Bell className="h-3.5 w-3.5" /> },
  lock: { label: 'قفل و ثبت نهایی', icon: <Lock className="h-3.5 w-3.5" /> },
  requests: { label: 'درخواست‌ها', icon: <Users className="h-3.5 w-3.5" /> },
  personnel: { label: 'پرسنل', icon: <Users className="h-3.5 w-3.5" /> },
  settings: { label: 'تنظیمات', icon: <Settings2 className="h-3.5 w-3.5" /> },
  calendar: { label: 'تقویم و تعطیلات', icon: <CalendarDays className="h-3.5 w-3.5" /> },
  ai: { label: 'هوش مصنوعی', icon: <Sparkles className="h-3.5 w-3.5" /> },
  storage: { label: 'ذخیره‌سازی ابری', icon: <CloudUpload className="h-3.5 w-3.5" /> },
};

const SEVERITY_META: Record<SystemEventSeverity, {
  label: string;
  icon: React.ReactNode;
  dot: string;
  chip: string;
  card: string;
}> = {
  info: {
    label: 'اطلاع',
    icon: <Info className="h-3.5 w-3.5" />,
    dot: 'bg-sky-500',
    chip: 'bg-sky-50 text-sky-700 border-sky-200',
    card: 'border-slate-200 bg-white hover:border-sky-200',
  },
  success: {
    label: 'موفق',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    card: 'border-emerald-100 bg-emerald-50/40 hover:border-emerald-200',
  },
  warning: {
    label: 'هشدار',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    dot: 'bg-amber-500',
    chip: 'bg-amber-50 text-amber-800 border-amber-200',
    card: 'border-amber-100 bg-amber-50/40 hover:border-amber-200',
  },
  error: {
    label: 'خطا',
    icon: <XCircle className="h-3.5 w-3.5" />,
    dot: 'bg-rose-500',
    chip: 'bg-rose-50 text-rose-700 border-rose-200',
    card: 'border-rose-100 bg-rose-50/40 hover:border-rose-200',
  },
};

const FILTERS = [
  { id: 'all', label: 'همه' },
  { id: 'solver', label: 'موتور هوشمند' },
  { id: 'ai', label: 'هوش مصنوعی' },
  { id: 'warning', label: 'هشدار و خطا' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}

export function EventLogPanel({ events, monthLabel, showCreditPanel = true, creditData, userRole }: EventLogPanelProps) {
  const [filter, setFilter] = React.useState<FilterId>('all');

  // سیستم اعتبار — اگر از بیرون داده نشود و کاربر سرپرستار/مدیر باشد، خودش fetch می‌کند
  const { credit: fetchedCredit, isLoading: creditLoading, refresh: refreshCredit } = useAiCredit();
  const effectiveCredit = creditData ?? fetchedCredit;
  const shouldShowCredit = showCreditPanel && userRole !== 'personnel';

  const ordered = React.useMemo(() => orderEventLogsForDisplay(events), [events]);
  const summary = React.useMemo(() => summarizeEventLogs(events), [events]);

  const visible = React.useMemo(() => {
    if (filter === 'solver') return ordered.filter(event => event.category === 'solver');
    if (filter === 'ai') return ordered.filter(event => event.category === 'ai');
    if (filter === 'warning') return ordered.filter(event => event.severity === 'warning' || event.severity === 'error');
    return ordered;
  }, [filter, ordered]);

  return (
    <div className="space-y-5 print:hidden">
      {/* پنل اعتبار ۱۰۰ دلاری — فقط برای سرپرستار/مدیر و در بالای لاگ‌ها */}
      {shouldShowCredit && (
        <div className="relative">
          <AiCreditPanel
            credit={effectiveCredit}
            isLoading={creditLoading && !creditData}
            onRefresh={refreshCredit}
          />
        </div>
      )}

      {/* پنل اصلی لاگ‌ها */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5" id="event-log-panel">
        <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h4 className="text-sm font-black text-slate-800 flex items-center gap-2">
              <History className="w-5 h-5 text-indigo-500" />
              لاگ‌ها و اتفاقات
              {monthLabel && (
                <span className="rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-black text-indigo-700">
                  {monthLabel}
                </span>
              )}
              {/* نمایش خلاصه اعتبار در هدر هم اگر پنل اعتبار مخفی باشد */}
              {!shouldShowCredit && effectiveCredit && (
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-black flex items-center gap-1 ${
                    effectiveCredit.status === 'critical' || effectiveCredit.status === 'depleted'
                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                      : effectiveCredit.status === 'warning'
                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  }`}
                  dir="ltr"
                >
                  <DollarSign className="w-3 h-3" />
                  ${effectiveCredit.remaining.toFixed(2)} / ${effectiveCredit.initial.toFixed(2)}
                </span>
              )}
            </h4>
            <p className="mt-1 text-[11px] font-bold leading-6 text-slate-400">
              همهٔ هشدارها، رویدادهای سامانه و گزارش پردازش موتور هوشمند اینجا ثبت می‌شود.
              {shouldShowCredit && ' وضعیت اعتبار API هوش مصنوعی هم در بالا نمایش داده شده است.'}
              برای جلوگیری از پر شدن فضای ذخیره‌سازی، فقط {toPersianDigits(MAX_SYSTEM_EVENT_LOGS)} رویداد اخیر نگهداری
              و رویدادهای قدیمی‌تر به‌صورت خودکار حذف می‌شوند.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {FILTERS.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-black transition-colors cursor-pointer ${
                  filter === item.id
                    ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 py-3">
          <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-black text-slate-600">
            مجموع: {toPersianDigits(events.length)} رویداد
          </span>
          {(Object.keys(SEVERITY_META) as SystemEventSeverity[])
            .filter(severity => summary[severity] > 0)
            .map(severity => (
              <span
                key={severity}
                className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-black ${SEVERITY_META[severity].chip}`}
              >
                {SEVERITY_META[severity].icon}
                {SEVERITY_META[severity].label}: {toPersianDigits(summary[severity])}
              </span>
            ))}
          {/* نشانگر nhanh برای اعتبار بحرانی */}
          {effectiveCredit && (effectiveCredit.status === 'warning' || effectiveCredit.status === 'critical' || effectiveCredit.status === 'depleted') && (
            <span
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[10px] font-black ${
                effectiveCredit.status === 'critical' || effectiveCredit.status === 'depleted'
                  ? 'bg-rose-50 text-rose-700 border-rose-200 animate-pulse'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5" />
              اعتبار AI: ${effectiveCredit.remaining.toFixed(2)} باقی‌مانده
            </span>
          )}
        </div>

        {visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-8 text-center">
            <History className="mx-auto mb-2 h-6 w-6 text-slate-300" />
            <p className="text-xs font-black text-slate-500">
              {events.length === 0
                ? 'هنوز رویدادی برای این ماه ثبت نشده است.'
                : 'رویدادی با این فیلتر یافت نشد.'}
            </p>
            {events.length === 0 && (
              <p className="mt-1 text-[11px] font-bold text-slate-400">
                با اجرای موتور هوشمند، قفل کردن برنامه یا هر تغییر مهم دیگر، گزارش آن همین‌جا ثبت می‌شود.
              </p>
            )}
          </div>
        ) : (
          <ul className="max-h-[26rem] space-y-2 overflow-y-auto pr-1 custom-scrollbar">
            {visible.map(event => {
              const severity = SEVERITY_META[event.severity];
              const category = CATEGORY_META[event.category];
              return (
                <li
                  key={event.id}
                  className={`rounded-xl border px-3.5 py-3 transition-colors ${severity.card}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${severity.dot}`} />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-black leading-6 text-slate-800">{event.title}</span>
                        <span className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-black ${severity.chip}`}>
                          {category.icon}
                          {category.label}
                        </span>
                      </div>

                      {event.detail && (
                        <p className="whitespace-pre-line break-words text-[11px] font-bold leading-6 text-slate-500">
                          {event.detail}
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-extrabold text-slate-400">
                        <span>{formatSystemEventTime(event.at)}</span>
                        {event.actor && <span>ثبت‌کننده: {event.actor}</span>}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
