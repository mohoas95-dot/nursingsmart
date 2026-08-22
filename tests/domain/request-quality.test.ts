import assert from 'node:assert/strict';
import test from 'node:test';

import { createExactRational, exactRationalEquals } from '../../domain/math/exact-rational';
import {
  CANONICAL_REQUEST_DAY_VERSION,
  REQUEST_OUTCOME_LEDGER_VERSION,
  REQUEST_RESOLUTION_PROVENANCE_VERSION,
  type CanonicalRequestDay,
  type RequestOutcomeLedger,
} from '../../domain/requests/request-domain';
import { evaluateCanonicalRequestDay } from '../../domain/requests/request-outcome-evaluator';
import { buildRequestQualityFromLedger } from '../../domain/requests/request-quality';

function day(id: string, isEssential: boolean, expectedValue: 'M' | 'EN'): CanonicalRequestDay {
  return {
    version: CANONICAL_REQUEST_DAY_VERSION,
    requestId: id, personnelId: 'p', year: 1404, month: 2, day: Number(id.replace(/\D/g, '')) || 1,
    requestType: 'shift', expectedValue, isEssential, polarity: 'POSITIVE',
    requestedComponents: expectedValue === 'EN' ? ['E', 'N'] : ['M'],
  };
}

function ledger(outcomes: RequestOutcomeLedger['outcomes']): RequestOutcomeLedger {
  return {
    version: REQUEST_OUTCOME_LEDGER_VERSION,
    year: 1404, month: 2, requestSetFingerprint: 'sha256:test', outcomes, requestIssues: [],
  };
}

test('RequestQuality aggregates Essential and Normal credits separately and exactly', () => {
  const essentialPartial = evaluateCanonicalRequestDay(day('1', true, 'EN'), 'E', [{
    version: REQUEST_RESOLUTION_PROVENANCE_VERSION,
    requestId: '1', personnelId: 'p', day: 1,
    stage: 'FINAL_VERIFICATION', hardRule: 'NIGHT_REST_CONSECUTIVE_NIGHTS',
    requestedShift: 'EN', retainedShift: 'E', requestedComponents: ['E', 'N'],
    retainedComponents: ['E'], missingComponents: ['N'],
  }]);
  const normalExact = evaluateCanonicalRequestDay(day('2', false, 'M'), 'M');
  const quality = buildRequestQualityFromLedger(ledger([essentialPartial, normalExact]));

  assert.ok(exactRationalEquals(quality.essentialFulfillment, createExactRational(BigInt(1), BigInt(2))));
  assert.ok(exactRationalEquals(quality.normalFulfillment, createExactRational(BigInt(1), BigInt(1))));
  assert.equal(quality.requestSatisfactionPercent, 75);
});

test('zero-day Essential or Normal groups are exactly 0/1', () => {
  const empty = buildRequestQualityFromLedger(ledger([]));
  assert.deepEqual(empty.essentialFulfillment, { numerator: BigInt(0), denominator: BigInt(1) });
  assert.deepEqual(empty.normalFulfillment, { numerator: BigInt(0), denominator: BigInt(1) });
  assert.equal(empty.requestSatisfactionPercent, 0);

  const normalOnly = buildRequestQualityFromLedger(ledger([
    evaluateCanonicalRequestDay(day('3', false, 'M'), 'M'),
  ]));
  assert.deepEqual(normalOnly.essentialFulfillment, { numerator: BigInt(0), denominator: BigInt(1) });
  assert.deepEqual(normalOnly.normalFulfillment, { numerator: BigInt(1), denominator: BigInt(1) });
});

test('display scalar is unweighted across all valid request-days', () => {
  const outcomes = [
    evaluateCanonicalRequestDay(day('4', true, 'M'), 'OFF'),
    evaluateCanonicalRequestDay(day('5', false, 'M'), 'M'),
    evaluateCanonicalRequestDay(day('6', false, 'M'), 'M'),
  ];
  const quality = buildRequestQualityFromLedger(ledger(outcomes));
  assert.equal(quality.requestSatisfactionPercent, 66.67);
  assert.deepEqual(quality.essentialFulfillment, { numerator: BigInt(0), denominator: BigInt(1) });
  assert.deepEqual(quality.normalFulfillment, { numerator: BigInt(1), denominator: BigInt(1) });
});

test('request issues never enter quality numerator or denominator', () => {
  const value: RequestOutcomeLedger = {
    ...ledger([]),
    requestIssues: [{
      version: 'request-validation-issue/1', kind: 'INVALID', reason: 'EMPTY_PATTERN',
      year: 1404, month: 2, requestIds: ['bad'],
    }],
  };
  const quality = buildRequestQualityFromLedger(value);
  assert.deepEqual(quality.essentialFulfillment, { numerator: BigInt(0), denominator: BigInt(1) });
  assert.deepEqual(quality.normalFulfillment, { numerator: BigInt(0), denominator: BigInt(1) });
});
