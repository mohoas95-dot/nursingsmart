/**
 * Integration Tests — mergeScenarioProposalFacade
 *
 * Run: tsx --test tests/scenario-merge-facade.test.ts
 *
 * جریان کامل بخش ۵ معماری برنامهٔ مبنا:
 *  Diff/Patch نسبت به مبنا → رد قفل‌ها / اعمال آزادها → محاسبهٔ مجدد
 *  Constraintها (verifier) → بازتولید هشدار با قرارداد سطح‌بندی → ماندگاری.
 *  همهٔ انتزاعاتِ جانبی (verifier، persistence) تزریق می‌شوند تا رفتار
 *  مرزهای Facade دقیقاً و قطعی سنجیده شود.
 *
 * نکتهٔ طراحی داده‌های تست:
 *  Facade پس از Merge همواره reconcileStaffingCoverage را روی کل تقویم ماه
 *  (۳۱ روز مرداد ۱۴۰۴) اجرا می‌کند؛ پس تقاضای weekday/holiday طوری تنظیم شده
 *  که با تخصیص‌های پس از Merge دقیقاً برابر باشد تا Reconcile «همانی» عمل کند
 *  (نه چیزی کم کند نه چیزی اضافه کند). Diff سناریو نیز به‌صورت «جابه‌جایی
 *  شیفت بین دو نفر آزاد» طراحی شده تا آمار روزانه پوشش تغییر نکند. این‌جور می‌شود
 *  رفتار Merge را جدا از منطق جبران کمبود/مازاد سنجید — بدون آن‌که هیچ‌کدام از
 *  قوانین موجود تغییر کنند.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeScenarioProposalFacade } from '../features/scheduling/facades/shift-write-facade';
import type { MonthlySchedule, Personnel, ShiftRequest, ShiftType, SystemSettings } from '../lib/types';

// ============================================================================
// Fixtures — داده‌های قطعی تست
// ============================================================================

const TOTAL_DAYS = 31; // مرداد ۱۴۰۴ → ۳۱ روز

function person(id: string, jobGroup: 'nurse' | 'assistant'): Personnel {
  return {
    id,
    firstName: id,
    lastName: 'خانواده',
    personalCode: id,
    jobGroup,
    position: jobGroup === 'nurse' ? 'general' : 'none',
    employmentType: 'official',
    experienceYears: 2,
    active: true,
    canBeShiftLeader: false,
  };
}

const personnel: Personnel[] = [
  person('n1', 'nurse'), // ← قفل‌شده
  person('n2', 'nurse'), // ← آزاد
  person('n3', 'nurse'), // ← آزاد
  person('a1', 'assistant'), // ← گروه دیگر (خارج از دامنهٔ Merge)
];

/**
 * ساخت یک ردیف کامل ماه: همهٔ روزها با شیفت پیش‌فرض، به‌جز روزهایی که در
 * overrides آمده است.
 */
function monthRow(defaultShift: ShiftType, overrides: Record<number, ShiftType> = {}): Record<number, ShiftType> {
  const row: Record<number, ShiftType> = {};
  for (let day = 1; day <= TOTAL_DAYS; day++) {
    row[day] = overrides[day] ?? defaultShift;
  }
  return row;
}

/**
 * تقاضا طوری است که پس از Merge، برای هر روز (چه weekday چه جمعه/تعطیل):
 *   M = 2 پرستار (n1 + یکی از n2/n3) · E = 1 پرستار · N = صفر
 * دقیقاً مطابق تخصیص‌ها است؛ پس Reconcile هیچ تغییری نمی‌دهد (Identity).
 */
const settings: SystemSettings = {
  dutyHours: { official: 160, contract: 174, conscript: 180, overtime: 0 },
  demand: {
    weekday: {
      morningNurse: 2, morningAssistant: 0, afternoonNurse: 1, afternoonAssistant: 0,
      afternoonLeader: 0, nightNurse: 0, nightAssistant: 0, nightLeader: 0,
    },
    holiday: {
      morningNurse: 2, morningAssistant: 0, afternoonNurse: 1, afternoonAssistant: 0,
      afternoonLeader: 0, nightNurse: 0, nightAssistant: 0, nightLeader: 0,
    },
  },
};

const baseRoster: MonthlySchedule = {
  year: 1404,
  month: 5,
  assignments: {
    n1: monthRow('M'),
    n2: monthRow('M'),
    n3: monthRow('E'),
    a1: monthRow('N'),
  },
  shiftLeaders: {},
  warnings: ['Mismatched Request: برای n1 خانواده در روز 2 درخواست OFF ثبت شده اما شیفت M تخصیص یافته است'],
  dismissedWarnings: [],
  lockedRows: ['n1'],
};

