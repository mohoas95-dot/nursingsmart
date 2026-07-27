import { isDayInRequestScope } from '../domain/requests/request-scope-matcher';
import { reconcileStaffingCoverage } from '../domain/scheduling/staffing-coverage';
import { generateJalaliMonthCalendar } from './jalali';
import { evaluateSchedule, ScoredSchedule } from './scoring';
import { solveWithPriority, verifyCoverageAndLeaders } from './solver';
import { JobGroup, MonthlySchedule, Personnel, ShiftRequest, ShiftType, SystemSettings } from './types';

export interface EvaluatedScenario {
  schedule: MonthlySchedule;
  score: ScoredSchedule;
}

export interface ScenarioGenerationOptions {
  /** Manual head-nurse edits that are immutable in every generated programme. */
  protectedCells?: ReadonlySet<string>;
  /** Locked rows are never used as candidates when variants are assembled. */
  lockedRows?: readonly string[];
  /**
   * `true` keeps the edited/reconciled target-group assignments as the baseline.
   * `false` is used by the explicit «regenerate» buttons and starts that group from
   * a fresh solver result while still preserving the other job group.
   */
  useCurrentTargetAssignments?: boolean;
}

const SHIFT_HOURS: Readonly<Record<string, number>> = {
  M: 6.5,
  E: 6.5,
  N: 12.5,
  ME: 13,
  EN: 19,
  MN: 19,
  MEN: 25.5,
  OFF: 0,
};

const SHIFT_COMPONENTS: Readonly<Record<string, readonly string[]>> = {
  M: ['M'],
  E: ['E'],
  N: ['N'],
  ME: ['M', 'E'],
  EN: ['E', 'N'],
  MN: ['M', 'N'],
  MEN: ['M', 'E', 'N'],
  OFF: [],
};

function cloneAssignments(assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>): Record<string, Record<number, ShiftType>> {
  return Object.fromEntries(Object.entries(assignments).map(([personnelId, days]) => [personnelId, { ...days }]));
}

function shiftCovers(shift: ShiftType | undefined, period: string | undefined): boolean {
  if (!shift || !period) return false;
  if (period === 'OFF') return shift === 'OFF';
  if (period === 'L') return shift.startsWith('L');
  return SHIFT_COMPONENTS[shift]?.includes(period) ?? false;
}

function isRequestSatisfied(request: ShiftRequest, shift: ShiftType | undefined): boolean {
  if (request.requestType === 'OFF') return shift === 'OFF';
  if (request.requestType === 'leave') return Boolean(shift?.startsWith('L'));
  if (request.requestType === 'avoid_shift') return !shiftCovers(shift, request.preferredShift);
  if (request.requestType === 'shift') return shiftCovers(shift, request.preferredShift);
  return true;
}

function isHardAbsenceRequest(request: ShiftRequest, day: number, dayOfWeek: number): boolean {
  return request.requestType === 'leave' || (
    request.requestType === 'OFF' && request.offHardness !== 'soft'
  ) ? isDayInRequestScope(day, dayOfWeek, request) : false;
}

function hourlyLoad(assignments: Record<string, Record<number, ShiftType>>, personnelId: string): number {
  return Object.values(assignments[personnelId] || {}).reduce(
    (total, shift) => total + (SHIFT_HOURS[shift] ?? (shift.startsWith('L') ? 7 : 0)),
    0
  );
}

function canMoveCell(
  person: Personnel,
  day: number,
  dayOfWeek: number,
  assignments: Record<string, Record<number, ShiftType>>,
  requests: readonly ShiftRequest[],
  protectedCells: ReadonlySet<string>,
  lockedRows: ReadonlySet<string>
): boolean {
  if (person.locked || lockedRows.has(person.id) || protectedCells.has(`${person.id}:${day}`)) return false;
  const currentShift = assignments[person.id]?.[day] || 'OFF';
  if (currentShift.startsWith('L')) return false;
  return !requests.some(request => request.personnelId === person.id && isHardAbsenceRequest(request, day, dayOfWeek));
}

function swapDailyAssignments(
  assignments: Record<string, Record<number, ShiftType>>,
  firstId: string,
  secondId: string,
  day: number
): void {
  const firstShift = assignments[firstId]?.[day] || 'OFF';
  const secondShift = assignments[secondId]?.[day] || 'OFF';
  assignments[firstId][day] = secondShift;
  assignments[secondId][day] = firstShift;
}

/**
 * Move existing daily assignments between two eligible people.  Swapping entire days,
 * rather than adding/removing a shift, keeps every M/E/N coverage count unchanged.
 */
