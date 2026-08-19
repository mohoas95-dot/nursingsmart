/**
 * Versioned canonical request-domain contracts for Phase 6 (Model B).
 *
 * This module defines data shapes only. It does not compile requests, evaluate
 * assignments, change solver behavior, or alter the Phase 5 objective.
 */

import type { RequestType, ShiftType } from '../../lib/types';
import type { HardConstraintViolation } from '../scheduling/hard-constraints';
import { WORKLOAD_PERIODS, type WorkloadPeriod } from '../scheduling/workload';
import {
  deserializeExactRational,
  serializeExactRational,
  type ExactRational,
  type SerializedExactRational,
} from '../math/exact-rational';

// ---------------------------------------------------------------------------
// Contract versions
// ---------------------------------------------------------------------------

export const CANONICAL_REQUEST_DAY_VERSION = 'canonical-request-day/1' as const;
export const REQUEST_VALIDATION_ISSUE_VERSION = 'request-validation-issue/1' as const;
export const REQUEST_RESOLUTION_PROVENANCE_VERSION = 'request-resolution-provenance/1' as const;
export const REQUEST_DAY_OUTCOME_VERSION = 'request-day-outcome/1' as const;
export const REQUEST_OUTCOME_LEDGER_VERSION = 'request-outcome-ledger/1' as const;
export const REQUEST_QUALITY_VERSION = 'request-quality/1' as const;

// ---------------------------------------------------------------------------
// Canonical month-specific request days
// ---------------------------------------------------------------------------

/** @deprecated CanonicalRequestDay now carries explicit requestType and polarity. */
export const REQUEST_INTENTS = ['WORK', 'OFF', 'LEAVE', 'AVOID_WORK'] as const;
/** @deprecated Use RequestType plus RequestPolarity. */
export type RequestIntent = (typeof REQUEST_INTENTS)[number];

export const CANONICAL_REQUEST_VALUES = [
  'M', 'E', 'N', 'ME', 'EN', 'MN', 'MEN', 'OFF', 'L',
] as const;
export type CanonicalRequestValue = (typeof CANONICAL_REQUEST_VALUES)[number];

export const REQUEST_POLARITIES = ['POSITIVE', 'NEGATIVE'] as const;
export type RequestPolarity = (typeof REQUEST_POLARITIES)[number];

export const REQUEST_COMPONENTS = [...WORKLOAD_PERIODS, 'OFF', 'L'] as const;
export type RequestComponent = WorkloadPeriod | 'OFF' | 'L';

/**
 * One semantically valid request expanded to one concrete day in one month.
 *
 * `requestType` keeps regular OFF/leave distinct from pattern OFF/leave.
 * `expectedValue` is the exact requested code; canonicalization never composes
 * multiple records. Work components reuse WorkloadPeriod order, while OFF and L
 * remain explicit named non-work components.
 */
export interface CanonicalRequestDay {
  readonly version: typeof CANONICAL_REQUEST_DAY_VERSION;
  readonly requestId: string;
  readonly personnelId: string;
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly requestType: RequestType;
  readonly expectedValue: CanonicalRequestValue;
  readonly isEssential: boolean;
  readonly polarity: RequestPolarity;
  readonly requestedComponents: ReadonlyArray<RequestComponent>;
  /** Preserved only for regular OFF; absence retains the existing hard-default policy. */
  readonly offHardness?: 'hard' | 'soft';
}

// ---------------------------------------------------------------------------
// Semantic validation and conflict classification
// ---------------------------------------------------------------------------

export const REQUEST_INVALID_REASONS = [
  'DUPLICATE_REQUEST_ID',
  'MISSING_REQUEST_ID',
  'MISSING_PERSONNEL_ID',
  'UNKNOWN_PERSONNEL',
  'INVALID_REQUEST_TYPE',
  'INVALID_SCOPE',
  'EMPTY_EFFECTIVE_SCOPE',
  'INVALID_DATE_RANGE',
  'INVALID_SELECTED_DAY',
  'MISSING_PREFERRED_SHIFT',
  'INVALID_PREFERRED_SHIFT',
  'EMPTY_PATTERN',
  'INVALID_PATTERN_STEP',
] as const;
export type RequestInvalidReason = (typeof REQUEST_INVALID_REASONS)[number];

export const REQUEST_CONFLICT_REASONS = [
  'DUPLICATE_POSITIVE_INTENT',
  'OVERLAPPING_POSITIVE_INTENT',
] as const;
export type RequestConflictReason = (typeof REQUEST_CONFLICT_REASONS)[number];

interface RequestValidationIssueBase {
  readonly version: typeof REQUEST_VALIDATION_ISSUE_VERSION;
  readonly year: number;
  readonly month: number;
  /** Sorted source IDs involved in the issue; order is never semantic. */
  readonly requestIds: ReadonlyArray<string>;
  readonly personnelId?: string;
  /** Sorted affected month days when the issue can be localized. */
  readonly days?: ReadonlyArray<number>;
}

