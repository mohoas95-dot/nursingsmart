/**
 * Unit Tests — Phase 1 Type & Schema Extensions
 *
 * Run: tsx --test tests/schema-extensions.test.ts
 *
 * Covers:
 *   - PersonnelSchema validation of the new `routineTag` field (optional/nullable).
 *   - RoutineTag enum / default constant integrity.
 *   - ShiftType `UNFILLED` membership (compile-time + runtime sanity).
 *   - ScenarioScore / ArenaScenario interface constructibility (type-level).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PersonnelSchema,
  RoutineTagSchema,
  ROUTINE_TAG_VALUES,
  DEFAULT_ROUTINE_TAG,
} from '../lib/storageSchemas';
import type {
  Personnel,
  RoutineTag,
  ShiftType,
  ScenarioScore,
  ArenaScenario,
} from '../lib/types';

// ============================================================================
// routineTag enum & default constant
// ============================================================================

test('ROUTINE_TAG_VALUES contains all five supported tags in spec order', () => {
  assert.deepEqual(ROUTINE_TAG_VALUES, [
    'MORNING_ONLY',
    'LONG_SHIFT',
    'EVENING_NIGHT',
    'FULL_ROTATION_MEN',
    'ROTATING_GENERAL',
  ]);
});

test('DEFAULT_ROUTINE_TAG is ROTATING_GENERAL and is a valid tag', () => {
  assert.equal(DEFAULT_ROUTINE_TAG, 'ROTATING_GENERAL');
  assert.equal(RoutineTagSchema.parse(DEFAULT_ROUTINE_TAG), 'ROTATING_GENERAL');
});

test('RoutineTagSchema accepts every supported tag and rejects others', () => {
  for (const tag of ROUTINE_TAG_VALUES) {
    assert.equal(RoutineTagSchema.parse(tag), tag);
  }
  assert.throws(() => RoutineTagSchema.parse('MORNING'));
  assert.throws(() => RoutineTagSchema.parse('morning_only'));
});

// ============================================================================
// PersonnelSchema.routineTag (optional/nullable validation)
// ============================================================================

const basePersonnel = {
  id: 'p_test',
  firstName: 'نام',
  lastName: 'نام‌خانوادگی',
  personalCode: '100',
  jobGroup: 'nurse',
  position: 'staff',
  employmentType: 'official',
  experienceYears: 3,
  active: true,
  canBeShiftLeader: true,
} as const;

test('PersonnelSchema: routineTag is optional (absent key accepted)', () => {
  const parsed = PersonnelSchema.parse(basePersonnel);
  assert.equal(parsed.routineTag, undefined);
});

test('PersonnelSchema: routineTag is nullable (null accepted)', () => {
  const parsed = PersonnelSchema.parse({ ...basePersonnel, routineTag: null });
  assert.equal(parsed.routineTag, null);
});

test('PersonnelSchema: routineTag accepts each supported tag', () => {
  for (const tag of ROUTINE_TAG_VALUES) {
    const parsed = PersonnelSchema.parse({ ...basePersonnel, routineTag: tag });
    assert.equal(parsed.routineTag, tag);
  }
});

test('PersonnelSchema: routineTag rejects an invalid value', () => {
  assert.throws(() => PersonnelSchema.parse({ ...basePersonnel, routineTag: 'NIGHT_ONLY' }));
});

test('PersonnelSchema (.strict): rejects unknown keys beyond routineTag', () => {
  assert.throws(() => PersonnelSchema.parse({ ...basePersonnel, bogusField: 1 }));
});

// ============================================================================
// Type-level assertions (execute the compiled types to prove they are usable)
// ============================================================================

test('ShiftType accepts the new UNFILLED value', () => {
  const shift: ShiftType = 'UNFILLED';
  assert.equal(shift, 'UNFILLED');
});

test('Personnel.routineTag is typed as RoutineTag | null | undefined', () => {
  const a: Personnel = { ...basePersonnel }; // routineTag omitted
  const b: Personnel = { ...basePersonnel, routineTag: 'MORNING_ONLY' };
  const c: Personnel = { ...basePersonnel, routineTag: null };
  const tag: RoutineTag | null | undefined = a.routineTag ?? b.routineTag ?? c.routineTag;
  assert.ok(tag === undefined || tag === null || tag === 'MORNING_ONLY');
});

test('ScenarioScore interface is constructible', () => {
  const score: ScenarioScore = {
    coverage: 100,
    fairness: 95,
    requestSatisfaction: 90,
    ruleCompliance: 88,
    stability: 80,
    warningCount: 2,
    unfilledCount: 0,
    total: 92.5,
  };
  assert.equal(score.total, 92.5);
});

test('ArenaScenario interface is constructible and references ScenarioScore', () => {
  const scenario: ArenaScenario = {
    id: 'scn_1',
    label: 'سناریوی متعادل',
    assignments: { p1: { 1: 'M', 2: 'N' } },
    score: {
      coverage: 100,
      fairness: 80,
      requestSatisfaction: 70,
      ruleCompliance: 90,
      stability: 75,
      warningCount: 1,
      unfilledCount: 1,
      total: 85,
    },
    warnings: ['هشدار نمونه'],
    coverageGaps: [{ day: 3, shift: 'N', shortage: 1 }],
    generatedBy: 'heuristic',
    createdAt: '2026-07-22T00:00:00.000Z',
  };
  assert.equal(scenario.label, 'سناریوی متعادل');
  assert.equal(scenario.score.total, 85);
});
