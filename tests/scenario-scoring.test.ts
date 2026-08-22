import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countHardConstraintWarnings,
  countScoringDefectWarnings,
  evaluateScenarioSchedule,
  filterWarningsForScenarioGroup,
  getHardConstraintWarnings,
  isHardWarningCountAcceptable,
  isInformationalWarning,
  MAX_ALLOWED_HARD_WARNINGS_PER_SCENARIO,
} from '../lib/scoring';
import type { MonthlySchedule, Personnel, ShiftRequest, SystemSettings } from '../lib/types';

function person(id: string, jobGroup: 'nurse' | 'assistant'): Personnel {
  return {
    id,
    firstName: id,
    lastName: 'test',
    personalCode: id,
    jobGroup,
    position: jobGroup === 'nurse' ? 'general' : 'none',
    employmentType: 'official',
    experienceYears: 3,
    active: true,
    canBeShiftLeader: jobGroup === 'nurse',
    orderIndex: id === 'n1' ? 0 : 1,
  };
}

const settings: SystemSettings = {
  dutyHours: {
    official: 160,
    contract: 174,
    conscript: 180,
    overtime: 0,
  },
  demand: {
    weekday: {
      morningNurse: 1,
      morningAssistant: 0,
      afternoonNurse: 0,
      afternoonAssistant: 0,
      afternoonLeader: 0,
      nightNurse: 0,
      nightAssistant: 0,
      nightLeader: 0,
    },
    holiday: {
      morningNurse: 1,
      morningAssistant: 0,
      afternoonNurse: 0,
      afternoonAssistant: 0,
      afternoonLeader: 0,
      nightNurse: 0,
      nightAssistant: 0,
      nightLeader: 0,
    },
  },
};

const personnel = [person('n1', 'nurse'), person('n2', 'nurse')];

const satisfiedRequests: ShiftRequest[] = [
  {
    id: 'req-1',
    personnelId: 'n1',
    requestType: 'shift',
    preferredShift: 'M',
    isEssential: true,
    scope: 'custom_days',
    selectedDays: [1, 3],
  },
  {
    id: 'req-2',
    personnelId: 'n2',
    requestType: 'OFF',
    isEssential: false,
    scope: 'custom_days',
    selectedDays: [1, 3],
  },
];

const scheduleAllRequestsMet: MonthlySchedule = {
  year: 1404,
  month: 2,
  assignments: {
    n1: { 1: 'M', 2: 'OFF', 3: 'M', 4: 'OFF' },
    n2: { 1: 'OFF', 2: 'M', 3: 'OFF', 4: 'M' },
  },
  shiftLeaders: {},
  warnings: [],
};

const scheduleImbalanced: MonthlySchedule = {
  year: 1404,
  month: 2,
  assignments: {
    n1: { 1: 'M', 2: 'M', 3: 'M', 4: 'M', 5: 'M', 6: 'M' },
    n2: { 1: 'OFF', 2: 'OFF', 3: 'OFF', 4: 'OFF', 5: 'OFF', 6: 'OFF' },
  },
  shiftLeaders: {},
  warnings: ['Mismatched Request: برای n2 test در روز 2 درخواست OFF ثبت شده اما شیفت M تخصیص یافته است'],
};

test('scenario scoring is deterministic for the same inputs', () => {
  const first = evaluateScenarioSchedule({
    id: 1,
    type: 'MIXED',
    schedule: scheduleAllRequestsMet,
    personnelList: personnel,
    requests: satisfiedRequests,
    settings,
    year: 1404,
    month: 2,
    customHolidays: {},
    targetJobGroup: 'nurse',
  });

  const second = evaluateScenarioSchedule({
    id: 1,
    type: 'MIXED',
    schedule: scheduleAllRequestsMet,
    personnelList: personnel,
    requests: satisfiedRequests,
    settings,
    year: 1404,
    month: 2,
    customHolidays: {},
    targetJobGroup: 'nurse',
  });

  assert.deepEqual(first.metrics, second.metrics);
  assert.equal(first.totalScore, second.totalScore);
});

