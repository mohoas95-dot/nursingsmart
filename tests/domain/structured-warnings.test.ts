import assert from 'node:assert/strict';
import test from 'node:test';

import {
  countCriticalScheduleWarnings,
  createScheduleWarning,
  dedupeScheduleWarningsByMessage,
  getCriticalScheduleWarnings,
  hasCriticalScheduleWarning,
  isCriticalScheduleWarning,
  isCriticalWarningCode,
  warningMessages,
  type ScheduleWarning,
} from '../../domain/warnings/schedule-warning';
import {
  filterStructuredWarningsForScenarioGroup,
  filterWarningsForScenarioGroup,
  isHardConstraintWarning,
} from '../../lib/scoring';
import { evaluateBaselineObjective } from '../../domain/scenarios/objective';
import { verifyCoverageAndLeaders } from '../../lib/solver';
import {
  generateCriticalRepairEdits,
  type CriticalRepairContext,
  type VerifiedSchedule,
} from '../../lib/scenarioGenerator';
import type { MonthlySchedule } from '../../lib/types';
import { CAL_MONTH, CAL_YEAR, FRIDAYS, makePerson, makeRequest, makeSettings } from '../fixtures/realistic';

// ---------------------------------------------------------------------------
// ابزارهای ساخت فیکسچر
// ---------------------------------------------------------------------------

/** تنظیمات با تقاضای صفر — تا هشدارهای پوشش/سرشیفت باتری را شلوغ نکنند. */
function zeroDemandSettings() {
  const base = { morningNurse: 0, afternoonNurse: 0, nightNurse: 0 };
  return makeSettings(base, base);
}

/** همه آف: کمبود پوشش در تمام روزها (۲/۱/۱ صبح/عصر/شب پرستار) → باتری غنی. */
function coverageBattery() {
  const nurse = makePerson('n1');
  return verifyCoverageAndLeaders(CAL_YEAR, CAL_MONTH, [nurse], {}, makeSettings(), {}, undefined, []);
}

function fakeVerifiedSchedule(
  assignments: Record<string, Record<number, string>>,
  structuredWarnings: ScheduleWarning[]
): VerifiedSchedule {
  return {
    year: CAL_YEAR,
    month: CAL_MONTH,
    assignments: assignments as VerifiedSchedule['assignments'],
    shiftLeaders: {},
    warnings: warningMessages(structuredWarnings),
    structuredWarnings,
  };
}

const REPAIR_CONTEXT: CriticalRepairContext = {
  freeTargetPersonnel: [makePerson('a'), makePerson('b')],
  totalDays: 31,
};

/** متن نمایشی که عمداً هیچ الگوی قابل‌تجزیه‌ای (روز N / شیفت X / نام) ندارد. */
const REWORDED_MESSAGE = 'متن نمایشی کاملاً بازنویسی‌شده؛ هیچ عدد روز، حرف شیفت یا نامی در آن نیست';

// ============================================================================
// ۱) مدل ساخت‌یافتهٔ هشدار
// ============================================================================

test('structured warning exposes code, severity and metadata fields', () => {
  const warning = createScheduleWarning({
    code: 'COVERAGE_SHORTAGE',
    message: 'هر متن نمایشی',
    day: 12,
    shift: 'M',
    jobGroup: 'nurse',
    metadata: { assigned: 1, demanded: 2, delta: -1 },
  });

  assert.equal(warning.code, 'COVERAGE_SHORTAGE');
  assert.equal(warning.severity, 'critical');
  assert.equal(warning.day, 12);
  assert.equal(warning.shift, 'M');
  assert.equal(warning.jobGroup, 'nurse');
  assert.deepEqual(warning.metadata, { assigned: 1, demanded: 2, delta: -1 });
});

