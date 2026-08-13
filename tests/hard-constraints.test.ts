/**
 * SESSION 3 — Hard-constraint regression suite (B1–B5).
 *
 * These tests assert the CORRECT behavior, not the historical one. Their single
 * purpose is to make it impossible for any writer in the pipeline — the greedy
 * fill, the emergency fill, the explicit-request stage, the OFF-breaker,
 * `solveWithPriority` or `reconcileStaffingCoverage` — to fix coverage by
 * breaking a rule that is supposed to be hard.
 *
 * When a hard constraint makes full coverage impossible, the expected outcome is
 * always the same: report the shortage, never violate the constraint.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { solveNursingSchedule, solveWithPriority } from '../lib/solver';
import { reconcileStaffingCoverage } from '../domain/scheduling/staffing-coverage';
import {
  MAX_CONSECUTIVE_NIGHTS,
  canAssignShift,
  evaluateHardConstraints,
  isHardOffRequest,
  isMorningOnlyPosition,
  isSoftOffRequest,
  resolveLegalShiftForRequest,
  shiftSubsetsByCoverage,
  violatesConsecutiveLimit,
  violatesHardOff,
  violatesMorningOnly,
  violatesNightRest,
} from '../domain/scheduling/hard-constraints';
import {
  createScheduleWarning,
  defaultSeverityForCode,
  isCriticalWarningCode,
} from '../domain/warnings/schedule-warning';
import type { Personnel, ShiftRequest, SystemSettings } from '../lib/types';
import {
  CAL_MONTH,
  CAL_YEAR,
  coversE,
  coversM,
  coversN,
  makePerson,
  makeRequest,
  makeSettings,
} from './fixtures/realistic';

const TOTAL_DAYS = 31;

function solved(
  personnel: Personnel[],
  requests: ShiftRequest[],
  settings: SystemSettings,
  holidays: Record<number, string> = {}
) {
  return solveNursingSchedule(CAL_YEAR, CAL_MONTH, personnel, requests, settings, holidays, undefined, null);
}

/** A plain weekday calendar for reconcile-level tests. */
function weekdays(count: number) {
  return Array.from({ length: count }, (_, index) => ({ day: index + 1, isHoliday: false }));
}

// ===========================================================================
// 0. Pure constraint helpers
// ===========================================================================

test('hard/soft OFF classification: missing offHardness defaults to hard', () => {
  const hard = makeRequest('p', { id: 'a', requestType: 'OFF', isEssential: false, offHardness: 'hard', scope: 'all' });
  const soft = makeRequest('p', { id: 'b', requestType: 'OFF', isEssential: false, offHardness: 'soft', scope: 'all' });
  const unset = makeRequest('p', { id: 'c', requestType: 'OFF', isEssential: false, scope: 'all' });

  assert.equal(isHardOffRequest(hard), true);
  assert.equal(isHardOffRequest(soft), false);
  assert.equal(isHardOffRequest(unset), true, 'an OFF without hardness is hard by default');
  assert.equal(isSoftOffRequest(soft), true);
  assert.equal(isSoftOffRequest(unset), false);
});

test('violatesHardOff only matches the right person, day and scope', () => {
  const requests = [
    makeRequest('p1', { id: 'r', requestType: 'OFF', isEssential: false, offHardness: 'hard', scope: 'custom_days', selectedDays: [5] }),
  ];
  assert.equal(violatesHardOff(requests, 'p1', 5, 0), true);
  assert.equal(violatesHardOff(requests, 'p1', 6, 0), false);
  assert.equal(violatesHardOff(requests, 'p2', 5, 0), false);
  assert.equal(violatesHardOff([], 'p1', 5, 0), false);
});

