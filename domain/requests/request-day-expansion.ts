/**
 * Shared month-specific request-day expansion and positive-conflict detection.
 *
 * Inputs to this module have already passed semantic validation. It performs no
 * satisfaction or assignment evaluation and never mutates source requests.
 */

import type { RequestType, ShiftType } from '../../lib/types';
import { shiftComponents } from '../scheduling/workload';
import {
  CANONICAL_REQUEST_DAY_VERSION,
  REQUEST_CONFLICT_REASONS,
  REQUEST_VALIDATION_ISSUE_VERSION,
  type CanonicalRequestDay,
  type CanonicalRequestValue,
  type ConflictRequestValidationIssue,
  type RequestComponent,
  type RequestConflictReason,
  type RequestPolarity,
} from './request-domain';
import { isDayInRequestScope, patternStepForDay } from './request-scope-matcher';

export interface CanonicalizableRequest {
  readonly id: string;
  readonly personnelId: string;
  readonly requestType: RequestType;
  readonly preferredShift?: CanonicalRequestValue;
  readonly patternSteps?: ReadonlyArray<CanonicalRequestValue>;
  readonly isEssential: boolean;
  readonly offHardness?: 'hard' | 'soft';
  readonly scope:
    | 'all'
    | 'even'
    | 'odd'
    | 'saturdays'
    | 'sundays'
    | 'mondays'
    | 'tuesdays'
    | 'wednesdays'
    | 'thursdays'
    | 'fridays'
    | 'range'
    | 'weekly_even'
    | 'weekly_odd'
    | 'custom_days';
  readonly startDate?: string;
  readonly endDate?: string;
  readonly selectedDays?: ReadonlyArray<number>;
}

export interface RequestDayExpansionCalendarDay {
  readonly day: number;
  readonly dayOfWeek: number;
}

