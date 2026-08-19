import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANONICAL_REQUEST_DAY_VERSION,
  REQUEST_OUTCOME_LEDGER_VERSION,
  REQUEST_RESOLUTION_PROVENANCE_VERSION,
  type CanonicalRequestDay,
  type RequestOutcomeLedger,
} from '../../domain/requests/request-domain';
import { evaluateCanonicalRequestDay } from '../../domain/requests/request-outcome-evaluator';
import {
  projectRequestWarningsFromLedger,
  replaceRequestWarningsFromLedger,
} from '../../domain/requests/request-warning-projection';
import { createScheduleWarning } from '../../domain/warnings/schedule-warning';

const requestDay: CanonicalRequestDay = {
  version: CANONICAL_REQUEST_DAY_VERSION,
  requestId: 'request-1', personnelId: 'person-1', year: 1404, month: 2, day: 3,
  requestType: 'shift', expectedValue: 'EN', isEssential: true, polarity: 'POSITIVE',
  requestedComponents: ['E', 'N'],
};

function ledger(outcomes: RequestOutcomeLedger['outcomes']): RequestOutcomeLedger {
  return {
    version: REQUEST_OUTCOME_LEDGER_VERSION,
    year: 1404, month: 2, requestSetFingerprint: 'sha256:test', outcomes, requestIssues: [],
  };
}

test('EXACT and COMPATIBLE outcomes project no warning', () => {
  assert.deepEqual(projectRequestWarningsFromLedger(ledger([
    evaluateCanonicalRequestDay(requestDay, 'EN'),
    evaluateCanonicalRequestDay({ ...requestDay, requestId: 'request-2', expectedValue: 'E', requestedComponents: ['E'] }, 'EN'),
  ])), []);
});

test('PARTIAL projects exactly one explanatory warning with unchanged warning severity', () => {
  const partial = evaluateCanonicalRequestDay(requestDay, 'E', [{
    version: REQUEST_RESOLUTION_PROVENANCE_VERSION,
    requestId: 'request-1', personnelId: 'person-1', day: 3,
    stage: 'FINAL_VERIFICATION', hardRule: 'NIGHT_REST_CONSECUTIVE_NIGHTS',
    requestedShift: 'EN', retainedShift: 'E', requestedComponents: ['E', 'N'],
    retainedComponents: ['E'], missingComponents: ['N'],
  }]);
  const warnings = projectRequestWarningsFromLedger(ledger([partial]));
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'MISMATCHED_REQUEST');
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].metadata?.requestOutcomeKind, 'PARTIAL');
  assert.equal(warnings[0].metadata?.hardRule, 'NIGHT_REST_CONSECUTIVE_NIGHTS');
});

test('ledger projection replaces a generic mismatch instead of duplicating PARTIAL', () => {
  const partial = evaluateCanonicalRequestDay(requestDay, 'E', [{
    version: REQUEST_RESOLUTION_PROVENANCE_VERSION,
    requestId: 'request-1', personnelId: 'person-1', day: 3,
    stage: 'FINAL_VERIFICATION', hardRule: 'MAX_CONSECUTIVE',
    requestedShift: 'EN', retainedShift: 'E', requestedComponents: ['E', 'N'],
    retainedComponents: ['E'], missingComponents: ['N'],
  }]);
  const result = replaceRequestWarningsFromLedger([
    createScheduleWarning({ code: 'MISMATCHED_REQUEST', message: 'legacy generic mismatch' }),
    createScheduleWarning({ code: 'MANDATORY_REST', message: 'unchanged non-request warning' }),
  ], ledger([partial]));
  assert.equal(result.filter(warning => warning.code === 'MISMATCHED_REQUEST').length, 1);
  assert.equal(result.find(warning => warning.code === 'MANDATORY_REST')?.severity, 'warning');
});

test('INVALID and CONFLICT issues remain visible without entering outcomes', () => {
  const value: RequestOutcomeLedger = {
    ...ledger([]),
    requestIssues: [
      { version: 'request-validation-issue/1', kind: 'INVALID', reason: 'EMPTY_PATTERN', year: 1404, month: 2, requestIds: ['bad'] },
      {
        version: 'request-validation-issue/1', kind: 'CONFLICT', reason: 'OVERLAPPING_POSITIVE_INTENT',
        year: 1404, month: 2, personnelId: 'person-1', days: [3], requestIds: ['a', 'b'],
        conflictId: 'conflict:test', essentialFlags: [
          { requestId: 'a', isEssential: false }, { requestId: 'b', isEssential: true },
        ],
      },
    ],
  };
  const warnings = projectRequestWarningsFromLedger(value);
  assert.equal(warnings.length, 2);
  assert.deepEqual(warnings.map(warning => warning.metadata?.requestIssueKind), ['INVALID', 'CONFLICT']);
  assert.ok(warnings.every(warning => warning.severity === 'warning'));
});