test('violatesMorningOnly: supervisor/staff are always blocked from E/N', () => {
  const supervisor = makePerson('s', { position: 'supervisor' });
  const staff = makePerson('t', { position: 'staff' });
  const general = makePerson('g');

  assert.equal(isMorningOnlyPosition(supervisor), true);
  assert.equal(isMorningOnlyPosition(staff), true);
  assert.equal(isMorningOnlyPosition(general), false);

  for (const person of [supervisor, staff]) {
    assert.equal(violatesMorningOnly(person, 'M', false, false), false, 'morning is always allowed on a working day');
    assert.equal(violatesMorningOnly(person, 'E', false, false), true);
    assert.equal(violatesMorningOnly(person, 'N', false, false), true);
    assert.equal(violatesMorningOnly(person, 'N', false, true), true, 'an explicit plan cannot bypass E/N hard restriction');
    assert.equal(violatesMorningOnly(person, 'M', true, false), true, 'holidays are rest days for supervisor/staff');
    assert.equal(violatesMorningOnly(person, 'M', true, false, false), false, 'holiday rest can be scoped out explicitly');
  }
  assert.equal(violatesMorningOnly(general, 'N', true, false), false, 'the rule never applies to general nurses');
});

test('violatesNightRest enforces the two-night cap but permits M after N', () => {
  assert.equal(MAX_CONSECUTIVE_NIGHTS, 2);
  const assignments = { p: { 1: 'N', 2: 'N', 3: 'OFF', 4: 'N' } };

  assert.equal(violatesNightRest(assignments, 'p', 3, 'N'), 'NIGHT_REST_CONSECUTIVE_NIGHTS');
  assert.equal(violatesNightRest(assignments, 'p', 3, 'E'), null, 'a non-night shift is unaffected');
  assert.equal(violatesNightRest(assignments, 'p', 2, 'N'), null, 'a second consecutive night is still allowed');
  assert.equal(violatesNightRest(assignments, 'p', 5, 'M'), null, 'M after N is not a night-rest restriction');
  assert.equal(violatesNightRest(assignments, 'p', 5, 'E'), null);
});

test('violatesConsecutiveLimit mirrors the shared 5-unit cap helper', () => {
  const assignments = { p: { 1: 'MEN', 2: 'OFF' } };
  assert.equal(violatesConsecutiveLimit(assignments, 'p', 2, 'ME', TOTAL_DAYS), true, 'MEN + ME = 6 units');
  assert.equal(violatesConsecutiveLimit(assignments, 'p', 2, 'M', TOTAL_DAYS), false, 'MEN + M = 5 units is on the limit');
});

test('resolveLegalShiftForRequest degrades to the largest legal subset, deterministically', () => {
  assert.deepEqual(shiftSubsetsByCoverage('MEN'), ['MEN', 'ME', 'MN', 'EN', 'M', 'E', 'N']);

  const person = makePerson('p');
  // Two nights already worked → the night component of EN is illegal, E is not.
  const assignments = { p: { 1: 'N', 2: 'N', 3: 'OFF' } };
  const resolution = resolveLegalShiftForRequest(
    { person, day: 3, dayOfWeek: 0, assignments, totalDays: TOTAL_DAYS, requests: [] },
    'EN',
    { nightRest: true, consecutiveCap: true }
  );
  assert.equal(resolution.shift, 'E');
  assert.equal(resolution.exact, false);
  assert.equal(resolution.blockedBy, 'NIGHT_REST_CONSECUTIVE_NIGHTS');

  // With no history the same request is honored verbatim.
  const clean = resolveLegalShiftForRequest(
    { person, day: 1, dayOfWeek: 0, assignments: {}, totalDays: TOTAL_DAYS, requests: [] },
    'EN',
    { nightRest: true, consecutiveCap: true }
  );
  assert.equal(clean.shift, 'EN');
  assert.equal(clean.exact, true);
});

test('evaluateHardConstraints reports the blocking rule as a machine-readable code', () => {
  const person = makePerson('p');
  const base = { person, day: 2, dayOfWeek: 0, assignments: { p: { 1: 'OFF', 2: 'OFF' } }, totalDays: TOTAL_DAYS };

  assert.equal(
    evaluateHardConstraints({
      ...base,
      candidateShift: 'M',
      requests: [makeRequest('p', { id: 'r', requestType: 'OFF', isEssential: false, offHardness: 'hard', scope: 'custom_days', selectedDays: [2] })],
    }),
    'HARD_OFF'
  );
  assert.equal(
    evaluateHardConstraints({
      ...base,
      candidateShift: 'M',
      requests: [makeRequest('p', { id: 'r', requestType: 'leave', isEssential: true, scope: 'custom_days', selectedDays: [2] })],
    }),
    'ESSENTIAL_LEAVE'
  );
  assert.equal(
    evaluateHardConstraints({ ...base, candidateShift: 'M', lockedRowIds: new Set(['p']) }),
    'LOCKED_ROW'
  );
  assert.equal(
    evaluateHardConstraints({ ...base, candidateShift: 'M', protectedCells: new Set(['p:2']) }),
    'PROTECTED_CELL'
  );
  assert.equal(canAssignShift({ ...base, candidateShift: 'M' }), true, 'nothing blocks a clean cell');
});