test('request score reaches 100 when all registered requests are fully met', () => {
  const result = evaluateScenarioSchedule({
    id: 1,
    type: 'REQUESTS',
    schedule: scheduleAllRequestsMet,
    personnelList: personnel,
    requests: satisfiedRequests,
    settings,
    year: 1404,
    month: 2,
    customHolidays: {},
    targetJobGroup: 'nurse',
  });

  assert.equal(result.metrics.requestScore, 100);
});

test('fairness score drops when one nurse receives almost all workload', () => {
  const balanced = evaluateScenarioSchedule({
    id: 1,
    type: 'FAIRNESS',
    schedule: scheduleAllRequestsMet,
    personnelList: personnel,
    requests: satisfiedRequests,
    settings,
    year: 1404,
    month: 2,
    customHolidays: {},
    targetJobGroup: 'nurse',
  });

  const imbalanced = evaluateScenarioSchedule({
    id: 2,
    type: 'FAIRNESS',
    schedule: scheduleImbalanced,
    personnelList: personnel,
    requests: satisfiedRequests,
    settings,
    year: 1404,
    month: 2,
    customHolidays: {},
    targetJobGroup: 'nurse',
  });

  assert.ok(balanced.metrics.fairnessScore > imbalanced.metrics.fairnessScore);
});

test('group filtering keeps only the warnings that belong to the selected job group', () => {
  const warnings = [
    'Coverage Shortage: کمبود نیرو (پرستار) در روز 3 شیفت M',
    'Coverage Shortage: کمبود نیرو (کمک بهیار) در روز 3 شیفت M',
    'Max Consecutive: عدم رعایت سقف ۵ شیفت متوالی برای n1 test از روز 1 (M) تا روز 2 (E)',
  ];

  const nurseWarnings = filterWarningsForScenarioGroup(warnings, personnel, 'nurse');
  const assistantWarnings = filterWarningsForScenarioGroup(warnings, personnel, 'assistant');

  assert.equal(nurseWarnings.length, 2);
  assert.equal(assistantWarnings.length, 1);
  assert.equal(countHardConstraintWarnings(nurseWarnings), 2);
});

test('scenario warning filtering suppresses warnings for locked personnel', () => {
  const warnings = [
    'Coverage Shortage: کمبود نیرو (پرستار) در روز 3 شیفت M',
    'Max Consecutive: عدم رعایت سقف ۵ شیفت متوالی برای n1 test از روز 1 (M) تا روز 6 (M)',
    'Mismatched Request: برای n2 test در روز 2 درخواست OFF ثبت شده اما شیفت M تخصیص یافته است',
  ];

  const nurseWarnings = filterWarningsForScenarioGroup(warnings, personnel, 'nurse', ['n1']);

  assert.deepEqual(nurseWarnings, [
    'Coverage Shortage: کمبود نیرو (پرستار) در روز 3 شیفت M',
    'Mismatched Request: برای n2 test در روز 2 درخواست OFF ثبت شده اما شیفت M تخصیص یافته است',
  ]);
  assert.equal(countHardConstraintWarnings(nurseWarnings), 1);
});

test('hard warnings are extracted correctly and up to 4 remain eligible for scenario generation', () => {
  const warnings = [
    'Coverage Shortage: کمبود نیرو (پرستار) در روز 1 شیفت M',
    'Overstaffing: نیروی مازاد (پرستار) در روز 2 شیفت M',
    'Missing Shift Leader: نبود سرشیفت در نوبت عصر روز 2',
    'Max Consecutive: عدم رعایت سقف ۵ شیفت متوالی برای n1 test از روز 1 (M) تا روز 2 (E)',
    'Mandatory Rest: پرسنل n1 test در پایان این ماه به سقف ۵ شیفت متوالی رسیده است',
    'Mismatched Request: برای n2 test در روز 2 درخواست OFF ثبت شده اما شیفت M تخصیص یافته است',
  ];

  // Mandatory Rest دیگر هشدار سخت (سطح A) نیست — یادآور مرزی پایان ماه است.
  const hardWarnings = getHardConstraintWarnings(warnings);
  assert.equal(hardWarnings.length, 4);
  assert.equal(countHardConstraintWarnings(warnings), 4);
  assert.equal(
    hardWarnings.some(warning => warning.startsWith('Mandatory Rest:')),
    false,
    'the boundary reminder is not extracted as a hard warning'
  );
  assert.equal(MAX_ALLOWED_HARD_WARNINGS_PER_SCENARIO, 4);
  assert.equal(isHardWarningCountAcceptable(4), true);
  assert.equal(isHardWarningCountAcceptable(5), false);
});

