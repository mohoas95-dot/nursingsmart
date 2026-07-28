import { generateJalaliMonthCalendar } from './jalali';
import { verifyCoverageAndLeaders, solveWithPriority, generatePersonnelReports } from './solver';
import { reconcileStaffingCoverage } from '../domain/scheduling/staffing-coverage';
import {
  JobGroup,
  MonthlySchedule,
  Personnel,
  ShiftRequest,
  ShiftType,
  SystemSettings,
} from './types';
import {
  calculateScenarioDifferencePercent,
  countHardConstraintWarnings,
  evaluateScenarioSchedule,
  filterWarningsForScenarioGroup,
  isHardWarningCountAcceptable,
  MAX_ALLOWED_HARD_WARNINGS_PER_SCENARIO,
  SCENARIO_KEYS,
  SCENARIO_TITLES,
  type ScoredSchedule,
  type ScenarioType,
} from './scoring';
import { isDayInRequestScope } from '../domain/requests/request-scope-matcher';

export interface EvaluatedScenario {
  schedule: MonthlySchedule;
  score: ScoredSchedule;
}

export interface ScenarioGenerationResult {
  all: ScoredSchedule[];
  top3: ScoredSchedule[];
  generationLog: string[];
}

type ScenarioOperation =
  | { kind: 'swap'; day: number; leftId: string; rightId: string }
  | { kind: 'move'; day: number; fromId: string; toId: string }
  | { kind: 'multiSwap'; days: [number, number]; leftId: string; rightId: string }
  | { kind: 'chainSwap'; day: number; cycle: [string, string, string] };

interface ScenarioContext {
  year: number;
  month: number;
  personnelList: readonly Personnel[];
  requests: readonly ShiftRequest[];
  settings: SystemSettings;
  customHolidays: Readonly<Record<number, string>>;
  firstDayOfWeekIndex?: number;
  monthlyDutyHours?: any;
  targetJobGroup?: JobGroup;
  currentAssignments?: Record<string, Record<number, ShiftType>> | null;
  lockedRows: string[];
  totalDays: number;
  targetPersonnel: Personnel[];
  targetPersonnelIds: string[];
}

const MIN_DIFFERENCE_PERCENT = 20;
const MAX_DIFFERENCE_PERCENT = 30;
const TARGET_DIFFERENCE_PERCENT = 25;
const MAX_LOCAL_SEARCH_STEPS = 32;
const MAX_DIVERSITY_REFINEMENT_STEPS = 42;
const MAX_OPERATIONS_PER_PASS = 96;
const MAX_SEED_VARIANTS_PER_SCENARIO = 12;
const MAX_ACCEPTABLE_SCORE_DROP = 12;

const uniqueKeyForOperation = (operation: ScenarioOperation) => JSON.stringify(operation);
const scenarioOrder: ScenarioType[] = ['REQUESTS', 'FAIRNESS', 'MIXED'];

function getAssignedShift(
  schedule: MonthlySchedule,
  personnelId: string,
  day: number
): ShiftType {
  return schedule.assignments[personnelId]?.[day] || 'OFF';
}

function differenceDistanceFromWindow(diff: number): number {
  if (diff < MIN_DIFFERENCE_PERCENT) return MIN_DIFFERENCE_PERCENT - diff;
  if (diff > MAX_DIFFERENCE_PERCENT) return diff - MAX_DIFFERENCE_PERCENT;
  return 0;
}

function differenceFitness(diff: number): number {
  if (diff >= MIN_DIFFERENCE_PERCENT && diff <= MAX_DIFFERENCE_PERCENT) {
    return 120 - (Math.abs(TARGET_DIFFERENCE_PERCENT - diff) * 5);
  }
  if (diff < MIN_DIFFERENCE_PERCENT) {
    return -((MIN_DIFFERENCE_PERCENT - diff) * 18);
  }
  return -((diff - MAX_DIFFERENCE_PERCENT) * 12);
}

function getCandidateDifferences(
  candidate: ScoredSchedule,
  accepted: readonly ScoredSchedule[],
  context: ScenarioContext
): number[] {
  return accepted.map(item =>
    calculateScenarioDifferencePercent(item.schedule, candidate.schedule, context.targetPersonnelIds, context.totalDays)
  );
}

function candidateObjective(
  candidate: ScoredSchedule,
  accepted: readonly ScoredSchedule[],
  context: ScenarioContext,
  baselineScore: number
): number {
  const scoreDropPenalty = Math.max(0, baselineScore - candidate.totalScore) * 3.4;
  const hardPenalty = candidate.relevantHardWarningCount * 18;
  if (accepted.length === 0) {
    return candidate.totalScore - scoreDropPenalty - hardPenalty;
  }

  const differences = getCandidateDifferences(candidate, accepted, context);
  const minDiffFitness = Math.min(...differences.map(differenceFitness));
  const avgDiffFitness = differences.reduce((sum, diff) => sum + differenceFitness(diff), 0) / differences.length;
  return (candidate.totalScore * 0.45) + minDiffFitness + (avgDiffFitness * 0.35) - scoreDropPenalty - hardPenalty;
}

function mergedTargetVariant(
  targetVariant: readonly Personnel[],
  fullList: readonly Personnel[],
  targetJobGroup?: JobGroup
): Personnel[] {
  if (!targetJobGroup) return [...targetVariant];
  const preserved = fullList.filter(person => person.jobGroup !== targetJobGroup);
  return [...targetVariant, ...preserved];
}