// ===========================================================================
// 1. B1 — Hard OFF survives the OFF-breaker
// ===========================================================================

test('B1: a hard OFF is never overwritten by the consecutive-OFF breaker', () => {
  const personnel = [
    makePerson('sup', { position: 'supervisor' }),
    makePerson('stf', { position: 'staff' }),
    makePerson('g1'), makePerson('g2'), makePerson('g3'),
  ];
  const offDays = [1, 2, 3, 4, 5, 6, 7];
  const requests = [makeRequest('g1', {
    id: 'r', requestType: 'OFF', isEssential: false, offHardness: 'hard',
    scope: 'custom_days', selectedDays: offDays,
  })];
  const s = solved(personnel, requests, makeSettings());

  for (const d of offDays) {
    assert.equal(s.assignments.g1?.[d], 'OFF', `hard OFF day ${d} must remain OFF`);
  }
  assert.ok(
    s.warnings.some(w => w.startsWith('Hard Constraint Conflict:')),
    'the unresolvable consecutive-OFF rule must be reported as a conflict'
  );
});

test('B1: an OFF without explicit hardness defaults to hard and also survives the breaker', () => {
  const personnel = [
    makePerson('sup', { position: 'supervisor' }),
    makePerson('stf', { position: 'staff' }),
    makePerson('g1'), makePerson('g2'), makePerson('g3'),
  ];
  const requests = [makeRequest('g1', {
    id: 'r', requestType: 'OFF', isEssential: false,
    scope: 'custom_days', selectedDays: [1, 2, 3, 4, 5],
  })];
  const s = solved(personnel, requests, makeSettings());
  for (const d of [1, 2, 3, 4, 5]) {
    assert.equal(s.assignments.g1?.[d], 'OFF', `default-hard OFF day ${d} must remain OFF`);
  }
});

test('B1: essential leave is never overwritten by the OFF-breaker', () => {
  const personnel = [
    makePerson('sup', { position: 'supervisor' }),
    makePerson('stf', { position: 'staff' }),
    makePerson('g1'), makePerson('g2'), makePerson('g3'),
  ];
  const requests = [makeRequest('g1', {
    id: 'r', requestType: 'leave', isEssential: true,
    scope: 'custom_days', selectedDays: [3, 4, 5, 6, 7],
  })];
  const s = solved(personnel, requests, makeSettings());
  for (const d of [3, 4, 5, 6, 7]) {
    const shift = s.assignments.g1?.[d];
    assert.ok(shift && String(shift).startsWith('L'), `leave day ${d} must stay a leave (got ${shift})`);
  }
});

// ===========================================================================
// 2. B2 — reconcile respects hard OFF, leave, locks and protected cells
// ===========================================================================

test('B2: reconcile reports a shortage rather than assigning onto a hard OFF', () => {
  const g1 = makePerson('g1');
  const g2 = makePerson('g2');
  const requests = [makeRequest('g1', {
    id: 'r', requestType: 'OFF', isEssential: false, offHardness: 'hard',
    scope: 'custom_days', selectedDays: [1],
  })];
  const r = reconcileStaffingCoverage(
    { g1: { 1: 'OFF' }, g2: { 1: 'OFF' } },
    [g1, g2],
    makeSettings({ morningNurse: 2, afternoonNurse: 0, nightNurse: 0 }),
    weekdays(1), ['nurse'], [], requests
  );

  assert.equal(r.assignments.g1?.[1], 'OFF');
  assert.equal(r.unresolvedGaps.length, 1, 'the shortage must be reported');
  assert.equal(r.unresolvedGaps[0].assigned, 1);
  assert.equal(r.unresolvedGaps[0].required, 2);
});

