// lib/safetyConstraints.test.ts
// اجرا با:  bun run lib/safetyConstraints.test.ts
// تست‌های ساده برای تایید منطق هر قانون ایمنی

import {
  checkCumulative32HourRule,
  checkSleepOffAfterNight,
  checkAntiSingleShiftRule,
  classifyLeaves,
  checkPersonnelSafety,
  summarizeScheduleSafety,
  checkScheduleSafety,
} from './safetyConstraints';
import type {
  SafetyViolation,
  MandatoryOff,
  SingleShiftFlag,
  LeaveClassification,
} from './safetyConstraints';
import type { Personnel, MonthlySchedule, ShiftRequest } from './types';

// ============================================================================
// Test utilities
// ============================================================================

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✅  ${label}`);
    passed++;
  } else {
    console.error(`  ❌  ${label}`);
    failed++;
  }
}

function describe(title: string, fn: () => void): void {
  console.log(`\n▶ ${title}`);
  fn();
}

// ============================================================================
// Fixtures
// ============================================================================

const mockPersonnel: Personnel = {
  id: 'p1',
  firstName: 'علی',
  lastName: 'رضایی',
  personalCode: '1234',
  jobGroup: 'nurse',
  position: 'staff',
  employmentType: 'official',
  experienceYears: 5,
  active: true,
  canBeShiftLeader: false,
};

// ============================================================================
// Rule 1: 32-Hour Cumulative
// ============================================================================

describe('Rule 1 — Cumulative 32-Hour', () => {
  // Day 1: MEN=24h, Day 2: MN=16h → total 40h → violation
  const assignments: Record<number, string> = { 1: 'MEN', 2: 'MN', 3: 'OFF' };
  const { violations, mandatoryOffs } = checkCumulative32HourRule('p1', assignments, 3);

  assert(violations.length >= 1, 'detects violation when chain exceeds 32h');
  assert(violations[0].rule === 'CUMULATIVE_32H', 'rule is CUMULATIVE_32H');
  assert(violations[0].severity === 'hard', 'severity is hard');
  assert(mandatoryOffs.length >= 1, 'generates mandatory OFF');

  // Clean case: MEN + OFF + M → no violation
  const clean: Record<number, string> = { 1: 'MEN', 2: 'OFF', 3: 'M' };
  const r2 = checkCumulative32HourRule('p1', clean, 3);
  assert(r2.violations.length === 0, 'no violation for clean schedule');
});

// ============================================================================
// Rule 2: Sleep OFF After Night
// ============================================================================

describe('Rule 2 — Sleep OFF After Night Shift', () => {
  // Night on day 2, followed by M on day 3 → violation
  const bad: Record<number, string> = { 1: 'M', 2: 'N', 3: 'M' };
  const { violations, mandatoryOffs } = checkSleepOffAfterNight('p1', bad, 3);

  assert(violations.length === 1, 'detects missing OFF after night');
  assert(violations[0].rule === 'SLEEP_OFF_AFTER_NIGHT', 'rule is SLEEP_OFF_AFTER_NIGHT');
  assert(violations[0].severity === 'hard', 'severity is hard');
  assert(mandatoryOffs[0].day === 3, 'mandatory OFF placed on day after night');

  // EN followed by OFF → no violation
  const ok: Record<number, string> = { 1: 'M', 2: 'EN', 3: 'OFF' };
  const r2 = checkSleepOffAfterNight('p1', ok, 3);
  assert(r2.violations.length === 0, 'no violation when OFF follows night');
});

// ============================================================================
// Rule 3: Anti-Single Shift
// ============================================================================

describe('Rule 3 — Anti-Single Shift (Isolated)', () => {
  // OFF E OFF → isolated E
  const isolated: Record<number, string> = { 1: 'OFF', 2: 'E', 3: 'OFF' };
  const { violations, singleShiftFlags } = checkAntiSingleShiftRule('p1', isolated, 3);

  assert(violations.length === 1, 'detects isolated single shift');
  assert(violations[0].rule === 'SINGLE_SHIFT_ISOLATED', 'rule is SINGLE_SHIFT_ISOLATED');
  assert(violations[0].severity === 'soft', 'severity is soft');
  assert(singleShiftFlags[0].shift === 'E', 'flagged shift is E');

  // OFF ME OFF → ME is multi-part, should NOT flag
  const multi: Record<number, string> = { 1: 'OFF', 2: 'ME', 3: 'OFF' };
  const r2 = checkAntiSingleShiftRule('p1', multi, 3);
  assert(r2.violations.length === 0, 'multi-part shift not flagged as isolated');
});

// ============================================================================
// Rule 4: Leave Classification
// ============================================================================

describe('Rule 4 — Leave Classification', () => {
  const leaveAssignments: Record<number, string> = { 1: 'M', 2: 'L1', 3: 'L1' };

  // Finalized schedule → confirmed leaves
  const { leaveClassifications: conf } = classifyLeaves('p1', leaveAssignments, 3, true, []);
  assert(conf.length === 2, 'finds two leave days');
  assert(conf.every((l: LeaveClassification) => l.type === 'confirmed'), 'finalized → all confirmed');

  // Draft schedule with range request → draft
  const rangeRequest: ShiftRequest = {
    id: 'r1',
    personnelId: 'p1',
    requestType: 'leave',
    isEssential: false,
    scope: 'range',
    startDate: '1403-01-02',
    endDate: '1403-01-03',
  };
  const { leaveClassifications: draft } = classifyLeaves('p1', leaveAssignments, 3, false, [rangeRequest]);
  assert(draft.every((l: LeaveClassification) => l.type === 'draft'), 'draft schedule with range request → draft');
});

// ============================================================================
// Master: checkPersonnelSafety
// ============================================================================

describe('Master — checkPersonnelSafety', () => {
  // Combined bad schedule: MEN day1, M day2 (violates sleep rule), isolated M on day4 between OFFs
  const assignments: Record<number, string> = {
    1: 'MEN',
    2: 'M',    // sleep violation
    3: 'OFF',
    4: 'M',    // isolated
    5: 'OFF',
  };
  const result = checkPersonnelSafety(mockPersonnel, assignments, 5, [], false);

  assert(!result.isClean, 'combined schedule is not clean');
  assert(result.hardViolationCount >= 1, 'at least one hard violation');
  assert(result.softViolationCount >= 1, 'at least one soft violation');
  assert(result.mandatoryOffs.length >= 1, 'mandatory OFFs generated');
});

// ============================================================================
// Schedule-Level: summarizeScheduleSafety
// ============================================================================

describe('Schedule — summarizeScheduleSafety', () => {
  const schedule: MonthlySchedule = {
    year: 1403,
    month: 1,
    assignments: { p1: { 1: 'N', 2: 'M' } }, // sleep violation
    shiftLeaders: {},
    warnings: [],
  };

  const results = checkScheduleSafety([mockPersonnel], schedule, 2, []);
  const summary = summarizeScheduleSafety(results);

  assert(summary.totalHardViolations >= 1, 'summary counts hard violations');
  assert(summary.personnelWithHardViolations.includes('p1'), 'p1 listed in hard violation list');
  assert(!summary.isFullyClean, 'schedule is not clean');

  // Clean schedule
  const cleanSchedule: MonthlySchedule = {
    year: 1403,
    month: 1,
    assignments: { p1: { 1: 'M', 2: 'OFF' } },
    shiftLeaders: {},
    warnings: [],
  };
  const cleanResults = checkScheduleSafety([mockPersonnel], cleanSchedule, 2, []);
  const cleanSummary = summarizeScheduleSafety(cleanResults);
  assert(cleanSummary.isFullyClean, 'clean schedule reports isFullyClean');
});

// ============================================================================
// Summary
// ============================================================================

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