function cloneAssignments(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>
): Record<string, Record<number, ShiftType>> {
  const copy: Record<string, Record<number, ShiftType>> = {};
  for (const [personnelId, days] of Object.entries(assignments)) {
    copy[personnelId] = { ...(days as Record<number, ShiftType>) };
  }
  return copy;
}

function mergePreservedAssignments(
  optimized: Record<string, Record<number, ShiftType>>,
  context: ScenarioContext
): Record<string, Record<number, ShiftType>> {
  if (!context.currentAssignments) return optimized;
  const merged = cloneAssignments(optimized);
  const lockedIds = new Set(context.lockedRows);

  for (const person of context.personnelList) {
    const shouldPreserve = lockedIds.has(person.id) || (!!context.targetJobGroup && person.jobGroup !== context.targetJobGroup);
    if (!shouldPreserve) continue;
    if (context.currentAssignments[person.id]) {
      merged[person.id] = { ...(context.currentAssignments[person.id] as Record<number, ShiftType>) };
    }
  }

  return merged;
}

function verifyScenarioSchedule(
  assignments: Record<string, Record<number, ShiftType>>,
  context: ScenarioContext
): MonthlySchedule {
  const reconciled = reconcileStaffingCoverage(
    assignments,
    context.personnelList,
    context.settings,
    generateJalaliMonthCalendar(
      context.year,
      context.month,
      context.customHolidays,
      context.firstDayOfWeekIndex
    ).map(day => ({ day: day.day, isHoliday: day.isHoliday })),
    context.targetJobGroup ? [context.targetJobGroup] : ['nurse', 'assistant'],
    context.lockedRows,
    context.requests
  ).assignments;

  const verification = verifyCoverageAndLeaders(
    context.year,
    context.month,
    context.personnelList,
    reconciled,
    context.settings,
    context.customHolidays,
    context.firstDayOfWeekIndex,
    context.requests
  );

  const relevantWarnings = filterWarningsForScenarioGroup(
    verification.warnings,
    context.personnelList,
    context.targetJobGroup
  );

  return {
    year: context.year,
    month: context.month,
    assignments: reconciled,
    shiftLeaders: verification.shiftLeaders,
    warnings: relevantWarnings,
  };
}

function evaluateScenario(
  schedule: MonthlySchedule,
  scenarioType: ScenarioType,
  id: number,
  context: ScenarioContext
): ScoredSchedule {
  return evaluateScenarioSchedule({
    id,
    type: scenarioType,
    schedule,
    personnelList: context.personnelList,
    requests: context.requests,
    settings: context.settings,
    year: context.year,
    month: context.month,
    customHolidays: context.customHolidays,
    firstDayOfWeekIndex: context.firstDayOfWeekIndex,
    monthlyDutyHours: context.monthlyDutyHours,
    targetJobGroup: context.targetJobGroup,
  });
}

function initialScoredSchedule(
  scenarioType: ScenarioType,
  id: number,
  context: ScenarioContext,
  personnelSeed: readonly Personnel[]
): ScoredSchedule {
  const solved = solveWithPriority(
    context.year,
    context.month,
    personnelSeed,
    context.requests,
    context.settings,
    context.customHolidays,
    context.firstDayOfWeekIndex,
    context.monthlyDutyHours
  );

  const mergedAssignments = mergePreservedAssignments(cloneAssignments(solved.assignments), context);
  const verified = verifyScenarioSchedule(mergedAssignments, context);
  return evaluateScenario(verified, scenarioType, id, context);
}

function getOriginalOrder(person: Personnel): number {
  return person.orderIndex ?? Number.MAX_SAFE_INTEGER;
}

function calculateWorkedHoursByPerson(
  currentAssignments: Record<string, Record<number, ShiftType>> | null | undefined,
  context: ScenarioContext
): Map<string, number> {
  const hours = new Map<string, number>();
  if (!currentAssignments) return hours;

  const reports = generatePersonnelReports(
    context.year,
    context.month,
    context.targetPersonnel,
    {
      year: context.year,
      month: context.month,
      assignments: currentAssignments,
      shiftLeaders: {},
      warnings: [],
    },
    context.settings,
    { ...context.customHolidays },
    context.firstDayOfWeekIndex,
    context.monthlyDutyHours
  );

  for (const report of reports) {
    hours.set(report.personnelId, report.workedHours);
  }

  return hours;
}

function countApplicableRequestDays(
  person: Personnel,
  requests: readonly ShiftRequest[],
  calendar: ReturnType<typeof generateJalaliMonthCalendar>
): number {
  return requests
    .filter(request => request.personnelId === person.id)
    .reduce((count, request) => {
      let requestDays = 0;
      for (let day = 1; day <= calendar.length; day++) {
        if (isDayInRequestScope(day, calendar[day - 1].dayOfWeek, request)) {
          requestDays += request.isEssential ? 2 : 1;
        }
      }
      return count + requestDays;
    }, 0);
}

function rotateArray<T>(items: readonly T[], offset: number): T[] {
  if (items.length === 0) return [];
  const normalized = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(normalized), ...items.slice(0, normalized)];
}

