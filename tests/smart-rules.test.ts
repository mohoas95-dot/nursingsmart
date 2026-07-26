import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOLIDAY_LEAVE_SHIFT,
  MAX_CONSECUTIVE_SHIFTS,
  endsMonthAtCapWithoutRest,
  findConsecutiveCapViolations,
  findConsecutiveRuns,
  findIsolatedSingleShiftDays,
  isIsolatedSingleShiftAt,
  isRoutineAllowedSingleShift,
  resolveLeaveShiftAssignment,
  routineAllowsPeriodAdd,
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
// قانون ۱ و ۲: سقف ۵ شیفت متوالی (وزن‌دار: M=۱، E=۱، N=۲ — تا ۵ مجاز، بیشتر ممنوع)
// ============================================================================

test('the consecutive cap is 5 units: 5 is allowed, more than 5 is forbidden', () => {
  assert.equal(MAX_CONSECUTIVE_SHIFTS, 5);
});

test('a night slot weighs 2 shift units, a morning/afternoon slot weighs 1', () => {
  // یک روز کامل MEN = M(۱) + E(۱) + N(۲) = ۴ واحد شیفت متوالی (معادل بلوک ۲۴ساعته)
  assert.deepEqual(
    findConsecutiveRuns({ p1: { 1: 'MEN' } }, 'p1', TOTAL_DAYS),
    [{ startDay: 1, endDay: 1, startPeriod: 'M', endPeriod: 'N', length: 4, slotCount: 3 }]
  );
  // MN = صبح و شب با جای خالیِ عصر بینشان → دو زنجیرهٔ جداگانه (۱ واحد و ۲ واحد)
  assert.deepEqual(
    findConsecutiveRuns({ p1: { 1: 'MN' } }, 'p1', TOTAL_DAYS),
    [
      { startDay: 1, endDay: 1, startPeriod: 'M', endPeriod: 'M', length: 1, slotCount: 1 },
      { startDay: 1, endDay: 1, startPeriod: 'N', endPeriod: 'N', length: 2, slotCount: 1 },
    ]
  );
  // ME امروز و EN فردا: جای خالیِ شبِ امروز زنجیره را قطع می‌کند → ۲ واحد و ۳ واحد
  assert.deepEqual(
    findConsecutiveRuns({ p1: { 1: 'ME', 2: 'EN' } }, 'p1', TOTAL_DAYS),
    [
      { startDay: 1, endDay: 1, startPeriod: 'M', endPeriod: 'E', length: 2, slotCount: 2 },
      { startDay: 2, endDay: 2, startPeriod: 'E', endPeriod: 'N', length: 3, slotCount: 2 },
    ]
  );
});

test('the rule is shift-agnostic: EVERY combination beyond 5 consecutive units is forbidden', () => {
  // قانون به هیچ شیفت خاصی وابسته نیست؛ فقط مجموع واحدهای متوالی مهم است.
  // تا ۵ واحد مجاز، بیشتر از ۵ واحد ممنوع.
  const forbidden: Array<[string, Record<number, string>]> = [
    ['MEN + ME (۱+۱+۲+۱+۱ = ۶)', { 1: 'MEN', 2: 'ME' }],
    ['N + MEN  (۲+۱+۱+۲ = ۶)', { 1: 'N', 2: 'MEN' }],
    ['EN + MEN (۱+۲+۱+۱+۲ = ۷)', { 1: 'EN', 2: 'MEN' }],
    ['MEN + MEN (۸)', { 1: 'MEN', 2: 'MEN' }],
    ['MEN + MEN + MEN (۱۲)', { 1: 'MEN', 2: 'MEN', 3: 'MEN' }],
  ];

  for (const [label, days] of forbidden) {
    assert.equal(
      findConsecutiveCapViolations({ p1: days }, 'p1', TOTAL_DAYS).length > 0,
      true,
      `${label} باید نقض سقف شیفت متوالی باشد`
    );
  }

  const allowed: Array<[string, Record<number, string>]> = [
    ['MEN تنها (۲۴ ساعت = ۴ واحد)', { 1: 'MEN' }],
    ['EN + M (۲۴ ساعت = ۴ واحد)', { 1: 'EN', 2: 'M' }],
    ['MEN + M (۱+۱+۲+۱ = ۵ → دقیقاً روی حد)', { 1: 'MEN', 2: 'M' }],
    ['EN + ME (۱+۲+۱+۱ = ۵ → دقیقاً روی حد)', { 1: 'EN', 2: 'ME' }],
    ['N + ME (۲+۱+۱ = ۴)', { 1: 'N', 2: 'ME' }],
    ['N + M  (۲+۱ = ۳)', { 1: 'N', 2: 'M' }],
    ['ME + EN (زنجیره با شبِ خالی قطع می‌شود)', { 1: 'ME', 2: 'EN' }],
    ['N + N (شبِ پیاپی با صبح/عصرِ خالی)', { 1: 'N', 2: 'N' }],
  ];

  for (const [label, days] of allowed) {
    assert.equal(
      findConsecutiveCapViolations({ p1: days }, 'p1', TOTAL_DAYS).length,
      0,
      `${label} نباید نقض شمرده شود`
    );
  }
});

