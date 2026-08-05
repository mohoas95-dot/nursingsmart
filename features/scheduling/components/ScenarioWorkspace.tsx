'use client';

import React from 'react';
import type { JobGroup, MonthlySchedule, Personnel } from '../../../lib/types';
import type { ScoredSchedule } from '../../../lib/scoring';
import { getShiftLabel, toPersianDigits } from '../../../lib/persian-vocabulary';
import { computeBaselineCellDiffs } from '../../../domain/scenarios/objective';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Edit,
  Eye,
  GitCompareArrows,
  Info,
  Lock,
  Play,
  Star,
  Trophy,
  Users,
  X,
} from 'lucide-react';

/** کلید گزینهٔ «برنامهٔ مبنا» در رأی‌گیری. */
export const BASELINE_OPTION_KEY = 'baseline';

export interface ScenarioWorkflowView {
  scenarios: ScoredSchedule[];
  generationLog?: string[];
  comparisonStartedAt?: string;
  votingOpen?: boolean;
  /** کلید گزینه‌هایی که سرپرستار برای رأی‌گیری انتخاب کرده ('baseline' + id سناریوها). */
  voteOptions?: string[];
}

interface ScenarioWorkspaceProps {
  group: JobGroup;
  /** 'manage' = پنل سرپرستار (فشرده)؛ 'vote' = کادر سادهٔ رأی‌گیری پرسنل. */
  mode: 'manage' | 'vote';
  workflow: ScenarioWorkflowView;
  /** کلید گزینهٔ فعال (null یا 'baseline' = برنامهٔ مبنا). */
  selectedOptionKey: string | null;
  canManage: boolean;
  currentUserId: string | null;
  /** آرا: optionKey → userId → امتیاز. */
  votes: Record<string, Record<string, number>>;
  baselineSchedule?: MonthlySchedule | null;
  personnel?: readonly Personnel[];
  onSelectOption: (optionKey: string | null) => void;
  onStartComparison: () => void;
  onRequestStartVoting: () => void;
  onToggleVoting: () => void;
  onFinalize: (scenario: ScoredSchedule) => void;
  onVoteOption: (optionKey: string, rating: number) => void | Promise<void>;
}

function StarRating({ value, onVote, size = 'md' }: { value: number; onVote?: (rating: number) => void; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'w-3.5 h-3.5' : 'w-5 h-5';
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
          onVote(event.clientX < rect.left + rect.width / 2 ? i - 0.5 : i);
        }}
        dir="ltr"
      >
        <Star className={`${dim} ${isFull ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}`} />
        {isHalf && (
          <div className="absolute inset-y-0 left-0 overflow-hidden w-1/2">
            <Star className={`${dim} text-amber-400 fill-amber-400`} />
          </div>
        )}
      </div>
    );
  }
  return <div className="flex items-center gap-0.5" dir="ltr">{stars}</div>;
}

const groupMeta = {
  nurse: {
    label: 'پرستاران', surface: 'from-indigo-50 via-white to-blue-50', border: 'border-indigo-200', accentBorder: 'border-indigo-300',
    badge: 'bg-indigo-600 text-white', softBadge: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    button: 'bg-indigo-600 hover:bg-indigo-700', buttonSoft: 'border-indigo-200 text-indigo-700 hover:bg-indigo-50',
    tabActive: 'bg-indigo-600 text-white border-indigo-600 shadow-sm', tabInactive: 'bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50',
  },
  assistant: {
    label: 'کمک‌بهیاران', surface: 'from-emerald-50 via-white to-teal-50', border: 'border-emerald-200', accentBorder: 'border-emerald-300',
    badge: 'bg-emerald-600 text-white', softBadge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    button: 'bg-emerald-600 hover:bg-emerald-700', buttonSoft: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50',
    tabActive: 'bg-emerald-600 text-white border-emerald-600 shadow-sm', tabInactive: 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50',
  },
} as const;

function scenarioIcon(type: ScoredSchedule['type']) {
  if (type === 'REQUESTS') return <Users className="w-3.5 h-3.5" />;
  if (type === 'FAIRNESS') return <Activity className="w-3.5 h-3.5" />;
  return <BarChart3 className="w-3.5 h-3.5" />;
}

function scoreBarColor(score: number) {
  if (score >= 85) return 'bg-emerald-500';
  if (score >= 70) return 'bg-amber-500';
  return 'bg-rose-500';
}

