import React from 'react';
import { ScoredSchedule } from '../../../lib/scoring';
import { CheckCircle, XCircle, ShieldCheck, Users, Activity, BarChart2, Star, Play, Square } from 'lucide-react';

interface ScenariosModalProps {
  isOpen: boolean;
  scenarios: ScoredSchedule[] | null;
  votes: Record<number, Record<string, number>>;
  currentUserId: string | null;
  userRole: 'admin' | 'headnurse' | 'personnel' | 'guest';
  targetJobGroup?: 'nurse' | 'assistant' | null;
  /** Personnel can see and vote only after the head nurse has opened voting. */
  votingOpen: boolean;
  onApply: (scenario: ScoredSchedule) => void;
  onVote: (scenarioId: number, rating: number) => void;
  onToggleVoting: () => void;
  onClose: () => void;
}

function StarRating({ value, onVote }: { value: number; onVote?: (rating: number) => void }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const isFull = value >= i;
    const isHalf = value >= i - 0.5 && value < i;
    stars.push(
      <button
        type="button"
        key={i}
        disabled={!onVote}
        aria-label={`امتیاز ${i}`}
        className={`relative ${onVote ? 'cursor-pointer hover:scale-110 transition-transform' : 'cursor-default'}`}
        onClick={(event) => {
          if (!onVote) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const isLeftHalf = event.clientX < rect.left + rect.width / 2;
          onVote(isLeftHalf ? i - 0.5 : i);
        }}
        dir="ltr"
      >
        <Star className={`w-5 h-5 ${isFull ? 'text-amber-400 fill-amber-400' : 'text-slate-200'}`} />
        {isHalf && (
          <span className="absolute top-0 left-0 overflow-hidden w-1/2">
            <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
          </span>
        )}
      </button>
    );
  }
  return <div className="flex flex-row gap-1" dir="ltr">{stars}</div>;
}

const scenarioTitle = (scenario: ScoredSchedule) => {
  const code = scenario.scenarioCode || (scenario.type === 'MIXED' ? 'A' : scenario.type === 'REQUESTS' ? 'B' : 'C');
  const label = scenario.type === 'FAIRNESS' ? 'عدالت‌محور' : scenario.type === 'REQUESTS' ? 'درخواست‌محور' : 'تلفیقی';
  return `برنامه ${code} · ${label}`;
};