function applyRequestSwaps(
  assignments: Record<string, Record<number, ShiftType>>,
  targetPersonnel: readonly Personnel[],
  requests: readonly ShiftRequest[],
  calendar: ReturnType<typeof generateJalaliMonthCalendar>,
  protectedCells: ReadonlySet<string>,
  lockedRows: ReadonlySet<string>,
  maximumSwaps: number
): void {
  let swaps = 0;
  const relevantRequests = requests
    .filter(request => targetPersonnel.some(person => person.id === request.personnelId))
    .filter(request => ['shift', 'OFF', 'leave', 'avoid_shift'].includes(request.requestType))
    .sort((left, right) => Number(right.isEssential) - Number(left.isEssential));

  for (const request of relevantRequests) {
    if (swaps >= maximumSwaps) return;
    const requester = targetPersonnel.find(person => person.id === request.personnelId);
    if (!requester) continue;

    for (const calendarDay of calendar) {
      if (swaps >= maximumSwaps) return;
      const { day, dayOfWeek } = calendarDay;
      if (!isDayInRequestScope(day, dayOfWeek, request)) continue;
      if (!canMoveCell(requester, day, dayOfWeek, assignments, requests, protectedCells, lockedRows)) continue;
      if (isRequestSatisfied(request, assignments[requester.id]?.[day])) continue;

      const candidate = targetPersonnel
        .filter(person => person.id !== requester.id)
        .filter(person => canMoveCell(person, day, dayOfWeek, assignments, requests, protectedCells, lockedRows))
        .filter(person => isRequestSatisfied(request, assignments[person.id]?.[day]))
        // Keep the candidate with fewer own scoped requests first, minimizing disruption.
        .sort((left, right) => {
          const leftRequests = requests.filter(item => item.personnelId === left.id).length;
          const rightRequests = requests.filter(item => item.personnelId === right.id).length;
          return leftRequests - rightRequests || left.id.localeCompare(right.id);
        })[0];

      if (!candidate) continue;
      swapDailyAssignments(assignments, requester.id, candidate.id, day);
      swaps += 1;
    }
  }
}

function applyFairnessSwaps(
  assignments: Record<string, Record<number, ShiftType>>,
  targetPersonnel: readonly Personnel[],
  requests: readonly ShiftRequest[],
  calendar: ReturnType<typeof generateJalaliMonthCalendar>,
  protectedCells: ReadonlySet<string>,
  lockedRows: ReadonlySet<string>,
  maximumSwaps: number
): void {
  let swaps = 0;
  for (const calendarDay of calendar) {
    if (swaps >= maximumSwaps) return;
    const { day, dayOfWeek } = calendarDay;

    const eligible = targetPersonnel.filter(person =>
      canMoveCell(person, day, dayOfWeek, assignments, requests, protectedCells, lockedRows)
    );
    const highestLoad = [...eligible].sort((left, right) => hourlyLoad(assignments, right.id) - hourlyLoad(assignments, left.id));
    const lowestLoad = [...eligible].sort((left, right) => hourlyLoad(assignments, left.id) - hourlyLoad(assignments, right.id));

    for (const overworked of highestLoad) {
      if (swaps >= maximumSwaps) return;
      const overworkedShift = assignments[overworked.id]?.[day] || 'OFF';
      if (overworkedShift === 'OFF') continue;

      const underworked = lowestLoad.find(person => {
        if (person.id === overworked.id) return false;
        if ((assignments[person.id]?.[day] || 'OFF') !== 'OFF') return false;
        const loadDifference = hourlyLoad(assignments, overworked.id) - hourlyLoad(assignments, person.id);
        return loadDifference > (SHIFT_HOURS[overworkedShift] ?? 0);
      });
      if (!underworked) continue;

      swapDailyAssignments(assignments, overworked.id, underworked.id, day);
      swaps += 1;
      break;
    }
  }
}

function mergeOtherGroupAssignments(
  assignments: Record<string, Record<number, ShiftType>>,
  personnelList: readonly Personnel[],
  targetJobGroup: JobGroup | undefined,
  currentAssignments: Record<string, Record<number, ShiftType>> | null | undefined
): Record<string, Record<number, ShiftType>> {
  if (!targetJobGroup || !currentAssignments) return assignments;
  const merged = cloneAssignments(assignments);
  for (const person of personnelList) {
    if (person.jobGroup !== targetJobGroup || !currentAssignments[person.id]) continue;
    merged[person.id] = { ...currentAssignments[person.id] };
  }
  return merged;
}

