'use client';

import React from 'react';
import type { ArenaResultDTO } from '../../../domain/solver/arena/arena-types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  arena: ArenaResultDTO | null;
  onSelectScenario: (scenarioId: string) => void;
}

export function ArenaComparisonModal({ isOpen, onClose, arena, onSelectScenario }: Props) {
  if (!isOpen || !arena) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[65] p-4 animate-fade-in" dir="rtl">
      <div className="bg-white rounded-3xl max-w-5xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="p-6 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
              🏟️ آِرنا هوشمند — مقایسه ۵ سناریوی برتر
            </h3>
            <p className="text-xs text-slate-400 font-bold mt-1">
              {arena.totalScenarios} سناریو در { (arena.elapsedMs/1000).toFixed(1)} ثانیه بررسی شد — حالت پیش‌فرض فقط بهترین را نمایش می‌دهد، حالت پیشرفته ۳-۵ جایگزین
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-600 transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {arena.categories.map(cat => (
            <div key={cat.category} className="bg-slate-50 border border-slate-200 rounded-2xl p-4 hover:border-indigo-200 hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-black px-2.5 py-1 rounded-full ${
                  cat.category === 'best_overall' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                  cat.category === 'fairness_optimized' ? 'bg-sky-100 text-sky-700 border border-sky-200' :
                  cat.category === 'lowest_warnings' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                  cat.category === 'highest_request_satisfaction' ? 'bg-purple-100 text-purple-700 border border-purple-200' :
                  'bg-slate-200 text-slate-700 border border-slate-300'
                }`}>
                  {cat.titleFa}
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {cat.scenario?.strategy ?? '—'}
                </span>
              </div>

              {cat.scenario ? (
                <>
                  <div className="grid grid-cols-3 gap-2 text-[11px] my-3">
                    <div className="bg-white border rounded-xl p-2 text-center">
                      <div className="text-[10px] text-slate-400 font-bold">امتیاز کل</div>
                      <div className="text-sm font-black text-slate-800">{cat.scenario.score?.total ?? '—'}</div>
                    </div>
                    <div className="bg-white border rounded-xl p-2 text-center">
                      <div className="text-[10px] text-slate-400 font-bold">ایمنی ۴۰٪</div>
                      <div className="text-sm font-black text-emerald-700">{cat.scenario.score?.safety ?? '—'}</div>
                    </div>
                    <div className="bg-white border rounded-xl p-2 text-center">
                      <div className="text-[10px] text-slate-400 font-bold">پوشش ۲۵٪</div>
                      <div className="text-sm font-black text-indigo-700">{cat.scenario.score?.coverage ?? '—'}</div>
                    </div>
                    <div className="bg-white border rounded-xl p-2 text-center">
                      <div className="text-[10px] text-slate-400 font-bold">درخواست ۱۵٪</div>
                      <div className="text-sm font-black text-purple-700">{cat.scenario.score?.requestSatisfaction ?? '—'}</div>
                    </div>
                    <div className="bg-white border rounded-xl p-2 text-center">
                      <div className="text-[10px] text-slate-400 font-bold">عدالت ۱۰٪</div>
                      <div className="text-sm font-black text-sky-700">{cat.scenario.score?.fairness ?? '—'}</div>
                    </div>
                    <div className="bg-white border rounded-xl p-2 text-center">
                      <div className="text-[10px] text-slate-400 font-bold">پایداری ۱۰٪</div>
                      <div className="text-sm font-black text-slate-700">{cat.scenario.score?.stability ?? '—'}</div>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-600 font-bold leading-6 bg-white border border-slate-100 rounded-xl p-3 mb-3">
                    <div className="font-black text-slate-800 mb-1">دلیل انتخاب:</div>
                    {cat.reasonFa}
                  </div>

                  {cat.scenario.repairLog.length > 0 && (
                    <details className="text-[10px] font-bold text-slate-500">
                      <summary className="cursor-pointer hover:text-slate-700">گزارش ترمیم خودکار ({cat.scenario.repairLog.length} مورد)</summary>
                      <ul className="mt-2 space-y-1 max-h-24 overflow-y-auto pr-2">
                        {cat.scenario.repairLog.slice(0,5).map((log, idx) => (
                          <li key={idx} className="bg-white border rounded-lg p-2">{log.reasonFa}</li>
                        ))}
                        {cat.scenario.repairLog.length > 5 && (
                          <li className="text-slate-400">و {cat.scenario.repairLog.length - 5} مورد دیگر...</li>
                        )}
                      </ul>
                    </details>
                  )}

                  <button
                    onClick={() => onSelectScenario(cat.scenario!.id)}
                    className="w-full mt-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black py-2.5 rounded-xl transition-colors cursor-pointer"
                  >
                    انتخاب این سناریو به عنوان برنامه نهایی
                  </button>
                </>
              ) : (
                <div className="text-xs text-slate-400 font-bold p-4 text-center">سناریویی برای این دسته یافت نشد</div>
              )}
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50/50 shrink-0 flex items-center justify-between">
          <div className="text-[11px] text-slate-500 font-bold">
            امتیازدهی: ایمنی ۴۰٪، پوشش ۲۵٪، رضایت درخواست ۱۵٪، عدالت ۱۰٪، پایداری ۱۰٪ — خلاصه نهایی: کیفیت، هشدارها، ٪ عدالت، ٪ رضایت
          </div>
          <button
            onClick={onClose}
            className="bg-slate-800 hover:bg-slate-900 text-white text-xs font-black px-5 py-2 rounded-xl transition-colors cursor-pointer"
          >
            بستن آِرنا
          </button>
        </div>
      </div>
    </div>
  );
}
