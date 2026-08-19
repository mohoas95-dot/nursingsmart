/** JSON-safe persistence boundary for ledger-backed request artifacts. */

import type { SerializedExactRational } from '../math/exact-rational';
import { deserializeExactRational, serializeExactRational } from '../math/exact-rational';
import {
  REQUEST_DAY_OUTCOME_VERSION,
  REQUEST_OUTCOME_LEDGER_VERSION,
  deserializeRequestQuality,
  serializeRequestQuality,
  type RequestOutcomeLedger,
  type RequestQuality,
  type SerializedRequestQuality,
} from './request-domain';

export interface SerializedRequestOutcomeLedger extends Omit<RequestOutcomeLedger, 'outcomes'> {
  readonly outcomes: ReadonlyArray<
    Omit<RequestOutcomeLedger['outcomes'][number], 'credit'> & {
      readonly credit: SerializedExactRational;
    }
  >;
}

export function serializeRequestOutcomeLedger(
  ledger: Readonly<RequestOutcomeLedger>
): SerializedRequestOutcomeLedger {
  if (ledger.version !== REQUEST_OUTCOME_LEDGER_VERSION) {
    throw new RangeError(`Unsupported request outcome ledger version: ${String(ledger.version)}`);
  }
  return {
    ...ledger,
    outcomes: ledger.outcomes.map(outcome => ({
      ...outcome,
      credit: serializeExactRational(outcome.credit),
    })),
  };
}

export function deserializeRequestOutcomeLedger(value: unknown): RequestOutcomeLedger {
  if (!value || typeof value !== 'object') throw new TypeError('Serialized ledger must be an object');
  const ledger = value as Record<string, unknown>;
  if (ledger.version !== REQUEST_OUTCOME_LEDGER_VERSION) {
    throw new RangeError(`Unsupported request outcome ledger version: ${String(ledger.version)}`);
  }
  if (!Number.isInteger(ledger.year) || !Number.isInteger(ledger.month)) {
    throw new TypeError('Serialized ledger year/month must be integers');
  }
  if (typeof ledger.requestSetFingerprint !== 'string' || ledger.requestSetFingerprint.length === 0) {
    throw new TypeError('Serialized ledger fingerprint must be a non-empty string');
  }
  if (!Array.isArray(ledger.outcomes) || !Array.isArray(ledger.requestIssues)) {
    throw new TypeError('Serialized ledger outcomes/issues must be arrays');
  }

  const outcomes = ledger.outcomes.map(raw => {
    if (!raw || typeof raw !== 'object') throw new TypeError('Serialized outcome must be an object');
    const outcome = raw as Record<string, unknown>;
    if (outcome.version !== REQUEST_DAY_OUTCOME_VERSION || outcome.includedInQuality !== true) {
      throw new TypeError('Serialized ledger contains a non-quality-eligible outcome');
    }
    if (!outcome.requestDay || typeof outcome.requestDay !== 'object') {
      throw new TypeError('Serialized outcome requestDay is missing');
    }
    if (typeof outcome.kind !== 'string' || typeof outcome.reason !== 'string') {
      throw new TypeError('Serialized outcome kind/reason is invalid');
    }
    return {
      ...outcome,
      credit: deserializeExactRational(outcome.credit as SerializedExactRational),
    };
  }) as unknown as RequestOutcomeLedger['outcomes'];

  return {
    version: REQUEST_OUTCOME_LEDGER_VERSION,
    year: ledger.year as number,
    month: ledger.month as number,
    requestSetFingerprint: ledger.requestSetFingerprint,
    outcomes,
    requestIssues: ledger.requestIssues as RequestOutcomeLedger['requestIssues'],
  };
}

export interface SerializedMonthlyRequestArtifacts {
  readonly requestQuality?: SerializedRequestQuality;
  readonly requestOutcomeLedger?: SerializedRequestOutcomeLedger;
  readonly requestSetFingerprint?: string;
}

export function serializeMonthlyRequestArtifacts(schedule: {
  requestQuality?: RequestQuality;
  requestOutcomeLedger?: RequestOutcomeLedger;
  requestSetFingerprint?: string;
}): SerializedMonthlyRequestArtifacts {
  return {
    requestQuality: schedule.requestQuality
      ? serializeRequestQuality(schedule.requestQuality)
      : undefined,
    requestOutcomeLedger: schedule.requestOutcomeLedger
      ? serializeRequestOutcomeLedger(schedule.requestOutcomeLedger)
      : undefined,
    requestSetFingerprint: schedule.requestSetFingerprint,
  };
}

export function deserializeMonthlyRequestArtifacts(schedule: {
  requestQuality?: unknown;
  requestOutcomeLedger?: unknown;
  requestSetFingerprint?: unknown;
}): {
  requestQuality?: RequestQuality;
  requestOutcomeLedger?: RequestOutcomeLedger;
  requestSetFingerprint?: string;
} {
  return {
    requestQuality: schedule.requestQuality
      ? deserializeRequestQuality(schedule.requestQuality as SerializedRequestQuality)
      : undefined,
    requestOutcomeLedger: schedule.requestOutcomeLedger
      ? deserializeRequestOutcomeLedger(schedule.requestOutcomeLedger)
      : undefined,
    requestSetFingerprint: typeof schedule.requestSetFingerprint === 'string'
      ? schedule.requestSetFingerprint
      : undefined,
  };
}
