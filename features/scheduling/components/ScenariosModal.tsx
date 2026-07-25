import React from 'react';
import { ScoredSchedule } from '../../../lib/scoring';
import { CheckCircle, XCircle, AlertTriangle, ShieldCheck, Users, Activity, BarChart2, Star } from 'lucide-react';

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

export function ScenariosModal({ isOpen, scenarios, votes, currentUserId, userRole, targetJobGroup, onApply, onVote, onClose }: ScenariosModalProps) {
  if (!isOpen || !scenarios) return null;
  const canFinalize = userRole === 'headnurse' || userRole === 'admin';
  const groupBadge = targetJobGroup === 'nurse' ? 'پرستاران' : targetJobGroup === 'assistant' ? 'کمک‌بهیاران' : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" dir="rtl">
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-black text-[13px] text-slate-900">۳ سناریو</h2>
                {groupBadge && <span className="text-[10px] font-bold bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full text-slate-600">{groupBadge}</span>}
              </div>
              <p className="text-[11px] text-slate-500 font-bold">امتیاز دهید و یک گزینه را تایید کنید</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 bg-slate-50/50">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {scenarios.map((scenario) => {
              const scenarioVotes = votes[scenario.id] || {};
              const userVote = currentUserId ? scenarioVotes[currentUserId] : 0;
              const allRatings = Object.values(scenarioVotes);
              const avgRating = allRatings.length > 0 ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length : 0;
              return (
                <div key={scenario.id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      {scenario.type === 'FAIRNESS' && <Activity className="w-4 h-4 text-blue-500" />}
                      {scenario.type === 'REQUESTS' && <Users className="w-4 h-4 text-violet-500" />}
                      {scenario.type === 'MIXED' && <BarChart2 className="w-4 h-4 text-emerald-600" />}
                      <span className="text-[12px] font-black text-slate-800">
                        {scenario.type === 'FAIRNESS' ? 'عدالت‌محور' : scenario.type === 'REQUESTS' ? 'درخواست‌محور' : 'تلفیقی'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] font-bold bg-amber-50 border border-amber-100 px-2 py-1 rounded-full">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      {avgRating.toFixed(1)} · {allRatings.length}
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 mb-3">
                    <span className="text-[11px] font-bold text-slate-500">امتیاز</span>
                    <span className="text-[13px] font-black text-slate-900">{scenario.totalScore.toFixed(0)}</span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 mb-3">
                    <div className="text-center bg-white border border-slate-100 rounded-lg py-1.5">
                      <div className="text-[9px] text-slate-400 font-bold">قوانین</div>
                      <div className="text-[11px] font-black">{scenario.scoreA.toFixed(0)}</div>
                    </div>
                    <div className="text-center bg-white border border-slate-100 rounded-lg py-1.5">
                      <div className="text-[9px] text-slate-400 font-bold">درخواست</div>
                      <div className="text-[11px] font-black">{scenario.scoreB.toFixed(0)}</div>
                    </div>
                    <div className="text-center bg-white border border-slate-100 rounded-lg py-1.5">
                      <div className="text-[9px] text-slate-400 font-bold">عدالت</div>
                      <div className="text-[11px] font-black">{scenario.scoreC.toFixed(0)}</div>
                    </div>
                  </div>

                  {scenario.strengths.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[10px] font-black text-slate-600 mb-1 flex items-center gap-1"><CheckCircle className="w-3 h-3 text-emerald-500" /> نقاط قوت</div>
                      <ul className="space-y-0.5">
                        {scenario.strengths.slice(0,2).map((s,i)=>(
                          <li key={i} className="text-[10px] text-slate-500 leading-4">• {s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-auto pt-3 border-t border-slate-100">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <StarRating value={userVote} onVote={(r)=>onVote(scenario.id, r)} />
                    </div>
                    {canFinalize && (
                      <button onClick={()=>onApply(scenario)} className="w-full bg-slate-900 hover:bg-black text-white text-[11px] font-bold py-2.5 rounded-xl">
                        تایید نهایی
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
