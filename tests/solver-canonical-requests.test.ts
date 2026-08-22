import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeRequestDaysForMonth } from '../domain/requests/request-canonicalizer';
import {
  RequestGenerationBlockedError,
  adaptCanonicalRequestMonthForSolver,
} from '../domain/requests/solver-request-adapter';
import { generateJalaliMonthCalendar } from '../lib/jalali';
import { generateAndScoreScenarios } from '../lib/scenarioGenerator';
import { solveNursingSchedule, solveWithPriority } from '../lib/solver';
import type { MonthlySchedule, Personnel, ShiftRequest, SystemSettings } from '../lib/types';
import { CAL_MONTH, CAL_YEAR, makePerson, makeRequest, makeSettings } from './fixtures/realistic';

const personnel = [makePerson('p1'), makePerson('p2')];
const noDemand = makeSettings({ morningNurse: 0, afternoonNurse: 0, nightNurse: 0 });
const calendar = generateJalaliMonthCalendar(CAL_YEAR, CAL_MONTH, {}, undefined);

function request(
  id: string,
  preferredShift: ShiftRequest['preferredShift'],
  day: number,
  isEssential = false,
  personnelId = 'p1'
): ShiftRequest {
  return makeRequest(personnelId, {
    id,
    requestType: 'shift',
    preferredShift,
    isEssential,
    scope: 'custom_days',
    selectedDays: [day],
  });
}

function pattern(
  id: string,
  steps: string[],
  days: number[],
  isEssential = false
): ShiftRequest {
  return makeRequest('p1', {
    id,
    requestType: 'pattern',
    patternSteps: steps,
    isEssential,
    scope: 'custom_days',
    selectedDays: days,
  });
}

function canonical(requests: readonly ShiftRequest[]) {
  return canonicalizeRequestDaysForMonth(requests, {
    year: CAL_YEAR,
    month: CAL_MONTH,
    calendarDays: calendar,
    personnel,
  });
}

function blockedBySolver(requests: readonly ShiftRequest[]): RequestGenerationBlockedError {
  try {
    solveNursingSchedule(CAL_YEAR, CAL_MONTH, personnel, requests, noDemand, {}, undefined, null);
  } catch (error) {
    assert.ok(error instanceof RequestGenerationBlockedError);
    return error;
  }
  assert.fail('expected request generation to be blocked');
}

function schedule(requests: readonly ShiftRequest[], people: readonly Personnel[] = personnel): MonthlySchedule {
  return solveNursingSchedule(
    CAL_YEAR,
    CAL_MONTH,
    people,
    requests,
    noDemand,
    {},
    undefined,
    null
  );
}

// ---------------------------------------------------------------------------
// Generation-blocking conflict policy
// ---------------------------------------------------------------------------

test('Essential vs normal positive conflict blocks generation; Essential does not win', () => {
  const error = blockedBySolver([
    request('normal-e', 'E', 1, false),
    request('essential-m', 'M', 1, true),
  ]);
  const conflict = error.issues.find(issue => issue.kind === 'CONFLICT');

  assert.ok(conflict && conflict.kind === 'CONFLICT');
  assert.equal(conflict.reason, 'OVERLAPPING_POSITIVE_INTENT');
  assert.deepEqual(conflict.essentialFlags, [
    { requestId: 'essential-m', isEssential: true },
    { requestId: 'normal-e', isEssential: false },
  ]);
});

test('Essential vs Essential positive conflict remains generation-blocking', () => {
  const error = blockedBySolver([
    request('essential-e', 'E', 2, true),
    request('essential-m', 'M', 2, true),
  ]);
  assert.deepEqual(error.issues.map(issue => issue.reason), ['OVERLAPPING_POSITIVE_INTENT']);
});

test('normal vs normal positive conflict remains generation-blocking', () => {
  const error = blockedBySolver([
    request('normal-e', 'E', 3),
    request('normal-m', 'M', 3),
  ]);
  assert.deepEqual(error.issues.map(issue => issue.reason), ['OVERLAPPING_POSITIVE_INTENT']);
});

test('composite overlaps block generation without implicit composition', () => {
  const cases: ReadonlyArray<[ShiftRequest['preferredShift'], ShiftRequest['preferredShift']]> = [
    ['ME', 'M'],
    ['EN', 'E'],
    ['MEN', 'ME'],
  ];

  for (const [left, right] of cases) {
    const error = blockedBySolver([
      request(`left-${left}`, left, 4),
      request(`right-${right}`, right, 4),
    ]);
    assert.deepEqual(error.issues.map(issue => issue.reason), ['OVERLAPPING_POSITIVE_INTENT']);
  }
});

