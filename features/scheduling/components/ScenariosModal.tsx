import React from 'react';
import { ScoredSchedule } from '../../../lib/scoring';
import { CheckCircle, XCircle, AlertTriangle, ShieldCheck, Users, Activity, BarChart2, Star, Award, Target, Scale, Zap } from 'lucide-react';

interface ScenariosModalProps {
  isOpen: boolean;
  scenarios: ScoredSchedule[] | null;
  votes: Record<number, Record<string, number>>;
  currentUserId: string | null;
  userRole: 'admin' | 'headnurse' | 'personnel' | 'guest';
  targetJobGroup?: 'nurse' | 'assistant' | null;
  onApply: (scenario: ScoredSchedule) => void;
  onVote: (scenarioId: number, rating: number) => void;
  onClose: () => void;
}

function StarRating({ value, onVote }: { value: number; onVote?: (rating: number) => void }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const isFull = value >= i;
    const isHalf = value >= i - 0.5 && value < i;
    stars.push(
      <div
        key={i}
        className={`relative cursor-pointer ${onVote ? 'hover:scale-110 transition-transform' : ''}`}
        onClick={(e) => {
          if (!onVote) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const isLeftHalf = e.clientX < rect.left + rect.width / 2;
          onVote(isLeftHalf ? i - 0.5 : i);
        }}
        dir="ltr"
      >
        <Star className={`w-5 h-5 ${isFull ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}`} />
        {isHalf && (
          <div className="absolute top-0 left-0 overflow-hidden w-1/2">
            <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
          </div>
        )}
      </div>
    );
  }
  return <div className="flex flex-row gap-1" dir="ltr">{stars}</div>;
}

const getScenarioMeta = (type: ScoredSchedule['type']) => {
  switch (type) {
    case 'RULES_FIRST':
      return { 
        label: 'اولویت قوانین ثابت', 
        icon: <ShieldCheck className="w-4 h-4 text-red-600" />, 
        color: 'red', 
        badge: 'بهترین رعایت Hard Constraints',
        desc: 'کمترین تخلف ساختاری'
      };
    case 'REQUESTS':
      return { 
        label: 'اولویت درخواست‌ها', 
        icon: <Target className="w-4 h-4 text-violet-600" />, 
        color: 'violet', 
        badge: 'بیشترین برآورده‌سازی',
        desc: 'رعایت حداکثری درخواست‌ها'
      };
    case 'FAIRNESS':
      return { 
        label: 'اولویت عدالت', 
        icon: <Scale className="w-4 h-4 text-blue-600" />, 
        color: 'blue', 
        badge: 'بهترین تعادل',
        desc: 'توزیع عادلانه ساعات و تعطیلات'
      };
    case 'MIXED':
    default:
      return { 
        label: 'تعادل کلی', 
        icon: <Award className="w-4 h-4 text-emerald-600" />, 
        color: 'emerald', 
        badge: 'پیشنهاد سیستم',
        desc: 'بهترین ترکیب کلی'
      };
  }
};

