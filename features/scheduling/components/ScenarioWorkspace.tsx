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
  onOpenWarnings: (scenario: ScoredSchedule) => void;
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
    scoreBar: 'bg-indigo-500',
    stageDot: 'bg-indigo-500',
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
    scoreBar: 'bg-emerald-500',
    stageDot: 'bg-emerald-500',
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

function stageState(workflow: ScenarioWorkflowView, warningsResolved: boolean) {
  return [
    { label: 'تولید برنامه‌ها', active: workflow.scenarios.length > 0 },
    { label: 'رفع هشدارها', active: warningsResolved },
    { label: 'امتیازدهی سیستم', active: !!workflow.comparisonStartedAt },
    { label: 'نظرسنجی پرسنل', active: !!workflow.votingOpen },
  ];
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
    onOpenWarnings,
    onStartComparison,
    onToggleVoting,
    onFinalize,
    onVote,
  } = props;

  const meta = groupMeta[group];
  const warningsResolved = workflow.scenarios.length > 0 && workflow.scenarios.every((scenario) => scenario.relevantWarningCount === 0);
  const ranking = rankScenarios(workflow.scenarios);
  const stages = stageState(workflow, warningsResolved);
  const validProgramsLabel = `${workflow.scenarios.length} برنامه معتبر`;

  return (
    <section className={`bg-gradient-to-r ${meta.surface} border ${meta.border} rounded-3xl shadow-sm overflow-hidden print:hidden`} dir="rtl">
      <div className="px-5 py-5 border-b border-slate-200/80 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-3 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[11px] font-black px-3 py-1 rounded-full ${meta.badge}`}>{meta.label}</span>
            <h3 className="text-base font-black text-slate-900">کارتابل مقایسه برنامه‌های پیشنهادی</h3>
            {workflow.comparisonStartedAt && (
              <span className={`text-[10px] font-black px-2.5 py-1 rounded-full border ${meta.softBadge}`}>
                امتیازدهی سیستم فعال است
              </span>
            )}
            {workflow.votingOpen && (
              <span className="text-[10px] font-black px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700">
                نظرسنجی پرسنل باز است
              </span>
            )}
          </div>

          <p className="text-xs font-bold text-slate-600 leading-6 max-w-4xl">
            در این بخش برنامه‌های پیشنهادی به‌صورت کارت‌های فشرده و حرفه‌ای نمایش داده می‌شوند. با انتخاب هر کارت، همان برنامه در جدول اصلی دیده می‌شود؛ بنابراین داشبورد شلوغ نمی‌شود و مقایسه هم شفاف می‌ماند.
          </p>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-[10px] font-black text-slate-500 mb-1">خروجی فعلی</div>
                <div className="text-sm font-black text-slate-900">{validProgramsLabel}</div>
                <div className="text-[11px] font-bold text-slate-500 mt-1">سامانه فقط برنامه‌های معتبر و متمایز را نمایش می‌دهد.</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-[10px] font-black text-slate-500 mb-1">سقف هشدار سخت برای ساخت</div>
                <div className="text-sm font-black text-slate-900">کمتر از ۵ مورد</div>
                <div className="text-[11px] font-bold text-slate-500 mt-1">برنامه‌ای که ۰ تا ۴ هشدار سخت داشته باشد همچنان ساخته و نمایش داده می‌شود.</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-[10px] font-black text-slate-500 mb-1">وضعیت هشدارها</div>
                <div className={`text-sm font-black ${warningsResolved ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {warningsResolved ? 'همه هشدارها رفع شده‌اند' : 'رفع هشدارها هنوز ادامه دارد'}
                </div>
                <div className="text-[11px] font-bold text-slate-500 mt-1">تا صفر شدن هشدارها، امتیازدهی شروع نمی‌شود.</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                <div className="text-[10px] font-black text-slate-500 mb-1">مرحله جاری</div>
                <div className="text-sm font-black text-slate-900">
                  {workflow.votingOpen ? 'نظرسنجی پرسنل' : workflow.comparisonStartedAt ? 'مقایسه و امتیازدهی' : warningsResolved ? 'آماده شروع امتیازدهی' : 'در حال رفع هشدار'}
                </div>
                <div className="text-[11px] font-bold text-slate-500 mt-1">سرپرستار هر زمان بخواهد می‌تواند مرحله بعد را آغاز کند.</div>
              </div>
            </div>

          <div className="rounded-2xl border border-white/80 bg-white/70 px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              {stages.map((stage, index) => (
                <div key={`${group}-stage-${stage.label}`} className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${stage.active ? meta.stageDot : 'bg-slate-300'}`}></span>
                    <span className={`text-[11px] font-black ${stage.active ? 'text-slate-900' : 'text-slate-400'}`}>
                      {index + 1}. {stage.label}
                    </span>
                  </div>
                  {index < stages.length - 1 && <span className="w-8 h-px bg-slate-300"></span>}
                </div>
              ))}
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
              ابتدا هشدارهای هر برنامه را به‌صورت واقعی برطرف کنید. تا زمانی که برای همه برنامه‌های این گروه تعداد هشدارها به صفر نرسد، مقایسه و امتیازدهی سیستم آغاز نخواهد شد.
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
          const pairwiseText = scenario.pairwiseDifference
            ? Object.entries(scenario.pairwiseDifference).map(([key, value]) => `${key}: ${value.toFixed(1)}٪`).join(' • ')
            : null;
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

                <div className="text-left" dir="ltr">
                  <div className="text-[10px] font-bold text-slate-400">Diff</div>
                  <div className="text-sm font-black text-slate-900">{pairwiseText ? pairwiseText : '—'}</div>
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

              <div className="grid grid-cols-3 gap-2">
                <div className="border border-slate-100 rounded-xl p-3 bg-slate-50">
                  <div className="text-[10px] font-black text-slate-500">کل هشدارها</div>
                  <div className={`text-lg font-black ${scenario.relevantWarningCount === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>{scenario.relevantWarningCount}</div>
                </div>
                <div className="border border-slate-100 rounded-xl p-3 bg-slate-50">
                  <div className="text-[10px] font-black text-slate-500">هشدارهای سخت</div>
                  <div className={`text-lg font-black ${scenario.relevantHardWarningCount === 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{scenario.relevantHardWarningCount}</div>
                </div>
                <div className="border border-slate-100 rounded-xl p-3 bg-slate-50">
                  <div className="text-[10px] font-black text-slate-500">امتیاز کل سیستم</div>
                  <div className="text-lg font-black text-slate-900">{workflow.comparisonStartedAt ? `${scenario.totalScore.toFixed(1)}٪` : '—'}</div>
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
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => onOpenWarnings(scenario)}
                      className="text-xs font-black px-3 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-all"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <MessageSquareWarning className="w-4 h-4" />
                        بررسی هشدارها
                      </span>
                    </button>
                  )}
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
