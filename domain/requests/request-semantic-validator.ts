/**
 * Canonical semantic validation for persisted and newly-created requests.
 *
 * This layer is intentionally separate from the structural Zod storage schemas:
 * storage parsing preserves records, while this validator classifies semantic
 * INVALID and CONFLICT states without repairing or reordering source data.
 *
 * It does not compile CanonicalRequestDay values and does not call the solver.
 */

import { isValidJalaaliDate } from 'jalaali-js';

import type { Personnel, RequestType, ShiftRequest } from '../../lib/types';
import {
  REQUEST_CONFLICT_REASONS,
  REQUEST_INVALID_REASONS,
  REQUEST_VALIDATION_ISSUE_VERSION,
  type InvalidRequestValidationIssue,
  type RequestInvalidReason,
  type RequestValidationIssue,
} from './request-domain';
import {
  detectCanonicalRequestDayConflicts,
  expandValidatedRequestDays,
  type CanonicalizableRequest,
} from './request-day-expansion';
import { isDayInRequestScope } from './request-scope-matcher';

export const SEMANTIC_REQUEST_TYPES = ['shift', 'OFF', 'leave', 'pattern', 'avoid_shift'] as const;
export const SEMANTIC_REQUEST_SCOPES = [
  'all',
  'even',
  'odd',
  'saturdays',
  'sundays',
  'mondays',
  'tuesdays',
  'wednesdays',
  'thursdays',
  'fridays',
  'range',
  'weekly_even',
  'weekly_odd',
  'custom_days',
] as const;
export const SEMANTIC_WORK_SHIFT_VALUES = ['M', 'E', 'N', 'ME', 'EN', 'MN', 'MEN'] as const;
export const SEMANTIC_PATTERN_STEP_VALUES = [
  ...SEMANTIC_WORK_SHIFT_VALUES,
  'OFF',
  'L',
] as const;

export type SemanticRequestScope = (typeof SEMANTIC_REQUEST_SCOPES)[number];
export type SemanticWorkShiftValue = (typeof SEMANTIC_WORK_SHIFT_VALUES)[number];
export type SemanticPatternStepValue = (typeof SEMANTIC_PATTERN_STEP_VALUES)[number];

export interface RequestSemanticValidationCalendarDay {
  readonly day: number;
  readonly dayOfWeek: number;
}

/** The caller supplies the target month's already-authoritative calendar. */
export interface RequestSemanticValidationContext {
  readonly year: number;
  readonly month: number;
  readonly calendarDays: ReadonlyArray<RequestSemanticValidationCalendarDay>;
  /** When omitted, personnel-reference validation is intentionally skipped. */
  readonly personnel?: ReadonlyArray<Pick<Personnel, 'id'>>;
}

export interface RequestSemanticValidationResult {
  /** True only when there are no INVALID or CONFLICT issues. */
  readonly valid: boolean;
  /** Defensive generation gate for a future integration boundary. */
  readonly generationBlocked: boolean;
  /** Deterministically sorted machine-readable issues. */
  readonly issues: ReadonlyArray<RequestValidationIssue>;
  /** IDs whose records are semantically valid and do not participate in conflict. */
  readonly validRequestIds: ReadonlyArray<string>;
  readonly invalidRequestIds: ReadonlyArray<string>;
  readonly conflictingRequestIds: ReadonlyArray<string>;
}

type UnknownRecord = Record<string, unknown>;

interface ValidationEntry {
  readonly record: UnknownRecord;
  readonly requestId: string | null;
  readonly personnelId: string | null;
  readonly invalidReasons: Set<RequestInvalidReason>;
}

type ValidSemanticRequest = CanonicalizableRequest;

