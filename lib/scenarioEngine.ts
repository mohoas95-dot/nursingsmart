/**
 * ScenarioEngine — Multi-Scenario Generation & Scoring (Pure Domain Module)
 *
 * RESPONSIBILITY:
 *   1. تولید ۱۰۰ تا ۵۰۰ سناریوی کاندید با تصادفی‌سازی پارامتریک (مناسب Web Worker).
 *   2. امتیازدهی چندعاملی هر سناریو بر اساس پنج عامل وزن‌دار.
 *   3. انتخاب ۳ تا ۵ سناریوی برتر برای «AI Arena».
 *
 * DESIGN:
 *   - کاملاً خالص (Pure) و قطعی (Deterministic با RNG_seedدار).
 *   - بدون وابستگی به DOM/Window/React/Next → Worker-safe (قابل اجرا در Web Worker).
 *   - بدون وابستگی به solver سنگین؛ تنها از safetyConstraints، routineStrategy و
 *     request-scope-matcher استفاده می‌کند.
 *
 * SCORING WEIGHTS (Task 2):
 *   - Safety & Hard Constraints (32h, Sleep OFF, Min Staffing): 40%
 *   - Required Staffing Coverage:                              25%
 *   - Request Satisfaction (Leaves/Hard OFFs):                 15%
 *   - Routine Tag Preservation & Fairness:                     10%
 *   - Stability & Minimum Manual Edits:                        10%
 *
 * @module lib/scenarioEngine
 */

import type {
  Personnel,
  ShiftRequest,
  SystemSettings,
  ShiftType,
  ScenarioScore,
  ArenaScenario,
} from './types';
import {
  evaluatePersonnelSafety,
  getShiftDurationHours,
  isWorkingShift,
} from './safetyConstraints';
import { getEffectiveRoutineTag, routineShiftScore } from './routineStrategy';
import type { ShiftSlot } from './routineStrategy';
import { isDayInRequestScope } from '../domain/requests/request-scope-matcher';

// ============================================================================
// Constants & Weights
// ============================================================================

/** وزن‌های سیستم امتیازدهی چندعاملی. */
export const SCORING_WEIGHTS = {
  safety: 0.4, // ایمنی و قیود سخت
  coverage: 0.25, // پوشش نیروی موردنیاز
  requestSatisfaction: 0.15, // رضایت از درخواست‌ها
  fairness: 0.1, // حفظ routineTag و عدالت
  stability: 0.1, // ثبات و کمترین ویرایش دستی
} as const;

/** بازهٔ مجاز تعداد سناریوهای کاندید. */
export const MIN_SCENARIO_COUNT = 100;
export const MAX_SCENARIO_COUNT = 500;

/** تعداد پیش‌فرض سناریوهای برگردانده‌شده توسط AI Arena Selector. */
export const DEFAULT_ARENA_LIMIT = 5;

const SINGLE_SHIFTS: ReadonlyArray<ShiftType> = ['M', 'E', 'N'];

// ============================================================================
// Public Types
// ============================================================================

/** یک سناریوی امتیازگرفته. */
export interface ScoredScenario {
  id: string;
  assignments: Record<string, Record<number, ShiftType>>;
  score: ScenarioScore;
  warnings: string[];
  coverageGaps: Array<{ day: number; shift: ShiftSlot; shortage: number }>;
}

/** خروجی انتخاب‌گر AI Arena. */
export interface ArenaSelection {
  /** سناریوهای نهایی برگردانده‌شده (۳ تا ۵، یکتا). */
  scenarios: ArenaScenario[];
  bestOverall?: ArenaScenario;
  fairnessOptimized?: ArenaScenario;
  lowestWarnings?: ArenaScenario;
  highestRequestsMet?: ArenaScenario;
}