type Verifier = (
  year: number,
  month: number,
  personnel: ReadonlyArray<Personnel>,
  assignments: Record<string, Record<number, string>>,
  settings: SystemSettings,
  holidays: Readonly<Record<number, string>>,
  firstDayOfWeek: number | undefined,
  requests: ReadonlyArray<ShiftRequest>
) => { shiftLeaders: Record<number, Record<string, string | undefined>>; warnings: string[] };

function buildVerifier(warnings: () => string[], onCall?: (assignments: Record<string, Record<number, string>>) => void): Verifier {
  return (year, month, personnelList, assignments, _settings, _holidays, _firstDayOfWeek, _requests) => {
    void year; void month; void personnelList; void _settings; void _holidays; void _firstDayOfWeek; void _requests;
    onCall?.(assignments);
    return { shiftLeaders: {}, warnings: warnings() };
  };
}

// ============================================================================
// Tests
// ============================================================================

test('mergeScenarioProposalFacade: Diff فقط پرسنل آزاد اعمال، هشدار B/C قفل‌شده ثبت نمی‌شود و A باقی می‌ماند', async () => {
  // سناریو نسبت به مبنا فقط در روزهای ۱ و ۲ تفاوت دارد (دامنهٔ Diff = totalDays):
  //   · n1 (قفل): M→N     → باید «رد» شود
  //   · n2 (آزاد): M→E    → باید «اعمال» شود
  //   · n3 (آزاد): E→M    → باید «اعمال» شود (جابه‌جایی با n2 تا پوشش روزانه ثابت بماند)
  //   · a1 (گروه دیگر): N→E → خارج از دامنهٔ Merge؛ ردیف مبنا باید محفوظ بماند
  const candidateAssignments: Record<string, Record<number, ShiftType>> = {
    n1: monthRow('M', { 1: 'N', 2: 'N' }),
    n2: monthRow('M', { 1: 'E', 2: 'E' }),
    n3: monthRow('E', { 1: 'M', 2: 'M' }),
    a1: monthRow('E'),
  };

  let persistedSchedule: MonthlySchedule | null = null;
  const verifierCalls: Array<Record<string, Record<number, string>>> = [];

  const result = await mergeScenarioProposalFacade(
    {
      jobGroup: 'nurse',
      year: 1404,
      month: 5,
      personnel,
      requests: [],
      settings,
      holidays: {},
      firstDayOfWeek: undefined,
      totalDays: 2,
      currentSchedule: baseRoster,
      candidateAssignments,
      lockState: {
        finalizedNursesMonths: [],
        finalizedAssistantsMonths: [],
        lockedRows: ['n1'],
      },
      dismissedWarnings: [],
    },
    buildVerifier(() => [
      // هشدار B متعلق به n1 (قفل) → نباید در خروجی بیاید
      'Mismatched Request: برای n1 خانواده در روز 2 درخواست OFF ثبت شده اما شیفت M تخصیص یافته است',
      // هشدار A عمومی → همیشه باید بماند
      'Coverage Shortage: کمبود نیرو (پرستار) در روز 1 شیفت E',
    ], assignments => verifierCalls.push(assignments)),
    {
      saveSchedule: async (schedule) => {
        persistedSchedule = schedule as MonthlySchedule;
      },
    },
    'dept-1'
  );

  assert.equal(result.success, true, result.error);
  assert.ok(result.schedule);

  // ۱) رد تغییر قفل‌شده + اعمال تغییرهای آزاد + حفظ گروه دیگر
  assert.deepEqual(result.schedule!.assignments.n1, monthRow('M'), 'ردیف قفل‌شده باید دقیقاً مبنا بماند');
  assert.deepEqual(result.schedule!.assignments.n2, monthRow('M', { 1: 'E', 2: 'E' }), 'تغییر نفر آزاد (n2) اعمال می‌شود');
  assert.deepEqual(result.schedule!.assignments.n3, monthRow('E', { 1: 'M', 2: 'M' }), 'تغییر نفر آزاد (n3) اعمال می‌شود');
  assert.deepEqual(result.schedule!.assignments.a1, monthRow('N'), 'گروه دیگر دقیقاً همان‌طور که در مبناست می‌ماند');

  // ۲) گزارش Merge: ۴ تغییر اعمال‌شده (۲ روز × ۲ نفر آزاد) و ۲ تغییر ردشده (n1)
  assert.equal(result.appliedChanges!.length, 4);
  assert.ok(result.appliedChanges!.every(c => c.personnelId === 'n2' || c.personnelId === 'n3'));
  assert.equal(result.rejectedChanges!.length, 2);
  assert.ok(result.rejectedChanges!.every(c => c.personnelId === 'n1'));

  // ۳) هشدارهای دوباره‌محاسبه‌شده: B/C قفل‌شده بدون اثر در خروجی، A همیشه باقی
  assert.deepEqual(result.schedule!.warnings, ['Coverage Shortage: کمبود نیرو (پرستار) در روز 1 شیفت E']);

  // ۴) ماندگاری برنامهٔ مبنای جدید انجام شده و قفل‌های ماهانه زنده مانده‌اند
  assert.ok(persistedSchedule);
  assert.deepEqual((persistedSchedule as MonthlySchedule).lockedRows, ['n1']);
  assert.equal((persistedSchedule as MonthlySchedule).finalized, false);

  // ۵) محاسبهٔ مجدد Constraintها روی merge ادغام‌شده انجام شد و ورودی verifier
  //    دقیقاً همان تخصیص‌های پس از Merge بوده است (نه مبنای خام، نه سناریوی خام)
  assert.ok(verifierCalls.length >= 1);
  const verified = verifierCalls[verifierCalls.length - 1];
  assert.equal(verified.n1[1], 'M', 'ورودی verifier برای نفر قفل‌شده باید مبنا باشد');
  assert.equal(verified.n2[1], 'E', 'ورودی verifier برای نفر آزاد باید مقدار سناریو باشد');
});

