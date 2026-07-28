import { generateJalaliMonthCalendar } from './jalali';
import {
  JobGroup,
  MonthlySchedule,
  Personnel,
  ShiftRequest,
  ShiftType,
  SystemSettings,
} from './types';
import { isDayInRequestScope } from '../domain/requests/request-scope-matcher';
import { generatePersonnelReports } from './solver';

export type ScenarioType = 'FAIRNESS' | 'REQUESTS' | 'MIXED';
export type ScenarioKey = 'A' | 'B' | 'C';

export interface ScenarioWeights {
  request: number;
  fairness: number;
  optimization: number;
}

export interface ScenarioMetrics {
  requestScore: number;
  fairnessScore: number;
  satisfactionScore: number;
  optimizationScore: number;
  weightedTotal: number;
  requestSatisfiedWeight: number;
  requestTotalWeight: number;
  averageDutyDeviationHours: number;
  hourBalanceScore: number;
  shiftBalanceScore: number;
  holidayBalanceScore: number;
  warningCount: number;
  hardWarningCount: number;
}

export interface ScoredSchedule {
  id: number;
  scenarioKey: ScenarioKey;
  type: ScenarioType;
  title: string;
  shortTitle: string;
  schedule: MonthlySchedule;
  weights: ScenarioWeights;
  metrics: ScenarioMetrics;
  scoreA: number;
  scoreB: number;
  scoreC: number;
  totalScore: number;
  strengths: string[];
  weaknesses: string[];
  analysis: string;
  targetJobGroup?: JobGroup;
  relevantWarningCount: number;
  relevantHardWarningCount: number;
  pairwiseDifference?: Record<string, number>;
}

const HARD_WARNING_PREFIXES = [
  'Coverage Shortage:',
  'Overstaffing:',
  'Missing Shift Leader:',
  'Max Consecutive:',
  'Mandatory Rest:',
] as const;

export const SCENARIO_WEIGHTS: Record<ScenarioType, ScenarioWeights> = {
  REQUESTS: { request: 70, fairness: 20, optimization: 10 },
  FAIRNESS: { fairness: 70, request: 20, optimization: 10 },
  MIXED: { fairness: 45, request: 45, optimization: 10 },
};

export const SCENARIO_KEYS: Record<ScenarioType, ScenarioKey> = {
  REQUESTS: 'A',
  FAIRNESS: 'B',
  MIXED: 'C',
};