test('B2: reconcile honours a hard OFF whose scope is weekday-based even without calendar weekdays', () => {
  const g1 = makePerson('g1');
  const g2 = makePerson('g2');
  // Without dayOfWeek, a weekday-scoped hard OFF is treated conservatively as matching:
  // a coverage shortage is strictly preferable to a possible hard-constraint violation.
  const requests = [makeRequest('g1', { id: 'r', requestType: 'OFF', isEssential: false, offHardness: 'hard', scope: 'fridays' })];
  const r = reconcileStaffingCoverage(
    { g1: { 1: 'OFF' }, g2: { 1: 'OFF' } },
    [g1, g2],
    makeSettings({ morningNurse: 2, afternoonNurse: 0, nightNurse: 0 }),
    weekdays(1), ['nurse'], [], requests
  );
  assert.equal(r.assignments.g1?.[1], 'OFF', 'ambiguity must resolve in favour of the hard constraint');
  assert.equal(r.unresolvedGaps.length, 1);
});

test('B2: reconcile uses a weekday-scoped hard OFF precisely when dayOfWeek is supplied', () => {
  const g1 = makePerson('g1');
  const g2 = makePerson('g2');
  const requests = [makeRequest('g1', { id: 'r', requestType: 'OFF', isEssential: false, offHardness: 'hard', scope: 'fridays' })];
  // dayOfWeek 0 = Saturday → the Friday-scoped OFF does not apply, so g1 is usable.
  const r = reconcileStaffingCoverage(
    { g1: { 1: 'OFF' }, g2: { 1: 'OFF' } },
    [g1, g2],
    makeSettings({ morningNurse: 2, afternoonNurse: 0, nightNurse: 0 }),
    [{ day: 1, isHoliday: false, dayOfWeek: 0 }], ['nurse'], [], requests
  );
  assert.equal(r.assignments.g1?.[1], 'M');
  assert.deepEqual(r.unresolvedGaps, []);
});

test('B2: reconcile never overwrites essential leave to close a gap', () => {
  const g1 = makePerson('g1');
  const g2 = makePerson('g2');
  const requests = [makeRequest('g1', { id: 'r', requestType: 'leave', isEssential: true, scope: 'custom_days', selectedDays: [1] })];
  const r = reconcileStaffingCoverage(
    { g1: { 1: 'OFF' }, g2: { 1: 'OFF' } },
    [g1, g2],
    makeSettings({ morningNurse: 2, afternoonNurse: 0, nightNurse: 0 }),
    weekdays(1), ['nurse'], [], requests
  );
  assert.equal(r.assignments.g1?.[1], 'OFF', 'the approved leave day must not receive a shift');
  assert.equal(r.unresolvedGaps.length, 1, 'the shortage is reported instead');
});

test('B2: reconcile never writes onto a leave cell (L1..Ln)', () => {
  const g1 = makePerson('g1');
  const g2 = makePerson('g2');
  const r = reconcileStaffingCoverage(
    { g1: { 1: 'L1' }, g2: { 1: 'OFF' } },
    [g1, g2],
    makeSettings({ morningNurse: 2, afternoonNurse: 0, nightNurse: 0 }),
    weekdays(1), ['nurse'], [], []
  );
  assert.equal(r.assignments.g1?.[1], 'L1');
  assert.equal(r.unresolvedGaps.length, 1);
});

test('B2: locked rows stay untouched even when that leaves a shortage', () => {
  const g1 = makePerson('g1');
  const g2 = makePerson('g2');
  const r = reconcileStaffingCoverage(
    { g1: { 1: 'OFF' }, g2: { 1: 'OFF' } },
    [g1, g2],
    makeSettings({ morningNurse: 2, afternoonNurse: 0, nightNurse: 0 }),
    weekdays(1), ['nurse'], ['g1'], []
  );
  assert.equal(r.assignments.g1?.[1], 'OFF', 'the locked row must not be modified');
  assert.equal(r.unresolvedGaps.length, 1);

  // `personnel.locked` must behave identically to the lockedRows list.
  const locked = makePerson('g3', { locked: true });
  const r2 = reconcileStaffingCoverage(
    { g3: { 1: 'OFF' }, g2: { 1: 'OFF' } },
    [locked, g2],
    makeSettings({ morningNurse: 2, afternoonNurse: 0, nightNurse: 0 }),
    weekdays(1), ['nurse'], [], []
  );
  assert.equal(r2.assignments.g3?.[1], 'OFF');
  assert.equal(r2.unresolvedGaps.length, 1);
});