test('overlapping patterns block only on shared days; disjoint patterns reach the solver', () => {
  const overlap = blockedBySolver([
    pattern('pattern-m', ['M'], [5, 6]),
    pattern('pattern-e', ['E'], [6, 7]),
  ]);
  const conflict = overlap.issues.find(issue => issue.kind === 'CONFLICT');
  assert.ok(conflict && conflict.kind === 'CONFLICT');
  assert.deepEqual(conflict.days, [6]);

  const solved = schedule([
    pattern('disjoint-m', ['M'], [8]),
    pattern('disjoint-e', ['E'], [9]),
  ]);
  assert.equal(solved.assignments.p1[8], 'M');
  assert.equal(solved.assignments.p1[9], 'E');
});

test('conflict behavior and issues are invariant under request order reversal', () => {
  const requests = [
    request('z-essential', 'ME', 10, true),
    request('a-normal', 'M', 10, false),
  ];
  const forward = blockedBySolver(requests);
  const reversed = blockedBySolver([...requests].reverse());
  assert.deepEqual(reversed.issues, forward.issues);
  assert.equal(reversed.message, forward.message);
});

test('INVALID request sets do not become solver obligations', () => {
  const invalid = makeRequest('p1', {
    id: 'invalid-shift',
    requestType: 'shift',
    preferredShift: 'OFF',
    isEssential: false,
    scope: 'custom_days',
    selectedDays: [11],
  });
  const error = blockedBySolver([invalid]);
  assert.deepEqual(error.issues.map(issue => [issue.kind, issue.reason]), [
    ['INVALID', 'INVALID_PREFERRED_SHIFT'],
  ]);
});

test('solveWithPriority uses the same generation-blocking canonical boundary', () => {
  assert.throws(
    () => solveWithPriority(
      CAL_YEAR,
      CAL_MONTH,
      personnel,
      [request('priority-m', 'M', 12), request('priority-e', 'E', 12)],
      noDemand,
      {},
      undefined,
      null
    ),
    RequestGenerationBlockedError
  );
});

test('scenario generation cannot bypass canonical conflict validation', () => {
  assert.throws(
    () => generateAndScoreScenarios(
      CAL_YEAR,
      CAL_MONTH,
      personnel,
      [request('scenario-m', 'M', 13), request('scenario-e', 'E', 13)],
      noDemand,
      {},
      undefined,
      null,
      'nurse',
      { p1: { 1: 'OFF' }, p2: { 1: 'OFF' } },
      []
    ),
    RequestGenerationBlockedError
  );
});

// ---------------------------------------------------------------------------
// Canonical solver consumption and metadata
// ---------------------------------------------------------------------------

test('solver consumes each already-expanded pattern day instead of first-pattern lookup', () => {
  const requests = [
    pattern('first-pattern', ['M'], [14]),
    pattern('second-pattern', ['EN'], [15]),
  ];
  const month = canonical(requests);
  assert.deepEqual(month.requestDays.map(day => [day.day, day.expectedValue]), [
    [14, 'M'],
    [15, 'EN'],
  ]);

  const solved = schedule(requests);
  assert.equal(solved.assignments.p1[14], 'M');
  assert.equal(solved.assignments.p1[15], 'EN');
});

test('Essentiality is preserved as metadata but does not change valid assignment behavior', () => {
  const normalRequest = request('normal', 'M', 16, false);
  const essentialRequest = request('essential', 'M', 16, true);
  const normalMonth = canonical([normalRequest]);
  const essentialMonth = canonical([essentialRequest]);
  const essentialView = adaptCanonicalRequestMonthForSolver(essentialMonth);

  assert.equal(essentialView.positiveFor('p1', 16)?.isEssential, true);
  assert.equal(schedule([normalRequest]).assignments.p1[16], 'M');
  assert.equal(schedule([essentialRequest]).assignments.p1[16], 'M');
  assert.deepEqual(
    normalMonth.requestDays[0].requestedComponents,
    essentialMonth.requestDays[0].requestedComponents
  );
});