test('default severity mapping: 5 critical codes, auto-fix notices are info, rest are warnings', () => {
  for (const code of ['COVERAGE_SHORTAGE', 'OVERSTAFFING', 'MISSING_SHIFT_LEADER', 'MAX_CONSECUTIVE', 'MANDATORY_REST'] as const) {
    assert.equal(isCriticalWarningCode(code), true);
    assert.equal(createScheduleWarning({ code, message: 'x' }).severity, 'critical');
  }
  assert.equal(createScheduleWarning({ code: 'OFF_REMOVED', message: 'x' }).severity, 'info');
  assert.equal(createScheduleWarning({ code: 'ISOLATED_SHIFT_FIXED', message: 'x' }).severity, 'info');
  assert.equal(createScheduleWarning({ code: 'MISMATCHED_REQUEST', message: 'x' }).severity, 'warning');
  assert.equal(createScheduleWarning({ code: 'CONSECUTIVE_OFFS', message: 'x' }).severity, 'warning');
  assert.equal(createScheduleWarning({ code: 'LEAVE_CONTINUITY', message: 'x' }).severity, 'warning');
  assert.equal(createScheduleWarning({ code: 'ISOLATED_SHIFT', message: 'x' }).severity, 'warning');
  assert.equal(isCriticalWarningCode('MISMATCHED_REQUEST'), false);
});

test('critical classification helpers aggregate over structured warnings', () => {
  const warnings: ScheduleWarning[] = [
    createScheduleWarning({ code: 'COVERAGE_SHORTAGE', message: 'a' }),
    createScheduleWarning({ code: 'MISMATCHED_REQUEST', message: 'b' }),
    createScheduleWarning({ code: 'MAX_CONSECUTIVE', message: 'c' }),
  ];
  assert.equal(countCriticalScheduleWarnings(warnings), 2);
  assert.deepEqual(getCriticalScheduleWarnings(warnings).map(w => w.code), ['COVERAGE_SHORTAGE', 'MAX_CONSECUTIVE']);
  assert.equal(hasCriticalScheduleWarning(warnings), true);
  assert.equal(hasCriticalScheduleWarning([warnings[1]]), false);
  assert.equal(isCriticalScheduleWarning(warnings[0]), true);
  assert.equal(isCriticalScheduleWarning(warnings[1]), false);
});

test('warningMessages is the only structured→string direction; dedupe keeps first occurrence', () => {
  const warnings: ScheduleWarning[] = [
    createScheduleWarning({ code: 'COVERAGE_SHORTAGE', message: 'same', day: 1 }),
    createScheduleWarning({ code: 'OVERSTAFFING', message: 'same', day: 2 }),
    createScheduleWarning({ code: 'MANDATORY_REST', message: 'other', day: 3 }),
  ];
  assert.deepEqual(warningMessages(warnings), ['same', 'same', 'other']);
  const deduped = dedupeScheduleWarningsByMessage(warnings);
  assert.deepEqual(warningMessages(deduped), ['same', 'other']);
  // اولین وقوع نگه داشته می‌شود (معادل Array.from(new Set(...)) روی رشته‌ها)
  assert.equal(deduped[0].code, 'COVERAGE_SHORTAGE');
  assert.equal(deduped[0].day, 1);
});

// ============================================================================
// ۲) verifier فرادادهٔ ساخت‌یافته را در کنار پیام فارسیِ دست‌نخورده برمی‌گرداند
// ============================================================================

test('verifyCoverageAndLeaders returns structured warnings parallel to the display strings', () => {
  const result = coverageBattery();
  assert.ok(result.warnings.length > 0);
  assert.equal(result.structuredWarnings.length, result.warnings.length);
  assert.deepEqual(result.warnings, result.structuredWarnings.map(w => w.message));
});

test('coverage shortage warning: day/shift/jobGroup are structural, message unchanged', () => {
  const result = coverageBattery();
  const warning = result.structuredWarnings.find(
    w => w.code === 'COVERAGE_SHORTAGE' && w.day === 7 && w.shift === 'M'
  );
  assert.ok(warning, 'expected a morning coverage shortage on day 7');
  assert.equal(warning.jobGroup, 'nurse');
  assert.equal(warning.severity, 'critical');
  assert.equal(warning.message, 'Coverage Shortage: کمبود نیرو (پرستار) در روز 7 شیفت M');
});