test('B2: protected cells stay untouched even when that leaves a shortage', () => {
  const g1 = makePerson('g1');
  const g2 = makePerson('g2');
  const r = reconcileStaffingCoverage(
    { g1: { 1: 'OFF' }, g2: { 1: 'OFF' } },
    [g1, g2],
    makeSettings({ morningNurse: 2, afternoonNurse: 0, nightNurse: 0 }),
    weekdays(1), ['nurse'], [], [], new Set(['g1:1'])
  );
  assert.equal(r.assignments.g1?.[1], 'OFF', 'the head nurse edit must survive');
  assert.equal(r.unresolvedGaps.length, 1);
});

test('B2: a legal candidate is still used — protection does not block valid coverage', () => {
  const g1 = makePerson('g1');
  const g2 = makePerson('g2');
  const r = reconcileStaffingCoverage(
    { g1: { 1: 'OFF' }, g2: { 1: 'OFF' } },
    [g1, g2],
    makeSettings({ morningNurse: 2, afternoonNurse: 0, nightNurse: 0 }),
    weekdays(1), ['nurse'], [], []
  );
  assert.equal(r.assignments.g1?.[1], 'M');
  assert.equal(r.assignments.g2?.[1], 'M');
  assert.deepEqual(r.unresolvedGaps, []);
});

// ===========================================================================
// 3. B3 — reconcile respects supervisor/staff morning-only
// ===========================================================================

test('B3: reconcile never assigns an evening shift to a supervisor', () => {
  const sup = makePerson('sup', { position: 'supervisor' });
  const g1 = makePerson('g1');
  const r = reconcileStaffingCoverage(
    { sup: { 1: 'OFF' }, g1: { 1: 'OFF' } },
    [sup, g1],
    makeSettings({ morningNurse: 0, afternoonNurse: 2, nightNurse: 0 }),
    weekdays(1), ['nurse'], [], []
  );
  assert.ok(!coversE(r.assignments.sup?.[1]), `supervisor got ${r.assignments.sup?.[1]}`);
  assert.equal(r.unresolvedGaps.length, 1, 'the evening shortage must remain reported');
});

test('B3: reconcile never assigns a night shift to a staff member', () => {
  const stf = makePerson('stf', { position: 'staff' });
  const g1 = makePerson('g1');
  const r = reconcileStaffingCoverage(
    { stf: { 1: 'OFF' }, g1: { 1: 'OFF' } },
    [stf, g1],
    makeSettings({ morningNurse: 0, afternoonNurse: 0, nightNurse: 2 }),
    weekdays(1), ['nurse'], [], []
  );
  assert.ok(!coversN(r.assignments.stf?.[1]), `staff got ${r.assignments.stf?.[1]}`);
  assert.equal(r.unresolvedGaps.length, 1);
});

test('B3: when the only remaining candidates are supervisor/staff, the E/N shortage stays', () => {
  const sup = makePerson('sup', { position: 'supervisor' });
  const stf = makePerson('stf', { position: 'staff' });
  const r = reconcileStaffingCoverage(
    { sup: { 1: 'OFF' }, stf: { 1: 'OFF' } },
    [sup, stf],
    makeSettings({ morningNurse: 0, afternoonNurse: 1, nightNurse: 1 }),
    weekdays(1), ['nurse'], [], []
  );
  assert.equal(r.assignments.sup?.[1], 'OFF');
  assert.equal(r.assignments.stf?.[1], 'OFF');
  assert.equal(r.unresolvedGaps.length, 2, 'both the E and N gaps must be reported');
});

