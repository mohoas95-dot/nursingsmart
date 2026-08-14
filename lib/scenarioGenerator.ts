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
import { shiftSatisfiesRequestedShift } from '../domain/scheduling/workload';
import { isDayInRequestScope } from '../domain/requests/request-scope-matcher';
import {
  JobGroup,
  MonthlySchedule,
  Personnel,
  ShiftRequest,
  ShiftType,
  SystemSettings,
} from './types';
import {
  calculateRequestSatisfactionPercent,
  countScoringDefectWarnings,
  evaluateScenarioSchedule,
  filterStructuredWarningsForScenarioGroup,
  SCENARIO_KEYS,
  SCENARIO_TITLES,
  type ScoredSchedule,
  type ScenarioType,
} from './scoring';
import {
  areScenariosDistinctEnough,
  calculateBaselineDifferencePercent,
  compareByObjective,
  countCriticalWarnings,
  evaluateBaselineObjective,
  type ObjectiveRankable,
} from '../domain/scenarios/objective';
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
}

// ---------------------------------------------------------------------------
// ثابت‌ها
// ---------------------------------------------------------------------------

export const MAX_SCENARIO_CANDIDATES = 500;
const DEFAULT_CANDIDATE_BUDGET = 36;
const MAX_CRITICAL_REPAIR_STEPS = 24;
/** بیشترین فاصلهٔ مجاز از مبنا برای قبول در فیلتر کیفیت (٪). */
const MAX_BASELINE_DIFFERENCE_PERCENT = 35;
/** کمترین فاصلهٔ لازم تا سناریو «بدیلِ واقعی» محسوب شود (نه کپیِ مبنا) (٪). */
const MIN_DIFFERENCE_FROM_BASELINE_PERCENT = 3;
/** کمترین فاصلهٔ لازم میان دو سناریوی منتخب (٪). */
const MIN_DISTINCT_DIFFERENCE_PERCENT = 3;
const MAX_DISPLAYED_SCENARIOS = 3;

