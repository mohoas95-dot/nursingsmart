/**
 * Solver characterization / regression baseline tests.
 *
 * PURPOSE (Session 1): record the CURRENT behavior of the Solver before any refactor.
 * These tests do NOT assert "desired" behavior; they pin what the code actually does
 * today, including known questionable behaviors (marked `[CURRENT-BEHAVIOR]`).
 *
 * No product logic was changed to make these tests pass.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  solveNursingSchedule,
  verifyCoverageAndLeaders,
  checkProductivityEligibility,
  calculateShiftProductivity,
} from '../lib/solver';
import { reconcileStaffingCoverage } from '../domain/scheduling/staffing-coverage';
import { mergeOptimizerAssignments } from '../domain/scheduling/schedule-operations';
import { generateAndScoreScenarios } from '../lib/scenarioGenerator';
import type { Personnel, ShiftRequest, SystemSettings } from '../lib/types';
import {
  makePerson,
  makeSettings,
  makeRequest,
  realisticPersonnel,
  realisticRequests,
  realisticSettings,
  scenarioFeasible,
  scenarioNearInfeasible,
  scenarioInfeasible,
  coversM,
  coversE,
  coversN,
  CAL_YEAR,
  CAL_MONTH,
  FRIDAYS,
} from './fixtures/realistic';

const isFriday = (day: number) => FRIDAYS.includes(day);

function solved(
  personnel: Personnel[],
  requests: ShiftRequest[],
  settings: SystemSettings,
  holidays: Record<number, string> = {}
) {
  return solveNursingSchedule(CAL_YEAR, CAL_MONTH, personnel, requests, settings, holidays, undefined, null);
}

/** M/E/N nurse headcount on a single day. */
function nurseCoverage(
  schedule: ReturnType<typeof solved>,
  personnel: Personnel[],
  day: number
): { m: number; e: number; n: number } {
  let m = 0, e = 0, n = 0;
  for (const p of personnel) {
    const s = schedule.assignments[p.id]?.[day];
    if (coversM(s)) m++;
    if (coversE(s)) e++;
    if (coversN(s)) n++;
  }
  return { m, e, n };
}

function daysInMonth(): number {
  return 31; // Khordad 1404 has 31 days (fixed fixture calendar)
}

// ---------------------------------------------------------------------------
// 1. Coverage
// ---------------------------------------------------------------------------
test('coverage: solver meets the exact configured M/E/N counts for a feasible roster', () => {
  const p = scenarioFeasible();
  const s = solved(p.personnel, p.requests, p.settings);
  for (let d = 1; d <= daysInMonth(); d++) {
    const c = nurseCoverage(s, p.personnel, d);
    const wantM = isFriday(d) ? p.settings.demand.holiday.morningNurse : p.settings.demand.weekday.morningNurse;
    const wantE = isFriday(d) ? p.settings.demand.holiday.afternoonNurse : p.settings.demand.weekday.afternoonNurse;
    const wantN = isFriday(d) ? p.settings.demand.holiday.nightNurse : p.settings.demand.weekday.nightNurse;
    assert.equal(c.m, wantM, `day ${d} M coverage`);
    assert.equal(c.e, wantE, `day ${d} E coverage`);
    assert.equal(c.n, wantN, `day ${d} N coverage`);
  }
});

// ---------------------------------------------------------------------------
// 2. Leave
// ---------------------------------------------------------------------------
test('leave: approved leave is numbered L1..Ln and preserved', () => {
  const s = solved(realisticPersonnel(), realisticRequests(), realisticSettings());
  assert.equal(s.assignments.long?.[10], 'L1');
  assert.equal(s.assignments.long?.[11], 'L2');
  assert.equal(s.assignments.long?.[12], 'L3');
});

test('[CURRENT-BEHAVIOR] leave: a 4-day leave is reported as a "Consecutive OFFs" violation', () => {
  const personnel = [
    makePerson('sup', { position: 'supervisor' }),
    makePerson('stf', { position: 'staff' }),
    makePerson('g1'),
    makePerson('g2'),
    makePerson('g3'),
  ];
  const requests = [makeRequest('g1', { id: 'l', requestType: 'leave', isEssential: true, scope: 'custom_days', selectedDays: [3, 4, 5, 6] })];
  const s = solved(personnel, requests, makeSettings());
  assert.ok(
    s.warnings.some(w => w.startsWith('Consecutive OFFs:') && w.includes('g1 T')),
    'expected a Consecutive OFFs warning for the 4-day leave'
  );
});

