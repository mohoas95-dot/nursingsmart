import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUEST_INVALID_REASONS,
  type ConflictRequestValidationIssue,
  type RequestInvalidReason,
} from '../../domain/requests/request-domain';
import {
  validateRequestsSemantically,
  type RequestSemanticValidationContext,
} from '../../domain/requests/request-semantic-validator';
import { RequestsSchema } from '../../lib/storageSchemas';

const calendarDays = Array.from({ length: 31 }, (_, index) => ({
  day: index + 1,
  dayOfWeek: index % 7,
}));

const context: RequestSemanticValidationContext = {
  year: 1404,
  month: 3,
  calendarDays,
  personnel: [{ id: 'p1' }, { id: 'p2' }],
};

function shiftRequest(
  id: string,
  preferredShift: string = 'M',
  days: number[] = [1],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    personnelId: 'p1',
    requestType: 'shift',
    preferredShift,
    isEssential: false,
    scope: 'custom_days',
    selectedDays: days,
    ...overrides,
  };
}

function patternRequest(
  id: string,
  patternSteps: string[],
  days: number[],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    personnelId: 'p1',
    requestType: 'pattern',
    patternSteps,
    isEssential: false,
    scope: 'custom_days',
    selectedDays: days,
    ...overrides,
  };
}

function invalidReasons(requests: ReadonlyArray<unknown>): RequestInvalidReason[] {
  return validateRequestsSemantically(requests, context).issues
    .filter(issue => issue.kind === 'INVALID')
    .map(issue => issue.reason);
}

function conflicts(requests: ReadonlyArray<unknown>): ConflictRequestValidationIssue[] {
  return validateRequestsSemantically(requests, context).issues
    .filter((issue): issue is ConflictRequestValidationIssue => issue.kind === 'CONFLICT');
}

// ---------------------------------------------------------------------------
// Every approved INVALID reason code
// ---------------------------------------------------------------------------

test('every approved INVALID reason is emitted for its corresponding malformed input', () => {
  const withoutPreferred = shiftRequest('missing-pref');
  delete withoutPreferred.preferredShift;

  const cases: ReadonlyArray<{
    reason: RequestInvalidReason;
    requests: ReadonlyArray<unknown>;
  }> = [
    {
      reason: 'DUPLICATE_REQUEST_ID',
      requests: [shiftRequest('duplicate-id', 'M'), shiftRequest('duplicate-id', 'E')],
    },
    {
      reason: 'MISSING_REQUEST_ID',
      requests: [shiftRequest('', 'M')],
    },
    {
      reason: 'MISSING_PERSONNEL_ID',
      requests: [shiftRequest('missing-person', 'M', [1], { personnelId: '' })],
    },
    {
      reason: 'UNKNOWN_PERSONNEL',
      requests: [shiftRequest('unknown-person', 'M', [1], { personnelId: 'not-in-context' })],
    },
    {
      reason: 'INVALID_REQUEST_TYPE',
      requests: [shiftRequest('bad-type', 'M', [1], { requestType: 'future_type' })],
    },
    {
      reason: 'INVALID_SCOPE',
      requests: [shiftRequest('bad-scope', 'M', [1], { scope: 'future_scope', selectedDays: undefined })],
    },
    {
      reason: 'EMPTY_EFFECTIVE_SCOPE',
      requests: [shiftRequest('empty-scope', 'M', [], { selectedDays: [] })],
    },
    {
      reason: 'INVALID_DATE_RANGE',
      requests: [shiftRequest('bad-range', 'M', [1], {
        scope: 'range',
        selectedDays: undefined,
        startDate: '1404/03/20',
        endDate: '1404/03/10',
      })],
    },
    {
      reason: 'INVALID_SELECTED_DAY',
      requests: [shiftRequest('bad-day', 'M', [0])],
    },
    {
      reason: 'MISSING_PREFERRED_SHIFT',
      requests: [withoutPreferred],
    },
    {
      reason: 'INVALID_PREFERRED_SHIFT',
      requests: [shiftRequest('bad-shift', 'OFF')],
    },
    {
      reason: 'EMPTY_PATTERN',
      requests: [patternRequest('empty-pattern', [], [1])],
    },
    {
      reason: 'INVALID_PATTERN_STEP',
      requests: [patternRequest('bad-pattern-step', ['m'], [1])],
    },
  ];

  assert.deepEqual(
    cases.map(item => item.reason),
    [...REQUEST_INVALID_REASONS],
    'the test table must cover every contract reason exactly once'
  );

  for (const item of cases) {
    const result = validateRequestsSemantically(item.requests, context);
    assert.equal(result.valid, false, item.reason);
    assert.equal(result.generationBlocked, true, item.reason);
    assert.ok(invalidReasons(item.requests).includes(item.reason), item.reason);
  }
});

