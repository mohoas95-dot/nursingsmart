/** Canonical request-day outcome evaluation (Phase 6, Step 6). */

import type { ShiftType } from '../../lib/types';
import {
  EXACT_RATIONAL_ONE,
  EXACT_RATIONAL_ZERO,
  createExactRational,
} from '../math/exact-rational';
import {
  shiftComponents,
  shiftContainsComponent,
} from '../scheduling/workload';
import {
  REQUEST_DAY_OUTCOME_VERSION,
  type CanonicalRequestDay,
  type RequestComponent,
  type QualityEligibleRequestDayOutcome,
  type RequestResolutionProvenance,
} from './request-domain';

function isLeaveAssignment(shift: ShiftType): boolean {
  return shift.startsWith('L');
}

function sameComponents(
  left: ReadonlyArray<RequestComponent>,
  right: ReadonlyArray<RequestComponent>
): boolean {
  return left.length === right.length && left.every((component, index) => component === right[index]);
}

function fulfilledWorkComponents(assignedShift: ShiftType): RequestComponent[] {
  return [...shiftComponents(assignedShift)];
}

function matchingPartialProvenance(
  requestDay: Readonly<CanonicalRequestDay>,
  assignedShift: ShiftType,
  provenance: ReadonlyArray<RequestResolutionProvenance>
): RequestResolutionProvenance | undefined {
  const assignedComponents = fulfilledWorkComponents(assignedShift);
  if (
    requestDay.requestedComponents.length <= 1
    || assignedComponents.length === 0
    || assignedComponents.length >= requestDay.requestedComponents.length
    || !assignedComponents.every(component => requestDay.requestedComponents.includes(component))
  ) return undefined;

  return [...provenance].reverse().find(item =>
    item.requestId === requestDay.requestId
    && item.personnelId === requestDay.personnelId
    && item.day === requestDay.day
    && item.requestedShift === requestDay.expectedValue
    && item.retainedShift === assignedShift
    && sameComponents(item.requestedComponents, requestDay.requestedComponents)
    && sameComponents(item.retainedComponents, assignedComponents)
  );
}

function matchingBlockedProvenance(
  requestDay: Readonly<CanonicalRequestDay>,
  provenance: ReadonlyArray<RequestResolutionProvenance>
): RequestResolutionProvenance | undefined {
  return [...provenance].reverse().find(item =>
    item.requestId === requestDay.requestId
    && item.personnelId === requestDay.personnelId
    && item.day === requestDay.day
    && item.requestedShift === requestDay.expectedValue
    && item.retainedShift === null
    && item.retainedComponents.length === 0
    && sameComponents(item.requestedComponents, requestDay.requestedComponents)
  );
}

function exactOutcome(
  requestDay: CanonicalRequestDay,
  assignedShift: ShiftType
): QualityEligibleRequestDayOutcome {
  return {
    version: REQUEST_DAY_OUTCOME_VERSION,
    kind: 'EXACT',
    reason: 'EXACT_MATCH',
    requestDay,
    assignedShift,
    includedInQuality: true,
    credit: EXACT_RATIONAL_ONE,
  };
}

function compatibleOutcome(
  requestDay: CanonicalRequestDay,
  assignedShift: ShiftType,
  reason: 'COMPONENT_CONTAINMENT' | 'REGULAR_OFF_TO_LEAVE'
): QualityEligibleRequestDayOutcome {
  return {
    version: REQUEST_DAY_OUTCOME_VERSION,
    kind: 'COMPATIBLE',
    reason,
    requestDay,
    assignedShift,
    includedInQuality: true,
    credit: EXACT_RATIONAL_ONE,
  };
}

function unsatisfiedOutcome(
  requestDay: CanonicalRequestDay,
  assignedShift: ShiftType,
  reason: 'ASSIGNMENT_MISMATCH' | 'UNPROVEN_DEGRADATION' = 'ASSIGNMENT_MISMATCH'
): QualityEligibleRequestDayOutcome {
  return {
    version: REQUEST_DAY_OUTCOME_VERSION,
    kind: 'UNSATISFIED',
    reason,
    requestDay,
    assignedShift,
    includedInQuality: true,
    credit: EXACT_RATIONAL_ZERO,
  };
}