// ---------------------------------------------------------------------------
// 3. Maximum consecutive shifts / mandatory rest
// ---------------------------------------------------------------------------
/**
 * SESSION 3 (B5): this test previously pinned the buggy behavior — the explicit
 * `MEN` was written verbatim on every day, producing a Max Consecutive +
 * Mandatory Rest violation that was only *reported*, never prevented.
 * The explicit-request stage now evaluates the shared hard-constraint contract
 * first, so the request is honored only as far as it is legal.
 */
test('max-consecutive: an explicit MEN-all-month request is degraded to the legal maximum instead of breaching the cap', () => {
  const personnel = [makePerson('sup', { position: 'supervisor' }), makePerson('stf', { position: 'staff' }), makePerson('g1')];
  const requests = [makeRequest('g1', { id: 'r', requestType: 'shift', preferredShift: 'MEN', isEssential: false, scope: 'all' })];
  const s = solved(personnel, requests, makeSettings());

  // Day 1 has no history, so the full request is legal and still honored.
  assert.equal(s.assignments.g1?.[1], 'MEN', 'a legal explicit request stays honored');
  // The cap is now genuinely respected instead of merely reported.
  assert.ok(!s.warnings.some(w => w.startsWith('Max Consecutive:')), 'the consecutive cap must no longer be breached');
  assert.ok(!s.warnings.some(w => w.startsWith('Mandatory Rest:')), 'no mandatory-rest breach should remain');
  // The unavoidable conflict is surfaced explicitly, never silently.
  assert.ok(
    s.warnings.some(w => w.startsWith('Hard Constraint Conflict:') && w.includes('MEN')),
    'the request/constraint conflict must be reported'
  );
});

/**
 * SESSION 3 (B5): previously `N` was written on all 31 days with no warning at
 * all (the weighted slot model treats lone Ns as separate runs, so the cap rule
 * never fired). The night-rest rule extracted from the greedy fill —
 * MAX_CONSECUTIVE_NIGHTS = 2 — now applies to explicit requests too.
 */
test('night-rest: an explicit N-all-month request never produces a third consecutive night', () => {
  const personnel = [makePerson('sup', { position: 'supervisor' }), makePerson('stf', { position: 'staff' }), makePerson('g1')];
  const requests = [makeRequest('g1', { id: 'r', requestType: 'shift', preferredShift: 'N', isEssential: false, scope: 'all' })];
  const s = solved(personnel, requests, makeSettings());
  const row = s.assignments.g1 || {};

  assert.equal(row[1], 'N', 'the first legal night is still honored');
  for (let d = 3; d <= daysInMonth(); d++) {
    assert.ok(
      !(coversN(row[d - 2]) && coversN(row[d - 1]) && coversN(row[d])),
      `three consecutive nights on days ${d - 2}..${d}`
    );
  }
  assert.ok(
    s.warnings.some(w => w.startsWith('Hard Constraint Conflict:')),
    'the blocked night requests must be reported as conflicts'
  );
});

// ---------------------------------------------------------------------------
// 4. Night / heavy shift rules
// ---------------------------------------------------------------------------
test('night rule: in a comfortably-staffed roster no nurse works N on two consecutive days', () => {
  const p = scenarioFeasible();
  const s = solved(p.personnel, p.requests, p.settings);
  for (const person of p.personnel) {
    const row = s.assignments[person.id] || {};
    for (let d = 1; d < daysInMonth(); d++) {
      assert.ok(!(coversN(row[d]) && coversN(row[d + 1])), `${person.id} works night on consecutive days ${d},${d + 1}`);
    }
  }
});

/**
 * SESSION 3 (B4): this test previously pinned the bug — the greedy fill's
 * "no 3 nights in a row" guard did not exist in reconcile (nor in the emergency
 * fill), so a night gap was closed by overworking one nurse. The night-rest rule
 * is now part of the shared contract used by every coverage filler.
 */