test('valid and invalid scope parameters are classified without normalization', () => {
  const validRange = shiftRequest('valid-range', 'M', [1], {
    scope: 'range',
    selectedDays: undefined,
    startDate: '1404/03/01',
    endDate: '1404/03/03',
  });
  assert.equal(validateRequestsSemantically([validRange], context).valid, true);

  const invalidScopes = [
    shiftRequest('cross-month-range', 'M', [1], {
      scope: 'range',
      selectedDays: undefined,
      startDate: '1404/03/30',
      endDate: '1404/04/01',
    }),
    shiftRequest('invalid-jalali-date', 'M', [1], {
      scope: 'range',
      selectedDays: undefined,
      startDate: '1404/07/31',
      endDate: '1404/07/31',
    }),
    shiftRequest('duplicate-selected-day', 'M', [4, 4]),
    shiftRequest('irrelevant-params', 'M', [1], {
      scope: 'all',
      selectedDays: [1],
    }),
  ];
  const result = validateRequestsSemantically(invalidScopes, context);
  assert.deepEqual(
    result.issues.filter(issue => issue.kind === 'INVALID').map(issue => issue.reason),
    ['INVALID_SCOPE', 'INVALID_DATE_RANGE', 'INVALID_DATE_RANGE', 'INVALID_SELECTED_DAY']
  );
});

test('request-type/value combinations preserve regular OFF, leave, pattern OFF/L, and work semantics', () => {
  const requests = [
    { id: 'off-implicit', personnelId: 'p1', requestType: 'OFF', isEssential: false, scope: 'custom_days', selectedDays: [1] },
    { id: 'off-explicit', personnelId: 'p1', requestType: 'OFF', preferredShift: 'OFF', isEssential: false, scope: 'custom_days', selectedDays: [2] },
    { id: 'leave-implicit', personnelId: 'p1', requestType: 'leave', isEssential: false, scope: 'custom_days', selectedDays: [3] },
    { id: 'leave-explicit', personnelId: 'p1', requestType: 'leave', preferredShift: 'L', isEssential: false, scope: 'custom_days', selectedDays: [4] },
    patternRequest('pattern-off-leave', ['OFF', 'L'], [5, 6]),
    shiftRequest('work', 'MEN', [7]),
    { id: 'avoid', personnelId: 'p1', requestType: 'avoid_shift', preferredShift: 'EN', isEssential: false, scope: 'custom_days', selectedDays: [8] },
  ];

  const result = validateRequestsSemantically(requests, context);
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
});