test('a full day (MEN) plus the next morning (M) is exactly 5 units and is allowed', () => {
  // M,E,N (روز۱) + M (روز۲) = ۱+۱+۲+۱ = ۵ واحد → دقیقاً روی حد مجاز
  const assignments = { p1: { 1: 'MEN' } };
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'M', TOTAL_DAYS), false);
  assert.deepEqual(
    findConsecutiveRuns({ p1: { 1: 'MEN', 2: 'M' } }, 'p1', TOTAL_DAYS),
    [{ startDay: 1, endDay: 2, startPeriod: 'M', endPeriod: 'M', length: 5, slotCount: 4 }]
  );
  assert.equal(findConsecutiveCapViolations({ p1: { 1: 'MEN', 2: 'M' } }, 'p1', TOTAL_DAYS).length, 0);
});

test('a full day (MEN) plus the next morning AND afternoon (ME) is 6 consecutive and forbidden', () => {
  const assignments = { p1: { 1: 'MEN' } };
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'ME', TOTAL_DAYS), true);
});

test('evening+night then the next morning (EN + M) is 4 units and stays allowed', () => {
  // E,N (روز۱) + M (روز۲) = ۱+۲+۱ = ۴ واحد → همان بلوک ۲۴ساعته → مجاز
  const assignments = { p1: { 1: 'EN' } };
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'M', TOTAL_DAYS), false);
  // افزودن عصرِ روز ۲ (ME) می‌شود ۵ واحد → هنوز مجاز (دقیقاً روی حد)
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'ME', TOTAL_DAYS), false);
  // اما MEN روز ۲ می‌شود ۷ واحد → ممنوع
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'MEN', TOTAL_DAYS), true);
});

test('a night followed by the next full day (N + MEN) is 6 units and forbidden', () => {
  // N (روز۱) + M,E,N (روز۲) = ۲+۱+۱+۲ = ۶ واحد → ممنوع
  const assignments = { p1: { 1: 'N' } };
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'MEN', TOTAL_DAYS), true);
  // ولی N + ME دقیقاً ۴ واحد است → مجاز
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'ME', TOTAL_DAYS), false);
});

test('five M-only days are NOT consecutive (empty E and N separate them)', () => {
  // هر M یک زنجیرهٔ مستقلِ ۱واحدی است؛ چون بین دو M، یک E و یک Nِ خالی وجود دارد.
  const assignments = { p1: { 1: 'M', 2: 'M', 3: 'M', 4: 'M', 5: 'M' } };
  const runs = findConsecutiveRuns(assignments, 'p1', TOTAL_DAYS);
  assert.equal(runs.length, 5, 'هر روز فقط M باید یک زنجیرهٔ جداگانه باشد');
  for (const run of runs) {
    assert.equal(run.length, 1);
  }
  // ادامهٔ این روند در روز ششم هم نقض نیست چون متوالی محسوب نمی‌شود.
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 6, 'M', TOTAL_DAYS), false);
  assert.equal(findConsecutiveCapViolations(assignments, 'p1', TOTAL_DAYS).length, 0);
});

