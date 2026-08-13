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
test('[CURRENT-BEHAVIOR] max-consecutive: an explicit MEN-all-month request yields a Max Consecutive + Mandatory Rest warning (assignment NOT repaired)', () => {
  const personnel = [makePerson('sup', { position: 'supervisor' }), makePerson('stf', { position: 'staff' }), makePerson('g1')];
  const requests = [makeRequest('g1', { id: 'r', requestType: 'shift', preferredShift: 'MEN', isEssential: false, scope: 'all' })];
  const s = solved(personnel, requests, makeSettings());
  assert.equal(s.assignments.g1?.[1], 'MEN');
  assert.ok(s.warnings.some(w => w.startsWith('Max Consecutive:')));
  assert.ok(s.warnings.some(w => w.startsWith('Mandatory Rest:')));
});

test('[CURRENT-BEHAVIOR] max-consecutive: an explicit N-all-month request produces NO Max Consecutive warning (slot model treats lone Ns as separate runs)', () => {
  const personnel = [makePerson('sup', { position: 'supervisor' }), makePerson('stf', { position: 'staff' }), makePerson('g1')];
  const requests = [makeRequest('g1', { id: 'r', requestType: 'shift', preferredShift: 'N', isEssential: false, scope: 'all' })];
  const s = solved(personnel, requests, makeSettings());
  for (let d = 1; d <= daysInMonth(); d++) assert.equal(s.assignments.g1?.[d], 'N', `day ${d}`);
  assert.ok(!s.warnings.some(w => w.startsWith('Max Consecutive:')), 'unexpected Max Consecutive warning for N-all-month');
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

test('[CURRENT-BEHAVIOR] night rule: reconcile can force 3+ consecutive nights when a night gap exists', () => {
  const p = scenarioNearInfeasible();
  const s = solved(p.personnel, p.requests, p.settings);
  const row = s.assignments.g1 || {};
  let found = false;
  for (let d = 2; d < daysInMonth(); d++) {
    if (coversN(row[d - 1]) && coversN(row[d]) && coversN(row[d + 1])) found = true;
  }
  assert.ok(found, 'expected reconcile to fill nights with a 3+ night run for g1');
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
test('explicit shift request: a full-month EN request is honored on every day', () => {
  const s = solved(realisticPersonnel(), realisticRequests(), realisticSettings());
  for (let d = 1; d <= daysInMonth(); d++) {
    assert.equal(s.assignments.even?.[d], 'EN', `even day ${d}`);
  }
});

// ---------------------------------------------------------------------------
// 7. Hard OFF / Soft OFF
// ---------------------------------------------------------------------------
test('[CURRENT-BEHAVIOR] hard OFF: a 5-day hard OFF is violated on day 4 by the consecutive-OFF breaker', () => {
  const personnel = [makePerson('sup', { position: 'supervisor' }), makePerson('stf', { position: 'staff' }), makePerson('g1'), makePerson('g2'), makePerson('g3')];
  const requests = [makeRequest('g1', { id: 'r', requestType: 'OFF', isEssential: false, offHardness: 'hard', scope: 'custom_days', selectedDays: [1, 2, 3, 4, 5] })];
  const s = solved(personnel, requests, makeSettings());
  assert.equal(s.assignments.g1?.[1], 'OFF');
  assert.equal(s.assignments.g1?.[2], 'OFF');
  assert.equal(s.assignments.g1?.[3], 'OFF');
  assert.equal(s.assignments.g1?.[4], 'M', 'hard OFF day 4 was overwritten to M by the OFF-breaker');
  assert.equal(s.assignments.g1?.[5], 'OFF');
  assert.ok(s.warnings.some(w => w.startsWith('Mismatched Request:') && w.includes('در روز 4')));
});

test('[CURRENT-BEHAVIOR] soft OFF: a soft OFF is broken by the consecutive-OFF breaker exactly like a hard OFF', () => {
  const personnel = [makePerson('sup', { position: 'supervisor' }), makePerson('stf', { position: 'staff' }), makePerson('g1'), makePerson('g2'), makePerson('g3')];
  const requests = [makeRequest('g1', { id: 'r', requestType: 'OFF', isEssential: false, offHardness: 'soft', scope: 'custom_days', selectedDays: [1, 2, 3, 4, 5] })];
  const s = solved(personnel, requests, makeSettings());
  assert.equal(s.assignments.g1?.[4], 'M', 'soft OFF day 4 was also overwritten to M');
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

test('[CURRENT-BEHAVIOR] reconcile can violate a hard OFF when filling a coverage gap', () => {
  const g1 = makePerson('g1');
  const g2 = makePerson('g2');
  const assignments: Record<string, Record<number, string>> = { g1: { 1: 'OFF' }, g2: { 1: 'OFF' } };
  const requests = [makeRequest('g1', { id: 'r', requestType: 'OFF', isEssential: true, offHardness: 'hard', scope: 'custom_days', selectedDays: [1] })];
  const settings = makeSettings({ morningNurse: 2, afternoonNurse: 0, nightNurse: 0 });
  const r = reconcileStaffingCoverage(assignments, [g1, g2], settings, [{ day: 1, isHoliday: false }], ['nurse'], [], requests);
  assert.equal(r.assignments.g1?.[1], 'M', 'reconcile assigned M onto a hard OFF day');
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

test('[CURRENT-BEHAVIOR] reconcile can assign a night to a supervisor (morning-only is not enforced in reconcile)', () => {
  const sup = makePerson('sup', { position: 'supervisor' });
  const g1 = makePerson('g1');
  const assignments: Record<string, Record<number, string>> = { sup: { 1: 'OFF' }, g1: { 1: 'OFF' } };
  const settings = makeSettings({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 });
  const r = reconcileStaffingCoverage(assignments, [sup, g1], settings, [{ day: 1, isHoliday: false }], ['nurse'], [], []);
  assert.ok(coversM(r.assignments.sup?.[1]) && coversN(r.assignments.sup?.[1]), `supervisor got ${r.assignments.sup?.[1]} (expected an M+N combo)`);
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