const REQUEST_TYPE_SET: ReadonlySet<string> = new Set(SEMANTIC_REQUEST_TYPES);
const REQUEST_SCOPE_SET: ReadonlySet<string> = new Set(SEMANTIC_REQUEST_SCOPES);
const WORK_SHIFT_SET: ReadonlySet<string> = new Set(SEMANTIC_WORK_SHIFT_VALUES);
const PATTERN_STEP_SET: ReadonlySet<string> = new Set(SEMANTIC_PATTERN_STEP_VALUES);
const INVALID_REASON_ORDER = new Map(REQUEST_INVALID_REASONS.map((reason, index) => [reason, index]));
const CONFLICT_REASON_ORDER = new Map(REQUEST_CONFLICT_REASONS.map((reason, index) => [reason, index]));
const JALALI_DATE = /^(\d{4})\/(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])$/;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function assertValidationContext(
  context: Readonly<RequestSemanticValidationContext>
): RequestSemanticValidationCalendarDay[] {
  if (!Number.isInteger(context.year)) {
    throw new TypeError('Request validation year must be an integer');
  }
  if (!Number.isInteger(context.month) || context.month < 1 || context.month > 12) {
    throw new RangeError('Request validation month must be an integer from 1 to 12');
  }
  if (!Array.isArray(context.calendarDays) || context.calendarDays.length === 0) {
    throw new RangeError('Request validation calendarDays must not be empty');
  }

  const calendar = [...context.calendarDays].sort((left, right) => left.day - right.day);
  for (let index = 0; index < calendar.length; index += 1) {
    const item = calendar[index];
    if (!Number.isInteger(item.day) || item.day !== index + 1) {
      throw new RangeError('Request validation calendar days must be unique and contiguous from day 1');
    }
    if (!Number.isInteger(item.dayOfWeek) || item.dayOfWeek < 0 || item.dayOfWeek > 6) {
      throw new RangeError('Request validation dayOfWeek must be an integer from 0 to 6');
    }
  }
  return calendar;
}

interface ParsedJalaliDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

function parseJalaliDate(value: unknown): ParsedJalaliDate | null {
  if (typeof value !== 'string') return null;
  const match = JALALI_DATE.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidJalaaliDate(year, month, day)) return null;
  return { year, month, day };
}

function isKnownRequestType(value: unknown): value is RequestType {
  return typeof value === 'string' && REQUEST_TYPE_SET.has(value);
}

function isKnownScope(value: unknown): value is SemanticRequestScope {
  return typeof value === 'string' && REQUEST_SCOPE_SET.has(value);
}

function makeInvalidIssue(
  entry: ValidationEntry,
  reason: RequestInvalidReason,
  context: Readonly<RequestSemanticValidationContext>,
  days?: ReadonlyArray<number>
): InvalidRequestValidationIssue {
  return {
    version: REQUEST_VALIDATION_ISSUE_VERSION,
    kind: 'INVALID',
    reason,
    year: context.year,
    month: context.month,
    requestIds: entry.requestId ? [entry.requestId] : [],
    ...(entry.personnelId ? { personnelId: entry.personnelId } : {}),
    ...(days && days.length > 0 ? { days: [...days].sort((left, right) => left - right) } : {}),
  };
}

function addInvalidIssue(
  issues: InvalidRequestValidationIssue[],
  entry: ValidationEntry,
  reason: RequestInvalidReason,
  context: Readonly<RequestSemanticValidationContext>,
  days?: ReadonlyArray<number>
): void {
  if (entry.invalidReasons.has(reason)) return;
  entry.invalidReasons.add(reason);
  issues.push(makeInvalidIssue(entry, reason, context, days));
}

function validateScope(
  entry: ValidationEntry,
  context: Readonly<RequestSemanticValidationContext>,
  calendar: ReadonlyArray<RequestSemanticValidationCalendarDay>,
  issues: InvalidRequestValidationIssue[]
): SemanticRequestScope | null {
  const { record } = entry;
  if (!isKnownScope(record.scope)) {
    addInvalidIssue(issues, entry, 'INVALID_SCOPE', context);
    return null;
  }

  const scope = record.scope;
  if (scope === 'range') {
    if (record.selectedDays !== undefined) {
      addInvalidIssue(issues, entry, 'INVALID_SCOPE', context);
      return null;
    }

    const start = parseJalaliDate(record.startDate);
    const end = parseJalaliDate(record.endDate);
    if (
      !start
      || !end
      || start.year !== end.year
      || start.month !== end.month
      || start.day > end.day
    ) {
      addInvalidIssue(issues, entry, 'INVALID_DATE_RANGE', context);
      return null;
    }
    if (start.year !== context.year || start.month !== context.month) {
      addInvalidIssue(issues, entry, 'EMPTY_EFFECTIVE_SCOPE', context);
      return null;
    }
  } else if (scope === 'custom_days') {
    if (record.startDate !== undefined || record.endDate !== undefined) {
      addInvalidIssue(issues, entry, 'INVALID_SCOPE', context);
      return null;
    }
    if (!Array.isArray(record.selectedDays) || record.selectedDays.length === 0) {
      addInvalidIssue(issues, entry, 'EMPTY_EFFECTIVE_SCOPE', context);
      return null;
    }

    const selectedDays = record.selectedDays;
    const distinctDays = new Set<number>();
    const invalidDays: number[] = [];
    for (const value of selectedDays) {
      if (!Number.isInteger(value) || value < 1 || value > calendar.length || distinctDays.has(value)) {
        if (typeof value === 'number' && Number.isFinite(value)) invalidDays.push(value);
      } else {
        distinctDays.add(value);
      }
    }
    if (invalidDays.length > 0 || distinctDays.size !== selectedDays.length) {
      addInvalidIssue(issues, entry, 'INVALID_SELECTED_DAY', context, invalidDays);
      return null;
    }
  } else if (
    record.startDate !== undefined
    || record.endDate !== undefined
    || record.selectedDays !== undefined
  ) {
    addInvalidIssue(issues, entry, 'INVALID_SCOPE', context);
    return null;
  }

  const request = record as unknown as ShiftRequest;
  const hasEffectiveDay = calendar.some(item =>
    isDayInRequestScope(item.day, item.dayOfWeek, request)
  );
  if (!hasEffectiveDay) {
    addInvalidIssue(issues, entry, 'EMPTY_EFFECTIVE_SCOPE', context);
    return null;
  }

  return scope;
}

