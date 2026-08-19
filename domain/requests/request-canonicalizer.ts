/**
 * Authoritative month-specific canonical request-day expansion (Phase 6, Step 4).
 *
 * This boundary answers only which concrete obligation exists on each day. It
 * does not evaluate assignments, satisfaction, outcomes, provenance, or quality.
 */

import type { ShiftRequest } from '../../lib/types';
import {
  detectCanonicalRequestDayConflicts,
  expandValidatedRequestDays,
  type CanonicalizableRequest,
} from './request-day-expansion';
import type {
  CanonicalRequestDay,
  RequestValidationIssue,
} from './request-domain';
import {
  validateRequestsSemantically,
  type RequestSemanticValidationContext,
} from './request-semantic-validator';

export const CANONICAL_REQUEST_MONTH_VERSION = 'canonical-request-month/1' as const;

export interface CanonicalRequestMonthResult {
  readonly version: typeof CANONICAL_REQUEST_MONTH_VERSION;
  readonly year: number;
  readonly month: number;
  /** Valid obligations only; conflicting positive request IDs are excluded. */
  readonly requestDays: ReadonlyArray<CanonicalRequestDay>;
  /** Step 3 INVALID issues plus conflicts verified from expanded request-days. */
  readonly issues: ReadonlyArray<RequestValidationIssue>;
  readonly generationBlocked: boolean;
  readonly validRequestIds: ReadonlyArray<string>;
  readonly invalidRequestIds: ReadonlyArray<string>;
  readonly conflictingRequestIds: ReadonlyArray<string>;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function asCanonicalizableRequest(request: Readonly<ShiftRequest>): CanonicalizableRequest {
  return {
    id: request.id,
    personnelId: request.personnelId,
    requestType: request.requestType,
    preferredShift: request.preferredShift,
    patternSteps: request.patternSteps as CanonicalizableRequest['patternSteps'],
    isEssential: request.isEssential,
    offHardness: request.offHardness,
    scope: request.scope,
    startDate: request.startDate,
    endDate: request.endDate,
    selectedDays: request.selectedDays,
  };
}

/**
 * Expand valid requests for one authoritative month calendar. INVALID and
 * CONFLICT issues are retained, while their positive records are not emitted.
 */
export function canonicalizeRequestDaysForMonth(
  requests: ReadonlyArray<ShiftRequest>,
  context: Readonly<RequestSemanticValidationContext>
): CanonicalRequestMonthResult {
  const validation = validateRequestsSemantically(requests, context);
  const expandableIds = new Set([
    ...validation.validRequestIds,
    ...validation.conflictingRequestIds,
  ]);
  const expandableRequests = requests
    .filter(request => expandableIds.has(request.id))
    .map(asCanonicalizableRequest);

  const expanded = expandValidatedRequestDays(expandableRequests, {
    year: context.year,
    month: context.month,
    calendarDays: context.calendarDays,
  });
  const verifiedConflicts = detectCanonicalRequestDayConflicts(expanded, context);
  const conflictingRequestIds = sortedUnique(
    verifiedConflicts.flatMap(issue => issue.requestIds)
  );
  const conflictingIdSet = new Set(conflictingRequestIds);

  // Preserve all valid negative obligations. Positive records participating in
  // any conflict remain represented by their CONFLICT issue, never as rankable
  // canonical obligations.
  const requestDays = expanded.filter(requestDay =>
    requestDay.polarity === 'NEGATIVE'
    || !conflictingIdSet.has(requestDay.requestId)
  );
  const invalidIssues = validation.issues.filter(issue => issue.kind === 'INVALID');
  const issues: RequestValidationIssue[] = [
    ...invalidIssues,
    ...verifiedConflicts,
  ];
  const validRequestIds = validation.validRequestIds
    .filter(requestId => !conflictingIdSet.has(requestId))
    .sort(compareStrings);

  return {
    version: CANONICAL_REQUEST_MONTH_VERSION,
    year: context.year,
    month: context.month,
    requestDays,
    issues,
    generationBlocked: issues.length > 0,
    validRequestIds,
    invalidRequestIds: validation.invalidRequestIds,
    conflictingRequestIds,
  };
}