/** ورودی مشترک موتور سناریو. */
export interface ScenarioEngineInput {
  personnel: ReadonlyArray<Personnel>;
  requests: ReadonlyArray<ShiftRequest>;
  settings: SystemSettings;
  totalDays: number;
  /** روزهای تعطیل (اثرگذار بر تقاضا و حداقل‌نیرو). */
  holidayDays?: ReadonlyArray<number>;
  /** نگاشت روز → dayOfWeek (۰=شنبه … ۶=جمعه) برای ارزیابی کامل درخواست‌ها. */
  dayOfWeekByDay?: Readonly<Record<number, number>>;
  /** برنامهٔ پایه برای محاسبهٔ ثبات (کمترین ویرایش دستی). */
  baselineAssignments?: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>;
}

/** پیکربندی مولد سناریو. */
export interface ScenarioGeneratorConfig {
  /** تعداد کاندیدها (بین MIN و MAX برش می‌خورد). */
  count: number;
  /** تعداد روزهای ماه. */
  totalDays: number;
  /** seed برای بازتولیدپذیری (پیش‌فرض: ۱). */
  seed?: number;
  /** شدت تصادفی‌سازی ۰..۱ (پیش‌فرض: ۰.۵). */
  randomization?: number;
}

// ============================================================================
// Seeded RNG (deterministic, worker-safe)
// ============================================================================

export type Rng = () => number;

/**
 * ساخت یک مولد اعداد تصادفی seedدار (الگوریتم mulberry32).
 * کاملاً قطعی و مستقل از crypto/DOM → مناسب Web Worker و تست.
 * @pure
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return function rng(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** انتخاب یک عنصر از آرایه با احتمال یکنواخت. @pure (relative to rng) */
function pickRandom<T>(items: ReadonlyArray<T>, rng: Rng): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

// ============================================================================
// Shift composition helpers
// ============================================================================

function shiftContains(shift: ShiftType | undefined, slot: ShiftSlot): boolean {
  if (!shift) return false;
  if (slot === 'M') return shift === 'M' || shift === 'ME' || shift === 'MN' || shift === 'MEN';
  if (slot === 'E') return shift === 'E' || shift === 'ME' || shift === 'EN' || shift === 'MEN';
  return shift === 'N' || shift === 'EN' || shift === 'MN' || shift === 'MEN'; // 'N'
}

/** آیا یک درخواست در روز داده‌شده صدق می‌کند؟ */
function requestAppliesOnDay(
  request: ShiftRequest,
  day: number,
  dayOfWeekOf: (day: number) => number
): boolean {
  return isDayInRequestScope(day, dayOfWeekOf(day), request);
}

/** آیا تخصیصِ یک روز، درخواست را در آن روز تأمین می‌کند؟ */
function requestHonoredOnDay(request: ShiftRequest, assignment: ShiftType | undefined): boolean {
  switch (request.requestType) {
    case 'OFF':
      return assignment === 'OFF';
    case 'leave':
      return !!assignment && assignment.startsWith('L');
    case 'shift': {
      const pref = request.preferredShift;
      if (!pref || pref === 'OFF' || pref === 'L') return assignment === 'OFF';
      return shiftContains(assignment, pref as ShiftSlot);
    }
    case 'avoid_shift': {
      const avoid = request.preferredShift;
      if (!avoid) return true;
      return !shiftContains(assignment, avoid as ShiftSlot);
    }
    case 'pattern':
      // تأمین الگو به‌صورت روزانه ارزیابی نمی‌شود (پیچیده است)؛ در امتیاز رضایت،
      // درخواست‌های الگو نادیده گرفته می‌شوند تا امتیاز را اغراق‌نکرده نباشند.
      // (برای دقت بیشتر می‌توان این شاخه را در آینده بسط داد.)
      return true;
    default:
      return true;
  }
}

// ============================================================================
// Task 1 — Multi-Scenario Generator
// ============================================================================

/**
 * تولید یک سلول (شیفت یک پرسنل در یک روز) بر اساس درخواست‌ها، routineTag و تصادفی‌سازی.
 * @pure (relative to rng)
 */