function reorderPersonnelForScenario(
  personnelList: readonly Personnel[],
  scenarioType: ScenarioType,
  context: ScenarioContext
): Personnel[] {
  const calendar = generateJalaliMonthCalendar(
    context.year,
    context.month,
    context.customHolidays,
    context.firstDayOfWeekIndex
  );
  const requestLoadByPerson = new Map<string, number>();
  const currentHoursByPerson = calculateWorkedHoursByPerson(context.currentAssignments || null, context);

  for (const person of context.targetPersonnel) {
    requestLoadByPerson.set(person.id, countApplicableRequestDays(person, context.requests, calendar));
  }

  const lockedIds = new Set(context.lockedRows);
  const targetPeople = personnelList.filter(person =>
    !lockedIds.has(person.id) && (!context.targetJobGroup || person.jobGroup === context.targetJobGroup)
  );

  const sortedTarget = [...targetPeople].sort((left, right) => {
    const leftRequestLoad = requestLoadByPerson.get(left.id) || 0;
    const rightRequestLoad = requestLoadByPerson.get(right.id) || 0;
    const leftHours = currentHoursByPerson.get(left.id) || 0;
    const rightHours = currentHoursByPerson.get(right.id) || 0;

    if (scenarioType === 'REQUESTS') {
      if (leftRequestLoad !== rightRequestLoad) return rightRequestLoad - leftRequestLoad;
      if (leftHours !== rightHours) return leftHours - rightHours;
    } else if (scenarioType === 'FAIRNESS') {
      if (leftHours !== rightHours) return leftHours - rightHours;
      if (leftRequestLoad !== rightRequestLoad) return leftRequestLoad - rightRequestLoad;
    } else {
      const leftComposite = (leftRequestLoad * 2) - leftHours;
      const rightComposite = (rightRequestLoad * 2) - rightHours;
      if (leftComposite !== rightComposite) return rightComposite - leftComposite;
      if (leftRequestLoad !== rightRequestLoad) return rightRequestLoad - leftRequestLoad;
      if (leftHours !== rightHours) return leftHours - rightHours;
    }

    return getOriginalOrder(left) - getOriginalOrder(right);
  });

  const rotatedTarget = rotateArray(
    sortedTarget,
    scenarioType === 'REQUESTS' ? 1 : scenarioType === 'FAIRNESS' ? Math.floor(sortedTarget.length / 3) : Math.floor(sortedTarget.length / 2)
  );

  return mergedTargetVariant(rotatedTarget, personnelList, context.targetJobGroup);
}

function buildSeedPersonnelVariants(
  personnelList: readonly Personnel[],
  scenarioType: ScenarioType,
  context: ScenarioContext
): Personnel[][] {
  const lockedIds = new Set(context.lockedRows);
  const targetPeople = personnelList.filter(person =>
    !lockedIds.has(person.id) && (!context.targetJobGroup || person.jobGroup === context.targetJobGroup)
  );
  if (targetPeople.length === 0) return [[...personnelList]];

  const baseVariant = reorderPersonnelForScenario(personnelList, scenarioType, context)
    .filter(person => !context.targetJobGroup || person.jobGroup === context.targetJobGroup);

  const offsets = Array.from(new Set([
    0,
    1,
    Math.floor(targetPeople.length / 4),
    Math.floor(targetPeople.length / 3),
    Math.floor(targetPeople.length / 2),
    Math.max(0, targetPeople.length - 1),
  ].filter(offset => offset >= 0 && offset < targetPeople.length)));

  const variants: Personnel[][] = [];
  const seen = new Set<string>();
  const pushVariant = (variant: readonly Personnel[]) => {
    const key = variant.map(person => person.id).join('|');
    if (!key || seen.has(key)) return;
    seen.add(key);
    variants.push(mergedTargetVariant(variant, personnelList, context.targetJobGroup));
  };

  for (const offset of offsets) {
    pushVariant(rotateArray(baseVariant, offset));
  }

  pushVariant([...baseVariant].reverse());
  pushVariant(baseVariant.filter((_, index) => index % 2 === 0).concat(baseVariant.filter((_, index) => index % 2 === 1)));
  pushVariant(baseVariant.filter((_, index) => index % 2 === 1).concat(baseVariant.filter((_, index) => index % 2 === 0)));

  const byOriginalOrder = [...targetPeople].sort((left, right) => getOriginalOrder(left) - getOriginalOrder(right));
  pushVariant(byOriginalOrder);
  pushVariant([...byOriginalOrder].reverse());

  return variants.slice(0, MAX_SEED_VARIANTS_PER_SCENARIO);
}

function assignmentMatchesRequest(shift: ShiftType, request: ShiftRequest, expectedPattern?: string): boolean {
  if (request.requestType === 'OFF') return shift === 'OFF' || shift.startsWith('L');
  if (request.requestType === 'leave') return shift.startsWith('L');
  if (request.requestType === 'avoid_shift') {
    if (!request.preferredShift) return true;
    if (request.preferredShift === 'M') return !['M', 'ME', 'MN', 'MEN'].includes(shift);
    if (request.preferredShift === 'E') return !['E', 'ME', 'EN', 'MEN'].includes(shift);
    if (request.preferredShift === 'N') return !['N', 'EN', 'MN', 'MEN'].includes(shift);
    return shift !== request.preferredShift;
  }
  const requestedShift = request.requestType === 'pattern' ? expectedPattern : request.preferredShift;
  if (!requestedShift) return true;
  if (requestedShift === 'M') return ['M', 'ME', 'MN', 'MEN'].includes(shift);
  if (requestedShift === 'E') return ['E', 'ME', 'EN', 'MEN'].includes(shift);
  if (requestedShift === 'N') return ['N', 'EN', 'MN', 'MEN'].includes(shift);
  if (requestedShift === 'OFF') return shift === 'OFF';
  if (requestedShift.startsWith('L')) return shift.startsWith('L');
  return shift === requestedShift;
}