export const SCENARIO_TITLES: Record<ScenarioType, { title: string; shortTitle: string }> = {
  REQUESTS: { title: 'سناریو A · درخواست‌محور', shortTitle: 'درخواست‌محور' },
  FAIRNESS: { title: 'سناریو B · عدالت‌محور', shortTitle: 'عدالت‌محور' },
  MIXED: { title: 'سناریو C · تلفیقی', shortTitle: 'تلفیقی' },
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const average = (values: number[]) => {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const standardDeviation = (values: number[]) => {
  if (values.length <= 1) return 0;
  const mean = average(values);
  const variance = average(values.map(value => (value - mean) ** 2));
  return Math.sqrt(variance);
};

function balanceScore(values: number[], multiplier: number): number {
  if (values.length <= 1) return 100;
  const mean = average(values);
  const deviation = standardDeviation(values);
  if (mean === 0) {
    return deviation === 0 ? 100 : 0;
  }
  const normalized = deviation / Math.max(1, mean);
  return Number((100 * (1 - clamp(normalized * multiplier, 0, 1))).toFixed(2));
}

function targetGroupPersonnel(
  personnelList: readonly Personnel[],
  targetJobGroup?: JobGroup
): Personnel[] {
  return personnelList.filter(person => person.active && (!targetJobGroup || person.jobGroup === targetJobGroup));
}

function buildPersonnelNameMap(personnelList: readonly Personnel[]): Map<string, Personnel> {
  const nameMap = new Map<string, Personnel>();
  for (const person of personnelList) {
    nameMap.set(`${person.firstName} ${person.lastName}`, person);
  }
  return nameMap;
}

function warningTargetsGroup(
  warning: string,
  personnelList: readonly Personnel[],
  targetJobGroup: JobGroup
): boolean {
  const normalizedWarning = warning.replace('کمک بهیار', 'کمک‌بهیار');
  const mentionsAssistant = normalizedWarning.includes('کمک‌بهیار') || normalizedWarning.includes('بهیار');
  const mentionsNurse = normalizedWarning.includes('پرستار');
  const mentionsLeader = normalizedWarning.includes('سرشیفت');

  if (mentionsAssistant && !mentionsNurse) return targetJobGroup === 'assistant';
  if ((mentionsNurse || mentionsLeader) && !mentionsAssistant) return targetJobGroup === 'nurse';

  for (const person of personnelList) {
    const fullName = `${person.firstName} ${person.lastName}`;
    if (warning.includes(fullName)) {
      return person.jobGroup === targetJobGroup;
    }
  }

  return false;
}

export function filterWarningsForScenarioGroup(
  warnings: readonly string[],
  personnelList: readonly Personnel[],
  targetJobGroup?: JobGroup
): string[] {
  if (!targetJobGroup) return [...warnings];
  return warnings.filter(warning => warningTargetsGroup(warning, personnelList, targetJobGroup));
}

export function countHardConstraintWarnings(warnings: readonly string[]): number {
  return warnings.filter(warning => HARD_WARNING_PREFIXES.some(prefix => warning.startsWith(prefix))).length;
}

function shiftSatisfiesPreferred(assigned: ShiftType, preferred: string): boolean {
  if (preferred === 'M') return ['M', 'ME', 'MN', 'MEN'].includes(assigned);
  if (preferred === 'E') return ['E', 'ME', 'EN', 'MEN'].includes(assigned);
  if (preferred === 'N') return ['N', 'EN', 'MN', 'MEN'].includes(assigned);
  return assigned === preferred;
}

function shiftViolatesAvoidRule(assigned: ShiftType, preferred: string): boolean {
  return shiftSatisfiesPreferred(assigned, preferred);
}

function requestDayWeight(request: ShiftRequest): number {
  let weight = request.isEssential ? 1.25 : 1;
  if (request.requestType === 'OFF' && request.offHardness === 'hard') weight += 0.15;
  if (request.requestType === 'leave' && request.isEssential) weight += 0.1;
  return weight;
}

function requestSatisfiedForDay(request: ShiftRequest, assigned: ShiftType, patternExpected?: string): boolean {
  if (request.requestType === 'OFF') {
    return assigned === 'OFF' || assigned.startsWith('L');
  }
  if (request.requestType === 'leave') {
    return assigned.startsWith('L');
  }
  if (request.requestType === 'shift') {
    return !!request.preferredShift && shiftSatisfiesPreferred(assigned, request.preferredShift);
  }
  if (request.requestType === 'avoid_shift') {
    return !request.preferredShift || !shiftViolatesAvoidRule(assigned, request.preferredShift);
  }
  if (request.requestType === 'pattern') {
    if (!patternExpected) return true;
    if (patternExpected === 'OFF') return assigned === 'OFF';
    if (patternExpected.startsWith('L')) return assigned.startsWith('L');
    return shiftSatisfiesPreferred(assigned, patternExpected);
  }
  return true;
}

function calculateRequestScore(
  schedule: MonthlySchedule,
  personnelList: readonly Personnel[],
  requests: readonly ShiftRequest[],
  year: number,
  month: number,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex: number | undefined,
  targetJobGroup?: JobGroup
): Pick<ScenarioMetrics, 'requestScore' | 'requestSatisfiedWeight' | 'requestTotalWeight'> {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const eligiblePersonnelIds = new Set(targetGroupPersonnel(personnelList, targetJobGroup).map(person => person.id));

  let totalWeight = 0;
  let satisfiedWeight = 0;

  for (const request of requests) {
    if (!eligiblePersonnelIds.has(request.personnelId)) continue;
    const assignments = schedule.assignments[request.personnelId] || {};

    for (let day = 1; day <= calendar.length; day++) {
      if (!isDayInRequestScope(day, calendar[day - 1].dayOfWeek, request)) continue;

      const weight = requestDayWeight(request);
      const assigned = assignments[day] || 'OFF';
      const patternExpected = request.requestType === 'pattern' && request.patternSteps && request.patternSteps.length > 0
        ? request.patternSteps[(day - 1) % request.patternSteps.length]
        : undefined;

      totalWeight += weight;
      if (requestSatisfiedForDay(request, assigned, patternExpected)) {
        satisfiedWeight += weight;
      }
    }
  }

  if (totalWeight === 0) {
    return { requestScore: 100, requestSatisfiedWeight: 0, requestTotalWeight: 0 };
  }

  return {
    requestScore: Number(((satisfiedWeight / totalWeight) * 100).toFixed(2)),
    requestSatisfiedWeight: Number(satisfiedWeight.toFixed(2)),
    requestTotalWeight: Number(totalWeight.toFixed(2)),
  };
}

function calculateFairnessScore(
  schedule: MonthlySchedule,
  personnelList: readonly Personnel[],
  settings: SystemSettings,
  year: number,
  month: number,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex: number | undefined,
  monthlyDutyHours: any,
  targetJobGroup?: JobGroup
): Pick<ScenarioMetrics, 'fairnessScore' | 'averageDutyDeviationHours' | 'hourBalanceScore' | 'shiftBalanceScore' | 'holidayBalanceScore'> {
  const relevantPersonnel = targetGroupPersonnel(personnelList, targetJobGroup);
  if (relevantPersonnel.length <= 1) {
    return {
      fairnessScore: 100,
      averageDutyDeviationHours: 0,
      hourBalanceScore: 100,
      shiftBalanceScore: 100,
      holidayBalanceScore: 100,
    };
  }

  const reports = generatePersonnelReports(
    year,
    month,
    relevantPersonnel,
    schedule,
    settings,
    { ...customHolidays },
    firstDayOfWeekIndex,
    monthlyDutyHours
  );

  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const workedHours = reports.map(report => report.workedHours);
  const averageWorked = average(workedHours);
  const referenceDeviations = reports.map(report => {
    const reference = report.dutyHours > 0 ? report.dutyHours : averageWorked;
    return Math.abs(report.workedHours - reference);
  });

  const hourSpreadScore = balanceScore(workedHours, 1.45);
  const dutyClosenessScore = Number((100 * (1 - clamp(average(referenceDeviations) / 36, 0, 1))).toFixed(2));
  const hourBalanceScore = Number(((hourSpreadScore * 0.7) + (dutyClosenessScore * 0.3)).toFixed(2));

  const shiftBalanceScore = Number(([
    balanceScore(reports.map(report => report.mCount), 1.7),
    balanceScore(reports.map(report => report.eCount), 1.7),
    balanceScore(reports.map(report => report.nCount), 1.7),
  ].reduce((sum, score) => sum + score, 0) / 3).toFixed(2));

  const holidayBurdenCounts = relevantPersonnel.map(person => {
    let count = 0;
    const assignments = schedule.assignments[person.id] || {};
    for (let day = 1; day <= calendar.length; day++) {
      const assigned = assignments[day] || 'OFF';
      if ((calendar[day - 1].isHoliday || calendar[day - 1].isFriday) && assigned !== 'OFF' && !assigned.startsWith('L')) {
        count += 1;
      }
    }
    return count;
  });

  const holidayBalanceScore = balanceScore(holidayBurdenCounts, 1.9);
  const fairnessScore = Number((
    (hourBalanceScore * 0.45) +
    (shiftBalanceScore * 0.35) +
    (holidayBalanceScore * 0.2)
  ).toFixed(2));

  return {
    fairnessScore,
    averageDutyDeviationHours: Number(average(referenceDeviations).toFixed(2)),
    hourBalanceScore,
    shiftBalanceScore,
    holidayBalanceScore,
  };
}

function calculateOptimizationScore(
  schedule: MonthlySchedule,
  personnelList: readonly Personnel[],
  settings: SystemSettings,
  year: number,
  month: number,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex: number | undefined,
  monthlyDutyHours: any,
  targetJobGroup?: JobGroup
): Pick<ScenarioMetrics, 'optimizationScore' | 'warningCount' | 'hardWarningCount'> {
  const reports = generatePersonnelReports(
    year,
    month,
    targetGroupPersonnel(personnelList, targetJobGroup),
    schedule,
    settings,
    { ...customHolidays },
    firstDayOfWeekIndex,
    monthlyDutyHours
  );

  const meanDeviation = average(reports.map(report => {
    const reference = report.dutyHours > 0 ? report.dutyHours : average(reports.map(inner => inner.workedHours));
    return Math.abs(report.workedHours - reference);
  }));

  const warningCount = schedule.warnings.length;
  const hardWarningCount = countHardConstraintWarnings(schedule.warnings);
  const warningScore = clamp(100 - ((warningCount * 6) + (hardWarningCount * 18)), 0, 100);
  const efficiencyScore = clamp(100 * (1 - clamp(meanDeviation / 28, 0, 1)), 0, 100);
  const optimizationScore = Number(((warningScore * 0.65) + (efficiencyScore * 0.35)).toFixed(2));

  return {
    optimizationScore,
    warningCount,
    hardWarningCount,
  };
}

function buildStrengthsAndWeaknesses(
  scenarioType: ScenarioType,
  requestScore: number,
  fairnessScore: number,
  optimizationScore: number,
  averageDutyDeviationHours: number,
  warningCount: number
): { strengths: string[]; weaknesses: string[]; analysis: string } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (requestScore >= 90) strengths.push('اجرای بسیار خوب درخواست‌های ثبت‌شده پرسنل');
  else if (requestScore >= 80) strengths.push('پوشش مناسب بخش عمده‌ای از درخواست‌های پرسنل');
  else weaknesses.push('در اجرای درخواست‌های ثبت‌شده هنوز ظرفیت بهبود وجود دارد');

  if (fairnessScore >= 90) strengths.push('توزیع بسیار متوازن شیفت‌ها و ساعات کاری بین افراد');
  else if (fairnessScore >= 80) strengths.push('عدالت قابل قبول در پخش شیفت‌ها و بار کاری');
  else weaknesses.push('اختلاف بار کاری یا توزیع شیفت‌ها هنوز محسوس است');

  if (optimizationScore >= 90) strengths.push('پاکیزگی عملیاتی بالا و کمترین اصطکاک در اجرای برنامه');
  else if (warningCount > 0) weaknesses.push('پیش از ورود به مقایسه نهایی باید هشدارهای باقی‌مانده رفع شوند');

  if (averageDutyDeviationHours > 18) {
    weaknesses.push('میانگین فاصله از ساعت موظفی بالاست و می‌تواند نارضایتی ایجاد کند');
  }

  const analysis = scenarioType === 'REQUESTS'
    ? 'این سناریو به‌صورت هدفمند رضایت از درخواست‌ها را در اولویت می‌گذارد و برای ماه‌هایی که خواسته‌های فردی اهمیت بیشتری دارند مناسب‌تر است.'
    : scenarioType === 'FAIRNESS'
      ? 'این سناریو بیشترین وزن را به عدالت در توزیع شیفت‌ها و ساعات می‌دهد و برای حفظ توازن تیمی گزینه‌ی مناسبی است.'
      : 'این سناریو تلاش می‌کند بین عدالت و اجرای درخواست‌ها تعادل برقرار کند و معمولاً برای تصمیم نهایی دید متوازن‌تری می‌دهد.';

  return { strengths, weaknesses, analysis };
}

export interface EvaluateScenarioOptions {
  id: number;
  type: ScenarioType;
  schedule: MonthlySchedule;
  personnelList: readonly Personnel[];
  requests: readonly ShiftRequest[];
  settings: SystemSettings;
  year: number;
  month: number;
  customHolidays: Readonly<Record<number, string>>;
  firstDayOfWeekIndex?: number;
  monthlyDutyHours?: any;
  targetJobGroup?: JobGroup;
}

export function evaluateScenarioSchedule(options: EvaluateScenarioOptions): ScoredSchedule {
  const {
    id,
    type,
    schedule,
    personnelList,
    requests,
    settings,
    year,
    month,
    customHolidays,
    firstDayOfWeekIndex,
    monthlyDutyHours,
    targetJobGroup,
  } = options;

  const weights = SCENARIO_WEIGHTS[type];
  const requestMetrics = calculateRequestScore(
    schedule,
    personnelList,
    requests,
    year,
    month,
    customHolidays,
    firstDayOfWeekIndex,
    targetJobGroup
  );
  const fairnessMetrics = calculateFairnessScore(
    schedule,
    personnelList,
    settings,
    year,
    month,
    customHolidays,
    firstDayOfWeekIndex,
    monthlyDutyHours,
    targetJobGroup
  );
  const optimizationMetrics = calculateOptimizationScore(
    schedule,
    personnelList,
    settings,
    year,
    month,
    customHolidays,
    firstDayOfWeekIndex,
    monthlyDutyHours,
    targetJobGroup
  );

  const satisfactionScore = Number(((requestMetrics.requestScore + fairnessMetrics.fairnessScore) / 2).toFixed(2));
  const weightedTotal = Number((
    (requestMetrics.requestScore * (weights.request / 100)) +
    (fairnessMetrics.fairnessScore * (weights.fairness / 100)) +
    (optimizationMetrics.optimizationScore * (weights.optimization / 100))
  ).toFixed(2));

  const insights = buildStrengthsAndWeaknesses(
    type,
    requestMetrics.requestScore,
    fairnessMetrics.fairnessScore,
    optimizationMetrics.optimizationScore,
    fairnessMetrics.averageDutyDeviationHours,
    optimizationMetrics.warningCount
  );

  const labels = SCENARIO_TITLES[type];

  return {
    id,
    scenarioKey: SCENARIO_KEYS[type],
    type,
    title: labels.title,
    shortTitle: labels.shortTitle,
    schedule,
    weights,
    metrics: {
      requestScore: requestMetrics.requestScore,
      fairnessScore: fairnessMetrics.fairnessScore,
      satisfactionScore,
      optimizationScore: optimizationMetrics.optimizationScore,
      weightedTotal,
      requestSatisfiedWeight: requestMetrics.requestSatisfiedWeight,
      requestTotalWeight: requestMetrics.requestTotalWeight,
      averageDutyDeviationHours: fairnessMetrics.averageDutyDeviationHours,
      hourBalanceScore: fairnessMetrics.hourBalanceScore,
      shiftBalanceScore: fairnessMetrics.shiftBalanceScore,
      holidayBalanceScore: fairnessMetrics.holidayBalanceScore,
      warningCount: optimizationMetrics.warningCount,
      hardWarningCount: optimizationMetrics.hardWarningCount,
    },
    scoreA: optimizationMetrics.optimizationScore,
    scoreB: requestMetrics.requestScore,
    scoreC: fairnessMetrics.fairnessScore,
    totalScore: weightedTotal,
    strengths: insights.strengths,
    weaknesses: insights.weaknesses,
    analysis: insights.analysis,
    targetJobGroup,
    relevantWarningCount: schedule.warnings.length,
    relevantHardWarningCount: optimizationMetrics.hardWarningCount,
  };
}

export function evaluateSchedule(
  id: number,
  type: ScenarioType,
  schedule: MonthlySchedule,
  personnelList: readonly Personnel[],
  requests: readonly ShiftRequest[],
  settings: SystemSettings,
  warnings: string[],
  year: number,
  month: number,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex?: number,
  monthlyDutyHours?: any,
  targetJobGroup?: JobGroup
): ScoredSchedule {
  return evaluateScenarioSchedule({
    id,
    type,
    schedule: { ...schedule, warnings },
    personnelList,
    requests,
    settings,
    year,
    month,
    customHolidays,
    firstDayOfWeekIndex,
    monthlyDutyHours,
    targetJobGroup,
  });
}

export function calculateScenarioDifferencePercent(
  left: MonthlySchedule,
  right: MonthlySchedule,
  personnelIds: readonly string[],
  totalDays: number
): number {
  const totalCells = Math.max(1, personnelIds.length * totalDays);
  let changed = 0;

  for (const personnelId of personnelIds) {
    const leftAssignments = left.assignments[personnelId] || {};
    const rightAssignments = right.assignments[personnelId] || {};
    for (let day = 1; day <= totalDays; day++) {
      if ((leftAssignments[day] || 'OFF') !== (rightAssignments[day] || 'OFF')) {
        changed += 1;
      }
    }
  }

  return Number(((changed / totalCells) * 100).toFixed(2));
}

export function generateScoringReportText(scoredSchedules: ScoredSchedule[]): string {
  if (scoredSchedules.length === 0) {
    return 'هیچ سناریوی معتبری برای مقایسه تولید نشده است.';
  }

  const ranked = [...scoredSchedules].sort((left, right) => right.totalScore - left.totalScore);
  let report = '';

  for (const scenario of ranked) {
    report += `📋 ${scenario.title}\n`;
    report += `- امتیاز کل سیستم: ${scenario.totalScore.toFixed(2)}٪\n`;
    report += `- اجرای درخواست‌ها: ${scenario.metrics.requestScore.toFixed(2)}٪\n`;
    report += `- عدالت: ${scenario.metrics.fairnessScore.toFixed(2)}٪\n`;
    report += `- رضایت پرسنل: ${scenario.metrics.satisfactionScore.toFixed(2)}٪\n`;
    report += `- بهره‌وری داخلی: ${scenario.metrics.optimizationScore.toFixed(2)}٪\n`;
    if (scenario.strengths.length > 0) {
      report += `- نقاط قوت: ${scenario.strengths.join('، ')}\n`;
    }
    if (scenario.weaknesses.length > 0) {
      report += `- نقاط قابل بهبود: ${scenario.weaknesses.join('، ')}\n`;
    }
    report += `- تحلیل: ${scenario.analysis}\n\n`;
  }

  report += `🏆 پیشنهاد فعلی سیستم: ${ranked[0].title} با امتیاز ${ranked[0].totalScore.toFixed(2)}٪`;
  return report;
}
