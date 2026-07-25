import React from 'react';
import { ScoredSchedule } from '../../../lib/scoring';
import { CheckCircle, XCircle, AlertTriangle, ShieldCheck, Users, Activity, BarChart2, Star, StarHalf } from 'lucide-react';

interface ScenariosModalProps {
  isOpen: boolean;
  scenarios: ScoredSchedule[] | null;
  votes: Record<number, Record<string, number>>; // { scenarioId: { personnelId: rating } }
  currentUserId: string | null;
  userRole: 'admin' | 'headnurse' | 'personnel' | 'guest';
  onApply: (scenario: ScoredSchedule) => void;
  onVote: (scenarioId: number, rating: number) => void;
  onClose: () => void;
}

function StarRating({ value, onVote }: { value: number; onVote?: (rating: number) => void }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const isHalf = value >= i - 0.5 && value < i;
    const isFull = value >= i;
    stars.push(
      <div 
        key={i} 
        className={`relative cursor-pointer ${onVote ? 'hover:scale-110 transition-transform' : ''}`}
        onClick={(e) => {
          if (!onVote) return;
          const rect = e.currentTarget.getBoundingClientRect();
          // In RTL, if they click the right side it's full, if they click left side it's half.
          // Because the star itself starts filling from right to left.
          const isLeftHalf = e.clientX < rect.left + rect.width / 2;
          onVote(isLeftHalf ? i - 0.5 : i);
        }}
        dir="ltr"
      >
        <Star className={`w-6 h-6 ${isFull ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}`} />
        {isHalf && (
          <div className="absolute top-0 left-0 overflow-hidden w-1/2">
            <Star className="w-6 h-6 text-amber-400 fill-amber-400" />
          </div>
        )}
      </div>
    );
  }
  return <div className="flex flex-row gap-1" dir="ltr">{stars}</div>;
}

export function ScenariosModal({ isOpen, scenarios, votes, currentUserId, userRole, onApply, onVote, onClose }: ScenariosModalProps) {
  if (!isOpen || !scenarios) return null;

  const canFinalize = userRole === 'headnurse' || userRole === 'admin';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" dir="rtl">
      <div className="bg-white rounded-3xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="bg-emerald-600 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-2 rounded-xl">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-white font-black text-lg">پیشنهادات هوشمند سیستم (۳ برنامه برتر)</h2>
              <p className="text-emerald-100 text-xs font-bold mt-0.5">همکاران می‌توانند با ثبت ستاره (۱ تا ۵) در انتخاب برنامه نهایی مشارکت کنند</p>
            </div>
          </div>
          <button onClick={onClose} className="text-emerald-100 hover:text-white bg-emerald-700/50 hover:bg-emerald-700 p-2 rounded-xl transition-colors">
            <XCircle className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/50">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {scenarios.map((scenario) => {
              const scenarioVotes = votes[scenario.id] || {};
              const userVote = currentUserId ? scenarioVotes[currentUserId] : 0;
              const allRatings = Object.values(scenarioVotes);
              const avgRating = allRatings.length > 0 ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length : 0;
              
              return (
              <div key={scenario.id} className="bg-white border-2 border-slate-100 hover:border-emerald-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col relative group">
                {scenario.type === 'MIXED' && (
                  <div className="absolute -top-3 -left-3 bg-amber-500 text-white text-[10px] font-black px-3 py-1 rounded-full shadow-sm">
                    🏆 پیشنهاد ویژه
                  </div>
                )}
                
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    {scenario.type === 'FAIRNESS' && <Activity className="w-5 h-5 text-blue-500" />}
                    {scenario.type === 'REQUESTS' && <Users className="w-5 h-5 text-purple-500" />}
                    {scenario.type === 'MIXED' && <BarChart2 className="w-5 h-5 text-emerald-500" />}
                    <h3 className="font-black text-slate-800 text-base">
                      {scenario.type === 'FAIRNESS' ? 'برنامه عدالت‌محور' : scenario.type === 'REQUESTS' ? 'برنامه درخواست‌محور' : 'برنامه تلفیقی'}
                    </h3>
                  </div>
                  <div className="text-center bg-amber-50 rounded-lg px-2 py-1">
                    <div className="flex items-center gap-1 text-amber-600 font-black text-sm">
                      <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                      {avgRating.toFixed(1)}
                    </div>
                    <div className="text-[9px] text-amber-700 font-bold">{allRatings.length} رای</div>
                  </div>
                </div>

                <div className="space-y-3 mb-6 flex-1">
                  <div className="bg-slate-50 p-3 rounded-xl">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-bold text-slate-600">امتیاز کل سیستم</span>
                      <span className="font-black text-lg text-emerald-600">{scenario.totalScore.toFixed(0)}</span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-1.5">
                      <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${scenario.totalScore}%` }}></div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-blue-50 p-2 rounded-lg text-center">
                      <div className="text-[10px] font-bold text-blue-600 mb-1">رعایت قوانین کلی</div>
                      <div className="font-black text-sm text-blue-700">{scenario.scoreA.toFixed(0)}</div>
                    </div>
                    <div className="bg-purple-50 p-2 rounded-lg text-center">
                      <div className="text-[10px] font-bold text-purple-600 mb-1">رعایت درخواست‌های پرسنل</div>
                      <div className="font-black text-sm text-purple-700">{scenario.scoreB.toFixed(0)}</div>
                    </div>
                    <div className="bg-amber-50 p-2 rounded-lg text-center">
                      <div className="text-[10px] font-bold text-amber-600 mb-1">رعایت عدالت در چینش</div>
                      <div className="font-black text-sm text-amber-700">{scenario.scoreC.toFixed(0)}</div>
                    </div>
                  </div>

                  <div className="space-y-2 mt-4">
                    <h4 className="text-xs font-black text-slate-700 flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> نقاط قوت
                    </h4>
                    <ul className="space-y-1">
                      {scenario.strengths.map((s, i) => (
                        <li key={i} className="text-[11px] font-bold text-slate-600 flex items-start gap-1.5">
                          <span className="text-emerald-500 mt-0.5">•</span> {s}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {scenario.weaknesses.length > 0 && (
                    <div className="space-y-2 mt-3">
                      <h4 className="text-xs font-black text-slate-700 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> نقاط ضعف
                      </h4>
                      <ul className="space-y-1">
                        {scenario.weaknesses.map((s, i) => (
                          <li key={i} className="text-[11px] font-bold text-slate-600 flex items-start gap-1.5">
                            <span className="text-amber-500 mt-0.5">•</span> {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <p className="text-[11px] font-bold text-slate-500 leading-relaxed">
                      {scenario.analysis}
                    </p>
                  </div>
                </div>

                <div className="mt-auto border-t border-slate-100 pt-4 mb-4">
                  <div className="text-center mb-2">
                    <span className="text-xs font-black text-slate-700">رای شما به این برنامه:</span>
                    {userVote > 0 && <span className="text-[10px] text-emerald-600 font-bold mr-2">(ثبت شده: {userVote})</span>}
                  </div>
                  <div className="flex justify-center" dir="ltr">
                    <StarRating value={userVote} onVote={(rating) => onVote(scenario.id, rating)} />
                  </div>
                </div>

                {canFinalize && (
                  <button
                    onClick={() => onApply(scenario)}
                    className={`w-full py-3 rounded-xl font-black text-sm transition-all shadow-sm ${
                      scenario.type === 'MIXED'
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-4 ring-emerald-600/20'
                        : 'bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700'
                    }`}
                  >
                    تایید نهایی این برنامه
                  </button>
                )}
              </div>
            )})}
          </div>
        </div>
      </div>
    </div>
  );
}