test('regular OFF preserves canonical hard/soft metadata and existing assignment semantics', () => {
  const hardOff = makeRequest('p1', {
    id: 'hard-off',
    requestType: 'OFF',
    isEssential: false,
    offHardness: 'hard',
    scope: 'custom_days',
    selectedDays: [17],
  });
  const softOff = makeRequest('p1', {
    id: 'soft-off',
    requestType: 'OFF',
    isEssential: true,
    offHardness: 'soft',
    scope: 'custom_days',
    selectedDays: [18],
  });
  const view = adaptCanonicalRequestMonthForSolver(canonical([hardOff, softOff]));

  assert.equal(view.positiveFor('p1', 17)?.offHardness, 'hard');
  assert.equal(view.positiveFor('p1', 18)?.offHardness, 'soft');
  const solved = schedule([hardOff, softOff]);
  assert.equal(solved.assignments.p1[17], 'OFF');
  assert.equal(solved.assignments.p1[18], 'OFF');
});

test('pattern OFF remains pattern identity and never becomes regular hard OFF', () => {
  const requestValue = pattern('pattern-off', ['OFF'], [19], true);
  const view = adaptCanonicalRequestMonthForSolver(canonical([requestValue]));
  const requestDay = view.positiveFor('p1', 19);

  assert.equal(requestDay?.requestType, 'pattern');
  assert.equal(requestDay?.expectedValue, 'OFF');
  assert.equal(requestDay?.offHardness, undefined);
  assert.equal(view.compatibilityRequests[0].requestType, 'pattern');
  assert.equal(view.compatibilityRequests[0].offHardness, undefined);
  assert.equal(schedule([requestValue]).assignments.p1[19], 'OFF');
});

test('regular leave retains numbered leave semantics', () => {
  const leave = makeRequest('p1', {
    id: 'regular-leave',
    requestType: 'leave',
    isEssential: false,
    scope: 'custom_days',
    selectedDays: [20],
  });
  const view = adaptCanonicalRequestMonthForSolver(canonical([leave]));

  assert.equal(view.positiveFor('p1', 20)?.requestType, 'leave');
  assert.match(schedule([leave]).assignments.p1[20], /^L(?:1|H)$/);
});

test('pattern leave remains distinguishable from regular leave', () => {
  const patternLeave = pattern('pattern-leave', ['L'], [21]);
  const view = adaptCanonicalRequestMonthForSolver(canonical([patternLeave]));
  const requestDay = view.positiveFor('p1', 21);

  assert.equal(requestDay?.requestType, 'pattern');
  assert.equal(requestDay?.expectedValue, 'L');
  assert.equal(view.compatibilityRequests[0].requestType, 'pattern');
  assert.equal(schedule([patternLeave]).assignments.p1[21], 'L');
});

test('avoid obligations remain separate from the positive request map', () => {
  const positive = request('positive-m', 'M', 22);
  const avoid = makeRequest('p1', {
    id: 'avoid-m',
    requestType: 'avoid_shift',
    preferredShift: 'M',
    isEssential: true,
    scope: 'custom_days',
    selectedDays: [22],
  });
  const view = adaptCanonicalRequestMonthForSolver(canonical([positive, avoid]));

  assert.equal(view.positiveFor('p1', 22)?.requestId, 'positive-m');
  assert.deepEqual(view.negativeFor('p1', 22).map(day => day.requestId), ['avoid-m']);
  assert.equal(schedule([positive, avoid]).assignments.p1[22], 'M');
});

test('composite avoid target remains exact EN in canonical and compatibility views', () => {
  const avoid = makeRequest('p1', {
    id: 'avoid-en',
    requestType: 'avoid_shift',
    preferredShift: 'EN',
    isEssential: false,
    scope: 'custom_days',
    selectedDays: [23],
  });
  const view = adaptCanonicalRequestMonthForSolver(canonical([avoid]));
  const negative = view.negativeFor('p1', 23)[0];

  assert.equal(negative.expectedValue, 'EN');
  assert.deepEqual(negative.requestedComponents, ['E', 'N']);
  assert.equal(view.compatibilityRequests[0].preferredShift, 'EN');
});

test('valid canonical obligations are order-invariant at solver output', () => {
  const requests = [
    request('p1-m', 'M', 24, false, 'p1'),
    request('p2-e', 'E', 25, true, 'p2'),
  ];
  const forward = schedule(requests);
  const reversed = schedule([...requests].reverse());
  assert.deepEqual(reversed, forward);
});
