/**
 * Unit & Integration Tests — ScenarioEngine (lib/scenarioEngine.ts) — Phase 4
 *
 * Run: tsx --test tests/scenario-engine.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCORING_WEIGHTS,
  MIN_SCENARIO_COUNT,
  MAX_SCENARIO_COUNT,
  DEFAULT_ARENA_LIMIT,
  createRng,
  generateScenarios,
  scoreScenario,
  selectTopScenarios,
  buildArenaScenario,
  generateScoreAndSelect,
} from '../lib/scenarioEngine';
import type { ScoredScenario } from '../lib/scenarioEngine';
import type {
  Personnel,
  ShiftRequest,
  SystemSettings,
} from '../lib/types';

// ============================================================================
// Fixtures
// ============================================================================

function person(id: string, routineTag: Personnel['routineTag'] = 'ROTATING_GENERAL'): Personnel {
  return {
    id,
    firstName: 'T',
    lastName: id,
    personalCode: id,
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'official',
    experienceYears: 3,
    active: true,
    canBeShiftLeader: false,
    routineTag,
  };
}

function minimalSettings(demand = 1): SystemSettings {
  const d = {
    morningNurse: demand,
    morningAssistant: 0,
    afternoonNurse: demand,
    afternoonAssistant: 0,
    afternoonLeader: 0,
    nightNurse: demand,
    nightAssistant: 0,
    nightLeader: 0,
  };
  return {
    dutyHours: { official: 160, contract: 170, conscript: 180, overtime: 0 },
    demand: { weekday: { ...d }, holiday: { ...d } },
  };
}

/** تقاضای دانه‌دانه برای پرستار در نوبت‌های M/E/N (کمک‌بهیار و سرشیفت صفر). */
function slotSettings(m = 0, e = 0, n = 0): SystemSettings {
  const d = {
    morningNurse: m,
    morningAssistant: 0,
    afternoonNurse: e,
    afternoonAssistant: 0,
    afternoonLeader: 0,
    nightNurse: n,
    nightAssistant: 0,
    nightLeader: 0,
  };
  return {
    dutyHours: { official: 160, contract: 170, conscript: 180, overtime: 0 },
    demand: { weekday: { ...d }, holiday: { ...d } },
  };
}

function leaveRequest(id: string, personnelId: string, fromDay: number, toDay: number): ShiftRequest {
  return {
    id,
    personnelId,
    requestType: 'leave',
    isEssential: true,
    scope: 'range',
    startDate: `1405/03/${String(fromDay).padStart(2, '0')}`,
    endDate: `1405/03/${String(toDay).padStart(2, '0')}`,
  };
}

function offRequest(id: string, personnelId: string): ShiftRequest {
  return { id, personnelId, requestType: 'OFF', isEssential: true, scope: 'all' };
}

function shiftRequest(id: string, personnelId: string, preferredShift: ShiftRequest['preferredShift']): ShiftRequest {
  return { id, personnelId, requestType: 'shift', preferredShift, isEssential: false, scope: 'all' };
}

// ============================================================================
// Constants & RNG
// ============================================================================

test('SCORING_WEIGHTS sum to 1.0', () => {
  const sum = SCORING_WEIGHTS.safety + SCORING_WEIGHTS.coverage + SCORING_WEIGHTS.requestSatisfaction + SCORING_WEIGHTS.fairness + SCORING_WEIGHTS.stability;
  assert.ok(Math.abs(sum - 1.0) < 1e-9, `weights sum to ${sum}`);
  assert.equal(SCORING_WEIGHTS.safety, 0.4);
  assert.equal(SCORING_WEIGHTS.coverage, 0.25);
});

test('scenario count bounds and defaults', () => {
  assert.equal(MIN_SCENARIO_COUNT, 100);
  assert.equal(MAX_SCENARIO_COUNT, 500);
  assert.equal(DEFAULT_ARENA_LIMIT, 5);
});

