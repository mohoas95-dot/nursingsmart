import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCurrentScenarioForPersistence } from '../domain/scenarios/objective-persistence';
import { generateAndScoreScenarios } from '../lib/scenarioGenerator';
import { solveNursingSchedule } from '../lib/solver';
import { CAL_MONTH, CAL_YEAR, makePerson, makeRequest, makeSettings } from './fixtures/realistic';

test('generated request-quality scenarios cross the JSON persistence boundary without bigint errors', () => {
  const personnel = [
    makePerson('persist-1', { orderIndex: 0 }),
    makePerson('persist-2', { orderIndex: 1 }),
    makePerson('persist-3', { orderIndex: 2 }),
    makePerson('persist-4', { orderIndex: 3 }),
  ];
  const requests = [
    makeRequest('persist-1', {
      id: 'request-1', requestType: 'shift', preferredShift: 'M',
      scope: 'custom_days', selectedDays: [3], isEssential: true,
    }),
    makeRequest('persist-2', {
      id: 'request-2', requestType: 'OFF',
      scope: 'custom_days', selectedDays: [5], isEssential: false,
    }),
  ];
  const settings = makeSettings({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 });
  const baseline = solveNursingSchedule(
    CAL_YEAR, CAL_MONTH, personnel, requests, settings, {}, undefined, null
  );
  const result = generateAndScoreScenarios(
    CAL_YEAR, CAL_MONTH, personnel, requests, settings, {}, undefined, null,
    'nurse', baseline.assignments as any, []
  );

  assert.ok(result.top3.length > 0, 'fixture must generate at least one scenario');
  for (const scenario of result.top3) {
    const persisted = serializeCurrentScenarioForPersistence(scenario as any);
    assert.doesNotThrow(() => JSON.stringify(persisted));
    const numerator = (persisted.objective as any).quality.requestQuality.essentialFulfillment.numerator;
    assert.equal(typeof numerator, 'string');
  }
});
