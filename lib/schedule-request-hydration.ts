import {
  deserializeMonthlyRequestArtifacts,
} from '../domain/requests/request-persistence';
import type { MonthlySchedule } from './types';

function hasRuntimeRequestArtifacts(schedule: MonthlySchedule): boolean {
  const numerator = schedule.requestQuality?.essentialFulfillment?.numerator;
  const firstCredit = schedule.requestOutcomeLedger?.outcomes?.[0]?.credit?.numerator;
  return typeof numerator === 'bigint'
    && (firstCredit === undefined || typeof firstCredit === 'bigint');
}

/**
 * Hydrate JSON-safe request artifacts on every schedule-loading path.
 *
 * Storage contains decimal strings while the domain uses bigint. Returning a
 * persisted schedule directly to React leaves those strings in runtime domain
 * objects and crashes exact-rational rendering/effects after login. Malformed
 * artifacts are removed rather than allowed to become domain authority.
 */
export function hydrateStoredScheduleRequestArtifacts(
  storedSchedule: MonthlySchedule | Record<string, any>
): MonthlySchedule {
  const schedule = storedSchedule as MonthlySchedule;
  if (!schedule.requestQuality && !schedule.requestOutcomeLedger) return schedule;
  if (hasRuntimeRequestArtifacts(schedule)) return schedule;

  try {
    return {
      ...schedule,
      ...deserializeMonthlyRequestArtifacts(storedSchedule),
    };
  } catch {
    const {
      requestQuality: _requestQuality,
      requestOutcomeLedger: _requestOutcomeLedger,
      requestSetFingerprint: _requestSetFingerprint,
      ...safeSchedule
    } = storedSchedule;
    return safeSchedule as MonthlySchedule;
  }
}