/**
 * Evaluate one valid canonical request-day exactly once.
 * Assignment pairs alone can never create PARTIAL or BLOCKED.
 */
export function evaluateCanonicalRequestDay(
  requestDay: CanonicalRequestDay,
  assignedShift: ShiftType,
  provenance: ReadonlyArray<RequestResolutionProvenance> = []
): QualityEligibleRequestDayOutcome {
  if (requestDay.polarity === 'NEGATIVE') {
    const requested = requestDay.expectedValue;
    const violates = requestDay.requestedComponents.length === 1
      ? shiftContainsComponent(assignedShift, requestDay.requestedComponents[0] as 'M' | 'E' | 'N')
      : assignedShift === requested;
    return violates
      ? unsatisfiedOutcome(requestDay, assignedShift)
      : exactOutcome(requestDay, assignedShift);
  }

  if (requestDay.requestType === 'OFF') {
    if (assignedShift === 'OFF') return exactOutcome(requestDay, assignedShift);
    if (isLeaveAssignment(assignedShift)) {
      return compatibleOutcome(requestDay, assignedShift, 'REGULAR_OFF_TO_LEAVE');
    }
    return unsatisfiedOutcome(requestDay, assignedShift);
  }

  if (requestDay.requestType === 'leave') {
    return isLeaveAssignment(assignedShift)
      ? exactOutcome(requestDay, assignedShift)
      : unsatisfiedOutcome(requestDay, assignedShift);
  }

  if (requestDay.requestType === 'pattern' && requestDay.expectedValue === 'OFF') {
    return assignedShift === 'OFF'
      ? exactOutcome(requestDay, assignedShift)
      : unsatisfiedOutcome(requestDay, assignedShift);
  }

  if (requestDay.requestType === 'pattern' && requestDay.expectedValue === 'L') {
    return isLeaveAssignment(assignedShift)
      ? exactOutcome(requestDay, assignedShift)
      : unsatisfiedOutcome(requestDay, assignedShift);
  }

  if (assignedShift === requestDay.expectedValue) {
    return exactOutcome(requestDay, assignedShift);
  }

  if (
    requestDay.requestedComponents.length === 1
    && shiftContainsComponent(
      assignedShift,
      requestDay.requestedComponents[0] as 'M' | 'E' | 'N'
    )
  ) {
    return compatibleOutcome(requestDay, assignedShift, 'COMPONENT_CONTAINMENT');
  }

  const partialProof = matchingPartialProvenance(requestDay, assignedShift, provenance);
  if (partialProof) {
    return {
      version: REQUEST_DAY_OUTCOME_VERSION,
      kind: 'PARTIAL',
      reason: 'HARD_RULE_DEGRADATION',
      requestDay,
      assignedShift,
      includedInQuality: true,
      credit: createExactRational(
        BigInt(partialProof.retainedComponents.length),
        BigInt(partialProof.requestedComponents.length)
      ),
      provenance: [partialProof],
    };
  }

  const blockedProof = matchingBlockedProvenance(requestDay, provenance);
  if (blockedProof) {
    return {
      version: REQUEST_DAY_OUTCOME_VERSION,
      kind: 'BLOCKED',
      reason: 'HARD_RULE_BLOCKED',
      requestDay,
      assignedShift,
      includedInQuality: true,
      credit: EXACT_RATIONAL_ZERO,
      provenance: [blockedProof],
    };
  }

  const assignedComponents = fulfilledWorkComponents(assignedShift);
  const looksLikeUnprovenSubset = requestDay.requestedComponents.length > 1
    && assignedComponents.length > 0
    && assignedComponents.length < requestDay.requestedComponents.length
    && assignedComponents.every(component => requestDay.requestedComponents.includes(component));
  return unsatisfiedOutcome(
    requestDay,
    assignedShift,
    looksLikeUnprovenSubset ? 'UNPROVEN_DEGRADATION' : 'ASSIGNMENT_MISMATCH'
  );
}
