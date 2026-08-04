import assert from 'node:assert/strict';
import test from 'node:test';

import { generateAndScoreScenarios, MAX_SCENARIO_CANDIDATES } from '../lib/scenarioGenerator';
import { solveNursingSchedule } from '../lib/solver';
import type { Personnel, ShiftRequest, SystemSettings } from '../lib/types';

function person(id: string, group: 'nurse' | 'assistant' = 'nurse', opts: Partial<Personnel> = {}): Personnel {
  return {
    id,
    firstName: id,
    lastName: 'test',
    personalCode: id,
    jobGroup: group,
    position: group === 'nurse' ? 'general' : 'none',
    employmentType: 'official',
    experienceYears: 3,
    active: true,
    canBeShiftLeader: group === 'nurse',
    orderIndex: Number(id.replace(/\D/g, '')) || 0,
    ...opts,
  };
}

const settings: SystemSettings = {
  dutyHours: { official: 176, contract: 190, conscript: 200, overtime: 0 },
  demand: {
    weekday: {
      morningNurse: 1, morningAssistant: 0,
      afternoonNurse: 1, afternoonAssistant: 0, afternoonLeader: 0,
      nightNurse: 1, nightAssistant: 0, nightLeader: 0,
    },
    holiday: {
      morningNurse: 1, morningAssistant: 0,
      afternoonNurse: 1, afternoonAssistant: 0, afternoonLeader: 0,
      nightNurse: 1, nightAssistant: 0, nightLeader: 0,
    },
  },
};

function buildBaseline(): { baseline: Record<string, Record<number, string>>; personnel: Personnel[] } {
  // ۴ پرستار برای پوشش صبح/عصر/شب سراسر ماه
  const personnel = [person('n1'), person('n2'), person('n3'), person('n4')];
  const solved = solveNursingSchedule(1404, 2, personnel, [], settings, {}, undefined, null);
  return { baseline: solved.assignments as any, personnel };
}

test('the generator ceiling is 500 candidates', () => {
  assert.equal(MAX_SCENARIO_CANDIDATES, 500);
});

test('without a working-roster baseline the engine returns no scenarios and a reason', () => {
  const personnel = [person('n1'), person('n2')];
  const result = generateAndScoreScenarios(
    1404, 2, personnel, [], settings, {}, undefined, null, 'nurse', null, []
  );
  assert.equal(result.top3.length, 0);
  assert.ok(result.generationLog.some(line => line.includes('برنامهٔ مبنا')));
});

test('objective scenarios stay close enough to baseline, have zero blocking violations, and remain DISTINCT', () => {
  const { baseline, personnel } = buildBaseline();

  const result = generateAndScoreScenarios(
    1404, 2, personnel, [], settings, {}, undefined, null, 'nurse', baseline, []
  );

  assert.ok(result.top3.length >= 1, 'expected at least one valid objective scenario');
  assert.equal(result.top3[0].scenarioKey, 'A');
  assert.equal(result.top3[0].type, 'REQUESTS');
  assert.match(result.top3[0].title, /درخواست‌محور/);
  assert.equal(new Set(result.top3.map(scenario => scenario.scenarioKey)).size, result.top3.length);

  for (const scenario of result.top3) {
    assert.equal(scenario.criticalWarningCount, 0, `scenario ${scenario.scenarioKey} still has level-A alerts`);
    assert.equal(scenario.relevantHardWarningCount, 0);
    assert.ok(
      (scenario.baselineDifferencePercent ?? 0) > 0,
      `scenario ${scenario.scenarioKey} is identical to the baseline (not a real alternative)`
    );
    assert.ok(
      (scenario.baselineSimilarityPercent ?? 0) >= 60,
      `scenario ${scenario.scenarioKey} drifted too far from baseline`
    );
  }
});

test('A, B, and C optimize genuinely different objectives instead of receiving cosmetic labels', () => {
  const { baseline, personnel } = buildBaseline();
  const requestedOffDays = Object.entries(baseline.n1 || {})
    .filter(([, shift]) => shift !== 'OFF')
    .slice(0, 8)
    .map(([day]) => Number(day));
  const requests: ShiftRequest[] = [{
    id: 'request-n1-off',
    personnelId: 'n1',
    requestType: 'OFF',
    isEssential: true,
    offHardness: 'soft',
    scope: 'custom_days',
    selectedDays: requestedOffDays,
  }];

  const result = generateAndScoreScenarios(
    1404, 2, personnel, requests, settings, {}, undefined, null, 'nurse', baseline as any, []
  );

  assert.deepEqual(result.top3.map(scenario => scenario.scenarioKey), ['A', 'B', 'C']);
  const [requestScenario, fairnessScenario, mixedScenario] = result.top3;
  assert.ok(requestScenario.metrics.requestScore >= fairnessScenario.metrics.requestScore);
  assert.ok(requestScenario.metrics.requestScore >= mixedScenario.metrics.requestScore);
  assert.ok(fairnessScenario.metrics.fairnessScore >= requestScenario.metrics.fairnessScore);
  assert.ok(fairnessScenario.metrics.fairnessScore >= mixedScenario.metrics.fairnessScore);
  assert.ok(result.top3.every(scenario => scenario.relevantHardWarningCount === 0));
});

test('locked personnel are inherited from the baseline untouched', () => {
  const { baseline, personnel } = buildBaseline();
  // n1 را قفل می‌کنیم؛ شیفت او باید در هر سناریو دقیقاً مثل مبنا بماند.
  const lockedRows = ['n1'];

  const result = generateAndScoreScenarios(
    1404, 2, personnel, [], settings, {}, undefined, null, 'nurse', baseline, lockedRows
  );

  assert.ok(result.top3.length >= 1);
  for (const scenario of result.top3) {
    const scenarioRow = scenario.schedule.assignments['n1'] || {};
    const baselineRow = baseline['n1'] || {};
    for (const day of Object.keys(baselineRow)) {
      assert.equal(scenarioRow[Number(day)], baselineRow[Number(day)],
        `locked personnel n1 must be inherited unchanged on day ${day}`);
    }
  }
});

test('the legacy Personnel.locked flag is preserved just like a lockedRows entry', () => {
  const { baseline, personnel } = buildBaseline();
  personnel[0] = { ...personnel[0], locked: true };

  const result = generateAndScoreScenarios(
    1404, 2, personnel, [], settings, {}, undefined, null, 'nurse', baseline as any, []
  );

  assert.ok(result.top3.length >= 1);
  for (const scenario of result.top3) {
    assert.deepEqual(scenario.schedule.assignments.n1, baseline.n1);
  }
});

test('at most 3 scenarios are ever returned', () => {
  const { baseline, personnel } = buildBaseline();
  const result = generateAndScoreScenarios(
    1404, 2, personnel, [], settings, {}, undefined, null, 'nurse', baseline, []
  );
  assert.ok(result.top3.length <= 3);
});
