/**
 * Unit Tests — Roster Inheritance (Domain Layer)
 *
 * Run: tsx --test tests/domain/roster-inheritance.test.ts
 *
 * قرارداد معماری «برنامهٔ مبنا = تنها منبع حقیقت»:
 *  ۱) ردیف پرسنل قفل‌شده همیشه به‌صورت زنده از برنامهٔ مبنا ارث‌بری می‌شود
 *     (بدون نسخهٔ مستقل از داده).
 *  ۲) Diff/Patch فقط تغییرهای سناریو نسبت به مبنا را نشان می‌دهد.
 *  ۳) در Merge، تغییر پرسنل قفل‌شده رد و تغییر پرسنل آزاد اعمال می‌شود و
 *     ردیف‌های خارج از گروه هدف دست‌نخورده می‌مانند.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeScenarioMerge,
  diffAgainstBaseRoster,
  inheritLockedRowsFromBase,
  overlayLockedInheritance,
  partitionDiffByLocks,
} from '../../domain/scheduling/roster-inheritance';
import type { MonthlySchedule, Personnel } from '../../lib/types';

function createPersonnel(id: string, jobGroup: 'nurse' | 'assistant', active = true): Personnel {
  return {
    id,
    firstName: 'نام',
    lastName: `خانوادگی-${id}`,
    personalCode: id,
    jobGroup,
    position: 'general',
    employmentType: 'official',
    experienceYears: 2,
    active,
    canBeShiftLeader: false,
  };
}

const personnel: Personnel[] = [
  createPersonnel('n1', 'nurse'),
  createPersonnel('n2', 'nurse'),
  createPersonnel('a1', 'assistant'),
  createPersonnel('a2', 'assistant'),
];

const baseSchedule: MonthlySchedule = {
  year: 1404,
  month: 5,
  assignments: {
    n1: { 1: 'M', 2: 'M', 3: 'E' },
    n2: { 1: 'E', 2: 'N', 3: 'N' },
    a1: { 1: 'M', 2: 'M', 3: 'OFF' },
    a2: { 1: 'N', 2: 'OFF', 3: 'OFF' },
  },
  shiftLeaders: {},
  warnings: [],
};

const TOTAL_DAYS = 3;

// ============================================================================
// inheritLockedRowsFromBase
// ============================================================================

test('inheritLockedRowsFromBase: فقط ردیف قفل‌شده — دقیقاً از برنامهٔ مبنا', () => {
  const inherited = inheritLockedRowsFromBase(baseSchedule.assignments, ['n1']);
  assert.deepEqual(Object.keys(inherited), ['n1']);
  assert.deepEqual(inherited.n1, { 1: 'M', 2: 'M', 3: 'E' });
});

test('inheritLockedRowsFromBase: ردیفی که در مبنا نیست در خروجی نمی‌آید', () => {
  const inherited = inheritLockedRowsFromBase(baseSchedule.assignments, ['ghost']);
  assert.deepEqual(inherited, {});
});

test('inheritLockedRowsFromBase: خروجی نسخهٔ مستقل است و ورودی را تغییر نمی‌دهد', () => {
  const inherited = inheritLockedRowsFromBase(baseSchedule.assignments, ['n1']);
  inherited.n1[1] = 'N';
  assert.equal(baseSchedule.assignments.n1[1], 'M');
});

// ============================================================================
// overlayLockedInheritance
// ============================================================================

test('overlayLockedInheritance: ردیف قفل‌شده از مبنا می‌آید نه از سناریو', () => {
  const scenarioAssignments = {
    n1: { 1: 'N', 2: 'N', 3: 'N' }, // سناریو چیز دیگری برای n1 ساخته
    n2: { 1: 'OFF', 2: 'OFF', 3: 'M' },
  };
  const view = overlayLockedInheritance(scenarioAssignments, baseSchedule.assignments, ['n1']);
  // n1 قفل است پس دقیقاً ردیف مبنا نمایش داده می شود
  assert.deepEqual(view.n1, { 1: 'M', 2: 'M', 3: 'E' });
  // n2 آزاد است پس پیشنهاد سناریو دیده می‌شود
  assert.deepEqual(view.n2, { 1: 'OFF', 2: 'OFF', 3: 'M' });
});

test('overlayLockedInheritance: بدون مبنا یا بدون قفل، تخصیص‌های خود سناریو برمی‌گردد', () => {
  const scenarioAssignments = { n1: { 1: 'N' } };
  assert.deepEqual(overlayLockedInheritance(scenarioAssignments, null, ['n1']), scenarioAssignments);
  assert.deepEqual(overlayLockedInheritance(scenarioAssignments, baseSchedule.assignments, []), scenarioAssignments);
});

test('overlayLockedInheritance: ورودی‌ها را تغییر نمی‌دهد', () => {
  const scenarioAssignments = { n1: { 1: 'N' } };
  const scenarioSnapshot = JSON.stringify(scenarioAssignments);
  overlayLockedInheritance(scenarioAssignments, baseSchedule.assignments, ['n1']);
  assert.equal(JSON.stringify(scenarioAssignments), scenarioSnapshot);
});

// ============================================================================
// diffAgainstBaseRoster
// ============================================================================

test('diffAgainstBaseRoster: تغییرهای سطح‌سلول به‌ترتیب قطعی برمی‌گردند', () => {
  const candidate = {
    n1: { 1: 'M', 2: 'E', 3: 'E' }, // روز ۲ تغییر کرده
    n2: { 1: 'E', 2: 'N', 3: 'OFF' }, // روز ۳ تغییر کرده
  };
  const diff = diffAgainstBaseRoster(baseSchedule.assignments, candidate, {
    totalDays: TOTAL_DAYS,
    scopePersonnelIds: ['n1', 'n2'],
  });
  assert.deepEqual(diff, [
    { personnelId: 'n1', day: 2, fromShift: 'M', toShift: 'E' },
    { personnelId: 'n2', day: 3, fromShift: 'N', toShift: 'OFF' },
  ]);
});

test('diffAgainstBaseRoster: سلول غایب در یکی از دو طرف با OFF مقایسه می‌شود', () => {
  const candidate = { n1: { 1: 'M' } };
  const diff = diffAgainstBaseRoster(baseSchedule.assignments, candidate, {
    totalDays: TOTAL_DAYS,
    scopePersonnelIds: ['n1'],
  });
  assert.deepEqual(diff, [
    { personnelId: 'n1', day: 2, fromShift: 'M', toShift: 'OFF' },
    { personnelId: 'n1', day: 3, fromShift: 'E', toShift: 'OFF' },
  ]);
});

// ============================================================================
// partitionDiffByLocks
// ============================================================================

test('partitionDiffByLocks: تغییرهای پرسنل قفل‌شده رد می‌شوند', () => {
  const { applicable, rejected } = partitionDiffByLocks(
    [
      { personnelId: 'n1', day: 1, fromShift: 'M', toShift: 'N' },
      { personnelId: 'n2', day: 1, fromShift: 'E', toShift: 'N' },
    ],
    ['n1']
  );
  assert.deepEqual(applicable, [{ personnelId: 'n2', day: 1, fromShift: 'E', toShift: 'N' }]);
  assert.deepEqual(rejected, [{ personnelId: 'n1', day: 1, fromShift: 'M', toShift: 'N' }]);
});

// ============================================================================
// computeScenarioMerge — قرارداد Merge مرجع‌محور (بخش ۵)
// ============================================================================

test('computeScenarioMerge: فقط Diff پرسنل آزاد اعمال می‌شود و قفل‌شده رد می‌گردد', () => {
  const candidate: Pick<MonthlySchedule, 'assignments'> = {
    assignments: {
      n1: { 1: 'N', 2: 'N', 3: 'N' }, // تغییر n1 (قفل)
      n2: { 1: 'M', 2: 'E', 3: 'E' }, // تغییر n2 (آزاد)
      a1: { 1: 'E', 2: 'E', 3: 'E' }, // گروه assistant — خارج از دامنه
      a2: { 1: 'N', 2: 'OFF', 3: 'OFF' },
    },
  };

  const merge = computeScenarioMerge(baseSchedule, candidate, {
    lockedRows: ['n1'],
    personnelList: personnel,
    jobGroup: 'nurse',
    totalDays: TOTAL_DAYS,
  });

  // n1: دقیقاً مانند مبنا باقی می‌ماند (تغییرهای سناریو رد شدند)
  assert.deepEqual(merge.assignments.n1, { 1: 'M', 2: 'M', 3: 'E' });
  // n2: تغییرهای سناریو اعمال شدند
  assert.deepEqual(merge.assignments.n2, { 1: 'M', 2: 'E', 3: 'E' });
  // a1: گروه دیگر — خارج از دامنهٔ Merge — دست‌نخورده می‌ماند
  assert.deepEqual(merge.assignments.a1, baseSchedule.assignments.a1);
  assert.deepEqual(merge.assignments.a2, baseSchedule.assignments.a2);

  // گزارش کاربرد/رد
  assert.equal(merge.appliedChanges.length, 3);
  assert.equal(merge.rejectedChanges.length, 3);
  assert.ok(merge.rejectedChanges.every(change => change.personnelId === 'n1'));
  assert.ok(merge.appliedChanges.every(change => change.personnelId === 'n2'));
});

test('computeScenarioMerge: ورودی‌ها را تغییر نمی‌دهد (immutability)', () => {
  const baseSnapshot = JSON.stringify(baseSchedule);
  const candidate = { assignments: { n2: { 1: 'M', 2: 'M', 3: 'M' } } };
  computeScenarioMerge(baseSchedule, candidate, {
    lockedRows: [],
    personnelList: personnel,
    jobGroup: 'nurse',
    totalDays: TOTAL_DAYS,
  });
  assert.equal(JSON.stringify(baseSchedule), baseSnapshot);
});

test('computeScenarioMerge: بدون گروه هدف، Diff روی همهٔ ردیف‌های مشترک اعمال می‌شود', () => {
  const candidate: Pick<MonthlySchedule, 'assignments'> = {
    assignments: {
      n2: { 1: 'OFF', 2: 'OFF', 3: 'OFF' },
      a1: { 1: 'OFF', 2: 'OFF', 3: 'OFF' },
    },
  };
  const merge = computeScenarioMerge(baseSchedule, candidate, {
    lockedRows: [],
    personnelList: personnel,
    totalDays: TOTAL_DAYS,
  });
  assert.deepEqual(merge.assignments.n2, { 1: 'OFF', 2: 'OFF', 3: 'OFF' });
  assert.deepEqual(merge.assignments.a1, { 1: 'OFF', 2: 'OFF', 3: 'OFF' });
  // ردیف‌هایی که در سناریو تغییر نکرده‌اند همان مبنا می‌مانند
  assert.deepEqual(merge.assignments.n1, baseSchedule.assignments.n1);
});