export function ScenariosModal({ isOpen, scenarios, votes, currentUserId, userRole, targetJobGroup, onApply, onVote, onClose }: ScenariosModalProps) {
  if (!isOpen || !scenarios) return null;
  const canFinalize = userRole === 'headnurse' || userRole === 'admin';
  const groupBadge = targetJobGroup === 'nurse' ? 'پرستاران' : targetJobGroup === 'assistant' ? 'کمک‌بهیاران' : null;

  // Ensure we show exactly 4 representatives
  const displayScenarios = scenarios.slice(0, 4);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" dir="rtl">
      <div className="bg-white rounded-2xl w-full max-w-7xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-700 via-teal-700 to-cyan-700 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 rounded-2xl bg-white/20 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="font-black text-lg text-white tracking-tight">۴ سناریوی برتر (Multi-Strategy)</h2>
                {groupBadge && <span className="text-[10px] font-bold bg-white/20 text-white border border-white/30 px-3 py-0.5 rounded-full">{groupBadge}</span>}
              </div>
              <p className="text-emerald-100 text-xs font-bold mt-0.5">هر سناریو نماینده یک فلسفه متفاوت • امتیازدهی بر اساس قوانین + درخواست + عدالت</p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition-colors">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1 bg-slate-50/60">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {displayScenarios.map((scenario, idx) => {
              const meta = getScenarioMeta(scenario.type);
              const scenarioVotes = votes[scenario.id] || {};
              const userVote = currentUserId ? scenarioVotes[currentUserId] : 0;
              const allRatings = Object.values(scenarioVotes);
              const avgRating = allRatings.length > 0 ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length : 0;

              return (
                <div key={scenario.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col shadow-sm hover:shadow-md transition-all group">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {meta.icon}
                      <div>
                        <div className="text-sm font-black text-slate-800">{meta.label}</div>
                        <div className="text-[9px] text-slate-500 font-bold">{meta.desc}</div>
                      </div>
                    </div>
                    {idx === 0 && (
                      <span className="text-[8px] font-black px-2 py-0.5 bg-emerald-600 text-white rounded-full">بهترین کلی</span>
                    )}
                  </div>

                  {/* Score */}
                  <div className="flex items-center justify-between bg-gradient-to-r from-slate-50 to-white border border-slate-100 rounded-xl px-4 py-3 mb-3">
                    <div>
                      <div className="text-[10px] font-bold text-slate-500">امتیاز کلی</div>
                      <div className="text-3xl font-black text-slate-900 tabular-nums tracking-tighter">{scenario.totalScore.toFixed(0)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-bold text-amber-600">رأی کاربران</div>
                      <div className="flex items-center justify-end gap-1 text-sm">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                        <span className="font-black text-slate-700">{avgRating.toFixed(1)}</span>
                        <span className="text-[10px] text-slate-400">({allRatings.length})</span>
                      </div>
                    </div>
                  </div>

                  {/* Detailed Scores */}
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-white border border-slate-100 rounded-xl p-2.5 text-center">
                      <div className="text-[9px] text-red-500 font-black">قوانین</div>
                      <div className="text-xl font-black text-red-700 tabular-nums">{scenario.scoreA}</div>
                      <div className="text-[8px] text-slate-400">۵۰٪</div>
                    </div>
                    <div className="bg-white border border-slate-100 rounded-xl p-2.5 text-center">
                      <div className="text-[9px] text-violet-500 font-black">درخواست</div>
                      <div className="text-xl font-black text-violet-700 tabular-nums">{scenario.scoreB}</div>
                      <div className="text-[8px] text-slate-400">۳۰٪</div>
                    </div>
                    <div className="bg-white border border-slate-100 rounded-xl p-2.5 text-center">
                      <div className="text-[9px] text-blue-500 font-black">عدالت</div>
                      <div className="text-xl font-black text-blue-700 tabular-nums">{scenario.scoreC}</div>
                      <div className="text-[8px] text-slate-400">۲۰٪</div>
                    </div>
                  </div>

                  {/* Metadata badges */}
                  <div className="flex flex-wrap gap-1.5 mb-3 text-[9px]">
                    <div className="px-2 py-0.5 bg-slate-100 text-slate-600 font-bold rounded-lg flex items-center gap-1">
                      <Zap className="w-3 h-3" /> {scenario.warningCount} هشدار
                    </div>
                    <div className="px-2 py-0.5 bg-emerald-50 text-emerald-700 font-bold rounded-lg flex items-center gap-1">
                      {scenario.fulfilledRequestCount} درخواست برآورده
                    </div>
                    <div className="px-2 py-0.5 bg-blue-50 text-blue-700 font-bold rounded-lg flex items-center gap-1">
                      عدالت: {scenario.fairnessIndex}
                    </div>
                  </div>

                  {/* Strengths */}
                  {scenario.strengths.length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center gap-1.5 text-emerald-600 mb-1.5">
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-black">نقاط قوت</span>
                      </div>
                      <ul className="text-[10px] text-slate-600 leading-snug space-y-0.5 pr-1">
                        {scenario.strengths.slice(0, 3).map((s, i) => (
                          <li key={i} className="flex gap-1">• {s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Footer */}
                  <div className="mt-auto pt-3 border-t border-slate-100">
                    <div className="flex justify-center mb-3">
                      <StarRating value={userVote} onVote={(r) => onVote(scenario.id, r)} />
                    </div>
                    {canFinalize && (
                      <button 
                        onClick={() => onApply(scenario)} 
                        className="w-full py-2.5 text-xs font-black bg-slate-900 hover:bg-black active:bg-slate-950 text-white rounded-2xl transition-all shadow-sm"
                      >
                        تایید و اعمال این سناریو
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 text-center">
            <p className="text-[10px] text-slate-500 font-bold">
              سیستم از Multi-Strategy Search + Post-Optimization (Swap / MultiSwap / ChainSwap / Move) استفاده کرده است.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
