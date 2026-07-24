import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOLIDAY_LEAVE_SHIFT,
  MAX_CONSECUTIVE_SHIFT_UNITS,
  endsMonthAtCapWithoutRest,
  findConsecutiveCapViolations,
  findIsolatedSingleShiftDays,
  getShiftWeight,
  isIsolatedSingleShiftAt,
  isRoutineAllowedSingleShift,
  shiftMatchesRoutine,
  wouldBreachConsecutiveCap,
} from '../domain/scheduling/smart-rules';
import {
  generatePersonnelReports,
  getShiftHours,
  solveNursingSchedule,
  solveWithPriority,
  verifyCoverageAndLeaders,
} from '../lib/solver';
import type { MonthlySchedule, Personnel, ShiftRequest, SystemSettings, WorkRoutineTag } from '../lib/types';

const TOTAL_DAYS = 31; // 1404/02 (Ordibehesht) always has 31 days

function person(
  id: string,
  jobGroup: 'nurse' | 'assistant',
  extras: Partial<Personnel> = {}
): Personnel {
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
    ...extras,
  };
}

function settingsWithDemand(
  values: {
    morningNurse?: number;
    afternoonNurse?: number;
    nightNurse?: number;
    morningAssistant?: number;
    afternoonAssistant?: number;
    nightAssistant?: number;
  },
  holidayValues?: {
    morningNurse?: number;
    afternoonNurse?: number;
    nightNurse?: number;
    morningAssistant?: number;
    afternoonAssistant?: number;
    nightAssistant?: number;
  }
): SystemSettings {
  const weekday = {
    morningNurse: values.morningNurse ?? 0,
    morningAssistant: values.morningAssistant ?? 0,
    afternoonNurse: values.afternoonNurse ?? 0,
    afternoonAssistant: values.afternoonAssistant ?? 0,
    afternoonLeader: 0,
    nightNurse: values.nightNurse ?? 0,
    nightAssistant: values.nightAssistant ?? 0,
    nightLeader: 0,
  };
  const holiday = holidayValues
    ? {
        morningNurse: holidayValues.morningNurse ?? 0,
        morningAssistant: holidayValues.morningAssistant ?? 0,
        afternoonNurse: holidayValues.afternoonNurse ?? 0,
        afternoonAssistant: holidayValues.afternoonAssistant ?? 0,
        afternoonLeader: 0,
        nightNurse: holidayValues.nightNurse ?? 0,
        nightAssistant: holidayValues.nightAssistant ?? 0,
        nightLeader: 0,
      }
    : { ...weekday };
  return {
    dutyHours: { official: 160, contract: 174, conscript: 180, overtime: 150 },
    demand: { weekday, holiday },
  };
}

// ============================================================================
// قانون ۱ و ۲: سقف ۵ شیفت متوالی (M=١، E=١، N=٢) و استراحت اجباری
// ============================================================================

test('shift weights follow the M=1, E=1, N=2 counting rule', () => {
  assert.equal(getShiftWeight('M'), 1);
  assert.equal(getShiftWeight('E'), 1);
  assert.equal(getShiftWeight('N'), 2);
  assert.equal(getShiftWeight('ME'), 2);
  assert.equal(getShiftWeight('EN'), 3);
  assert.equal(getShiftWeight('MN'), 3);
  assert.equal(getShiftWeight('MEN'), 4);
  assert.equal(getShiftWeight('OFF'), 0);
  assert.equal(getShiftWeight('L1'), 0);
  assert.equal(getShiftWeight(HOLIDAY_LEAVE_SHIFT), 0);
  assert.equal(MAX_CONSECUTIVE_SHIFT_UNITS, 5);
});

test('MEN followed by ME the next day is forbidden (4 + 2 = 6 > 5)', () => {
  const assignments = { p1: { 1: 'MEN' } };
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'ME', TOTAL_DAYS), true);
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'M', TOTAL_DAYS), false);
});

