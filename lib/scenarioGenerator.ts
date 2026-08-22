/**
 * Scenario Generator — معماری مبنامحور (Baseline-Oriented) — نسخهٔ عمیق‌تر
 * =======================================================================
 *
 * سناریوها «پیشنهادهای بهینه‌شده بر پایهٔ برنامهٔ مبنا» هستند: نزدیک به مبنا،
 * بدون هشدار بحرانی، و در صورت امکان پاک‌تر/درخواست‌پسندتر. موتور solver و تمام
 * قوانین (پوشش، سرشیفت، ساعات، قفل‌ها) بدون تغییر استفاده می‌شوند.
 *
 * چرا این نسخه بازنویسی شد؟ نسخهٔ پیشین تمام نامزدها را به همان یک پیکربندیِ مبنا
 * فرومی‌ریخت، چون: ۱) تغییرات کوچکِ تصادفی توسط reconcile برگردانده می‌شد یا از
 * آستانهٔ تمایز کمتر بود، و ۲) خودِ مبنا به‌عنوان «سناریو» لحاظ می‌شد.
 *
 * ریشه‌یابی تجربی نشان داد تنها **تعویض‌های حفظ‌کنندهٔ پوشش (coverage-preserving
 * row-swaps)** در reconcile دوام می‌آورند: اگر دو پرسنلِ گروه هدف، شیفت‌های روزهای
 * یک بازه را با هم عوض کنند، چندتاییِ شیفت‌های هر روز دست‌نخورده می‌ماند و موتور
 * جبران چیزی برای برگرداندن ندارد. این مکانیزمِ تولیدِ تنوع است.
 *
 * خط‌لوله:
 *   ۱) ساخت برنامهٔ مبنا (تأییدشده).
 *   ۲) تولید نامزدهای متمایز (row-swap با طیفِ اندازهٔ متفاوت + نامزدهای درخواست‌محور).
 *   ۳) تعمیر واقعی هشدارهای سطح A.
 *   ۴) فیلتر کیفیت (سطح A یا فاصلهٔ زیاد).
 *   ۵) رتبه‌بندی بر اساس: شباهت ← کمترین هشدار غیربحرانی ← بیشترین درخواست.
 *   ۶) انتخاب حداکثر ۳ سناریوی متمایز (و متمایز از مبنا).
 */

import { generateJalaliMonthCalendar } from './jalali';
import { verifyCoverageAndLeaders } from './solver';
import { reconcileStaffingCoverage } from '../domain/scheduling/staffing-coverage';
import { repairScheduleBeforeWarnings } from '../domain/scheduling/repair-orchestrator';
import {
  COVERAGE_FILL_HARD_RULES,
  evaluateHardConstraintLegality,
} from '../domain/scheduling/hard-constraints';
import {
  canonicalizeRequestDaysForMonth,
  type CanonicalRequestMonthResult,
} from '../domain/requests/request-canonicalizer';
import { adaptCanonicalRequestMonthForSolver } from '../domain/requests/solver-request-adapter';
import {
  buildRequestOutcomeLedger,
  prioritizeRequestDeficienciesForCandidate,
} from '../domain/requests/request-outcome-ledger';
import { evaluateCanonicalRequestDay } from '../domain/requests/request-outcome-evaluator';
import { buildRequestQualityFromLedger } from '../domain/requests/request-quality';
import { buildRequestSetFingerprint } from '../domain/requests/request-set-fingerprint';
import { replaceRequestWarningsFromLedger } from '../domain/requests/request-warning-projection';
import type {
  CanonicalRequestDay,
  RequestResolutionProvenance,
} from '../domain/requests/request-domain';
import {
  JobGroup,
  MonthlySchedule,
  Personnel,
  ShiftRequest,
  ShiftType,
  SystemSettings,
} from './types';
import {
  filterStructuredWarningsForScenarioGroup,
  SCENARIO_KEYS,
  SCENARIO_TITLES,
  type ScoredSchedule,
  type ScenarioType,
} from './scoring';
import {
  areScenariosDistinctEnough,
  compareByObjective,
  compareRepairQuality,
  countCriticalWarnings,
  isScenarioAcceptable,
  type ObjectiveRankable,
  type ScenarioObjective,
} from '../domain/scenarios/objective';
import {
  evaluateScenarioQuality,
  MAX_BASELINE_DIFFERENCE_PERCENT,
  MIN_DIFFERENCE_FROM_BASELINE_PERCENT,
  MIN_DISTINCT_DIFFERENCE_PERCENT,
} from '../domain/scenarios/scenario-quality';
import {
  countCriticalScheduleWarnings,
  warningMessages,
  type ScheduleWarning,
} from '../domain/warnings/schedule-warning';

// ---------------------------------------------------------------------------
// قراردادهای عمومی (امضاهای عمومی بدون تغییر برای سازگاری با app/page.tsx)
// ---------------------------------------------------------------------------

export interface EvaluatedScenario {
  schedule: MonthlySchedule;
  score: ScoredSchedule;
}

export interface ScenarioGenerationResult {
  all: ScoredSchedule[];
  top3: ScoredSchedule[];
  generationLog: string[];
  durationMs: number;
  targetPersonnelCount: number;
}

export interface ScenarioProgressEvent {
  stage: 'prepare' | 'scenario' | 'scoring';
  scenarioIndex?: number;
  scenarioCount: number;
  scenarioType?: ScenarioType;
  fraction: number;
}

