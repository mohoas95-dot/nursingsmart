'use client';

import React from 'react';
import type { AggregatedAlert, JobGroup } from '../../../lib/types';
import {
  isHardConstraintWarning,
  type ScoredSchedule,
} from '../../../lib/scoring';
import { AlertTriangle, ChevronLeft, CircleAlert, ShieldCheck, Sparkles, X } from 'lucide-react';

interface ScenarioWarningsModalProps {
  isOpen: boolean;
  group: JobGroup | null;
  scenario: ScoredSchedule | null;
  alerts: AggregatedAlert[];
  extractWarningDay: (warningText: string) => number | null;
  onClose: () => void;
  onNavigateToCell: (personnelId: string, day: number, warningText?: string) => void;
  onNavigateToDay: (day: number, warningText?: string) => void;
}

const groupLabel: Record<JobGroup, string> = {
  nurse: 'پرستاران',
  assistant: 'کمک‌بهیاران',
};

const groupTheme: Record<JobGroup, { badge: string; icon: string; tint: string }> = {
  nurse: {
    badge: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    icon: 'text-indigo-600',
    tint: 'from-indigo-50 via-white to-blue-50',
  },
  assistant: {
    badge: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    icon: 'text-emerald-600',
    tint: 'from-emerald-50 via-white to-teal-50',
  },
};