test('five consecutive M shifts are allowed but the sixth forces a mandatory rest', () => {
  const assignments = { p1: { 1: 'M', 2: 'M', 3: 'M', 4: 'M', 5: 'M' } };
  // رسیدن به ۵ واحد → هر شیفت کاری در روز ششم نقض است (استراحت اجباری)
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 6, 'M', TOTAL_DAYS), true);
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 6, 'E', TOTAL_DAYS), true);
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 6, 'OFF', TOTAL_DAYS), false);
  // پس از استراحت روز ششم، کار در روز هفتم دوباره مجاز است
  const withRest = { p1: { 1: 'M', 2: 'M', 3: 'M', 4: 'M', 5: 'M', 6: 'OFF' } };
  assert.equal(wouldBreachConsecutiveCap(withRest, 'p1', 7, 'M', TOTAL_DAYS), false);
});

test('MN followed by N reaches exactly 5 units and blocks any work on the next day', () => {
  const assignments = { p1: { 1: 'MN', 2: 'N' } };
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 3, 'M', TOTAL_DAYS), true);
});

test('cap evaluation also counts forward days when editing inside a filled month', () => {
  const assignments = { p1: { 1: 'M', 3: 'ME', 4: 'M' } };
  // درج ME در روز دوم: 1 + 2 + 2 + 1 = 6 → نقض
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'ME', TOTAL_DAYS), true);
  // درج OFF همیشه مجاز است
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'OFF', TOTAL_DAYS), false);
});

test('findConsecutiveCapViolations reports the violating run bounds and total weight', () => {
  const assignments = { p1: { 2: 'MEN', 3: 'ME' } };
  const violations = findConsecutiveCapViolations(assignments, 'p1', TOTAL_DAYS);
  assert.deepEqual(violations, [{ startDay: 2, endDay: 3, weight: 6 }]);
});

test('endsMonthAtCapWithoutRest flags a 5-unit run that ends on the last day of the month', () => {
  const atCap = { p1: { 27: 'M', 28: 'M', 29: 'M', 30: 'M', 31: 'M' } };
  assert.equal(endsMonthAtCapWithoutRest(atCap, 'p1', TOTAL_DAYS), true);
  const belowCap = { p1: { 28: 'M', 29: 'M', 30: 'M', 31: 'M' } };
  assert.equal(endsMonthAtCapWithoutRest(belowCap, 'p1', TOTAL_DAYS), false);
  const cappedButRested = { p1: { 27: 'M', 28: 'M', 29: 'M', 30: 'M', 31: 'OFF' } };
  assert.equal(endsMonthAtCapWithoutRest(cappedButRested, 'p1', TOTAL_DAYS), false);
});

// ============================================================================
// قانون ۳: ممنوعیت شیفت تک‌تک و تگ روتین کاری
// ============================================================================

test('a single E between two M days is an isolated single shift', () => {
  const assignments = { p1: { 1: 'M', 2: 'E', 3: 'M' } };
  assert.equal(isIsolatedSingleShiftAt(assignments, 'p1', 2, TOTAL_DAYS), true);
  assert.deepEqual(findIsolatedSingleShiftDays(assignments, 'p1', TOTAL_DAYS), [2]);
});

test('a single E embedded in an ME block is continuous, not isolated', () => {
  const assignments = { p1: { 1: 'ME', 2: 'E', 3: 'ME' } };
  assert.equal(isIsolatedSingleShiftAt(assignments, 'p1', 2, TOTAL_DAYS), false);
  assert.deepEqual(findIsolatedSingleShiftDays(assignments, 'p1', TOTAL_DAYS), []);
});

test('an M block is never flagged as isolated', () => {
  const assignments = { p1: { 1: 'M', 2: 'M', 3: 'M' } };
  assert.deepEqual(findIsolatedSingleShiftDays(assignments, 'p1', TOTAL_DAYS), []);
});

test('a single M is allowed (not isolated) for personnel tagged as morning workers', () => {
  const assignments = { p1: { 1: 'E', 2: 'M', 3: 'E' } };
  assert.equal(isIsolatedSingleShiftAt(assignments, 'p1', 2, TOTAL_DAYS), true);
  assert.equal(isRoutineAllowedSingleShift('M', 'morning'), true);
  assert.deepEqual(findIsolatedSingleShiftDays(assignments, 'p1', TOTAL_DAYS, 'morning' as WorkRoutineTag), []);
});

