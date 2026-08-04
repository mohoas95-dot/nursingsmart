/**
 * Scenario eligibility policy — single source of truth for workflow gates.
 *
 * A scenario may enter comparison/voting/finalization only when it has no
 * blocking (hard-constraint) violations. Other verifier messages are advisory
 * quality notes: they remain visible, but never create an unresolvable workflow
 * deadlock for a read-only scenario.
 */

import {
  getHardConstraintWarnings,
  isHardConstraintWarning,
} from '../../lib/scoring';

export interface ScenarioWarningSummary {
  blockingWarnings: string[];
  advisoryNotices: string[];
  blockingCount: number;
  advisoryCount: number;
  eligible: boolean;
}

/** Split verifier output according to the workflow policy selected by product. */
export function summarizeScenarioWarnings(
  warnings: ReadonlyArray<string>
): ScenarioWarningSummary {
  const blockingWarnings = getHardConstraintWarnings(warnings);
  const advisoryNotices = warnings.filter(warning => !isHardConstraintWarning(warning));

  return {
    blockingWarnings,
    advisoryNotices,
    blockingCount: blockingWarnings.length,
    advisoryCount: advisoryNotices.length,
    eligible: blockingWarnings.length === 0,
  };
}

/** The only warning-based gate allowed in comparison/voting/finalization flows. */
export function canScenarioAdvance(warnings: ReadonlyArray<string>): boolean {
  return summarizeScenarioWarnings(warnings).eligible;
}
