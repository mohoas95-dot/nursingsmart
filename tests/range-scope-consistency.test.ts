/**
 * Regression (Phase 3, Fix 2): canonical `range` scope in the solver.
 *
 * The solver previously re-implemented request-scope matching inline in two
 * places (assignment-time and verification-time), comparing full `YYYY/MM/DD`
 * date strings for the `range` scope, while the canonical matcher
 * (`isDayInRequestScope`) compares day-of-month.
 *
 * POLICY (confirmed): every request is single-month and a `range` never crosses
 * a month boundary. For single-month ranges the two implementations are
 * equivalent, so replacing the inline blocks with the canonical matcher is
 * behavior-preserving. These tests pin that equivalence:
 *
 *   1. A single-month range that spans several days is honored.
 *   2. Solver assignment and verification agree for the same range request.
 *   3. A day OUTSIDE the range is NOT treated as in-scope.
 *
 * The tests use month 1404/03 so the range dates belong to the scheduled month.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { solveNursingSchedule, verifyCoverageAndLeaders } from '../lib/solver';
import { isDayInRequestScope } from '../domain/requests/request-scope-matcher';
import { generateJalaliMonthCalendar } from '../lib/jalali';
import type { Personnel, ShiftRequest, SystemSettings } from '../lib/types';

const YEAR = 1404;
const MONTH = 3;

function nurse(id: string): Personnel {
  return {
    id,
    firstName: id,
    lastName: 'test',
    personalCode: id,
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'official',
    experienceYears: 1,
    active: true,
    canBeShiftLeader: true,
  };
}

function noDemandSettings(): SystemSettings {
  const demand = {
    morningNurse: 0,
    morningAssistant: 0,
    afternoonNurse: 0,
    afternoonAssistant: 0,
    afternoonLeader: 0,
    nightNurse: 0,
    nightAssistant: 0,
    nightLeader: 0,
  };
  return {
    dutyHours: { official: 160, contract: 174, conscript: 180, overtime: 150 },
    demand: { weekday: { ...demand }, holiday: { ...demand } },
  };
}

// A single-month range request over days 10..15 (all within month 1404/03).
function rangeShiftRequest(personnelId: string): ShiftRequest {
  return {
    id: `${personnelId}-range`,
    personnelId,
    requestType: 'shift',
    preferredShift: 'M',
    isEssential: true,
    scope: 'range',
    startDate: '1404/03/10',
    endDate: '1404/03/15',
  };
}

test('canonical matcher: single-month range covers each in-range day and excludes out-of-range days', () => {
  const req = rangeShiftRequest('n1');
  const calendar = generateJalaliMonthCalendar(YEAR, MONTH, {}, undefined);
  for (let day = 1; day <= calendar.length; day++) {
    const inScope = isDayInRequestScope(day, calendar[day - 1].dayOfWeek, req);
    const expected = day >= 10 && day <= 15;
    assert.equal(inScope, expected, `day ${day} scope expected ${expected}`);
  }
});

test('solver assignment honors a single-month range shift request on every in-range day only', () => {
  const req = rangeShiftRequest('n1');
  const result = solveNursingSchedule(
    YEAR,
    MONTH,
    [nurse('n1')],
    [req],
    noDemandSettings(),
    {},
    undefined,
    null,
  );

  // In-range days must carry the requested M shift; the request is essential and
  // there is no competing demand, so the solver must satisfy it exactly there.
  for (let day = 10; day <= 15; day++) {
    assert.equal(
      result.assignments.n1[day],
      'M',
      `in-range day ${day} should be assigned M by the explicit range request`,
    );
  }
});

test('verification reports a range mismatch only for in-range days', () => {
  const req = rangeShiftRequest('n1');
  // Hand-built assignment that VIOLATES the M request across the whole month:
  // every day is OFF. Verification should flag mismatches for in-range days
  // (10..15) and NOT for out-of-range days.
  const assignments: Record<string, Record<number, string>> = { n1: {} };
  const calendar = generateJalaliMonthCalendar(YEAR, MONTH, {}, undefined);
  for (let day = 1; day <= calendar.length; day++) assignments.n1[day] = 'OFF';

  const verification = verifyCoverageAndLeaders(
    YEAR,
    MONTH,
    [nurse('n1')],
    assignments,
    noDemandSettings(),
    {},
    undefined,
    [req],
    null,
  );

  const mismatchDays = new Set<number>();
  for (const w of verification.warnings) {
    const m = /Mismatched Request:.*روز (\d+)/.exec(w);
    if (m) mismatchDays.add(Number(m[1]));
  }

  for (let day = 10; day <= 15; day++) {
    assert.ok(mismatchDays.has(day), `in-range day ${day} should be reported as a mismatch`);
  }
  // Out-of-range days must NOT be reported for this range request.
  for (const day of [1, 9, 16, calendar.length]) {
    assert.equal(mismatchDays.has(day), false, `out-of-range day ${day} must not be a mismatch`);
  }
});

test('solver assignment and verification agree on the same single-month range request', () => {
  const req = rangeShiftRequest('n1');
  const result = solveNursingSchedule(
    YEAR,
    MONTH,
    [nurse('n1')],
    [req],
    noDemandSettings(),
    {},
    undefined,
    null,
  );

  // Verifying the solver's own output must produce NO range mismatch, because
  // the solver assigned the request on exactly the in-range days.
  const verification = verifyCoverageAndLeaders(
    YEAR,
    MONTH,
    [nurse('n1')],
    result.assignments,
    noDemandSettings(),
    {},
    undefined,
    [req],
    null,
  );

  const hasRangeMismatch = verification.warnings.some(w =>
    w.startsWith('Mismatched Request:') && w.includes('درخواست شیفت M'),
  );
  assert.equal(hasRangeMismatch, false, 'solver output should satisfy its own range request under verification');
});
