'use client';

import React from 'react';
import { AlertTriangle, X, ChevronDown } from 'lucide-react';
import type { AggregatedAlert } from '../../../lib/types';

/**
 * AlertCenter — Presentational Component
 *
 * RESPONSIBILITY:
 *   Render the alert center modal with expandable sections for general and personnel alerts.
 *   This is a "dumb" component — it receives all state and handlers as props.
 *
 * Extracted from: app/page.tsx (lines ~5745-5989)
 * Risk Score: 5/14 (read-only view, minimal state)
 */

export interface AlertCenterProps {
  // Visibility
  isOpen: boolean;
  onClose: () => void;

  // Data
  allAlerts: AggregatedAlert[];
  visibleWarningsCount: number;
  dismissedAlertWarnings: Record<string, boolean>;

  // UI state
  expandedSections: { general: boolean; personnel: boolean };
  onToggleSection: (section: 'general' | 'personnel') => void;

  // Handlers
  onDismissAlert: (warningText: string) => void;
  onAlertClick: (personnelId: string, day: number) => void;

  // Helper
  extractWarningDay: (warningText: string) => number | null;
}

export function AlertCenter(props: AlertCenterProps) {
  const {
    isOpen,
    onClose,
    allAlerts,
    visibleWarningsCount,
    dismissedAlertWarnings,
    expandedSections,
    onToggleSection,
    onDismissAlert,
    onAlertClick,
    extractWarningDay,
  } = props;

  if (!isOpen) return null;

  const generalAlerts = allAlerts.filter(a => a.groupType === 'general' && a.warnings.length > 0);
  const personnelAlerts = allAlerts.filter(a => a.groupType !== 'general' && a.warnings.length > 0);
  const hasAlerts = allAlerts.filter(a => a.warnings.length > 0).length > 0;

  return (
    <div
      className="fixed inset-0 bg-slate-900/45 backdrop-blur-xs flex items-center justify-center z-[60] p-4 print:hidden animate-fade-in"
      id="alert-center-modal"
      dir="rtl"
    >
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 bg-amber-50/70 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600" />
              <h3 className="text-base font-black text-slate-800">پنجره هشدارهای باقی‌مانده</h3>
            </div>
            <p className="text-xs font-bold text-slate-600 mt-1">
              روی هر بخش کلیک کنید تا هشدارها باز/بسته شوند.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-amber-100 text-amber-800 text-xs font-black px-2.5 py-1 rounded-full">
              {visibleWarningsCount} هشدار فعال
            </span>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-700 border border-slate-200 rounded-xl p-2 bg-white transition-colors cursor-pointer"
              title="بستن پنجره هشدارها"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 bg-slate-50 space-y-4">
          {!hasAlerts ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-emerald-800 text-sm font-black text-center">
              ✨ هشدار فعالی برای این ماه باقی نمانده است.
            </div>
          ) : (
            <>
              {/* General Alerts Section */}
              {generalAlerts.length > 0 && (
                <AlertSection
                  title="هشدارهای عمومی"
                  alerts={generalAlerts}
                  isExpanded={expandedSections.general}
                  onToggle={() => onToggleSection('general')}
                  dismissedAlertWarnings={dismissedAlertWarnings}
                  onDismissAlert={onDismissAlert}
                  onAlertClick={onAlertClick}
                  extractWarningDay={extractWarningDay}
                  colorScheme="indigo"
                  badgeText="عمومی"
                />
              )}

              {/* Personnel Alerts Section */}
              {personnelAlerts.length > 0 && (
                <AlertSection
                  title="هشدارهای پرسنلی"
                  alerts={personnelAlerts}
                  isExpanded={expandedSections.personnel}
                  onToggle={() => onToggleSection('personnel')}
                  dismissedAlertWarnings={dismissedAlertWarnings}
                  onDismissAlert={onDismissAlert}
                  onAlertClick={onAlertClick}
                  extractWarningDay={extractWarningDay}
                  colorScheme="amber"
                  badgeText="پرسنلی"
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * AlertSection — Internal sub-component for expandable alert sections
 */
interface AlertSectionProps {
  title: string;
  alerts: AggregatedAlert[];
  isExpanded: boolean;
  onToggle: () => void;
  dismissedAlertWarnings: Record<string, boolean>;
  onDismissAlert: (warningText: string) => void;
  onAlertClick: (personnelId: string, day: number) => void;
  extractWarningDay: (warningText: string) => number | null;
  colorScheme: 'indigo' | 'amber';
  badgeText: string;
}

function AlertSection(props: AlertSectionProps) {
  const {
    title,
    alerts,
    isExpanded,
    onToggle,
    dismissedAlertWarnings,
    onDismissAlert,
    onAlertClick,
    extractWarningDay,
    colorScheme,
    badgeText,
  } = props;

  const activeCount = alerts.reduce(
    (acc, a) => acc + a.warnings.filter(w => !dismissedAlertWarnings[w]).length,
    0
  );

  const colorClasses = {
    indigo: {
      button: 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200',
      dot: 'bg-indigo-500',
      title: 'text-indigo-800',
      badge: 'bg-indigo-100 text-indigo-700',
      chevron: 'text-indigo-600',
      sectionBadge: 'bg-indigo-100 border-indigo-200 text-indigo-700',
    },
    amber: {
      button: 'bg-amber-50 hover:bg-amber-100 border-amber-200',
      dot: 'bg-amber-500',
      title: 'text-amber-800',
      badge: 'bg-amber-100 text-amber-700',
      chevron: 'text-amber-600',
      sectionBadge: 'bg-amber-100 border-amber-200 text-amber-700',
    },
  };

  const colors = colorClasses[colorScheme];

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between gap-2 px-4 py-3 border rounded-xl cursor-pointer transition-all ${colors.button}`}
      >
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${colors.dot}`}></div>
          <h4 className={`text-sm font-black ${colors.title}`}>{title}</h4>
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${colors.badge}`}>
            {activeCount} مورد
          </span>
        </div>
        <ChevronDown className={`w-5 h-5 transition-transform ${colors.chevron} ${isExpanded ? 'rotate-180' : ''}`} />
      </button>

      {isExpanded && alerts.map((alert) => {
        const allWarnings = alert.warnings;
        const severityClasses =
          alert.severity === 'high'
            ? 'border-red-200 bg-red-50/40'
            : alert.severity === 'medium'
              ? 'border-amber-200 bg-amber-50/40'
              : 'border-blue-200 bg-blue-50/40';

        return (
          <div key={alert.personnelId} className={`border rounded-2xl p-4 ${severityClasses}`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className={`text-sm font-black ${
                  alert.severity === 'high'
                    ? 'text-red-600'
                    : alert.severity === 'medium'
                      ? 'text-amber-600'
                      : 'text-blue-600'
                }`}>
                  {alert.severity === 'high' ? '🔴' : alert.severity === 'medium' ? '🟡' : '🔵'}
                </span>
                <div>
                  <div className="font-black text-slate-800 text-sm">{alert.personnelName}</div>
                  <div className="text-[11px] font-bold text-slate-500">
                    {allWarnings.filter(w => !dismissedAlertWarnings[w]).length} هشدار فعال
                    {colorScheme === 'indigo' && ' • هشدارهای بدون پرسنل مشخص'}
                  </div>
                </div>
              </div>
              <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${colors.sectionBadge}`}>
                {badgeText}
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {allWarnings.map((warn, idx) => {
                const day = extractWarningDay(warn);
                const canNavigateToCell = day !== null && colorScheme === 'amber';
                const isDismissed = !!dismissedAlertWarnings[warn];

                return (
                  <div
                    key={`${alert.personnelId}-${idx}`}
                    className={`border rounded-xl p-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between transition-all ${
                      isDismissed ? 'bg-slate-50 border-slate-200 opacity-50' : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-start gap-2 flex-1">
                      <span className={`font-black mt-0.5 ${isDismissed ? 'text-slate-300' : 'text-amber-600'}`}>•</span>
                      <div className="space-y-1">
                        <div className={`text-xs font-bold leading-6 ${isDismissed ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                          {warn}
                        </div>
                        {day !== null && (
                          <span className="inline-flex text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                            روز {day}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {canNavigateToCell && day !== null && !isDismissed ? (
                        <button
                          onClick={() => onAlertClick(alert.personnelId, day)}
                          className="text-[10px] font-black px-3 py-1.5 rounded-xl border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-all cursor-pointer"
                        >
                          رفتن به سلول
                        </button>
                      ) : !isDismissed ? (
                        <span className="text-[10px] font-bold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500">
                          فاقد سلول مستقیم
                        </span>
                      ) : null}

                      <button
                        onClick={(e) => { e.stopPropagation(); onDismissAlert(warn); }}
                        className={`text-[10px] font-black px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${
                          isDismissed
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                        }`}
                        title={isDismissed ? 'بازگرداندن این هشدار' : 'نادیده گرفتن این هشدار'}
                      >
                        {isDismissed ? 'بازگرداندن' : 'نادیده گرفتن'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