test('night rule: no coverage filler may create a third consecutive night, even on a near-infeasible roster', () => {
  const p = scenarioNearInfeasible();
  const s = solved(p.personnel, p.requests, p.settings);
  for (const person of p.personnel) {
    const row = s.assignments[person.id] || {};
    for (let d = 3; d <= daysInMonth(); d++) {
      assert.ok(
        !(coversN(row[d - 2]) && coversN(row[d - 1]) && coversN(row[d])),
        `${person.id} works three consecutive nights on days ${d - 2}..${d}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Routine / fixed shift behavior
// ---------------------------------------------------------------------------
test('routine tags restrict placement: morning→M only, evening_night→E/N only, long→M/E only', () => {
  const s = solved(realisticPersonnel(), [], realisticSettings());
  const morn = s.assignments.morn || {};
  const even = s.assignments.even || {};
  const long = s.assignments.long || {};
  for (let d = 1; d <= daysInMonth(); d++) {
    assert.ok(!coversE(morn[d]) && !coversN(morn[d]), `morn day ${d} got E/N`);
    assert.ok(!coversM(even[d]), `even day ${d} got M`);
    assert.ok(!coversN(long[d]), `long day ${d} got N`);
  }
});

// ---------------------------------------------------------------------------
// 6. Explicit shift requests
// ---------------------------------------------------------------------------
/**
 * SESSION 3 (B5): a month-long `EN` request implies 31 consecutive nights, which
 * the night-rest rule forbids. The request is still a very high-priority input —
 * it is honored in full wherever it is legal and degraded to its largest legal
 * subset (`E`) only where the third consecutive night would occur.
 */
test('explicit shift request: a full-month EN request is honored wherever it is legal', () => {
  const s = solved(realisticPersonnel(), realisticRequests(), realisticSettings());
  const row = s.assignments.even || {};

  let fullyHonored = 0;
  for (let d = 1; d <= daysInMonth(); d++) {
    // The evening part of the request is always satisfied.
    assert.ok(coversE(row[d]), `even day ${d} lost its requested evening (${row[d]})`);
    if (row[d] === 'EN') fullyHonored++;
  }
  assert.ok(fullyHonored >= 20, `the EN request should hold on most days (got ${fullyHonored})`);

  // …and never at the cost of a forbidden third consecutive night.
  for (let d = 3; d <= daysInMonth(); d++) {
    assert.ok(
      !(coversN(row[d - 2]) && coversN(row[d - 1]) && coversN(row[d])),
      `three consecutive nights on days ${d - 2}..${d}`
    );
  }
});

// ---------------------------------------------------------------------------
// 7. Hard OFF / Soft OFF
// ---------------------------------------------------------------------------
/**
 * SESSION 3 (B1): this test previously pinned the bug — the low-priority
 * "no more than 3 consecutive OFF" post-process silently overwrote day 4 of a
 * hard OFF with an `M`. A hard OFF is now immutable; when the OFF run is long
 * *because of* a hard OFF, the rule conflict is reported instead of resolved by
 * breaking the hard constraint.
 */
test('hard OFF: a 5-day hard OFF survives the consecutive-OFF breaker untouched', () => {
  const personnel = [makePerson('sup', { position: 'supervisor' }), makePerson('stf', { position: 'staff' }), makePerson('g1'), makePerson('g2'), makePerson('g3')];
  const requests = [makeRequest('g1', { id: 'r', requestType: 'OFF', isEssential: false, offHardness: 'hard', scope: 'custom_days', selectedDays: [1, 2, 3, 4, 5] })];
  const s = solved(personnel, requests, makeSettings());
  for (const d of [1, 2, 3, 4, 5]) {
    assert.equal(s.assignments.g1?.[d], 'OFF', `hard OFF day ${d} must stay OFF`);
  }
  assert.ok(
    !s.warnings.some(w => w.startsWith('Mismatched Request:') && w.includes('g1 T')),
    'no request mismatch may remain — the hard OFF was fully honored'
  );
  assert.ok(
    s.warnings.some(w => w.startsWith('Hard Constraint Conflict:') && w.includes('روز 4')),
    'the consecutive-OFF rule conflict must be reported explicitly'
  );
});

/**
 * SESSION 3 (B1/B7): Hard and Soft OFF must now differ for real. Soft OFF keeps
 * the current policy — it may be broken by the OFF-breaker — which is exactly
 * what makes the hard/soft distinction observable rather than cosmetic.
 */
test('soft OFF: unlike a hard OFF, a soft OFF may still be broken by the consecutive-OFF breaker', () => {
  const personnel = [makePerson('sup', { position: 'supervisor' }), makePerson('stf', { position: 'staff' }), makePerson('g1'), makePerson('g2'), makePerson('g3')];
  const requests = [makeRequest('g1', { id: 'r', requestType: 'OFF', isEssential: false, offHardness: 'soft', scope: 'custom_days', selectedDays: [1, 2, 3, 4, 5] })];
  const s = solved(personnel, requests, makeSettings());
  assert.equal(s.assignments.g1?.[4], 'M', 'soft OFF day 4 is still breakable (policy unchanged)');
});

// ---------------------------------------------------------------------------
// 8. Locked rows / protected cells
// ---------------------------------------------------------------------------
test('[CURRENT-BEHAVIOR] personnel.locked is ignored by solveNursingSchedule (the row still gets shifts)', () => {
  const personnel = [makePerson('sup', { position: 'supervisor' }), makePerson('stf', { position: 'staff' }), makePerson('g1', { locked: true })];
  const s = solved(personnel, [], makeSettings());
  const row = s.assignments.g1 || {};
  let worked = 0;
  for (let d = 1; d <= daysInMonth(); d++) {
    const shift = row[d];
    if (shift && shift !== 'OFF' && !String(shift).startsWith('L')) worked++;
  }
  assert.ok(worked > 0, 'locked personnel still received working shifts');
});

test('locked rows: reconcileStaffingCoverage never modifies a locked row', () => {
  const sup = makePerson('sup');
  const g1 = makePerson('g1');
  const g2 = makePerson('g2');
  const assignments: Record<string, Record<number, string>> = { sup: { 1: 'M' }, g1: { 1: 'M' }, g2: { 1: 'OFF' } };
  const r = reconcileStaffingCoverage(assignments, [sup, g1, g2], makeSettings(), [{ day: 1, isHoliday: false }], ['nurse'], ['sup'], []);
  assert.equal(r.assignments.sup?.[1], 'M', 'locked sup row must be untouched');
});

test('locked rows: mergeOptimizerAssignments keeps the locked row from the current schedule', () => {
  const sup = makePerson('sup');
  const g1 = makePerson('g1');
  const current = { sup: { 1: 'M' } };
  const optimized = { sup: { 1: 'E' }, g1: { 1: 'M' } };
  const merged = mergeOptimizerAssignments(current, optimized, [sup, g1], 'nurse', ['sup']);
  assert.equal(merged.sup?.[1], 'M', 'locked row keeps current assignment');
  assert.equal(merged.g1?.[1], 'M', 'free row takes optimized assignment');
});

/**
 * SESSION 3 (B2): this test previously pinned the bug — reconcile inspected only
 * lock/protection/leave and happily placed an `M` onto a hard-OFF cell to close a
 * coverage gap. Coverage is still a hard constraint, but a hard OFF outranks it:
 * the shortage is now reported instead of resolved by a violation.
 */
test('reconcile: a hard OFF is never overwritten to fill a coverage gap — the shortage is reported', () => {
  const g1 = makePerson('g1');
  const g2 = makePerson('g2');
  const assignments: Record<string, Record<number, string>> = { g1: { 1: 'OFF' }, g2: { 1: 'OFF' } };
  const requests = [makeRequest('g1', { id: 'r', requestType: 'OFF', isEssential: true, offHardness: 'hard', scope: 'custom_days', selectedDays: [1] })];
  const settings = makeSettings({ morningNurse: 2, afternoonNurse: 0, nightNurse: 0 });
  const r = reconcileStaffingCoverage(assignments, [g1, g2], settings, [{ day: 1, isHoliday: false }], ['nurse'], [], requests);

  assert.equal(r.assignments.g1?.[1], 'OFF', 'the hard OFF cell must stay OFF');
  assert.equal(r.assignments.g2?.[1], 'M', 'the legal candidate is still used');
  assert.deepEqual(
    r.unresolvedGaps,
    [{ day: 1, jobGroup: 'nurse', shift: 'M', required: 2, assigned: 1 }],
    'the remaining shortage must be reported, not hidden'
  );
});

test('protected cells: reconcileStaffingCoverage never modifies a protected cell', () => {
  const sup = makePerson('sup');
  const g1 = makePerson('g1');
  const assignments: Record<string, Record<number, string>> = { sup: { 1: 'M' }, g1: { 1: 'M' } };
  const r = reconcileStaffingCoverage(assignments, [sup, g1], makeSettings(), [{ day: 1, isHoliday: false }], ['nurse'], [], [], new Set(['g1:1']));
  assert.equal(r.assignments.g1?.[1], 'M', 'protected g1:1 must be untouched');
});

// ---------------------------------------------------------------------------
// 9. Supervisor / Staff fixed morning behavior
// ---------------------------------------------------------------------------
test('supervisor/staff: never work evening or night in a feasible roster (morning-only)', () => {
  const p = scenarioFeasible();
  const s = solved(p.personnel, p.requests, p.settings);
  for (const id of ['sup', 'stf']) {
    const row = s.assignments[id] || {};
    for (let d = 1; d <= daysInMonth(); d++) {
      assert.ok(!coversE(row[d]) && !coversN(row[d]), `${id} day ${d} worked E/N`);
    }
  }
});

test('supervisor/staff: OFF on every Friday', () => {
  const p = scenarioFeasible();
  const s = solved(p.personnel, p.requests, p.settings);
  for (const id of ['sup', 'stf']) {
    for (const d of FRIDAYS) assert.equal(s.assignments[id]?.[d], 'OFF', `${id} Friday ${d}`);
  }
});

test('[CURRENT-BEHAVIOR] supervisor fixed morning: staff is M on every working day; supervisor loses one morning to reconcile', () => {
  const p = scenarioFeasible();
  const s = solved(p.personnel, p.requests, p.settings);
  for (let d = 1; d <= daysInMonth(); d++) {
    if (isFriday(d)) continue;
    assert.equal(s.assignments.stf?.[d], 'M', `stf working day ${d}`);
    // In the current implementation the consecutive-OFF breaker assigns an extra M
    // to a general nurse on day 7, and reconcile then removes the supervisor's M
    // (first in list) to fix the overstaffing. Day 7 is the only working-day gap.
    if (d === 7) assert.equal(s.assignments.sup?.[d], 'OFF', 'sup day 7 currently loses its morning');
    else assert.equal(s.assignments.sup?.[d], 'M', `sup working day ${d}`);
  }
});

/**
 * SESSION 3 (B3): this test previously pinned the bug — reconcile had no
 * supervisor/staff guard and produced an `MN` for the supervisor. The greedy
 * fill's morning-only rule is now part of the shared contract and applies to
 * reconcile as well.
 */
test('reconcile: a supervisor is never given an evening/night shift (morning-only is enforced)', () => {
  const sup = makePerson('sup', { position: 'supervisor' });
  const g1 = makePerson('g1');
  const assignments: Record<string, Record<number, string>> = { sup: { 1: 'OFF' }, g1: { 1: 'OFF' } };
  const settings = makeSettings({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 });
  const r = reconcileStaffingCoverage(assignments, [sup, g1], settings, [{ day: 1, isHoliday: false }], ['nurse'], [], []);

  assert.equal(r.assignments.sup?.[1], 'M', 'the supervisor may only take the morning');
  assert.ok(!coversE(r.assignments.sup?.[1]), 'supervisor must not cover E');
  assert.ok(!coversN(r.assignments.sup?.[1]), 'supervisor must not cover N');
});

// ---------------------------------------------------------------------------
// 10. Productivity-related behavior (pure functions only — soft, not a hard rule)
// ---------------------------------------------------------------------------
test('productivity: checkProductivityEligibility thresholds (staff/general/conscript/supervisor)', () => {
  const staff = makePerson('s1', { position: 'staff' });
  assert.equal(checkProductivityEligibility(staff, ['M', 'M', 'M', 'M', 'M', 'M', 'M', 'M', 'M', 'M', 'E', 'N']), true);
  assert.equal(checkProductivityEligibility(staff, ['M', 'E', 'N']), false);

  const general = makePerson('s2');
  assert.equal(checkProductivityEligibility(general, ['M', 'M', 'M', 'E', 'E', 'E', 'N', 'N', 'N']), true);
  assert.equal(checkProductivityEligibility(general, ['M', 'M', 'E', 'E', 'E', 'N', 'N', 'N']), false);

  const conscript = makePerson('s3', { employmentType: 'conscript' });
  assert.equal(checkProductivityEligibility(conscript, ['M', 'M', 'M', 'E', 'E', 'E', 'N', 'N', 'N']), false);

  const supervisor = makePerson('s4', { position: 'supervisor' });
  assert.equal(checkProductivityEligibility(supervisor, []), true);
});

test('productivity: calculateShiftProductivity holiday/non-holiday weights', () => {
  assert.equal(calculateShiftProductivity('N', false), 3);
  assert.equal(calculateShiftProductivity('N', true), 6);
  assert.equal(calculateShiftProductivity('M', false), 0);
  assert.equal(calculateShiftProductivity('E', true), 3);
  assert.equal(calculateShiftProductivity('MEN', true), 12);
});

// ---------------------------------------------------------------------------
// 11. Reconcile after Solver / verify is read-only
// ---------------------------------------------------------------------------
test('reconcile after solver: reconcileStaffingCoverage fills unmet coverage after the greedy pass', () => {
  const sup = makePerson('sup');
  const g1 = makePerson('g1');
  const assignments: Record<string, Record<number, string>> = { sup: { 1: 'M' }, g1: { 1: 'OFF' } };
  const settings = makeSettings({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 });
  const r = reconcileStaffingCoverage(assignments, [sup, g1], settings, [{ day: 1, isHoliday: false }], ['nurse'], [], []);
  assert.equal(r.unresolvedGaps.length, 0);
  assert.equal(r.assignments.g1?.[1], 'E', 'reconcile assigned E to fill the gap');
  assert.ok(coversN(r.assignments.sup?.[1]), 'reconcile assigned N to sup to fill the night gap');
});

test('verifyCoverageAndLeaders is read-only (does not mutate assignments)', () => {
  const sup = makePerson('sup');
  const g1 = makePerson('g1');
  const assignments: Record<string, Record<number, string>> = { sup: { 1: 'M' }, g1: { 1: 'OFF' } };
  const before = JSON.stringify(assignments);
  verifyCoverageAndLeaders(CAL_YEAR, CAL_MONTH, [sup, g1], assignments, makeSettings(), {}, undefined, []);
  assert.equal(JSON.stringify(assignments), before);
});

// ---------------------------------------------------------------------------
// 12. Scenario generation / baseline similarity
// ---------------------------------------------------------------------------
test('[CURRENT-BEHAVIOR] scenario ranking: totalScore is exactly the baseline similarity percent', () => {
  const p = scenarioFeasible();
  const baseline = solved(p.personnel, p.requests, p.settings);
  const result = generateAndScoreScenarios(
    CAL_YEAR, CAL_MONTH, p.personnel, p.requests, p.settings, {}, undefined, null,
    'nurse', baseline.assignments as any, []
  );
  assert.ok(result.top3.length >= 1, 'expected at least one scenario');
  for (const scenario of result.top3) {
    assert.equal(scenario.criticalWarningCount, 0, 'scenario must be warning-free');
    assert.equal(scenario.totalScore, scenario.baselineSimilarityPercent, 'totalScore mirrors baseline similarity');
  }
});

// ---------------------------------------------------------------------------
// 13. Infeasible coverage
// ---------------------------------------------------------------------------
test('[CURRENT-BEHAVIOR] infeasible coverage: per-day Coverage Shortage warnings + best-effort assignments', () => {
  const p = scenarioInfeasible();
  const s = solved(p.personnel, p.requests, p.settings);
  assert.equal(s.warnings.length, 31, 'one Coverage Shortage per day for M');
  assert.ok(s.warnings.every(w => w.startsWith('Coverage Shortage:')), 'only coverage warnings expected');
  // Assignments are still produced for every active person on every day.
  for (const person of p.personnel) {
    for (let d = 1; d <= daysInMonth(); d++) {
      assert.ok(s.assignments[person.id]?.[d] !== undefined, `${person.id} day ${d} missing`);
    }
  }
});
