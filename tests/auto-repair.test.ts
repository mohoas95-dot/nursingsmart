/**
 * Unit Tests — AutoRepair & Human Veto (lib/autoRepair.ts) — Phase 5
 *
 * Run: tsx --test tests/auto-repair.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoRepairAfterEdit,
  evaluateForcedShiftSafety,
  handleManualOverride,
  attachCriticalWarnings,
} from '../lib/autoRepair';
import type { Personnel, ShiftRequest, SystemSettings, ShiftType, MonthlySchedule } from '../lib/types';

// ============================================================================
// Fixtures
// ============================================================================

function nurse(id: string): Personnel {
  return {
    id,
    firstName: 'N',
    lastName: id,
    personalCode: id,
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'official',
    experienceYears: 3,
    active: true,
    canBeShiftLeader: false,
  };
}

function assistant(id: string): Personnel {
  return { ...nurse(id), jobGroup: 'assistant' };
}

/** تقاضا: فقط صبح پرستار = demand (سایر نوبت‌ها صفر). */
function settingsNurseMorning(demand = 1): SystemSettings {
  const d = {
    morningNurse: demand,
    morningAssistant: 0,
    afternoonNurse: 0,
    afternoonAssistant: 0,
    afternoonLeader: 0,
    nightNurse: 0,
    nightAssistant: 0,
    nightLeader: 0,
  };
  return {
    dutyHours: { official: 160, contract: 170, conscript: 180, overtime: 0 },
    demand: { weekday: { ...d }, holiday: { ...d } },
  };
}

function offRequest(id: string, personnelId: string): ShiftRequest {
  return { id, personnelId, requestType: 'OFF', isEssential: true, scope: 'all' };
}

// ============================================================================
// Task 1 — Localized Auto-Repair
// ============================================================================

test('autoRepair: no shortage → no repairs', () => {
  const personnel = [nurse('A'), nurse('B')];
  // A روی M (پوشش کامل)، B روی M (مازاد).
  const assignments = { A: { 1: 'M' }, B: { 1: 'M' } };
  const res = autoRepairAfterEdit(assignments, { personnelId: 'A', day: 1, newShift: 'M' }, {
    personnel,
    settings: settingsNurseMorning(1),
    totalDays: 1,
  });
  assert.equal(res.repairs.length, 0);
});

test('autoRepair: fills a morning shortage with a one-hop swap from an OFF nurse', () => {
  const personnel = [nurse('A'), nurse('B')];
  // A اجباراً به E رفت → صبح (demand 1) خالی ماند؛ B در استراحت.
  const assignments = { A: { 1: 'E' }, B: { 1: 'OFF' } };
  const res = autoRepairAfterEdit(assignments, { personnelId: 'A', day: 1, newShift: 'E' }, {
    personnel,
    settings: settingsNurseMorning(1),
    totalDays: 1,
  });
  assert.equal(res.repairs.length, 1);
  assert.equal(res.repairs[0].personnelId, 'B');
  assert.equal(res.repairs[0].fromShift, 'OFF');
  assert.equal(res.repairs[0].toShift, 'M');
  assert.equal(res.assignments.B[1], 'M');
  assert.equal(res.assignments.A[1], 'E'); // سلول ویرایش‌شده دست‌نخورده می‌ماند.
});

test('autoRepair: respects locked rows (no donor available)', () => {
  const personnel = [nurse('A'), nurse('B')];
  const assignments = { A: { 1: 'E' }, B: { 1: 'OFF' } };
  const res = autoRepairAfterEdit(assignments, { personnelId: 'A', day: 1, newShift: 'E' }, {
    personnel,
    settings: settingsNurseMorning(1),
    totalDays: 1,
    lockedRows: ['B'],
  });
  assert.equal(res.repairs.length, 0); // B قفل است → نمی‌توان جابه‌جا کرد.
  assert.equal(res.assignments.B[1], 'OFF');
});

