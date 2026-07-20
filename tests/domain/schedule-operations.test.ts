/**
 * Unit Tests — Schedule Operations (Domain Layer)
 *
 * Run: tsx --test tests/domain/schedule-operations.test.ts
 *
 * These tests verify the pure domain functions for schedule write operations.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeScheduleAssignments,
  mergeOptimizerAssignments,
  updateScheduleCell,
  buildPersonnelFromForm,
  validatePersonnelForm,
} from '../../domain/scheduling/schedule-operations';
import type { Personnel } from '../../lib/types';

// ============================================================================
// normalizeScheduleAssignments
// ============================================================================

test('normalizeScheduleAssignments: adds missing active personnel', () => {
  const personnel: Personnel[] = [
    createPersonnel('p1', 'nurse', true),
    createPersonnel('p2', 'nurse', true),
    createPersonnel('p3', 'nurse', false), // inactive
  ];

  const assignments = { p1: { 1: 'M' as const } };
  const result = normalizeScheduleAssignments(assignments, personnel);

  assert.equal(Object.keys(result).length, 2); // p1 and p2 (p3 is inactive)
  assert.deepEqual(result['p1'], { 1: 'M' });
  assert.deepEqual(result['p2'], {});
  assert.equal(result['p3'], undefined); // inactive personnel excluded
});

test('normalizeScheduleAssignments: handles undefined assignments', () => {
  const personnel: Personnel[] = [
    createPersonnel('p1', 'nurse', true),
    createPersonnel('p2', 'nurse', true),
  ];

  const result = normalizeScheduleAssignments(undefined, personnel);

  assert.equal(Object.keys(result).length, 2);
  assert.deepEqual(result['p1'], {});
  assert.deepEqual(result['p2'], {});
});

// ============================================================================
// mergeOptimizerAssignments
// ============================================================================

test('mergeOptimizerAssignments: updates only target job group', () => {
  const personnel: Personnel[] = [
    createPersonnel('n1', 'nurse', true),
    createPersonnel('a1', 'assistant', true),
  ];

  const currentAssignments = {
    n1: { 1: 'M' as const },
    a1: { 1: 'E' as const },
  };

  const optimizedAssignments = {
    n1: { 1: 'N' as const }, // changed
    a1: { 1: 'N' as const }, // changed but should be ignored
  };

  const result = mergeOptimizerAssignments(
    currentAssignments,
    optimizedAssignments,
    personnel,
    'nurse', // target job group
    []
  );

  assert.deepEqual(result['n1'], { 1: 'N' }); // updated
  assert.deepEqual(result['a1'], { 1: 'E' }); // NOT updated (different job group)
});

test('mergeOptimizerAssignments: respects locked rows', () => {
  const personnel: Personnel[] = [
    createPersonnel('n1', 'nurse', true),
    createPersonnel('n2', 'nurse', true),
  ];

  const currentAssignments = {
    n1: { 1: 'M' as const },
    n2: { 1: 'E' as const },
  };

  const optimizedAssignments = {
    n1: { 1: 'N' as const },
    n2: { 1: 'N' as const },
  };

  const result = mergeOptimizerAssignments(
    currentAssignments,
    optimizedAssignments,
    personnel,
    'nurse',
    ['n1'] // n1 is locked
  );

  assert.deepEqual(result['n1'], { 1: 'M' }); // NOT updated (locked)
  assert.deepEqual(result['n2'], { 1: 'N' }); // updated
});

test('mergeOptimizerAssignments: creates new schedule when current is undefined', () => {
  const personnel: Personnel[] = [
    createPersonnel('n1', 'nurse', true),
  ];

  const optimizedAssignments = {
    n1: { 1: 'M' as const, 2: 'E' as const },
  };

  const result = mergeOptimizerAssignments(
    undefined,
    optimizedAssignments,
    personnel,
    'nurse',
    []
  );

  assert.deepEqual(result['n1'], { 1: 'M', 2: 'E' });
});

// ============================================================================
// updateScheduleCell
// ============================================================================

test('updateScheduleCell: updates existing cell', () => {
  const assignments = {
    p1: { 1: 'M' as const, 2: 'E' as const },
  };

  const result = updateScheduleCell(assignments, 'p1', 1, 'N');

  assert.deepEqual(result['p1'], { 1: 'N', 2: 'E' });
  assert.deepEqual(assignments['p1'], { 1: 'M', 2: 'E' }); // original not mutated
});

test('updateScheduleCell: creates new personnel entry if missing', () => {
  const assignments = {
    p1: { 1: 'M' as const },
  };

  const result = updateScheduleCell(assignments, 'p2', 1, 'E');

  assert.deepEqual(result['p1'], { 1: 'M' });
  assert.deepEqual(result['p2'], { 1: 'E' });
});

test('updateScheduleCell: creates new day entry if missing', () => {
  const assignments = {
    p1: { 1: 'M' as const },
  };

  const result = updateScheduleCell(assignments, 'p1', 5, 'N');

  assert.deepEqual(result['p1'], { 1: 'M', 5: 'N' });
});

test('updateScheduleCell: does not mutate original', () => {
  const assignments = {
    p1: { 1: 'M' as const },
  };

  const result = updateScheduleCell(assignments, 'p1', 1, 'N');

  assert.notEqual(result, assignments);
  assert.notEqual(result['p1'], assignments['p1']);
  assert.equal(assignments['p1'][1], 'M'); // original unchanged
});

// ============================================================================
// buildPersonnelFromForm
// ============================================================================

test('buildPersonnelFromForm: creates new nurse', () => {
  const formData = {
    firstName: 'علی',
    lastName: 'محمدی',
    personalCode: '123',
    jobGroup: 'nurse' as const,
    position: 'staff' as const,
    employmentType: 'official' as const,
    experienceYears: 5,
    active: true,
    canBeShiftLeader: true,
  };

  const result = buildPersonnelFromForm(null, formData, 'p_123', 0);

  assert.equal(result.id, 'p_123');
  assert.equal(result.firstName, 'علی');
  assert.equal(result.lastName, 'محمدی');
  assert.equal(result.jobGroup, 'nurse');
  assert.equal(result.position, 'staff');
  assert.equal(result.canBeShiftLeader, true);
  assert.equal(result.orderIndex, 0);
});

test('buildPersonnelFromForm: creates new assistant with forced position=none', () => {
  const formData = {
    firstName: 'فاطمه',
    lastName: 'احمدی',
    personalCode: '456',
    jobGroup: 'assistant' as const,
    position: 'staff' as const, // should be overridden to 'none'
    employmentType: 'contract' as const,
    experienceYears: 2,
    active: true,
    canBeShiftLeader: true, // should be overridden to false
  };

  const result = buildPersonnelFromForm(null, formData, 'p_456', 1);

  assert.equal(result.position, 'none'); // forced
  assert.equal(result.canBeShiftLeader, false); // forced
});

test('buildPersonnelFromForm: updates existing personnel', () => {
  const existing: Personnel = createPersonnel('p1', 'nurse', true);
  existing.firstName = 'علی';
  existing.lastName = 'قدیمی';

  const formData = {
    firstName: 'علی',
    lastName: 'جدید',
    personalCode: '789',
    jobGroup: 'nurse' as const,
    position: 'supervisor' as const,
    employmentType: 'official' as const,
    experienceYears: 10,
    active: true,
    canBeShiftLeader: true,
  };

  const result = buildPersonnelFromForm(existing, formData, null, 0);

  assert.equal(result.id, 'p1'); // preserved
  assert.equal(result.lastName, 'جدید'); // updated
  assert.equal(result.personalCode, '789'); // updated
});

// ============================================================================
// validatePersonnelForm
// ============================================================================

test('validatePersonnelForm: valid new personnel', () => {
  const result = validatePersonnelForm(
    { firstName: 'علی', lastName: 'محمدی', nationalId: '1234567890' },
    false
  );
  assert.equal(result.valid, true);
  assert.equal(result.error, undefined);
});

test('validatePersonnelForm: missing first name', () => {
  const result = validatePersonnelForm(
    { firstName: '', lastName: 'محمدی', nationalId: '1234567890' },
    false
  );
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('نام'));
});

test('validatePersonnelForm: missing last name', () => {
  const result = validatePersonnelForm(
    { firstName: 'علی', lastName: '', nationalId: '1234567890' },
    false
  );
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('نام'));
});

test('validatePersonnelForm: new personnel without national ID', () => {
  const result = validatePersonnelForm(
    { firstName: 'علی', lastName: 'محمدی', nationalId: '' },
    false
  );
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('کد ملی'));
});

test('validatePersonnelForm: editing personnel without national ID is OK', () => {
  const result = validatePersonnelForm(
    { firstName: 'علی', lastName: 'محمدی', nationalId: '' },
    true // editing
  );
  assert.equal(result.valid, true);
});

// ============================================================================
// Helper: Create Personnel
// ============================================================================

function createPersonnel(
  id: string,
  jobGroup: 'nurse' | 'assistant',
  active: boolean
): Personnel {
  return {
    id,
    firstName: 'Test',
    lastName: 'Person',
    personalCode: id,
    jobGroup,
    position: jobGroup === 'assistant' ? 'none' : 'staff',
    employmentType: 'official',
    experienceYears: 0,
    active,
    canBeShiftLeader: jobGroup === 'nurse',
  };
}