test('missing shift leader warning: day and shift component are structural, message unchanged', () => {
  const result = coverageBattery();
  const evening = result.structuredWarnings.find(
    w => w.code === 'MISSING_SHIFT_LEADER' && w.day === 7 && w.shift === 'E'
  );
  assert.ok(evening, 'expected an evening leader warning on (non-holiday) day 7');
  assert.equal(evening.metadata?.period, 'عصر');
  assert.equal(evening.message, 'Missing Shift Leader: نبود سرشیفت در نوبت عصر روز 7');

  const morning = result.structuredWarnings.find(w => w.code === 'MISSING_SHIFT_LEADER' && w.shift === 'M');
  assert.ok(morning, 'expected a morning leader warning on a holiday');
  assert.ok(morning.day !== undefined && FRIDAYS.includes(morning.day), 'morning leader warnings only occur on holidays');
  assert.equal(morning.metadata?.period, 'صبح');
  assert.equal(morning.message, `Missing Shift Leader: نبود سرشیفت در نوبت صبح روز تعطیل ${morning.day}`);
});

test('mismatched request warning: personnelId and day are structural, message unchanged', () => {
  const nurse = makePerson('n1');
  const requests = [
    makeRequest('n1', {
      id: 'r1', requestType: 'OFF', isEssential: true,
      scope: 'custom_days', selectedDays: [3],
    }),
  ];
  const result = verifyCoverageAndLeaders(
    CAL_YEAR, CAL_MONTH, [nurse], { n1: { 3: 'M' } }, zeroDemandSettings(), {}, undefined, requests
  );
  const warning = result.structuredWarnings.find(w => w.code === 'MISMATCHED_REQUEST');
  assert.ok(warning, 'expected a mismatched request warning');
  assert.equal(warning.personnelId, 'n1');
  assert.equal(warning.day, 3);
  assert.equal(warning.severity, 'warning'); // سیاست دست‌نخورده: بحرانی نیست
  assert.equal(warning.metadata?.requestType, 'OFF');
  assert.equal(warning.message, 'Mismatched Request: برای n1 T در روز 3 درخواست OFF ثبت شده اما شیفت M تخصیص یافته است');
});

test('max consecutive warning: day range and personnelId are structural, message unchanged', () => {
  const nurse = makePerson('n1');
  // MEN (روز۱) + ME (روز۲) = ۶ واحد → نقض سقف ۵
  const result = verifyCoverageAndLeaders(
    CAL_YEAR, CAL_MONTH, [nurse], { n1: { 1: 'MEN', 2: 'ME' } }, zeroDemandSettings(), {}, undefined, []
  );
  const warning = result.structuredWarnings.find(w => w.code === 'MAX_CONSECUTIVE');
  assert.ok(warning, 'expected a max consecutive warning');
  assert.equal(warning.personnelId, 'n1');
  assert.equal(warning.day, 1);
  assert.equal(warning.endDay, 2);
  assert.equal(warning.metadata?.length, 6);
  assert.match(warning.message, /از روز 1 \(M\) تا روز 2 \(E\)/);
});

test('mandatory rest warning: personnelId is structural (no day, exactly like the legacy text)', () => {
  const nurse = makePerson('n1');
  // N (روز۳۰) + MEN (روز۳۱) = ۶ واحد تا انتهای ماه
  const result = verifyCoverageAndLeaders(
    CAL_YEAR, CAL_MONTH, [nurse], { n1: { 30: 'N', 31: 'MEN' } }, zeroDemandSettings(), {}, undefined, []
  );
  const warning = result.structuredWarnings.find(w => w.code === 'MANDATORY_REST');
  assert.ok(warning, 'expected a mandatory rest warning');
  assert.equal(warning.personnelId, 'n1');
  assert.equal(warning.day, undefined);
  assert.equal(warning.severity, 'critical');
});

test('consecutive OFFs warning: day range is structural', () => {
  const result = coverageBattery();
  const warning = result.structuredWarnings.find(w => w.code === 'CONSECUTIVE_OFFS');
  assert.ok(warning, 'expected a consecutive OFFs warning for the all-OFF person');
  assert.equal(warning.personnelId, 'n1');
  assert.equal(warning.day, 1);
  assert.equal(warning.endDay, 31);
  assert.equal(warning.metadata?.length, 31);
  assert.equal(warning.severity, 'warning'); // سیاست دست‌نخورده: بحرانی نیست
});