interface OptionInfo {
  key: string;
  isBaseline: boolean;
  scenario?: ScoredSchedule;
  schedule: MonthlySchedule | null;
}

/** ساخت فهرست گزینه‌ها: مبنا + سناریوها. */
function buildOptions(workflow: ScenarioWorkflowView, baselineSchedule: MonthlySchedule | null): OptionInfo[] {
  const options: OptionInfo[] = [];
  if (baselineSchedule) {
    options.push({ key: BASELINE_OPTION_KEY, isBaseline: true, schedule: baselineSchedule });
  }
  for (const scenario of workflow.scenarios) {
    options.push({ key: String(scenario.id), isBaseline: false, scenario, schedule: scenario.schedule });
  }
  return options;
}

/** کلید گزینه‌هایی که به رأی گذاشته می‌شوند (انتخاب سرپرستار؛ پیش‌فرض همه). */
function effectiveVoteOptions(workflow: ScenarioWorkflowView, options: OptionInfo[]): string[] {
  const selected = workflow.voteOptions && workflow.voteOptions.length > 0
    ? workflow.voteOptions
    : options.map(o => o.key);
  // فقط کلیدهایی که هنوز موجودند را نگه می‌داریم.
  const available = new Set(options.map(o => o.key));
  return selected.filter(k => available.has(k));
}

/** میانگین و تعداد آرا برای یک گزینه. */
function tallyFor(votes: Record<string, Record<string, number>>, optionKey: string): { average: number; count: number } {
  const map = votes[optionKey] || {};
  const values = Object.values(map).filter(v => typeof v === 'number' && v > 0);
  if (values.length === 0) return { average: 0, count: 0 };
  return { average: values.reduce((s, v) => s + v, 0) / values.length, count: values.length };
}

function submittedVoteForUser(
  votes: Record<string, Record<string, number>>,
  voteOptions: readonly string[],
  currentUserId: string | null
): { optionKey: string; rating: number } | null {
  if (!currentUserId) return null;
  for (const key of voteOptions) {
    const rating = votes[key]?.[currentUserId];
    if (typeof rating === 'number' && rating > 0) return { optionKey: key, rating };
  }
  return null;
}

function winningVoteOption(
  votes: Record<string, Record<string, number>>,
  voteOptions: readonly string[]
): string | null {
  let winner: string | null = null;
  let winnerTally: { average: number; count: number } = { average: -1, count: -1 };
  for (const key of voteOptions) {
    const tally = tallyFor(votes, key);
    if (
      !winner ||
      tally.average > winnerTally.average ||
      (Math.abs(tally.average - winnerTally.average) < 0.001 && tally.count > winnerTally.count)
    ) {
      winner = key;
      winnerTally = tally;
    }
  }
  return winner;
}

/**
 * آیا برنامهٔ شیفت‌های این پرسنل در همهٔ گزینه‌های رأی‌گیری یکی (ثابت) است؟
 * برای پرسنل قفل‌شده/بدون‌تغییر ⇒ حق رأی ندارد.
 */
function isPersonnelScheduleFixed(
  userId: string | null,
  voteOptions: string[],
  options: OptionInfo[],
  personnel: readonly Personnel[] | undefined,
  totalDays: number
): boolean {
  if (!userId || voteOptions.length < 2) return false;
  const person = (personnel || []).find(p => p.id === userId);
  if (!person) return false;
  const optionSchedules = voteOptions
    .map(k => options.find(o => o.key === k)?.schedule)
    .filter((s): s is MonthlySchedule => !!s);
  if (optionSchedules.length < 2) return false;
  const first = optionSchedules[0].assignments[userId] || {};
  for (let i = 1; i < optionSchedules.length; i += 1) {
    const row = optionSchedules[i].assignments[userId] || {};
    for (let day = 1; day <= totalDays; day += 1) {
      if ((first[day] || 'OFF') !== (row[day] || 'OFF')) return false;
    }
  }
  return true;
}

