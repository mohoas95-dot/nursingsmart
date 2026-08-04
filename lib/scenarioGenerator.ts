/**
 * Scenario Generator — سه مسیر هدف‌محور بر پایهٔ برنامهٔ مبنا
 * ===========================================================
 *
 * A، B و C دیگر برچسب سه نسخهٔ تقریباً یکسان نیستند:
 *   A) بیشترین رعایت درخواست‌ها
 *   B) بیشترین عدالت در بار کاری
 *   C) بهترین امتیاز تلفیقی
 *
 * همهٔ مسیرها از مبنا شروع می‌شوند، با تعویض‌های coverage-preserving تنوع
 * می‌سازند و پیش از پذیرش از یک دروازهٔ مشترک عبور می‌کنند: صفر تخلف
 * مسدودکننده، حفظ قفل‌ها و فاصلهٔ کنترل‌شده از مبنا. پیام‌های ترجیحی به‌عنوان
 * «نکتهٔ کیفیت» باقی می‌مانند و مانع گردش کار نیستند.
 *
 * خط‌لوله:
 *   ۱) ساخت و اعتبارسنجی برنامهٔ مبنا.
 *   ۲) تقسیم بودجه میان مولد درخواست‌محور، عدالت‌محور و تلفیقی.
 *   ۳) تعمیر best-effort تخلفات مسدودکننده و اجرای verifier کامل.
 *   ۴) حذف نامزد نامعتبر، ناقض قفل، تکراری یا بیش‌ازحد دور/نزدیک.
 *   ۵) رتبه‌بندی مستقل برای هر تابع هدف و انتخاب حداکثر سه بدیل متمایز.
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
  SCENARIO_KEYS,
  SCENARIO_TITLES,
  type ScoredSchedule,
  type ScenarioType,
} from './scoring';
import {
  areScenariosDistinctEnough,
  calculateBaselineDifferencePercent,
  countCriticalWarnings,
  evaluateBaselineObjective,
} from '../domain/scenarios/objective';
import { summarizeScenarioWarnings } from '../domain/scenarios/eligibility';

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
  /** بودجهٔ نامزدها (پیش‌فرض ۷۲، سقف ۵۰۰؛ میان سه هدف تقسیم می‌شود). */
  candidateBudget?: number;
}

// ---------------------------------------------------------------------------
// ثابت‌ها
// ---------------------------------------------------------------------------

