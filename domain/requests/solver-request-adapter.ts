/**
 * Narrow compatibility boundary from canonical request-days to the existing
 * solver/hard-legality APIs. Semantic validation and expansion stay upstream.
 */

import type { ShiftRequest } from '../../lib/types';
import type {
  CanonicalRequestDay,
  RequestValidationIssue,
} from './request-domain';
import type { CanonicalRequestMonthResult } from './request-canonicalizer';

export const REQUEST_GENERATION_BLOCKED_ERROR_NAME = 'RequestGenerationBlockedError';

/** Existing callers already handle Error; this subtype retains machine issues. */
export class RequestGenerationBlockedError extends Error {
  readonly issues: ReadonlyArray<RequestValidationIssue>;

  constructor(result: Readonly<CanonicalRequestMonthResult>) {
    const summary = result.issues
      .map(issue => `${issue.kind}:${issue.reason}:${issue.requestIds.join(',') || 'unknown'}`)
      .join('|');
    super(`Request generation blocked by canonical validation${summary ? ` (${summary})` : ''}`);
    this.name = REQUEST_GENERATION_BLOCKED_ERROR_NAME;
    this.issues = result.issues;
  }
}

export interface SolverRequestView {
  readonly monthResult: CanonicalRequestMonthResult;
  readonly requestDays: ReadonlyArray<CanonicalRequestDay>;
  /** One authoritative positive obligation per person/day. */
  readonly positiveByCell: ReadonlyMap<string, CanonicalRequestDay>;
  /** Zero or more negative avoid obligations per person/day. */
  readonly negativeByCell: ReadonlyMap<string, ReadonlyArray<CanonicalRequestDay>>;
  /** Canonical one-day projection for unchanged hard/repair/verification APIs. */
  readonly compatibilityRequests: ReadonlyArray<ShiftRequest>;
  readonly explicitWorkPersonnelIds: ReadonlySet<string>;
  readonly patternPersonnelIds: ReadonlySet<string>;
  positiveFor(personnelId: string, day: number): CanonicalRequestDay | undefined;
  negativeFor(personnelId: string, day: number): ReadonlyArray<CanonicalRequestDay>;
}

function cellKey(personnelId: string, day: number): string {
  return `${personnelId}\u0000${day}`;
}

function toCompatibilityRequest(requestDay: Readonly<CanonicalRequestDay>): ShiftRequest {
  const base = {
    id: requestDay.requestId,
    personnelId: requestDay.personnelId,
    requestType: requestDay.requestType,
    isEssential: requestDay.isEssential,
    scope: 'custom_days' as const,
    selectedDays: [requestDay.day],
  };

  if (requestDay.requestType === 'pattern') {
    return {
      ...base,
      patternSteps: [requestDay.expectedValue],
    };
  }
  if (requestDay.requestType === 'OFF') {
    return {
      ...base,
      preferredShift: 'OFF',
      offHardness: requestDay.offHardness,
    };
  }
  if (requestDay.requestType === 'leave') {
    return {
      ...base,
      preferredShift: 'L',
    };
  }
  return {
    ...base,
    preferredShift: requestDay.expectedValue,
  };
}

/**
 * Reject blocked months and expose canonical obligations in solver-friendly maps.
 * No scope matching, pattern calculation, value parsing, or precedence occurs here.
 */
export function adaptCanonicalRequestMonthForSolver(
  result: Readonly<CanonicalRequestMonthResult>
): SolverRequestView {
  if (result.generationBlocked) throw new RequestGenerationBlockedError(result);

  const positiveByCell = new Map<string, CanonicalRequestDay>();
  const negativeMutable = new Map<string, CanonicalRequestDay[]>();
  const explicitWorkPersonnelIds = new Set<string>();
  const patternPersonnelIds = new Set<string>();

  for (const requestDay of result.requestDays) {
    const key = cellKey(requestDay.personnelId, requestDay.day);
    if (requestDay.polarity === 'POSITIVE') {
      if (positiveByCell.has(key)) {
        throw new Error(`Canonical invariant violated: multiple positive requests for ${requestDay.personnelId} day ${requestDay.day}`);
      }
      positiveByCell.set(key, requestDay);
    } else {
      const existing = negativeMutable.get(key) ?? [];
      existing.push(requestDay);
      negativeMutable.set(key, existing);
    }
    if (requestDay.requestType === 'shift' || requestDay.requestType === 'pattern') {
      explicitWorkPersonnelIds.add(requestDay.personnelId);
    }
    if (requestDay.requestType === 'pattern') {
      patternPersonnelIds.add(requestDay.personnelId);
    }
  }

  const negativeByCell = new Map<string, ReadonlyArray<CanonicalRequestDay>>(
    [...negativeMutable].map(([key, requestDays]) => [key, [...requestDays]])
  );
  const requestDays = [...result.requestDays];
  const compatibilityRequests = requestDays.map(toCompatibilityRequest);

  return {
    monthResult: result as CanonicalRequestMonthResult,
    requestDays,
    positiveByCell,
    negativeByCell,
    compatibilityRequests,
    explicitWorkPersonnelIds,
    patternPersonnelIds,
    positiveFor: (personnelId, day) => positiveByCell.get(cellKey(personnelId, day)),
    negativeFor: (personnelId, day) => negativeByCell.get(cellKey(personnelId, day)) ?? [],
  };
}