// ============================================================================
// ۳) طبقه‌بندی بحرانی: کد ساخت‌یافته، نه پیشوندِ متن (سیاست یکسان)
// ============================================================================

test('structured critical classification matches the legacy prefix classification on every produced warning', () => {
  const result = coverageBattery();
  for (const warning of result.structuredWarnings) {
    assert.equal(
      isCriticalScheduleWarning(warning),
      isHardConstraintWarning(warning.message),
      `classification mismatch for ${warning.code}`
    );
    // overload جدید: پذیرش مستقیمِ هشدار ساخت‌یافته نیز باید همان نتیجه را بدهد
    assert.equal(isHardConstraintWarning(warning), isCriticalScheduleWarning(warning));
  }
});

test('changing the display text does not affect machine-level classification', () => {
  const result = coverageBattery();
  const critical = result.structuredWarnings.filter(isCriticalScheduleWarning);
  assert.ok(critical.length > 0);

  // بازنویسی کاملِ متن نمایشیِ همهٔ هشدارها
  const reworded = result.structuredWarnings.map(w => ({ ...w, message: REWORDED_MESSAGE }));
  assert.equal(countCriticalScheduleWarnings(reworded), critical.length);
  assert.deepEqual(
    getCriticalScheduleWarnings(reworded).map(w => w.code),
    critical.map(w => w.code)
  );

  // مسیر legacyِ رشته‌ای همین متنِ بازنویسی‌شده را تشخیص نمی‌دهد؛ این دقیقاً
  // شکنندگیِ مدل قدیمی بود. مسیر structured از آن استقلال دارد.
  const sample = critical[0];
  const rewordedSample = { ...sample, message: REWORDED_MESSAGE };
  assert.equal(isHardConstraintWarning(REWORDED_MESSAGE), false);
  assert.equal(isCriticalScheduleWarning(rewordedSample), true);
  assert.equal(isHardConstraintWarning(rewordedSample), true);
});

// ============================================================================
// ۴) تعمیر هشدار بحرانی: مصرفِ فرادادهٔ ساخت‌یافته بدون تجزیهٔ متن
// ============================================================================

test('repair edit for coverage shortage comes from structured day/shift, even with reworded text', () => {
  const structured = createScheduleWarning({
    code: 'COVERAGE_SHORTAGE',
    message: REWORDED_MESSAGE,
    day: 4,
    shift: 'E',
    jobGroup: 'nurse',
  });
  const schedule = fakeVerifiedSchedule({ a: { 4: 'OFF' }, b: { 4: 'OFF' } }, [structured]);
  const edits = generateCriticalRepairEdits(schedule, REPAIR_CONTEXT);
  assert.deepEqual(edits, [{ personnelId: 'a', day: 4, shift: 'E' }]);

  // و با متنِ متعارفِ فارسی دقیقاً همان ویرایش تولید می‌شود:
  const canonical = { ...structured, message: 'Coverage Shortage: کمبود نیرو (پرستار) در روز 4 شیفت E' };
  const editsCanonical = generateCriticalRepairEdits(
    fakeVerifiedSchedule({ a: { 4: 'OFF' }, b: { 4: 'OFF' } }, [canonical]),
    REPAIR_CONTEXT
  );
  assert.deepEqual(editsCanonical, edits);
});

test('repair edit for overstaffing uses structured day/shift', () => {
  const warning = createScheduleWarning({
    code: 'OVERSTAFFING',
    message: REWORDED_MESSAGE,
    day: 9,
    shift: 'M',
    jobGroup: 'nurse',
  });
  const edits = generateCriticalRepairEdits(
    fakeVerifiedSchedule({ a: { 9: 'M' }, b: { 9: 'OFF' } }, [warning]),
    REPAIR_CONTEXT
  );
  assert.deepEqual(edits, [{ personnelId: 'a', day: 9, shift: 'OFF' }]);
});

