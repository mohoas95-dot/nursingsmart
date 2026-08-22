/** Deterministic RequestOutcomeLedger construction from canonical request-days. */

import type { ShiftType } from '../../lib/types';
import {
  REQUEST_OUTCOME_LEDGER_VERSION,
  type RequestOutcomeLedger,
  type RequestResolutionProvenance,
} from './request-domain';
import type { CanonicalRequestMonthResult } from './request-canonicalizer';
import { evaluateCanonicalRequestDay } from './request-outcome-evaluator';

export interface BuildRequestOutcomeLedgerInput {
  readonly canonicalMonth: CanonicalRequestMonthResult;
  readonly assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>;
  readonly provenance?: ReadonlyArray<RequestResolutionProvenance>;
  readonly requestSetFingerprint: string;
}

function provenanceKey(requestId: string, personnelId: string, day: number): string {
  return JSON.stringify([requestId, personnelId, day]);
}

/** Every emitted canonical request-day is evaluated exactly once, in canonical order. */
/** Ledger-driven candidate repair order: deficient Essential days before Normal. */
export function prioritizeRequestDeficienciesForCandidate(
  ledger: Readonly<RequestOutcomeLedger>,
  eligiblePersonnelIds: ReadonlySet<string>
): RequestOutcomeLedger['outcomes'] {
  const deficient = ledger.outcomes.filter(outcome =>
    eligiblePersonnelIds.has(outcome.requestDay.personnelId)
    && (outcome.kind === 'PARTIAL' || outcome.kind === 'BLOCKED' || outcome.kind === 'UNSATISFIED')
  );
  const essential = deficient.filter(outcome => outcome.requestDay.isEssential);
  return essential.length > 0
    ? essential
    : deficient.filter(outcome => !outcome.requestDay.isEssential);
}

export function buildRequestOutcomeLedger(
  input: Readonly<BuildRequestOutcomeLedgerInput>
): RequestOutcomeLedger {
  const provenanceByRequestDay = new Map<string, RequestResolutionProvenance[]>();
  for (const item of input.provenance ?? []) {
    const key = provenanceKey(item.requestId, item.personnelId, item.day);
    const existing = provenanceByRequestDay.get(key) ?? [];
    existing.push(item);
    provenanceByRequestDay.set(key, existing);
  }

  const outcomes = input.canonicalMonth.requestDays.map(requestDay => {
    const assignedShift = input.assignments[requestDay.personnelId]?.[requestDay.day] ?? 'OFF';
    const provenance = provenanceByRequestDay.get(
      provenanceKey(requestDay.requestId, requestDay.personnelId, requestDay.day)
    ) ?? [];
    return evaluateCanonicalRequestDay(requestDay, assignedShift, provenance);
  });

  return {
    version: REQUEST_OUTCOME_LEDGER_VERSION,
    year: input.canonicalMonth.year,
    month: input.canonicalMonth.month,
    requestSetFingerprint: input.requestSetFingerprint,
    outcomes,
    requestIssues: [...input.canonicalMonth.issues],
  };
}