test('work-routine tags match only their declared continuous patterns', () => {
  // صبح‌کار: فقط M تک
  assert.equal(shiftMatchesRoutine('M', 'morning'), true);
  assert.equal(shiftMatchesRoutine('ME', 'morning'), false);
  // عصر و شب‌کار: EN یا MEN یا N یا NM
  assert.equal(shiftMatchesRoutine('EN', 'evening_night'), true);
  assert.equal(shiftMatchesRoutine('MEN', 'evening_night'), true);
  assert.equal(shiftMatchesRoutine('N', 'evening_night'), true);
  assert.equal(shiftMatchesRoutine('MN', 'evening_night'), true);
  assert.equal(shiftMatchesRoutine('E', 'evening_night'), false);
  assert.equal(shiftMatchesRoutine('M', 'evening_night'), false);
  // لانگ‌کار: ME
  assert.equal(shiftMatchesRoutine('ME', 'long'), true);
  assert.equal(shiftMatchesRoutine('M', 'long'), false);
  assert.equal(shiftMatchesRoutine('E', 'long'), false);
});

// ============================================================================
// هشدارهای verifier برای قوانین جدید
// ============================================================================

test('verifier reports a Max Consecutive warning for a run above 5 units', () => {
  const assignments = { p1: { 1: 'MEN', 2: 'ME' } };
  const result = verifyCoverageAndLeaders(
    1404, 2, [person('p1', 'nurse')], assignments, settingsWithDemand({}), {}, undefined, []
  );
  const warning = result.warnings.find(w => w.startsWith('Max Consecutive:'));
  assert.ok(warning, 'expected a Max Consecutive warning');
  assert.match(warning!, /روز 1 تا روز 2/);
  assert.match(warning!, /6 واحد/);
});

test('verifier reports a Mandatory Rest reminder when the month ends at the 5-unit cap', () => {
  const assignments = { p1: { 27: 'M', 28: 'M', 29: 'M', 30: 'M', 31: 'M' } };
  const result = verifyCoverageAndLeaders(
    1404, 2, [person('p1', 'nurse')], assignments, settingsWithDemand({}), {}, undefined, []
  );
  assert.ok(result.warnings.some(w => w.startsWith('Mandatory Rest:')), 'expected a Mandatory Rest warning');
  assert.equal(result.warnings.some(w => w.startsWith('Max Consecutive:')), false, 'a 5-unit run is still legal');
});

test('verifier reports an Isolated Shift warning for a single E among working days', () => {
  const assignments = { p1: { 1: 'M', 2: 'E', 3: 'M' } };
  const result = verifyCoverageAndLeaders(
    1404, 2, [person('p1', 'nurse')], assignments, settingsWithDemand({}), {}, undefined, []
  );
  const warning = result.warnings.find(w => w.startsWith('Isolated Shift:'));
  assert.ok(warning, 'expected an Isolated Shift warning');
  assert.match(warning!, /روز 2/);
});

test('verifier does not flag a single M of a morning-tagged worker', () => {
  const assignments = { p1: { 1: 'M', 3: 'M' } };
  const morningWorker = person('p1', 'nurse', { workRoutine: 'morning' });
  const result = verifyCoverageAndLeaders(
    1404, 2, [morningWorker], assignments, settingsWithDemand({}), {}, undefined, []
  );
  assert.equal(result.warnings.some(w => w.startsWith('Isolated Shift:')), false);
});

// ============================================================================
// قانون ۴: مرخصی روز تعطیل و اعتبار دقیق ۷ ساعت
// ============================================================================

test('holiday leave always credits exactly 7 hours regardless of employment type', () => {
  assert.equal(getShiftHours(HOLIDAY_LEAVE_SHIFT, 'official'), 7);
  assert.equal(getShiftHours(HOLIDAY_LEAVE_SHIFT, 'contract'), 7);
  assert.equal(getShiftHours(HOLIDAY_LEAVE_SHIFT, 'conscript'), 7);
  // مرخصی عادی همچنان با نرخ استخدامی محاسبه می‌شود
  assert.equal(getShiftHours('L1', 'official'), 7);
  assert.equal(getShiftHours('L1', 'contract'), 7.5);
});