function generateCell(
  personId: string,
  day: number,
  requests: ReadonlyArray<ShiftRequest>,
  effTag: ReturnType<typeof getEffectiveRoutineTag>,
  rng: Rng,
  randomization: number,
  dayOfWeekOf: (day: number) => number
): ShiftType {
  // ۱) قیود سخت ابتدا: مرخصی و آف قطعی.
  for (const r of requests) {
    if (r.personnelId !== personId) continue;
    if (!requestAppliesOnDay(r, day, dayOfWeekOf)) continue;
    if (r.requestType === 'leave') return 'L1';
    if (r.requestType === 'OFF') return 'OFF';
  }

  // ۲) درخواست شیفت مشخص: با احتمال بالا پذیرفته می‌شود.
  for (const r of requests) {
    if (r.personnelId !== personId) continue;
    if (!requestAppliesOnDay(r, day, dayOfWeekOf)) continue;
    if (r.requestType === 'shift' && r.preferredShift) {
      const pref = r.preferredShift;
      if (pref !== 'OFF' && pref !== 'L') {
        if (rng() > randomization * 0.3) {
          // شیفت ترجیحی (تک‌نوبته) را قرار بده.
          if (pref === 'M' || pref === 'E' || pref === 'N') return pref;
        }
      }
    }
  }

  // ۳) پر کردن تصادفی با وزنِ routineTag.
  //    وزن هر نوبت = پایه + امتیاز تطابق با روتین.
  const weights = SINGLE_SHIFTS.map((s) => 1 + routineShiftScore(effTag, s as ShiftSlot) * 3);
  // گاهی استراحت (OFF) برای تنوع و واقع‌گرایی.
  if (rng() < 0.3) return 'OFF';

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let r = rng() * totalWeight;
  for (let i = 0; i < SINGLE_SHIFTS.length; i++) {
    r -= weights[i];
    if (r <= 0) return SINGLE_SHIFTS[i];
  }
  return pickRandom(SINGLE_SHIFTS, rng);
}

/**
 * تولید یک سناریوی کاندید واحد.
 * @pure (relative to rng)
 */
function generateOneScenario(
  input: ScenarioEngineInput,
  rng: Rng,
  randomization: number
): Record<string, Record<number, ShiftType>> {
  const { personnel, requests, totalDays } = input;
  const dayOfWeekOf = makeDayOfWeekFn(input);
  const active = personnel.filter((p) => p.active);
  const assignments: Record<string, Record<number, ShiftType>> = {};

  for (const p of active) {
    const effTag = getEffectiveRoutineTag(p, requests);
    const row: Record<number, ShiftType> = {};
    for (let day = 1; day <= totalDays; day++) {
      row[day] = generateCell(p.id, day, requests, effTag, rng, randomization, dayOfWeekOf);
    }
    assignments[p.id] = row;
  }
  return assignments;
}

/**
 * تولید چندین سناریوی کاندید با تصادفی‌سازی پارامتریک.
 *
 * @pure (deterministic برای seed ثابت) — مناسب اجرا در Web Worker.
 */
export function generateScenarios(
  input: ScenarioEngineInput,
  config: ScenarioGeneratorConfig
): Array<Record<string, Record<number, ShiftType>>> {
  const count = clamp(config.count, MIN_SCENARIO_COUNT, MAX_SCENARIO_COUNT);
  const seed = config.seed ?? 1;
  const randomization = clamp(config.randomization ?? 0.5, 0, 1);
  const baseRng = createRng(seed);

  const scenarios: Array<Record<string, Record<number, ShiftType>>> = [];
  for (let i = 0; i < count; i++) {
    // هر سناریو seed مستقل (اما بازتولیدپذیر) می‌گیرد تا تنوع تضمین شود.
    const scenarioSeed = Math.floor(baseRng() * 0xffffffff) ^ (i * 2654435761);
    const rng = createRng(scenarioSeed >>> 0);
    scenarios.push(generateOneScenario(input, rng, randomization));
  }
  return scenarios;
}