test('B3: supervisor/staff may take the morning, but explicit requests cannot unlock E/N', () => {
  const sup = makePerson('sup', { position: 'supervisor' });
  const morningOnly = reconcileStaffingCoverage(
    { sup: { 1: 'OFF' } },
    [sup],
    makeSettings({ morningNurse: 1, afternoonNurse: 0, nightNurse: 0 }),
    weekdays(1), ['nurse'], [], []
  );
  assert.equal(morningOnly.assignments.sup?.[1], 'M', 'the morning is always allowed');

  const requests = [makeRequest('sup', {
    id: 'r', requestType: 'shift', preferredShift: 'N', isEssential: false,
    scope: 'custom_days', selectedDays: [1],
  })];
  const withRequest = reconcileStaffingCoverage(
    { sup: { 1: 'OFF' } },
    [sup],
    makeSettings({ morningNurse: 0, afternoonNurse: 0, nightNurse: 1 }),
    weekdays(1), ['nurse'], [], requests
  );
  assert.equal(withRequest.assignments.sup?.[1], 'OFF', 'an explicit request cannot bypass the hard E/N restriction');
  assert.ok(withRequest.unresolvedGaps.some(gap => gap.shift === 'N'), 'the illegal night remains an unresolved shortage');
});

test('B3: end-to-end, supervisor and staff never work E/N in a feasible roster', () => {
  const personnel = [
    makePerson('sup', { position: 'supervisor' }),
    makePerson('stf', { position: 'staff' }),
    makePerson('g1'), makePerson('g2'), makePerson('g3'),
  ];
  const s = solved(personnel, [], makeSettings());
  for (const id of ['sup', 'stf']) {
    for (let d = 1; d <= TOTAL_DAYS; d++) {
      const shift = s.assignments[id]?.[d];
      assert.ok(!coversE(shift) && !coversN(shift), `${id} day ${d} worked ${shift}`);
    }
  }
});

// ===========================================================================
// 4. B4 — reconcile respects night rest
// ===========================================================================

test('B4: reconcile does not create a third consecutive night for the same person', () => {
  const g1 = makePerson('g1');
  const g2 = makePerson('g2');
  const r = reconcileStaffingCoverage(
    { g1: { 1: 'N', 2: 'N', 3: 'OFF' }, g2: { 1: 'OFF', 2: 'OFF', 3: 'OFF' } },
    [g1, g2],
    makeSettings({ morningNurse: 0, afternoonNurse: 0, nightNurse: 1 }),
    weekdays(3), ['nurse'], [], []
  );
  assert.ok(!coversN(r.assignments.g1?.[3]), `g1 got a third night (${r.assignments.g1?.[3]})`);
  assert.ok(coversN(r.assignments.g2?.[3]), 'the legal candidate must cover the night instead');
});

test('B4: near-infeasible — the shortage is reported rather than a forbidden night created', () => {
  // g1 is the ONLY possible night candidate and already worked two nights.
  const g1 = makePerson('g1');
  const sup = makePerson('sup', { position: 'supervisor' });
  const r = reconcileStaffingCoverage(
    { g1: { 1: 'N', 2: 'N', 3: 'OFF' }, sup: { 1: 'M', 2: 'M', 3: 'M' } },
    [g1, sup],
    makeSettings({ morningNurse: 0, afternoonNurse: 0, nightNurse: 1 }),
    weekdays(3), ['nurse'], [], []
  );
  assert.equal(r.assignments.g1?.[3], 'OFF', 'the night-rest constraint must be preserved');
  assert.ok(!coversN(r.assignments.sup?.[3]), 'the supervisor must not be used as an escape hatch either');
  assert.ok(
    r.unresolvedGaps.some(gap => gap.day === 3 && gap.shift === 'N'),
    'the unresolvable night gap must be reported'
  );
});

test('B4: reconcile may schedule M immediately after N when workload cap permits it', () => {
  const g1 = makePerson('g1');
  const r = reconcileStaffingCoverage(
    { g1: { 1: 'N', 2: 'OFF' } },
    [g1],
    makeSettings(
      { morningNurse: 1, afternoonNurse: 0, nightNurse: 0 },
      { morningNurse: 0, afternoonNurse: 0, nightNurse: 1 }
    ),
    [
      { day: 1, dayOfWeek: 0, isHoliday: true },
      { day: 2, dayOfWeek: 1, isHoliday: false },
    ],
    ['nurse'], [], []
  );
  assert.equal(r.assignments.g1?.[1], 'N', 'the existing night must be preserved');
  assert.ok(coversM(r.assignments.g1?.[2]), 'N→M is legal when the workload cap is not exceeded');
});

