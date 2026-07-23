/**
 * Unit Tests — RoutineStrategy (lib/routineStrategy.ts) — Tasks 1 & 2
 *
 * Run: tsx --test tests/routine-strategy.test.ts
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROUTINE_TAG_PREFERRED_SLOTS,
  routineRepresentativeShift,
  hasNoRequests,
  getEffectiveRoutineTag,
  routineShiftScore,
  buildEffectiveRoutineTags,
} from '../lib/routineStrategy';
import type { Personnel, ShiftRequest, RoutineTag } from '../lib/types';

function person(id: string, routineTag?: RoutineTag | null): Personnel {
  return {
    id,
    firstName: 'T',
    lastName: 'P',
    personalCode: id,
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'official',
    experienceYears: 1,
    active: true,
    canBeShiftLeader: false,
    routineTag,
  };
}

function req(id: string, personnelId: string): ShiftRequest {
  return {
    id,
    personnelId,
    requestType: 'shift',
    preferredShift: 'M',
    isEssential: false,
    scope: 'all',
  };
}

// ============================================================================
// Representative shift & preferred-slots map
// ============================================================================

test('routineRepresentativeShift: maps each tag to its long-form shift', () => {
  assert.equal(routineRepresentativeShift('MORNING_ONLY'), 'M');
  assert.equal(routineRepresentativeShift('LONG_SHIFT'), 'ME');
  assert.equal(routineRepresentativeShift('EVENING_NIGHT'), 'EN');
  assert.equal(routineRepresentativeShift('FULL_ROTATION_MEN'), 'MEN');
  assert.equal(routineRepresentativeShift('ROTATING_GENERAL'), 'M');
});

test('ROUTINE_TAG_PREFERRED_SLOTS: covers all five tags', () => {
  const tags: RoutineTag[] = [
    'MORNING_ONLY',
    'LONG_SHIFT',
    'EVENING_NIGHT',
    'FULL_ROTATION_MEN',
    'ROTATING_GENERAL',
  ];
  for (const t of tags) assert.ok(Array.isArray(ROUTINE_TAG_PREFERRED_SLOTS[t]));
  assert.deepEqual([...ROUTINE_TAG_PREFERRED_SLOTS.ROTATING_GENERAL], []);
});

// ============================================================================
// routineShiftScore (Task 1 priority signal)
// ============================================================================

test('routineShiftScore: MORNING_ONLY prefers only M', () => {
  assert.equal(routineShiftScore('MORNING_ONLY', 'M'), 1);
  assert.equal(routineShiftScore('MORNING_ONLY', 'E'), 0);
  assert.equal(routineShiftScore('MORNING_ONLY', 'N'), 0);
});

test('routineShiftScore: LONG_SHIFT prefers M and E (ME), not N', () => {
  assert.equal(routineShiftScore('LONG_SHIFT', 'M'), 1);
  assert.equal(routineShiftScore('LONG_SHIFT', 'E'), 1);
  assert.equal(routineShiftScore('LONG_SHIFT', 'N'), 0);
});

test('routineShiftScore: EVENING_NIGHT prefers E and N (EN), not M', () => {
  assert.equal(routineShiftScore('EVENING_NIGHT', 'E'), 1);
  assert.equal(routineShiftScore('EVENING_NIGHT', 'N'), 1);
  assert.equal(routineShiftScore('EVENING_NIGHT', 'M'), 0);
});

test('routineShiftScore: FULL_ROTATION_MEN matches all three', () => {
  assert.equal(routineShiftScore('FULL_ROTATION_MEN', 'M'), 1);
  assert.equal(routineShiftScore('FULL_ROTATION_MEN', 'E'), 1);
  assert.equal(routineShiftScore('FULL_ROTATION_MEN', 'N'), 1);
});

test('routineShiftScore: ROTATING_GENERAL has no explicit preference', () => {
  assert.equal(routineShiftScore('ROTATING_GENERAL', 'M'), 0);
  assert.equal(routineShiftScore('ROTATING_GENERAL', 'E'), 0);
  assert.equal(routineShiftScore('ROTATING_GENERAL', 'N'), 0);
});

// ============================================================================
// No-request staff handling (Task 2)
// ============================================================================

test('hasNoRequests: true when person has no requests', () => {
  assert.equal(hasNoRequests('p1', [req('r1', 'p2')]), true);
  assert.equal(hasNoRequests('p1', [req('r1', 'p1')]), false);
});

test('getEffectiveRoutineTag: no-request staff default to ROTATING_GENERAL', () => {
  // حتی اگر routineTag شخص چیز دیگری باشد، بدون درخواست → ROTATING_GENERAL.
  const p = person('p1', 'MORNING_ONLY');
  assert.equal(getEffectiveRoutineTag(p, []), 'ROTATING_GENERAL');
  assert.equal(getEffectiveRoutineTag(p, [req('r1', 'p2')]), 'ROTATING_GENERAL');
});

test('getEffectiveRoutineTag: with requests, uses the personnel tag', () => {
  assert.equal(getEffectiveRoutineTag(person('p1', 'LONG_SHIFT'), [req('r1', 'p1')]), 'LONG_SHIFT');
  assert.equal(
    getEffectiveRoutineTag(person('p1', 'EVENING_NIGHT'), [req('r1', 'p1')]),
    'EVENING_NIGHT'
  );
});

test('getEffectiveRoutineTag: null/undefined tag with requests falls back to ROTATING_GENERAL', () => {
  assert.equal(getEffectiveRoutineTag(person('p1', null), [req('r1', 'p1')]), 'ROTATING_GENERAL');
  assert.equal(getEffectiveRoutineTag(person('p1', undefined), [req('r1', 'p1')]), 'ROTATING_GENERAL');
});

test('buildEffectiveRoutineTags: per-personnel map with no-request fallback', () => {
  const personnel = [
    person('a', 'MORNING_ONLY'), // no requests → ROTATING_GENERAL
    person('b', 'LONG_SHIFT'), // has request → LONG_SHIFT
  ];
  const map = buildEffectiveRoutineTags(personnel, [req('r1', 'b')]);
  assert.equal(map['a'], 'ROTATING_GENERAL');
  assert.equal(map['b'], 'LONG_SHIFT');
});