// ============================================================================
// Task 2 — Multi-Factor Scoring
// ============================================================================

/** محاسبهٔ پوشش نیرو و شکاف‌های آن. @pure */
function scoreCoverage(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  personnel: ReadonlyArray<Personnel>,
  settings: SystemSettings,
  totalDays: number,
  holidayDays: ReadonlySet<number>
): { coverage: number; gaps: ScoredScenario['coverageGaps']; minStaffingFails: number } {
  const nurses = personnel.filter((p) => p.active && p.jobGroup === 'nurse');
  const assistants = personnel.filter((p) => p.active && p.jobGroup === 'assistant');

  let sumRatio = 0;
  let slotCount = 0;
  const gaps: ScoredScenario['coverageGaps'] = [];
  let minStaffingFails = 0;

  for (let day = 1; day <= totalDays; day++) {
    const isHoliday = holidayDays.has(day);
    const demand = isHoliday ? settings.demand.holiday : settings.demand.weekday;
    const slots: Array<{ slot: ShiftSlot; nurseDemand: number; asstDemand: number }> = [
      { slot: 'M', nurseDemand: demand.morningNurse, asstDemand: demand.morningAssistant },
      { slot: 'E', nurseDemand: demand.afternoonNurse, asstDemand: demand.afternoonAssistant },
      { slot: 'N', nurseDemand: demand.nightNurse, asstDemand: demand.nightAssistant },
    ];

    for (const { slot, nurseDemand, asstDemand } of slots) {
      const nurseAssigned = nurses.filter((n) => shiftContains(assignments[n.id]?.[day], slot)).length;
      const asstAssigned = assistants.filter((a) => shiftContains(assignments[a.id]?.[day], slot)).length;
      const demandTotal = nurseDemand + asstDemand;
      const assignedTotal = nurseAssigned + asstAssigned;

      if (demandTotal > 0) {
        const ratio = Math.min(1, assignedTotal / demandTotal);
        sumRatio += ratio;
        slotCount += 1;
        if (assignedTotal < demandTotal) {
          gaps.push({ day, shift: slot, shortage: demandTotal - assignedTotal });
        }
        // حداقل‌نیرو: هیچ نیرویی برای یک جایگاه موردنیاز → نقض سخت.
        if (assignedTotal === 0) minStaffingFails += 1;
      }
    }
  }

  const coverage = slotCount > 0 ? (sumRatio / slotCount) * 100 : 100;
  return { coverage, gaps, minStaffingFails };
}

/** محاسبهٔ رضایت از درخواست‌ها. @pure */
function scoreRequestSatisfaction(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  requests: ReadonlyArray<ShiftRequest>,
  totalDays: number,
  dayOfWeekOf: (day: number) => number
): number {
  if (requests.length === 0) return 100;

  let weightedSum = 0;
  let weightTotal = 0;

  for (const r of requests) {
    let applicable = 0;
    let honored = 0;
    for (let day = 1; day <= totalDays; day++) {
      if (!requestAppliesOnDay(r, day, dayOfWeekOf)) continue;
      applicable += 1;
      if (requestHonoredOnDay(r, assignments[r.personnelId]?.[day])) honored += 1;
    }
    if (applicable === 0) continue; // درخواست ارزیابی‌نشدنی → نادیده.
    const reqScore = honored / applicable;
    const weight = r.isEssential ? 2 : 1;
    weightedSum += reqScore * weight;
    weightTotal += weight;
  }

  return weightTotal > 0 ? (weightedSum / weightTotal) * 100 : 100;
}