function generateRequestFocusedOperations(
  scored: ScoredSchedule,
  context: ScenarioContext
): ScenarioOperation[] {
  const operations: ScenarioOperation[] = [];
  const operationsSeen = new Set<string>();
  const calendar = generateJalaliMonthCalendar(
    context.year,
    context.month,
    context.customHolidays,
    context.firstDayOfWeekIndex
  );
  const targetIds = new Set(context.targetPersonnelIds);

  const relevantRequests = context.requests
    .filter(request => targetIds.has(request.personnelId))
    .sort((left, right) => {
      if (left.isEssential !== right.isEssential) return left.isEssential ? -1 : 1;
      const leftPriority = left.requestType === 'shift' ? 0 : left.requestType === 'OFF' ? 1 : left.requestType === 'avoid_shift' ? 2 : left.requestType === 'pattern' ? 3 : 4;
      const rightPriority = right.requestType === 'shift' ? 0 : right.requestType === 'OFF' ? 1 : right.requestType === 'avoid_shift' ? 2 : right.requestType === 'pattern' ? 3 : 4;
      return leftPriority - rightPriority;
    });

  for (const request of relevantRequests) {
    const ownerAssignments = scored.schedule.assignments[request.personnelId] || {};
    const sameGroupOthers = context.targetPersonnel.filter(person => person.id !== request.personnelId);

    for (let day = 1; day <= context.totalDays; day++) {
      if (!isDayInRequestScope(day, calendar[day - 1].dayOfWeek, request)) continue;
      const expectedPattern = request.requestType === 'pattern' && request.patternSteps && request.patternSteps.length > 0
        ? request.patternSteps[(day - 1) % request.patternSteps.length]
        : undefined;
      const currentShift = ownerAssignments[day] || 'OFF';
      if (assignmentMatchesRequest(currentShift, request, expectedPattern)) continue;

      for (const candidate of sameGroupOthers) {
        const candidateShift = scored.schedule.assignments[candidate.id]?.[day] || 'OFF';

        if (request.requestType === 'shift' || request.requestType === 'pattern') {
          const preferred = request.requestType === 'pattern' ? expectedPattern : request.preferredShift;
          if (!preferred) continue;
          const preferredRequest: ShiftRequest = request.requestType === 'pattern'
            ? { ...request, requestType: 'shift', preferredShift: preferred as any }
            : request;
          if (!assignmentMatchesRequest(candidateShift, preferredRequest)) continue;

          const operation: ScenarioOperation = currentShift === 'OFF' || currentShift.startsWith('L')
            ? { kind: 'move', day, fromId: candidate.id, toId: request.personnelId }
            : { kind: 'swap', day, leftId: request.personnelId, rightId: candidate.id };
          const key = uniqueKeyForOperation(operation);
          if (!operationsSeen.has(key)) {
            operationsSeen.add(key);
            operations.push(operation);
          }
        } else if (request.requestType === 'OFF' || request.requestType === 'leave' || request.requestType === 'avoid_shift') {
          if (candidateShift !== 'OFF') continue;
          const operation: ScenarioOperation = { kind: 'move', day, fromId: request.personnelId, toId: candidate.id };
          const key = uniqueKeyForOperation(operation);
          if (!operationsSeen.has(key)) {
            operationsSeen.add(key);
            operations.push(operation);
          }
        }

        if (operations.length >= MAX_OPERATIONS_PER_PASS) {
          return operations;
        }
      }
    }
  }

  return operations;
}

