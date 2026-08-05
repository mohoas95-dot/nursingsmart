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
  evaluateScenarioSchedule,
  filterWarningsForScenarioGroup,
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
  calendar: ReadonlyArray<{ day: number; dayOfWeek: number }>;
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

function verifyScenarioSchedule(
  assignments: Record<string, Record<number, ShiftType>>,
  context: ScenarioContext
): MonthlySchedule {
  const reconciled = reconcileStaffingCoverage(
    assignments,
    context.personnelList,
    context.settings,
    generateJalaliMonthCalendar(context.year, context.month, context.customHolidays, context.firstDayOfWeekIndex).map(day => ({ day: day.day, isHoliday: day.isHoliday })),
    context.targetJobGroup ? [context.targetJobGroup] : ['nurse', 'assistant'],
    context.lockedRows,
    context.requests
  ).assignments;

  const verification = verifyCoverageAndLeaders(
    context.year, context.month, context.personnelList, reconciled, context.settings,
    context.customHolidays, context.firstDayOfWeekIndex, context.requests
  );

  const relevantWarnings = filterWarningsForScenarioGroups(verification.warnings, context.personnelList, context.targetJobGroup, context.lockedIdSet);

  return {
    year: context.year, month: context.month, assignments: reconciled,
    shiftLeaders: verification.shiftLeaders, warnings: relevantWarnings,
  };
}

/**
 * فیلتر هشدارها برای گروه هدف. (نسخهٔ محلی تا وابستگی دایره‌ای با lib/scoring
 * برای این فراخوانی کمتر شود؛ منطق همان filterWarningsForScenarioGroup است.)
 */
function filterWarningsForScenarioGroups(
  warnings: ReadonlyArray<string>,
  personnelList: readonly Personnel[],
  targetJobGroup?: JobGroup,
  lockedIdSet?: ReadonlySet<string>
): string[] {
  const normalized = (w: string) => w.replace('کمک بهیار', 'کمک‌بهیار');
  // پرسنل قفل‌شده: چون در مبنا حل شده‌اند، در سناریو نباید تغییری داشته باشند و هشداری برایشان صادر نشود.
  const isLockedPersonnelWarning = (warning: string): boolean => {
    if (!lockedIdSet || lockedIdSet.size === 0) return false;
    for (const person of personnelList) {
      if (!lockedIdSet.has(person.id)) continue;
      if (warning.includes(`${person.firstName} ${person.lastName}`)) return true;
    }
    return false;
  };

  return warnings.filter(warning => {
    if (isLockedPersonnelWarning(warning)) return false;
    if (!targetJobGroup) return true;
    const w = normalized(warning);
    const mentionsAssistant = w.includes('کمک‌بهیار') || w.includes('بهیار');
    const mentionsNurse = w.includes('پرستار');
    const mentionsLeader = w.includes('سرشیفت');
    if (mentionsAssistant && !mentionsNurse) return targetJobGroup === 'assistant';
    if ((mentionsNurse || mentionsLeader) && !mentionsAssistant) return targetJobGroup === 'nurse';
    for (const person of personnelList) {
      if (warning.includes(`${person.firstName} ${person.lastName}`)) return person.jobGroup === targetJobGroup;
    }
    return false;
  });
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
    person.active && !lockedIdSet.has(person.id) && (!targetJobGroup || person.jobGroup === targetJobGroup));
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