export interface ScenarioGenerationOptions {
  year: number;
  month: number;
  personnelList: readonly Personnel[];
  requests: readonly ShiftRequest[];
  settings: SystemSettings;
  customHolidays: Readonly<Record<number, string>>;
  firstDayOfWeekIndex?: number;
  monthlyDutyHours?: any;
  targetJobGroup?: JobGroup;
  /** برنامهٔ مبنا (Working Roster). تنها منبع حقیقت و نقطهٔ آغاز سناریوها. */
  currentAssignments?: Record<string, Record<number, ShiftType>> | null;
  lockedRows?: string[];
  onProgress?: (event: ScenarioProgressEvent) => void;
  yieldToUi?: () => Promise<void>;
  /** بودجهٔ نامزدها (پیش‌فرض ۳۶، سقف ۵۰۰). */
  candidateBudget?: number;
  /** Canonical hard-degradation evidence from the source solver, when available. */
  requestResolutionProvenance?: ReadonlyArray<RequestResolutionProvenance>;
}

// ---------------------------------------------------------------------------
// ثابت‌ها
// ---------------------------------------------------------------------------

export const MAX_SCENARIO_CANDIDATES = 500;
const DEFAULT_CANDIDATE_BUDGET = 36;
const MAX_CRITICAL_REPAIR_STEPS = 24;
const MAX_DISPLAYED_SCENARIOS = 3;

// آستانه‌های پذیرش (سقف/کف فاصله از مبنا و کمینهٔ تمایز) در فاز ۵ تغییر نکرده‌اند؛
// فقط به domain/scenarios/scenario-quality منتقل شده‌اند تا همان اعدادی که
// دروازه‌های تابع هدف کانونی را می‌سازند اینجا هم مصرف شوند (مرجع یکتا).
export {
  MAX_BASELINE_DIFFERENCE_PERCENT,
  MIN_DIFFERENCE_FROM_BASELINE_PERCENT,
  MIN_DISTINCT_DIFFERENCE_PERCENT,
};

interface ScenarioContext {
  year: number;
  month: number;
  personnelList: readonly Personnel[];
  /** Canonical one-day compatibility projection for unchanged legality/verification APIs. */
  requests: readonly ShiftRequest[];
  canonicalRequestDays: ReadonlyArray<CanonicalRequestDay>;
  canonicalRequestMonth: CanonicalRequestMonthResult;
  requestSetFingerprint: string;
  settings: SystemSettings;
  customHolidays: Readonly<Record<number, string>>;
  firstDayOfWeekIndex?: number;
  monthlyDutyHours?: any;
  targetJobGroup?: JobGroup;
  currentAssignments?: Record<string, Record<number, ShiftType>> | null;
  lockedRows: string[];
  requestResolutionProvenance: ReadonlyArray<RequestResolutionProvenance>;
  totalDays: number;
  targetPersonnel: Personnel[];
  targetPersonnelIds: string[];
  freeTargetPersonnel: Personnel[];
  freeTargetIds: string[];
  lockedIdSet: Set<string>;
  calendar: ReadonlyArray<{ day: number; dayOfWeek: number; isHoliday: boolean }>;
}

// ---------------------------------------------------------------------------
// ابزارهای خالص
// ---------------------------------------------------------------------------

function cloneAssignments(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>
): Record<string, Record<number, ShiftType>> {
  const copy: Record<string, Record<number, ShiftType>> = {};
  for (const [personnelId, days] of Object.entries(assignments)) {
    copy[personnelId] = { ...(days as Record<number, ShiftType>) };
  }
  return copy;
}

/** پرسنل قفل‌شده و گروه کاری دیگر مستقیماً از برنامهٔ مبنا ارث‌بری می‌کنند. */
function mergePreservedAssignments(
  optimized: Record<string, Record<number, ShiftType>>,
  context: ScenarioContext
): Record<string, Record<number, ShiftType>> {
  if (!context.currentAssignments) return optimized;
  const merged = cloneAssignments(optimized);
  for (const person of context.personnelList) {
    const shouldPreserve =
      context.lockedIdSet.has(person.id) ||
      (!!context.targetJobGroup && person.jobGroup !== context.targetJobGroup);
    if (!shouldPreserve) continue;
    if (context.currentAssignments[person.id]) {
      merged[person.id] = { ...(context.currentAssignments[person.id] as Record<number, ShiftType>) };
    }
  }
  return merged;
}

/**
 * MonthlySchedule + فرادادهٔ ساخت‌یافتهٔ هشدارها (درون‌خط‌لوله‌ای؛ هرگز ذخیره
 * نمی‌شود). `warnings` دقیقاً برابر `structuredWarnings.map(w => w.message)` است.
 */
export interface VerifiedSchedule extends MonthlySchedule {
  readonly structuredWarnings: ScheduleWarning[];
}

function verifyScenarioSchedule(
  assignments: Record<string, Record<number, ShiftType>>,
  context: ScenarioContext
): VerifiedSchedule {
  const calendarDays = generateJalaliMonthCalendar(
    context.year,
    context.month,
    context.customHolidays,
    context.firstDayOfWeekIndex
  ).map(day => ({ day: day.day, isHoliday: day.isHoliday, dayOfWeek: day.dayOfWeek }));
  const coverageReconciled = reconcileStaffingCoverage(
    assignments,
    context.personnelList,
    context.settings,
    calendarDays,
    context.targetJobGroup ? [context.targetJobGroup] : ['nurse', 'assistant'],
    context.lockedRows,
    context.requests,
    undefined,
    context.monthlyDutyHours
  ).assignments;
  const reconciled = repairScheduleBeforeWarnings({
    assignments: coverageReconciled,
    personnelList: context.personnelList,
    settings: context.settings,
    calendarDays,
    requests: context.requests,
    targetJobGroups: context.targetJobGroup ? [context.targetJobGroup] : ['nurse', 'assistant'],
    lockedRows: context.lockedRows,
    monthlyDutyHours: context.monthlyDutyHours,
  }).assignments;

  const verification = verifyCoverageAndLeaders(
    context.year, context.month, context.personnelList, reconciled, context.settings,
    context.customHolidays, context.firstDayOfWeekIndex, context.requests, context.monthlyDutyHours
  );

  const requestOutcomeLedger = buildRequestOutcomeLedger({
    canonicalMonth: context.canonicalRequestMonth,
    assignments: reconciled,
    provenance: context.requestResolutionProvenance,
    requestSetFingerprint: context.requestSetFingerprint,
  });
  const requestQuality = buildRequestQualityFromLedger(requestOutcomeLedger);
  // Generic verifier mismatches are replaced, not duplicated. The ledger is the
  // only request-warning authority; all non-request warning severities stay intact.
  const projectedWarnings = replaceRequestWarningsFromLedger(
    verification.structuredWarnings,
    requestOutcomeLedger,
    new Map(context.personnelList.map(person => [person.id, `${person.firstName} ${person.lastName}`]))
  );
  const relevantStructuredWarnings = filterStructuredWarningsForScenarioGroup(
    projectedWarnings,
    context.personnelList,
    context.targetJobGroup,
    context.lockedIdSet
  );

  return {
    year: context.year, month: context.month, assignments: reconciled,
    shiftLeaders: verification.shiftLeaders,
    warnings: warningMessages(relevantStructuredWarnings),
    structuredWarnings: relevantStructuredWarnings,
    requestResolutionProvenance: [...context.requestResolutionProvenance],
    requestOutcomeLedger,
    requestQuality,
    requestSetFingerprint: requestOutcomeLedger.requestSetFingerprint,
  };
}