test('structural storage parsing stays separate from semantic INVALID classification', () => {
  const structurallyReadable = [
    { id: 'legacy-empty-pattern', personnelId: 'p1', requestType: 'pattern', patternSteps: [], isEssential: false, scope: 'custom_days', selectedDays: [1] },
    { id: 'legacy-missing-shift', personnelId: 'p1', requestType: 'shift', isEssential: false, scope: 'custom_days', selectedDays: [2] },
    // Missing legacy preferredShift/offHardness is valid because requestType carries OFF intent.
    { id: 'legacy-off', personnelId: 'p1', requestType: 'OFF', isEssential: false, scope: 'custom_days', selectedDays: [3] },
  ];

  assert.equal(RequestsSchema.safeParse(structurallyReadable).success, true);
  const semantic = validateRequestsSemantically(structurallyReadable, context);
  assert.deepEqual(
    semantic.issues.filter(issue => issue.kind === 'INVALID').map(issue => issue.reason),
    ['MISSING_PREFERRED_SHIFT', 'EMPTY_PATTERN']
  );
  assert.deepEqual(semantic.validRequestIds, ['legacy-off']);
});

test('invalid type/value combinations are classified and never rewritten', () => {
  const malformed = [
    { id: 'off-as-leave', personnelId: 'p1', requestType: 'OFF', preferredShift: 'L', isEssential: false, scope: 'custom_days', selectedDays: [1] },
    { id: 'leave-as-off', personnelId: 'p1', requestType: 'leave', preferredShift: 'OFF', isEssential: false, scope: 'custom_days', selectedDays: [2] },
    { id: 'shift-with-pattern', personnelId: 'p1', requestType: 'shift', preferredShift: 'M', patternSteps: ['M'], isEssential: false, scope: 'custom_days', selectedDays: [3] },
  ];
  const before = JSON.parse(JSON.stringify(malformed));

  const result = validateRequestsSemantically(malformed, context);
  assert.equal(result.valid, false);
  assert.deepEqual(malformed, before, 'semantic validation must not repair source records');
  assert.deepEqual(
    new Set(result.issues.filter(issue => issue.kind === 'INVALID').map(issue => issue.reason)),
    new Set(['INVALID_PREFERRED_SHIFT', 'INVALID_PATTERN_STEP'])
  );
});

test('personnel references are checked only when personnel context is supplied', () => {
  const request = shiftRequest('external-person', 'M', [1], { personnelId: 'external' });
  assert.equal(validateRequestsSemantically([request], { ...context, personnel: undefined }).valid, true);
  assert.deepEqual(invalidReasons([request]), ['UNKNOWN_PERSONNEL']);
});

// ---------------------------------------------------------------------------
// Positive conflicts and duplicate intent
// ---------------------------------------------------------------------------