test('autoRepair: respects hard OFF/leave requests (donor excluded)', () => {
  const personnel = [nurse('A'), nurse('B')];
  const assignments = { A: { 1: 'E' }, B: { 1: 'OFF' } };
  const res = autoRepairAfterEdit(assignments, { personnelId: 'A', day: 1, newShift: 'E' }, {
    personnel,
    settings: settingsNurseMorning(1),
    totalDays: 1,
    requests: [offRequest('r1', 'B')],
  });
  assert.equal(res.repairs.length, 0); // B درخواست آف دارد → نباید جابه‌جا شود.
});

test('autoRepair: job-group aware (assistant cannot fill a nurse shortage)', () => {
  const personnel = [nurse('A'), assistant('B')];
  const assignments = { A: { 1: 'E' }, B: { 1: 'OFF' } };
  const res = autoRepairAfterEdit(assignments, { personnelId: 'A', day: 1, newShift: 'E' }, {
    personnel,
    settings: settingsNurseMorning(1),
    totalDays: 1,
  });
  assert.equal(res.repairs.length, 0); // B کمک‌بهیار است؛ کمبود پرستار را پوشش نمی‌دهد.
});

test('autoRepair: does not cascade (OFF donor creates no new shortage)', () => {
  const personnel = [nurse('A'), nurse('B'), nurse('C')];
  // A به E، B و C در استراحت. کمبود صبح → یکی از B/C پر می‌شود، دومی در استراحت می‌ماند.
  const assignments = { A: { 1: 'E' }, B: { 1: 'OFF' }, C: { 1: 'OFF' } };
  const res = autoRepairAfterEdit(assignments, { personnelId: 'A', day: 1, newShift: 'E' }, {
    personnel,
    settings: settingsNurseMorning(1),
    totalDays: 1,
  });
  assert.equal(res.repairs.length, 1); // فقط یک تعویض یک‌گامیه؛ بدون cascade.
});

test('autoRepair: respects maxSwaps limit', () => {
  const personnel = [nurse('A'), nurse('B')];
  const assignments = { A: { 1: 'E' }, B: { 1: 'OFF' } };
  const res = autoRepairAfterEdit(assignments, { personnelId: 'A', day: 1, newShift: 'E' }, {
    personnel,
    settings: settingsNurseMorning(1),
    totalDays: 1,
    maxSwaps: 0,
  });
  assert.equal(res.repairs.length, 0);
});

test('autoRepair: does not mutate the input assignments', () => {
  const personnel = [nurse('A'), nurse('B')];
  const assignments = { A: { 1: 'E' }, B: { 1: 'OFF' } };
  const snapshot = JSON.stringify(assignments);
  autoRepairAfterEdit(assignments, { personnelId: 'A', day: 1, newShift: 'E' }, {
    personnel,
    settings: settingsNurseMorning(1),
    totalDays: 1,
  });
  assert.equal(JSON.stringify(assignments), snapshot);
});

// ============================================================================
// Task 2 — Human Veto Override (never blocks)
// ============================================================================

test('veto: night shift followed by working day → sleep_off critical, but allowed', () => {
  const personnel = [nurse('A')];
  const current = { A: { 2: 'M' } }; // روز بعد کاری است.
  const res = evaluateForcedShiftSafety(current, { personnelId: 'A', day: 1, newShift: 'N' }, {
    personnel,
    settings: settingsNurseMorning(0),
    totalDays: 2,
  });
  assert.equal(res.allowed, true); // هرگز مسدود نمی‌شود.
  assert.ok(res.criticalWarnings.some((w) => w.rule === 'sleep_off'));
  assert.ok(res.criticalWarnings.every((w) => w.severity === 'critical'));
});