export function ScenariosModal({
  isOpen,
  scenarios,
  votes,
  currentUserId,
  userRole,
  targetJobGroup,
  votingOpen,
  onApply,
  onVote,
  onToggleVoting,
  onClose,
}: ScenariosModalProps) {
  if (!isOpen || !scenarios) return null;
  const canManageVoting = userRole === 'headnurse' || userRole === 'admin';
  const canFinalize = canManageVoting;
  const canVote = canManageVoting || votingOpen;
  const groupBadge = targetJobGroup === 'nurse' ? 'پرستاران' : targetJobGroup === 'assistant' ? 'کمک‌بهیاران' : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm" dir="rtl" role="dialog" aria-modal="true" aria-label="سناریوهای شیفت">
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-xl overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-black text-[13px] text-white">سه برنامه پیشنهادی A، B و C</h2>
                {groupBadge && <span className="text-[10px] font-bold bg-white/20 text-white border border-white/30 px-2 py-0.5 rounded-full">{groupBadge}</span>}
              </div>
              <p className="text-[11px] text-emerald-100 font-bold">
                {votingOpen ? 'رای‌گیری برای پرسنل فعال است' : 'تا شروع رای‌گیری، این کادر فقط برای سرپرستار قابل مشاهده است'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white" aria-label="بستن">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 bg-slate-50/50">
          {canManageVoting && (
            <div className={`mb-4 rounded-xl border p-3 flex flex-wrap items-center justify-between gap-3 ${votingOpen ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}>
              <div>
                <p className="text-[12px] font-black text-slate-800">کنترل نمایش و رای‌گیری پرسنل</p>
                <p className="text-[10px] font-bold text-slate-500 mt-0.5">
                  {votingOpen ? 'پرسنل این گروه اکنون کادر سناریوها و امکان ثبت رای را می‌بینند.' : 'پرسنل تا زمانی که شما شروع رای‌گیری را نزنید، این کادر و سناریوها را نمی‌بینند.'}
                </p>
              </div>
              <button
                type="button"
                onClick={onToggleVoting}
                className={`inline-flex items-center gap-1.5 text-white text-[11px] font-black px-3.5 py-2.5 rounded-xl shadow-sm transition-colors ${votingOpen ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
              >
                {votingOpen ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {votingOpen ? 'پایان رای‌گیری' : 'شروع رای‌گیری'}
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {scenarios.map((scenario) => {
              const scenarioVotes = votes[scenario.id] || {};
              const userVote = currentUserId ? scenarioVotes[currentUserId] : 0;
              const allRatings = Object.values(scenarioVotes);
              const avgRating = allRatings.length > 0 ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length : 0;
              const programCode = scenario.scenarioCode || (scenario.type === 'MIXED' ? 'A' : scenario.type === 'REQUESTS' ? 'B' : 'C');
              return (
                <div key={scenario.id} className={`bg-white border rounded-xl p-4 flex flex-col ${programCode === 'A' ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      {scenario.type === 'FAIRNESS' && <Activity className="w-4 h-4 text-blue-500" />}
                      {scenario.type === 'REQUESTS' && <Users className="w-4 h-4 text-violet-500" />}
                      {scenario.type === 'MIXED' && <BarChart2 className="w-4 h-4 text-emerald-600" />}
                      <span className="text-[12px] font-black text-slate-800">{scenarioTitle(scenario)}</span>
                      {programCode === 'A' && <span className="text-[8px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full">پیش‌فرض</span>}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] font-bold bg-amber-50 border border-amber-100 px-2 py-1 rounded-full">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                      {avgRating.toFixed(1)} · {allRatings.length}
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 mb-3">
                    <span className="text-[11px] font-bold text-slate-500">امتیاز متناسب با اولویت برنامه</span>
                    <span className="text-[13px] font-black text-slate-900">{scenario.totalScore.toFixed(0)}/100</span>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5 mb-3">
                    <div className="text-center bg-white border border-slate-100 rounded-lg py-1.5">
                      <div className="text-[9px] text-slate-400 font-bold">قوانین</div>
                      <div className="text-[11px] font-black">{scenario.scoreA.toFixed(0)}/100</div>
                    </div>
                    <div className="text-center bg-white border border-slate-100 rounded-lg py-1.5">
                      <div className="text-[9px] text-slate-400 font-bold">درخواست</div>
                      <div className="text-[11px] font-black">{scenario.scoreB.toFixed(0)}/100</div>
                    </div>
                    <div className="text-center bg-white border border-slate-100 rounded-lg py-1.5">
                      <div className="text-[9px] text-slate-400 font-bold">عدالت</div>
                      <div className="text-[11px] font-black">{scenario.scoreC.toFixed(0)}/100</div>
                    </div>
                  </div>

                  {scenario.strengths.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[10px] font-black text-slate-600 mb-1 flex items-center gap-1"><CheckCircle className="w-3 h-3 text-emerald-500" /> نقاط قوت</div>
                      <ul className="space-y-0.5">
                        {scenario.strengths.slice(0, 2).map((strength, index) => <li key={index} className="text-[10px] text-slate-500 leading-4">• {strength}</li>)}
                      </ul>
                    </div>
                  )}

                  <div className="mt-auto pt-3 border-t border-slate-100">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <StarRating value={userVote} onVote={canVote ? rating => onVote(scenario.id, rating) : undefined} />
                    </div>
                    {canFinalize && (
                      <button type="button" onClick={() => onApply(scenario)} className="w-full bg-slate-900 hover:bg-black text-white text-[11px] font-bold py-2.5 rounded-xl">
                        تایید نهایی برنامه {programCode}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
