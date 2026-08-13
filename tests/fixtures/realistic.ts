/**
 * Realistic (but small & readable) test fixtures for Solver characterization.
 *
 * These fixtures do NOT change any product behavior. They exist purely so that the
 * characterization tests in `tests/solver-baseline.test.ts` can record the CURRENT
 * behavior of the Solver before any refactor.
 *
 * Calendar note: Khordad 1404 (year=1404, month=3) has Fridays on days
 * 2, 9, 16, 23, 30. Days are therefore deterministic and cheap to reason about.
 */

import type { Personnel, ShiftRequest, SystemSettings } from '../../lib/types';

export const CAL_YEAR = 1404;
export const CAL_MONTH = 3;
export const FRIDAYS = [2, 9, 16, 23, 30];

export function makePerson(id: string, overrides: Partial<Personnel> = {}): Personnel {
  return {
    id,
    firstName: id,
    lastName: 'T',
    personalCode: id,
    jobGroup: 'nurse',
    position: 'general',
    employmentType: 'official',
    experienceYears: 5,
    active: true,
    canBeShiftLeader: true,
    orderIndex: 0,
    ...overrides,
  };
}

export function makeSettings(
  overrides: Partial<SystemSettings['demand']['weekday']> = {},
  holidayOverrides: Partial<SystemSettings['demand']['holiday']> = {}
): SystemSettings {
  return {
    dutyHours: { official: 176, contract: 190, conscript: 200, overtime: 0 },
    demand: {
      weekday: {
        morningNurse: 2,
        morningAssistant: 0,
        afternoonNurse: 1,
        afternoonAssistant: 0,
        afternoonLeader: 0,
        nightNurse: 1,
        nightAssistant: 0,
        nightLeader: 0,
        ...overrides,
      },
      holiday: {
        morningNurse: 1,
        morningAssistant: 0,
        afternoonNurse: 1,
        afternoonAssistant: 0,
        afternoonLeader: 0,
        nightNurse: 1,
        nightAssistant: 0,
        nightLeader: 0,
        ...holidayOverrides,
      },
    },
  };
}

/** Shift → the M/E/N components it covers (mirrors staffing-coverage semantics). */
export function coversM(shift: string | undefined): boolean {
  return shift === 'M' || shift === 'ME' || shift === 'MN' || shift === 'MEN';
}
export function coversE(shift: string | undefined): boolean {
  return shift === 'E' || shift === 'ME' || shift === 'EN' || shift === 'MEN';
}
export function coversN(shift: string | undefined): boolean {
  return shift === 'N' || shift === 'EN' || shift === 'MN' || shift === 'MEN';
}

export function countM(row: Record<number, string>, days: number): number {
  let n = 0;
  for (let d = 1; d <= days; d++) if (coversM(row[d])) n++;
  return n;
}
export function countE(row: Record<number, string>, days: number): number {
  let n = 0;
  for (let d = 1; d <= days; d++) if (coversE(row[d])) n++;
  return n;
}
export function countN(row: Record<number, string>, days: number): number {
  let n = 0;
  for (let d = 1; d <= days; d++) if (coversN(row[d])) n++;
  return n;
}

export type RequestSeed = Omit<ShiftRequest, 'personnelId'>;

export function makeRequest(personnelId: string, seed: RequestSeed): ShiftRequest {
  return { ...seed, personnelId };
}

// ---------------------------------------------------------------------------
// Realistic roster: supervisor (fixed morning), staff (mostly morning),
// three tagged routines (morning / evening_night / long) and a flexible general.
// ---------------------------------------------------------------------------
export function realisticPersonnel(): Personnel[] {
  return [
    makePerson('sup', { position: 'supervisor', canBeShiftLeader: false }),
    makePerson('stf', { position: 'staff' }),
    makePerson('morn', { workRoutine: 'morning' }),
    makePerson('even', { workRoutine: 'evening_night' }),
    makePerson('long', { workRoutine: 'long' }),
    makePerson('flex', {}),
  ];
}

/** A realistic mix of request types (Phase D). */
export function realisticRequests(): ShiftRequest[] {
  return [
    makeRequest('sup', {
      id: 'r-sup-off', requestType: 'OFF', isEssential: true, offHardness: 'hard',
      scope: 'custom_days', selectedDays: [1],
    }),
    makeRequest('even', {
      id: 'r-even-n', requestType: 'shift', preferredShift: 'EN', isEssential: false,
      scope: 'all',
    }),
    makeRequest('morn', {
      id: 'r-morn-off', requestType: 'OFF', isEssential: false, offHardness: 'soft',
      scope: 'custom_days', selectedDays: [5, 6],
    }),
    makeRequest('long', {
      id: 'r-long-leave', requestType: 'leave', isEssential: true,
      scope: 'custom_days', selectedDays: [10, 11, 12],
    }),
    makeRequest('flex', {
      id: 'r-flex-avoid', requestType: 'avoid_shift', preferredShift: 'N', isEssential: false,
      scope: 'weekly_odd',
    }),
  ];
}

export function realisticSettings(): SystemSettings {
  return makeSettings(
    { morningNurse: 2, afternoonNurse: 1, nightNurse: 1 },
    { morningNurse: 1, afternoonNurse: 1, nightNurse: 1 }
  );
}

// ---------------------------------------------------------------------------
// Three coverage scenarios (Phase D)
// ---------------------------------------------------------------------------
export interface ScenarioPreset {
  name: string;
  personnel: Personnel[];
  requests: ShiftRequest[];
  settings: SystemSettings;
}

/** Feasible: enough nurses, no requests — should solve cleanly. */
export function scenarioFeasible(): ScenarioPreset {
  const personnel = [makePerson('sup', { position: 'supervisor' }), makePerson('stf', { position: 'staff' }), makePerson('g1'), makePerson('g2'), makePerson('g3')];
  return { name: 'feasible', personnel, requests: [], settings: makeSettings() };
}

/**
 * Near-infeasible: 2 nurses, but the supervisor can only cover M while one general
 * nurse must cover every night. The demand is technically satisfiable, but only by
 * making the general nurse run N several days in a row (the final reconcile pass
 * fills the night gap without the "no 3 nights in a row" guard that the greedy fill
 * uses). Records current behavior; does not assert it is "correct".
 */
export function scenarioNearInfeasible(): ScenarioPreset {
  const personnel = [makePerson('sup', { position: 'supervisor' }), makePerson('g1')];
  const settings = makeSettings({ morningNurse: 1, afternoonNurse: 0, nightNurse: 1 });
  return { name: 'near-infeasible', personnel, requests: [], settings };
}

/** Infeasible: 2 nurses for M=4/E=1/N=1 — cannot meet morning demand. */
export function scenarioInfeasible(): ScenarioPreset {
  const personnel = [makePerson('sup', { position: 'supervisor' }), makePerson('stf', { position: 'staff' })];
  const settings = makeSettings({ morningNurse: 4 }, { morningNurse: 4 });
  return { name: 'infeasible', personnel, requests: [], settings };
}

export const ALL_PRESETS: ScenarioPreset[] = [
  scenarioFeasible(),
  scenarioNearInfeasible(),
  scenarioInfeasible(),
];