test('veto: forced shift pushing chain over 32h → cumulative_32h critical', () => {
  const personnel = [nurse('A')];
  const current = { A: { 1: 'MEN', 2: 'E' } }; // 25.5 + 6.5 = 32
  const res = evaluateForcedShiftSafety(current, { personnelId: 'A', day: 3, newShift: 'M' }, {
    personnel,
    settings: settingsNurseMorning(0),
    totalDays: 3,
  });
  assert.equal(res.allowed, true);
  assert.ok(res.criticalWarnings.some((w) => w.rule === 'cumulative_32h'));
});

test('veto: safe forced shift → no critical warnings', () => {
  const personnel = [nurse('A')];
  const current = {};
  const res = evaluateForcedShiftSafety(current, { personnelId: 'A', day: 1, newShift: 'M' }, {
    personnel,
    settings: settingsNurseMorning(0),
    totalDays: 1,
  });
  assert.equal(res.allowed, true);
  assert.equal(res.criticalWarnings.length, 0);
});

test('veto: forcing a person out of a minimum-staffed slot → min_staffing critical', () => {
  // تنها پرستار صبح (demand 1) را اجباراً به عصر می‌بریم.
  const personnel = [nurse('A')];
  const current = { A: { 1: 'M' } };
  const res = evaluateForcedShiftSafety(current, { personnelId: 'A', day: 1, newShift: 'E' }, {
    personnel,
    settings: settingsNurseMorning(1),
    totalDays: 1,
  });
  assert.equal(res.allowed, true);
  assert.ok(res.criticalWarnings.some((w) => w.rule === 'min_staffing'));
});

test('veto: never blocks even with multiple simultaneous violations', () => {
  const personnel = [nurse('A')];
  // شب در روز ۱، روز ۲ کاری (sleep_off) + زنجیرهٔ سنگین (cumulative).
  const current = { A: { 1: 'MEN', 2: 'M' } };
  const res = evaluateForcedShiftSafety(current, { personnelId: 'A', day: 3, newShift: 'N' }, {
    personnel,
    settings: settingsNurseMorning(0),
    totalDays: 3,
  });
  assert.equal(res.allowed, true);
  assert.ok(res.criticalWarnings.length >= 1);
});

// ============================================================================
// Combined override + repair
// ============================================================================

test('handleManualOverride: applies edit, repairs staffing, and returns veto warnings', () => {
  const personnel = [nurse('A'), nurse('B')];
  const current = { A: { 1: 'M' }, B: { 1: 'OFF' } };
  const res = handleManualOverride(current, { personnelId: 'A', day: 1, newShift: 'E' }, {
    personnel,
    settings: settingsNurseMorning(1),
    totalDays: 1,
  });
  assert.equal(res.assignments.A[1], 'E'); // ویرایش اعمال شد.
  assert.equal(res.assignments.B[1], 'M'); // تعمیر: B صبح را پوشش داد.
  assert.equal(res.repairs.length, 1);
  // وتو: خروج A از نوبت صبح → هشدار بحرانی حداقل‌نیرو (تا قبل از تعمیر).
  assert.ok(res.criticalWarnings.some((w) => w.rule === 'min_staffing'));
});

// ============================================================================
// attachCriticalWarnings
// ============================================================================

test('attachCriticalWarnings: attaches and dedupes on the schedule', () => {
  const schedule: MonthlySchedule = {
    year: 1405,
    month: 3,
    assignments: {},
    shiftLeaders: {},
    warnings: [],
  };
  const w = {
    rule: 'sleep_off' as const,
    personnelId: 'A',
    day: 1,
    severity: 'critical' as const,
    message: 'msg-1',
  };
  const once = attachCriticalWarnings(schedule, [w]);
  assert.deepEqual(once.criticalWarnings, ['msg-1']);
  // تکرار پیام جدیدی اضافه نمی‌کند.
  const twice = attachCriticalWarnings(once, [w]);
  assert.deepEqual(twice.criticalWarnings, ['msg-1']);
  // ورودی خالی → برنامهٔ اصلی دست‌نخورده برمی‌گردد.
  assert.equal(attachCriticalWarnings(schedule, []), schedule);
});
