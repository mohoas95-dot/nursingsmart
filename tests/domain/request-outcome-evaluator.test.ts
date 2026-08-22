import assert from 'node:assert/strict';
import test from 'node:test';

import { exactRationalEquals, createExactRational } from '../../domain/math/exact-rational';
import {
  CANONICAL_REQUEST_DAY_VERSION,
  REQUEST_RESOLUTION_PROVENANCE_VERSION,
  type CanonicalRequestDay,
  type RequestResolutionProvenance,
} from '../../domain/requests/request-domain';
import { evaluateCanonicalRequestDay } from '../../domain/requests/request-outcome-evaluator';

function requestDay(overrides: Partial<CanonicalRequestDay> = {}): CanonicalRequestDay {
  return {
    version: CANONICAL_REQUEST_DAY_VERSION,
    requestId: 'r', personnelId: 'p', year: 1404, month: 2, day: 1,
    requestType: 'shift', expectedValue: 'EN', isEssential: false,
    polarity: 'POSITIVE', requestedComponents: ['E', 'N'],
    ...overrides,
  };
}

function proof(overrides: Partial<RequestResolutionProvenance> = {}): RequestResolutionProvenance {
  return {
    version: REQUEST_RESOLUTION_PROVENANCE_VERSION,
    requestId: 'r', personnelId: 'p', day: 1,
    stage: 'SOLVER_REQUEST_APPLICATION',
    hardRule: 'NIGHT_REST_CONSECUTIVE_NIGHTS',
    requestedShift: 'EN', retainedShift: 'E',
    requestedComponents: ['E', 'N'], retainedComponents: ['E'], missingComponents: ['N'],
    ...overrides,
  };
}

test('exact work assignment receives full credit', () => {
  const result = evaluateCanonicalRequestDay(requestDay(), 'EN');
  assert.equal(result.kind, 'EXACT');
  assert.ok(exactRationalEquals(result.credit!, createExactRational(BigInt(1), BigInt(1))));
});

test('single-component containment M→ME and E→MEN is COMPATIBLE', () => {
  const m = evaluateCanonicalRequestDay(requestDay({ expectedValue: 'M', requestedComponents: ['M'] }), 'ME');
  const e = evaluateCanonicalRequestDay(requestDay({ expectedValue: 'E', requestedComponents: ['E'] }), 'MEN');
  assert.equal(m.kind, 'COMPATIBLE');
  assert.equal(e.kind, 'COMPATIBLE');
});

test('EN→E with named matching hard provenance is PARTIAL 1/2', () => {
  const result = evaluateCanonicalRequestDay(requestDay(), 'E', [proof()]);
  assert.equal(result.kind, 'PARTIAL');
  assert.ok(exactRationalEquals(result.credit!, createExactRational(BigInt(1), BigInt(2))));
  assert.equal(result.provenance[0].hardRule, 'NIGHT_REST_CONSECUTIVE_NIGHTS');
});

test('EN→E without provenance is UNSATISFIED, never inferred PARTIAL', () => {
  const result = evaluateCanonicalRequestDay(requestDay(), 'E');
  assert.equal(result.kind, 'UNSATISFIED');
  assert.equal(result.reason, 'UNPROVEN_DEGRADATION');
});

test('mismatched provenance cannot authorize PARTIAL', () => {
  const result = evaluateCanonicalRequestDay(requestDay(), 'E', [proof({ retainedShift: 'N' })]);
  assert.equal(result.kind, 'UNSATISFIED');
});

test('all requested subsets blocked with named proof is BLOCKED', () => {
  const blocked = proof({
    hardRule: 'MORNING_ONLY', retainedShift: null, retainedComponents: [],
  });
  const result = evaluateCanonicalRequestDay(requestDay(), 'OFF', [blocked]);
  assert.equal(result.kind, 'BLOCKED');
  assert.equal(result.provenance[0].hardRule, 'MORNING_ONLY');
});

test('blocked-looking assignment without named proof is UNSATISFIED', () => {
  assert.equal(evaluateCanonicalRequestDay(requestDay(), 'OFF').kind, 'UNSATISFIED');
});

test('regular OFF→OFF is EXACT and regular OFF→leave is COMPATIBLE', () => {
  const off = requestDay({ requestType: 'OFF', expectedValue: 'OFF', requestedComponents: ['OFF'] });
  assert.equal(evaluateCanonicalRequestDay(off, 'OFF').kind, 'EXACT');
  const leave = evaluateCanonicalRequestDay(off, 'L1');
  assert.equal(leave.kind, 'COMPATIBLE');
  assert.equal(leave.reason, 'REGULAR_OFF_TO_LEAVE');
});

test('pattern OFF remains distinct: OFF→leave is UNSATISFIED', () => {
  const off = requestDay({ requestType: 'pattern', expectedValue: 'OFF', requestedComponents: ['OFF'] });
  assert.equal(evaluateCanonicalRequestDay(off, 'L1').kind, 'UNSATISFIED');
});

test('regular and pattern leave accept leave markers without changing identity', () => {
  const regular = requestDay({ requestType: 'leave', expectedValue: 'L', requestedComponents: ['L'] });
  const pattern = requestDay({ requestType: 'pattern', expectedValue: 'L', requestedComponents: ['L'] });
  assert.equal(evaluateCanonicalRequestDay(regular, 'L1').kind, 'EXACT');
  assert.equal(evaluateCanonicalRequestDay(pattern, 'LH').kind, 'EXACT');
});

test('single avoid uses containment, composite avoid uses exact-code semantics', () => {
  const single = requestDay({
    requestType: 'avoid_shift', expectedValue: 'E', requestedComponents: ['E'], polarity: 'NEGATIVE',
  });
  const composite = requestDay({
    requestType: 'avoid_shift', expectedValue: 'EN', requestedComponents: ['E', 'N'], polarity: 'NEGATIVE',
  });
  assert.equal(evaluateCanonicalRequestDay(single, 'MEN').kind, 'UNSATISFIED');
  assert.equal(evaluateCanonicalRequestDay(single, 'M').kind, 'EXACT');
  assert.equal(evaluateCanonicalRequestDay(composite, 'EN').kind, 'UNSATISFIED');
  assert.equal(evaluateCanonicalRequestDay(composite, 'MEN').kind, 'EXACT');
});

test('an exact final assignment supersedes old partial provenance', () => {
  const result = evaluateCanonicalRequestDay(requestDay(), 'EN', [proof()]);
  assert.equal(result.kind, 'EXACT');
});