function generateFairnessFocusedOperations(
  scored: ScoredSchedule,
  context: ScenarioContext
): ScenarioOperation[] {
  const operations: ScenarioOperation[] = [];
  const seen = new Set<string>();

  const reports = generatePersonnelReports(
    context.year,
    context.month,
    context.targetPersonnel,
    scored.schedule,
    context.settings,
    { ...context.customHolidays },
    context.firstDayOfWeekIndex,
    context.monthlyDutyHours
  );

  const rankedByBalance = [...reports]
    .map(report => ({
      ...report,
      balance: report.workedHours - (report.dutyHours > 0 ? report.dutyHours : report.workedHours),
      burden: report.nCount * 2 + report.enCount * 2 + report.mnCount * 2 + report.menCount * 3,
    }))
    .sort((left, right) => right.balance - left.balance || right.burden - left.burden);

  const overworked = rankedByBalance.slice(0, Math.min(4, rankedByBalance.length));
  const underworked = [...rankedByBalance].reverse().slice(0, Math.min(4, rankedByBalance.length));

  const holidayDays = generateJalaliMonthCalendar(
    context.year,
    context.month,
    context.customHolidays,
    context.firstDayOfWeekIndex
  ).filter(day => day.isHoliday || day.isFriday).map(day => day.day);
  const prioritizedDays = new Set<number>(holidayDays);

  for (const left of overworked) {
    for (const right of underworked) {
      if (left.personnelId === right.personnelId) continue;
      for (let day = 1; day <= context.totalDays; day++) {
        const leftShift = scored.schedule.assignments[left.personnelId]?.[day] || 'OFF';
        const rightShift = scored.schedule.assignments[right.personnelId]?.[day] || 'OFF';
        const leftWorks = leftShift !== 'OFF' && !leftShift.startsWith('L');
        const rightWorks = rightShift !== 'OFF' && !rightShift.startsWith('L');

        if (leftWorks && !rightWorks) {
          const operation: ScenarioOperation = { kind: 'move', day, fromId: left.personnelId, toId: right.personnelId };
          const key = uniqueKeyForOperation(operation);
          if (!seen.has(key)) {
            seen.add(key);
            operations.push(operation);
          }
        } else if (leftWorks && rightWorks && leftShift !== rightShift) {
          const operation: ScenarioOperation = { kind: 'swap', day, leftId: left.personnelId, rightId: right.personnelId };
          const key = uniqueKeyForOperation(operation);
          if (!seen.has(key)) {
            seen.add(key);
            operations.push(operation);
          }
        }

        if (day < context.totalDays) {
          const nextLeft = scored.schedule.assignments[left.personnelId]?.[day + 1] || 'OFF';
          const nextRight = scored.schedule.assignments[right.personnelId]?.[day + 1] || 'OFF';
          const nextLeftWorks = nextLeft !== 'OFF' && !nextLeft.startsWith('L');
          const nextRightWorks = nextRight !== 'OFF' && !nextRight.startsWith('L');
          if (leftWorks && nextLeftWorks && !rightWorks && !nextRightWorks) {
            const operation: ScenarioOperation = { kind: 'multiSwap', days: [day, day + 1], leftId: left.personnelId, rightId: right.personnelId };
            const key = uniqueKeyForOperation(operation);
            if (!seen.has(key)) {
              seen.add(key);
              operations.push(operation);
            }
          }
        }

        if (prioritizedDays.has(day) && operations.length >= Math.floor(MAX_OPERATIONS_PER_PASS / 2)) {
          break;
        }
      }
    }
  }

  for (let day = 1; day <= context.totalDays; day++) {
    const dayPeople = context.targetPersonnel
      .map(person => ({ personId: person.id, shift: scored.schedule.assignments[person.id]?.[day] || 'OFF' }))
      .filter(item => !item.shift.startsWith('L'));

    if (dayPeople.length < 3) continue;
    const candidates = dayPeople.slice(0, 5);
    for (let index = 0; index <= candidates.length - 3; index++) {
      const cycle: [string, string, string] = [
        candidates[index].personId,
        candidates[index + 1].personId,
        candidates[index + 2].personId,
      ];
      const operation: ScenarioOperation = { kind: 'chainSwap', day, cycle };
      const key = uniqueKeyForOperation(operation);
      if (!seen.has(key)) {
        seen.add(key);
        operations.push(operation);
      }
      if (operations.length >= MAX_OPERATIONS_PER_PASS) return operations;
    }
  }

  return operations.slice(0, MAX_OPERATIONS_PER_PASS);
}

function generateDiversityFocusedOperations(
  scored: ScoredSchedule,
  accepted: readonly ScoredSchedule[],
  context: ScenarioContext
): ScenarioOperation[] {
  if (accepted.length === 0) return [];

  const operations: ScenarioOperation[] = [];
  const seen = new Set<string>();
  const overlapCells: Array<{ personnelId: string; day: number; shift: ShiftType; overlapCount: number }> = [];

  for (const personnelId of context.targetPersonnelIds) {
    for (let day = 1; day <= context.totalDays; day++) {
      const shift = getAssignedShift(scored.schedule, personnelId, day);
      if (shift.startsWith('L')) continue;
      const overlapCount = accepted.reduce((count, scenario) => {
        return count + (getAssignedShift(scenario.schedule, personnelId, day) === shift ? 1 : 0);
      }, 0);
      if (overlapCount > 0) {
        overlapCells.push({ personnelId, day, shift, overlapCount });
      }
    }
  }

  overlapCells.sort((left, right) => right.overlapCount - left.overlapCount || left.day - right.day);

  const addOperation = (operation: ScenarioOperation) => {
    const key = uniqueKeyForOperation(operation);
    if (seen.has(key)) return;
    seen.add(key);
    operations.push(operation);
  };

  for (const cell of overlapCells.slice(0, Math.min(overlapCells.length, MAX_OPERATIONS_PER_PASS))) {
    const dayCandidates = context.targetPersonnelIds
      .filter(otherId => otherId !== cell.personnelId)
      .map(otherId => ({
        personnelId: otherId,
        shift: getAssignedShift(scored.schedule, otherId, cell.day),
        overlapCount: accepted.reduce((count, scenario) => {
          return count + (getAssignedShift(scenario.schedule, otherId, cell.day) === getAssignedShift(scored.schedule, otherId, cell.day) ? 1 : 0);
        }, 0),
      }))
      .filter(candidate => !candidate.shift.startsWith('L') && candidate.shift !== cell.shift)
      .sort((left, right) => right.overlapCount - left.overlapCount);

    for (const candidate of dayCandidates.slice(0, 4)) {
      addOperation({ kind: 'swap', day: cell.day, leftId: cell.personnelId, rightId: candidate.personnelId });

      const leftShift = cell.shift;
      const rightShift = candidate.shift;
      if (leftShift === 'OFF' && rightShift !== 'OFF') {
        addOperation({ kind: 'move', day: cell.day, fromId: candidate.personnelId, toId: cell.personnelId });
      }
      if (rightShift === 'OFF' && leftShift !== 'OFF') {
        addOperation({ kind: 'move', day: cell.day, fromId: cell.personnelId, toId: candidate.personnelId });
      }

      if (cell.day < context.totalDays) {
        const nextLeft = getAssignedShift(scored.schedule, cell.personnelId, cell.day + 1);
        const nextRight = getAssignedShift(scored.schedule, candidate.personnelId, cell.day + 1);
        if (!nextLeft.startsWith('L') && !nextRight.startsWith('L') && (nextLeft !== nextRight || leftShift !== rightShift)) {
          addOperation({ kind: 'multiSwap', days: [cell.day, cell.day + 1], leftId: cell.personnelId, rightId: candidate.personnelId });
        }
      }
    }

    const chainCandidates = [cell.personnelId, ...dayCandidates.map(candidate => candidate.personnelId)]
      .filter((personnelId, index, ids) => ids.indexOf(personnelId) === index)
      .slice(0, 4);
    if (chainCandidates.length >= 3) {
      addOperation({ kind: 'chainSwap', day: cell.day, cycle: [chainCandidates[0], chainCandidates[1], chainCandidates[2]] });
    }

    if (operations.length >= MAX_OPERATIONS_PER_PASS) {
      break;
    }
  }

  return operations.slice(0, MAX_OPERATIONS_PER_PASS);
}

