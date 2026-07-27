import assert from 'node:assert/strict';
import test from 'node:test';
import { formatShiftForPrint } from '../features/scheduling/components/PrintScheduleSheet';

test('printed full-day MEN shifts use the readable English number 24', () => {
  assert.equal(formatShiftForPrint('MEN'), '24');
});

test('printed shift formatter preserves other codes and leave markers', () => {
  assert.equal(formatShiftForPrint('EN'), 'EN');
  assert.equal(formatShiftForPrint('LMEN'), 'م24');
  assert.equal(formatShiftForPrint('OFF'), '');
});
