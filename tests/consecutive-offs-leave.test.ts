import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyCoverageAndLeaders } from '../lib/solver';
import type { ShiftType, SystemSettings } from '../lib/types';
import { CAL_MONTH, CAL_YEAR, makePerson } from './fixtures/realistic';

const ZERO_DEMAND = {
  morningNurse: 0,
  morningAssistant: 0,
  afternoonNurse: 0,
  afternoonAssistant: 0,
  afternoonLeader: 0,
  nightNurse: 0,
  nightAssistant: 0,
  nightLeader: 0,
};

const SETTINGS: SystemSettings = {
  dutyHours: { official: 176, contract: 190, conscript: 200, overtime: 0 },
  demand: {
    weekday: { ...ZERO_DEMAND },
    holiday: { ...ZERO_DEMAND },
  },
};

function rowWith(overrides: Readonly<Record<number, ShiftType>>): Record<number, ShiftType> {
  const row: Record<number, ShiftType> = {};
  for (let day = 1; day <= 31; day += 1) row[day] = 'M';
  return { ...row, ...overrides };
}

function consecutiveOffWarnings(row: Readonly<Record<number, ShiftType>>) {
  const person = makePerson('leave-off-regression');
  const assignments = { [person.id]: { ...row } };
  const before = structuredClone(assignments);
  const result = verifyCoverageAndLeaders(
    CAL_YEAR,
    CAL_MONTH,
    [person],
    assignments,
    SETTINGS,
    {},
    undefined,
    []
  );

  return {
    assignments,
    before,
    warnings: result.structuredWarnings.filter(warning => warning.code === 'CONSECUTIVE_OFFS'),
  };
}

test('four consecutive approved leave days do not produce CONSECUTIVE_OFFS', () => {
  const result = consecutiveOffWarnings(rowWith({ 1: 'L1', 2: 'L2', 3: 'L3', 4: 'L4' }));

  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.assignments, result.before, 'verification must leave approved leave untouched');
});

test('approved leave breaks an actual OFF run', () => {
  const result = consecutiveOffWarnings(rowWith({ 1: 'OFF', 2: 'OFF', 3: 'L1', 4: 'OFF', 5: 'OFF' }));

  assert.equal(result.warnings.length, 0);
});

test('four consecutive actual OFF days still produce the expected CONSECUTIVE_OFFS range', () => {
  const result = consecutiveOffWarnings(rowWith({ 1: 'OFF', 2: 'OFF', 3: 'OFF', 4: 'OFF' }));

  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].day, 1);
  assert.equal(result.warnings[0].endDay, 4);
  assert.equal(result.warnings[0].metadata?.length, 4);
  assert.ok(result.warnings[0].message.startsWith('Consecutive OFFs:'));
});

test('holiday leave breaks an actual OFF run', () => {
  const result = consecutiveOffWarnings(rowWith({ 1: 'OFF', 2: 'OFF', 3: 'LH', 4: 'OFF', 5: 'OFF' }));

  assert.equal(result.warnings.length, 0);
});
