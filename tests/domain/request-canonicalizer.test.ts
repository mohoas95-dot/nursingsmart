import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_REQUEST_MONTH_VERSION,
  canonicalizeRequestDaysForMonth,
} from '../../domain/requests/request-canonicalizer';
import type { CanonicalRequestDay } from '../../domain/requests/request-domain';
import type { RequestSemanticValidationContext } from '../../domain/requests/request-semantic-validator';
import type { ShiftRequest } from '../../lib/types';

const YEAR = 1404;
const MONTH = 3;
const calendarDays = Array.from({ length: 31 }, (_, index) => ({
  day: index + 1,
  dayOfWeek: index % 7,
}));
const context: RequestSemanticValidationContext = {
  year: YEAR,
  month: MONTH,
  calendarDays,
  personnel: [{ id: 'p1' }, { id: 'p2' }],
};

function request(
  id: string,
  overrides: Partial<ShiftRequest> = {}
): ShiftRequest {
  return {
    id,
    personnelId: 'p1',
    requestType: 'shift',
    preferredShift: 'M',
    isEssential: false,
    scope: 'custom_days',
    selectedDays: [1],
    ...overrides,
  };
}

function pattern(
  id: string,
  patternSteps: string[],
  selectedDays: number[],
  overrides: Partial<ShiftRequest> = {}
): ShiftRequest {
  return request(id, {
    requestType: 'pattern',
    preferredShift: undefined,
    patternSteps,
    scope: 'custom_days',
    selectedDays,
    ...overrides,
  });
}

function daysFor(single: ShiftRequest): number[] {
  return canonicalizeRequestDaysForMonth([single], context).requestDays.map(item => item.day);
}

