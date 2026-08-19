import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canonicalizeRequestDaysForMonth } from '../../domain/requests/request-canonicalizer';
import {
  deserializeRequestOutcomeLedger,
  serializeRequestOutcomeLedger,
} from '../../domain/requests/request-persistence';
import { buildRequestOutcomeLedger } from '../../domain/requests/request-outcome-ledger';
import { REQUEST_RESOLUTION_PROVENANCE_VERSION } from '../../domain/requests/request-domain';
import {
  buildRequestSetFingerprint,
  serializeCanonicalRequestSet,
} from '../../domain/requests/request-set-fingerprint';
import {
  hydrateScenarioObjective,
  serializeScenarioObjective,
} from '../../domain/scenarios/objective-persistence';
import {
  LEGACY_SCENARIO_OBJECTIVE_VERSION,
  PHASE_5_SCENARIO_OBJECTIVE_VERSION,
  SCENARIO_OBJECTIVE_VERSION,
  type ScenarioObjective,
} from '../../domain/scenarios/objective';
import { orderScenariosByObjective } from '../../domain/scenarios/scenario-quality';
import { generateJalaliMonthCalendar } from '../../lib/jalali';
import { SerializedRequestQualitySchema } from '../../lib/storageSchemas';
import type { Personnel, ShiftRequest } from '../../lib/types';
import { makePerson, makeRequest } from '../fixtures/realistic';

const year = 1404;
const month = 2;
const personnel: Personnel[] = [makePerson('p1'), makePerson('p2')];

function canonical(requests: ShiftRequest[], targetMonth = month) {
  return canonicalizeRequestDaysForMonth(requests, {
    year,
    month: targetMonth,
    calendarDays: generateJalaliMonthCalendar(year, targetMonth, {}, undefined),
    personnel,
  });
}

function request(id: string, person: string, essential: boolean, preferredShift: 'M' | 'E' = 'M'): ShiftRequest {
  return makeRequest(person, {
    id, requestType: 'shift', preferredShift, scope: 'custom_days', selectedDays: [3],
    isEssential: essential,
  });
}

function objective(fingerprint: string): ScenarioObjective {
  return {
    version: SCENARIO_OBJECTIVE_VERSION,
    requestSetFingerprint: fingerprint,
    gates: {
      criticalResolved: true, criticalWarningCount: 0, locksPreserved: true,
      withinMaxBaselineDifference: true, meetsMinBaselineDifference: true,
    },
    quality: {
      requestQuality: {
        version: 'request-quality/1',
        essentialFulfillment: {
          numerator: BigInt(Number.MAX_SAFE_INTEGER) * BigInt(1000) + BigInt(1),
          denominator: BigInt(Number.MAX_SAFE_INTEGER) * BigInt(1000) + BigInt(2),
        },
        normalFulfillment: { numerator: BigInt(1), denominator: BigInt(3) },
        requestSatisfactionPercent: 66.67,
      },
      operationalEfficiencyScore: 90,
      fairnessScore: 80,
      warningDefectCount: 0,
      routineMismatchCount: 1,
      baselineSimilarityPercent: 95,
    },
  };
}

test('request fingerprint is canonical across request input permutations and is real SHA-256', () => {
  const requests = [request('b', 'p2', false, 'E'), request('a', 'p1', true, 'M')];
  const left = canonical(requests);
  const right = canonical([...requests].reverse());
  assert.equal(buildRequestSetFingerprint(left), buildRequestSetFingerprint(right));

  const serialized = serializeCanonicalRequestSet(left);
  const expected = `sha256:${createHash('sha256').update(serialized, 'utf8').digest('hex')}`;
  assert.equal(buildRequestSetFingerprint(left), expected);
  assert.match(expected, /^sha256:[0-9a-f]{64}$/);
});

test('fingerprint changes with month, identity, value, and Essential flag', () => {
  const base = buildRequestSetFingerprint(canonical([request('a', 'p1', false, 'M')]));
  const variants = [
    buildRequestSetFingerprint(canonical([request('a', 'p1', true, 'M')])),
    buildRequestSetFingerprint(canonical([request('a', 'p2', false, 'M')])),
    buildRequestSetFingerprint(canonical([request('a', 'p1', false, 'E')])),
    buildRequestSetFingerprint(canonical([request('a', 'p1', false, 'M')], 3)),
  ];
  for (const variant of variants) assert.notEqual(variant, base);
});