export interface RequestDayExpansionContext {
  readonly year: number;
  readonly month: number;
  readonly calendarDays: ReadonlyArray<RequestDayExpansionCalendarDay>;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Stable canonical order: person → day → request ID → semantic secondary keys. */
export function compareCanonicalRequestDays(
  left: Readonly<CanonicalRequestDay>,
  right: Readonly<CanonicalRequestDay>
): number {
  const personnelOrder = compareStrings(left.personnelId, right.personnelId);
  if (personnelOrder !== 0) return personnelOrder;
  if (left.day !== right.day) return left.day - right.day;
  const requestOrder = compareStrings(left.requestId, right.requestId);
  if (requestOrder !== 0) return requestOrder;
  const typeOrder = compareStrings(left.requestType, right.requestType);
  if (typeOrder !== 0) return typeOrder;
  const valueOrder = compareStrings(left.expectedValue, right.expectedValue);
  if (valueOrder !== 0) return valueOrder;
  return compareStrings(left.polarity, right.polarity);
}

/**
 * Canonical components for one already-validated request value.
 * Work values reuse the workload model's parser; OFF and L remain named
 * non-work components rather than being treated as an empty work set.
 */
export function canonicalRequestComponents(
  expectedValue: CanonicalRequestValue
): RequestComponent[] {
  if (expectedValue === 'OFF' || expectedValue === 'L') return [expectedValue];
  const components = [...shiftComponents(expectedValue as ShiftType)];
  if (components.length === 0) {
    throw new RangeError(`Unsupported canonical request value: ${expectedValue}`);
  }
  return components;
}

function expectedValueForDay(
  request: Readonly<CanonicalizableRequest>,
  day: number,
  dayOfWeek: number
): CanonicalRequestValue {
  if (request.requestType === 'pattern') {
    const step = patternStepForDay(
      request as unknown as Parameters<typeof patternStepForDay>[0],
      day,
      dayOfWeek
    );
    if (!step) {
      throw new RangeError(`Validated pattern ${request.id} has no value for day ${day}`);
    }
    return step as CanonicalRequestValue;
  }
  if (request.requestType === 'OFF') return 'OFF';
  if (request.requestType === 'leave') return 'L';
  if (!request.preferredShift) {
    throw new RangeError(`Validated request ${request.id} has no preferred shift`);
  }
  return request.preferredShift;
}

/** Expand semantically valid requests into deterministic month-specific days. */
export function expandValidatedRequestDays(
  requests: ReadonlyArray<CanonicalizableRequest>,
  context: Readonly<RequestDayExpansionContext>
): CanonicalRequestDay[] {
  const expanded: CanonicalRequestDay[] = [];

  for (const request of requests) {
    const polarity: RequestPolarity = request.requestType === 'avoid_shift'
      ? 'NEGATIVE'
      : 'POSITIVE';

    for (const calendarDay of context.calendarDays) {
      if (!isDayInRequestScope(
        calendarDay.day,
        calendarDay.dayOfWeek,
        request as unknown as Parameters<typeof isDayInRequestScope>[2]
      )) continue;
      const expectedValue = expectedValueForDay(
        request,
        calendarDay.day,
        calendarDay.dayOfWeek
      );
      expanded.push({
        version: CANONICAL_REQUEST_DAY_VERSION,
        requestId: request.id,
        personnelId: request.personnelId,
        year: context.year,
        month: context.month,
        day: calendarDay.day,
        requestType: request.requestType,
        expectedValue,
        isEssential: request.isEssential,
        polarity,
        requestedComponents: canonicalRequestComponents(expectedValue),
        ...(request.requestType === 'OFF' && request.offHardness !== undefined
          ? { offHardness: request.offHardness }
          : {}),
      });
    }
  }

  return expanded.sort(compareCanonicalRequestDays);
}

interface PendingConflict {
  readonly reason: RequestConflictReason;
  readonly personnelId: string;
  readonly requestIds: readonly [string, string];
  readonly essentialFlags: readonly [
    { readonly requestId: string; readonly isEssential: boolean },
    { readonly requestId: string; readonly isEssential: boolean },
  ];
  readonly days: Set<number>;
}

function positiveIntentKey(requestDay: Readonly<CanonicalRequestDay>): string {
  if (requestDay.requestType === 'pattern' && requestDay.expectedValue === 'OFF') {
    return 'PATTERN_OFF';
  }
  if (requestDay.requestType === 'pattern' && requestDay.expectedValue === 'L') {
    return 'PATTERN_LEAVE';
  }
  if (requestDay.requestType === 'OFF') return 'REGULAR_OFF';
  if (requestDay.requestType === 'leave') return 'REGULAR_LEAVE';
  return `WORK:${requestDay.expectedValue}`;
}

function conflictAccumulatorKey(
  reason: RequestConflictReason,
  personnelId: string,
  requestIds: readonly [string, string]
): string {
  return JSON.stringify([reason, personnelId, requestIds[0], requestIds[1]]);
}

function stableConflictId(
  reason: RequestConflictReason,
  personnelId: string,
  requestIds: readonly [string, string],
  days: ReadonlyArray<number>
): string {
  const encodedIds = requestIds.map(id => encodeURIComponent(id)).join('+');
  return [
    'request-conflict/1',
    reason,
    encodeURIComponent(personnelId),
    encodedIds,
    days.join('.'),
  ].join('/');
}

const CONFLICT_REASON_ORDER = new Map(
  REQUEST_CONFLICT_REASONS.map((reason, index) => [reason, index])
);

function compareConflictIssues(
  left: Readonly<ConflictRequestValidationIssue>,
  right: Readonly<ConflictRequestValidationIssue>
): number {
  const reasonOrder = CONFLICT_REASON_ORDER.get(left.reason)!
    - CONFLICT_REASON_ORDER.get(right.reason)!;
  if (reasonOrder !== 0) return reasonOrder;
  const personnelOrder = compareStrings(left.personnelId ?? '', right.personnelId ?? '');
  if (personnelOrder !== 0) return personnelOrder;
  const requestOrder = compareStrings(
    left.requestIds.join('\u0000'),
    right.requestIds.join('\u0000')
  );
  if (requestOrder !== 0) return requestOrder;
  return compareStrings((left.days ?? []).join(','), (right.days ?? []).join(','));
}

/**
 * Detect pairwise collisions among POSITIVE expanded obligations only.
 * Essentiality is copied into evidence and never used for precedence.
 */
export function detectCanonicalRequestDayConflicts(
  requestDays: ReadonlyArray<CanonicalRequestDay>,
  context: Readonly<Pick<RequestDayExpansionContext, 'year' | 'month'>>
): ConflictRequestValidationIssue[] {
  const positiveByCell = new Map<string, CanonicalRequestDay[]>();

  for (const requestDay of requestDays) {
    if (requestDay.polarity !== 'POSITIVE') continue;
    const cellKey = JSON.stringify([requestDay.personnelId, requestDay.day]);
    const existing = positiveByCell.get(cellKey) ?? [];
    existing.push(requestDay);
    positiveByCell.set(cellKey, existing);
  }

  const pending = new Map<string, PendingConflict>();
  const cells = [...positiveByCell.values()].sort((left, right) => {
    const personnelOrder = compareStrings(left[0].personnelId, right[0].personnelId);
    return personnelOrder || left[0].day - right[0].day;
  });

  for (const cell of cells) {
    const sorted = [...cell].sort(compareCanonicalRequestDays);
    for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
        const left = sorted[leftIndex];
        const right = sorted[rightIndex];
        if (left.requestId === right.requestId) continue;

        const requestIds = [left.requestId, right.requestId] as const;
        const essentialFlags = [
          { requestId: left.requestId, isEssential: left.isEssential },
          { requestId: right.requestId, isEssential: right.isEssential },
        ] as const;
        const reason: RequestConflictReason = positiveIntentKey(left) === positiveIntentKey(right)
          ? 'DUPLICATE_POSITIVE_INTENT'
          : 'OVERLAPPING_POSITIVE_INTENT';
        const key = conflictAccumulatorKey(reason, left.personnelId, requestIds);
        const existing = pending.get(key);
        if (existing) {
          existing.days.add(left.day);
        } else {
          pending.set(key, {
            reason,
            personnelId: left.personnelId,
            requestIds,
            essentialFlags,
            days: new Set([left.day]),
          });
        }
      }
    }
  }

  return [...pending.values()]
    .map(conflict => {
      const days = [...conflict.days].sort((left, right) => left - right);
      return {
        version: REQUEST_VALIDATION_ISSUE_VERSION,
        kind: 'CONFLICT' as const,
        reason: conflict.reason,
        conflictId: stableConflictId(
          conflict.reason,
          conflict.personnelId,
          conflict.requestIds,
          days
        ),
        year: context.year,
        month: context.month,
        requestIds: [...conflict.requestIds],
        personnelId: conflict.personnelId,
        days,
        essentialFlags: [...conflict.essentialFlags],
      };
    })
    .sort(compareConflictIssues);
}