function positiveCellCounts(requestDays: ReadonlyArray<CanonicalRequestDay>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of requestDays) {
    if (item.polarity !== 'POSITIVE') continue;
    const key = `${item.personnelId}:${item.day}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Scope expansion
// ---------------------------------------------------------------------------

test('canonical request-day output has the approved month-specific shape', () => {
  const result = canonicalizeRequestDaysForMonth([
    request('shape', { preferredShift: 'ME', selectedDays: [1], isEssential: true }),
  ], context);

  assert.deepEqual(result.requestDays[0], {
    version: 'canonical-request-day/1',
    requestId: 'shape',
    personnelId: 'p1',
    year: YEAR,
    month: MONTH,
    day: 1,
    requestType: 'shift',
    expectedValue: 'ME',
    isEssential: true,
    polarity: 'POSITIVE',
    requestedComponents: ['M', 'E'],
  });
});

test('every supported scope expands through the authoritative month calendar', () => {
  const cases: ReadonlyArray<[ShiftRequest['scope'], number[]]> = [
    ['all', Array.from({ length: 31 }, (_, index) => index + 1)],
    ['even', Array.from({ length: 15 }, (_, index) => (index + 1) * 2)],
    ['odd', Array.from({ length: 16 }, (_, index) => index * 2 + 1)],
    ['saturdays', [1, 8, 15, 22, 29]],
    ['sundays', [2, 9, 16, 23, 30]],
    ['mondays', [3, 10, 17, 24, 31]],
    ['tuesdays', [4, 11, 18, 25]],
    ['wednesdays', [5, 12, 19, 26]],
    ['thursdays', [6, 13, 20, 27]],
    ['fridays', [7, 14, 21, 28]],
    ['weekly_even', calendarDays.filter(day => [0, 2, 4].includes(day.dayOfWeek)).map(day => day.day)],
    ['weekly_odd', calendarDays.filter(day => [1, 3, 5].includes(day.dayOfWeek)).map(day => day.day)],
    ['range', [3, 4, 5]],
    ['custom_days', [2, 30]],
  ];

  for (const [scope, expectedDays] of cases) {
    const scoped = request(`scope-${scope}`, {
      scope,
      selectedDays: scope === 'custom_days' ? [30, 2] : undefined,
      startDate: scope === 'range' ? '1404/03/03' : undefined,
      endDate: scope === 'range' ? '1404/03/05' : undefined,
    });
    assert.deepEqual(daysFor(scoped), expectedDays, scope);
  }
});

test('weekly scopes use supplied authoritative weekdays rather than inferred dates', () => {
  const shiftedCalendar = calendarDays.map(day => ({
    day: day.day,
    dayOfWeek: (day.dayOfWeek + 3) % 7,
  }));
  const shiftedContext = { ...context, calendarDays: shiftedCalendar };
  const result = canonicalizeRequestDaysForMonth([
    request('weekly-authority', { scope: 'saturdays', selectedDays: undefined }),
  ], shiftedContext);

  assert.deepEqual(
    result.requestDays.map(item => item.day),
    shiftedCalendar.filter(item => item.dayOfWeek === 0).map(item => item.day)
  );
});

test('custom_days emits only validated requested days in canonical day order', () => {
  const result = canonicalizeRequestDaysForMonth([
    request('custom', { selectedDays: [31, 1, 17] }),
  ], context);
  assert.deepEqual(result.requestDays.map(item => item.day), [1, 17, 31]);
});

test('range expansion is target-month specific and never crosses month boundaries', () => {
  const otherMonth = request('other-month', {
    scope: 'range',
    selectedDays: undefined,
    startDate: '1404/04/01',
    endDate: '1404/04/03',
  });
  const otherResult = canonicalizeRequestDaysForMonth([otherMonth], context);
  assert.deepEqual(otherResult.requestDays, []);
  assert.deepEqual(otherResult.issues.map(issue => issue.reason), ['EMPTY_EFFECTIVE_SCOPE']);

  const crossing = request('crossing', {
    scope: 'range',
    selectedDays: undefined,
    startDate: '1404/03/30',
    endDate: '1404/04/01',
  });
  const crossingResult = canonicalizeRequestDaysForMonth([crossing], context);
  assert.deepEqual(crossingResult.requestDays, []);
  assert.deepEqual(crossingResult.issues.map(issue => issue.reason), ['INVALID_DATE_RANGE']);
});

test('calendar length bounds custom-day expansion without fabricating day 31', () => {
  const thirtyDayContext: RequestSemanticValidationContext = {
    ...context,
    month: 7,
    calendarDays: calendarDays.slice(0, 30),
  };
  const result = canonicalizeRequestDaysForMonth([
    request('day-31', { selectedDays: [31] }),
  ], thirtyDayContext);
  assert.deepEqual(result.requestDays, []);
  assert.deepEqual(result.issues.map(issue => issue.reason), ['INVALID_SELECTED_DAY']);
});

// ---------------------------------------------------------------------------
// Pattern and component semantics
// ---------------------------------------------------------------------------

test('pattern steps resolve independently per applicable day using absolute day cadence', () => {
  const result = canonicalizeRequestDaysForMonth([
    pattern('pattern-cadence', ['M', 'E', 'OFF'], [1, 2, 4]),
  ], context);

  assert.deepEqual(
    result.requestDays.map(item => [item.day, item.expectedValue]),
    [[1, 'M'], [2, 'E'], [4, 'M']]
  );
});

test('pattern values preserve exact composite semantics and deterministic components', () => {
  const result = canonicalizeRequestDaysForMonth([
    pattern('pattern-composites', ['ME', 'EN', 'MN', 'MEN'], [1, 2, 3, 4]),
  ], context);

  assert.deepEqual(
    result.requestDays.map(item => [item.expectedValue, item.requestedComponents]),
    [
      ['ME', ['M', 'E']],
      ['EN', ['E', 'N']],
      ['MN', ['M', 'N']],
      ['MEN', ['M', 'E', 'N']],
    ]
  );
});

test('all canonical values expose stable component arrays, including OFF and L', () => {
  const requests: ShiftRequest[] = [
    request('m', { preferredShift: 'M', selectedDays: [1] }),
    request('e', { preferredShift: 'E', selectedDays: [2] }),
    request('n', { preferredShift: 'N', selectedDays: [3] }),
    request('me', { preferredShift: 'ME', selectedDays: [4] }),
    request('en', { preferredShift: 'EN', selectedDays: [5] }),
    request('mn', { preferredShift: 'MN', selectedDays: [6] }),
    request('men', { preferredShift: 'MEN', selectedDays: [7] }),
    request('off', { requestType: 'OFF', preferredShift: undefined, selectedDays: [8] }),
    request('leave', { requestType: 'leave', preferredShift: undefined, selectedDays: [9] }),
  ];
  const result = canonicalizeRequestDaysForMonth(requests, context);
  const byValue = new Map(result.requestDays.map(item => [item.expectedValue, item.requestedComponents]));

  assert.deepEqual(byValue.get('M'), ['M']);
  assert.deepEqual(byValue.get('E'), ['E']);
  assert.deepEqual(byValue.get('N'), ['N']);
  assert.deepEqual(byValue.get('ME'), ['M', 'E']);
  assert.deepEqual(byValue.get('EN'), ['E', 'N']);
  assert.deepEqual(byValue.get('MN'), ['M', 'N']);
  assert.deepEqual(byValue.get('MEN'), ['M', 'E', 'N']);
  assert.deepEqual(byValue.get('OFF'), ['OFF']);
  assert.deepEqual(byValue.get('L'), ['L']);
});

test('regular OFF and pattern OFF retain distinct request-type identity', () => {
  const result = canonicalizeRequestDaysForMonth([
    request('regular-off', {
      requestType: 'OFF',
      preferredShift: undefined,
      offHardness: 'soft',
      selectedDays: [10],
    }),
    pattern('pattern-off', ['OFF'], [11]),
  ], context);

  assert.deepEqual(
    result.requestDays.map(item => [item.requestType, item.expectedValue, item.requestedComponents]),
    [
      ['OFF', 'OFF', ['OFF']],
      ['pattern', 'OFF', ['OFF']],
    ]
  );
  assert.equal(result.requestDays[0].offHardness, 'soft');
  assert.equal(result.requestDays[1].offHardness, undefined);
});

test('regular leave and pattern leave retain distinct request-type identity', () => {
  const result = canonicalizeRequestDaysForMonth([
    request('regular-leave', { requestType: 'leave', preferredShift: undefined, selectedDays: [12] }),
    pattern('pattern-leave', ['L'], [13]),
  ], context);

  assert.deepEqual(
    result.requestDays.map(item => [item.requestType, item.expectedValue, item.requestedComponents]),
    [
      ['leave', 'L', ['L']],
      ['pattern', 'L', ['L']],
    ]
  );
});

test('M and E remain separate request-days and are never composed into ME', () => {
  const result = canonicalizeRequestDaysForMonth([
    request('m-only', { preferredShift: 'M', selectedDays: [14] }),
    request('e-only', { preferredShift: 'E', selectedDays: [15] }),
  ], context);

  assert.deepEqual(result.requestDays.map(item => item.expectedValue), ['M', 'E']);
  assert.equal(result.requestDays.some(item => item.expectedValue === 'ME'), false);
});

// ---------------------------------------------------------------------------
// Expanded positive conflicts and negative avoids
// ---------------------------------------------------------------------------

test('positive conflicts are detected from expanded person/day obligations', () => {
  const result = canonicalizeRequestDaysForMonth([
    request('positive-m', { preferredShift: 'M', selectedDays: [16], isEssential: true }),
    request('positive-e', { preferredShift: 'E', selectedDays: [16], isEssential: false }),
  ], context);
  const conflict = result.issues.find(issue => issue.kind === 'CONFLICT');

  assert.ok(conflict && conflict.kind === 'CONFLICT');
  assert.equal(conflict.reason, 'OVERLAPPING_POSITIVE_INTENT');
  assert.deepEqual(conflict.requestIds, ['positive-e', 'positive-m']);
  assert.deepEqual(conflict.days, [16]);
  assert.deepEqual(conflict.essentialFlags, [
    { requestId: 'positive-e', isEssential: false },
    { requestId: 'positive-m', isEssential: true },
  ]);
  assert.deepEqual(result.requestDays, []);
});

test('two patterns conflict only on their actual shared expanded day', () => {
  const result = canonicalizeRequestDaysForMonth([
    pattern('pattern-a', ['M'], [17, 18]),
    pattern('pattern-b', ['E'], [18, 19]),
  ], context);
  const conflict = result.issues.find(issue => issue.kind === 'CONFLICT');

  assert.ok(conflict && conflict.kind === 'CONFLICT');
  assert.deepEqual(conflict.days, [18]);
  assert.equal(conflict.reason, 'OVERLAPPING_POSITIVE_INTENT');
  assert.deepEqual(
    result.requestDays,
    [],
    'positive requests classified CONFLICT do not emit obligations on their other days'
  );
});

test('disjoint pattern scopes remain valid canonical obligations', () => {
  const result = canonicalizeRequestDaysForMonth([
    pattern('disjoint-a', ['M'], [20]),
    pattern('disjoint-b', ['E'], [21]),
  ], context);

  assert.equal(result.generationBlocked, false);
  assert.deepEqual(result.requestDays.map(item => [item.requestId, item.day]), [
    ['disjoint-a', 20],
    ['disjoint-b', 21],
  ]);
});

test('ME + M and MEN + ME remain conflicts rather than implicit composition', () => {
  const meAndM = canonicalizeRequestDaysForMonth([
    request('me', { preferredShift: 'ME', selectedDays: [22] }),
    request('m', { preferredShift: 'M', selectedDays: [22] }),
  ], context);
  assert.deepEqual(meAndM.issues.map(issue => issue.reason), ['OVERLAPPING_POSITIVE_INTENT']);
  assert.deepEqual(meAndM.requestDays, []);

  const menAndMe = canonicalizeRequestDaysForMonth([
    request('men', { preferredShift: 'MEN', selectedDays: [23] }),
    request('me-2', { preferredShift: 'ME', selectedDays: [23] }),
  ], context);
  assert.deepEqual(menAndMe.issues.map(issue => issue.reason), ['OVERLAPPING_POSITIVE_INTENT']);
  assert.deepEqual(menAndMe.requestDays, []);
});

test('duplicate positive intent remains distinct from ordinary overlap', () => {
  const duplicate = canonicalizeRequestDaysForMonth([
    request('duplicate-a', { preferredShift: 'N', selectedDays: [24] }),
    request('duplicate-b', { preferredShift: 'N', selectedDays: [24] }),
  ], context);
  assert.deepEqual(duplicate.issues.map(issue => issue.reason), ['DUPLICATE_POSITIVE_INTENT']);

  const overlap = canonicalizeRequestDaysForMonth([
    request('overlap-a', { preferredShift: 'N', selectedDays: [24] }),
    request('overlap-b', { preferredShift: 'E', selectedDays: [24] }),
  ], context);
  assert.deepEqual(overlap.issues.map(issue => issue.reason), ['OVERLAPPING_POSITIVE_INTENT']);
});

test('avoid plus positive does not create a positive conflict', () => {
  const result = canonicalizeRequestDaysForMonth([
    request('positive-en', { preferredShift: 'EN', selectedDays: [25] }),
    request('avoid-en', {
      requestType: 'avoid_shift',
      preferredShift: 'EN',
      selectedDays: [25],
      isEssential: true,
    }),
  ], context);

  assert.equal(result.generationBlocked, false);
  assert.deepEqual(result.requestDays.map(item => [
    item.requestId,
    item.expectedValue,
    item.polarity,
    item.requestedComponents,
  ]), [
    ['avoid-en', 'EN', 'NEGATIVE', ['E', 'N']],
    ['positive-en', 'EN', 'POSITIVE', ['E', 'N']],
  ]);
  assert.ok([...positiveCellCounts(result.requestDays).values()].every(count => count <= 1));
});

test('composite and single-component avoid targets retain their exact named target', () => {
  const result = canonicalizeRequestDaysForMonth([
    request('avoid-men', { requestType: 'avoid_shift', preferredShift: 'MEN', selectedDays: [26] }),
    request('avoid-m', { requestType: 'avoid_shift', preferredShift: 'M', selectedDays: [27] }),
  ], context);

  assert.deepEqual(result.requestDays.map(item => [
    item.expectedValue,
    item.requestedComponents,
    item.polarity,
  ]), [
    ['MEN', ['M', 'E', 'N'], 'NEGATIVE'],
    ['M', ['M'], 'NEGATIVE'],
  ]);
});

// ---------------------------------------------------------------------------
// Determinism, invalid exclusion, and immutability
// ---------------------------------------------------------------------------

test('canonical output uses person → day → request ID stable ordering', () => {
  const result = canonicalizeRequestDaysForMonth([
    request('z', { personnelId: 'p2', selectedDays: [2] }),
    request('b', { personnelId: 'p1', selectedDays: [2] }),
    request('a', { personnelId: 'p1', selectedDays: [1] }),
  ], context);

  assert.deepEqual(result.requestDays.map(item => [item.personnelId, item.day, item.requestId]), [
    ['p1', 1, 'a'],
    ['p1', 2, 'b'],
    ['p2', 2, 'z'],
  ]);
});

test('input reversal produces byte-for-byte equivalent output and conflict IDs', () => {
  const requests = [
    request('z-conflict', { preferredShift: 'ME', selectedDays: [28], isEssential: true }),
    request('a-conflict', { preferredShift: 'M', selectedDays: [28] }),
    request('valid', { personnelId: 'p2', preferredShift: 'N', selectedDays: [29] }),
    request('avoid', { requestType: 'avoid_shift', preferredShift: 'MN', selectedDays: [28] }),
  ];

  const forward = canonicalizeRequestDaysForMonth(requests, context);
  const reversed = canonicalizeRequestDaysForMonth([...requests].reverse(), context);
  assert.deepEqual(reversed, forward);
  assert.match(
    forward.issues.find(issue => issue.kind === 'CONFLICT')!.conflictId,
    /^request-conflict\/1\/OVERLAPPING_POSITIVE_INTENT\//
  );
});

test('invalid and empty-scope requests emit issues but no fabricated request-days', () => {
  const invalid = request('invalid', { preferredShift: 'OFF', selectedDays: [30] });
  const empty = request('empty', { selectedDays: [] });
  const result = canonicalizeRequestDaysForMonth([invalid, empty], context);

  assert.deepEqual(result.requestDays, []);
  assert.deepEqual(result.issues.map(issue => issue.reason), [
    'EMPTY_EFFECTIVE_SCOPE',
    'INVALID_PREFERRED_SHIFT',
  ]);
  assert.deepEqual(result.invalidRequestIds, ['empty', 'invalid']);
});

test('canonicalization never mutates source arrays, request objects, or nested arrays', () => {
  const requests = [
    request('immutable-shift', { preferredShift: 'ME', selectedDays: [31, 1] }),
    pattern('immutable-pattern', ['EN', 'OFF'], [2, 3]),
  ];
  const snapshot = JSON.stringify(requests);
  const originalArrayOrder = requests.map(item => item.id);

  const result = canonicalizeRequestDaysForMonth(requests, context);
  assert.equal(result.version, CANONICAL_REQUEST_MONTH_VERSION);
  assert.equal(JSON.stringify(requests), snapshot);
  assert.deepEqual(requests.map(item => item.id), originalArrayOrder);
  assert.deepEqual(requests[0].selectedDays, [31, 1]);
  assert.deepEqual(requests[1].patternSteps, ['EN', 'OFF']);
});