test('ledger persistence preserves request identity, issues, and named provenance exactly', () => {
  const requests: ShiftRequest[] = [
    makeRequest('p1', {
      id: 'partial', requestType: 'shift', preferredShift: 'EN', scope: 'custom_days',
      selectedDays: [3], isEssential: true,
    }),
    makeRequest('p2', {
      id: 'invalid', requestType: 'pattern', patternSteps: [], scope: 'all', isEssential: false,
    }),
  ];
  const canonicalMonth = canonical(requests);
  const fingerprint = buildRequestSetFingerprint(canonicalMonth);
  const value = buildRequestOutcomeLedger({
    canonicalMonth,
    assignments: { p1: { 3: 'E' } },
    requestSetFingerprint: fingerprint,
    provenance: [{
      version: REQUEST_RESOLUTION_PROVENANCE_VERSION,
      requestId: 'partial', personnelId: 'p1', day: 3,
      stage: 'FINAL_VERIFICATION', hardRule: 'NIGHT_REST_CONSECUTIVE_NIGHTS',
      requestedShift: 'EN', retainedShift: 'E', requestedComponents: ['E', 'N'],
      retainedComponents: ['E'], missingComponents: ['N'],
    }],
  });
  const serialized = serializeRequestOutcomeLedger(value);
  assert.doesNotThrow(() => JSON.stringify(serialized));
  assert.equal(serialized.outcomes[0].requestDay.requestId, 'partial');
  assert.equal(serialized.requestIssues[0].requestIds[0], 'invalid');
  assert.deepEqual(deserializeRequestOutcomeLedger(serialized), value);
});

test('current objective serializes bigint rationals as canonical decimal strings and hydrates exactly', () => {
  const fingerprint = buildRequestSetFingerprint(canonical([request('a', 'p1', true)]));
  const current = objective(fingerprint);
  const serialized = serializeScenarioObjective(current);
  assert.doesNotThrow(() => JSON.stringify(serialized));
  assert.equal(typeof serialized.quality.requestQuality.essentialFulfillment.numerator, 'string');

  const hydrated = hydrateScenarioObjective(serialized, SCENARIO_OBJECTIVE_VERSION, fingerprint);
  assert.equal(hydrated.status, 'CURRENT');
  assert.deepEqual(hydrated.objective, current);
});

test('storage schema accepts only JSON-safe decimal-string rationals', () => {
  const serialized = serializeScenarioObjective(objective('sha256:' + 'a'.repeat(64)));
  assert.equal(SerializedRequestQualitySchema.safeParse(serialized.quality.requestQuality).success, true);
  assert.equal(SerializedRequestQualitySchema.safeParse({
    ...serialized.quality.requestQuality,
    normalFulfillment: { numerator: '01', denominator: '3' },
  }).success, false);
  assert.equal(SerializedRequestQualitySchema.safeParse({
    ...serialized.quality.requestQuality,
    normalFulfillment: { numerator: '1', denominator: '0' },
  }).success, false);
});

test('fingerprint mismatch is STALE and never silently recomputed', () => {
  const oldFingerprint = buildRequestSetFingerprint(canonical([request('a', 'p1', false)]));
  const newFingerprint = buildRequestSetFingerprint(canonical([request('a', 'p1', true)]));
  const serialized = serializeScenarioObjective(objective(oldFingerprint));
  const hydrated = hydrateScenarioObjective(serialized, SCENARIO_OBJECTIVE_VERSION, newFingerprint);
  assert.equal(hydrated.status, 'STALE');
  assert.equal(hydrated.objective?.requestSetFingerprint, oldFingerprint);
});

test('malformed current rationals are INVALID instead of repaired', () => {
  const fingerprint = 'sha256:' + 'a'.repeat(64);
  const serialized: any = serializeScenarioObjective(objective(fingerprint));
  serialized.quality.requestQuality.normalFulfillment.numerator = '01';
  assert.equal(
    hydrateScenarioObjective(serialized, SCENARIO_OBJECTIVE_VERSION, fingerprint).status,
    'INVALID'
  );
});

test('objective versions 1 and 2 remain LEGACY and are not upgraded', () => {
  for (const version of [LEGACY_SCENARIO_OBJECTIVE_VERSION, PHASE_5_SCENARIO_OBJECTIVE_VERSION]) {
    const historical = hydrateScenarioObjective({ version, quality: { requestSatisfactionPercent: 88 } }, version, 'sha256:new');
    assert.equal(historical.status, 'LEGACY');
    assert.equal(historical.objective, undefined);
    assert.equal(historical.historicalVersion, version);
  }
});

test('mixed objective versions and stale current objectives retain persisted order', () => {
  const fingerprint = 'sha256:' + 'a'.repeat(64);
  const current = { id: 1, objective: objective(fingerprint), objectiveVersion: SCENARIO_OBJECTIVE_VERSION, requestQualityStatus: 'CURRENT' as const };
  const stale = { id: 2, objective: objective(fingerprint), objectiveVersion: SCENARIO_OBJECTIVE_VERSION, requestQualityStatus: 'STALE' as const };
  assert.deepEqual(orderScenariosByObjective([stale, current]).map(item => item.id), [2, 1]);

  const historical = {
    id: 3,
    objective: { version: PHASE_5_SCENARIO_OBJECTIVE_VERSION } as any,
    objectiveVersion: PHASE_5_SCENARIO_OBJECTIVE_VERSION,
    requestQualityStatus: 'LEGACY' as const,
  };
  assert.deepEqual(orderScenariosByObjective([historical, current]).map(item => item.id), [3, 1]);
});
