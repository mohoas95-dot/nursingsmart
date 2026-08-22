import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeMonthlyRequestArtifacts } from '../domain/requests/request-persistence';
import {
  REQUEST_OUTCOME_LEDGER_VERSION,
  REQUEST_QUALITY_VERSION,
} from '../domain/requests/request-domain';
import { hydrateStoredScheduleRequestArtifacts } from '../lib/schedule-request-hydration';
import type { MonthlySchedule } from '../lib/types';

function runtimeSchedule(): MonthlySchedule {
  const requestSetFingerprint = `sha256:${'a'.repeat(64)}`;
  return {
    year: 1404,
    month: 5,
    assignments: {},
    shiftLeaders: {},
    warnings: [],
    requestSetFingerprint,
    requestQuality: {
      version: REQUEST_QUALITY_VERSION,
      essentialFulfillment: { numerator: BigInt(1), denominator: BigInt(2) },
      normalFulfillment: { numerator: BigInt(2), denominator: BigInt(3) },
      requestSatisfactionPercent: 58.33,
    },
    requestOutcomeLedger: {
      version: REQUEST_OUTCOME_LEDGER_VERSION,
      year: 1404,
      month: 5,
      requestSetFingerprint,
      outcomes: [],
      requestIssues: [],
    },
  };
}

test('login schedule hydration converts persisted decimal strings back to bigint', () => {
  const runtime = runtimeSchedule();
  const persisted = {
    ...runtime,
    ...serializeMonthlyRequestArtifacts(runtime),
  } as any;

  assert.equal(typeof persisted.requestQuality.essentialFulfillment.numerator, 'string');
  const hydrated = hydrateStoredScheduleRequestArtifacts(persisted);
  assert.equal(typeof hydrated.requestQuality?.essentialFulfillment.numerator, 'bigint');
  assert.deepEqual(hydrated.requestQuality, runtime.requestQuality);
  assert.deepEqual(hydrated.requestOutcomeLedger, runtime.requestOutcomeLedger);
});

test('already-hydrated schedules are safe on repeated synchronization paths', () => {
  const runtime = runtimeSchedule();
  assert.equal(hydrateStoredScheduleRequestArtifacts(runtime), runtime);
});

test('malformed stored artifacts are removed rather than crashing authenticated render', () => {
  const malformed = {
    ...runtimeSchedule(),
    requestQuality: {
      version: REQUEST_QUALITY_VERSION,
      essentialFulfillment: { numerator: '01', denominator: '2' },
      normalFulfillment: { numerator: '2', denominator: '3' },
      requestSatisfactionPercent: 58.33,
    },
  } as any;

  const hydrated = hydrateStoredScheduleRequestArtifacts(malformed);
  assert.equal(hydrated.requestQuality, undefined);
  assert.equal(hydrated.requestOutcomeLedger, undefined);
  assert.equal(hydrated.requestSetFingerprint, undefined);
  assert.deepEqual(hydrated.assignments, {});
});