/** محاسبهٔ عدالت توزیع ساعت + حفظ routineTag. @pure */
function scoreFairness(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  personnel: ReadonlyArray<Personnel>,
  requests: ReadonlyArray<ShiftRequest>,
  totalDays: number
): number {
  const active = personnel.filter((p) => p.active);
  if (active.length === 0) return 100;

  // ۱) عدالت: واریانس ساعات کاری (کمتر = عادلانه‌تر).
  const hours = active.map((p) => {
    let h = 0;
    const row = assignments[p.id] ?? {};
    for (let day = 1; day <= totalDays; day++) {
      h += getShiftDurationHours(row[day] ?? 'OFF');
    }
    return h;
  });
  const fairnessHours = coefficientOfVariationScore(hours);

  // ۲) حفظ routineTag: کسر شیفت‌های هم‌خوان با روتین مؤثر.
  let tagHits = 0;
  let tagTotal = 0;
  for (const p of active) {
    const effTag = getEffectiveRoutineTag(p, requests);
    const row = assignments[p.id] ?? {};
    for (let day = 1; day <= totalDays; day++) {
      const s = row[day];
      if (!isWorkingShift(s)) continue;
      // شیفت را به نخستین نوبت اصلی‌اش نگاشت کن.
      const primary = primarySlotOf(s as ShiftType);
      if (!primary) continue;
      tagTotal += 1;
      if (routineShiftScore(effTag, primary) > 0) tagHits += 1;
    }
  }
  const tagScore = tagTotal > 0 ? (tagHits / tagTotal) * 100 : 100;

  // ترکیب: ۶۰٪ عدالت + ۴۰٪ حفظ روتین.
  return clamp(fairnessHours * 0.6 + tagScore * 0.4, 0, 100);
}

/** محاسبهٔ ثبات (شباهت به برنامهٔ پایه). @pure */
function scoreStability(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  baseline: Readonly<Record<string, Readonly<Record<number, ShiftType>>>> | undefined,
  personnel: ReadonlyArray<Personnel>,
  totalDays: number
): number {
  if (!baseline) return 100; // بدون برنامهٔ پایه، ثبات کامل فرض می‌شود.
  const active = personnel.filter((p) => p.active);
  if (active.length === 0) return 100;

  let same = 0;
  let total = 0;
  for (const p of active) {
    const cur = assignments[p.id] ?? {};
    const base = baseline[p.id] ?? {};
    for (let day = 1; day <= totalDays; day++) {
      total += 1;
      if ((cur[day] ?? 'OFF') === (base[day] ?? 'OFF')) same += 1;
    }
  }
  return total > 0 ? (same / total) * 100 : 100;
}

/** محاسبهٔ ایمنی و قیود سخت. @pure */
function scoreSafety(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  personnel: ReadonlyArray<Personnel>,
  totalDays: number,
  minStaffingFails: number
): { safety: number; violations: number; warnings: string[] } {
  const warnings: string[] = [];
  let cumulativeViolations = 0;
  let nightViolations = 0;

  for (const p of personnel) {
    if (!p.active) continue;
    const report = evaluatePersonnelSafety(p.id, assignments[p.id] ?? {}, { totalDays });
    cumulativeViolations += report.cumulativeHourViolations.length;
    nightViolations += report.nightRecoveryViolations.length;
    for (const v of report.cumulativeHourViolations) warnings.push(v.message);
    for (const v of report.nightRecoveryViolations) warnings.push(v.message);
  }

  // هر نقض، امتیاز ایمنی را کاهش می‌دهد.
  const penalty =
    cumulativeViolations * 8 + nightViolations * 8 + minStaffingFails * 5;
  const safety = clamp(100 - penalty, 0, 100);
  const violations = cumulativeViolations + nightViolations + minStaffingFails;

  return { safety, violations, warnings };
}

/**
 * امتیازدهی کامل یک سناریوی کاندید.
 * @pure
 */