export const MAX_SCENARIO_CANDIDATES = 500;
const DEFAULT_CANDIDATE_BUDGET = 72;
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

  const relevantWarnings = filterWarningsForScenarioGroups(verification.warnings, context.personnelList, context.targetJobGroup);

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
  targetJobGroup?: JobGroup
): string[] {
  if (!targetJobGroup) return [...warnings];
  const normalized = (w: string) => w.replace('کمک بهیار', 'کمک‌بهیار');
  return warnings.filter(warning => {
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
  // دو نمایش قفل در داده‌های قدیمی وجود دارد: lockedRows ماه و flag روی Personnel.
  // هر دو باید از فضای جست‌وجو حذف و مستقیماً از مبنا ارث‌بری شوند.
  const effectiveLockedRows = Array.from(new Set([
    ...lockedRows,
    ...personnelList.filter(person => person.locked).map(person => person.id),
  ]));
  const lockedIdSet = new Set(effectiveLockedRows);
  const targetPersonnel = personnelList.filter(person =>
    person.active && !lockedIdSet.has(person.id) && (!targetJobGroup || person.jobGroup === targetJobGroup));
  return {
    year, month, personnelList, requests, settings, customHolidays, firstDayOfWeekIndex,
    monthlyDutyHours, targetJobGroup, currentAssignments, lockedRows: effectiveLockedRows,
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
  const eligiblePartners = context.freeTargetIds.filter(id => {
    if (id === ownerId) return false;
    return violationDays.some(day => {
      const partnerShift = getAssignedShift(baseline, id, day);
      return !partnerShift.startsWith('L') && isRequestSatisfiedForDay(request, partnerShift, day, context);
    });
  });
  if (eligiblePartners.length === 0) return null;
  const partnerId = eligiblePartners[Math.floor(random() * eligiblePartners.length)];

  // نقطهٔ شروع با seed تغییر می‌کند تا همهٔ نامزدهای درخواست‌محور به یک پاسخ
  // فرو نریزند. پوشش روزانه با تعویض دو ردیف ثابت می‌ماند.
  const start = violationDays.length > 1 ? Math.floor(random() * violationDays.length) : 0;
  const rotatedDays = [...violationDays.slice(start), ...violationDays.slice(0, start)];
  const days = rotatedDays.slice(0, Math.min(10, Math.max(2, rotatedDays.length)));
  const swapped = applyRowSwap(cloneAssignments(baseline.assignments), ownerId, partnerId, days);
  const merged = mergePreservedAssignments(swapped, context);
  return verifyScenarioSchedule(merged, context);
}

// ---- نامزد عدالت‌محور: انتقال بار از فرد پُربار به فرد کم‌بار ---------------

const SHIFT_LOAD_HOURS: Readonly<Record<string, number>> = {
  OFF: 0,
  M: 6.5,
  E: 6.5,
  N: 12.5,
  ME: 13,
  EN: 19,
  MN: 19,
  MEN: 25.5,
};

function rowWorkloadHours(schedule: MonthlySchedule, personnelId: string, totalDays: number): number {
  let total = 0;
  for (let day = 1; day <= totalDays; day += 1) {
    const shift = getAssignedShift(schedule, personnelId, day);
    total += SHIFT_LOAD_HOURS[shift] || 0;
  }
  return total;
}

/**
 * یک جابه‌جایی پوشش‌حافظ که بار کاری را از یکی از ردیف‌های پُربار به یکی از
 * ردیف‌های کم‌بار منتقل می‌کند. پذیرش نهایی همچنان فقط پس از اجرای verifier
 * کامل انجام می‌شود؛ بنابراین عدالت هرگز به قیمت نقض قانون به‌دست نمی‌آید.
 */
function buildFairnessBiasedCandidate(
  baseline: MonthlySchedule, seed: number, context: ScenarioContext
): MonthlySchedule | null {
  if (context.freeTargetIds.length < 2) return null;
  const random = createSeededRandom(seed * 2246822519 + 19);
  const ranked = context.freeTargetIds
    .map(id => ({ id, hours: rowWorkloadHours(baseline, id, context.totalDays) }))
    .sort((left, right) => right.hours - left.hours || left.id.localeCompare(right.id));

  const half = Math.max(1, Math.floor(ranked.length / 2));
  const highPool = ranked.slice(0, half);
  const lowPool = ranked.slice(-half).reverse();
  const high = highPool[Math.floor(random() * highPool.length)];
  const low = lowPool[Math.floor(random() * lowPool.length)];
  if (!high || !low || high.id === low.id || high.hours <= low.hours) return null;

  const transferableDays: Array<{ day: number; gain: number }> = [];
  for (let day = 1; day <= context.totalDays; day += 1) {
    const highShift = getAssignedShift(baseline, high.id, day);
    const lowShift = getAssignedShift(baseline, low.id, day);
    if (highShift.startsWith('L') || lowShift.startsWith('L') || highShift === lowShift) continue;
    const gain = (SHIFT_LOAD_HOURS[highShift] || 0) - (SHIFT_LOAD_HOURS[lowShift] || 0);
    if (gain > 0) transferableDays.push({ day, gain });
  }
  if (transferableDays.length === 0) return null;

  transferableDays.sort((left, right) => right.gain - left.gain || left.day - right.day);
  const maxChanges = Math.min(8, transferableDays.length);
  const changeCount = Math.min(maxChanges, 2 + Math.floor(random() * Math.max(1, maxChanges - 1)));
  const offset = transferableDays.length > changeCount
    ? Math.floor(random() * (transferableDays.length - changeCount + 1))
    : 0;
  const days = transferableDays.slice(offset, offset + changeCount).map(item => item.day);

  const swapped = applyRowSwap(cloneAssignments(baseline.assignments), high.id, low.id, days);
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
  /** مسیری که واقعاً این نامزد را ساخته است؛ مانع برچسب‌گذاری صوری A/B/C می‌شود. */
  sourceTrack: ScenarioType;
  /** سنجش مشترک نامزد؛ metrics مستقل از برچسب نهایی و totalScore در اینجا تلفیقی است. */
  scored: ScoredSchedule;
  objective: ReturnType<typeof evaluateBaselineObjective>;
}

function scoreCandidate(
  schedule: MonthlySchedule,
  id: number,
  sourceTrack: ScenarioType,
  baseline: MonthlySchedule,
  context: ScenarioContext
): ScoredCandidate {
  // تمام نامزدها یک‌بار با وزن تلفیقی سنجیده می‌شوند. هنگام انتخاب نهایی، همان
  // برنامه با نوع واقعی A/B/C دوباره امتیازدهی می‌شود.
  const scored = evaluateScenario(schedule, 'MIXED', id, context);
  const requestSatisfactionPercent = calculateRequestSatisfactionPercent(
    schedule, context.personnelList, context.requests, context.year, context.month,
    context.customHolidays, context.firstDayOfWeekIndex, context.targetJobGroup);
  const objective = evaluateBaselineObjective({
    baseline, candidate: schedule, warnings: schedule.warnings,
    targetPersonnelIds: context.targetPersonnelIds, totalDays: context.totalDays,
    lockedRows: context.lockedRows, requestSatisfactionPercent,
  });
  scored.baselineSimilarityPercent = objective.similarityPercent;
  scored.baselineDifferencePercent = objective.baselineDifferencePercent;
  scored.criticalWarningCount = objective.criticalWarningCount;
  return { schedule, sourceTrack, scored, objective };
}

// ---------------------------------------------------------------------------
// فیلتر کیفیت + انتخاب سه هدف واقعی
// ---------------------------------------------------------------------------

interface QualityFilterStats {
  survivors: ScoredCandidate[];
  droppedForCritical: number;
  droppedForLocks: number;
  droppedForDistance: number;
  droppedIdentical: number;
}

function applyQualityFilter(
  candidates: ReadonlyArray<ScoredCandidate>, baseline: MonthlySchedule, context: ScenarioContext
): QualityFilterStats {
  const survivors: ScoredCandidate[] = [];
  let droppedForCritical = 0;
  let droppedForLocks = 0;
  let droppedForDistance = 0;
  let droppedIdentical = 0;
  for (const candidate of candidates) {
    // دروازهٔ قطعی: حتی یک تخلف مسدودکننده در سناریوی فقط‌خواندنی مجاز نیست.
    if (!candidate.objective.criticalResolved) { droppedForCritical += 1; continue; }
    if (!candidate.objective.locksPreserved) { droppedForLocks += 1; continue; }
    const difference = calculateBaselineDifferencePercent(baseline, candidate.schedule, context.targetPersonnelIds, context.totalDays);
    if (difference > MAX_BASELINE_DIFFERENCE_PERCENT) { droppedForDistance += 1; continue; }
    if (difference < MIN_DIFFERENCE_FROM_BASELINE_PERCENT) { droppedIdentical += 1; continue; }
    survivors.push(candidate);
  }
  return { survivors, droppedForCritical, droppedForLocks, droppedForDistance, droppedIdentical };
}

const SCENARIO_OBJECTIVE_TRACKS: readonly ScenarioType[] = ['REQUESTS', 'FAIRNESS', 'MIXED'];

interface SelectedObjectiveScenario {
  type: ScenarioType;
  candidate: ScoredCandidate;
}

function objectiveTrackScore(candidate: ScoredCandidate, type: ScenarioType): number {
  if (type === 'REQUESTS') return candidate.scored.metrics.requestScore;
  if (type === 'FAIRNESS') return candidate.scored.metrics.fairnessScore;
  return candidate.scored.metrics.weightedTotal;
}

/** رتبه‌بندی مستقل برای هر مسیر؛ شباهت دیگر هدف غالب هر سه سناریو نیست. */
function compareForObjectiveTrack(type: ScenarioType, left: ScoredCandidate, right: ScoredCandidate): number {
  const scoreDifference = objectiveTrackScore(right, type) - objectiveTrackScore(left, type);
  if (Math.abs(scoreDifference) > 0.0001) return scoreDifference;

  // در تساوی هدف اصلی، نکات کیفیت کمتر و سپس هدف مکمل بهتر ترجیح دارد.
  const leftAdvisory = summarizeScenarioWarnings(left.schedule.warnings).advisoryCount;
  const rightAdvisory = summarizeScenarioWarnings(right.schedule.warnings).advisoryCount;
  if (leftAdvisory !== rightAdvisory) return leftAdvisory - rightAdvisory;

  // اگر همهٔ درخواست‌ها از قبل یکسان رعایت شده‌اند، A نباید بهترین نامزد عدالت
  // را تصاحب کند؛ پایداری نسبت به مبنا tie-breaker طبیعی مسیر درخواست است.
  if (type === 'REQUESTS' && left.objective.similarityPercent !== right.objective.similarityPercent) {
    return right.objective.similarityPercent - left.objective.similarityPercent;
  }
  if (type === 'FAIRNESS' && left.scored.metrics.requestScore !== right.scored.metrics.requestScore) {
    return right.scored.metrics.requestScore - left.scored.metrics.requestScore;
  }
  if (type === 'MIXED' && left.scored.metrics.optimizationScore !== right.scored.metrics.optimizationScore) {
    return right.scored.metrics.optimizationScore - left.scored.metrics.optimizationScore;
  }

  // نزدیکی به مبنا فقط آخرین tie-breaker است، نه هویت هر سه سناریو.
  return right.objective.similarityPercent - left.objective.similarityPercent;
}

function selectObjectiveScenarios(
  survivors: ReadonlyArray<ScoredCandidate>, context: ScenarioContext
): SelectedObjectiveScenario[] {
  const selected: SelectedObjectiveScenario[] = [];
  // عدالت محدودکننده‌ترین هدف است؛ ابتدا بهترین نامزد واقعی B رزرو می‌شود تا
  // A در ماه‌های بدون درخواست (که requestScore همه ۱۰۰ است) آن را تصاحب نکند.
  const selectionOrder: readonly ScenarioType[] = ['FAIRNESS', 'REQUESTS', 'MIXED'];
  for (const type of selectionOrder) {
    const ranked = [...survivors].sort((left, right) => {
      const objectiveOrder = compareForObjectiveTrack(type, left, right);
      if (objectiveOrder !== 0) return objectiveOrder;
      const leftNative = left.sourceTrack === type ? 1 : 0;
      const rightNative = right.sourceTrack === type ? 1 : 0;
      return rightNative - leftNative;
    });
    const candidate = ranked.find(item => selected.every(chosen =>
      areScenariosDistinctEnough(
        chosen.candidate.schedule,
        item.schedule,
        context.targetPersonnelIds,
        context.totalDays,
        MIN_DISTINCT_DIFFERENCE_PERCENT
      )
    ));
    if (candidate) selected.push({ type, candidate });
    if (selected.length >= MAX_DISPLAYED_SCENARIOS) break;
  }

  // قرارداد UI/ذخیره‌سازی همیشه A سپس B سپس C است، مستقل از ترتیب رزرو بالا.
  return selected.sort(
    (left, right) => SCENARIO_OBJECTIVE_TRACKS.indexOf(left.type) - SCENARIO_OBJECTIVE_TRACKS.indexOf(right.type)
  );
}

// ---------------------------------------------------------------------------
// صورت‌بندی نتیجه
// ---------------------------------------------------------------------------

const SCENARIO_ID_BY_TYPE: Record<ScenarioType, number> = {
  REQUESTS: 1,
  FAIRNESS: 2,
  MIXED: 3,
};

function finalizeScenarioResult(
  selected: ReadonlyArray<SelectedObjectiveScenario>, baseline: MonthlySchedule,
  filterStats: QualityFilterStats,
  candidateCount: number, generationLog: string[], context: ScenarioContext, startedAt: number
): ScenarioGenerationResult {
  const top3: ScoredSchedule[] = selected.map(({ type, candidate }) => {
    const id = SCENARIO_ID_BY_TYPE[type];
    const evaluated = evaluateScenario(candidate.schedule, type, id, context);
    return {
      ...evaluated,
      id,
      type,
      scenarioKey: SCENARIO_KEYS[type],
      title: SCENARIO_TITLES[type].title,
      shortTitle: SCENARIO_TITLES[type].shortTitle,
      baselineSimilarityPercent: candidate.objective.similarityPercent,
      baselineDifferencePercent: candidate.objective.baselineDifferencePercent,
      criticalWarningCount: candidate.objective.criticalWarningCount,
      advisoryWarningCount: summarizeScenarioWarnings(candidate.schedule.warnings).advisoryCount,
      pairwiseDifference: { مبنا: candidate.objective.baselineDifferencePercent },
    };
  });

  for (const scenario of top3) {
    generationLog.push(
      `${scenario.title}: امتیاز هدف ${scenario.totalScore.toFixed(1)}، ` +
      `شباهت به مبنا ${(scenario.baselineSimilarityPercent ?? 0).toFixed(1)}٪، ` +
      `${scenario.advisoryWarningCount} نکتهٔ کیفیت، بدون تخلف مسدودکننده.`
    );
  }

  if (top3.length === 0) {
    const reason = filterStats.droppedForCritical > 0
      ? `هیچ سناریوی بدیلِ مجاز برای مقایسه تولید نشد؛ ${filterStats.droppedForCritical} نامزد حتی پس از تعمیر تخلف مسدودکننده داشتند. برنامهٔ مبنا ${countCriticalWarnings(baseline.warnings)} تخلف مسدودکننده دارد.`
      : filterStats.droppedForLocks > 0
        ? `هیچ سناریویی پذیرفته نشد؛ ${filterStats.droppedForLocks} نامزد ردیف قفل‌شده را تغییر داده بودند.`
        : filterStats.droppedIdentical === candidateCount
          ? 'هیچ سناریوی بدیلِ واقعی تولید نشد: پرسنل آزادِ گروه هدف کافی نیست یا تمام نامزدها با مبنا یکی بودند.'
          : filterStats.droppedForDistance > 0
            ? `هیچ سناریوی بدیل تولید نشد: نامزدها بیش از سقف مجاز تغییر (${MAX_BASELINE_DIFFERENCE_PERCENT}٪) از مبنا فاصله گرفتند.`
            : 'هیچ سناریوی بدیلِ معتبر و متمایزی تولید نشد.';
    generationLog.push(reason);
    console.warn('[scenario-generator]', reason);
  } else if (top3.length < MAX_DISPLAYED_SCENARIOS) {
    generationLog.push(
      `فقط ${top3.length} سناریوی معتبر و به‌اندازهٔ کافی متمایز یافت شد؛ ` +
      'فرآیند مقایسه می‌تواند با برنامهٔ مبنا و همین گزینه‌های سالم ادامه یابد.'
    );
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

  const emptyFilterStats = (): QualityFilterStats => ({
    survivors: [],
    droppedForCritical: 0,
    droppedForLocks: 0,
    droppedForDistance: 0,
    droppedIdentical: 0,
  });

  if (!context.currentAssignments || Object.keys(context.currentAssignments).length === 0) {
    generationLog.push('برنامهٔ مبنا (Working Roster) هنوز تهیه نشده است؛ بدون مبنا، سناریوی بدیل قابل تولید نیست.');
    return { result: finalizeScenarioResult([], { year: context.year, month: context.month, assignments: {}, shiftLeaders: {}, warnings: [] }, emptyFilterStats(), 0, generationLog, context, startedAt) };
  }
  if (context.freeTargetIds.length < 2) {
    generationLog.push(`تنها ${context.freeTargetIds.length} پرسنل آزادِ گروه هدف وجود دارد؛ برای تولید سناریوی بدیل حداقل ۲ نفر لازم است.`);
    return { result: finalizeScenarioResult([], buildBaselineSchedule(context), emptyFilterStats(), 0, generationLog, context, startedAt) };
  }

  const baseline = buildBaselineSchedule(context);
  const baselineSummary = summarizeScenarioWarnings(baseline.warnings);
  generationLog.push(
    `برنامهٔ مبنا ${baselineSummary.blockingCount} تخلف مسدودکننده و ` +
    `${baselineSummary.advisoryCount} نکتهٔ کیفیت دارد؛ ${context.freeTargetIds.length} پرسنل آزاد، ` +
    `${context.lockedRows.length} قفل‌شده (ارثی).`
  );

  const signatureOf = (schedule: MonthlySchedule): string => context.targetPersonnelIds
    .map(id => `${id}:${Array.from({ length: context.totalDays }, (_, index) => getAssignedShift(schedule, id, index + 1)).join(',')}`)
    .join('|');

  const candidates: ScoredCandidate[] = [];
  const seenCandidates = new Set<string>();
  const scenarioCount = SCENARIO_OBJECTIVE_TRACKS.length;
  for (let seed = 1; seed <= candidateBudget; seed += 1) {
    // بودجه در سه بازهٔ واقعی تقسیم می‌شود تا نوار پیشرفت A/B/C با کاری که موتور
    // انجام می‌دهد منطبق باشد، نه اینکه پس از پایان صرفاً برچسب‌ها عوض شوند.
    const trackIndex = Math.min(
      scenarioCount - 1,
      Math.floor(((seed - 1) * scenarioCount) / candidateBudget)
    );
    const scenarioIndex = trackIndex + 1;
    reportProgress?.({ stage: 'scenario', scenarioIndex, scenarioCount, fraction: (seed - 1) / candidateBudget });

    let candidateSchedule: MonthlySchedule | null = null;
    if (trackIndex === 0) {
      candidateSchedule = buildRequestBiasedCandidate(baseline, seed, context)
        || buildDiversityCandidate(baseline, seed + candidateBudget, context);
    } else if (trackIndex === 1) {
      candidateSchedule = buildFairnessBiasedCandidate(baseline, seed, context)
        || buildDiversityCandidate(baseline, seed + candidateBudget * 2, context);
    } else {
      candidateSchedule = buildDiversityCandidate(baseline, seed + candidateBudget * 3, context);
    }
    if (!candidateSchedule) continue;

    const repaired = repairCriticalAlerts(candidateSchedule, baseline, context);
    const signature = signatureOf(repaired);
    if (seenCandidates.has(signature)) continue;
    seenCandidates.add(signature);
    candidates.push(scoreCandidate(
      repaired,
      seed,
      SCENARIO_OBJECTIVE_TRACKS[trackIndex],
      baseline,
      context
    ));
  }
  reportProgress?.({ stage: 'scenario', scenarioIndex: scenarioCount, scenarioCount, fraction: 1 });

  const filterStats = applyQualityFilter(candidates, baseline, context);
  generationLog.push(`دروازهٔ اعتبار: ${filterStats.survivors.length} نامزدِ بدون تخلف مسدودکننده پذیرفته شد` +
    `${filterStats.droppedForCritical ? `، ${filterStats.droppedForCritical} به‌خاطر تخلف مسدودکننده` : ''}` +
    `${filterStats.droppedForLocks ? `، ${filterStats.droppedForLocks} به‌خاطر نقض قفل` : ''}` +
    `${filterStats.droppedIdentical ? `، ${filterStats.droppedIdentical} چون با مبنا یکی بودند` : ''}` +
    `${filterStats.droppedForDistance ? `، ${filterStats.droppedForDistance} به‌خاطر فاصلهٔ زیاد` : ''}.`);

  const selected = selectObjectiveScenarios(filterStats.survivors, context);
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
