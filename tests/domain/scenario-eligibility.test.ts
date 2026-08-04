import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canScenarioAdvance,
  summarizeScenarioWarnings,
} from '../../domain/scenarios/eligibility';

test('advisory quality notes remain visible but do not block comparison', () => {
  const warnings = [
    'Mismatched Request: درخواست ترجیحی رعایت نشده است',
    'Consecutive OFFs: بیش از سه آف متوالی',
    'Isolated Shift: شیفت تک در روز 4',
  ];

  const summary = summarizeScenarioWarnings(warnings);
  assert.equal(summary.blockingCount, 0);
  assert.equal(summary.advisoryCount, 3);
  assert.equal(summary.eligible, true);
  assert.equal(canScenarioAdvance(warnings), true);
});

test('one hard-constraint violation blocks a read-only scenario', () => {
  const warnings = [
    'Mismatched Request: درخواست ترجیحی رعایت نشده است',
    'Coverage Shortage: کمبود نیرو (پرستار) در روز 2 شیفت M',
  ];

  const summary = summarizeScenarioWarnings(warnings);
  assert.equal(summary.blockingCount, 1);
  assert.equal(summary.advisoryCount, 1);
  assert.equal(summary.eligible, false);
  assert.equal(canScenarioAdvance(warnings), false);
});