test('after reaching the 5-unit cap the next adjacent shift forces a rest (mandatory rest)', () => {
  // M,E,N (روز۱) + M (روز۲) = ۵ واحد (دقیقاً سقف)؛ افزودن عصرِ روز ۲ آن را به ۶ می‌برد → ممنوع
  const atCap = { p1: { 1: 'MEN', 2: 'M' } };
  assert.equal(wouldBreachConsecutiveCap(atCap, 'p1', 2, 'ME', TOTAL_DAYS), true);
  // آف همیشه مجاز است و زنجیره را قطع می‌کند
  assert.equal(wouldBreachConsecutiveCap(atCap, 'p1', 2, 'OFF', TOTAL_DAYS), false);
  // اگر روز ۲ آف باشد، روز ۳ آزاد است (زنجیره قطع شده)
  const rested = { p1: { 1: 'MEN', 2: 'OFF' } };
  assert.equal(wouldBreachConsecutiveCap(rested, 'p1', 3, 'MEN', TOTAL_DAYS), false);
});

test('cap evaluation counts both backward and forward slots when editing inside a filled month', () => {
  // شبِ روز ۱ و صبحِ روز ۳ از قبل پر شده‌اند؛ درج MEN در روز ۲ این‌ها را به هم وصل می‌کند:
  // N (روز۱) + M,E,N (روز۲) + M (روز۳) = ۲+۱+۱+۲+۱ = ۷ واحد → ممنوع
  const assignments = { p1: { 1: 'N', 3: 'M' } };
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'MEN', TOTAL_DAYS), true);
  // درج M تنها در روز ۲ فقط N,M می‌سازد (۳ واحد) → مجاز
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'M', TOTAL_DAYS), false);
  // درج OFF همیشه مجاز است
  assert.equal(wouldBreachConsecutiveCap(assignments, 'p1', 2, 'OFF', TOTAL_DAYS), false);
});

test('findConsecutiveCapViolations reports the violating run bounds and weighted length', () => {
  // M,E,N (روز۲) + M,E (روز۳) = ۱+۱+۲+۱+۱ = ۶ واحد از صبح روز ۲ تا عصر روز ۳
  const assignments = { p1: { 2: 'MEN', 3: 'ME' } };
  const violations = findConsecutiveCapViolations(assignments, 'p1', TOTAL_DAYS);
  assert.deepEqual(violations, [
    { startDay: 2, endDay: 3, startPeriod: 'M', endPeriod: 'E', length: 6, slotCount: 5 },
  ]);
});