/** نمایِ صرفِ MonthlySchedule — برای مسیرهایی که به ذخیره‌سازی/ارزیابی می‌رسند. */
function toMonthlySchedule(schedule: VerifiedSchedule): MonthlySchedule {
  return {
    year: schedule.year,
    month: schedule.month,
    assignments: schedule.assignments,
    shiftLeaders: schedule.shiftLeaders,
    warnings: schedule.warnings,
    requestResolutionProvenance: schedule.requestResolutionProvenance,
    requestOutcomeLedger: schedule.requestOutcomeLedger,
    requestQuality: schedule.requestQuality,
    requestSetFingerprint: schedule.requestSetFingerprint,
  };
}

function applyCellEdit(
  assignments: Record<string, Record<number, ShiftType>>,
  edit: { personnelId: string; day: number; shift: ShiftType }
): Record<string, Record<number, ShiftType>> {
  const next = cloneAssignments(assignments);
  if (!next[edit.personnelId]) next[edit.personnelId] = {};
  next[edit.personnelId][edit.day] = edit.shift;
  return next;
}

/**
 * ارزیابی کانونی یک سناریو — تنها مسیر امتیازدهیِ مولد.
 *
 * پیش از فاز ۵، مولد ابتدا `evaluateScenarioSchedule` را صدا می‌زد و سپس چند فیلد
 * (از جمله `totalScore`) را با اعداد شباهت‌محور بازنویسی می‌کرد. اکنون هر دو مسیر
 * تولید و ارزیابی مجدد از `evaluateScenarioQuality` عبور می‌کنند و هیچ بازنویسی‌ای
 * در کار نیست.
 */
function evaluateScenario(
  schedule: MonthlySchedule,
  scenarioType: ScenarioType,
  id: number,
  baseline: MonthlySchedule,
  context: ScenarioContext,
  structuredWarnings?: ReadonlyArray<ScheduleWarning>
): ScoredSchedule {
  return evaluateScenarioQuality({
    id, type: scenarioType, schedule, baseline, structuredWarnings,
    personnelList: context.personnelList, requests: context.requests, settings: context.settings,
    year: context.year, month: context.month, customHolidays: context.customHolidays,
    firstDayOfWeekIndex: context.firstDayOfWeekIndex, monthlyDutyHours: context.monthlyDutyHours,
    targetJobGroup: context.targetJobGroup,
    targetPersonnelIds: context.targetPersonnelIds,
    totalDays: context.totalDays,
    lockedRows: context.lockedRows,
  });
}

function buildScenarioContext(options: ScenarioGenerationOptions): ScenarioContext {
  const { year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex,
    monthlyDutyHours, targetJobGroup, currentAssignments, lockedRows = [],
    requestResolutionProvenance = [] } = options;
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const canonicalMonth = canonicalizeRequestDaysForMonth(requests, {
    year,
    month,
    calendarDays: calendar,
    personnel: personnelList,
  });
  const solverRequests = adaptCanonicalRequestMonthForSolver(canonicalMonth);
  const lockedIdSet = new Set(lockedRows);
  const targetPersonnel = personnelList.filter(person =>
    person.active
    && !lockedIdSet.has(person.id)
    && (!targetJobGroup || person.jobGroup === targetJobGroup));
  return {
    year,
    month,
    personnelList,
    requests: solverRequests.compatibilityRequests,
    canonicalRequestDays: solverRequests.requestDays,
    canonicalRequestMonth: canonicalMonth,
    requestSetFingerprint: buildRequestSetFingerprint(canonicalMonth),
    settings,
    customHolidays,
    firstDayOfWeekIndex,
    monthlyDutyHours,
    targetJobGroup,
    currentAssignments,
    lockedRows,
    requestResolutionProvenance,
    totalDays: calendar.length,
    targetPersonnel,
    targetPersonnelIds: targetPersonnel.map(person => person.id),
    freeTargetPersonnel: targetPersonnel,
    freeTargetIds: targetPersonnel.map(person => person.id),
    lockedIdSet,
    calendar,
  };
}

// ---------------------------------------------------------------------------
// برنامهٔ مبنا
// ---------------------------------------------------------------------------

function buildBaselineSchedule(context: ScenarioContext): VerifiedSchedule {
  const seed = context.currentAssignments ? cloneAssignments(context.currentAssignments) : {};
  const merged = mergePreservedAssignments(seed, context);
  return verifyScenarioSchedule(merged, context);
}

