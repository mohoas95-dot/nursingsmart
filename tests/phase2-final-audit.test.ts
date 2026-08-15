/**
 * Phase 2 Final Audit — focused regression coverage.
 *
 * Covers the two areas the audit asked to verify with tests:
 *   1. Effective overtime cap consistency (monthly override reaches final
 *      verification and reconciliation).
 *   2. Monthly `person.locked` behavior across months (no data leak).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  effectiveOvertimeCap,
  overtimeHoursForPerson,
} from '../domain/scheduling/overtime-cap';
import {
  reconcileStaffingCoverage,
} from '../domain/scheduling/staffing-coverage';
import {
  mergeOptimizerAssignments,
} from '../domain/scheduling/schedule-operations';
import {
  solveNursingSchedule,
  verifyCoverageAndLeaders,
} from '../lib/solver';
import type {
  MonthlySchedule,
  Personnel,
  ShiftType,
  SystemSettings,
} from '../lib/types';
import {
  CAL_MONTH,
  CAL_YEAR,
  makePerson,
  makeRequest,
} from './fixtures/realistic';

const YEAR = CAL_YEAR;
const MONTH = CAL_MONTH;
const TOTAL_DAYS = 31;

const ZERO_DEMAND = {
  morningNurse: 0,
  morningAssistant: 0,
  afternoonNurse: 0,
  afternoonAssistant: 0,
  afternoonLeader: 0,
  nightNurse: 0,
  nightAssistant: 0,
  nightLeader: 0,
};

function settingsWithDemand(
  overtime: number,
  weekday: Partial<SystemSettings['demand']['weekday']> = {},
  holiday: Partial<SystemSettings['demand']['holiday']> = {}
): SystemSettings {
  return {
    dutyHours: { official: 176, contract: 190, conscript: 200, overtime },
    demand: {
      weekday: { ...ZERO_DEMAND, ...weekday },
      holiday: { ...ZERO_DEMAND, ...holiday },
    },
  };
}

function oneDayCalendar(day = 1) {
  return [{ day, dayOfWeek: 0, isHoliday: false }];
}

function overtimePerson(id: string): Personnel {
  return makePerson(id, { employmentType: 'overtime' });
}

/** A row of `count` consecutive ME shifts (13h each). */
function meRow(count: number): Record<number, ShiftType> {
  const row: Record<number, ShiftType> = {};
  for (let d = 1; d <= count; d++) row[d] = 'ME';
  return row;
}

// ============================================================================
// Effective overtime cap — canonical interpretation
// ============================================================================

test('effective cap: monthly override lower than configured wins', () => {
  const settings = settingsWithDemand(240);
  assert.equal(effectiveOvertimeCap({ settings, monthlyDutyHours: { overtime: 150 } }), 150);
});

test('effective cap: monthly override higher than configured wins', () => {
  const settings = settingsWithDemand(150);
  assert.equal(effectiveOvertimeCap({ settings, monthlyDutyHours: { overtime: 240 } }), 240);
});

test('effective cap: no override falls back to configured settings value', () => {
  assert.equal(effectiveOvertimeCap({ settings: settingsWithDemand(150) }), 150);
  assert.equal(effectiveOvertimeCap({ settings: settingsWithDemand(240) }), 240);
});

// ============================================================================
// Final verification agrees with the cap used by the scheduling path
// ============================================================================

test('final verification uses a monthly override LOWER than configured (violation reported)', () => {
  const overtime = overtimePerson('ovt-lower');
  const assignments = { [overtime.id]: meRow(12) }; // 156h
  const settings = settingsWithDemand(240);

  // With override 150: 156h > 150 → violation.
  const withOverride = verifyCoverageAndLeaders(
    YEAR, MONTH, [overtime], assignments, settings, {}, undefined, [], { overtime: 150 }
  );
  assert.ok(
    withOverride.structuredWarnings.some(w => w.code === 'OVERTIME_CAP_EXCEEDED' && w.personnelId === overtime.id),
    'override 150 must be authoritative in final verification'
  );

  // Without override (settings 240): 156h < 240 → no violation.
  const withoutOverride = verifyCoverageAndLeaders(
    YEAR, MONTH, [overtime], assignments, settings, {}, undefined, []
  );
  assert.equal(
    withoutOverride.structuredWarnings.some(w => w.code === 'OVERTIME_CAP_EXCEEDED'),
    false
  );
});

test('final verification uses a monthly override HIGHER than configured (no violation)', () => {
  const overtime = overtimePerson('ovt-higher');
  const assignments = { [overtime.id]: meRow(12) }; // 156h
  const settings = settingsWithDemand(150);

  // With override 240: 156h < 240 → no violation.
  const withOverride = verifyCoverageAndLeaders(
    YEAR, MONTH, [overtime], assignments, settings, {}, undefined, [], { overtime: 240 }
  );
  assert.equal(
    withOverride.structuredWarnings.some(w => w.code === 'OVERTIME_CAP_EXCEEDED'),
    false
  );

  // Without override (settings 150): 156h > 150 → violation.
  const withoutOverride = verifyCoverageAndLeaders(
    YEAR, MONTH, [overtime], assignments, settings, {}, undefined, []
  );
  assert.ok(
    withoutOverride.structuredWarnings.some(w => w.code === 'OVERTIME_CAP_EXCEEDED'),
    'settings 150 must apply when no override is present'
  );
});