function buildBaselineSchedule(context: ScenarioContext): MonthlySchedule {
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
): MonthlySchedule | null {
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
  if (preferred === 'M') return ['M', 'ME', 'MN', 'MEN'].includes(shift);
  if (preferred === 'E') return ['E', 'ME', 'EN', 'MEN'].includes(shift);
  if (preferred === 'N') return ['N', 'EN', 'MN', 'MEN'].includes(shift);
  return shift === preferred;
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
): MonthlySchedule | null {
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
// تعمیر هشدارهای سطح A
// ---------------------------------------------------------------------------

const PERIOD_SHIFT_CODE: Record<string, ShiftType> = { صبح: 'M', عصر: 'E', شب: 'N' };

function findPersonnelByFullName(context: ScenarioContext, warning: string): Personnel | null {
  for (const person of context.freeTargetPersonnel) {
    if (warning.includes(`${person.firstName} ${person.lastName}`)) return person;
  }
  return null;
}

function generateCriticalRepairEdits(schedule: MonthlySchedule, context: ScenarioContext) {
  const edits: Array<{ personnelId: string; day: number; shift: ShiftType }> = [];
  const seen = new Set<string>();
  const push = (edit: { personnelId: string; day: number; shift: ShiftType }) => {
    const key = `${edit.personnelId}:${edit.day}:${edit.shift}`;
    if (!seen.has(key)) { seen.add(key); edits.push(edit); }
  };
  for (const warning of schedule.warnings) {
    const dayMatch = warning.match(/روز (\d+)/);
    const shiftMatch = warning.match(/شیفت ([A-Z]+)/);
    const periodMatch = warning.match(/نوبت (صبح|عصر|شب)/);
    const day = dayMatch ? Number(dayMatch[1]) : null;
    const shiftChar = shiftMatch ? (shiftMatch[1] as ShiftType) : null;
    const period = periodMatch ? periodMatch[1] : null;

    if (warning.startsWith('Coverage Shortage:') && day && shiftChar) {
      for (const person of context.freeTargetPersonnel) {
        if ((getAssignedShift(schedule, person.id, day)) === 'OFF') { push({ personnelId: person.id, day, shift: shiftChar }); break; }
      }
      continue;
    }
    if (warning.startsWith('Overstaffing:') && day && shiftChar) {
      for (const person of context.freeTargetPersonnel) {
        if (getAssignedShift(schedule, person.id, day) === shiftChar) { push({ personnelId: person.id, day, shift: 'OFF' }); break; }
      }
      continue;
    }
    if (warning.startsWith('Missing Shift Leader:') && day && period) {
      const code = PERIOD_SHIFT_CODE[period];
      if (code) for (const person of context.freeTargetPersonnel) {
        if (person.canBeShiftLeader && getAssignedShift(schedule, person.id, day) === 'OFF') { push({ personnelId: person.id, day, shift: code }); break; }
      }
      continue;
    }
    if (warning.startsWith('Max Consecutive:')) {
      const person = findPersonnelByFullName(context, warning);
      const startMatch = warning.match(/از روز (\d+)/);
      const endMatch = warning.match(/تا روز (\d+)/);
      if (person && startMatch && endMatch) {
        const start = Number(startMatch[1]); const end = Math.min(Number(endMatch[1]), context.totalDays);
        const mid = Math.floor((start + end) / 2);
        for (let d = mid; d <= end; d += 1) {
          const cur = getAssignedShift(schedule, person.id, d);
          if (cur !== 'OFF' && !cur.startsWith('L')) { push({ personnelId: person.id, day: d, shift: 'OFF' }); break; }
        }
      }
      continue;
    }
    if (warning.startsWith('Mandatory Rest:')) {
      const person = findPersonnelByFullName(context, warning);
      if (person) for (let d = context.totalDays; d >= Math.max(1, context.totalDays - 3); d -= 1) {
        const cur = getAssignedShift(schedule, person.id, d);
        if (cur !== 'OFF' && !cur.startsWith('L')) { push({ personnelId: person.id, day: d, shift: 'OFF' }); break; }
      }
      continue;
    }
  }
  return edits;
}

function repairCriticalAlerts(candidate: MonthlySchedule, baseline: MonthlySchedule, context: ScenarioContext): MonthlySchedule {
  let current = candidate;
  let criticalCount = countCriticalWarnings(current.warnings);
  for (let step = 0; step < MAX_CRITICAL_REPAIR_STEPS && criticalCount > 0; step += 1) {
    const edits = generateCriticalRepairEdits(current, context);
    if (edits.length === 0) break;
    let best: MonthlySchedule | null = null;
    let bestCritical = criticalCount;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const edit of edits) {
      const tried = verifyScenarioSchedule(applyCellEdit(current.assignments, edit), context);
      const triedCritical = countCriticalWarnings(tried.warnings);
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
  schedule: MonthlySchedule;
  scored: ScoredSchedule;
  objective: ReturnType<typeof evaluateBaselineObjective>;
  rankable: ObjectiveRankable;
}

function scoreCandidate(
  schedule: MonthlySchedule, scenarioType: ScenarioType, id: number, baseline: MonthlySchedule, context: ScenarioContext
): ScoredCandidate {
  const scored = evaluateScenario(schedule, scenarioType, id, context);
  const requestSatisfactionPercent = calculateRequestSatisfactionPercent(
    schedule, context.personnelList, context.requests, context.year, context.month,
    context.customHolidays, context.firstDayOfWeekIndex, context.targetJobGroup);
  const objective = evaluateBaselineObjective({
    baseline, candidate: schedule, warnings: schedule.warnings,
    targetPersonnelIds: context.targetPersonnelIds, totalDays: context.totalDays,
    lockedRows: context.lockedRows, requestSatisfactionPercent,
  });
  const nonCriticalWarningCount = Math.max(0, schedule.warnings.length - objective.criticalWarningCount);
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
