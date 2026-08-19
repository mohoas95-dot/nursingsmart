import assert from 'node:assert/strict';
import test from 'node:test';

import { createExactRational } from '../../domain/math/exact-rational';
import {
  REQUEST_OUTCOME_KINDS,
  REQUEST_QUALITY_VERSION,
  REQUEST_RESOLUTION_STAGES,
  deserializeRequestQuality,
  serializeRequestQuality,
  type RequestQuality,
} from '../../domain/requests/request-domain';

const integer = (value: string | number): bigint => BigInt(value);

test('the canonical outcome contract exposes every approved outcome kind', () => {
  assert.deepEqual(REQUEST_OUTCOME_KINDS, [
    'EXACT',
    'COMPATIBLE',
    'PARTIAL',
    'BLOCKED',
    'UNSATISFIED',
    'INVALID',
    'CONFLICT',
  ]);
});

test('resolution provenance stages are stable and machine-readable', () => {
  assert.deepEqual(REQUEST_RESOLUTION_STAGES, [
    'SOLVER_REQUEST_APPLICATION',
    'SOLVER_DEFERRED_RETRY',
    'COVERAGE_RECONCILIATION',
    'REPAIR',
    'FINAL_VERIFICATION',
  ]);
});

test('request quality serialization keeps Essential and Normal rationals separate', () => {
  const quality: RequestQuality = {
    version: REQUEST_QUALITY_VERSION,
    essentialFulfillment: createExactRational(integer(2), integer(3)),
    normalFulfillment: createExactRational(integer(7), integer(11)),
    requestSatisfactionPercent: 65.22,
  };

  const serialized = serializeRequestQuality(quality);
  assert.deepEqual(serialized, {
    version: REQUEST_QUALITY_VERSION,
    essentialFulfillment: { numerator: '2', denominator: '3' },
    normalFulfillment: { numerator: '7', denominator: '11' },
    requestSatisfactionPercent: 65.22,
  });
  assert.deepEqual(deserializeRequestQuality(serialized), quality);
});
