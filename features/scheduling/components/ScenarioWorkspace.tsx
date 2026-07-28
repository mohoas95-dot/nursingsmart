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
  const currentStage = workflow.votingOpen
    ? 4
    : workflow.comparisonStartedAt
      ? 3
      : warningsResolved
        ? 2
        : 2;

  const stageLabels = [
    'تولید برنامه‌ها',
    warningsResolved && !workflow.comparisonStartedAt ? 'رفع هشدارها تکمیل شده' : 'رفع هشدارها',
    workflow.comparisonStartedAt ? 'امتیازدهی سیستم فعال' : 'امتیازدهی سیستم',
    workflow.votingOpen ? 'نظرسنجی پرسنل فعال' : 'نظرسنجی پرسنل',
  ];

  return stageLabels.map((label, index) => {
    const stageNumber = index + 1;
    let state: 'done' | 'active' | 'pending' = 'pending';
    if (stageNumber === 1 && workflow.scenarios.length > 0) state = 'done';
    if (stageNumber === 2) state = warningsResolved ? 'done' : 'active';
    if (stageNumber === 3) state = workflow.comparisonStartedAt ? 'active' : (warningsResolved ? 'pending' : 'pending');
    if (stageNumber === 4) state = workflow.votingOpen ? 'active' : 'pending';

    if (workflow.comparisonStartedAt && stageNumber < 3) state = 'done';
    if (workflow.votingOpen && stageNumber < 4) state = 'done';

    return { number: stageNumber, label, state };
  });
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
  const currentStageLabel = workflow.votingOpen
    ? 'نظرسنجی پرسنل فعال است'
    : workflow.comparisonStartedAt
      ? 'امتیازدهی سیستم فعال است'
      : warningsResolved
        ? 'آماده شروع امتیازدهی سیستم'
        : 'در مرحله رفع هشدارها';

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

      {!!workflow.generationLog?.length && (
        <div className="px-5 py-3 border-b border-slate-200/70 bg-slate-50/70">
          <div className="flex items-start gap-2 text-[11px] font-bold text-slate-600 leading-6">
            <MessageSquareWarning className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
            <div>
              {workflow.generationLog.map((item, index) => (
                <div key={`${group}-generation-log-${index}`}>• {item}</div>
              ))}
            </div>
          </div>
        </div>
      )}

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

      <div className="p-5 grid grid-cols-1 xl:grid-cols-3 gap-4">
        {workflow.scenarios.map((scenario) => {
          const scenarioVotes = votes[scenario.id] || {};
          const allRatings = Object.values(scenarioVotes);
          const averageRating = allRatings.length > 0 ? allRatings.reduce((sum, value) => sum + value, 0) / allRatings.length : 0;
          const userRating = currentUserId ? scenarioVotes[currentUserId] || 0 : 0;
          const isSelected = selectedScenarioId === scenario.id;
          const rank = ranking.get(scenario.id) || 0;
          const scenarioStageLabel = scenario.relevantWarningCount > 0
            ? 'در مرحله رفع هشدار'
            : workflow.votingOpen
              ? 'آماده دریافت رای پرسنل'
              : workflow.comparisonStartedAt
                ? 'وارد مرحله مقایسه شده'
                : 'آماده شروع مقایسه';

          return (
            <article
              key={scenario.id}
              className={`bg-white rounded-2xl border shadow-sm p-4 flex flex-col gap-4 transition-all ${
                isSelected ? `${meta.accentBorder} ring-4 ${meta.scoreRing}` : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-black px-2.5 py-1 rounded-full bg-slate-900 text-white">برنامه {scenario.scenarioKey}</span>
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${meta.softBadge}`}>{scenario.shortTitle}</span>
                    {workflow.comparisonStartedAt && rank > 0 && (
                      <span className="text-[10px] font-black px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700 inline-flex items-center gap-1">
                        <Trophy className="w-3 h-3" /> رتبه {rank}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-slate-900">
                    {scenarioIcon(scenario.type)}
                    <h4 className="text-sm font-black">{scenario.title}</h4>
                  </div>
                  <div className="text-[11px] font-bold text-slate-500">{scenarioStageLabel}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] font-black text-slate-500">درخواست</div>
                  <div className="text-sm font-black text-slate-900">{scenario.weights.request}%</div>
                </div>
                <div>
                  <div className="text-[10px] font-black text-slate-500">عدالت</div>
                  <div className="text-sm font-black text-slate-900">{scenario.weights.fairness}%</div>
                </div>
                <div>
                  <div className="text-[10px] font-black text-slate-500">بهینه‌سازی</div>
                  <div className="text-sm font-black text-slate-900">{scenario.weights.optimization}%</div>
                </div>
              </div>

              {workflow.comparisonStartedAt && (
                <div className="space-y-2">
                  {[
                    { label: 'اجرای درخواست‌ها', value: scenario.metrics.requestScore },
                    { label: 'عدالت شیفت و ساعت', value: scenario.metrics.fairnessScore },
                    { label: 'رضایت پرسنل', value: scenario.metrics.satisfactionScore },
                  ].map((item) => (
                    <div key={`${scenario.id}-${item.label}`} className="space-y-1">
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

              <div className="rounded-2xl border border-slate-100 bg-white p-3 space-y-2">
                <div className="flex items-center gap-2 text-[11px] font-black text-slate-700">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  نقاط قوت برجسته
                </div>
                <div className="space-y-2 text-[11px] font-bold text-slate-600 leading-6">
                  {scenario.strengths.slice(0, 2).map((strength, index) => (
                    <div key={`${scenario.id}-strength-${index}`} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-1 shrink-0" />
                      <span>{strength}</span>
                    </div>
                  ))}
                  {scenario.strengths.length === 0 && (
                    <div className="text-slate-400">هنوز نکته شاخصی برای نمایش ثبت نشده است.</div>
                  )}
                </div>
              </div>

              <div className="mt-auto space-y-3 pt-2 border-t border-slate-100">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectScenario(scenario.id)}
                    className={`flex-1 min-w-[120px] text-xs font-black px-3 py-2.5 rounded-xl transition-all border ${
                      isSelected ? `${meta.button} text-white border-transparent` : `bg-white ${meta.buttonSoft}`
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Eye className="w-4 h-4" />
                      {isSelected ? 'در جدول فعال است' : 'نمایش در جدول'}
                    </span>
                  </button>
                </div>

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
                          <StarRating value={userRating} onVote={(rating) => onVote(scenario.id, rating)} />
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
                    onClick={() => onFinalize(scenario)}
                    className="w-full text-xs font-black px-3 py-3 rounded-xl text-white bg-slate-900 hover:bg-black transition-all"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Lock className="w-4 h-4" />
                      تایید نهایی و قفل این برنامه
                    </span>
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