/**
 * Build the fixed scenario set in dashboard order:
 *   A = MIXED (default), B = REQUESTS, C = FAIRNESS.
 *
 * Every programme starts from the same reconciled baseline and then only swaps whole
 * daily assignments. Therefore all three preserve the supervisor's protected edits
 * and the exact staffing coverage achieved by the background reconciliation.
 */
export function generateAndScoreScenarios(
  year: number,
  month: number,
  personnelList: readonly Personnel[],
  requests: readonly ShiftRequest[],
  settings: SystemSettings,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex?: number,
  monthlyDutyHours?: { official: number; contract: number } | null,
  targetJobGroup?: JobGroup,
  currentAssignments?: Record<string, Record<number, ShiftType>> | null,
  options: ScenarioGenerationOptions = {}
): { all: ScoredSchedule[]; top3: ScoredSchedule[] } {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const protectedCells = options.protectedCells ?? new Set<string>();
  const lockedRows = new Set(options.lockedRows ?? []);
  const targetPersonnel = personnelList.filter(person => person.active && (!targetJobGroup || person.jobGroup === targetJobGroup));

  const solverResult = solveWithPriority(
    year,
    month,
    personnelList,
    requests,
    settings,
    customHolidays,
    firstDayOfWeekIndex,
    monthlyDutyHours
  );

  // A manual edit/reconciliation is the baseline for its group. A fresh regeneration
  // starts from the solver result. In either case other job groups are copied verbatim.
  const baselineInput = currentAssignments && options.useCurrentTargetAssignments !== false
    ? cloneAssignments(currentAssignments)
    : cloneAssignments(solverResult.assignments);
  const reconciled = reconcileStaffingCoverage(
    baselineInput,
    personnelList,
    settings,
    calendar.map(item => ({ day: item.day, isHoliday: item.isHoliday })),
    targetJobGroup ? [targetJobGroup] : ['nurse', 'assistant'],
    options.lockedRows,
    requests,
    protectedCells
  );
  const baseline = mergeOtherGroupAssignments(reconciled.assignments, personnelList, targetJobGroup, currentAssignments);
  const baselineVerification = verifyCoverageAndLeaders(
    year,
    month,
    personnelList,
    baseline,
    settings,
    customHolidays,
    firstDayOfWeekIndex,
    requests
  );
  const baselineWarnings = new Set(baselineVerification.warnings);

  const makeScenario = (id: number, scenarioCode: 'A' | 'B' | 'C', type: ScoredSchedule['type']): ScoredSchedule => {
    let assignments = cloneAssignments(baseline);
    if (type === 'REQUESTS') {
      applyRequestSwaps(assignments, targetPersonnel, requests, calendar, protectedCells, lockedRows, Number.MAX_SAFE_INTEGER);
    } else if (type === 'FAIRNESS') {
      applyFairnessSwaps(assignments, targetPersonnel, requests, calendar, protectedCells, lockedRows, Number.MAX_SAFE_INTEGER);
    } else {
      // Programme A intentionally makes limited concessions to each concern so it
      // stays a true combined plan, not merely a copy of B or C.
      applyRequestSwaps(assignments, targetPersonnel, requests, calendar, protectedCells, lockedRows, Math.max(1, Math.ceil(targetPersonnel.length / 2)));
      applyFairnessSwaps(assignments, targetPersonnel, requests, calendar, protectedCells, lockedRows, Math.max(1, Math.ceil(targetPersonnel.length / 3)));
    }

    let verification = verifyCoverageAndLeaders(
      year,
      month,
      personnelList,
      assignments,
      settings,
      customHolidays,
      firstDayOfWeekIndex,
      requests
    );
    // A variant is never allowed to trade a resolved alert for a new one. If a
    // whole-day swap would introduce a rest/leader/coverage violation, retain the
    // reconciled baseline for that programme instead of silently reintroducing it.
    if (verification.warnings.some(warning => !baselineWarnings.has(warning))) {
      assignments = cloneAssignments(baseline);
      verification = baselineVerification;
    }
    const schedule: MonthlySchedule = {
      year,
      month,
      assignments,
      shiftLeaders: verification.shiftLeaders,
      warnings: verification.warnings,
    };
    return {
      ...evaluateSchedule(
        id,
        type,
        schedule,
        personnelList,
        requests,
        settings,
        verification.warnings,
        year,
        month,
        customHolidays,
        firstDayOfWeekIndex,
        monthlyDutyHours
      ),
      scenarioCode,
    };
  };

  const top3 = [
    makeScenario(1, 'A', 'MIXED'),
    makeScenario(2, 'B', 'REQUESTS'),
    makeScenario(3, 'C', 'FAIRNESS'),
  ];
  return { all: top3, top3 };
}