function validateRequestValue(
  entry: ValidationEntry,
  requestType: RequestType,
  context: Readonly<RequestSemanticValidationContext>,
  issues: InvalidRequestValidationIssue[]
): void {
  const { record } = entry;
  const preferred = record.preferredShift;

  if (requestType === 'shift' || requestType === 'avoid_shift') {
    if (preferred === undefined || preferred === null || preferred === '') {
      addInvalidIssue(issues, entry, 'MISSING_PREFERRED_SHIFT', context);
    } else if (typeof preferred !== 'string' || !WORK_SHIFT_SET.has(preferred)) {
      addInvalidIssue(issues, entry, 'INVALID_PREFERRED_SHIFT', context);
    }
  } else if (requestType === 'OFF') {
    // requestType carries the OFF intent; preferredShift is legacy-optional.
    if (preferred !== undefined && preferred !== 'OFF') {
      addInvalidIssue(issues, entry, 'INVALID_PREFERRED_SHIFT', context);
    }
  } else if (requestType === 'leave') {
    // requestType carries the leave intent; preferredShift is legacy-optional.
    if (preferred !== undefined && preferred !== 'L') {
      addInvalidIssue(issues, entry, 'INVALID_PREFERRED_SHIFT', context);
    }
  } else if (preferred !== undefined) {
    // Pattern values come only from patternSteps; an extra scalar value is ambiguous.
    addInvalidIssue(issues, entry, 'INVALID_PREFERRED_SHIFT', context);
  }

  if (requestType === 'pattern') {
    if (!Array.isArray(record.patternSteps) || record.patternSteps.length === 0) {
      addInvalidIssue(issues, entry, 'EMPTY_PATTERN', context);
    } else if (record.patternSteps.some(step => typeof step !== 'string' || !PATTERN_STEP_SET.has(step))) {
      addInvalidIssue(issues, entry, 'INVALID_PATTERN_STEP', context);
    }
  } else if (record.patternSteps !== undefined) {
    addInvalidIssue(issues, entry, 'INVALID_PATTERN_STEP', context);
  }
}

function toValidSemanticRequest(entry: ValidationEntry): ValidSemanticRequest {
  const record = entry.record;
  return {
    id: entry.requestId!,
    personnelId: entry.personnelId!,
    requestType: record.requestType as RequestType,
    isEssential: record.isEssential as boolean,
    ...(record.offHardness !== undefined
      ? { offHardness: record.offHardness as 'hard' | 'soft' }
      : {}),
    ...(record.preferredShift !== undefined
      ? { preferredShift: record.preferredShift as ValidSemanticRequest['preferredShift'] }
      : {}),
    ...(record.patternSteps !== undefined
      ? { patternSteps: record.patternSteps as SemanticPatternStepValue[] }
      : {}),
    scope: record.scope as SemanticRequestScope,
    ...(record.startDate !== undefined ? { startDate: record.startDate as string } : {}),
    ...(record.endDate !== undefined ? { endDate: record.endDate as string } : {}),
    ...(record.selectedDays !== undefined ? { selectedDays: record.selectedDays as number[] } : {}),
  };
}