// ---------------------------------------------------------------------------
// مولد نامزدها: تعویض‌های حفظ‌کنندهٔ پوشش (تأییدشده برای بقای در reconcile)
// ---------------------------------------------------------------------------

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getAssignedShift(schedule: MonthlySchedule, personnelId: string, day: number): ShiftType {
  return schedule.assignments[personnelId]?.[day] || 'OFF';
}

/**
 * تعویضِ شیفت‌های دو پرسنلِ آزادِ گروه هدف روی یک بازه از روزها.
 * چندتاییِ شیفت‌های هر روز دست‌نخورده می‌ماند → پوشش حفظ → reconcile برگشت نمی‌زند.
 * روزهای مرخصی و روزهایی که هر دو شیفتِ یکسان دارند رد می‌شوند.
 */
function applyRowSwap(
  assignments: Record<string, Record<number, ShiftType>>,
  leftId: string,
  rightId: string,
  days: ReadonlyArray<number>
): Record<string, Record<number, ShiftType>> {
  let next = assignments;
  for (const day of days) {
    const left = next[leftId]?.[day] || 'OFF';
    const right = next[rightId]?.[day] || 'OFF';
    if (left.startsWith('L') || right.startsWith('L')) continue; // مرخصی جابه‌جا نمی‌شود
    if (left === right) continue; // تعویض بی‌اثر
    next = applyCellEdit(next, { personnelId: leftId, day, shift: right });
    next = applyCellEdit(next, { personnelId: rightId, day, shift: left });
  }
  return next;
}

/**
 * یک نامزدِ متمایز با تعویضِ حفظ‌کنندهٔ پوشش تولید می‌کند. اندازهٔ بازه با seed
 * تغییر می‌کند تا طیفی از شباهت‌ها (مثلاً ۳٪ تا ~۱۰٪ تفاوت) به‌دست آید و چندین
 * سناریوی متمایز قابل‌انتخاب شکل بگیرد.
 */
function buildDiversityCandidate(
  baseline: MonthlySchedule, seed: number, context: ScenarioContext
): VerifiedSchedule | null {
  if (context.freeTargetIds.length < 2) return null;
  const random = createSeededRandom(seed * 2654435761 + 1);
  const ids = context.freeTargetIds;
  const leftId = ids[Math.floor(random() * ids.length)];
  let rightId = ids[Math.floor(random() * ids.length)];
  if (rightId === leftId) rightId = ids[(ids.indexOf(leftId) + 1) % ids.length];

  // طیف اندازهٔ بازه: ۳ تا ۱۰ روز → تنوع شباهت.
  const rangeLength = 3 + Math.floor(random() * 8);
  const startDay = 1 + Math.floor(random() * Math.max(1, context.totalDays - rangeLength));
  const days = Array.from({ length: rangeLength }, (_, i) => startDay + i)
    .filter(day => day >= 1 && day <= context.totalDays);

  const swapped = applyRowSwap(cloneAssignments(baseline.assignments), leftId, rightId, days);
  const merged = mergePreservedAssignments(swapped, context);
  return verifyScenarioSchedule(merged, context);
}

// ---- نامزد درخواست‌محور: تعویض برای بهبود رعایت درخواست پرسنل ----------------

function candidateFullySatisfiesRequestDay(
  requestDay: CanonicalRequestDay,
  shift: ShiftType
): boolean {
  const outcome = evaluateCanonicalRequestDay(requestDay, shift);
  return outcome.kind === 'EXACT' || outcome.kind === 'COMPATIBLE';
}

/**
 * یک نامزد که تلاش می‌کند درخواستِ یکی از پرسنلِ گروه هدف را بهتر رعایت کند:
 * نفرِ دارایِ درخواست (P) با یک همگروهی (Q) روی روزهای نقضِ درخواست تعویض می‌شود،
 * به‌شرطی که شیفتِ Q در آن روزها درخواستِ P را برآورده کند. همچنان حفظ‌کنندهٔ پوشش.
 */
function buildRequestBiasedCandidate(
  baseline: MonthlySchedule, seed: number, context: ScenarioContext
): VerifiedSchedule | null {
  if (context.freeTargetIds.length < 2) return null;
  const ledger = baseline.requestOutcomeLedger;
  if (!ledger) return null;
  const priorityPool = prioritizeRequestDeficienciesForCandidate(
    ledger,
    new Set(context.freeTargetIds)
  );
  if (priorityPool.length === 0) return null;

  const random = createSeededRandom(seed * 40503 + 7);
  const eligibleRequestIds = [...new Set(priorityPool.map(outcome => outcome.requestDay.requestId))];
  const requestId = eligibleRequestIds[Math.floor(random() * eligibleRequestIds.length)];
  const violatedRequestDays = priorityPool
    .filter(outcome => outcome.requestDay.requestId === requestId)
    .map(outcome => outcome.requestDay);
  const ownerId = violatedRequestDays[0].personnelId;
  const violationDays = violatedRequestDays.map(requestDay => requestDay.day);
  const requestDayByDay = new Map(violatedRequestDays.map(requestDay => [requestDay.day, requestDay]));

  // همگروهیِ Q که شیفتش در روزهای نقض، درخواستِ P را برآورده می‌کند (و با P قابل‌تعویض است).
  const partnerId = context.freeTargetIds.find(id => {
    if (id === ownerId) return false;
    return violationDays.some(day => {
      const partnerShift = getAssignedShift(baseline, id, day);
      const requestDay = requestDayByDay.get(day)!;
      return !partnerShift.startsWith('L') && candidateFullySatisfiesRequestDay(requestDay, partnerShift);
    });
  });
  if (!partnerId) return null;

  const days = violationDays.slice(0, 10); // محدود نگه‌داشتن دامنهٔ تغییر
  const swapped = applyRowSwap(cloneAssignments(baseline.assignments), ownerId, partnerId, days);
  const merged = mergePreservedAssignments(swapped, context);
  return verifyScenarioSchedule(merged, context);
}

