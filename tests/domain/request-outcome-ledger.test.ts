import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeRequestDaysForMonth } from '../../domain/requests/request-canonicalizer';
import {
  REQUEST_RESOLUTION_PROVENANCE_VERSION,
  type RequestResolutionProvenance,
} from '../../domain/requests/request-domain';
import { buildRequestOutcomeLedger } from '../../domain/requests/request-outcome-ledger';
import { generateJalaliMonthCalendar } from '../../lib/jalali';
import { solveNursingSchedule } from '../../lib/solver';
import type { ShiftRequest } from '../../lib/types';
import { CAL_MONTH, CAL_YEAR, makePerson, makeRequest, makeSettings } from '../fixtures/realistic';

const people = [makePerson('p1'), makePerson('p2')];
const calendar = generateJalaliMonthCalendar(CAL_YEAR, CAL_MONTH, {}, undefined);

function canonical(requests: readonly ShiftRequest[]) {
  return canonicalizeRequestDaysForMonth(requests, {
    year: CAL_YEAR, month: CAL_MONTH, calendarDays: calendar, personnel: people,
  });
}

function shift(id: string, person: string, value: ShiftRequest['preferredShift'], day: number): ShiftRequest {
  return makeRequest(person, {
    id, requestType: 'shift', preferredShift: value, isEssential: false,
    scope: 'custom_days', selectedDays: [day],
  });
}

function partialProof(): RequestResolutionProvenance {
  return {
    version: REQUEST_RESOLUTION_PROVENANCE_VERSION,
    requestId: 'en', personnelId: 'p1', day: 1,
    stage: 'FINAL_VERIFICATION', hardRule: 'NIGHT_REST_CONSECUTIVE_NIGHTS',
    requestedShift: 'EN', retainedShift: 'E',
    requestedComponents: ['E', 'N'], retainedComponents: ['E'], missingComponents: ['N'],
  };
}

test('ledger evaluates every canonical valid request-day exactly once in canonical order', () => {
  const month = canonical([
    shift('z', 'p2', 'E', 2),
    shift('a', 'p1', 'M', 1),
  ]);
  const ledger = buildRequestOutcomeLedger({
    canonicalMonth: month,
    assignments: { p1: { 1: 'M' }, p2: { 2: 'E' } },
    requestSetFingerprint: 'sha256:test',
  });

  assert.deepEqual(ledger.outcomes.map(outcome => [
    outcome.requestDay.personnelId, outcome.requestDay.day, outcome.requestDay.requestId,
  ]), [['p1', 1, 'a'], ['p2', 2, 'z']]);
  assert.equal(new Set(ledger.outcomes.map(outcome =>
    `${outcome.requestDay.requestId}:${outcome.requestDay.personnelId}:${outcome.requestDay.day}`
  )).size, ledger.outcomes.length);
});

test('ledger retains INVALID/CONFLICT issues while excluding them from outcomes', () => {
  const invalid = makeRequest('p1', {
    id: 'invalid', requestType: 'shift', preferredShift: 'OFF', isEssential: false,
    scope: 'custom_days', selectedDays: [1],
  });
  const month = canonical([
    invalid,
    shift('m', 'p2', 'M', 2),
    shift('e', 'p2', 'E', 2),
  ]);
  const ledger = buildRequestOutcomeLedger({
    canonicalMonth: month, assignments: {}, requestSetFingerprint: 'sha256:test',
  });

  assert.deepEqual(ledger.outcomes, []);
  assert.deepEqual(ledger.requestIssues.map(issue => issue.kind), ['INVALID', 'CONFLICT']);
});

test('ledger emits PARTIAL only from matching named provenance', () => {
  const month = canonical([shift('en', 'p1', 'EN', 1)]);
  const withProof = buildRequestOutcomeLedger({
    canonicalMonth: month, assignments: { p1: { 1: 'E' } },
    provenance: [partialProof()], requestSetFingerprint: 'sha256:test',
  });
  const withoutProof = buildRequestOutcomeLedger({
    canonicalMonth: month, assignments: { p1: { 1: 'E' } },
    requestSetFingerprint: 'sha256:test',
  });
  assert.equal(withProof.outcomes[0].kind, 'PARTIAL');
  assert.equal(withoutProof.outcomes[0].kind, 'UNSATISFIED');
});

test('exact final assignment supersedes retained historical degradation proof', () => {
  const month = canonical([shift('en', 'p1', 'EN', 1)]);
  const ledger = buildRequestOutcomeLedger({
    canonicalMonth: month, assignments: { p1: { 1: 'EN' } },
    provenance: [partialProof()], requestSetFingerprint: 'sha256:test',
  });
  assert.equal(ledger.outcomes[0].kind, 'EXACT');
});

test('solver returns canonical named degradation evidence without changing subset legality', () => {
  const person = makePerson('p1');
  const requests = [makeRequest('p1', {
    id: 'men-all', requestType: 'shift', preferredShift: 'MEN', isEssential: true, scope: 'all',
  })];
  const solved = solveNursingSchedule(
    CAL_YEAR, CAL_MONTH, [person], requests,
    makeSettings({ morningNurse: 0, afternoonNurse: 0, nightNurse: 0 }),
    {}, undefined, null
  );

  assert.ok((solved.requestResolutionProvenance?.length ?? 0) > 0);
  for (const item of solved.requestResolutionProvenance ?? []) {
    assert.equal(item.requestId, 'men-all');
    assert.ok(item.hardRule.length > 0);
    assert.deepEqual(
      item.missingComponents,
      item.requestedComponents.filter(component => !item.retainedComponents.includes(component))
    );
  }
});