function compareValidationIssues(left: RequestValidationIssue, right: RequestValidationIssue): number {
  if (left.kind !== right.kind) return left.kind === 'INVALID' ? -1 : 1;

  const leftReasonOrder = left.kind === 'INVALID'
    ? INVALID_REASON_ORDER.get(left.reason)!
    : CONFLICT_REASON_ORDER.get(left.reason)!;
  const rightReasonOrder = right.kind === 'INVALID'
    ? INVALID_REASON_ORDER.get(right.reason)!
    : CONFLICT_REASON_ORDER.get(right.reason)!;
  if (leftReasonOrder !== rightReasonOrder) return leftReasonOrder - rightReasonOrder;

  const personnelOrder = compareStrings(left.personnelId ?? '', right.personnelId ?? '');
  if (personnelOrder !== 0) return personnelOrder;
  const idOrder = compareStrings(left.requestIds.join('\u0000'), right.requestIds.join('\u0000'));
  if (idOrder !== 0) return idOrder;
  return compareStrings((left.days ?? []).join(','), (right.days ?? []).join(','));
}

/**
 * Validate request semantics without mutating, normalizing, or silently repairing
 * any source record. Output is deterministic and independent of input order.
 */
export function validateRequestsSemantically(
  requests: ReadonlyArray<unknown>,
  context: Readonly<RequestSemanticValidationContext>
): RequestSemanticValidationResult {
  const calendar = assertValidationContext(context);
  const personnelIds = context.personnel
    ? new Set(context.personnel.map(person => person.id))
    : null;

  const entries: ValidationEntry[] = requests.map(raw => {
    const record = asRecord(raw);
    return {
      record,
      requestId: nonEmptyString(record.id),
      personnelId: nonEmptyString(record.personnelId),
      invalidReasons: new Set<RequestInvalidReason>(),
    };
  });

  const invalidIssues: InvalidRequestValidationIssue[] = [];
  const entriesById = new Map<string, ValidationEntry[]>();
  for (const entry of entries) {
    if (!entry.requestId) continue;
    const grouped = entriesById.get(entry.requestId) ?? [];
    grouped.push(entry);
    entriesById.set(entry.requestId, grouped);
  }

  for (const [requestId, duplicated] of entriesById) {
    if (duplicated.length < 2) continue;
    const personnel = sortedUnique(
      duplicated.flatMap(entry => entry.personnelId ? [entry.personnelId] : [])
    );
    duplicated.forEach(entry => entry.invalidReasons.add('DUPLICATE_REQUEST_ID'));
    invalidIssues.push({
      version: REQUEST_VALIDATION_ISSUE_VERSION,
      kind: 'INVALID',
      reason: 'DUPLICATE_REQUEST_ID',
      year: context.year,
      month: context.month,
      requestIds: [requestId],
      ...(personnel.length === 1 ? { personnelId: personnel[0] } : {}),
    });
  }

  for (const entry of entries) {
    const { record } = entry;
    if (!entry.requestId) {
      addInvalidIssue(invalidIssues, entry, 'MISSING_REQUEST_ID', context);
    }
    if (!entry.personnelId) {
      addInvalidIssue(invalidIssues, entry, 'MISSING_PERSONNEL_ID', context);
    } else if (personnelIds && !personnelIds.has(entry.personnelId)) {
      addInvalidIssue(invalidIssues, entry, 'UNKNOWN_PERSONNEL', context);
    }

    const requestType = isKnownRequestType(record.requestType) ? record.requestType : null;
    if (!requestType) {
      addInvalidIssue(invalidIssues, entry, 'INVALID_REQUEST_TYPE', context);
    } else {
      validateRequestValue(entry, requestType, context, invalidIssues);
    }

    validateScope(entry, context, calendar, invalidIssues);
  }

  const semanticallyValid = entries
    .filter(entry => entry.invalidReasons.size === 0)
    .map(toValidSemanticRequest)
    .sort((left, right) => compareStrings(left.id, right.id));
  const expandedRequestDays = expandValidatedRequestDays(semanticallyValid, {
    year: context.year,
    month: context.month,
    calendarDays: calendar,
  });
  const conflictIssues = detectCanonicalRequestDayConflicts(expandedRequestDays, context);
  const conflictingRequestIds = sortedUnique(
    conflictIssues.flatMap(issue => issue.requestIds)
  );
  const conflictingIdSet = new Set(conflictingRequestIds);
  const invalidRequestIds = sortedUnique(
    entries.flatMap(entry => entry.invalidReasons.size > 0 && entry.requestId ? [entry.requestId] : [])
  );
  const validRequestIds = semanticallyValid
    .map(request => request.id)
    .filter(requestId => !conflictingIdSet.has(requestId))
    .sort(compareStrings);
  const issues: RequestValidationIssue[] = [
    ...invalidIssues,
    ...conflictIssues,
  ].sort(compareValidationIssues);

  return {
    valid: issues.length === 0,
    generationBlocked: issues.length > 0,
    issues,
    validRequestIds,
    invalidRequestIds,
    conflictingRequestIds,
  };
}