export function ScenarioWarningsModal(props: ScenarioWarningsModalProps) {
  const {
    isOpen,
    group,
    scenario,
    alerts,
    extractWarningDay,
    onClose,
    onNavigateToCell,
    onNavigateToDay,
  } = props;

  if (!isOpen || !scenario || !group) return null;

  const theme = groupTheme[group];
  const generalAlerts = alerts.filter((alert) => alert.groupType === 'general');
  const personnelAlerts = alerts.filter((alert) => alert.groupType !== 'general');

  const renderWarningRow = (
    warning: string,
    key: string,
    navigate: React.ReactNode
  ) => {
    const day = extractWarningDay(warning);
    const isHard = isHardConstraintWarning(warning);

    return (
      <div
        key={key}
        className={`rounded-2xl border p-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between ${
          isHard ? 'border-rose-200 bg-rose-50/70' : 'border-slate-200 bg-slate-50'
        }`}
      >
        <div className="flex items-start gap-2 flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {isHard && (
              <span className="text-[10px] font-black px-2.5 py-1 rounded-full border border-rose-200 bg-white text-rose-700">
                تخلف مسدودکننده
              </span>
            )}
            {day !== null && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
                روز {day}
              </span>
            )}
          </div>
          <div className="text-xs font-bold text-slate-700 leading-6">{warning}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {navigate}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[70] bg-slate-900/55 backdrop-blur-sm flex items-center justify-center p-4 print:hidden" dir="rtl">
      <div className="w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl flex flex-col">
        <div className={`px-5 py-4 border-b border-slate-200 bg-gradient-to-r ${theme.tint} flex items-start justify-between gap-3`}>
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <AlertTriangle className={`w-5 h-5 ${theme.icon}`} />
              <h3 className="text-base font-black text-slate-900">کارتابل هشدارهای {scenario.title}</h3>
              <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${theme.badge}`}>
                {groupLabel[group]}
              </span>
            </div>

            <p className="text-xs font-bold text-slate-600 leading-6 max-w-3xl">
              پیام‌های اعتبارسنجی در دو سطح نمایش داده می‌شوند: تخلفات مسدودکننده که باید صفر باشند، و نکات کیفیت که اطلاع‌رسانی‌اند و مانع مقایسه و رأی‌گیری نمی‌شوند.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-[10px] font-black text-slate-500 mb-1">کل هشدارها</div>
                <div className={`text-lg font-black ${scenario.relevantWarningCount === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{scenario.relevantWarningCount}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-[10px] font-black text-slate-500 mb-1">تخلفات مسدودکننده</div>
                <div className={`text-lg font-black ${scenario.relevantHardWarningCount === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{scenario.relevantHardWarningCount}</div>
                <div className="text-[10px] font-bold text-slate-400 mt-1">حد مجاز برای سناریوی فقط‌خواندنی: صفر</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-[10px] font-black text-slate-500 mb-1">امتیاز فعلی سیستم</div>
                <div className="text-lg font-black text-slate-900">{scenario.totalScore.toFixed(1)}٪</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-[10px] font-black text-slate-500 mb-1">وضعیت برنامه</div>
                <div className={`text-sm font-black ${scenario.relevantHardWarningCount === 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {scenario.relevantHardWarningCount === 0 ? 'مجاز برای ورود به مقایسه' : 'غیرمجاز تا رفع تخلف'}
                </div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-2xl border border-slate-200 bg-white text-slate-500 hover:text-slate-700 hover:bg-slate-50 flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50 p-5 space-y-4">
          {scenario.relevantWarningCount === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center text-sm font-black text-emerald-800">
              ✨ برای این برنامه هشدار فعالی باقی نمانده است.
            </div>
          ) : (
            <>
              {generalAlerts.map((alert) => (
                <section key={alert.personnelId} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CircleAlert className="w-4 h-4 text-amber-600" />
                      <h4 className="text-sm font-black text-slate-900">هشدارهای عمومی این برنامه</h4>
                    </div>
                    <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                      {alert.warningCount} مورد
                    </span>
                  </div>
                  <div className="space-y-2">
                    {alert.warnings.map((warning, index) =>
                      renderWarningRow(
                        warning,
                        `general-warning-${index}`,
                        extractWarningDay(warning) !== null ? (
                          <button
                            type="button"
                            onClick={() => { onNavigateToDay(extractWarningDay(warning)!, warning); onClose(); }}
                            className="text-[10px] font-black px-3 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                          >
                            رفتن به روز {extractWarningDay(warning)}
                          </button>
                        ) : (
                          <span className="text-[10px] font-bold px-3 py-1.5 rounded-xl bg-white text-slate-500 border border-slate-200">
                            فاقد سلول مستقیم
                          </span>
                        )
                      )
                    )}
                  </div>
                </section>
              ))}

              {personnelAlerts.map((alert) => (
                <section key={alert.personnelId} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-black text-slate-900">{alert.personnelName}</h4>
                      <p className="text-[11px] font-bold text-slate-500">{alert.warningCount} هشدار مرتبط با این فرد</p>
                    </div>
                    <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      پرسنلی
                    </span>
                  </div>

                  <div className="space-y-2">
                    {alert.warnings.map((warning, index) =>
                      renderWarningRow(
                        warning,
                        `${alert.personnelId}-${index}`,
                        extractWarningDay(warning) !== null ? (
                          <button
                            type="button"
                            onClick={() => { onNavigateToCell(alert.personnelId, extractWarningDay(warning)!, warning); onClose(); }}
                            className="text-[10px] font-black px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 inline-flex items-center gap-1"
                          >
                            رفتن به سلول
                            <ChevronLeft className="w-3 h-3" />
                          </button>
                        ) : (
                          <span className="text-[10px] font-bold px-3 py-1.5 rounded-xl bg-white text-slate-500 border border-slate-200">
                            فاقد سلول مستقیم
                          </span>
                        )
                      )
                    )}
                  </div>
                </section>
              ))}

              <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 flex items-start gap-2 text-[11px] font-bold text-slate-600 leading-6">
                <ShieldCheck className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                <div>
                  تنها تخلفات مسدودکننده جلوی ورود به مقایسه را می‌گیرند. نکات کیفیت برای تصمیم بهتر سرپرستار و پرسنل نمایش داده می‌شوند، اما سناریوی فقط‌خواندنی را در بن‌بست قرار نمی‌دهند.
                </div>
              </div>

              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 flex items-start gap-2 text-[11px] font-bold text-indigo-900 leading-6">
                <Sparkles className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                <div>
                  سناریوها قابل ویرایش مستقیم نیستند. اگر قوانین یا برنامهٔ مبنا تغییر کند، سیستم پیش از مقایسه و تأیید نهایی دوباره اعتبارسنجی می‌کند و گزینهٔ نامعتبر را کنار می‌گذارد.
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
