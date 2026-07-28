'use client';

import React from 'react';
import type { JobGroup } from '../../../lib/types';
import type { ScoredSchedule } from '../../../lib/scoring';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Eye,
  GitCompareArrows,
  Lock,
  MessageSquareWarning,
  Play,
  ShieldCheck,
  Sparkles,
  Star,
  Trophy,
  Users,
} from 'lucide-react';

export interface ScenarioWorkflowView {
  scenarios: ScoredSchedule[];
  generationLog?: string[];
  comparisonStartedAt?: string;
  votingOpen?: boolean;
}

interface ScenarioWorkspaceProps {
  group: JobGroup;
  workflow: ScenarioWorkflowView;
  selectedScenarioId: number | null;
  canManage: boolean;
  canVote: boolean;
  currentUserId: string | null;
  votes: Record<number, Record<string, number>>;
  onSelectScenario: (scenarioId: number | null) => void;
  onStartComparison: () => void;
  onToggleVoting: () => void;
  onFinalize: (scenario: ScoredSchedule) => void;
  onVote: (scenarioId: number, rating: number) => void;
}

function StarRating({ value, onVote }: { value: number; onVote?: (rating: number) => void }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const isFull = value >= i;
    const isHalf = value >= i - 0.5 && value < i;
    stars.push(
      <div
        key={i}
        className={`relative ${onVote ? 'cursor-pointer hover:scale-110 transition-transform' : ''}`}
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
          <div className="absolute inset-y-0 left-0 overflow-hidden w-1/2">
            <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
          </div>
        )}
      </div>
    );
  }
  return <div className="flex items-center gap-1" dir="ltr">{stars}</div>;
}

const groupMeta = {
  nurse: {
    label: 'پرستاران',
    surface: 'from-indigo-50 via-white to-blue-50',
    border: 'border-indigo-200',
    accentBorder: 'border-indigo-300',
    badge: 'bg-indigo-600 text-white',
    softBadge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    button: 'bg-indigo-600 hover:bg-indigo-700',
    buttonSoft: 'border-indigo-200 text-indigo-700 hover:bg-indigo-50',
    scoreRing: 'ring-indigo-100',
    stageActive: 'bg-indigo-600 text-white border-indigo-600',
    stageDone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    stagePending: 'bg-white text-slate-400 border-slate-200',
    tabActive: 'bg-indigo-600 text-white border-indigo-600 shadow-sm',
    tabInactive: 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50',
  },
  assistant: {
    label: 'کمک‌بهیاران',
    surface: 'from-emerald-50 via-white to-teal-50',
    border: 'border-emerald-200',
    accentBorder: 'border-emerald-300',
    badge: 'bg-emerald-600 text-white',
    softBadge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    button: 'bg-emerald-600 hover:bg-emerald-700',
    buttonSoft: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
    scoreRing: 'ring-emerald-100',
    stageActive: 'bg-emerald-600 text-white border-emerald-600',
    stageDone: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    stagePending: 'bg-white text-slate-400 border-slate-200',
    tabActive: 'bg-emerald-600 text-white border-emerald-600 shadow-sm',
    tabInactive: 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50',
  },
} as const;

function scenarioIcon(type: ScoredSchedule['type']) {
  if (type === 'REQUESTS') return <Users className="w-4 h-4 text-violet-600" />;
  if (type === 'FAIRNESS') return <Activity className="w-4 h-4 text-blue-600" />;
  return <BarChart3 className="w-4 h-4 text-emerald-600" />;
}

function rankScenarios(scenarios: readonly ScoredSchedule[]) {
  const ranking = [...scenarios].sort((left, right) => right.totalScore - left.totalScore);
  return new Map(ranking.map((scenario, index) => [scenario.id, index + 1]));
}

function scoreBarColor(score: number) {
  if (score >= 85) return 'bg-emerald-500';
  if (score >= 70) return 'bg-amber-500';
  return 'bg-rose-500';
}

