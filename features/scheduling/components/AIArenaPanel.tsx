'use client';

import React, { useState } from 'react';
import { Sparkles, Zap, ChevronDown, ChevronUp, Check, ArrowRight, Target } from 'lucide-react';
import type { SmartSuggestion } from '../../../lib/types';

/**
 * AIArenaPanel — Comparison Component for Head Nurse Review
 *
 * RESPONSIBILITY:
 *   Display the top 3-5 scheduling scenarios from the solver's smart suggestions,
 *   allowing the head nurse to compare them side-by-side and choose which to apply.
 *
 * Phase 6: AI Arena Selection Panel
 */

export interface AIArenaPanelProps {
  isOpen: boolean;
  onClose: () => void;
  suggestions: SmartSuggestion[];
  onApplySuggestion: (suggestion: SmartSuggestion) => void;
  personnelNames: Record<string, string>;
}

export function AIArenaPanel(props: AIArenaPanelProps) {
  const { isOpen, onClose, suggestions, onApplySuggestion, personnelNames } = props;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!isOpen) return null;

  const displaySuggestions = suggestions.slice(0, 5);

  const getSeverityColor = (change: number) => {
    if (change <= -3) return 'text-emerald-600 bg-emerald-50 border-emerald-200';
    if (change <= -1) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-slate-500 bg-slate-50 border-slate-200';
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-[65] p-4 print:hidden animate-fade-in"
      id="ai-arena-modal"
      dir="rtl"
    >
      <div className="bg-white border border-indigo-100 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 via-purple-50 to-indigo-50 flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="bg-indigo-100 p-1.5 rounded-xl">
                <Target className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-800">مقایسه سناریوهای پیشنهادی هوش مصنوعی</h3>
                <p className="text-[10px] font-bold text-slate-500 mt-0.5">
                  {displaySuggestions.length} سناریوی بهینه برای بررسی و انتخاب شما — هر سناریو مجموعه‌ای از تغییرات هوشمند برای کاهش هشدارهاست
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="bg-indigo-100 text-indigo-700 text-[10px] font-black px-2.5 py-1 rounded-full border border-indigo-200">
              {suggestions.length} سناریو یافت شد
            </span>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-600 border border-slate-200 rounded-xl p-2 bg-white transition-colors cursor-pointer"
              title="بستن پنل مقایسه"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 bg-slate-50 space-y-4">
          {displaySuggestions.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-8 text-emerald-800 text-sm font-black text-center flex flex-col items-center gap-3">
              <Check className="w-10 h-10 text-emerald-500" />
              <div>
                <p className="text-base">✨ همه چیز مرتب است!</p>
                <p className="text-xs font-bold text-emerald-600 mt-1">در حال حاضر هیچ پیشنهاد بهینه‌سازی برای این ماه وجود ندارد.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-2">
                <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
                  <div className="bg-amber-100 p-2 rounded-xl">
                    <Zap className="w-4 h-4 text-amber-600" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-500">کل هشدارهای قابل رفع</div>
                    <div className="text-lg font-black text-slate-800">
                      {displaySuggestions.reduce((sum, s) => sum + Math.abs(Math.min(0, s.impact.warningCountChange)), 0)}
                    </div>
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
                  <div className="bg-purple-100 p-2 rounded-xl">
                    <ArrowRight className="w-4 h-4 text-purple-600" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-500">مجموع تغییرات پیشنهادی</div>
                    <div className="text-lg font-black text-slate-800">
                      {displaySuggestions.reduce((sum, s) => sum + s.changes.length, 0)} تغییر
                    </div>
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3 sm:col-span-2 lg:col-span-1">
                  <div className="bg-emerald-100 p-2 rounded-xl">
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-slate-500">اولویت برتر</div>
                    <div className="text-xs font-black text-slate-800 truncate max-w-[200px]">
                      {displaySuggestions[0]?.description || '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Scenario Cards */}
              <div className="space-y-3">
                {displaySuggestions.map((suggestion, idx) => {
                  const isExpanded = expandedId === suggestion.id;
                  const isSelected = selectedId === suggestion.id;

                  return (
                    <div
                      key={suggestion.id}
                      className={`border rounded-2xl transition-all overflow-hidden ${
                        isSelected
                          ? 'border-indigo-400 bg-indigo-50/30 ring-2 ring-indigo-200'
                          : 'border-slate-200 bg-white hover:border-indigo-200'
                      }`}
                    >
                      {/* Card Header */}
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedId(isExpanded ? null : suggestion.id);
                          setSelectedId(suggestion.id);
                        }}
                        className="w-full flex items-center justify-between gap-3 p-4 text-right cursor-pointer"
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black ${
                            idx === 0
                              ? 'bg-indigo-100 text-indigo-700'
                              : idx === 1
                                ? 'bg-purple-100 text-purple-700'
                                : idx === 2
                                  ? 'bg-sky-100 text-sky-700'
                                  : 'bg-slate-100 text-slate-600'
                          }`}>
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-black text-slate-800 truncate">
                              {suggestion.description}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border ${getSeverityColor(suggestion.impact.warningCountChange)}`}>
                                {Math.abs(suggestion.impact.warningCountChange)} هشدار رفع می‌شود
                              </span>
                              <span className="text-[9px] font-bold text-slate-400">
                                {suggestion.changes.length} تغییر سلول
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {isSelected && (
                            <span className="bg-indigo-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full">انتخاب شده</span>
                          )}
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                      </button>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 p-4 space-y-3 bg-slate-50/50">
                          {/* Changes table */}
                          <div>
                            <h4 className="text-[10px] font-black text-slate-600 mb-2">تغییرات پیشنهادی در شیفت‌ها:</h4>
                            <div className="grid grid-cols-1 gap-1.5 max-h-[160px] overflow-y-auto">
                              {suggestion.changes.map((change, ci) => (
                                <div
                                  key={ci}
                                  className="flex items-center justify-between gap-2 bg-white border border-slate-150 rounded-lg px-3 py-2 text-xs"
                                >
                                  <span className="font-bold text-slate-700">
                                    {personnelNames[change.personnelId] || change.personnelId}
                                  </span>
                                  <span className="text-[10px] text-slate-500">روز {change.day}</span>
                                  <div className="flex items-center gap-1.5 font-mono text-[10px]">
                                    <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{change.fromShift}</span>
                                    <ArrowRight className="w-3 h-3 text-indigo-400" />
                                    <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold">{change.toShift}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Resolved Warnings */}
                          {suggestion.impact.resolvedWarnings.length > 0 && (
                            <div>
                              <h4 className="text-[10px] font-black text-emerald-600 mb-1.5">هشدارهای رفع‌شونده:</h4>
                              <div className="space-y-1 max-h-[100px] overflow-y-auto">
                                {suggestion.impact.resolvedWarnings.map((w, wi) => (
                                  <div key={wi} className="flex items-start gap-1.5 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5">
                                    <Check className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                                    <span className="font-bold">{w}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {displaySuggestions.length > 0 && (
          <div className="px-5 py-4 border-t border-slate-200 bg-white flex items-center justify-between gap-3">
            <p className="text-[10px] font-bold text-slate-500">
              {selectedId
                ? 'سناریوی انتخاب‌شده آمادهٔ اعمال است. تغییرات مستقیماً در جدول زمان‌بندی لحاظ خواهند شد.'
                : 'لطفاً یکی از سناریوهای بالا را برای بررسی جزئیات انتخاب کنید.'}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-extrabold text-xs px-4 py-2.5 rounded-xl transition-all cursor-pointer"
              >
                انصراف
              </button>
              <button
                type="button"
                disabled={!selectedId}
                onClick={() => {
                  const selected = displaySuggestions.find(s => s.id === selectedId);
                  if (selected) {
                    onApplySuggestion(selected);
                    onClose();
                  }
                }}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white font-extrabold text-xs px-5 py-2.5 rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                اعمال سناریوی انتخاب‌شده
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