test('createRng is deterministic for a fixed seed', () => {
  const a = createRng(42);
  const b = createRng(42);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  // همهٔ خروجی‌ها در بازهٔ [۰,۱).
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

// ============================================================================
// Task 1 — Multi-Scenario Generator
// ============================================================================

test('generateScenarios: produces exactly the requested count (clamped)', () => {
  const input = {
    personnel: [person('p1')],
    requests: [],
    settings: minimalSettings(),
    totalDays: 7,
  };
  assert.equal(generateScenarios(input, { count: 100, totalDays: 7 }).length, 100);
  assert.equal(generateScenarios(input, { count: 50, totalDays: 7 }).length, 100); // clamped up
  assert.equal(generateScenarios(input, { count: 1000, totalDays: 7 }).length, 500); // clamped down
});

test('generateScenarios: is deterministic for a fixed seed', () => {
  const input = {
    personnel: [person('p1'), person('p2')],
    requests: [],
    settings: minimalSettings(),
    totalDays: 5,
  };
  const a = generateScenarios(input, { count: 100, totalDays: 5, seed: 7 });
  const b = generateScenarios(input, { count: 100, totalDays: 5, seed: 7 });
  assert.deepEqual(a, b);
});

test('generateScenarios: respects hard leave requests on all candidates', () => {
  const input = {
    personnel: [person('p1')],
    requests: [leaveRequest('r1', 'p1', 3, 5)],
    settings: minimalSettings(),
    totalDays: 7,
  };
  const scenarios = generateScenarios(input, { count: 100, totalDays: 7 });
  for (const s of scenarios) {
    assert.equal(s.p1[3], 'L1');
    assert.equal(s.p1[4], 'L1');
    assert.equal(s.p1[5], 'L1');
  }
});

test('generateScenarios: respects hard OFF-all requests (every day OFF)', () => {
  const input = {
    personnel: [person('p1')],
    requests: [offRequest('r1', 'p1')],
    settings: minimalSettings(),
    totalDays: 5,
  };
  const scenarios = generateScenarios(input, { count: 100, totalDays: 5 });
  for (const s of scenarios) {
    for (let d = 1; d <= 5; d++) assert.equal(s.p1[d], 'OFF');
  }
});

// ============================================================================
// Task 2 — Multi-Factor Scoring
// ============================================================================

test('scoreScenario: perfect single-nurse coverage → coverage 100', () => {
  const input = {
    personnel: [person('p1')],
    requests: [],
    settings: slotSettings(1, 0, 0), // فقط صبح تقاضا دارد
    totalDays: 3,
  };
  const assignments = { p1: { 1: 'M', 2: 'M', 3: 'M' } };
  const scored = scoreScenario(assignments, input);
  assert.equal(scored.score.coverage, 100);
  // هر سه روز صبح پوشش داده شده، شکافی نیست.
  assert.equal(scored.coverageGaps.length, 0);
});

test('scoreScenario: zero coverage → coverage 0 and gaps recorded', () => {
  const input = {
    personnel: [person('p1')],
    requests: [],
    settings: minimalSettings(1),
    totalDays: 3,
  };
  // پرسنل همه‌جا OFF → هیچ تقاضایی پوشش داده نمی‌شود.
  const assignments = { p1: { 1: 'OFF', 2: 'OFF', 3: 'OFF' } };
  const scored = scoreScenario(assignments, input);
  assert.equal(scored.score.coverage, 0);
  assert.ok(scored.coverageGaps.length > 0);
});

test('scoreScenario: night-then-morning lowers safety (ruleCompliance < 100)', () => {
  const input = {
    personnel: [person('p1')],
    requests: [],
    settings: slotSettings(0, 0, 0), // بدون تقاضا تا فقط نقض شب‌کار سنجیده شود
    totalDays: 3,
  };
  const bad = { p1: { 1: 'N', 2: 'M', 3: 'OFF' } }; // نقض استراحت بعد از شب‌کار
  const good = { p1: { 1: 'M', 2: 'M', 3: 'OFF' } };
  assert.ok(scoreScenario(bad, input).score.ruleCompliance < 100);
  assert.equal(scoreScenario(good, input).score.ruleCompliance, 100);
});

test('scoreScenario: request satisfaction honors a shift preference', () => {
  const input = {
    personnel: [person('p1')],
    requests: [shiftRequest('r1', 'p1', 'M')],
    settings: minimalSettings(0), // تقاضا صفر تا فقط رضایت درخواست سنجیده شود
    totalDays: 3,
  };
  const honored = { p1: { 1: 'M', 2: 'M', 3: 'M' } };
  const ignored = { p1: { 1: 'E', 2: 'E', 3: 'E' } };
  assert.equal(scoreScenario(honored, input).score.requestSatisfaction, 100);
  assert.equal(scoreScenario(ignored, input).score.requestSatisfaction, 0);
});

test('scoreScenario: stability reflects similarity to baseline', () => {
  const baseline = { p1: { 1: 'M', 2: 'E', 3: 'N' } };
  const input = {
    personnel: [person('p1')],
    requests: [],
    settings: minimalSettings(0),
    totalDays: 3,
    baselineAssignments: baseline,
  };
  const same = scoreScenario({ p1: { 1: 'M', 2: 'E', 3: 'N' } }, input);
  const diff = scoreScenario({ p1: { 1: 'OFF', 2: 'OFF', 3: 'OFF' } }, input);
  assert.equal(same.score.stability, 100);
  assert.equal(diff.score.stability, 0);
});

test('scoreScenario: total is the weighted combination of sub-scores', () => {
  const input = {
    personnel: [person('p1')],
    requests: [],
    settings: minimalSettings(0),
    totalDays: 3,
  };
  const scored = scoreScenario({ p1: { 1: 'M', 2: 'E', 3: 'OFF' } }, input);
  const expected =
    scored.score.ruleCompliance * SCORING_WEIGHTS.safety +
    scored.score.coverage * SCORING_WEIGHTS.coverage +
    scored.score.requestSatisfaction * SCORING_WEIGHTS.requestSatisfaction +
    scored.score.fairness * SCORING_WEIGHTS.fairness +
    scored.score.stability * SCORING_WEIGHTS.stability;
  assert.ok(Math.abs(scored.score.total - Math.round(expected * 10) / 10) < 0.05);
  // همهٔ زیرامتیازها و کل در بازهٔ [۰,۱۰۰].
  for (const v of [scored.score.coverage, scored.score.fairness, scored.score.requestSatisfaction, scored.score.ruleCompliance, scored.score.stability, scored.score.total]) {
    assert.ok(v >= 0 && v <= 100, `sub-score out of range: ${v}`);
  }
});

// ============================================================================
// Task 3 — AI Arena Selector
// ============================================================================

function makeScored(id: string, partial: Partial<ScoredScenario['score']> = {}): ScoredScenario {
  return {
    id,
    assignments: {},
    warnings: [],
    coverageGaps: [],
    score: {
      coverage: 50,
      fairness: 50,
      requestSatisfaction: 50,
      ruleCompliance: 50,
      stability: 50,
      warningCount: 10,
      unfilledCount: 0,
      total: 50,
      ...partial,
    },
  };
}

test('selectTopScenarios: returns the four category winners', () => {
  const scored = [
    makeScored('best', { total: 90 }),
    makeScored('fair', { fairness: 95, total: 70 }),
    makeScored('lowwarn', { warningCount: 1, total: 65 }),
    makeScored('reqs', { requestSatisfaction: 99, total: 60 }),
    makeScored('other', { total: 40 }),
  ];
  const sel = selectTopScenarios(scored, { createdAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(sel.bestOverall!.id, 'best');
  assert.equal(sel.fairnessOptimized!.id, 'fair');
  assert.equal(sel.lowestWarnings!.id, 'lowwarn');
  assert.equal(sel.highestRequestsMet!.id, 'reqs');
});

test('selectTopScenarios: dedupes and respects limit', () => {
  // یک سناریو در همهٔ دسته‌ها برنده است.
  const scored = [makeScored('only', { total: 99, fairness: 99, warningCount: 0, requestSatisfaction: 99 })];
  const sel = selectTopScenarios(scored, { limit: 3, createdAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(sel.scenarios.length, 1);
  assert.equal(sel.bestOverall!.id, 'only');
  assert.equal(sel.fairnessOptimized!.id, 'only');
});

test('selectTopScenarios: limit clamped to [3,5]', () => {
  const scored = Array.from({ length: 10 }, (_, i) => makeScored(`s${i}`, { total: i }));
  const selLow = selectTopScenarios(scored, { limit: 1, createdAt: '2026-01-01T00:00:00.000Z' });
  const selHigh = selectTopScenarios(scored, { limit: 99, createdAt: '2026-01-01T00:00:00.000Z' });
  assert.ok(selLow.scenarios.length >= 3);
  assert.ok(selHigh.scenarios.length <= 5);
});

test('selectTopScenarios: empty input yields empty selection', () => {
  const sel = selectTopScenarios([], { createdAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(sel.scenarios.length, 0);
  assert.equal(sel.bestOverall, undefined);
});

test('buildArenaScenario: maps fields and includes a notes summary', () => {
  const scored = makeScored('x', { total: 77.7, coverage: 80, warningCount: 3 });
  const arena = buildArenaScenario(scored, 'برچسب', 'arena-engine', '2026-01-01T00:00:00.000Z');
  assert.equal(arena.id, 'x');
  assert.equal(arena.label, 'برچسب');
  assert.equal(arena.generatedBy, 'arena-engine');
  assert.equal(arena.createdAt, '2026-01-01T00:00:00.000Z');
  assert.ok(arena.notes!.includes('77.7'));
});

// ============================================================================
// End-to-end orchestration
// ============================================================================

test('generateScoreAndSelect: end-to-end returns 3–5 arena scenarios', () => {
  const input = {
    personnel: [person('p1', 'MORNING_ONLY'), person('p2', 'EVENING_NIGHT')],
    requests: [leaveRequest('r1', 'p1', 2, 2)],
    settings: minimalSettings(1),
    totalDays: 7,
  };
  const sel = generateScoreAndSelect(input, { count: 100, totalDays: 7, seed: 1 }, {
    limit: 5,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  assert.ok(sel.scenarios.length >= 3 && sel.scenarios.length <= 5);
  assert.ok(sel.bestOverall);
  // سناریوهای برگردانده‌شده یکتا هستند.
  const ids = sel.scenarios.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  // هر ArenaScenario امتیاز معتبر دارد.
  for (const s of sel.scenarios) {
    assert.ok(s.score.total >= 0 && s.score.total <= 100);
  }
});