test('B4: end-to-end, no personnel ever works three consecutive nights', () => {
  const personnel = [
    makePerson('sup', { position: 'supervisor' }),
    makePerson('g1'), makePerson('g2'),
  ];
  const s = solved(personnel, [], makeSettings({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }));
  for (const person of personnel) {
    const row = s.assignments[person.id] || {};
    for (let d = 3; d <= TOTAL_DAYS; d++) {
      assert.ok(
        !(coversN(row[d - 2]) && coversN(row[d - 1]) && coversN(row[d])),
        `${person.id} works nights on days ${d - 2}..${d}`
      );
    }
  }
});

test('B4: solveWithPriority never fills a night gap by creating a third consecutive night', () => {
  const personnel = [makePerson('g1'), makePerson('g2')];
  const result = solveWithPriority(
    CAL_YEAR, CAL_MONTH, personnel, [],
    makeSettings({ morningNurse: 0, afternoonNurse: 0, nightNurse: 1 }, { morningNurse: 0, afternoonNurse: 0, nightNurse: 1 }),
    {}, undefined, null
  );
  for (const person of personnel) {
    const row = result.assignments[person.id] || {};
    for (let d = 3; d <= TOTAL_DAYS; d++) {
      assert.ok(
        !(coversN(row[d - 2]) && coversN(row[d - 1]) && coversN(row[d])),
        `${person.id} works nights on days ${d - 2}..${d}`
      );
    }
  }
});

// ===========================================================================
// 5. B5 — explicit shift requests obey hard constraints
// ===========================================================================

test('B5: a legal explicit shift request is still honored verbatim', () => {
  const personnel = [
    makePerson('sup', { position: 'supervisor' }),
    makePerson('stf', { position: 'staff' }),
    makePerson('g1'), makePerson('g2'),
  ];
  const requests = [makeRequest('g1', {
    id: 'r', requestType: 'shift', preferredShift: 'EN', isEssential: false,
    scope: 'custom_days', selectedDays: [4],
  })];
  const s = solved(personnel, requests, makeSettings());
  assert.equal(s.assignments.g1?.[4], 'EN', 'a legal request must be applied exactly');
  assert.ok(
    !s.warnings.some(w => w.startsWith('Hard Constraint Conflict:') && w.includes('روز 4')),
    'a legal request must not produce a conflict warning'
  );
});

test('B5: an explicit shift request cannot overwrite a hard OFF — the hard OFF wins', () => {
  const personnel = [
    makePerson('sup', { position: 'supervisor' }),
    makePerson('stf', { position: 'staff' }),
    makePerson('g1'), makePerson('g2'), makePerson('g3'),
  ];
  const requests = [
    makeRequest('g1', { id: 'off', requestType: 'OFF', isEssential: false, offHardness: 'hard', scope: 'custom_days', selectedDays: [4] }),
    makeRequest('g1', { id: 'shift', requestType: 'shift', preferredShift: 'M', isEssential: false, scope: 'custom_days', selectedDays: [4] }),
  ];
  const s = solved(personnel, requests, makeSettings());
  assert.equal(s.assignments.g1?.[4], 'OFF', 'the hard OFF must win over the shift request');
});

test('B5: an explicit shift request cannot overwrite essential leave — the leave wins', () => {
  const personnel = [
    makePerson('sup', { position: 'supervisor' }),
    makePerson('stf', { position: 'staff' }),
    makePerson('g1'), makePerson('g2'),
  ];
  const requests = [
    makeRequest('g1', { id: 'leave', requestType: 'leave', isEssential: true, scope: 'custom_days', selectedDays: [4, 5] }),
    makeRequest('g1', { id: 'shift', requestType: 'shift', preferredShift: 'N', isEssential: false, scope: 'custom_days', selectedDays: [4] }),
  ];
  const s = solved(personnel, requests, makeSettings());
  const shift = s.assignments.g1?.[4];
  assert.ok(shift && String(shift).startsWith('L'), `the leave must win (got ${shift})`);
});

