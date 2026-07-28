'use client';

import React from 'react';
import type { AggregatedAlert, JobGroup } from '../../../lib/types';
import {
  getHardConstraintWarnings,
  HARD_WARNING_LABELS,
  HARD_WARNING_PREFIXES,
  type ScoredSchedule,
} from '../../../lib/scoring';
import { AlertTriangle, ChevronDown, ChevronLeft, CircleAlert, ShieldCheck, Sparkles, X } from 'lucide-react';

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

  const [hardWarningsExpanded, setHardWarningsExpanded] = React.useState(true);
  const [otherWarningsExpanded, setOtherWarningsExpanded] = React.useState(true);

  const effectiveWarnings = React.useMemo(() => scenario?.schedule.warnings || [], [scenario?.schedule.warnings]);
  const hardWarnings = React.useMemo(() => getHardConstraintWarnings(effectiveWarnings), [effectiveWarnings]);
  const hardWarningsSet = React.useMemo(() => new Set(hardWarnings), [hardWarnings]);
  const generalAlerts = React.useMemo(
    () => alerts
      .filter((alert) => alert.groupType === 'general')
      .map((alert) => ({ ...alert, warnings: alert.warnings.filter((warning) => !hardWarningsSet.has(warning)) }))
      .filter((alert) => alert.warnings.length > 0),
    [alerts, hardWarningsSet]
  );
  const personnelAlerts = React.useMemo(
    () => alerts
      .filter((alert) => alert.groupType !== 'general')
      .map((alert) => ({ ...alert, warnings: alert.warnings.filter((warning) => !hardWarningsSet.has(warning)) }))
      .filter((alert) => alert.warnings.length > 0),
    [alerts, hardWarningsSet]
  );
  const hardWarningBreakdown = React.useMemo(() => {
     return HARD_WARNING_PREFIXES
       .map((prefix) => ({
         label: HARD_WARNING_LABELS[prefix],
         count: hardWarnings.filter((warning) => warning.startsWith(prefix)).length,
       }))
       .filter((item) => item.count > 0);
   }, [hardWarnings]);

  if (!isOpen || !scenario || !group) return null;

  const theme = groupTheme[group];

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
              این پنجره فقط هشدارهای مربوط به همین برنامه و همین گروه شغلی را نشان می‌دهد. پس از رفتن به روز یا سلول مربوطه و اعمال اصلاحات، همین برنامه دوباره ارزیابی می‌شود.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-[10px] font-black text-slate-500 mb-1">کل هشدارها</div>
                <div className={`text-lg font-black ${scenario.relevantWarningCount === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{scenario.relevantWarningCount}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-[10px] font-black text-slate-500 mb-1">هشدارهای سخت</div>
                <div className={`text-lg font-black ${scenario.relevantHardWarningCount === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{scenario.relevantHardWarningCount}</div>
                <div className="text-[10px] font-bold text-slate-400 mt-1">تا ۴ مورد، سناریو قابل ساخت است.</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-[10px] font-black text-slate-500 mb-1">امتیاز فعلی سیستم</div>
                <div className="text-lg font-black text-slate-900">{scenario.totalScore.toFixed(1)}٪</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-[10px] font-black text-slate-500 mb-1">وضعیت برنامه</div>
                <div className={`text-sm font-black ${scenario.relevantWarningCount === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {scenario.relevantWarningCount === 0 ? 'آماده ورود به مقایسه' : 'نیازمند رفع هشدار'}
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
              {hardWarnings.length > 0 && (
                <section className="rounded-2xl border border-rose-200 bg-white shadow-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setHardWarningsExpanded((value) => !value)}
                    className="w-full px-4 py-3.5 flex items-center justify-between gap-3 bg-rose-50/80 hover:bg-rose-100/80 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                      <span className="text-sm font-black text-rose-900">کرکره هشدارهای سخت</span>
                      <span className="text-[10px] font-black px-2.5 py-1 rounded-full border border-rose-200 bg-white text-rose-700">
                        {hardWarnings.length} مورد
                      </span>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-rose-700 transition-transform ${hardWarningsExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {hardWarningsExpanded && (
                    <div className="p-4 space-y-4 bg-rose-50/30">
                      <div className="flex flex-wrap gap-2">
                        {hardWarningBreakdown.map((item) => (
                          <span
                            key={item.label}
                            className="text-[10px] font-black px-2.5 py-1 rounded-full border border-rose-200 bg-white text-rose-700"
                          >
                            {item.label}: {item.count}
                          </span>
                        ))}
                      </div>

                      <div className="space-y-2">
                        {hardWarnings.map((warning, index) => {
                          const day = extractWarningDay(warning);
                          return (
                            <div key={`hard-warning-${index}`} className="rounded-2xl border border-rose-200 bg-white p-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                              <div className="text-xs font-bold text-slate-700 leading-6">{warning}</div>
                              <div className="flex items-center gap-2">
                                {day !== null ? (
                                  <button
                                    type="button"
                                    onClick={() => { onNavigateToDay(day, warning); onClose(); }}
                                    className="text-[10px] font-black px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                                  >
                                    رفتن به روز {day}
                                  </button>
                                ) : (
                                  <span className="text-[10px] font-bold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500">فاقد سلول مستقیم</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {(generalAlerts.length > 0 || personnelAlerts.length > 0) && (
                <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOtherWarningsExpanded((value) => !value)}
                    className="w-full px-4 py-3.5 flex items-center justify-between gap-3 bg-slate-50 hover:bg-slate-100 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <CircleAlert className="w-4 h-4 text-slate-600" />
                      <span className="text-sm font-black text-slate-900">سایر هشدارهای این برنامه</span>
                      <span className="text-[10px] font-black px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-700">
                        {generalAlerts.reduce((sum, item) => sum + item.warnings.length, 0) + personnelAlerts.reduce((sum, item) => sum + item.warnings.length, 0)} مورد
                      </span>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-slate-700 transition-transform ${otherWarningsExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {otherWarningsExpanded && (
                    <div className="p-4 space-y-4 bg-slate-50/40">
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
                    {alert.warnings.map((warning, index) => {
                      const day = extractWarningDay(warning);
                      return (
                        <div key={`general-warning-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                          <div className="text-xs font-bold text-slate-700 leading-6">{warning}</div>
                          <div className="flex items-center gap-2">
                            {day !== null ? (
                              <button
                                type="button"
                                onClick={() => { onNavigateToDay(day, warning); onClose(); }}
                                className="text-[10px] font-black px-3 py-1.5 rounded-xl border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                              >
                                رفتن به روز {day}
                              </button>
                            ) : (
                              <span className="text-[10px] font-bold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500">فاقد سلول مستقیم</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
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
                            {alert.warnings.map((warning, index) => {
                              const day = extractWarningDay(warning);
                              return (
                                <div key={`${alert.personnelId}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                                  <div className="text-xs font-bold text-slate-700 leading-6">{warning}</div>
                                  <div className="flex items-center gap-2">
                                    {day !== null ? (
                                      <button
                                        type="button"
                                        onClick={() => { onNavigateToCell(alert.personnelId, day, warning); onClose(); }}
                                        className="text-[10px] font-black px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 inline-flex items-center gap-1"
                                      >
                                        رفتن به سلول
                                        <ChevronLeft className="w-3 h-3" />
                                      </button>
                                    ) : (
                                      <span className="text-[10px] font-bold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500">فاقد سلول مستقیم</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </section>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white/90 p-4 flex items-start gap-2 text-[11px] font-bold text-slate-600 leading-6">
                <ShieldCheck className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
                <div>
                  پس از رفع کامل هشدارهای همین برنامه، سیستم امتیازهای نهایی آن را برای مقایسه ثبت می‌کند. اگر سرپرستار هنوز نخواهد مقایسه را آغاز کند، کادر شروع امتیازدهی در همان صفحه باقی می‌ماند.
                </div>
              </div>

              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 flex items-start gap-2 text-[11px] font-bold text-indigo-900 leading-6">
                <Sparkles className="w-4 h-4 text-indigo-600 mt-0.5 shrink-0" />
                <div>
                  در صورت ویرایش دستی هر سلول، همین برنامه دوباره ارزیابی می‌شود و اگر قبلاً وارد مرحله امتیازدهی یا نظرسنجی شده باشد، برای حفظ صحت تصمیم‌گیری به مرحله رفع هشدار بازمی‌گردد.
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