// ---------------------------------------------------------------------------
// تعمیر هشدارهای سطح A — مصرفِ فرادادهٔ ساخت‌یافته (نه تجزیهٔ متن نمایشی)
// ---------------------------------------------------------------------------
//
// تا پیش از این، این بخش متن فارسیِ هشدار را با regex تجزیه می‌کرد تا روز، شیفت
// و نام پرسنل را استخراج کند (`/روز (\d+)/`، `/شیفت ([A-Z]+)/`، `/نوبت (صبح|عصر|شب)/`
// و جست‌وجوی نام کامل در متن). اکنون هشدارهای ساخت‌یافتهٔ verifier مستقیماً
// day / shift / personnelId / code را در اختیار می‌گذارند و منطق تعمیر فقط از
// همین فیلدها تغذیه می‌کند. الگوریتم تعمیر (کدام سلول، با چه ترتیبی) هیچ
// تغییری نکرده است.

export interface CriticalRepairContext {
  /** پرسنل آزادِ گروه هدف که تعمیر می‌تواند روی آن‌ها اعمال شود. */
  freeTargetPersonnel: readonly Personnel[];
  totalDays: number;
  /** Optional for backwards-compatible unit tests; supplied by ScenarioContext. */
  requests?: readonly ShiftRequest[];
  calendarDays?: ReadonlyArray<{ day: number; dayOfWeek: number; isHoliday: boolean }>;
  lockedRowIds?: ReadonlySet<string>;
}

export interface CriticalRepairEdit {
  personnelId: string;
  day: number;
  shift: ShiftType;
}

function findFreeTargetById(context: CriticalRepairContext, personnelId: string | undefined): Personnel | null {
  if (!personnelId) return null;
  return context.freeTargetPersonnel.find(person => person.id === personnelId) ?? null;
}

/** Shared hard-legality gate for scenario repair edits that add work. */
function isLegalRepairWorkEdit(
  schedule: VerifiedSchedule,
  context: CriticalRepairContext,
  person: Personnel,
  day: number,
  shift: ShiftType
): boolean {
  const calendarDay = context.calendarDays?.find(item => item.day === day);
  return evaluateHardConstraintLegality(
    {
      person,
      day,
      dayOfWeek: calendarDay?.dayOfWeek,
      isHoliday: calendarDay?.isHoliday,
      candidateShift: shift,
      assignments: schedule.assignments,
      totalDays: context.totalDays,
      requests: context.requests,
      lockedRowIds: context.lockedRowIds,
    },
    COVERAGE_FILL_HARD_RULES
  ).legal;
}

/**
 * از هشدارهای ساخت‌یافتهٔ سطح A، ویرایش‌های پیشنهادیِ تعمیر را می‌سازد.
 *
 * اگر هشداری فرادادهٔ لازم (روز/شیفت/پرسنل) را نداشته باشد — مثلاً از مسیر
 * legacyای آمده باشد که هنوز ساخت‌یافته نیست — همان‌طور که پیش‌تر عدمِ تطابقِ
 * regex باعث رد شدن می‌شد، همان هشدار بدون حدس‌زدن رد می‌شود.
 */
export function generateCriticalRepairEdits(schedule: VerifiedSchedule, context: CriticalRepairContext): CriticalRepairEdit[] {
  const edits: CriticalRepairEdit[] = [];
  const seen = new Set<string>();
  const push = (edit: CriticalRepairEdit) => {
    const key = `${edit.personnelId}:${edit.day}:${edit.shift}`;
    if (!seen.has(key)) { seen.add(key); edits.push(edit); }
  };
  for (const warning of schedule.structuredWarnings) {
    switch (warning.code) {
      case 'COVERAGE_SHORTAGE': {
        const day = warning.day;
        const shiftChar = warning.shift;
        if (!day || !shiftChar) break;
        for (const person of context.freeTargetPersonnel) {
          if (getAssignedShift(schedule, person.id, day) === 'OFF'
            && isLegalRepairWorkEdit(schedule, context, person, day, shiftChar)) {
            push({ personnelId: person.id, day, shift: shiftChar });
            break;
          }
        }
        break;
      }
      case 'OVERSTAFFING': {
        const day = warning.day;
        const shiftChar = warning.shift;
        if (!day || !shiftChar) break;
        for (const person of context.freeTargetPersonnel) {
          if (getAssignedShift(schedule, person.id, day) === shiftChar) { push({ personnelId: person.id, day, shift: 'OFF' }); break; }
        }
        break;
      }
      case 'MISSING_SHIFT_LEADER': {
        const day = warning.day;
        const code = warning.shift; // صبح→M، عصر→E، شب→N — از مبدأ، نه از تجزیهٔ متن
        // برابری با مسیر legacy: regex قدیمی در متن «نوبت صبح روز تعطیل D» هیچ
        // «روز <عدد>»ی نمی‌یافت، پس هشدار سرشیفتِ صبحِ روز تعطیل هرگز ویرایشی
        // نمی‌ساخت. این رفتار (حتی اگر احتمالاً ناخواسته بوده) در این جلسه حفظ
        // می‌شود: تغییر سیاستِ تعمیر غیرمجاز است؛ فقط عصر/شب تعمیر می‌شوند.
        if (!day || !code || code === 'M') break;
        for (const person of context.freeTargetPersonnel) {
          if (person.canBeShiftLeader
            && getAssignedShift(schedule, person.id, day) === 'OFF'
            && isLegalRepairWorkEdit(schedule, context, person, day, code)) {
            push({ personnelId: person.id, day, shift: code });
            break;
          }
        }
        break;
      }
      case 'MAX_CONSECUTIVE': {
        const person = findFreeTargetById(context, warning.personnelId);
        const start = warning.day;
        const end = warning.endDay;
        if (person && start != null && end != null) {
          const clampedEnd = Math.min(end, context.totalDays);
          const mid = Math.floor((start + clampedEnd) / 2);
          for (let d = mid; d <= clampedEnd; d += 1) {
            const cur = getAssignedShift(schedule, person.id, d);
            if (cur !== 'OFF' && !cur.startsWith('L')) { push({ personnelId: person.id, day: d, shift: 'OFF' }); break; }
          }
        }
        break;
      }
      // MANDATORY_REST عمداً case ندارد: یادآور مرزی پایان ماه است (دربارهٔ ماه
      // آینده) و دیگر بحرانی نیست؛ تعمیر بحرانی نباید صرفاً به‌خاطر آن یک سلول
      // کاریِ قانونیِ ماه جاری را حذف کند. تخلف واقعی (وزن > ۵) همچنان با
      // MAX_CONSECUTIVE تعمیر می‌شود.
      default:
        // هشدارهای غیربحرانی (و کدهای ناشناخته) هرگز ویرایش تعمیر تولید نمی‌کنند.
        break;
    }
  }
  return edits;
}