test('mergeScenarioProposalFacade: بدون برنامهٔ مبنا (اولین انتخاب)، سناریو پایهٔ اولیه است و قفل‌ها همچنان محفوظ می‌مانند', async () => {
  const candidateAssignments: Record<string, Record<number, ShiftType>> = {
    n1: monthRow('M'),
    n2: monthRow('M', { 1: 'E', 2: 'N' }),
  };

  let persistedSchedule: MonthlySchedule | null = null;

  const result = await mergeScenarioProposalFacade(
    {
      jobGroup: 'nurse',
      year: 1404,
      month: 5,
      personnel,
      requests: [],
      settings,
      holidays: {},
      firstDayOfWeek: undefined,
      totalDays: 2,
      currentSchedule: null,
      candidateAssignments,
      lockState: { finalizedNursesMonths: [], finalizedAssistantsMonths: [], lockedRows: [] },
    },
    buildVerifier(() => []),
    {
      saveSchedule: async (schedule) => {
        persistedSchedule = schedule as MonthlySchedule;
      },
    },
    'dept-1'
  );

  assert.equal(result.success, true, result.error);
  assert.ok(result.schedule);
  assert.ok(persistedSchedule, 'برنامهٔ مبنای اولیه باید ماندگار شود');
  assert.ok(result.schedule.assignments.n1, 'ردیف پرسنل گروه هدف باید ساخته شود');
  assert.ok(result.schedule.assignments.n2, 'ردیف پرسنل گروه هدف باید ساخته شود');
  assert.deepEqual(result.rejectedChanges, [], 'بدون قفل، هیچ تغییری رد نمی‌شود');
});

test('mergeScenarioProposalFacade: در صورت خطای verifier، نتیجهٔ ناموفق با پیام خطا برمی‌گردد و مبنا ذخیره نمی‌شود', async () => {
  let saveCalled = false;

  const result = await mergeScenarioProposalFacade(
    {
      jobGroup: 'nurse',
      year: 1404,
      month: 5,
      personnel,
      requests: [],
      settings,
      holidays: {},
      firstDayOfWeek: undefined,
      totalDays: 2,
      currentSchedule: baseRoster,
      candidateAssignments: baseRoster.assignments,
      lockState: { finalizedNursesMonths: [], finalizedAssistantsMonths: [], lockedRows: ['n1'] },
    },
    () => {
      throw new Error('verifier exploded');
    },
    {
      saveSchedule: async () => {
        saveCalled = true;
      },
    },
    'dept-1'
  );

  assert.equal(result.success, false);
  assert.equal(result.schedule, null);
  assert.ok(result.error?.includes('verifier exploded'));
  assert.equal(saveCalled, false, 'در صورت خطا نباید چیزی ماندگار شود');
});