function generateOperationsForScenario(
  scored: ScoredSchedule,
  scenarioType: ScenarioType,
  accepted: readonly ScoredSchedule[],
  context: ScenarioContext
): ScenarioOperation[] {
  const requestOps = generateRequestFocusedOperations(scored, context);
  const fairnessOps = generateFairnessFocusedOperations(scored, context);
  const diversityOps = generateDiversityFocusedOperations(scored, accepted, context);
  const merged: ScenarioOperation[] = [];
  const seen = new Set<string>();

  const addAll = (operations: ScenarioOperation[]) => {
    for (const operation of operations) {
      const key = uniqueKeyForOperation(operation);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(operation);
      if (merged.length >= MAX_OPERATIONS_PER_PASS) return;
    }
  };

  if (scenarioType === 'REQUESTS') {
    addAll(diversityOps.slice(0, 28));
    addAll(requestOps);
    addAll(fairnessOps.slice(0, 18));
  } else if (scenarioType === 'FAIRNESS') {
    addAll(diversityOps.slice(0, 28));
    addAll(fairnessOps);
    addAll(requestOps.slice(0, 18));
  } else {
    addAll(diversityOps.slice(0, 36));
    addAll(requestOps.slice(0, 24));
    addAll(fairnessOps.slice(0, 24));
  }

  return merged.slice(0, MAX_OPERATIONS_PER_PASS);
}

function applyScenarioOperation(
  schedule: MonthlySchedule,
  operation: ScenarioOperation,
  context: ScenarioContext
): MonthlySchedule | null {
  const assignments = cloneAssignments(schedule.assignments);

  const ensurePerson = (personnelId: string) => {
    if (!assignments[personnelId]) assignments[personnelId] = {};
  };

  if (operation.kind === 'swap') {
    ensurePerson(operation.leftId);
    ensurePerson(operation.rightId);
    const leftShift = assignments[operation.leftId][operation.day] || 'OFF';
    const rightShift = assignments[operation.rightId][operation.day] || 'OFF';
    if (leftShift === rightShift) return null;
    assignments[operation.leftId][operation.day] = rightShift;
    assignments[operation.rightId][operation.day] = leftShift;
  }

  if (operation.kind === 'move') {
    ensurePerson(operation.fromId);
    ensurePerson(operation.toId);
    const fromShift = assignments[operation.fromId][operation.day] || 'OFF';
    const toShift = assignments[operation.toId][operation.day] || 'OFF';
    if (fromShift === 'OFF' || fromShift.startsWith('L') || toShift !== 'OFF') return null;
    assignments[operation.toId][operation.day] = fromShift;
    assignments[operation.fromId][operation.day] = 'OFF';
  }

  if (operation.kind === 'multiSwap') {
    ensurePerson(operation.leftId);
    ensurePerson(operation.rightId);
    for (const day of operation.days) {
      const leftShift = assignments[operation.leftId][day] || 'OFF';
      const rightShift = assignments[operation.rightId][day] || 'OFF';
      assignments[operation.leftId][day] = rightShift;
      assignments[operation.rightId][day] = leftShift;
    }
  }

  if (operation.kind === 'chainSwap') {
    const [first, second, third] = operation.cycle;
    ensurePerson(first);
    ensurePerson(second);
    ensurePerson(third);
    const firstShift = assignments[first][operation.day] || 'OFF';
    const secondShift = assignments[second][operation.day] || 'OFF';
    const thirdShift = assignments[third][operation.day] || 'OFF';
    if (firstShift === secondShift && secondShift === thirdShift) return null;
    assignments[second][operation.day] = firstShift;
    assignments[third][operation.day] = secondShift;
    assignments[first][operation.day] = thirdShift;
  }

  return verifyScenarioSchedule(assignments, context);
}