export function scoreScenario(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  input: ScenarioEngineInput
): ScoredScenario {
  const { personnel, requests, settings, totalDays, baselineAssignments } = input;
  const holidayDays = new Set(input.holidayDays ?? []);
  const dayOfWeekOf = makeDayOfWeekFn(input);

  const { coverage, gaps, minStaffingFails } = scoreCoverage(
    assignments,
    personnel,
    settings,
    totalDays,
    holidayDays
  );
  const { safety, violations, warnings } = scoreSafety(
    assignments,
    personnel,
    totalDays,
    minStaffingFails
  );
  const requestSatisfaction = scoreRequestSatisfaction(
    assignments,
    requests,
    totalDays,
    dayOfWeekOf
  );
  const fairness = scoreFairness(assignments, personnel, requests, totalDays);
  const stability = scoreStability(assignments, baselineAssignments, personnel, totalDays);

  const score: ScenarioScore = {
    coverage: round1(coverage),
    fairness: round1(fairness),
    requestSatisfaction: round1(requestSatisfaction),
    ruleCompliance: round1(safety),
    stability: round1(stability),
    warningCount: violations + gaps.length,
    unfilledCount: gaps.length,
    total: round1(
      safety * SCORING_WEIGHTS.safety +
        coverage * SCORING_WEIGHTS.coverage +
        requestSatisfaction * SCORING_WEIGHTS.requestSatisfaction +
        fairness * SCORING_WEIGHTS.fairness +
        stability * SCORING_WEIGHTS.stability
    ),
  };

  return { id: '', assignments: cloneAssignments(assignments), score, warnings, coverageGaps: gaps };
}

// ============================================================================
// Task 3 — AI Arena Selector
// ============================================================================

/**
 * تبدیل یک سناریوی امتیازگرفته به ArenaScenario.
 * @pure
 */
export function buildArenaScenario(
  scored: ScoredScenario,
  label: string,
  generatedBy: string,
  createdAt: string
): ArenaScenario {
  return {
    id: scored.id,
    label,
    assignments: scored.assignments,
    score: scored.score,
    warnings: scored.warnings,
    coverageGaps: scored.coverageGaps,
    generatedBy,
    createdAt,
    notes: `امتیاز کل: ${scored.score.total} | پوشش: ${scored.score.coverage} | هشدارها: ${scored.score.warningCount}`,
  };
}

/**
 * انتخاب ۳ تا ۵ سناریوی برتر بر اساس دسته‌بندی‌های AI Arena.
 *
 *   - bestOverall:        بیشترین total
 *   - fairnessOptimized:  بیشترین fairness
 *   - lowestWarnings:     کمترین warningCount
 *   - highestRequestsMet: بیشترین requestSatisfaction
 *
 * سناریوهای تکراری (بر اساس id) حذف می‌شوند تا حداقل تنوع حفظ شود.
 * @pure
 */