test('endsMonthAtCapWithoutRest flags a run at the 5-unit cap reaching the last night', () => {
  // E (روز۳۰) + M,E,N (روز۳۱)؟ ساده‌تر: N(روز۳۰)+M,E,N(روز۳۱) = ۲+۱+۱+۲ = ۶ → تا شبِ آخر
  const atCap = { p1: { 30: 'N', 31: 'MEN' } };
  assert.equal(endsMonthAtCapWithoutRest(atCap, 'p1', TOTAL_DAYS), true);
  // فقط MEN روز آخر = ۴ واحد → هنوز به سقف ۵ نرسیده
  const belowCap = { p1: { 31: 'MEN' } };
  assert.equal(endsMonthAtCapWithoutRest(belowCap, 'p1', TOTAL_DAYS), false);
  // اگر آخرین روز آف باشد، زنجیره تا پایان ماه ادامه ندارد → بدون نیاز به استراحت
  const cappedButRested = { p1: { 30: 'N', 31: 'OFF' } };
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

test('verifier reports a Max Consecutive warning for a run beyond 5 consecutive units', () => {
  // M,E,N (روز۱) + M,E (روز۲) = ۱+۱+۲+۱+۱ = ۶ واحد → نقض
  const assignments = { p1: { 1: 'MEN', 2: 'ME' } };
  const result = verifyCoverageAndLeaders(
    1404, 2, [person('p1', 'nurse')], assignments, settingsWithDemand({}), {}, undefined, []
  );
  const warning = result.warnings.find(w => w.startsWith('Max Consecutive:'));
  assert.ok(warning, 'expected a Max Consecutive warning');
  assert.match(warning!, /از روز 1 \(M\) تا روز 2 \(E\)/);
  assert.match(warning!, /6 شیفت متوالی/);
});

test('verifier does NOT flag a full day plus the next morning (MEN + M = exactly 5 units)', () => {
  // M,E,N (روز۱) + M (روز۲) = ۵ واحد → دقیقاً روی حد → بدون هشدار
  const assignments = { p1: { 1: 'MEN', 2: 'M' } };
  const result = verifyCoverageAndLeaders(
    1404, 2, [person('p1', 'nurse')], assignments, settingsWithDemand({}), {}, undefined, []
  );
  assert.equal(
    result.warnings.some(w => w.startsWith('Max Consecutive:')),
    false,
    'MEN + M دقیقاً ۵ واحد است و مجاز شمرده می‌شود'
  );
});

test('verifier does not flag a 24-hour block assembled as EN + M (4 units)', () => {
  // E,N (روز۱) + M (روز۲) = ۱+۲+۱ = ۴ واحد → مجاز، بدون هشدار
  const assignments = { p1: { 1: 'EN', 2: 'M' } };
  const result = verifyCoverageAndLeaders(
    1404, 2, [person('p1', 'nurse')], assignments, settingsWithDemand({}), {}, undefined, []
  );
  assert.equal(
    result.warnings.some(w => w.startsWith('Max Consecutive:')),
    false,
    'یک بلوک ۲۴ساعته (۴ واحد) مجاز است'
  );
});

test('verifier reports a Mandatory Rest reminder when the month ends at the 5-unit cap', () => {
  // N (روز۳۰) + M,E,N (روز۳۱) = ۶ واحد که تا شبِ آخرین روز ادامه دارد
  const assignments = { p1: { 30: 'N', 31: 'MEN' } };
  const result = verifyCoverageAndLeaders(
    1404, 2, [person('p1', 'nurse')], assignments, settingsWithDemand({}), {}, undefined, []
  );
  assert.ok(result.warnings.some(w => w.startsWith('Mandatory Rest:')), 'expected a Mandatory Rest warning');
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

test('regeneration never builds a run beyond 5 consecutive shift units', () => {
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

test('two nurses can rotate three daily posts without ever exceeding 5 consecutive units', () => {
  // با ۲ پرستار و ۳ پست روزانه، چرخش MEN/آف زنجیره‌ها را کوتاه نگه می‌دارد → بدون نقض
  const personnel = [person('n1', 'nurse'), person('n2', 'nurse')];
  const result = solveWithPriority(
    1404, 2, personnel, [],
    settingsWithDemand({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }),
    {}, undefined, null
  );
  for (const p of personnel) {
    assert.deepEqual(
      findConsecutiveCapViolations(result.assignments, p.id, TOTAL_DAYS),
      [],
      `${p.id} must not exceed 5 consecutive shift units`
    );
  }
  assert.equal(result.warnings.some(w => w.startsWith('Max Consecutive:')), false);
});

test('regeneration surfaces a Max Consecutive warning when staffing makes the cap impossible', () => {
  // تنها ۱ پرستار برای ۳ پست کاری روزانه: ساختاراً ناگزیر از MEN هر روز و عبور از سقف ۴
  const personnel = [person('n1', 'nurse')];
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

// ============================================================================
// تگ روتین کاری برای نفرات بدون درخواست شیفت + شماره‌گذاری خودکار مرخصی در منوی سلول
// ============================================================================

test('routine period access maps each tag to its allowed staffing periods', () => {
  // صبح‌کار فقط صبح می‌آید
  assert.equal(routineAllowsPeriodAdd('morning', 'M'), true);
  assert.equal(routineAllowsPeriodAdd('morning', 'E'), false);
  assert.equal(routineAllowsPeriodAdd('morning', 'N'), false);
  // لانگ‌کار صبح و عصر می‌آید (ME)
  assert.equal(routineAllowsPeriodAdd('long', 'M'), true);
  assert.equal(routineAllowsPeriodAdd('long', 'E'), true);
  assert.equal(routineAllowsPeriodAdd('long', 'N'), false);
  // عصر و شب‌کار عصر و شب می‌آید (EN یا N)
  assert.equal(routineAllowsPeriodAdd('evening_night', 'M'), false);
  assert.equal(routineAllowsPeriodAdd('evening_night', 'E'), true);
  assert.equal(routineAllowsPeriodAdd('evening_night', 'N'), true);
  // بدون تگ همه دوره‌ها آزاد است
  assert.equal(routineAllowsPeriodAdd(undefined, 'M'), true);
});

test('regeneration arranges request-less personnel strictly by their routine tag', () => {
  const morningWorker = person('n1', 'nurse', { workRoutine: 'morning' });
  const nightWorker = person('n2', 'nurse', { workRoutine: 'evening_night' });
  const flexibleWorker = person('n3', 'nurse');
  const result = solveWithPriority(
    1404, 2, [morningWorker, nightWorker, flexibleWorker], [],
    settingsWithDemand({ morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }, {}),
    {}, undefined, null
  );

  const covers = (shift: string | undefined, component: 'M' | 'E' | 'N') =>
    !!shift && !shift.startsWith('L') && shift.includes(component);

  for (let d = 1; d <= TOTAL_DAYS; d++) {
    const morningShift = result.assignments.n1?.[d];
    assert.ok(
      !covers(morningShift, 'E') && !covers(morningShift, 'N'),
      `morning-tagged worker must never receive E/N (day ${d}: ${morningShift})`
    );
    const nightShift = result.assignments.n2?.[d];
    assert.ok(
      !covers(nightShift, 'M'),
      `evening/night-tagged worker must never receive M (day ${d}: ${nightShift})`
    );
  }
});

test('routine tag of a request-less worker yields to coverage only as a last resort', () => {
  // هر دو پرستار صبح‌کار هستند اما تقاضای شب وجود دارد → مسیر پشتیبان باید کاور کند
  const personnel = [
    person('n1', 'nurse', { workRoutine: 'morning' }),
    person('n2', 'nurse', { workRoutine: 'morning' }),
  ];
  const result = solveWithPriority(
    1404, 2, personnel, [],
    settingsWithDemand({ nightNurse: 1 }, {}),
    {}, undefined, null
  );

  let nightCoverage = 0;
  for (let d = 1; d <= TOTAL_DAYS; d++) {
    for (const p of personnel) {
      const shift = result.assignments[p.id]?.[d];
      if (shift && !shift.startsWith('L') && shift.includes('N')) {
        nightCoverage++;
      }
    }
  }
  assert.ok(nightCoverage > 10, `night demand must still be covered as a last resort (got ${nightCoverage})`);
});

test('an explicit shift request is still honored for tagged personnel with their own request', () => {
  const requests: ShiftRequest[] = [
    {
      id: 'req-n1-night',
      personnelId: 'n1',
      requestType: 'shift',
      preferredShift: 'N',
      isEssential: true,
      scope: 'custom_days',
      selectedDays: [2],
    },
  ];
  const result = solveWithPriority(
    1404, 2, [person('n1', 'nurse', { workRoutine: 'morning' }), person('n2', 'nurse'), person('n3', 'nurse')],
    requests,
    settingsWithDemand({ morningNurse: 1, nightNurse: 1 }, {}),
    {}, undefined, null
  );
  const shift = result.assignments.n1?.[2];
  assert.ok(
    !!shift && shift.includes('N'),
    `the explicit N request of the tagged nurse must be honored (got ${shift})`
  );
});

test('manual leave from the cell menu auto-numbers consecutive leave days', () => {
  const assignments = { p1: { 3: 'L1', 4: 'L2', 8: HOLIDAY_LEAVE_SHIFT, 12: 'OFF' } };
  // ادامه زنجیره مرخصی: روز ۵ سومین روز پیاپی است
  assert.equal(resolveLeaveShiftAssignment(assignments, 'p1', 5), 'L3');
  // مرخصی تعطیل (LH) شماره‌دار نیست و زنجیره را قطع می‌کند
  assert.equal(resolveLeaveShiftAssignment(assignments, 'p1', 9), 'L1');
  // بعد از روز آف، شمارش از ۱ شروع می‌شود
  assert.equal(resolveLeaveShiftAssignment(assignments, 'p1', 13), 'L1');
  // روز اول ماه
  assert.equal(resolveLeaveShiftAssignment(assignments, 'p1', 1), 'L1');
});