test('different IDs with the same positive obligation are duplicate intent', () => {
  const result = validateRequestsSemantically([
    shiftRequest('same-a', 'M', [1, 2]),
    shiftRequest('same-b', 'M', [2, 3]),
  ], context);
  const found = result.issues.filter(issue => issue.kind === 'CONFLICT');

  assert.equal(found.length, 1);
  assert.equal(found[0].reason, 'DUPLICATE_POSITIVE_INTENT');
  assert.deepEqual(found[0].requestIds, ['same-a', 'same-b']);
  assert.deepEqual(found[0].days, [2]);
  assert.match(found[0].conflictId, /^request-conflict\/1\/DUPLICATE_POSITIVE_INTENT\//);
});

test('different positive obligations on the same person/day are overlapping intent', () => {
  const found = conflicts([
    shiftRequest('overlap-a', 'M', [4]),
    shiftRequest('overlap-b', 'E', [4]),
  ]);

  assert.equal(found.length, 1);
  assert.equal(found[0].reason, 'OVERLAPPING_POSITIVE_INTENT');
  assert.deepEqual(found[0].requestIds, ['overlap-a', 'overlap-b']);
  assert.deepEqual(found[0].days, [4]);
});

test('Essentiality never resolves an Essential + normal positive overlap', () => {
  const found = conflicts([
    shiftRequest('essential', 'N', [5], { isEssential: true }),
    shiftRequest('normal', 'E', [5], { isEssential: false }),
  ]);

  assert.equal(found.length, 1);
  assert.equal(found[0].reason, 'OVERLAPPING_POSITIVE_INTENT');
  assert.deepEqual(found[0].requestIds, ['essential', 'normal']);
});

test('a composite and its contained positive shift are still a conflict', () => {
  const found = conflicts([
    shiftRequest('composite', 'ME', [6]),
    shiftRequest('contained', 'M', [6]),
  ]);

  assert.equal(found.length, 1);
  assert.equal(found[0].reason, 'OVERLAPPING_POSITIVE_INTENT');
  assert.deepEqual(found[0].days, [6]);
});

test('pattern and explicit shift obligations conflict on their shared day', () => {
  const found = conflicts([
    patternRequest('pattern', ['M'], [7]),
    shiftRequest('explicit', 'E', [7]),
  ]);

  assert.equal(found.length, 1);
  assert.equal(found[0].reason, 'OVERLAPPING_POSITIVE_INTENT');
  assert.deepEqual(found[0].requestIds, ['explicit', 'pattern']);
});

test('pattern and explicit shift with the same per-day value are duplicate intent', () => {
  const found = conflicts([
    patternRequest('pattern-m', ['M'], [8]),
    shiftRequest('explicit-m', 'M', [8]),
  ]);

  assert.equal(found.length, 1);
  assert.equal(found[0].reason, 'DUPLICATE_POSITIVE_INTENT');
});

test('overlapping patterns conflict, while disjoint patterns remain valid', () => {
  const overlapping = conflicts([
    patternRequest('pattern-a', ['M'], [9, 10]),
    patternRequest('pattern-b', ['E'], [10, 11]),
  ]);
  assert.equal(overlapping.length, 1);
  assert.equal(overlapping[0].reason, 'OVERLAPPING_POSITIVE_INTENT');
  assert.deepEqual(overlapping[0].days, [10]);

  const disjoint = validateRequestsSemantically([
    patternRequest('disjoint-a', ['M'], [12]),
    patternRequest('disjoint-b', ['E'], [13]),
  ], context);
  assert.equal(disjoint.valid, true);
  assert.deepEqual(disjoint.issues, []);
});

test('regular OFF, leave, and pattern OFF retain distinct positive semantics', () => {
  const regularVsLeave = conflicts([
    { id: 'regular-off', personnelId: 'p1', requestType: 'OFF', isEssential: false, scope: 'custom_days', selectedDays: [14] },
    { id: 'regular-leave', personnelId: 'p1', requestType: 'leave', isEssential: false, scope: 'custom_days', selectedDays: [14] },
  ]);
  assert.equal(regularVsLeave[0].reason, 'OVERLAPPING_POSITIVE_INTENT');

  const regularVsPatternOff = conflicts([
    { id: 'regular-off-2', personnelId: 'p1', requestType: 'OFF', isEssential: false, scope: 'custom_days', selectedDays: [15] },
    patternRequest('pattern-off', ['OFF'], [15]),
  ]);
  assert.equal(regularVsPatternOff[0].reason, 'OVERLAPPING_POSITIVE_INTENT');
});

test('identical IDs are INVALID and are not reclassified as positive conflict', () => {
  const result = validateRequestsSemantically([
    shiftRequest('same-id', 'M', [16]),
    shiftRequest('same-id', 'E', [16]),
  ], context);

  assert.deepEqual(invalidReasons([
    shiftRequest('same-id', 'M', [16]),
    shiftRequest('same-id', 'E', [16]),
  ]), ['DUPLICATE_REQUEST_ID']);
  assert.equal(result.issues.some(issue => issue.kind === 'CONFLICT'), false);
  assert.deepEqual(result.invalidRequestIds, ['same-id']);
});

test('avoid requests are negative intent and may coexist with each other and positive requests', () => {
  const requests = [
    { id: 'avoid-a', personnelId: 'p1', requestType: 'avoid_shift', preferredShift: 'M', isEssential: false, scope: 'custom_days', selectedDays: [17] },
    { id: 'avoid-b', personnelId: 'p1', requestType: 'avoid_shift', preferredShift: 'M', isEssential: true, scope: 'custom_days', selectedDays: [17] },
    { id: 'avoid-c', personnelId: 'p1', requestType: 'avoid_shift', preferredShift: 'EN', isEssential: false, scope: 'custom_days', selectedDays: [17] },
    shiftRequest('positive', 'M', [17]),
  ];

  const result = validateRequestsSemantically(requests, context);
  assert.equal(result.valid, true);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.validRequestIds, ['avoid-a', 'avoid-b', 'avoid-c', 'positive']);
});