interface ScenarioContext {
  year: number;
  month: number;
  personnelList: readonly Personnel[];
  requests: readonly ShiftRequest[];
  settings: SystemSettings;
  customHolidays: Readonly<Record<number, string>>;
  firstDayOfWeekIndex?: number;
  monthlyDutyHours?: any;
  targetJobGroup?: JobGroup;
  currentAssignments?: Record<string, Record<number, ShiftType>> | null;
  lockedRows: string[];
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
    context.requests
  ).assignments;
  const reconciled = repairScheduleBeforeWarnings({
    assignments: coverageReconciled,
    personnelList: context.personnelList,
    settings: context.settings,
    calendarDays,
    requests: context.requests,
    targetJobGroups: context.targetJobGroup ? [context.targetJobGroup] : ['nurse', 'assistant'],
    lockedRows: context.lockedRows,
  }).assignments;

  const verification = verifyCoverageAndLeaders(
    context.year, context.month, context.personnelList, reconciled, context.settings,
    context.customHolidays, context.firstDayOfWeekIndex, context.requests
  );

  // همان معیار فیلترِ تاریخی، اما روی نمای ساخت‌یافته تا فراداده حفظ شود و
  // مصرف‌کننده‌های پایین‌دستی (تعمیر بحرانی/طبقه‌بندی) متن را تجزیه نکنند.
  const relevantStructuredWarnings = filterStructuredWarningsForScenarioGroup(
    verification.structuredWarnings,
    context.personnelList,
    context.targetJobGroup,
    context.lockedIdSet
  );

  return {
    year: context.year, month: context.month, assignments: reconciled,
    shiftLeaders: verification.shiftLeaders,
    warnings: warningMessages(relevantStructuredWarnings),
    structuredWarnings: relevantStructuredWarnings,
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

function evaluateScenario(
  schedule: MonthlySchedule, scenarioType: ScenarioType, id: number, context: ScenarioContext
): ScoredSchedule {
  return evaluateScenarioSchedule({
    id, type: scenarioType, schedule,
    personnelList: context.personnelList, requests: context.requests, settings: context.settings,
    year: context.year, month: context.month, customHolidays: context.customHolidays,
    firstDayOfWeekIndex: context.firstDayOfWeekIndex, monthlyDutyHours: context.monthlyDutyHours,
    targetJobGroup: context.targetJobGroup,
  });
}

function buildScenarioContext(options: ScenarioGenerationOptions): ScenarioContext {
  const { year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex,
    monthlyDutyHours, targetJobGroup, currentAssignments, lockedRows = [] } = options;
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const lockedIdSet = new Set(lockedRows);
  const targetPersonnel = personnelList.filter(person =>
    person.active
    && !person.locked
    && !lockedIdSet.has(person.id)
    && (!targetJobGroup || person.jobGroup === targetJobGroup));
  return {
    year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex,
    monthlyDutyHours, targetJobGroup, currentAssignments, lockedRows,
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

function shiftCovers(shift: ShiftType, preferred: string): boolean {
  return shiftSatisfiesRequestedShift(shift, preferred);
}

function isRequestSatisfiedForDay(request: ShiftRequest, shift: ShiftType, day: number, context: ScenarioContext): boolean {
  if (request.requestType === 'OFF') return shift === 'OFF' || shift.startsWith('L');
  if (request.requestType === 'leave') return shift.startsWith('L');
  if (request.requestType === 'shift') return !!request.preferredShift && shiftCovers(shift, request.preferredShift);
  if (request.requestType === 'avoid_shift') return !request.preferredShift || !shiftCovers(shift, request.preferredShift);
  if (request.requestType === 'pattern') {
    const steps = request.patternSteps && request.patternSteps.length > 0
      ? request.patternSteps[(day - 1) % request.patternSteps.length] : undefined;
    if (!steps) return true;
    if (steps === 'OFF') return shift === 'OFF';
    if (steps.startsWith('L')) return shift.startsWith('L');
    return shiftCovers(shift, steps);
  }
  return true;
}

/**
 * یک نامزد که تلاش می‌کند درخواستِ یکی از پرسنلِ گروه هدف را بهتر رعایت کند:
 * نفرِ دارایِ درخواست (P) با یک همگروهی (Q) روی روزهای نقضِ درخواست تعویض می‌شود،
 * به‌شرطی که شیفتِ Q در آن روزها درخواستِ P را برآورده کند. همچنان حفظ‌کنندهٔ پوشش.
 */
function buildRequestBiasedCandidate(
  baseline: MonthlySchedule, seed: number, context: ScenarioContext
): VerifiedSchedule | null {
  if (context.freeTargetIds.length < 2 || context.requests.length === 0) return null;
  const random = createSeededRandom(seed * 40503 + 7);
  const eligibleRequests = context.requests.filter(r => context.freeTargetIds.includes(r.personnelId));
  if (eligibleRequests.length === 0) return null;
  const request = eligibleRequests[Math.floor(random() * eligibleRequests.length)];
  const ownerId = request.personnelId;

  // روزهای نقضِ درخواستِ صاحبِ درخواست.
  const violationDays: number[] = [];
  for (let day = 1; day <= context.totalDays; day += 1) {
    const dayOfWeek = context.calendar[day - 1]?.dayOfWeek ?? 0;
    if (!isDayInRequestScope(day, dayOfWeek, request)) continue;
    const current = getAssignedShift(baseline, ownerId, day);
    if (!isRequestSatisfiedForDay(request, current, day, context)) violationDays.push(day);
  }
  if (violationDays.length === 0) return null;

  // همگروهیِ Q که شیفتش در روزهای نقض، درخواستِ P را برآورده می‌کند (و با P قابل‌تعویض است).
  const partnerId = context.freeTargetIds.find(id => {
    if (id === ownerId) return false;
    return violationDays.some(day => {
      const partnerShift = getAssignedShift(baseline, id, day);
      return !partnerShift.startsWith('L') && isRequestSatisfiedForDay(request, partnerShift, day, context);
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
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const edit of edits) {
      const tried = verifyScenarioSchedule(applyCellEdit(current.assignments, edit), context);
      const triedCritical = countCriticalScheduleWarnings(tried.structuredWarnings);
      if (triedCritical > bestCritical) continue;
      const triedDiff = calculateBaselineDifferencePercent(baseline, tried, context.targetPersonnelIds, context.totalDays);
      const better = triedCritical < bestCritical || (triedCritical === bestCritical && triedDiff < bestDiff);
      if (better) { best = tried; bestCritical = triedCritical; bestDiff = triedDiff; }
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
  objective: ReturnType<typeof evaluateBaselineObjective>;
  rankable: ObjectiveRankable;
}

function scoreCandidate(
  schedule: VerifiedSchedule, scenarioType: ScenarioType, id: number, baseline: MonthlySchedule, context: ScenarioContext
): ScoredCandidate {
  // نمایِ MonthlySchedule خالص برای ارزیابی/ذخیره‌سازی — فرادادهٔ ساخت‌یافته
  // فقط درون خط‌لولهٔ موتور می‌ماند و در ScoredSchedule (قابل‌ذخیره) نمی‌نشیند.
  const plainSchedule = toMonthlySchedule(schedule);
  const scored = evaluateScenario(plainSchedule, scenarioType, id, context);
  const requestSatisfactionPercent = calculateRequestSatisfactionPercent(
    plainSchedule, context.personnelList, context.requests, context.year, context.month,
    context.customHolidays, context.firstDayOfWeekIndex, context.targetJobGroup);
  const objective = evaluateBaselineObjective({
    baseline, candidate: plainSchedule, warnings: plainSchedule.warnings,
    structuredWarnings: schedule.structuredWarnings,
    targetPersonnelIds: context.targetPersonnelIds, totalDays: context.totalDays,
    lockedRows: context.lockedRows, requestSatisfactionPercent,
  });
  // اطلاع‌رسانی‌های خودکار solver (OFF_REMOVED / ISOLATED_SHIFT_FIXED) تخلف
  // نیستند و نباید رتبهٔ بهینه‌سازی را پایین بیاورند؛ فقط تخلف‌های غیربحرانیِ
  // واقعی در این معیارِ رتبه‌بندی شمرده می‌شوند.
  const defectWarningCount = countScoringDefectWarnings(schedule.warnings);
  const nonCriticalWarningCount = Math.max(0, defectWarningCount - objective.criticalWarningCount);
  scored.baselineSimilarityPercent = objective.similarityPercent;
  scored.baselineDifferencePercent = objective.baselineDifferencePercent;
  scored.criticalWarningCount = objective.criticalWarningCount;
  scored.totalScore = objective.similarityPercent;
  return {
    schedule, scored, objective,
    rankable: { similarityPercent: objective.similarityPercent, nonCriticalWarningCount, requestSatisfactionPercent },
  };
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
  for (const candidate of candidates) {
    if (!candidate.objective.criticalResolved) { droppedForCritical += 1; continue; }
    const difference = calculateBaselineDifferencePercent(baseline, candidate.schedule, context.targetPersonnelIds, context.totalDays);
    if (difference > MAX_BASELINE_DIFFERENCE_PERCENT) { droppedForDistance += 1; continue; }
    // سناریو باید «بدیلِ واقعی» باشد: حداقل فاصلهٔ مشخصی از مبنا داشته باشد.
    if (difference < MIN_DIFFERENCE_FROM_BASELINE_PERCENT) { droppedIdentical += 1; continue; }
    survivors.push(candidate);
  }
  return { survivors, droppedForCritical, droppedForDistance, droppedIdentical };
}

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

const SCENARIO_TYPE_BY_RANK: ScenarioType[] = ['REQUESTS', 'FAIRNESS', 'MIXED'];

function rankableObject(c: ScoredCandidate): ObjectiveRankable { return c.rankable; }

function finalizeScenarioResult(
  selected: ReadonlyArray<ScoredCandidate>, baseline: MonthlySchedule,
  filterStats: { survivors: ScoredCandidate[]; droppedForCritical: number; droppedForDistance: number; droppedIdentical: number },
  candidateCount: number, generationLog: string[], context: ScenarioContext, startedAt: number
): ScenarioGenerationResult {
  const ranked = [...selected].sort((left, right) => compareByObjective(rankableObject(left), rankableObject(right)));
  const top3: ScoredSchedule[] = ranked.map((candidate, index) => {
    const type = SCENARIO_TYPE_BY_RANK[index] ?? 'MIXED';
    const labels = SCENARIO_TITLES[type];
    return {
      ...candidate.scored, id: index + 1, type, scenarioKey: SCENARIO_KEYS[type],
      title: labels.title, shortTitle: labels.shortTitle,
      pairwiseDifference: { مبنا: candidate.objective.baselineDifferencePercent },
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
    return { result: finalizeScenarioResult([], { year: context.year, month: context.month, assignments: {}, shiftLeaders: {}, warnings: [] }, { survivors: [], droppedForCritical: 0, droppedForDistance: 0, droppedIdentical: 0 }, 0, generationLog, context, startedAt) };
  }
  if (context.freeTargetIds.length < 2) {
    generationLog.push(`تنها ${context.freeTargetIds.length} پرسنل آزادِ گروه هدف وجود دارد؛ برای تولید سناریوی بدیل حداقل ۲ نفر لازم است.`);
    return { result: finalizeScenarioResult([], buildBaselineSchedule(context), { survivors: [], droppedForCritical: 0, droppedForDistance: 0, droppedIdentical: 0 }, 0, generationLog, context, startedAt) };
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
    `${filterStats.droppedForDistance ? `، ${filterStats.droppedForDistance} به‌خاطر فاصلهٔ زیاد` : ''}.`);

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
