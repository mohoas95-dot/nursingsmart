import assert from 'node:assert/strict';
import test from 'node:test';

import { INITIAL_SETTINGS } from '../lib/mockData';
import { normalizeSystemSettings } from '../lib/settings-normalizer';

test('settings normalization is available independently of Home render initialization', () => {
  assert.deepEqual(normalizeSystemSettings(undefined), INITIAL_SETTINGS);
});

test('settings normalization converts persisted numeric strings and fills missing demand values', () => {
  const normalized = normalizeSystemSettings({
    autoCalculateDutyHours: false,
    dutyHours: { official: '160', contract: '174', conscript: '', overtime: '12' },
    demand: {
      weekday: { morningNurse: '2', nightNurse: '1' },
      holiday: { afternoonAssistant: '3' },
    },
  } as any);

  assert.deepEqual(normalized.dutyHours, {
    official: 160,
    contract: 174,
    conscript: 0,
    overtime: 12,
  });
  assert.equal(normalized.demand.weekday.morningNurse, 2);
  assert.equal(normalized.demand.weekday.nightNurse, 1);
  assert.equal(normalized.demand.weekday.afternoonLeader, 0);
  assert.equal(normalized.demand.holiday.afternoonAssistant, 3);
  assert.equal(normalized.demand.holiday.nightLeader, 0);
});
