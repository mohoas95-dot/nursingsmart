/** Version-aware JSON persistence/hydration for scenario objectives. */

import {
  deserializeRequestQuality,
  serializeRequestQuality,
  type SerializedRequestQuality,
} from '../requests/request-domain';
import { serializeMonthlyRequestArtifacts } from '../requests/request-persistence';
import {
  LEGACY_SCENARIO_OBJECTIVE_VERSION,
  PHASE_5_SCENARIO_OBJECTIVE_VERSION,
  SCENARIO_OBJECTIVE_VERSION,
  type ScenarioObjective,
} from './objective';

export type RequestQualityPersistenceStatus = 'CURRENT' | 'STALE' | 'LEGACY' | 'INVALID';

export interface SerializedScenarioObjective extends Omit<ScenarioObjective, 'quality'> {
  readonly quality: Omit<ScenarioObjective['quality'], 'requestQuality'> & {
    readonly requestQuality: SerializedRequestQuality;
  };
}

export function serializeScenarioObjective(
  objective: Readonly<ScenarioObjective>
): SerializedScenarioObjective {
  if (objective.version !== SCENARIO_OBJECTIVE_VERSION) {
    throw new RangeError(`Cannot serialize non-current objective version: ${String(objective.version)}`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(objective.requestSetFingerprint)) {
    throw new TypeError('Current objective requires a SHA-256 request fingerprint');
  }
  return {
    ...objective,
    quality: {
      ...objective.quality,
      requestQuality: serializeRequestQuality(objective.quality.requestQuality),
    },
  };
}

function isHistoricalVersion(version: unknown): boolean {
  return version === undefined
    || version === LEGACY_SCENARIO_OBJECTIVE_VERSION
    || version === PHASE_5_SCENARIO_OBJECTIVE_VERSION;
}

export interface HydratedScenarioObjective {
  readonly objective?: ScenarioObjective;
  readonly status: RequestQualityPersistenceStatus;
  readonly historicalVersion?: string;
  readonly error?: string;
}

/**
 * Hydrate only objective/3. Versions 1 and 2 remain historical and are never
 * upgraded or interpreted under RequestQuality semantics.
 */
export function serializeCurrentScenarioForPersistence<T extends {
  objective?: ScenarioObjective;
  objectiveVersion?: string;
  schedule?: Record<string, unknown>;
}>(scenario: T): Record<string, unknown> {
  if (!scenario.objective || scenario.objective.version !== SCENARIO_OBJECTIVE_VERSION) {
    return { ...scenario };
  }
  const numerator = scenario.objective.quality?.requestQuality?.essentialFulfillment?.numerator;
  if (typeof numerator === 'string') return { ...scenario };

  const schedule = scenario.schedule
    ? {
        ...scenario.schedule,
        ...serializeMonthlyRequestArtifacts(scenario.schedule),
      }
    : undefined;
  return {
    ...scenario,
    objective: serializeScenarioObjective(scenario.objective),
    objectiveVersion: SCENARIO_OBJECTIVE_VERSION,
    schedule,
  };
}

export function hydrateScenarioObjective(
  rawObjective: unknown,
  rawObjectiveVersion: unknown,
  expectedRequestSetFingerprint: string
): HydratedScenarioObjective {
  const record = rawObjective && typeof rawObjective === 'object'
    ? rawObjective as Record<string, unknown>
    : undefined;
  const version = rawObjectiveVersion ?? record?.version;

  if (isHistoricalVersion(version)) {
    return {
      status: 'LEGACY',
      historicalVersion: typeof version === 'string'
        ? version
        : LEGACY_SCENARIO_OBJECTIVE_VERSION,
    };
  }
  if (version !== SCENARIO_OBJECTIVE_VERSION || record?.version !== SCENARIO_OBJECTIVE_VERSION) {
    return { status: 'INVALID', error: `Unsupported objective version: ${String(version)}` };
  }

  try {
    if (typeof record.requestSetFingerprint !== 'string'
      || !/^sha256:[0-9a-f]{64}$/.test(record.requestSetFingerprint)) {
      throw new TypeError('Current objective fingerprint is missing or malformed');
    }
    const gates = record.gates;
    if (!gates || typeof gates !== 'object') throw new TypeError('Current objective gates are missing');
    const gateRecord = gates as Record<string, unknown>;
    for (const field of [
      'criticalResolved', 'locksPreserved', 'withinMaxBaselineDifference', 'meetsMinBaselineDifference',
    ]) {
      if (typeof gateRecord[field] !== 'boolean') throw new TypeError(`Current objective gate ${field} is invalid`);
    }
    if (!Number.isInteger(gateRecord.criticalWarningCount) || Number(gateRecord.criticalWarningCount) < 0) {
      throw new TypeError('Current objective criticalWarningCount is invalid');
    }

    const quality = record.quality;
    if (!quality || typeof quality !== 'object') throw new TypeError('Current objective quality is missing');
    const qualityRecord = quality as Record<string, unknown>;
    for (const field of [
      'operationalEfficiencyScore', 'fairnessScore', 'warningDefectCount',
      'routineMismatchCount', 'baselineSimilarityPercent',
    ]) {
      if (typeof qualityRecord[field] !== 'number' || !Number.isFinite(qualityRecord[field])) {
        throw new TypeError(`Current objective quality ${field} is invalid`);
      }
    }
    if (Number(qualityRecord.warningDefectCount) < 0 || Number(qualityRecord.routineMismatchCount) < 0) {
      throw new RangeError('Current objective defect counts must be non-negative');
    }
    const requestQuality = deserializeRequestQuality(
      qualityRecord.requestQuality as SerializedRequestQuality
    );
    const objective = {
      ...record,
      quality: {
        ...qualityRecord,
        requestQuality,
      },
    } as unknown as ScenarioObjective;

    const status = objective.requestSetFingerprint === expectedRequestSetFingerprint
      ? 'CURRENT'
      : 'STALE';
    return { objective, status };
  } catch (error) {
    return {
      status: 'INVALID',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