// ---------------------------------------------------------------------------
// Determinism, exclusions, and legacy classification
// ---------------------------------------------------------------------------

test('reversing input produces byte-for-byte identical issues, IDs, and classifications', () => {
  const requests = [
    shiftRequest('z-normal', 'E', [18], { isEssential: false }),
    shiftRequest('a-essential', 'M', [18], { isEssential: true }),
    shiftRequest('duplicate-a', 'N', [19]),
    shiftRequest('duplicate-b', 'N', [19]),
    patternRequest('bad-legacy', ['lowercase'], [20]),
    { id: 'avoid-ok', personnelId: 'p1', requestType: 'avoid_shift', preferredShift: 'N', isEssential: false, scope: 'custom_days', selectedDays: [18] },
  ];

  const forward = validateRequestsSemantically(requests, context);
  const reversed = validateRequestsSemantically([...requests].reverse(), context);
  assert.deepEqual(reversed, forward);
  assert.deepEqual(
    forward.issues.filter(issue => issue.kind === 'CONFLICT').map(issue => issue.conflictId),
    [...forward.issues]
      .filter((issue): issue is ConflictRequestValidationIssue => issue.kind === 'CONFLICT')
      .map(issue => issue.conflictId)
  );
});

test('INVALID and CONFLICT records are excluded from the validator valid set', () => {
  const result = validateRequestsSemantically([
    patternRequest('invalid', ['bad'], [21]),
    shiftRequest('conflict-a', 'M', [22]),
    shiftRequest('conflict-b', 'E', [22]),
    { id: 'avoid-valid', personnelId: 'p1', requestType: 'avoid_shift', preferredShift: 'N', isEssential: false, scope: 'custom_days', selectedDays: [22] },
  ], context);

  assert.deepEqual(result.invalidRequestIds, ['invalid']);
  assert.deepEqual(result.conflictingRequestIds, ['conflict-a', 'conflict-b']);
  assert.deepEqual(result.validRequestIds, ['avoid-valid']);
  assert.equal(result.generationBlocked, true);
});

test('malformed legacy records are classified without normalization or silent repair', () => {
  const legacy = [
    {
      id: 'legacy-lowercase',
      personnelId: 'p1',
      requestType: 'shift',
      preferredShift: 'm',
      isEssential: false,
      scope: 'custom_days',
      selectedDays: [23],
    },
    {
      id: 'legacy-duplicate-day',
      personnelId: 'p1',
      requestType: 'OFF',
      preferredShift: 'OFF',
      isEssential: false,
      scope: 'custom_days',
      selectedDays: [24, 24],
    },
  ];
  const snapshot = JSON.stringify(legacy);

  const result = validateRequestsSemantically(legacy, context);
  assert.equal(result.valid, false);
  assert.deepEqual(
    result.issues.filter(issue => issue.kind === 'INVALID').map(issue => issue.reason),
    ['INVALID_SELECTED_DAY', 'INVALID_PREFERRED_SHIFT']
  );
  assert.equal(JSON.stringify(legacy), snapshot);
  assert.equal((legacy[0] as { preferredShift: string }).preferredShift, 'm');
  assert.deepEqual((legacy[1] as { selectedDays: number[] }).selectedDays, [24, 24]);
});