function repairCriticalAlerts(candidate: VerifiedSchedule, baseline: MonthlySchedule, context: ScenarioContext): VerifiedSchedule {
  let current = candidate;
  const repairContext: CriticalRepairContext = {
    freeTargetPersonnel: context.freeTargetPersonnel,
    totalDays: context.totalDays,
    requests: context.requests,
    calendarDays: context.calendar,
    lockedRowIds: context.lockedIdSet,
  };
  // طبقه‌بندی بحرانی بر اساس کد ساخت‌یافته — نه پیشوندِ متن نمایشی.
  let criticalCount = countCriticalScheduleWarnings(current.structuredWarnings);
  for (let step = 0; step < MAX_CRITICAL_REPAIR_STEPS && criticalCount > 0; step += 1) {
    const edits = generateCriticalRepairEdits(current, repairContext);
    if (edits.length === 0) break;
    let best: VerifiedSchedule | null = null;
    let bestCritical = criticalCount;
    let bestQuality: ObjectiveRankable | null = null;
    for (const edit of edits) {
      const tried = verifyScenarioSchedule(applyCellEdit(current.assignments, edit), context);
      const triedCritical = countCriticalScheduleWarnings(tried.structuredWarnings);
      if (triedCritical > bestCritical) continue;
      if (triedCritical < bestCritical) {
        // کاهش هشدار بحرانی همیشه مقدم است — دروازهٔ سخت با کیفیت نرم معامله نمی‌شود.
        best = tried;
        bestCritical = triedCritical;
        bestQuality = scoreCandidate(tried, 'MIXED', 0, baseline, context).rankable;
        continue;
      }
      // تساوی در تعداد هشدار بحرانی: تا فاز ۴ «کمترین فاصله از مبنا» برنده بود و
      // همین، تعمیر را شباهت‌محور می‌کرد. اکنون ترجیح ثانویه دقیقاً تابع هدف
      // کانونی است (شباهت فقط در آخرین لایهٔ آن اثر دارد).
      const triedQuality = scoreCandidate(tried, 'MIXED', 0, baseline, context).rankable;
      if (bestQuality === null || compareRepairQuality(triedQuality, bestQuality) < 0) {
        best = tried;
        bestQuality = triedQuality;
      }
    }
    if (!best || bestCritical >= criticalCount) break;
    current = best;
    criticalCount = bestCritical;
  }
  return current;
}

// ---------------------------------------------------------------------------
// ارزیابی نامزد
// ---------------------------------------------------------------------------

interface ScoredCandidate {
  schedule: VerifiedSchedule;
  scored: ScoredSchedule;
  objective: ScenarioObjective;
  rankable: ObjectiveRankable;
}

/**
 * امتیازدهی نامزد بر اساس تابع هدف کانونی.
 *
 * تفاوت با فاز ۴:
 *   • دیگر `scored.totalScore` با درصد شباهت بازنویسی نمی‌شود (رفع تناقض معنایی).
 *   • شمارش نقص هشداری از `metrics.nonCriticalWarningDefectCount` می‌آید و دیگر
 *     یک نسخهٔ خصوصی و موازی در همین فایل محاسبه نمی‌شود.
 *   • دروازه‌های سخت (شامل حفظ قفل‌ها) صریحاً در `objective.gates` ثبت می‌شوند.
 */
function scoreCandidate(
  schedule: VerifiedSchedule, scenarioType: ScenarioType, id: number, baseline: MonthlySchedule, context: ScenarioContext
): ScoredCandidate {
  // نمایِ MonthlySchedule خالص برای ارزیابی/ذخیره‌سازی — فرادادهٔ ساخت‌یافته
  // فقط درون خط‌لولهٔ موتور می‌ماند و در ScoredSchedule (قابل‌ذخیره) نمی‌نشیند.
  const plainSchedule = toMonthlySchedule(schedule);
  const scored = evaluateScenario(
    plainSchedule, scenarioType, id, baseline, context, schedule.structuredWarnings
  );
  const objective = scored.objective!;
  return { schedule, scored, objective, rankable: objective.quality };
}

// ---------------------------------------------------------------------------
// فیلتر کیفیت + انتخاب
// ---------------------------------------------------------------------------

