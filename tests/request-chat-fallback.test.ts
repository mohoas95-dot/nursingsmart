import assert from 'node:assert/strict';
import test from 'node:test';
import { parseShiftRequestsFallback } from '../lib/requestChatFallback';

const calendarDays = Array.from({ length: 31 }, (_, index) => ({
  day: index + 1,
  dayOfWeek: index % 7,
  isHoliday: index % 7 === 6,
}));

test('fallback parser extracts multiple Persian text requests when Gemini is unavailable', () => {
  const requests = parseShiftRequestsFallback(
    'روزهای ۱۲ و ۱۵ آف قطعی می‌خواهم و روز ۲۰ام شیفت شب باشم',
    { totalDays: 31, calendarDays },
  );

  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], {
    requestType: 'OFF',
    preferredShift: 'OFF',
    isEssential: true,
    offHardness: 'hard',
    scope: 'custom_days',
    selectedDays: [12, 15],
    description: 'آف روزهای 12، 15',
  });
  assert.equal(requests[1].requestType, 'shift');
  assert.equal(requests[1].preferredShift, 'N');
  assert.deepEqual(requests[1].selectedDays, [20]);
});

test('fallback parser handles leave ranges and avoid-shift slang', () => {
  const requests = parseShiftRequestsFallback(
    '۲۰ام تا ۲۲ام مرخصی استحقاقی و ۵ام شیفت صبح و عصر نباشم',
    { totalDays: 31, calendarDays },
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0].requestType, 'leave');
  assert.deepEqual(requests[0].selectedDays, [20, 21, 22]);
  assert.equal(requests[1].requestType, 'avoid_shift');
  assert.equal(requests[1].preferredShift, 'ME');
  assert.deepEqual(requests[1].selectedDays, [5]);
});
