import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CANONICAL_REQUEST_DAY_VERSION,
  REQUEST_OUTCOME_LEDGER_VERSION,
  type CanonicalRequestDay,
  type RequestOutcomeLedger,
} from '../../domain/requests/request-domain';
import { evaluateCanonicalRequestDay } from '../../domain/requests/request-outcome-evaluator';
import { prioritizeRequestDeficienciesForCandidate } from '../../domain/requests/request-outcome-ledger';
import { compareByObjective, type ScenarioObjectiveQuality } from '../../domain/scenarios/objective';

function requestDay(id: string, person: string, essential: boolean): CanonicalRequestDay {
  return {
    version: CANONICAL_REQUEST_DAY_VERSION,
    requestId: id, personnelId: person, year: 1404, month: 2, day: Number(id.replace(/\D/g, '')) || 1,
    requestType: 'shift', expectedValue: 'M', isEssential: essential, polarity: 'POSITIVE',
    requestedComponents: ['M'],
  };
}

function ledger(outcomes: RequestOutcomeLedger['outcomes']): RequestOutcomeLedger {
  return {
    version: REQUEST_OUTCOME_LEDGER_VERSION,
    year: 1404, month: 2, requestSetFingerprint: 'sha256:audit', outcomes, requestIssues: [],
  };
}

function quality(display: number, productivity = 50): ScenarioObjectiveQuality {
  return {
    requestQuality: {
      version: 'request-quality/1',
      essentialFulfillment: { numerator: BigInt(1), denominator: BigInt(2) },
      normalFulfillment: { numerator: BigInt(1), denominator: BigInt(3) },
      requestSatisfactionPercent: display,
    },
    operationalEfficiencyScore: productivity,
    fairnessScore: 50,
    warningDefectCount: 0,
    routineMismatchCount: 0,
    baselineSimilarityPercent: 50,
  };
}

test('request-biased construction exclusively prioritizes deficient Essential outcomes', () => {
  const normal = evaluateCanonicalRequestDay(requestDay('n1', 'p1', false), 'OFF');
  const essential = evaluateCanonicalRequestDay(requestDay('e2', 'p2', true), 'OFF');
  const exactEssential = evaluateCanonicalRequestDay(requestDay('e3', 'p3', true), 'M');
  const priority = prioritizeRequestDeficienciesForCandidate(
    ledger([normal, essential, exactEssential]),
    new Set(['p1', 'p2', 'p3'])
  );
  assert.deepEqual(priority.map(outcome => outcome.requestDay.requestId), ['e2']);
});

test('Normal deficiencies become eligible only when no eligible Essential deficiency exists', () => {
  const priority = prioritizeRequestDeficienciesForCandidate(
    ledger([
      evaluateCanonicalRequestDay(requestDay('e1', 'p1', true), 'M'),
      evaluateCanonicalRequestDay(requestDay('n2', 'p2', false), 'OFF'),
    ]),
    new Set(['p1', 'p2'])
  );
  assert.deepEqual(priority.map(outcome => outcome.requestDay.requestId), ['n2']);
});

test('display scalar is ignored by authoritative comparison', () => {
  assert.equal(compareByObjective(quality(0), quality(100)), 0);
  assert.ok(compareByObjective(quality(0, 90), quality(100, 80)) < 0);
});

test('global authority audit finds no raw-request scoring or scalar request comparator', () => {
  const scoring = readFileSync('lib/scoring.ts', 'utf8');
  const objective = readFileSync('domain/scenarios/objective.ts', 'utf8');
  const generator = readFileSync('lib/scenarioGenerator.ts', 'utf8');
  const scenarioQuality = readFileSync('domain/scenarios/scenario-quality.ts', 'utf8');

  for (const forbidden of [
    'requestDayWeight', 'requestSatisfiedForDay', '1.25', 'weight += 0.15', 'weight += 0.1',
  ]) {
    assert.equal(scoring.includes(forbidden), false, `legacy request authority remains: ${forbidden}`);
  }
  assert.equal(objective.includes('materialBucket(right.requestSatisfactionPercent)'), false);
  assert.match(objective, /compareExactRationalDescending\([\s\S]*essentialFulfillment/);
  assert.match(objective, /compareExactRationalDescending\([\s\S]*normalFulfillment/);
  assert.equal(generator.includes('isRequestSatisfiedForDay'), false);
  assert.equal(scenarioQuality.includes('calculateRequestSatisfactionPercent('), false);
});