// ---------------------------------------------------------------------------
// Informational notices (OFF Removed / Isolated Shift Fixed) are not defects
// ---------------------------------------------------------------------------

test('informational auto-fix notices do not reduce the warning-defect ranking', () => {
  const evaluate = (warnings: string[]) => evaluateScenarioSchedule({
    id: 1,
    type: 'MIXED',
    schedule: { ...scheduleAllRequestsMet, warnings },
    personnelList: personnel,
    requests: satisfiedRequests,
    settings,
    year: 1404,
    month: 2,
    customHolidays: {},
    targetJobGroup: 'nurse',
  });

  const noWarnings = evaluate([]);
  const infoOnly = evaluate([
    'OFF Removed: حذف OFF ناخواسته پرسنل n1 test در روز 2 به دلیل قانون ممنوعیت آف بعد از مرخصی',
    'Isolated Shift Fixed: شیفت تک (E) پرسنل n2 test در روز 3 برای حفظ الگوی پیوسته به n1 test منتقل شد',
  ]);

  // Two otherwise identical schedules: informational notices must not change
  // the warning-defect based optimization ranking.
  assert.equal(infoOnly.metrics.optimizationScore, noWarnings.metrics.optimizationScore);
  assert.equal(infoOnly.metrics.warningCount, 0, 'informational notices are not counted as defects');
  assert.equal(infoOnly.metrics.hardWarningCount, 0);
  assert.equal(infoOnly.totalScore, noWarnings.totalScore);

  // A genuine noncritical violation still lowers the score.
  const genuineViolation = evaluate([
    'Leave Continuity: تخلف غیربحرانی واقعی',
  ]);
  assert.ok(
    genuineViolation.metrics.optimizationScore < noWarnings.metrics.optimizationScore,
    'a real noncritical violation still affects scoring'
  );
  assert.equal(genuineViolation.metrics.warningCount, 1);
});

test('legacy persisted warning strings classify informational notices by their historical prefixes', () => {
  // Persisted warnings exist only as strings ("<English prefix>: <Persian text>").
  // The legacy string path must classify identically to the structured codes.
  assert.equal(isInformationalWarning('OFF Removed: حذف OFF ناخواسته پرسنل n1 test در روز 2'), true);
  assert.equal(isInformationalWarning('Isolated Shift Fixed: شیفت تک (E) پرسنل n2 test در روز 3'), true);
  assert.equal(isInformationalWarning('Mismatched Request: ...'), false);
  assert.equal(isInformationalWarning('Coverage Shortage: ...'), false);
  // Structured warnings classify by machine code, not by message text.
  assert.equal(isInformationalWarning({ code: 'OFF_REMOVED', severity: 'info', message: 'بازنویسی‌شده' }), true);
  assert.equal(isInformationalWarning({ code: 'ISOLATED_SHIFT_FIXED', severity: 'info', message: 'بازنویسی‌شده' }), true);
  assert.equal(isInformationalWarning({ code: 'MISMATCHED_REQUEST', severity: 'warning', message: 'OFF Removed: قیافهٔ اطلاع‌رسانی' }), false);

  assert.equal(countScoringDefectWarnings([
    'OFF Removed: ...',
    'Isolated Shift Fixed: ...',
    'Mismatched Request: ...',
    'Coverage Shortage: ...',
  ]), 2);
});