export interface InvalidRequestValidationIssue extends RequestValidationIssueBase {
  readonly kind: 'INVALID';
  readonly reason: RequestInvalidReason;
}

export interface ConflictRequestValidationIssue extends RequestValidationIssueBase {
  readonly kind: 'CONFLICT';
  readonly reason: RequestConflictReason;
  /** Stable across input permutations; derived from reason, person, IDs, and days. */
  readonly conflictId: string;
  /** Sorted by requestId; evidence only and never a precedence rule. */
  readonly essentialFlags: ReadonlyArray<{
    readonly requestId: string;
    readonly isEssential: boolean;
  }>;
}

/** Invalid and conflict are deliberately distinct and neither is satisfiable. */
export type RequestValidationIssue =
  | InvalidRequestValidationIssue
  | ConflictRequestValidationIssue;

// ---------------------------------------------------------------------------
// Named hard-rule degradation provenance
// ---------------------------------------------------------------------------

export const REQUEST_RESOLUTION_STAGES = [
  'SOLVER_REQUEST_APPLICATION',
  'SOLVER_DEFERRED_RETRY',
  'COVERAGE_RECONCILIATION',
  'REPAIR',
  'FINAL_VERIFICATION',
] as const;
export type RequestResolutionStage = (typeof REQUEST_RESOLUTION_STAGES)[number];

/**
 * Machine-readable evidence that a named hard rule blocked part or all of a
 * positive work request at a specific transformation stage.
 */
export interface RequestResolutionProvenance {
  readonly version: typeof REQUEST_RESOLUTION_PROVENANCE_VERSION;
  readonly requestId: string;
  readonly personnelId: string;
  readonly day: number;
  readonly stage: RequestResolutionStage;
  readonly hardRule: HardConstraintViolation;
  readonly requestedShift: ShiftType;
  readonly retainedShift: ShiftType | null;
  readonly requestedComponents: ReadonlyArray<RequestComponent>;
  readonly retainedComponents: ReadonlyArray<RequestComponent>;
  readonly missingComponents: ReadonlyArray<RequestComponent>;
}

/** A partial or blocked outcome must carry at least one named proof. */
export type NonEmptyRequestResolutionProvenance = readonly [
  RequestResolutionProvenance,
  ...RequestResolutionProvenance[],
];

// ---------------------------------------------------------------------------
// Per-day outcomes
// ---------------------------------------------------------------------------

export const REQUEST_OUTCOME_KINDS = [
  'EXACT',
  'COMPATIBLE',
  'PARTIAL',
  'BLOCKED',
  'UNSATISFIED',
  'INVALID',
  'CONFLICT',
] as const;
export type RequestOutcomeKind = (typeof REQUEST_OUTCOME_KINDS)[number];

export const REQUEST_OUTCOME_REASONS = [
  'EXACT_MATCH',
  'COMPONENT_CONTAINMENT',
  'REGULAR_OFF_TO_LEAVE',
  'HARD_RULE_DEGRADATION',
  'HARD_RULE_BLOCKED',
  'ASSIGNMENT_MISMATCH',
  'UNPROVEN_DEGRADATION',
  'INVALID_REQUEST',
  'POSITIVE_INTENT_CONFLICT',
] as const;
export type RequestOutcomeReason = (typeof REQUEST_OUTCOME_REASONS)[number];

interface IncludedRequestDayOutcomeBase {
  readonly version: typeof REQUEST_DAY_OUTCOME_VERSION;
  readonly requestDay: CanonicalRequestDay;
  readonly assignedShift: ShiftType;
  readonly includedInQuality: true;
  /** Exact credit. No floating-point value is authoritative. */
  readonly credit: ExactRational;
}

export interface ExactRequestDayOutcome extends IncludedRequestDayOutcomeBase {
  readonly kind: 'EXACT';
  readonly reason: 'EXACT_MATCH';
}

export interface CompatibleRequestDayOutcome extends IncludedRequestDayOutcomeBase {
  readonly kind: 'COMPATIBLE';
  readonly reason: 'COMPONENT_CONTAINMENT' | 'REGULAR_OFF_TO_LEAVE';
}

export interface PartialRequestDayOutcome extends IncludedRequestDayOutcomeBase {
  readonly kind: 'PARTIAL';
  readonly reason: 'HARD_RULE_DEGRADATION';
  /** Required proof that a non-empty proper subset was retained. */
  readonly provenance: NonEmptyRequestResolutionProvenance;
}

export interface BlockedRequestDayOutcome extends IncludedRequestDayOutcomeBase {
  readonly kind: 'BLOCKED';
  readonly reason: 'HARD_RULE_BLOCKED';
  /** Required proof that no requested component could legally be retained. */
  readonly provenance: NonEmptyRequestResolutionProvenance;
}