test('repair edit for missing shift leader uses structured day/shift (no نوبت parsing)', () => {
  const warning = createScheduleWarning({
    code: 'MISSING_SHIFT_LEADER',
    message: REWORDED_MESSAGE,
    day: 5,
    shift: 'N',
    metadata: { period: 'شب' },
  });
  const edits = generateCriticalRepairEdits(
    fakeVerifiedSchedule({ a: { 5: 'OFF' }, b: { 5: 'OFF' } }, [warning]),
    REPAIR_CONTEXT
  );
  assert.deepEqual(edits, [{ personnelId: 'a', day: 5, shift: 'N' }]);
});

test('[PARITY] legacy quirk kept: holiday-morning leader warnings still produce no repair edit', () => {
  // مسیر regex قدیمی در متن «نوبت صبح روز تعطیل D» هیچ «روز <عدد>» نمی‌یافت و
  // ویرایشی نمی‌ساخت؛ این رفتار در Session 2 عمداً حفظ شده (تغییر سیاست غیرمجاز است).
  const warning = createScheduleWarning({
    code: 'MISSING_SHIFT_LEADER',
    message: 'Missing Shift Leader: نبود سرشیفت در نوبت صبح روز تعطیل 2',
    day: 2,
    shift: 'M',
    metadata: { period: 'صبح', isHoliday: true },
  });
  const edits = generateCriticalRepairEdits(
    fakeVerifiedSchedule({ a: { 2: 'OFF' }, b: { 2: 'OFF' } }, [warning]),
    REPAIR_CONTEXT
  );
  assert.deepEqual(edits, []);
});

test('repair edit for max consecutive uses structured personnelId and day range', () => {
  const warning = createScheduleWarning({
    code: 'MAX_CONSECUTIVE',
    message: REWORDED_MESSAGE,
    personnelId: 'b',
    day: 10,
    endDay: 14,
  });
  const assignments = {
    a: {},
    b: { 10: 'M', 11: 'M', 12: 'M', 13: 'M', 14: 'M' },
  };
  const edits = generateCriticalRepairEdits(fakeVerifiedSchedule(assignments, [warning]), REPAIR_CONTEXT);
  // mid = floor((10+14)/2) = 12 → اولین روزِ غیر OFF از ۱۲ تا ۱۴
  assert.deepEqual(edits, [{ personnelId: 'b', day: 12, shift: 'OFF' }]);
});

test('repair edit for mandatory rest uses structured personnelId (no name search in text)', () => {
  const warning = createScheduleWarning({
    code: 'MANDATORY_REST',
    message: REWORDED_MESSAGE,
    personnelId: 'a',
  });
  const edits = generateCriticalRepairEdits(
    fakeVerifiedSchedule({ a: { 31: 'N' }, b: {} }, [warning]),
    REPAIR_CONTEXT
  );
  assert.deepEqual(edits, [{ personnelId: 'a', day: 31, shift: 'OFF' }]);

  // اگر پرسنل در فهرست پرسنل آزاد نباشد (مثل قفل‌شده‌ها)، همانند مسیر قدیمی ویرایشی ساخته نمی‌شود
  const unknown = createScheduleWarning({ code: 'MANDATORY_REST', message: REWORDED_MESSAGE, personnelId: 'stranger' });
  assert.deepEqual(
    generateCriticalRepairEdits(fakeVerifiedSchedule({ a: {}, b: {} }, [unknown]), REPAIR_CONTEXT),
    []
  );
});

test('repair ignores non-critical codes and warnings without required metadata (no guessing)', () => {
  const nonCritical = createScheduleWarning({
    code: 'MISMATCHED_REQUEST',
    message: REWORDED_MESSAGE,
    day: 5,
    personnelId: 'a',
  });
  const missingMetadata = createScheduleWarning({ code: 'COVERAGE_SHORTAGE', message: REWORDED_MESSAGE });
  const edits = generateCriticalRepairEdits(
    fakeVerifiedSchedule({ a: { 5: 'M' }, b: {} }, [nonCritical, missingMetadata]),
    REPAIR_CONTEXT
  );
  assert.deepEqual(edits, []);
});