function applyQualityFilter(
  candidates: ReadonlyArray<ScoredCandidate>, baseline: MonthlySchedule, context: ScenarioContext
) {
  const survivors: ScoredCandidate[] = [];
  let droppedForCritical = 0;
  let droppedForDistance = 0;
  let droppedIdentical = 0;
  let droppedForLocks = 0;
  for (const candidate of candidates) {
    const gates = candidate.objective.gates;
    // Tier 0 — دروازه‌های سخت. هیچ امتیاز نرمی این‌ها را جبران نمی‌کند.
    if (!gates.criticalResolved) { droppedForCritical += 1; continue; }
    // حفظ قفل‌ها: تا فاز ۴ محاسبه می‌شد اما هرگز به‌عنوان دروازه بررسی نمی‌شد.
    // ساختِ نامزدها (mergePreservedAssignments) آن را تضمین می‌کند؛ این بررسی
    // همان تضمین را به یک ناوردای صریح و قابل‌حسابرسی تبدیل می‌کند.
    if (!gates.locksPreserved) { droppedForLocks += 1; continue; }
    if (!gates.withinMaxBaselineDifference) { droppedForDistance += 1; continue; }
    // سناریو باید «بدیلِ واقعی» باشد: حداقل فاصلهٔ مشخصی از مبنا داشته باشد.
    if (!gates.meetsMinBaselineDifference) { droppedIdentical += 1; continue; }
    // ناوردای مضاعف: پرچم‌های بالا باید با گزارهٔ پذیرش کانونی یکی باشند.
    if (!isScenarioAcceptable(gates)) { droppedForCritical += 1; continue; }
    survivors.push(candidate);
  }
  return { survivors, droppedForCritical, droppedForDistance, droppedIdentical, droppedForLocks };
}

interface FilterStats {
  survivors: ScoredCandidate[];
  droppedForCritical: number;
  droppedForDistance: number;
  droppedIdentical: number;
  droppedForLocks: number;
}

const EMPTY_FILTER_STATS: FilterStats = {
  survivors: [], droppedForCritical: 0, droppedForDistance: 0, droppedIdentical: 0, droppedForLocks: 0,
};

function selectTopScenarios(survivors: ReadonlyArray<ScoredCandidate>, context: ScenarioContext): ScoredCandidate[] {
  const ranked = [...survivors].sort((left, right) => compareByObjective(left.rankable, right.rankable));
  const selected: ScoredCandidate[] = [];
  for (const candidate of ranked) {
    if (selected.length >= MAX_DISPLAYED_SCENARIOS) break;
    const distinctFromAll = selected.every(chosen =>
      areScenariosDistinctEnough(chosen.schedule, candidate.schedule, context.targetPersonnelIds, context.totalDays, MIN_DISTINCT_DIFFERENCE_PERCENT));
    if (distinctFromAll) selected.push(candidate);
  }
  return selected;
}

// ---------------------------------------------------------------------------
// صورت‌بندی نتیجه
// ---------------------------------------------------------------------------

/**
 * برچسب‌های نمایشیِ سناریو (نه اجراهای بهینه‌سازی مستقل).
 *
 * همان رفتار فاز ۴: هر سه سناریو با یک تابع هدف واحد رتبه‌بندی می‌شوند و این
 * نام‌ها فقط پس از رتبه‌بندی و بر اساس جایگاه اختصاص می‌یابند. فاز ۵ این معنا را
 * تغییر نمی‌دهد و سه بهینه‌ساز جداگانه نمی‌سازد.
 */
const SCENARIO_TYPE_BY_RANK: ScenarioType[] = ['REQUESTS', 'FAIRNESS', 'MIXED'];

function rankableObject(c: ScoredCandidate): ObjectiveRankable { return c.rankable; }

function finalizeScenarioResult(
  selected: ReadonlyArray<ScoredCandidate>, baseline: MonthlySchedule,
  filterStats: FilterStats,
  candidateCount: number, generationLog: string[], context: ScenarioContext, startedAt: number
): ScenarioGenerationResult {
  const ranked = [...selected].sort((left, right) => compareByObjective(rankableObject(left), rankableObject(right)));
  const top3: ScoredSchedule[] = ranked.map((candidate, index) => {
    const type = SCENARIO_TYPE_BY_RANK[index] ?? 'MIXED';
    const labels = SCENARIO_TITLES[type];
    // برچسب سناریو پس از رتبه‌بندی اختصاص می‌یابد، و مؤلفه‌های سازگاریِ
    // وابسته‌به‌برچسب (`weights` و `metrics.weightedTotal` و در نتیجه `totalScore`)
    // با همان برچسب نهایی بازمحاسبه می‌شوند. پیش از فاز ۵ این کار انجام نمی‌شد و
    // یک سناریو با وزن‌های MIXED امتیاز می‌گرفت اما با برچسب REQUESTS نمایش داده
    // می‌شد؛ در نتیجه ارزیابی مجددِ همان سناریو عدد دیگری می‌داد.
    //
    // لایه‌های تابع هدف کانونی (درخواست/بهره‌وری/عدالت/نقص/روتین/شباهت) به برچسب
    // وابسته نیستند، پس این بازمحاسبه هیچ رتبه‌ای را جابه‌جا نمی‌کند.
    const relabeled = scoreCandidate(candidate.schedule, type, index + 1, baseline, context).scored;
    return {
      ...relabeled, id: index + 1, type, scenarioKey: SCENARIO_KEYS[type],
      title: labels.title, shortTitle: labels.shortTitle,
      pairwiseDifference: { مبنا: relabeled.baselineDifferencePercent ?? 0 },
    };
  });

  if (top3.length === 0) {
    const reason = filterStats.droppedForCritical > 0
      ? `هیچ سناریوی بدیلِ بدون‌هشدار تولید نشد؛ ${filterStats.droppedForCritical} نامزد حتی پس از تعمیر هنوز هشدار سطح A داشتند. برنامهٔ مبنا ${countCriticalWarnings(baseline.warnings)} هشدار بحرانی دارد.`
      : filterStats.droppedIdentical === candidateCount
        ? 'هیچ سناریوی بدیلِ واقعی تولید نشد: پرسنل آزادِ گروه هدف کافی نیست یا تمام نامزدها با مبنا یکی بودند.'
        : filterStats.droppedForDistance > 0
          ? `هیچ سناریوی بدیل تولید نشد: نامزدها برای رفع هشدارها بیش از سقف مجاز تغییر (${MAX_BASELINE_DIFFERENCE_PERCENT}٪) از مبنا فاصله گرفتند.`
          : 'هیچ سناریوی بدیلِ مناسبی تولید نشد.';
    generationLog.push(reason);
    console.warn('[scenario-generator]', reason);
  }

  return {
    all: top3, top3, generationLog,
    durationMs: Math.max(0, Date.now() - startedAt),
    targetPersonnelCount: context.targetPersonnel.length,
  };
}

