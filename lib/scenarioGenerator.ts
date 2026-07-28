import { generateJalaliMonthCalendar } from './jalali';
import { verifyCoverageAndLeaders, solveWithPriority, generatePersonnelReports } from './solver';
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
  totalDays: number;
  targetPersonnel: Personnel[];
  targetPersonnelIds: string[];
}

const MIN_DIFFERENCE_PERCENT = 20;
const MAX_DIFFERENCE_PERCENT = 30;
const MAX_LOCAL_SEARCH_STEPS = 18;
const MAX_OPERATIONS_PER_PASS = 48;

const uniqueKeyForOperation = (operation: ScenarioOperation) => JSON.stringify(operation);
const scenarioOrder: ScenarioType[] = ['REQUESTS', 'FAIRNESS', 'MIXED'];

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
  if (!context.targetJobGroup || !context.currentAssignments) return optimized;
  const merged = cloneAssignments(optimized);

  for (const person of context.personnelList) {
    if (person.jobGroup === context.targetJobGroup) continue;
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
  const verification = verifyCoverageAndLeaders(
    context.year,
    context.month,
    context.personnelList,
    assignments,
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
    assignments,
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

  const targetPeople = personnelList.filter(person => !context.targetJobGroup || person.jobGroup === context.targetJobGroup);
  const preservedPeople = personnelList.filter(person => context.targetJobGroup && person.jobGroup !== context.targetJobGroup);

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

  if (!context.targetJobGroup) {
    return rotatedTarget;
  }

  return [...rotatedTarget, ...preservedPeople];
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

function generateOperationsForScenario(
  scored: ScoredSchedule,
  scenarioType: ScenarioType,
  context: ScenarioContext
): ScenarioOperation[] {
  const requestOps = generateRequestFocusedOperations(scored, context);
  const fairnessOps = generateFairnessFocusedOperations(scored, context);
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
    addAll(requestOps);
    addAll(fairnessOps.slice(0, 12));
  } else if (scenarioType === 'FAIRNESS') {
    addAll(fairnessOps);
    addAll(requestOps.slice(0, 12));
  } else {
    addAll(requestOps.slice(0, 18));
    addAll(fairnessOps.slice(0, 18));
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

function differenceBonus(candidate: ScoredSchedule, accepted: readonly ScoredSchedule[], context: ScenarioContext): number {
  if (accepted.length === 0) return 0;
  const differences = accepted.map(item =>
    calculateScenarioDifferencePercent(item.schedule, candidate.schedule, context.targetPersonnelIds, context.totalDays)
  );

  return Math.min(...differences.map(diff => {
    if (diff < MIN_DIFFERENCE_PERCENT) return diff * 1.8;
    if (diff <= MAX_DIFFERENCE_PERCENT) return 50 - Math.abs(25 - diff);
    return Math.max(0, 35 - ((diff - MAX_DIFFERENCE_PERCENT) * 2));
  }));
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
    const operations = generateOperationsForScenario(current, scenarioType, context);
    let bestCandidate: ScoredSchedule | null = null;
    let bestValue = current.totalScore + differenceBonus(current, accepted, context);

    for (const operation of operations) {
      const updatedSchedule = applyScenarioOperation(current.schedule, operation, context);
      if (!updatedSchedule) continue;
      if (countHardConstraintWarnings(updatedSchedule.warnings) > 0) continue;

      const candidate = evaluateScenario(updatedSchedule, scenarioType, initial.id, context);
      if (candidate.totalScore + 8 < startingScore) continue;

      const candidateValue = candidate.totalScore + differenceBonus(candidate, accepted, context);
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
  currentAssignments?: Record<string, Record<number, ShiftType>> | null
): ScenarioGenerationResult {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const targetPersonnel = personnelList.filter(person => person.active && (!targetJobGroup || person.jobGroup === targetJobGroup));
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
    totalDays: calendar.length,
    targetPersonnel,
    targetPersonnelIds: targetPersonnel.map(person => person.id),
  };

  const generationLog: string[] = [];
  const explored: ScoredSchedule[] = [];
  const accepted: ScoredSchedule[] = [];

  let scenarioId = 1;
  for (const scenarioType of scenarioOrder) {
    const seedPersonnel = reorderPersonnelForScenario(personnelList, scenarioType, context);
    const initial = initialScoredSchedule(scenarioType, scenarioId++, context, seedPersonnel);
    const refined = localSearchScenario(initial, scenarioType, accepted, context);
    explored.push(refined);

    if (countHardConstraintWarnings(refined.schedule.warnings) > 0) {
      const reason = `سناریوی ${SCENARIO_KEYS[scenarioType]} کنار گذاشته شد چون هنوز ${countHardConstraintWarnings(refined.schedule.warnings)} هشدار سخت دارد.`;
      generationLog.push(reason);
      console.warn('[scenario-generator]', reason);
      continue;
    }

    const differenceCheck = differencesAreAcceptable(refined, accepted, context);
    if (!differenceCheck.ok) {
      const reason = differenceCheck.message || `سناریوی ${SCENARIO_KEYS[scenarioType]} به‌اندازه کافی متمایز نبود.`;
      generationLog.push(reason);
      console.warn('[scenario-generator]', reason);
      continue;
    }

    accepted.push(refined);
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