function buildStages(workflow: ScenarioWorkflowView, warningsResolved: boolean) {
  return [
    {
      number: 1,
      label: 'تولید برنامه‌ها',
      state: workflow.scenarios.length > 0 ? 'done' : 'pending',
    },
    {
      number: 2,
      label: 'رفع هشدارها',
      state: warningsResolved ? 'done' : 'active',
    },
    {
      number: 3,
      label: 'امتیازدهی سیستم',
      state: workflow.comparisonStartedAt ? (workflow.votingOpen ? 'done' : 'active') : 'pending',
    },
    {
      number: 4,
      label: 'نظرسنجی پرسنل',
      state: workflow.votingOpen ? 'active' : 'pending',
    },
  ] as const;
}

export function ScenarioWorkspace(props: ScenarioWorkspaceProps) {
  const {
    group,
    workflow,
    selectedScenarioId,
    canManage,
    canVote,
    currentUserId,
    votes,
    onSelectScenario,
    onStartComparison,
    onToggleVoting,
    onFinalize,
    onVote,
  } = props;

  const meta = groupMeta[group];
  const warningsResolved = workflow.scenarios.length > 0 && workflow.scenarios.every((scenario) => scenario.relevantWarningCount === 0);
  const ranking = rankScenarios(workflow.scenarios);
  const stages = buildStages(workflow, warningsResolved);
  const defaultScenarioId = workflow.scenarios[0]?.id ?? null;
  const [lastChosenScenarioId, setLastChosenScenarioId] = React.useState<number | null>(selectedScenarioId ?? defaultScenarioId);

  const activeScenario = React.useMemo(() => {
    if (workflow.scenarios.length === 0) return null;
    const desiredId = selectedScenarioId ?? lastChosenScenarioId ?? defaultScenarioId;
    return workflow.scenarios.find((scenario) => scenario.id === desiredId) || workflow.scenarios[0] || null;
  }, [defaultScenarioId, lastChosenScenarioId, selectedScenarioId, workflow.scenarios]);

  const currentStageLabel = workflow.votingOpen
    ? 'نظرسنجی پرسنل فعال است'
    : workflow.comparisonStartedAt
      ? 'امتیازدهی سیستم فعال است'
      : warningsResolved
        ? 'آماده شروع امتیازدهی سیستم'
        : 'در مرحله رفع هشدارها';

  const handleFocusScenario = (scenarioId: number) => {
    setLastChosenScenarioId(scenarioId);
    onSelectScenario(scenarioId);
  };

  if (!activeScenario) return null;

  const scenarioVotes = votes[activeScenario.id] || {};
  const allRatings = Object.values(scenarioVotes);
  const averageRating = allRatings.length > 0 ? allRatings.reduce((sum, value) => sum + value, 0) / allRatings.length : 0;
  const userRating = currentUserId ? scenarioVotes[currentUserId] || 0 : 0;
  const activeRank = ranking.get(activeScenario.id) || 0;
  const activeInTable = selectedScenarioId === activeScenario.id;
  const scenarioStageLabel = activeScenario.relevantWarningCount > 0
    ? 'در مرحله رفع هشدار'
    : workflow.votingOpen
      ? 'آماده دریافت رای پرسنل'
      : workflow.comparisonStartedAt
        ? 'وارد مرحله مقایسه شده'
        : 'آماده شروع مقایسه';

  return (
    <section className={`bg-gradient-to-r ${meta.surface} border ${meta.border} rounded-3xl shadow-sm overflow-hidden print:hidden`} dir="rtl">
      <div className="px-5 py-5 border-b border-slate-200/80 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-4 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[11px] font-black px-3 py-1 rounded-full ${meta.badge}`}>{meta.label}</span>
            <h3 className="text-base font-black text-slate-900">کارتابل مقایسه برنامه‌های پیشنهادی</h3>
            <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${meta.softBadge}`}>
              {currentStageLabel}
            </span>
          </div>

          <div className="rounded-2xl border border-white/80 bg-white/70 px-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              {stages.map((stage, index) => {
                const stateClass = stage.state === 'active'
                  ? meta.stageActive
                  : stage.state === 'done'
                    ? meta.stageDone
                    : meta.stagePending;
                return (
                  <div key={`${group}-stage-${stage.number}`} className="flex items-center gap-3">
                    <div className={`flex items-center gap-2 border rounded-2xl px-3 py-2 ${stateClass}`}>
                      <span className="text-[11px] font-black min-w-5 text-center">
                        {stage.state === 'done' ? '✓' : stage.number}
                      </span>
                      <span className="text-[11px] font-black whitespace-nowrap">{stage.label}</span>
                    </div>
                    {index < stages.length - 1 && <span className="w-7 h-px bg-slate-300"></span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:justify-end">
          <button
            type="button"
            onClick={() => onSelectScenario(null)}
            className={`text-xs font-black px-3.5 py-2 rounded-xl border transition-all ${selectedScenarioId === null ? `${meta.button} text-white border-transparent` : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
          >
            بازگشت به برنامه مبنا
          </button>
          {canManage && warningsResolved && !workflow.comparisonStartedAt && (
            <button
              type="button"
              onClick={onStartComparison}
              className={`text-xs font-black px-4 py-2.5 rounded-xl text-white transition-all shadow-sm ${meta.button}`}
            >
              <span className="inline-flex items-center gap-1.5">
                <GitCompareArrows className="w-4 h-4" />
                شروع مقایسه و امتیازدهی سیستم
              </span>
            </button>
          )}
          {canManage && workflow.comparisonStartedAt && (
            <button
              type="button"
              onClick={onToggleVoting}
              className={`text-xs font-black px-4 py-2.5 rounded-xl text-white transition-all shadow-sm ${workflow.votingOpen ? 'bg-rose-600 hover:bg-rose-700' : meta.button}`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Play className="w-4 h-4" />
                {workflow.votingOpen ? 'پایان نظرسنجی پرسنل' : 'شروع نظرسنجی پرسنل'}
              </span>
            </button>
          )}
        </div>
      </div>

      {!warningsResolved && canManage && (
        <div className="px-5 py-3 border-b border-slate-200/70 bg-amber-50/70">
          <div className="flex items-start gap-2 text-[11px] font-bold text-amber-900 leading-6">
            <MessageSquareWarning className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
            <div>
              برای ادامه، یکی از برنامه‌ها را در جدول فعال کنید و هشدارهای همان برنامه را از پنجره اصلی هشدارهای نارنجی بالای صفحه برطرف کنید. با تغییر برنامه فعال، همان پنجره نارنجی نیز با هشدارهای برنامه جدید به‌روز می‌شود.
            </div>
          </div>
        </div>
      )}

      {warningsResolved && !workflow.comparisonStartedAt && canManage && (
        <div className="px-5 py-3 border-b border-slate-200/70 bg-emerald-50/80">
          <div className="flex items-start gap-2 text-[11px] font-bold text-emerald-900 leading-6">
            <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
            <div>
              هشدارهای این گروه برای همه برنامه‌ها رفع شده است. این نوار ثابت باقی می‌ماند تا هر زمان که سرپرستار مایل بود، از همین‌جا مقایسه و امتیازدهی را آغاز کند.
            </div>
          </div>
        </div>
      )}

      <div className="p-5">
        <div className={`bg-white rounded-3xl border ${meta.accentBorder} shadow-sm ring-4 ${meta.scoreRing} overflow-hidden`}>
          <div className="px-4 py-4 border-b border-slate-200 bg-slate-50/80 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {workflow.scenarios.map((scenario) => {
                const selected = activeScenario.id === scenario.id;
                return (
                  <button
                    key={scenario.id}
                    type="button"
                    onClick={() => handleFocusScenario(scenario.id)}
                    className={`px-3.5 py-2 rounded-2xl border text-xs font-black transition-all ${selected ? meta.tabActive : meta.tabInactive}`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {scenarioIcon(scenario.type)}
                      برنامه {scenario.scenarioKey}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${meta.softBadge}`}>{activeScenario.shortTitle}</span>
              <span className="text-[11px] font-bold text-slate-500">{scenarioStageLabel}</span>
              {workflow.comparisonStartedAt && activeRank > 0 && (
                <span className="text-[10px] font-black px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700 inline-flex items-center gap-1">
                  <Trophy className="w-3 h-3" /> رتبه {activeRank}
                </span>
              )}
              {activeInTable ? (
                <span className="text-[10px] font-black px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-700 inline-flex items-center gap-1">
                  <Eye className="w-3 h-3" /> این برنامه در جدول فعال است
                </span>
              ) : (
                <span className="text-[10px] font-black px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-500">
                  جدول روی برنامه مبنا یا برنامه دیگری قرار دارد
                </span>
              )}
            </div>
          </div>

          <div className="p-4 md:p-5 space-y-5">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-[10px] font-black text-slate-500">درخواست</div>
                <div className="text-sm font-black text-slate-900">{activeScenario.weights.request}%</div>
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-500">عدالت</div>
                <div className="text-sm font-black text-slate-900">{activeScenario.weights.fairness}%</div>
              </div>
              <div>
                <div className="text-[10px] font-black text-slate-500">بهینه‌سازی</div>
                <div className="text-sm font-black text-slate-900">{activeScenario.weights.optimization}%</div>
              </div>
            </div>

            {workflow.comparisonStartedAt && (
              <div className="space-y-2">
                {[
                  { label: 'اجرای درخواست‌ها', value: activeScenario.metrics.requestScore },
                  { label: 'عدالت شیفت و ساعت', value: activeScenario.metrics.fairnessScore },
                  { label: 'رضایت پرسنل', value: activeScenario.metrics.satisfactionScore },
                ].map((item) => (
                  <div key={`${activeScenario.id}-${item.label}`} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-black text-slate-600">
                      <span>{item.label}</span>
                      <span className="text-slate-900">{item.value.toFixed(1)}٪</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full ${scoreBarColor(item.value)}`} style={{ width: `${Math.max(0, Math.min(100, item.value))}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-2xl border border-slate-100 bg-white p-4 space-y-3">
              <div className="flex items-center gap-2 text-[11px] font-black text-slate-700">
                <Sparkles className="w-4 h-4 text-amber-500" />
                نقاط قوت برجسته
              </div>
              <div className="space-y-2 text-[11px] font-bold text-slate-600 leading-6">
                {activeScenario.strengths.slice(0, 2).map((strength, index) => (
                  <div key={`${activeScenario.id}-strength-${index}`} className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-1 shrink-0" />
                    <span>{strength}</span>
                  </div>
                ))}
                {activeScenario.strengths.length === 0 && (
                  <div className="text-slate-400">هنوز نکته شاخصی برای نمایش ثبت نشده است.</div>
                )}
              </div>
            </div>

            <div className="space-y-3 pt-1 border-t border-slate-100">
              <button
                type="button"
                onClick={() => handleFocusScenario(activeScenario.id)}
                className={`w-full text-xs font-black px-3 py-3 rounded-2xl transition-all border ${activeInTable ? `${meta.button} text-white border-transparent` : `bg-white ${meta.buttonSoft}`}`}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Eye className="w-4 h-4" />
                  {activeInTable ? 'این برنامه در جدول فعال است' : 'فعال‌سازی این برنامه در جدول'}
                </span>
              </button>

              {(workflow.votingOpen || canManage) && (
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black text-slate-500">میانگین نظرسنجی پرسنل</span>
                    <span className="text-[11px] font-black text-slate-800">{averageRating.toFixed(1)} / 5 • {allRatings.length} رای</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <StarRating value={averageRating} />
                    {canVote && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black text-slate-500">رای شما</span>
                        <StarRating value={userRating} onVote={(rating) => onVote(activeScenario.id, rating)} />
                      </div>
                    )}
                    {!canVote && workflow.votingOpen && (
                      <div className="text-[10px] font-black text-slate-500 inline-flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        فقط پرسنل همین گروه می‌توانند رای ثبت کنند.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {canManage && workflow.comparisonStartedAt && (
                <button
                  type="button"
                  onClick={() => onFinalize(activeScenario)}
                  className="w-full text-xs font-black px-3 py-3 rounded-2xl text-white bg-slate-900 hover:bg-black transition-all"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Lock className="w-4 h-4" />
                    تایید نهایی و قفل این برنامه
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