test('reports credit 7 hours for leave on an official holiday plus the normal rate for other leave days', () => {
  const official = person('p1', 'nurse', { employmentType: 'official' });
  const contract = person('p2', 'nurse', { employmentType: 'contract' });
  const schedule: MonthlySchedule = {
    year: 1404,
    month: 2,
    assignments: {
      p1: { 3: HOLIDAY_LEAVE_SHIFT, 4: 'L1' },
      p2: { 3: HOLIDAY_LEAVE_SHIFT, 4: 'L1' },
    },
    shiftLeaders: {},
    warnings: [],
  };

  const reports = generatePersonnelReports(1404, 2, [official, contract], schedule, settingsWithDemand({}), {}, undefined, null);
  const officialReport = reports.find(r => r.personnelId === 'p1')!;
  const contractReport = reports.find(r => r.personnelId === 'p2')!;

  // ۷ ساعت مرخصی تعطیل + ۷ ساعت مرخصی عادی (نرخ رسمی)
  assert.equal(officialReport.leaveCount, 2);
  assert.equal(officialReport.workedHours, 14);
  // ۷ ساعت مرخصی تعطیل + ۷.۵ ساعت مرخصی عادی (نرخ قراردادی)
  assert.equal(contractReport.leaveCount, 2);
  assert.equal(contractReport.workedHours, 14.5);
});

test('solver marks a leave day on an official holiday with the LH holiday-leave marker', () => {
  const requests: ShiftRequest[] = [
    {
      id: 'r1',
      personnelId: 'p1',
      requestType: 'leave',
      isEssential: true,
      scope: 'custom_days',
      selectedDays: [3, 4],
    },
  ];
  const result = solveNursingSchedule(
    1404, 2, [person('p1', 'nurse')], requests, settingsWithDemand({}),
    { 3: 'مناسبت آزمایشی' }, undefined, null
  );
  assert.equal(result.assignments.p1[3], HOLIDAY_LEAVE_SHIFT, 'holiday leave must use the LH marker');
  assert.equal(result.assignments.p1[4], 'L1', 'the following non-holiday leave day restarts the numbered leave sequence');
});

// ============================================================================
// اتصال قوانین به بازتولید هوشمند (مسیر دکمه «بازتولید هوشمند»)
// ============================================================================

test('regeneration never builds a run above 5 consecutive shift units', () => {
  const personnel = [person('a1', 'assistant'), person('a2', 'assistant'), person('a3', 'assistant')];
  const result = solveWithPriority(
    1404, 2, personnel, [],
    settingsWithDemand({ morningAssistant: 2 }, {}),
    {}, undefined, null
  );

  for (const p of personnel) {
    assert.deepEqual(
      findConsecutiveCapViolations(result.assignments, p.id, TOTAL_DAYS),
      [],
      `${p.id} must not exceed 5 consecutive shift units`
    );
  }
  assert.equal(
    result.warnings.some(w => w.startsWith('Max Consecutive:')),
    false,
    'a solvable plan must not emit Max Consecutive warnings'
  );
});

test('regeneration surfaces a Max Consecutive warning when staffing makes the cap impossible', () => {
  // تنها ۲ پرستار برای ۳ پست کاری روزانه: ساختاراً ناگزیر از عبور سقف
  const personnel = [person('n1', 'nurse'), person('n2', 'nurse')];
  const result = solveWithPriority(
    1404, 2, personnel, [],
    settingsWithDemand({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }),
    {}, undefined, null
  );
  assert.ok(
    result.warnings.some(w => w.startsWith('Max Consecutive:')),
    'an unavoidable cap breach must be reported as a warning instead of failing silently'
  );
});

test('regeneration prefers the candidate whose work-routine tag matches the gap', () => {
  const morningWorker = person('n1', 'nurse', { workRoutine: 'morning' });
  const nightWorker = person('n2', 'nurse', { workRoutine: 'evening_night' });
  const result = solveWithPriority(
    1404, 2, [morningWorker, nightWorker], [],
    settingsWithDemand({ nightNurse: 1 }, {}),
    {}, undefined, null
  );

  let n1Nights = 0;
  let n2Nights = 0;
  for (let d = 1; d <= TOTAL_DAYS; d++) {
    if (result.assignments.n1?.[d] === 'N') n1Nights++;
    if (result.assignments.n2?.[d] === 'N') n2Nights++;
  }
  assert.ok(
    n2Nights > n1Nights,
    `night gaps should mainly go to the evening/night-tagged worker (n2=${n2Nights}, n1=${n1Nights})`
  );
});