// ============================================================================
// ۵) پل سازگاری: فیلتر گروه سناریو روی نمای ساخت‌یافته
// ============================================================================

test('structured scenario-group filter keeps metadata and matches the legacy string filter', () => {
  const assistant = makePerson('a1', { jobGroup: 'assistant' });
  const nurse = makePerson('n1');
  const settings = makeSettings(
    { morningNurse: 1, morningAssistant: 1 },
    { morningNurse: 1, morningAssistant: 1 }
  );
  const result = verifyCoverageAndLeaders(
    CAL_YEAR, CAL_MONTH, [assistant, nurse], {}, settings, {}, undefined, []
  );
  const personnel = [assistant, nurse];

  const legacyFiltered = filterWarningsForScenarioGroup(result.warnings, personnel, 'nurse', new Set<string>());
  const structuredFiltered = filterStructuredWarningsForScenarioGroup(
    result.structuredWarnings, personnel, 'nurse', new Set<string>()
  );

  assert.deepEqual(warningMessages(structuredFiltered), legacyFiltered);
  assert.ok(structuredFiltered.every(w => w.code !== undefined));

  // بدون گروه هدف، همه عبور می‌کنند (مانند نسخهٔ رشته‌ای)
  assert.equal(
    filterStructuredWarningsForScenarioGroup(result.structuredWarnings, personnel).length,
    result.structuredWarnings.length
  );
});

// ============================================================================
// ۶) تابع هدف: شمارش بحرانی از مسیر ساخت‌یافته (سیاست یکسان، بازنماایی جدید)
// ============================================================================

test('evaluateBaselineObjective counts criticals from structured warnings when provided', () => {
  const base: MonthlySchedule = {
    year: CAL_YEAR, month: CAL_MONTH,
    assignments: { a: { 1: 'M' } },
    shiftLeaders: {},
    warnings: [],
  };
  const candidate: MonthlySchedule = { ...base, warnings: [REWORDED_MESSAGE] };
  const structured = [
    createScheduleWarning({ code: 'COVERAGE_SHORTAGE', message: REWORDED_MESSAGE, day: 5, shift: 'M', jobGroup: 'nurse' }),
  ];

  const objective = evaluateBaselineObjective({
    baseline: base,
    candidate,
    warnings: candidate.warnings,
    structuredWarnings: structured,
    targetPersonnelIds: ['a'],
    totalDays: 31,
    lockedRows: [],
    requestSatisfactionPercent: 100,
  });
  assert.equal(objective.criticalWarningCount, 1);
  assert.equal(objective.criticalResolved, false);

  // مسیر legacy (فقط رشته) همان متنِ بازنویسی‌شده را بحرانی نمی‌شناسد — سندِ استقلال
  // مسیر structured از متن نمایشی.
  const legacyObjective = evaluateBaselineObjective({
    baseline: base,
    candidate,
    warnings: candidate.warnings,
    targetPersonnelIds: ['a'],
    totalDays: 31,
    lockedRows: [],
    requestSatisfactionPercent: 100,
  });
  assert.equal(legacyObjective.criticalWarningCount, 0);
});

test('objective: structured counting and string counting agree on real verifier output (no policy change)', () => {
  const result = coverageBattery();
  const schedule: MonthlySchedule = {
    year: CAL_YEAR, month: CAL_MONTH,
    assignments: { n1: {} },
    shiftLeaders: result.shiftLeaders,
    warnings: result.warnings,
  };
  const input = {
    baseline: schedule,
    candidate: schedule,
    warnings: result.warnings,
    targetPersonnelIds: ['n1'],
    totalDays: 31,
    lockedRows: [] as string[],
    requestSatisfactionPercent: 100,
  };
  const legacy = evaluateBaselineObjective(input);
  const structured = evaluateBaselineObjective({ ...input, structuredWarnings: result.structuredWarnings });
  assert.equal(structured.criticalWarningCount, legacy.criticalWarningCount);
  assert.ok(structured.criticalWarningCount > 0, 'battery should contain critical warnings');
});
