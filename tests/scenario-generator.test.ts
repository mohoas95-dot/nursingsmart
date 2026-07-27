import assert from 'node:assert/strict';
import test from 'node:test';

import { generateAndScoreScenarios } from '../lib/scenarioGenerator';
import { solveWithPriority } from '../lib/solver';
import type { Personnel, SystemSettings } from '../lib/types';

function person(id: string, jobGroup: 'nurse' | 'assistant'): Personnel {
  return {
    id,
    firstName: id,
    lastName: 'test',
    personalCode: id,
    jobGroup,
    position: jobGroup === 'nurse' ? 'general' : 'none',
    employmentType: 'official',
    experienceYears: 1,
    active: true,
    canBeShiftLeader: jobGroup === 'nurse',
  };
}

const settings: SystemSettings = {
  dutyHours: { official: 160, contract: 174, conscript: 180, overtime: 150 },
  demand: {
    weekday: {
      morningNurse: 1, afternoonNurse: 1, nightNurse: 0,
      morningAssistant: 1, afternoonAssistant: 0, nightAssistant: 0,
      afternoonLeader: 0, nightLeader: 0,
    },
    holiday: {
      morningNurse: 1, afternoonNurse: 1, nightNurse: 0,
      morningAssistant: 1, afternoonAssistant: 0, nightAssistant: 0,
      afternoonLeader: 0, nightLeader: 0,
    },
  },
};

test('scenario generator returns fixed A/B/C order and preserves manual protected edits', () => {
  const personnel = [person('n1', 'nurse'), person('n2', 'nurse'), person('n3', 'nurse'), person('a1', 'assistant')];
  const solved = solveWithPriority(1404, 2, personnel, [], settings, {}, undefined, null);
  const assignments = JSON.parse(JSON.stringify(solved.assignments));
  assignments.n1[1] = 'EN'; // explicit head-nurse change, e.g. EN → N / N → EN
  assignments.a1[1] = 'M';

  const first = generateAndScoreScenarios(
    1404,
    2,
    personnel,
    [],
    settings,
    {},
    undefined,
    null,
    'nurse',
    assignments,
    { protectedCells: new Set(['n1:1']), useCurrentTargetAssignments: true }
  );
  const second = generateAndScoreScenarios(
    1404,
    2,
    personnel,
    [],
    settings,
    {},
    undefined,
    null,
    'nurse',
    assignments,
    { protectedCells: new Set(['n1:1']), useCurrentTargetAssignments: true }
  );

  assert.deepEqual(first.top3.map(item => item.scenarioCode), ['A', 'B', 'C']);
  assert.deepEqual(first.top3.map(item => item.type), ['MIXED', 'REQUESTS', 'FAIRNESS']);
  assert.deepEqual(first.top3.map(item => item.totalScore), second.top3.map(item => item.totalScore), 'scores must not randomly change');
  assert.deepEqual(first.top3.map(item => item.schedule.assignments), second.top3.map(item => item.schedule.assignments), 'programmes must be repeatable for the same inputs');

  for (const scenario of first.top3) {
    assert.equal(scenario.schedule.assignments.n1[1], 'EN', 'a protected manual cell must remain untouched in every programme');
    assert.equal(scenario.schedule.assignments.a1[1], 'M', 'the other job group must be preserved while nurses are regenerated');
  }
});