export function ScenarioWorkspace(props: ScenarioWorkspaceProps) {
  const {
    group, mode, workflow, selectedOptionKey, canManage, currentUserId, votes,
    baselineSchedule, personnel,
    onSelectOption, onStartComparison, onRequestStartVoting, onToggleVoting, onFinalize, onVoteOption,
  } = props;

  const meta = groupMeta[group];
  const options = React.useMemo(() => buildOptions(workflow, baselineSchedule || null), [workflow, baselineSchedule]);
  const voteOptions = React.useMemo(() => effectiveVoteOptions(workflow, options), [workflow, options]);

  const totalDays = React.useMemo(() => {
    let max = 31;
    for (const opt of options) {
      if (!opt.schedule) continue;
      for (const row of Object.values(opt.schedule.assignments || {})) {
        for (const d of Object.keys(row)) max = Math.max(max, Number(d));
      }
    }
    return max;
  }, [options]);

  const userScheduleFixed = React.useMemo(
    () => isPersonnelScheduleFixed(currentUserId, voteOptions, options, personnel, totalDays),
    [currentUserId, voteOptions, options, personnel, totalDays]
  );
  const winnerKey = React.useMemo(() => winningVoteOption(votes, voteOptions), [votes, voteOptions]);
  // گزینهٔ فعال: برای پرسنل، تا وقتی خودشان گزینه‌ای را انتخاب نکنند برنامهٔ مبنا نمایش می‌ماند؛
  // پس از پایان رأی‌گیری، فقط برای افراد مشمول رأی، گزینهٔ برنده خودکار نمایش داده می‌شود.
  const defaultVoteKey = !workflow.votingOpen && !userScheduleFixed ? (winnerKey ?? BASELINE_OPTION_KEY) : BASELINE_OPTION_KEY;
  const activeKey = selectedOptionKey ?? (mode === 'vote' ? defaultVoteKey : BASELINE_OPTION_KEY);
  const activeOption = options.find(o => o.key === activeKey) || options[0] || null;

  const autoSelectedWinnerRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (mode !== 'vote' || userScheduleFixed || workflow.votingOpen || !winnerKey) return;
    if (autoSelectedWinnerRef.current === winnerKey) return;
    autoSelectedWinnerRef.current = winnerKey;
    if (selectedOptionKey !== winnerKey) onSelectOption(winnerKey);
  }, [mode, userScheduleFixed, selectedOptionKey, onSelectOption, workflow.votingOpen, winnerKey]);

  if (mode === 'vote') {
    return (
      <VotePanel
        group={group} meta={meta} workflow={workflow} options={options} voteOptions={voteOptions}
        activeKey={activeKey} activeOption={activeOption} votes={votes} currentUserId={currentUserId}
        personnel={personnel} totalDays={totalDays}
        onSelectOption={onSelectOption} onVoteOption={onVoteOption}
      />
    );
  }

  return (
    <ManagePanel
      group={group} meta={meta} workflow={workflow} options={options} voteOptions={voteOptions}
      activeKey={activeKey} activeOption={activeOption} votes={votes} canManage={canManage}
      baselineSchedule={baselineSchedule || null} personnel={personnel} totalDays={totalDays}
      onSelectOption={onSelectOption} onStartComparison={onStartComparison}
      onRequestStartVoting={onRequestStartVoting} onToggleVoting={onToggleVoting}
      onFinalize={onFinalize}
    />
  );
}

// ===========================================================================
// پنل سرپرستار (manage) — فشرده و خطی
// ===========================================================================

interface ManagePanelProps {
  group: JobGroup;
  meta: typeof groupMeta[JobGroup];
  workflow: ScenarioWorkflowView;
  options: OptionInfo[];
  voteOptions: string[];
  activeKey: string;
  activeOption: OptionInfo | null;
  votes: Record<string, Record<string, number>>;
  canManage: boolean;
  baselineSchedule: MonthlySchedule | null;
  personnel: readonly Personnel[] | undefined;
  totalDays: number;
  onSelectOption: (key: string | null) => void;
  onStartComparison: () => void;
  onRequestStartVoting: () => void;
  onToggleVoting: () => void;
  onFinalize: (scenario: ScoredSchedule) => void;
}

