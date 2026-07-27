import { generateJalaliMonthCalendar } from './jalali';
import { isDayInRequestScope } from '../domain/requests/request-scope-matcher';
import { MonthlySchedule, Personnel, ShiftRequest, SystemSettings, ShiftType } from './types';

export type ScenarioType = 'FAIRNESS' | 'REQUESTS' | 'MIXED';
export type ScenarioCode = 'A' | 'B' | 'C';

export interface ScoredSchedule {
  id: number;
  /** A=تلفیقی، B=درخواست‌محور، C=عدالت‌محور. */
  scenarioCode?: ScenarioCode;
  type: ScenarioType;
  schedule: MonthlySchedule;
  scoreA: number;
  scoreB: number;
  scoreC: number;
  totalScore: number;
  strengths: string[];
  weaknesses: string[];
  analysis: string;
}

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

function shiftCovers(shift: ShiftType | undefined, requested: string | undefined): boolean {
  if (!requested || !shift) return false;
  if (requested === 'L') return shift.startsWith('L');
  if (requested === 'OFF') return shift === 'OFF';
  return SHIFT_COMPONENTS[shift]?.includes(requested) ?? false;
}

function requestIsSatisfied(request: ShiftRequest, shift: ShiftType | undefined): boolean {
  if (request.requestType === 'OFF') return shift === 'OFF';
  if (request.requestType === 'leave') return Boolean(shift?.startsWith('L'));
  if (request.requestType === 'avoid_shift') return !shiftCovers(shift, request.preferredShift);
  if (request.requestType === 'shift') return shiftCovers(shift, request.preferredShift);
  return true;
}

function requestScore(
  schedule: MonthlySchedule,
  requests: readonly ShiftRequest[],
  year: number,
  month: number,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex?: number
): number {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  let applicable = 0;
  let satisfied = 0;

  for (const request of requests) {
    // Pattern requests do not currently have a single, comparable preferred shift.
    // They are respected by the solver but are intentionally excluded from this score.
    if (!['shift', 'OFF', 'leave', 'avoid_shift'].includes(request.requestType)) continue;
    const assignments = schedule.assignments[request.personnelId];
    if (!assignments) continue;

    for (const calendarDay of calendar) {
      if (!isDayInRequestScope(calendarDay.day, calendarDay.dayOfWeek, request)) continue;
      applicable += request.isEssential ? 2 : 1;
      if (requestIsSatisfied(request, assignments[calendarDay.day])) {
        satisfied += request.isEssential ? 2 : 1;
      }
    }
  }

  return applicable === 0 ? 100 : Math.max(0, Math.min(100, (satisfied / applicable) * 100));
}

function fairnessScore(schedule: MonthlySchedule, personnelList: readonly Personnel[]): number {
  const groupScores: number[] = [];

  for (const jobGroup of ['nurse', 'assistant'] as const) {
    const group = personnelList.filter(person => person.active && person.jobGroup === jobGroup);
    if (group.length < 2) continue;

    const workedHours = group.map(person => Object.values(schedule.assignments[person.id] || {}).reduce(
      (total, shift) => total + (SHIFT_HOURS[shift] ?? (shift.startsWith('L') ? 7 : 0)),
      0
    ));
    const average = workedHours.reduce((total, value) => total + value, 0) / workedHours.length;
    if (average === 0) {
      groupScores.push(100);
      continue;
    }
    const variance = workedHours.reduce((total, value) => total + ((value - average) ** 2), 0) / workedHours.length;
    const coefficientOfVariation = Math.sqrt(variance) / average;
    // A 50% relative spread scores zero; ordinary small differences remain visible
    // without unfairly punishing months with different contractual duty hours.
    groupScores.push(Math.max(0, Math.min(100, 100 - coefficientOfVariation * 200)));
  }

  return groupScores.length === 0
    ? 100
    : groupScores.reduce((total, value) => total + value, 0) / groupScores.length;
}

function rulesScore(warnings: readonly string[]): number {
  let penalty = 0;
  for (const warning of warnings) {
    const coverageOrLeaderWarning = /کمبود|مازاد|Coverage|Overstaffing|Missing Shift Leader/i.test(warning);
    penalty += coverageOrLeaderWarning ? 12 : 4;
  }
  return Math.max(0, 100 - penalty);
}

/**
 * Scores are deliberately deterministic and based on the actual schedule.  The former
 * implementation used random values, which meant a scenario could change rank without
 * any scheduling change and made a vote impossible to explain or audit.
 */