function localSearchScenario(
  initial: ScoredSchedule,
  scenarioType: ScenarioType,
  accepted: readonly ScoredSchedule[],
  context: ScenarioContext
): ScoredSchedule {
  let current = initial;
  const startingScore = initial.totalScore;

  for (let step = 0; step < MAX_LOCAL_SEARCH_STEPS; step++) {
    const operations = generateOperationsForScenario(current, scenarioType, accepted, context);
    let bestCandidate: ScoredSchedule | null = null;
    let bestValue = candidateObjective(current, accepted, context, startingScore);

    for (const operation of operations) {
      const updatedSchedule = applyScenarioOperation(current.schedule, operation, context);
      if (!updatedSchedule) continue;
      const updatedHardWarningCount = countHardConstraintWarnings(updatedSchedule.warnings);
      if (!isHardWarningCountAcceptable(updatedHardWarningCount)) continue;

      const candidate = evaluateScenario(updatedSchedule, scenarioType, initial.id, context);
      if ((startingScore - candidate.totalScore) > MAX_ACCEPTABLE_SCORE_DROP) continue;

      const candidateValue = candidateObjective(candidate, accepted, context, startingScore);
      if (candidateValue > bestValue + 0.1) {
        bestCandidate = candidate;
        bestValue = candidateValue;
      }
    }

    if (!bestCandidate) break;
    current = bestCandidate;
  }

  return current;
}

function refineScenarioForDifferenceWindow(
  initial: ScoredSchedule,
  scenarioType: ScenarioType,
  accepted: readonly ScoredSchedule[],
  context: ScenarioContext
): ScoredSchedule {
  if (accepted.length === 0) return initial;

  let current = initial;
  const baselineScore = initial.totalScore;
  let bestDistance = Math.max(...getCandidateDifferences(current, accepted, context).map(differenceDistanceFromWindow));

  for (let step = 0; step < MAX_DIVERSITY_REFINEMENT_STEPS; step++) {
    const operations = [
      ...generateDiversityFocusedOperations(current, accepted, context),
      ...generateOperationsForScenario(current, scenarioType, accepted, context),
    ];

    let bestCandidate: ScoredSchedule | null = null;
    let bestValue = candidateObjective(current, accepted, context, baselineScore);
    let bestCandidateDistance = bestDistance;

    for (const operation of operations) {
      const updatedSchedule = applyScenarioOperation(current.schedule, operation, context);
      if (!updatedSchedule) continue;
      const updatedHardWarningCount = countHardConstraintWarnings(updatedSchedule.warnings);
      if (!isHardWarningCountAcceptable(updatedHardWarningCount)) continue;

      const candidate = evaluateScenario(updatedSchedule, scenarioType, initial.id, context);
      if ((baselineScore - candidate.totalScore) > MAX_ACCEPTABLE_SCORE_DROP) continue;

      const candidateDifferences = getCandidateDifferences(candidate, accepted, context);
      const candidateDistance = Math.max(...candidateDifferences.map(differenceDistanceFromWindow));
      const candidateValue = candidateObjective(candidate, accepted, context, baselineScore);
      const distanceImproved = candidateDistance < bestCandidateDistance - 0.05;
      const valueImproved = candidateValue > bestValue + 0.1;

      if (distanceImproved || (candidateDistance <= bestCandidateDistance + 0.05 && valueImproved)) {
        bestCandidate = candidate;
        bestValue = candidateValue;
        bestCandidateDistance = candidateDistance;
      }
    }

    if (!bestCandidate) break;
    current = bestCandidate;
    bestDistance = bestCandidateDistance;
    if (bestDistance === 0 && differencesAreAcceptable(current, accepted, context).ok) {
      break;
    }
  }

  return current;
}

function differencesAreAcceptable(
  candidate: ScoredSchedule,
  accepted: readonly ScoredSchedule[],
  context: ScenarioContext
): { ok: boolean; message?: string } {
  if (accepted.length === 0) return { ok: true };

  const differences = accepted.map(item => ({
    key: SCENARIO_KEYS[item.type],
    diff: calculateScenarioDifferencePercent(item.schedule, candidate.schedule, context.targetPersonnelIds, context.totalDays),
  }));

  const tooSmall = differences.find(item => item.diff < MIN_DIFFERENCE_PERCENT);
  if (tooSmall) {
    return {
      ok: false,
      message: `اختلاف سناریوی ${SCENARIO_KEYS[candidate.type]} با سناریوی ${tooSmall.key} فقط ${tooSmall.diff.toFixed(1)}٪ بود و به حداقل ${MIN_DIFFERENCE_PERCENT}٪ نرسید.`,
    };
  }

  const tooLarge = differences.find(item => item.diff > MAX_DIFFERENCE_PERCENT);
  if (tooLarge) {
    return {
      ok: false,
      message: `اختلاف سناریوی ${SCENARIO_KEYS[candidate.type]} با سناریوی ${tooLarge.key} برابر ${tooLarge.diff.toFixed(1)}٪ شد و از سقف ${MAX_DIFFERENCE_PERCENT}٪ عبور کرد.`,
    };
  }

  return { ok: true };
}