function ManagePanel(props: ManagePanelProps) {
  const { group, meta, workflow, options, voteOptions, activeKey, activeOption, votes, canManage,
    baselineSchedule, personnel, totalDays,
    onSelectOption, onStartComparison, onRequestStartVoting, onToggleVoting, onFinalize } = props;

  const [showDiffModal, setShowDiffModal] = React.useState(false);

  const countReason = React.useMemo<string | null>(() => {
    const count = workflow.scenarios.length;
    if (count >= 3) return null;
    const log = workflow.generationLog || [];
    const diag = log.length > 0 ? log[log.length - 1] : '';
    if (count === 0) return 'هیچ بدیلِ بدون‌هشداری یافت نشد.';
    return diag || 'سایر نامزدها یا هشدار بحرانی داشتند یا تکراری بودند.';
  }, [workflow.scenarios.length, workflow.generationLog]);

  const targetIds = React.useMemo(
    () => (personnel || []).filter(p => p.active && p.jobGroup === group).map(p => p.id),
    [personnel, group]
  );
  const liveSimilarityById = React.useMemo(() => {
    const map = new Map<string, number>();
    if (!baselineSchedule || targetIds.length === 0) return map;
    const totalCells = targetIds.length * totalDays;
    for (const opt of options) {
      if (!opt.schedule || opt.isBaseline) continue;
      const diffCount = computeBaselineCellDiffs(baselineSchedule, opt.schedule, targetIds, totalDays).length;
      map.set(opt.key, Number((100 * (1 - diffCount / Math.max(1, totalCells))).toFixed(2)));
    }
    return map;
  }, [baselineSchedule, targetIds, totalDays, options]);

  const similarityOf = (key: string): number => {
    if (key === BASELINE_OPTION_KEY) return 100;
    return liveSimilarityById.get(key) ?? (options.find(o => o.key === key)?.scenario?.baselineSimilarityPercent ?? 0);
  };

  const ranking = React.useMemo(() => {
    const ranked = [...options].filter(o => !o.isBaseline).sort((a, b) => similarityOf(b.key) - similarityOf(a.key));
    const map = new Map<string, number>();
    ranked.forEach((o, i) => map.set(o.key, i + 1));
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, liveSimilarityById]);

  if (!activeOption) return null;

  const activeSimilarity = similarityOf(activeKey);
  const activeRank = activeOption.isBaseline ? 0 : (ranking.get(activeKey) || 0);
  const tally = tallyFor(votes, activeKey);

  return (
    <section className={`bg-gradient-to-r ${meta.surface} border ${meta.border} rounded-2xl shadow-sm print:hidden`} dir="rtl">
      {/* نوار عنوان فشرده/خطی */}
      <div className="px-4 py-3 border-b border-slate-200/80 flex flex-wrap items-center gap-2 justify-between">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${meta.badge}`}>{meta.label}</span>
          <h3 className="text-xs font-black text-slate-800">کارتابل مقایسه برنامه‌ها</h3>
          {workflow.votingOpen
            ? <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-200">رأی‌گیری فعال</span>
            : workflow.comparisonStartedAt
              ? <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">آماده رأی‌گیری</span>
              : <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">مرور سناریوها</span>}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button type="button" onClick={() => onSelectOption(BASELINE_OPTION_KEY)}
            className={`text-[10px] font-black px-2.5 py-1.5 rounded-lg border ${activeKey === BASELINE_OPTION_KEY ? `${meta.button} text-white border-transparent` : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>
            برنامه مبنا
          </button>
          {options.filter(o => !o.isBaseline).map(opt => {
            const sc = opt.scenario!;
            const sel = activeKey === opt.key;
            return (
              <button key={opt.key} type="button" onClick={() => onSelectOption(opt.key)}
                className={`text-[10px] font-black px-2.5 py-1.5 rounded-lg border inline-flex items-center gap-1 ${sel ? `${meta.button} text-white border-transparent` : meta.tabInactive}`}>
                {scenarioIcon(sc.type)} برنامه {sc.scenarioKey}
              </button>
            );
          })}
        </div>
      </div>

      {/* خلاصهٔ گزینهٔ فعال + کنش‌ها، در یک نوار خطی */}
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200/70 bg-white/60 text-[11px]">
        <span className="font-black text-slate-700">{activeOption.isBaseline ? 'برنامه مبنا' : activeOption.scenario?.title}</span>
        {!activeOption.isBaseline && (
          <span className="font-bold text-slate-500">شباهت به مبنا: {toPersianDigits(activeSimilarity.toFixed(1))}٪</span>
        )}
        {workflow.comparisonStartedAt && activeRank > 0 && (
          <span className="font-black text-amber-700 inline-flex items-center gap-1"><Trophy className="w-3 h-3" /> رتبه {toPersianDigits(activeRank)}</span>
        )}
        {tally.count > 0 && (
          <span className="font-black text-slate-700 inline-flex items-center gap-1"><Star className="w-3 h-3 text-amber-400 fill-amber-400" /> {toPersianDigits(tally.average.toFixed(1))} ({toPersianDigits(tally.count)} رای)</span>
        )}

        <div className="flex items-center gap-1.5 mr-auto">
          <button type="button" onClick={() => onSelectOption(activeKey)} disabled={!activeOption.isBaseline && activeKey === BASELINE_OPTION_KEY}
            className="text-[10px] font-black px-2.5 py-1.5 rounded-lg border bg-white border-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1">
            <Eye className="w-3.5 h-3.5" /> {activeKey === BASELINE_OPTION_KEY ? 'نمایش مبنا در جدول' : 'نمایش در جدول'}
          </button>
          <button type="button" onClick={() => setShowDiffModal(true)} disabled={!baselineSchedule || activeOption.isBaseline}
            className="text-[10px] font-black px-2.5 py-1.5 rounded-lg border bg-white border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1">
            <GitCompareArrows className="w-3.5 h-3.5" /> تفاوت با مبنا
          </button>
        </div>
      </div>



      {canManage && countReason && (
        <div className="px-4 py-2 flex items-center gap-2 text-[11px] font-bold text-sky-900 bg-sky-50/80 border-b border-slate-200/70">
          <Info className="w-3.5 h-3.5 text-sky-500 shrink-0" />
          <span><span className="font-black">{workflow.scenarios.length === 0 ? 'برنامهٔ بدیلی تولید نشد. ' : `${toPersianDigits(workflow.scenarios.length)} سناریو به‌جای ۳ تولید شد. `}</span>{countReason}</span>
        </div>
      )}

      {/* کنش‌های مدیریتی سرپرستار */}
      {canManage && (
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-2 justify-between">
          <div className="text-[10px] font-bold text-slate-500">
            {workflow.votingOpen
              ? `برنامه‌های در رأی‌گیری: ${voteOptions.length === 0 ? '—' : voteOptions.map((_, i) => `گزینه ${toPersianDigits(i + 1)}`).join('، ')}`
              : (workflow.comparisonStartedAt ? 'برای شروع رأی‌گیری، برنامه‌های موردنظر را انتخاب کنید.' : 'در صورت نیاز هشدارها را بررسی کنید؛ شروع مقایسه مجاز است.')}
          </div>
          <div className="flex items-center gap-1.5">
            {canManage && workflow.scenarios.length > 0 && !workflow.comparisonStartedAt && (
              <button type="button" onClick={onStartComparison}
                className={`text-[10px] font-black px-3 py-1.5 rounded-lg text-white ${meta.button} inline-flex items-center gap-1`}>
                <GitCompareArrows className="w-3.5 h-3.5" /> شروع مقایسه
              </button>
            )}
            {canManage && workflow.comparisonStartedAt && !workflow.votingOpen && (
              <button type="button" onClick={onRequestStartVoting}
                className={`text-[10px] font-black px-3 py-1.5 rounded-lg text-white ${meta.button} inline-flex items-center gap-1`}>
                <Play className="w-3.5 h-3.5" /> شروع رأی‌گیری
              </button>
            )}
            {canManage && workflow.votingOpen && (
              <button type="button" onClick={onToggleVoting}
                className="text-[10px] font-black px-3 py-1.5 rounded-lg text-white bg-rose-600 hover:bg-rose-700 inline-flex items-center gap-1">
                پایان رأی‌گیری
              </button>
            )}
            {canManage && workflow.comparisonStartedAt && (
              <button type="button" onClick={() => activeOption.scenario && onFinalize(activeOption.scenario)}
                disabled={activeOption.isBaseline}
                className="text-[10px] font-black px-3 py-1.5 rounded-lg text-white bg-slate-900 hover:bg-black disabled:opacity-40 inline-flex items-center gap-1">
                <Lock className="w-3.5 h-3.5" /> تأیید نهایی
              </button>
            )}
          </div>
        </div>
      )}

      {/* جدول زندهٔ آرا (فشرده) */}
      {workflow.comparisonStartedAt && voteOptions.length > 0 && (
        <VoteTallyCompact voteOptions={voteOptions} options={options} votes={votes} activeKey={activeKey} onSelectOption={onSelectOption} />
      )}

      {showDiffModal && activeOption.schedule && baselineSchedule && (
        <DiffModal
          meta={meta} optionLabel={activeOption.isBaseline ? 'برنامه مبنا' : `برنامه ${activeOption.scenario?.scenarioKey}`}
          baselineSchedule={baselineSchedule} candidate={activeOption.schedule} targetIds={targetIds} totalDays={totalDays}
          personnel={personnel || []} similarityPercent={activeSimilarity} onClose={() => setShowDiffModal(false)}
        />
      )}
    </section>
  );
}

// ===========================================================================
// کادر سادهٔ رأی‌گیری پرسنل (vote)
// ===========================================================================

function VotePanel(props: {
  group: JobGroup; meta: typeof groupMeta[JobGroup]; workflow: ScenarioWorkflowView; options: OptionInfo[];
  voteOptions: string[]; activeKey: string; activeOption: OptionInfo | null; votes: Record<string, Record<string, number>>;
  currentUserId: string | null; personnel: readonly Personnel[] | undefined; totalDays: number;
  onSelectOption: (key: string | null) => void; onVoteOption: (key: string, rating: number) => void | Promise<void>;
}) {
  const { meta, workflow, options, voteOptions, activeKey, votes, currentUserId, personnel, totalDays, onSelectOption, onVoteOption } = props;

  const userFixed = React.useMemo(
    () => isPersonnelScheduleFixed(currentUserId, voteOptions, options, personnel, totalDays),
    [currentUserId, voteOptions, options, personnel, totalDays]
  );
  const label = (idx: number) => `گزینه ${toPersianDigits(idx + 1)}`;
  const submittedVote = submittedVoteForUser(votes, voteOptions, currentUserId);
  const [localSubmittedVote, setLocalSubmittedVote] = React.useState<{ optionKey: string; rating: number } | null>(null);
  const effectiveSubmittedVote = submittedVote || localSubmittedVote;
  const winnerKey = React.useMemo(() => winningVoteOption(votes, voteOptions), [votes, voteOptions]);
  const winnerLabel = winnerKey ? label(voteOptions.indexOf(winnerKey)) : null;
  const submittedLabel = effectiveSubmittedVote ? label(voteOptions.indexOf(effectiveSubmittedVote.optionKey)) : null;
  const votingEnded = !workflow.votingOpen;
  const [pendingRating, setPendingRating] = React.useState<number>(effectiveSubmittedVote?.rating || 0);
  const [isSubmittingVote, setIsSubmittingVote] = React.useState(false);

  React.useEffect(() => {
    if (submittedVote) setLocalSubmittedVote(null);
    setPendingRating((submittedVote || localSubmittedVote)?.rating || 0);
  }, [activeKey, submittedVote?.optionKey, submittedVote?.rating, localSubmittedVote?.optionKey, localSubmittedVote?.rating]);

  if (voteOptions.length === 0) {
    return (
      <section className={`bg-white border ${meta.border} rounded-2xl shadow-sm p-4 print:hidden`} dir="rtl">
        <p className="text-xs font-bold text-slate-500 text-center">در حال حاضر رأی‌گیری فعالی برای {meta.label} وجود ندارد.</p>
      </section>
    );
  }

  if (userFixed) {
    return (
      <section className={`bg-white border ${meta.border} rounded-2xl shadow-sm p-4 print:hidden`} dir="rtl">
        <div className="flex items-center gap-2 text-xs font-black text-slate-700">
          <Lock className="w-4 h-4 text-slate-400" />
          برنامهٔ شیفت‌های شما در همهٔ گزینه‌ها ثابت است؛ لذا مشمول رأی‌دادن نمی‌باشید.
        </div>
      </section>
    );
  }

  const activeTally = tallyFor(votes, activeKey);

  const confirmAndSubmitVote = async () => {
    if (votingEnded || effectiveSubmittedVote || isSubmittingVote) return;
    const rating = pendingRating || 3;
    const optionLabel = label(voteOptions.indexOf(activeKey));
    const ok = window.confirm(`آیا از ثبت رأی برای ${optionLabel} با امتیاز ${toPersianDigits(rating)} مطمئن هستید؟ پس از تأیید، رأی شما غیرقابل تغییر خواهد بود.`);
    if (!ok) return;
    setIsSubmittingVote(true);
    try {
      await onVoteOption(activeKey, rating);
      setLocalSubmittedVote({ optionKey: activeKey, rating });
    } finally {
      setIsSubmittingVote(false);
    }
  };

  return (
    <section className={`bg-white border ${meta.border} rounded-2xl shadow-sm print:hidden`} dir="rtl">
      <div className={`px-4 py-2.5 border-b border-slate-200/70 flex flex-wrap items-center gap-2 justify-between bg-gradient-to-r ${meta.surface}`}>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${meta.badge}`}>{meta.label}</span>
          <h3 className="text-xs font-black text-slate-800">رأی‌گیری برنامه‌ها</h3>
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${workflow.votingOpen ? 'bg-rose-100 text-rose-700 border-rose-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}`}>
            {workflow.votingOpen ? 'فعال' : 'پایان‌یافته'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {voteOptions.map((key, idx) => {
            const sel = key === activeKey;
            return (
              <button key={key} type="button" onClick={() => onSelectOption(key)}
                className={`text-[10px] font-black px-3 py-1.5 rounded-lg border ${sel ? `${meta.button} text-white border-transparent` : meta.tabInactive}`}>
                {label(idx)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 py-3 flex flex-wrap items-center gap-x-5 gap-y-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-black text-slate-700">به {label(voteOptions.indexOf(activeKey))} امتیاز می‌دهید:</span>
          <StarRating value={effectiveSubmittedVote ? (effectiveSubmittedVote.optionKey === activeKey ? effectiveSubmittedVote.rating : 0) : pendingRating} onVote={votingEnded || effectiveSubmittedVote ? undefined : setPendingRating} size="sm" />
          <button type="button" onClick={confirmAndSubmitVote} disabled={votingEnded || !!effectiveSubmittedVote || isSubmittingVote}
            className="text-[10px] font-black px-3 py-1.5 rounded-lg text-white bg-slate-900 hover:bg-black disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> {votingEnded ? 'رأی‌گیری تمام شد' : (effectiveSubmittedVote ? 'رأی ثبت شد' : (isSubmittingVote ? 'در حال ثبت...' : 'ثبت رای'))}
          </button>
        </div>
        {votingEnded && winnerKey ? (
          <div className="flex items-center gap-2 text-[11px] font-black text-emerald-700">
            <Trophy className="w-3.5 h-3.5" /> {winnerLabel} بیشترین رأی را آورد و تصویب شد.
          </div>
        ) : effectiveSubmittedVote ? (
          <div className="flex items-center gap-2 text-[11px] font-black text-emerald-700">
            <Lock className="w-3.5 h-3.5" /> رأی شما برای {submittedLabel} ثبت و غیرقابل تغییر شد.
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[11px] font-black text-slate-600">
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            میانگین: {toPersianDigits(activeTally.average.toFixed(1))} از ۵
            <span className="text-slate-400 font-bold">·</span>
            {toPersianDigits(activeTally.count)} رای
          </div>
        )}
        <button type="button" onClick={() => onSelectOption(activeKey)}
          className="text-[10px] font-black px-2.5 py-1.5 rounded-lg border bg-white border-slate-200 text-slate-700 hover:bg-slate-50 inline-flex items-center gap-1 mr-auto">
          <Eye className="w-3.5 h-3.5" /> نمایش این گزینه در جدول
        </button>
      </div>

      {/* میله‌های خلاصهٔ زندهٔ آرا */}
      <div className="px-4 pb-3 space-y-1.5">
        {voteOptions.map((key, idx) => {
          const t = tallyFor(votes, key);
          const pct = t.count === 0 ? 0 : (t.average / 5) * 100;
          return (
            <div key={key} className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-500 w-14">{label(idx)}</span>
              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${scoreBarColor(pct)}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-[10px] font-black text-slate-600 w-16 text-left">{t.count === 0 ? 'بدون رای' : `${toPersianDigits(t.average.toFixed(1))} · ${toPersianDigits(t.count)}`}</span>
            </div>
          );
        })}
      </div>
      <p className="px-4 pb-3 text-[10px] font-bold text-slate-400">با کلیک روی گزینه ۱، گزینه ۲ و ... همان برنامه در جدول نمایش داده می‌شود. پس از ثبت و تأیید، رأی شما غیرقابل تغییر است.</p>
    </section>
  );
}

// ===========================================================================
// جدول زندهٔ آرا (فشرده) برای پنل سرپرستار
// ===========================================================================

function VoteTallyCompact(props: { voteOptions: string[]; options: OptionInfo[]; votes: Record<string, Record<string, number>>; activeKey: string; onSelectOption: (k: string | null) => void }) {
  const { voteOptions, options, votes, activeKey, onSelectOption } = props;
  const maxAvg = Math.max(1, ...voteOptions.map(k => tallyFor(votes, k).average));
  return (
    <div className="px-4 py-2.5 border-t border-slate-200/70 bg-white/40">
      <div className="flex items-center gap-2 mb-1.5">
        <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
        <span className="text-[10px] font-black text-slate-600">جدول زندهٔ آرا</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
        {voteOptions.map((key, idx) => {
          const opt = options.find(o => o.key === key);
          const t = tallyFor(votes, key);
          const widthPct = t.count === 0 ? 0 : (t.average / 5) * 100;
          const isLeader = t.count > 0 && t.average >= maxAvg - 0.001;
          return (
            <button key={key} type="button" onClick={() => onSelectOption(key)}
              className={`text-right rounded-lg border px-2.5 py-1.5 ${activeKey === key ? 'border-slate-400 bg-white' : 'border-slate-200 bg-white/60 hover:bg-white'}`}>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-black text-slate-700">{opt?.isBaseline ? 'برنامه مبنا' : `برنامه ${opt?.scenario?.scenarioKey}`}{isLeader && t.count > 0 && ' 🏆'}</span>
                <span className="text-[10px] font-black text-slate-500">{t.count === 0 ? '—' : `${toPersianDigits(t.average.toFixed(1))}`}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${scoreBarColor(widthPct)}`} style={{ width: `${widthPct}%` }} />
              </div>
              <div className="text-[9px] font-bold text-slate-400 mt-0.5">{toPersianDigits(t.count)} رای</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ===========================================================================
// پنجرهٔ تفاوت با مبنا
// ===========================================================================

function DiffModal(props: {
  meta: typeof groupMeta[JobGroup]; optionLabel: string; baselineSchedule: MonthlySchedule; candidate: MonthlySchedule;
  targetIds: string[]; totalDays: number; personnel: readonly Personnel[]; similarityPercent: number; onClose: () => void;
}) {
  const { optionLabel, baselineSchedule, candidate, targetIds, totalDays, personnel, similarityPercent, onClose } = props;
  const diffs = React.useMemo(() => computeBaselineCellDiffs(baselineSchedule, candidate, targetIds, totalDays), [baselineSchedule, candidate, targetIds, totalDays]);
  const byPersonnel = React.useMemo(() => {
    const map = new Map<string, typeof diffs>();
    for (const d of diffs) { const l = map.get(d.personnelId) || []; l.push(d); map.set(d.personnelId, l); }
    return map;
  }, [diffs]);
  const name = (id: string) => { const p = personnel.find(x => x.id === id); return p ? `${p.firstName} ${p.lastName}` : id; };
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 print:hidden animate-fade-in" dir="rtl" onClick={onClose}>
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-black text-slate-800 flex items-center gap-2"><GitCompareArrows className="w-4 h-4 text-indigo-600" /> تفاوت {optionLabel} با برنامه مبنا</h4>
            <p className="text-[11px] font-bold text-slate-500 mt-1">
              {diffs.length === 0 ? 'بدون تغییر — دقیقاً مشابه برنامهٔ مبنا' : `${toPersianDigits(diffs.length)} سلول تغییر یافته · ${toPersianDigits(similarityPercent.toFixed(1))}٪ شباهت`}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 border border-slate-200 rounded-xl p-2 bg-white cursor-pointer" title="بستن"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 bg-slate-50">
          {diffs.length === 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-emerald-800 text-sm font-black text-center">این برنامه هیچ تفاوتی با برنامهٔ مبنا ندارد.</div>
          ) : (
            <div className="space-y-4">
              {[...byPersonnel.entries()].map(([pid, ds]) => (
                <div key={pid} className="bg-white border border-slate-200 rounded-2xl p-4">
                  <div className="text-xs font-black text-slate-800 border-b border-slate-100 pb-2 mb-2">{name(pid)}<span className="text-[10px] font-bold text-slate-400 mr-2">· {toPersianDigits(ds.length)} تغییر</span></div>
                  <div className="flex flex-wrap gap-1.5">
                    {[...ds].sort((a, b) => a.day - b.day).map((d) => (
                      <div key={`${pid}-${d.day}`} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-black">
                        <span className="text-slate-500">روز {toPersianDigits(d.day)}</span>
                        <span className="text-slate-400 line-through">{getShiftLabel(d.baselineShift)}</span>
                        <span className="text-slate-300">←</span>
                        <span className="text-indigo-700">{getShiftLabel(d.candidateShift)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