export interface UnsatisfiedRequestDayOutcome extends IncludedRequestDayOutcomeBase {
  readonly kind: 'UNSATISFIED';
  readonly reason: 'ASSIGNMENT_MISMATCH' | 'UNPROVEN_DEGRADATION';
}

interface ExcludedRequestDayOutcomeBase {
  readonly version: typeof REQUEST_DAY_OUTCOME_VERSION;
  readonly includedInQuality: false;
  /** INVALID and CONFLICT enter neither numerator nor denominator. */
  readonly credit: null;
  readonly assignedShift?: ShiftType;
}

export interface InvalidRequestDayOutcome extends ExcludedRequestDayOutcomeBase {
  readonly kind: 'INVALID';
  readonly reason: 'INVALID_REQUEST';
  readonly issue: InvalidRequestValidationIssue;
  readonly requestDay?: never;
}

export interface ConflictRequestDayOutcome extends ExcludedRequestDayOutcomeBase {
  readonly kind: 'CONFLICT';
  readonly reason: 'POSITIVE_INTENT_CONFLICT';
  readonly issue: ConflictRequestValidationIssue;
  readonly requestDay: CanonicalRequestDay;
}

/**
 * Canonical per-day result. Fixed credits are contractual:
 * EXACT/COMPATIBLE=1, PARTIAL=retained/requested components, and
 * BLOCKED/UNSATISFIED=0. INVALID/CONFLICT have null credit and are excluded.
 */
export type QualityEligibleRequestDayOutcome =
  | ExactRequestDayOutcome
  | CompatibleRequestDayOutcome
  | PartialRequestDayOutcome
  | BlockedRequestDayOutcome
  | UnsatisfiedRequestDayOutcome;

export type RequestDayOutcome =
  | QualityEligibleRequestDayOutcome
  | InvalidRequestDayOutcome
  | ConflictRequestDayOutcome;

// ---------------------------------------------------------------------------
// Exact Model B quality vector and JSON-safe form
// ---------------------------------------------------------------------------

export interface RequestQuality {
  readonly version: typeof REQUEST_QUALITY_VERSION;
  readonly essentialFulfillment: ExactRational;
  readonly normalFulfillment: ExactRational;
  /** Derived display/legacy compatibility only; never an ordering authority. */
  readonly requestSatisfactionPercent: number;
}

export interface SerializedRequestQuality {
  readonly version: typeof REQUEST_QUALITY_VERSION;
  readonly essentialFulfillment: SerializedExactRational;
  readonly normalFulfillment: SerializedExactRational;
  /** Derived display/legacy compatibility only; never an ordering authority. */
  readonly requestSatisfactionPercent: number;
}

function assertDisplayPercent(value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError('requestSatisfactionPercent must be a finite number from 0 to 100');
  }
}

/** Convert the bigint quality vector to its JSON-safe persistence form. */
export function serializeRequestQuality(
  quality: Readonly<RequestQuality>
): SerializedRequestQuality {
  if (quality.version !== REQUEST_QUALITY_VERSION) {
    throw new RangeError(`Unsupported request quality version: ${String(quality.version)}`);
  }
  assertDisplayPercent(quality.requestSatisfactionPercent);

  return {
    version: REQUEST_QUALITY_VERSION,
    essentialFulfillment: serializeExactRational(quality.essentialFulfillment),
    normalFulfillment: serializeExactRational(quality.normalFulfillment),
    requestSatisfactionPercent: quality.requestSatisfactionPercent,
  };
}

/** Restore the authoritative bigint vector from its JSON-safe form. */
export function deserializeRequestQuality(
  quality: Readonly<SerializedRequestQuality>
): RequestQuality {
  if (!quality || typeof quality !== 'object') {
    throw new TypeError('SerializedRequestQuality must be an object');
  }
  if (quality.version !== REQUEST_QUALITY_VERSION) {
    throw new RangeError(`Unsupported request quality version: ${String(quality.version)}`);
  }
  assertDisplayPercent(quality.requestSatisfactionPercent);

  return {
    version: REQUEST_QUALITY_VERSION,
    essentialFulfillment: deserializeExactRational(quality.essentialFulfillment),
    normalFulfillment: deserializeExactRational(quality.normalFulfillment),
    requestSatisfactionPercent: quality.requestSatisfactionPercent,
  };
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

/**
 * Complete month-specific audit artifact. The fingerprint is calculated from
 * the contract version, target year/month, and sorted canonical request days;
 * fingerprint generation and persistence wiring are intentionally out of scope
 * for this incremental step.
 */
export interface RequestOutcomeLedger {
  readonly version: typeof REQUEST_OUTCOME_LEDGER_VERSION;
  readonly year: number;
  readonly month: number;
  readonly requestSetFingerprint: string;
  readonly outcomes: ReadonlyArray<QualityEligibleRequestDayOutcome>;
  readonly requestIssues: ReadonlyArray<RequestValidationIssue>;
}