function annotatePairwiseDifferences(
  scenarios: ScoredSchedule[],
  context: ScenarioContext
): ScoredSchedule[] {
  return scenarios.map(scenario => ({
    ...scenario,
    pairwiseDifference: Object.fromEntries(
      scenarios
        .filter(other => other.id !== scenario.id)
        .map(other => [
          other.scenarioKey,
          calculateScenarioDifferencePercent(scenario.schedule, other.schedule, context.targetPersonnelIds, context.totalDays),
        ])
    ),
  }));
}

function chooseScenarioCandidate(
  scenarioType: ScenarioType,
  scenarioId: number,
  accepted: readonly ScoredSchedule[],
  context: ScenarioContext
): { candidate: ScoredSchedule; attempts: number } {
  const seedVariants = buildSeedPersonnelVariants(context.personnelList, scenarioType, context);
  let attempts = 0;
  let bestCandidate: ScoredSchedule | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;
  let bestInRangeCandidate: ScoredSchedule | null = null;
  let bestInRangeValue = Number.NEGATIVE_INFINITY;

  for (const personnelSeed of seedVariants) {
    attempts += 1;
    const initial = initialScoredSchedule(scenarioType, scenarioId, context, personnelSeed);
    const locallyOptimized = localSearchScenario(initial, scenarioType, accepted, context);
    const refined = refineScenarioForDifferenceWindow(locallyOptimized, scenarioType, accepted, context);

    const hardWarningCount = countHardConstraintWarnings(refined.schedule.warnings);
    if (!isHardWarningCountAcceptable(hardWarningCount)) {
      continue;
    }

    const value = candidateObjective(refined, accepted, context, initial.totalScore);
    if (value > bestValue) {
      bestCandidate = refined;
      bestValue = value;
    }

    if (differencesAreAcceptable(refined, accepted, context).ok && value > bestInRangeValue) {
      bestInRangeCandidate = refined;
      bestInRangeValue = value;
    }
  }

  return {
    candidate: bestInRangeCandidate || bestCandidate || initialScoredSchedule(scenarioType, scenarioId, context, seedVariants[0] || context.personnelList),
    attempts,
  };
}

export function generateAndScoreScenarios(
  year: number,
  month: number,
  personnelList: readonly Personnel[],
  requests: readonly ShiftRequest[],
  settings: SystemSettings,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex?: number,
  monthlyDutyHours?: any,
  targetJobGroup?: 'nurse' | 'assistant',
  currentAssignments?: Record<string, Record<number, ShiftType>> | null,
  lockedRows: string[] = []
): ScenarioGenerationResult {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const lockedIds = new Set(lockedRows);
  const targetPersonnel = personnelList.filter(person =>
    person.active &&
    !lockedIds.has(person.id) &&
    (!targetJobGroup || person.jobGroup === targetJobGroup)
  );
  const context: ScenarioContext = {
    year,
    month,
    personnelList,
    requests,
    settings,
    customHolidays,
    firstDayOfWeekIndex,
    monthlyDutyHours,
    targetJobGroup,
    currentAssignments,
    lockedRows,
    totalDays: calendar.length,
    targetPersonnel,
    targetPersonnelIds: targetPersonnel.map(person => person.id),
  };

  const generationLog: string[] = [];
  const explored: ScoredSchedule[] = [];
  const accepted: ScoredSchedule[] = [];

  let scenarioId = 1;
  for (const scenarioType of scenarioOrder) {
    const { candidate, attempts } = chooseScenarioCandidate(scenarioType, scenarioId++, accepted, context);
    explored.push(candidate);

    const hardWarningCount = countHardConstraintWarnings(candidate.schedule.warnings);
    if (!isHardWarningCountAcceptable(hardWarningCount)) {
      const reason = `سناریوی ${SCENARIO_KEYS[scenarioType]} پس از ${attempts} تلاش، ${hardWarningCount} هشدار سخت داشت و چون از سقف مجاز ${MAX_ALLOWED_HARD_WARNINGS_PER_SCENARIO} مورد عبور کرد کنار گذاشته شد.`;
      generationLog.push(reason);
      console.warn('[scenario-generator]', reason);
      continue;
    }

    const differenceCheck = differencesAreAcceptable(candidate, accepted, context);
    if (!differenceCheck.ok) {
      const differences = getCandidateDifferences(candidate, accepted, context);
      const reason = `سناریوی ${SCENARIO_KEYS[scenarioType]} با وجود ${attempts} دور تلاش و اعمال swap / move / multi-swap / chain-swap، هنوز به بازه اختلاف ${MIN_DIFFERENCE_PERCENT} تا ${MAX_DIFFERENCE_PERCENT} درصد نرسید. اختلاف‌های فعلی: ${differences.map(diff => `${diff.toFixed(1)}٪`).join(' ، ')}.`;
      generationLog.push(reason);
      console.warn('[scenario-generator]', reason);
      continue;
    }

    accepted.push(candidate);
  }

  if (accepted.length < 3) {
    const reason = `فقط ${accepted.length} سناریوی معتبر و به‌اندازه کافی متفاوت تولید شد؛ از ساخت نسخه‌های بسیار مشابه خودداری شد.`;
    generationLog.push(reason);
    console.warn('[scenario-generator]', reason);
  }

  return {
    all: explored.map(scenario => ({
      ...scenario,
      title: SCENARIO_TITLES[scenario.type].title,
      shortTitle: SCENARIO_TITLES[scenario.type].shortTitle,
    })),
    top3: annotatePairwiseDifferences(accepted, context),
    generationLog,
  };
}