test('final verification: exact cap boundary is legal, one shift beyond is reported', () => {
  const overtime = overtimePerson('ovt-boundary');
  const settings = settingsWithDemand(150);

  // 11 x ME = 143h; + M (6.5h) = 149.5h ≤ 150 (legal, exactly at/below cap).
  const atCap = { [overtime.id]: { ...meRow(11), 12: 'M' } };
  const atCapResult = verifyCoverageAndLeaders(
    YEAR, MONTH, [overtime], atCap, settings, {}, undefined, [], { overtime: 150 }
  );
  assert.equal(
    atCapResult.structuredWarnings.some(w => w.code === 'OVERTIME_CAP_EXCEEDED'),
    false,
    `149.5h must be legal at cap 150 (got ${overtimeHoursForPerson({ [overtime.id]: atCap[overtime.id] }, overtime, TOTAL_DAYS)})`
  );

  // One shift beyond: 12 x ME = 156h > 150.
  const beyond = { [overtime.id]: meRow(12) };
  const beyondResult = verifyCoverageAndLeaders(
    YEAR, MONTH, [overtime], beyond, settings, {}, undefined, [], { overtime: 150 }
  );
  assert.ok(
    beyondResult.structuredWarnings.some(w => w.code === 'OVERTIME_CAP_EXCEEDED'),
    '156h must be reported as over cap 150'
  );
});

// ============================================================================
// Reconciliation shares the same effective cap
// ============================================================================

test('reconciliation respects a monthly override lower than settings (gap stays unresolved)', () => {
  const overtime = overtimePerson('ovt-reconcile');
  const settings = settingsWithDemand(240, { morningNurse: 1 });
  const assignments = { [overtime.id]: meRow(12) }; // 156h

  // With override 150, adding M (6.5h) → 162.5h > 150 → not selected.
  const withOverride = reconcileStaffingCoverage(
    assignments,
    [overtime],
    settings,
    oneDayCalendar(13),
    ['nurse'],
    [],
    [],
    undefined,
    { overtime: 150 }
  );
  assert.equal(withOverride.assignments[overtime.id][13], undefined);
  assert.ok(
    withOverride.unresolvedGaps.some(g => g.day === 13 && g.shift === 'M'),
    'a candidate that exceeds the monthly override must not be selected'
  );

  // Without override (settings 240): 162.5h < 240 → selected.
  const withoutOverride = reconcileStaffingCoverage(
    assignments,
    [overtime],
    settings,
    oneDayCalendar(13),
    ['nurse'],
    [],
    [],
    undefined,
    null
  );
  assert.equal(withoutOverride.assignments[overtime.id][13], 'M');
});

// ============================================================================
// Normal solver + emergency fill share the effective cap via the override
// ============================================================================

test('normal solver honors a monthly override lower than configured', () => {
  const overtime = overtimePerson('ovt-normal');
  const settings = settingsWithDemand(240, {}, { morningNurse: 1 });
  // 12 ME = 156h (already above override 150, below settings 240).
  const requests = [makeRequest(overtime.id, {
    id: 'r', requestType: 'shift', preferredShift: 'ME',
    isEssential: false, scope: 'custom_days', selectedDays: Array.from({ length: 12 }, (_, i) => i + 1),
  })];

  const solved = solveNursingSchedule(
    YEAR, MONTH, [overtime], requests, settings, { 13: 'audit holiday' }, undefined,
    { official: 176, contract: 190, overtime: 150 }
  );

  // Day 13 holiday morning demand: the overtime person (156h) would exceed the
  // monthly override 150, so they are not selected and the shortage is reported.
  assert.equal(solved.assignments[overtime.id][13] || 'OFF', 'OFF');
  assert.ok(
    solved.warnings.some(w => w.startsWith('Coverage Shortage:') && w.includes('روز 13') && w.includes('M')),
    'an over-override candidate must leave a reported coverage shortage'
  );
});

// ============================================================================
// person.locked — the lock is MONTHLY (lockedRows), not a global Personnel flag
// ============================================================================

test('person.locked (global flag) does NOT lock a person across months', () => {
  const flagged = makePerson('locked-x', { locked: true });
  const free = makePerson('free-x');
  const settings = settingsWithDemand(0, { morningNurse: 1 });

  // August: flagged person is in the month's lock → untouched.
  const august = solveNursingSchedule(YEAR, MONTH, [flagged, free], [], settings, {}, undefined, null, [flagged.id]);
  assert.equal(
    Object.values(august.assignments[flagged.id] ?? {}).every(shift => shift === 'OFF'),
    true,
    'locked in August'
  );

  // September: the global flag alone must NOT lock the person.
  const september = solveNursingSchedule(YEAR, MONTH + 1, [flagged, free], [], settings, {}, undefined, null, []);
  assert.equal(
    Object.values(september.assignments[flagged.id] ?? {}).some(shift => shift !== 'OFF'),
    true,
    'unlocked in September despite the global flag'
  );
});

test('person.locked is not merged into lockedRows (mechanisms stay distinct)', () => {
  // The monthly lock (lockedRows) preserves the row; the global flag is inert.
  const flagged = makePerson('locked-merge-x', { locked: true });
  const merged = mergeOptimizerAssignments(
    { [flagged.id]: { 1: 'OFF' } },
    { [flagged.id]: { 1: 'M' } },
    [flagged],
    'nurse',
    [flagged.id] // monthly lock
  );
  assert.equal(merged[flagged.id][1], 'OFF');
});

test('the solver never writes a monthly lock into the schedule object', () => {
  const a = makePerson('locked-sched-x');
  const free = makePerson('free-sched-x');
  const settings = settingsWithDemand(0, { morningNurse: 1 });

  const solved: MonthlySchedule = solveNursingSchedule(
    YEAR, MONTH, [a, free], [], settings, {}, undefined, null, [a.id]
  );
  // The monthly lock is an input; the solver does not persist it into the schedule.
  assert.equal(solved.lockedRows, undefined);
  assert.equal(
    Object.values(solved.assignments[a.id] ?? {}).every(shift => shift === 'OFF'),
    true
  );
});