export function selectTopScenarios(
  scored: ReadonlyArray<ScoredScenario>,
  options: { limit?: number; generatedBy?: string; createdAt?: string } = {}
): ArenaSelection {
  const limit = clamp(options.limit ?? DEFAULT_ARENA_LIMIT, 3, 5);
  const generatedBy = options.generatedBy ?? 'arena-engine';
  const createdAt = options.createdAt ?? new Date().toISOString();

  if (scored.length === 0) {
    return { scenarios: [] };
  }

  const byTotal = [...scored].sort((a, b) => b.score.total - a.score.total);
  const byFairness = [...scored].sort(
    (a, b) => b.score.fairness - a.score.fairness || b.score.total - a.score.total
  );
  const byLowestWarnings = [...scored].sort(
    (a, b) => a.score.warningCount - b.score.warningCount || b.score.total - a.score.total
  );
  const byRequests = [...scored].sort(
    (a, b) =>
      b.score.requestSatisfaction - a.score.requestSatisfaction || b.score.total - a.score.total
  );

  const bestOverall = byTotal[0];
  const fairnessOptimized = byFairness[0];
  const lowestWarnings = byLowestWarnings[0];
  const highestRequestsMet = byRequests[0];

  // جمع‌آوری یکتا به‌ترتیب اولویت دسته‌ها تا سقف limit.
  const ordered = [bestOverall, fairnessOptimized, lowestWarnings, highestRequestsMet];
  const seen = new Set<string>();
  const picked: ScoredScenario[] = [];
  for (const s of ordered) {
    if (s && !seen.has(s.id)) {
      seen.add(s.id);
      picked.push(s);
    }
    if (picked.length >= limit) break;
  }
  // پر کردن با بقیهٔ برترین‌ها تا رسیدن به limit.
  for (const s of byTotal) {
    if (picked.length >= limit) break;
    if (!seen.has(s.id)) {
      seen.add(s.id);
      picked.push(s);
    }
  }

  const idCategory = new Map<string, string>();
  if (bestOverall) idCategory.set(bestOverall.id, 'بهترین کلی');
  if (fairnessOptimized && !idCategory.has(fairnessOptimized.id)) idCategory.set(fairnessOptimized.id, 'بهینه‌شده برای عدالت');
  if (lowestWarnings && !idCategory.has(lowestWarnings.id)) idCategory.set(lowestWarnings.id, 'کمترین هشدار');
  if (highestRequestsMet && !idCategory.has(highestRequestsMet.id)) idCategory.set(highestRequestsMet.id, 'بیشترین رضایت درخواست‌ها');

  const scenarios = picked.map((s) =>
    buildArenaScenario(s, idCategory.get(s.id) ?? 'سناریوی جایگزین', generatedBy, createdAt)
  );

  const findArena = (s: ScoredScenario | undefined) =>
    s ? scenarios.find((a) => a.id === s.id) : undefined;

  return {
    scenarios,
    bestOverall: findArena(bestOverall),
    fairnessOptimized: findArena(fairnessOptimized),
    lowestWarnings: findArena(lowestWarnings),
    highestRequestsMet: findArena(highestRequestsMet),
  };
}

// ============================================================================
// Orchestration
// ============================================================================

/**
 * تولید، امتیازدهی و انتخاب سناریوها در یک فراخوانی.
 *
 * این تابع بار محاسباتی سنگینی دارد و برای اجرا در Web Worker طراحی شده است؛
 * خروجی آن فقط ۳ تا ۵ سناریوی برتر است.
 *
 * @pure برای createdAt داده‌شده.
 */
export function generateScoreAndSelect(
  input: ScenarioEngineInput,
  config: ScenarioGeneratorConfig,
  options: { limit?: number; generatedBy?: string; createdAt?: string } = {}
): ArenaSelection {
  const candidates = generateScenarios(input, config);
  const scored = candidates.map((assignments, idx) => {
    const s = scoreScenario(assignments, input);
    s.id = `scn_${idx + 1}`;
    return s;
  });
  return selectTopScenarios(scored, { ...options, createdAt: options.createdAt ?? new Date().toISOString() });
}

// ============================================================================
// Internal utilities
// ============================================================================

function makeDayOfWeekFn(input: ScenarioEngineInput): (day: number) => number {
  const map = input.dayOfWeekByDay ?? {};
  return (day: number) => (map[day] !== undefined ? map[day] : -1);
}

function primarySlotOf(shift: ShiftType): ShiftSlot | null {
  if (shift === 'M' || shift === 'ME' || shift === 'MN' || shift === 'MEN') return 'M';
  if (shift === 'E' || shift === 'EN') return 'E';
  if (shift === 'N') return 'N';
  return null;
}

function coefficientOfVariationScore(values: number[]): number {
  if (values.length === 0) return 100;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 100;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean; // ضریب تغییرات
  // cv=0 → 100؛ هرچه بیشتر، امتیاز کمتر. cv≥۱ → ~۰.
  return clamp(100 * Math.exp(-cv), 0, 100);
}

function cloneAssignments(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>
): Record<string, Record<number, ShiftType>> {
  const out: Record<string, Record<number, ShiftType>> = {};
  for (const [pid, row] of Object.entries(assignments)) {
    out[pid] = { ...row };
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