// ---------------------------------------------------------------------------
// موتور اصلی
// ---------------------------------------------------------------------------

function runBaselineOrientedEngine(
  options: ScenarioGenerationOptions,
  reportProgress?: (event: ScenarioProgressEvent) => void
): { result: ScenarioGenerationResult } {
  const startedAt = Date.now();
  const context = buildScenarioContext(options);
  const candidateBudget = Math.max(1, Math.min(MAX_SCENARIO_CANDIDATES, options.candidateBudget ?? DEFAULT_CANDIDATE_BUDGET));
  const generationLog: string[] = [];

  if (!context.currentAssignments || Object.keys(context.currentAssignments).length === 0) {
    generationLog.push('برنامهٔ مبنا (Working Roster) هنوز تهیه نشده است؛ بدون مبنا، سناریوی بدیل قابل تولید نیست.');
    return { result: finalizeScenarioResult([], { year: context.year, month: context.month, assignments: {}, shiftLeaders: {}, warnings: [] }, EMPTY_FILTER_STATS, 0, generationLog, context, startedAt) };
  }
  if (context.freeTargetIds.length < 2) {
    generationLog.push(`تنها ${context.freeTargetIds.length} پرسنل آزادِ گروه هدف وجود دارد؛ برای تولید سناریوی بدیل حداقل ۲ نفر لازم است.`);
    return { result: finalizeScenarioResult([], buildBaselineSchedule(context), EMPTY_FILTER_STATS, 0, generationLog, context, startedAt) };
  }

  const baseline = buildBaselineSchedule(context);
  const baselineCritical = countCriticalWarnings(baseline.warnings);
  generationLog.push(`برنامهٔ مبنا ${baselineCritical} هشدار سطح A دارد؛ ${context.freeTargetIds.length} پرسنل آزاد، ${context.lockedRows.length} قفل‌شده (ارثی).`);

  const candidates: ScoredCandidate[] = [];
  const scenarioCount = 3;
  for (let seed = 1; seed <= candidateBudget; seed += 1) {
    const scenarioIndex = Math.min(scenarioCount, Math.floor(((seed - 1) / candidateBudget) * scenarioCount) + 1);
    reportProgress?.({ stage: 'scenario', scenarioIndex, scenarioCount, fraction: (seed - 1) / candidateBudget });

    // یک‌سومِ نامزدها درخواست‌محور، بقیه تنوع (coverage-preserving row-swap).
    const candidateSchedule = (seed % 3 === 0)
      ? buildRequestBiasedCandidate(baseline, seed, context)
      : buildDiversityCandidate(baseline, seed, context);
    if (!candidateSchedule) continue;

    const repaired = repairCriticalAlerts(candidateSchedule, baseline, context);
    candidates.push(scoreCandidate(repaired, 'MIXED', seed, baseline, context));
  }
  reportProgress?.({ stage: 'scenario', scenarioIndex: scenarioCount, scenarioCount, fraction: 1 });

  const filterStats = applyQualityFilter(candidates, baseline, context);
  generationLog.push(`فیلتر کیفیت: ${filterStats.survivors.length} نامزد بدیلِ بدون‌هشدار پذیرفته شد` +
    `${filterStats.droppedForCritical ? `، ${filterStats.droppedForCritical} به‌خاطر هشدار سطح A` : ''}` +
    `${filterStats.droppedIdentical ? `، ${filterStats.droppedIdentical} چون با مبنا یکی بودند` : ''}` +
    `${filterStats.droppedForDistance ? `، ${filterStats.droppedForDistance} به‌خاطر فاصلهٔ زیاد` : ''}` +
    `${filterStats.droppedForLocks ? `، ${filterStats.droppedForLocks} به‌خاطر نقض حفظ قفل‌ها` : ''}.`);

  const selected = selectTopScenarios(filterStats.survivors, context);
  return { result: finalizeScenarioResult(selected, baseline, filterStats, candidates.length, generationLog, context, startedAt) };
}

export function generateAndScoreScenarios(
  year: number, month: number, personnelList: readonly Personnel[], requests: readonly ShiftRequest[],
  settings: SystemSettings, customHolidays: Readonly<Record<number, string>>, firstDayOfWeekIndex?: number,
  monthlyDutyHours?: any, targetJobGroup?: 'nurse' | 'assistant',
  currentAssignments?: Record<string, Record<number, ShiftType>> | null, lockedRows: string[] = []
): ScenarioGenerationResult {
  return runBaselineOrientedEngine({ year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours, targetJobGroup, currentAssignments, lockedRows }).result;
}

export async function generateAndScoreScenariosWithProgress(options: ScenarioGenerationOptions): Promise<ScenarioGenerationResult> {
  const { onProgress, yieldToUi } = options;
  const yieldNow = async () => { if (yieldToUi) await yieldToUi(); };
  onProgress?.({ stage: 'prepare', scenarioCount: 3, fraction: 0.5 });
  await yieldNow();
  onProgress?.({ stage: 'prepare', scenarioCount: 3, fraction: 1 });
  await yieldNow();
  const { result } = runBaselineOrientedEngine(options, event => { onProgress?.(event); });
  onProgress?.({ stage: 'scoring', scenarioCount: 3, fraction: 1 });
  await yieldNow();
  return result;
}