test('B5: an explicit request cannot create a forbidden third consecutive night', () => {
  const personnel = [
    makePerson('sup', { position: 'supervisor' }),
    makePerson('stf', { position: 'staff' }),
    makePerson('g1'), makePerson('g2'), makePerson('g3'),
  ];
  const requests = [makeRequest('g1', {
    id: 'r', requestType: 'shift', preferredShift: 'N', isEssential: true,
    scope: 'custom_days', selectedDays: [3, 4, 5],
  })];
  const s = solved(personnel, requests, makeSettings());
  const row = s.assignments.g1 || {};

  assert.ok(coversN(row[3]) && coversN(row[4]), 'the first two requested nights are legal and honored');
  assert.ok(!coversN(row[5]), `the third consecutive night must be refused (got ${row[5]})`);
  assert.ok(
    s.warnings.some(w => w.startsWith('Hard Constraint Conflict:') && w.includes('روز 5')),
    'the refused request must be reported as a structured conflict'
  );
});

test('B5: an explicit request cannot breach the max-consecutive cap', () => {
  const personnel = [
    makePerson('sup', { position: 'supervisor' }),
    makePerson('stf', { position: 'staff' }),
    makePerson('g1'), makePerson('g2'), makePerson('g3'),
  ];
  // MEN on day 3 (4 units) + ME on day 4 would total 6 units — above the cap of 5.
  const requests = [
    makeRequest('g1', { id: 'a', requestType: 'shift', preferredShift: 'MEN', isEssential: true, scope: 'custom_days', selectedDays: [3] }),
    makeRequest('g1', { id: 'b', requestType: 'shift', preferredShift: 'ME', isEssential: true, scope: 'custom_days', selectedDays: [4] }),
  ];
  const s = solved(personnel, requests, makeSettings());
  assert.equal(s.assignments.g1?.[3], 'MEN', 'the first legal request is honored');
  assert.notEqual(s.assignments.g1?.[4], 'ME', 'the cap-breaching request must not be applied verbatim');
  assert.ok(
    s.warnings.some(w => w.startsWith('Hard Constraint Conflict:') && w.includes('روز 4')),
    'the conflict must be reported'
  );
});

test('B5: the conflict warning uses the Session 2 structured model, not string assembly', () => {
  // The new code is part of the structured warning contract and carries a
  // deliberate, documented severity: the hard constraint was *respected*, so the
  // conflict is a `warning`, not a level-A `critical` — the critical-classification
  // policy (and therefore scenario ranking) is untouched.
  const warning = createScheduleWarning({
    code: 'HARD_CONSTRAINT_CONFLICT',
    message: 'x',
    day: 4,
    personnelId: 'g1',
    metadata: { rule: 'explicit_shift_request', blockedBy: 'HARD_OFF' },
  });
  assert.equal(warning.code, 'HARD_CONSTRAINT_CONFLICT');
  assert.equal(warning.severity, 'warning');
  assert.equal(isCriticalWarningCode('HARD_CONSTRAINT_CONFLICT'), false);
  assert.equal(defaultSeverityForCode('HARD_CONSTRAINT_CONFLICT'), 'warning');
  assert.equal(warning.metadata?.blockedBy, 'HARD_OFF');
});

test('B5: conflicts never silently override — the hard constraint wins and is reported', () => {
  const personnel = [
    makePerson('sup', { position: 'supervisor' }),
    makePerson('stf', { position: 'staff' }),
    makePerson('g1'), makePerson('g2'), makePerson('g3'),
  ];
  const requests = [
    makeRequest('g1', { id: 'off', requestType: 'OFF', isEssential: false, offHardness: 'hard', scope: 'custom_days', selectedDays: [4] }),
    makeRequest('g1', { id: 'shift', requestType: 'shift', preferredShift: 'M', isEssential: false, scope: 'custom_days', selectedDays: [4] }),
  ];
  const s = solved(personnel, requests, makeSettings());
  assert.equal(s.assignments.g1?.[4], 'OFF', 'the hard OFF wins the conflict');
  assert.ok(
    !s.warnings.some(w => w.startsWith('Mismatched Request:') && w.includes('درخواست OFF')),
    'the hard OFF must not be reported as violated — it was honored'
  );
});