export function evaluateSchedule(
  id: number,
  type: ScenarioType,
  schedule: MonthlySchedule,
  personnelList: readonly Personnel[],
  requests: readonly ShiftRequest[],
  _settings: SystemSettings,
  warnings: string[],
  year: number,
  month: number,
  customHolidays: Readonly<Record<number, string>>,
  firstDayOfWeekIndex?: number,
  _monthlyDutyHours?: unknown
): ScoredSchedule {
  const scoreA = rulesScore(warnings);
  const scoreB = requestScore(schedule, requests, year, month, customHolidays, firstDayOfWeekIndex);
  const scoreC = fairnessScore(schedule, personnelList);

  const weights = type === 'REQUESTS'
    ? { rules: 0.4, requests: 0.45, fairness: 0.15 }
    : type === 'FAIRNESS'
      ? { rules: 0.4, requests: 0.15, fairness: 0.45 }
      : { rules: 0.5, requests: 0.25, fairness: 0.25 };
  const totalScore = scoreA * weights.rules + scoreB * weights.requests + scoreC * weights.fairness;

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (scoreA >= 95) strengths.push('رعایت کامل قوانین ساختاری و پوشش نیروی موردنیاز');
  else if (scoreA >= 80) strengths.push('رعایت قابل قبول قوانین پایه‌ای شیفت‌بندی');
  else weaknesses.push('هشدارهای ساختاری یا کمبود/مازاد نیرو نیازمند بررسی است');

  if (scoreB >= 85) strengths.push('بخش عمده‌ای از درخواست‌های ثبت‌شده پرسنل تامین شده است');
  else weaknesses.push('همه درخواست‌های پرسنل قابل تامین نبوده‌اند');

  if (scoreC >= 85) strengths.push('توزیع ساعات و شیفت‌ها بین هم‌گروهی‌ها متوازن است');
  else weaknesses.push('توزیع ساعات یا شیفت‌ها هنوز اختلاف محسوسی دارد');

  const analysis = type === 'FAIRNESS'
    ? 'برنامه C با اولویت توزیع عادلانه ساعات و بار شیفت بین پرسنل ساخته شده است.'
    : type === 'REQUESTS'
      ? 'برنامه B با اولویت تامین درخواست‌های ثبت‌شده پرسنل ساخته شده است.'
      : 'برنامه A ترکیبی متوازن از رعایت درخواست‌های پرسنل و عدالت در شیفت‌دهی است.';

  return {
    id,
    type,
    schedule,
    scoreA,
    scoreB,
    scoreC,
    totalScore,
    strengths,
    weaknesses,
    analysis,
  };
}

export function generateScoringReportText(scoredSchedules: ScoredSchedule[]): string {
  let report = '';
  let bestSchedule = scoredSchedules[0];

  for (const scenario of scoredSchedules) {
    if (scenario.totalScore > bestSchedule.totalScore) bestSchedule = scenario;
    const typeFa = scenario.type === 'FAIRNESS' ? 'عدالت‌محور' : scenario.type === 'REQUESTS' ? 'درخواست‌محور' : 'تلفیقی';
    const program = scenario.scenarioCode ? `برنامه ${scenario.scenarioCode}` : `برنامه شماره ${scenario.id}`;

    report += `📋 ${program} - نوع: ${typeFa}\n\n`;
    report += `📊 تفکیک امتیازات:\n`;
    report += `- رعایت قوانین کلی  [${scenario.scoreA.toFixed(0)} از ۱۰۰]\n`;
    report += `- رعایت درخواست‌های پرسنل  [${scenario.scoreB.toFixed(0)} از ۱۰۰]\n`;
    report += `- رعایت عدالت در چینش  [${scenario.scoreC.toFixed(0)} از ۱۰۰]\n\n`;
    report += '💡 نقاط قوت:\n';
    scenario.strengths.forEach(strength => { report += `- ${strength}\n`; });
    report += '\n';
    if (scenario.weaknesses.length > 0) {
      report += '⚠️ موارد نیازمند توجه:\n';
      scenario.weaknesses.forEach(weakness => { report += `- ${weakness}\n`; });
      report += '\n';
    }
    report += `🧐 تحلیل نهایی: ${scenario.analysis}\n---\n\n`;
  }

  const bestLabel = bestSchedule.scenarioCode ? `برنامه ${bestSchedule.scenarioCode}` : `برنامه شماره ${bestSchedule.id}`;
  report += `🏆 امتیاز بالاتر: ${bestLabel} با امتیاز کلی ${bestSchedule.totalScore.toFixed(2)}`;
  return report;
}
