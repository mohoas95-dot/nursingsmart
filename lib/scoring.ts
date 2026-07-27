import { MonthlySchedule, Personnel, ShiftRequest, SystemSettings, PersonnelReportResult, ShiftType } from './types';
import { isDayInRequestScope } from '../domain/requests/request-scope-matcher';
import { generatePersonnelReports } from './solver';
import { generateJalaliMonthCalendar } from './jalali';

export type ScenarioType = 'FAIRNESS' | 'REQUESTS' | 'MIXED';

export interface ScoredSchedule {
  id: number;
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
  monthlyDutyHours?: any
): ScoredSchedule {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays, firstDayOfWeekIndex);
  const totalDays = calendar.length;

  // --- Score A (Level A): 50% Weight ---
  // Hard constraints: Coverage, max shifts, consecutive caps, single isolated shift, mandatory rest, continuous leave.
  let majorViolations = warnings.filter(w =>
    w.includes('Max Consecutive') ||
    w.includes('Isolated Shift') ||
    w.includes('Mandatory Rest') ||
    w.includes('Coverage') ||
    w.includes('Leave Continuity')
  ).length;

  let scoreA = 100 - (majorViolations * 10);
  if (scoreA < 0) scoreA = 0;

  // --- Score B (Level B): 30% Weight ---
  // How well personnel requests are fulfilled
  let fulfilledRequests = 0;
  let totalApplicableRequests = 0;

  requests.forEach(req => {
    if (req.requestType === 'shift' || req.requestType === 'OFF' || req.requestType === 'leave' || req.requestType === 'avoid_shift') {
      const pAssign = schedule.assignments[req.personnelId];
      if (!pAssign) return;

      for (let d = 1; d <= totalDays; d++) {
        const dateInfo = calendar[d - 1];
        let matchesScope = false;

        if (req.scope === 'all') {
          matchesScope = true;
        } else if (req.scope === 'even' && d % 2 === 0) {
          matchesScope = true;
        } else if (req.scope === 'odd' && d % 2 !== 0) {
          matchesScope = true;
        } else if (req.scope === 'saturdays' && dateInfo.dayOfWeek === 0) {
          matchesScope = true;
        } else if (req.scope === 'sundays' && dateInfo.dayOfWeek === 1) {
          matchesScope = true;
        } else if (req.scope === 'mondays' && dateInfo.dayOfWeek === 2) {
          matchesScope = true;
        } else if (req.scope === 'tuesdays' && dateInfo.dayOfWeek === 3) {
          matchesScope = true;
        } else if (req.scope === 'wednesdays' && dateInfo.dayOfWeek === 4) {
          matchesScope = true;
        } else if (req.scope === 'thursdays' && dateInfo.dayOfWeek === 5) {
          matchesScope = true;
        } else if (req.scope === 'fridays' && dateInfo.dayOfWeek === 6) {
          matchesScope = true;
        } else if (req.scope === 'weekly_even' && (dateInfo.dayOfWeek === 0 || dateInfo.dayOfWeek === 2 || dateInfo.dayOfWeek === 4)) {
          matchesScope = true;
        } else if (req.scope === 'weekly_odd' && (dateInfo.dayOfWeek === 1 || dateInfo.dayOfWeek === 3 || dateInfo.dayOfWeek === 5)) {
          matchesScope = true;
        } else if (req.scope === 'custom_days' && req.selectedDays && req.selectedDays.includes(d)) {
          matchesScope = true;
        } else if (req.scope === 'range' && req.startDate && req.endDate) {
          const currentStr = `${year}/${month < 10 ? '0' + month : month}/${d < 10 ? '0' + d : d}`;
          const startNormalized = req.startDate.replace(/\//g, '-');
          const endNormalized = req.endDate.replace(/\//g, '-');
          const currNormalized = currentStr.replace(/\//g, '-');
          if (currNormalized >= startNormalized && currNormalized <= endNormalized) {
            matchesScope = true;
          }
        }

        if (matchesScope) {
          totalApplicableRequests++;
          const assigned = pAssign[d] || 'OFF';

          if (req.requestType === 'shift' && req.preferredShift) {
            const pref = req.preferredShift;
            const matches = (pref === 'M' && ['M', 'ME', 'MN', 'MEN'].includes(assigned)) ||
                            (pref === 'E' && ['E', 'ME', 'EN', 'MEN'].includes(assigned)) ||
                            (pref === 'N' && ['N', 'EN', 'MN', 'MEN'].includes(assigned)) ||
                            (assigned === pref);
            if (matches) fulfilledRequests++;
          } else if (req.requestType === 'OFF') {
            if (assigned === 'OFF' || assigned.startsWith('L')) fulfilledRequests++;
          } else if (req.requestType === 'leave') {
            if (assigned.startsWith('L')) fulfilledRequests++;
          } else if (req.requestType === 'avoid_shift' && req.preferredShift) {
            const pref = req.preferredShift;
            const violates = (pref === 'M' && ['M', 'ME', 'MN', 'MEN'].includes(assigned)) ||
                            (pref === 'E' && ['E', 'ME', 'EN', 'MEN'].includes(assigned)) ||
                            (pref === 'N' && ['N', 'EN', 'MN', 'MEN'].includes(assigned)) ||
                            (assigned === pref);
            if (!violates) fulfilledRequests++;
          }
        }
      }
    }
  });

  // Calculate request fulfillment rate (0-100)
  const requestFulfillmentRate = totalApplicableRequests > 0
    ? (fulfilledRequests / totalApplicableRequests) * 100
    : 100;

  // --- Score C (Level C): 20% Weight ---
  // Fairness: Equal duty hours distribution among same employment type
  const reports = generatePersonnelReports(year, month, [...personnelList], schedule, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);

  // Calculate variance in net balance (workedHours - dutyHours) for same employment type
  const balanceByType: { [key: string]: number[] } = {};
  reports.forEach(r => {
    const p = personnelList.find(per => per.id === r.personnelId);
    if (!p) return;
    const key = `${p.jobGroup}_${p.employmentType}`;
    if (!balanceByType[key]) balanceByType[key] = [];
    balanceByType[key].push(r.workedHours - r.dutyHours);
  });

  // Calculate average variance across all groups (lower is fairer)
  let totalVariance = 0;
  let groupCount = 0;
  Object.values(balanceByType).forEach(balances => {
    if (balances.length < 2) return;
    const mean = balances.reduce((a, b) => a + b, 0) / balances.length;
    const variance = balances.reduce((sum, b) => sum + Math.pow(b - mean, 2), 0) / balances.length;
    totalVariance += variance;
    groupCount++;
  });

  const avgVariance = groupCount > 0 ? totalVariance / groupCount : 0;
  // Convert variance to a 0-100 score (lower variance = higher score)
  // Typical variance ranges from 0 to ~500, so we use a logarithmic scale
  const fairnessScore = Math.max(0, 100 - (Math.sqrt(avgVariance) * 5));

  // --- Combine scores based on scenario type ---
  // For FAIRNESS scenarios: weight fairness higher
  // For REQUESTS scenarios: weight requests higher
  // For MIXED: balance both
  let scoreB: number;
  let scoreC: number;

  if (type === 'FAIRNESS') {
    scoreB = requestFulfillmentRate * 0.85 + 15; // Slightly reduced weight for requests
    scoreC = fairnessScore * 1.1; // Boost fairness score
    if (scoreC > 100) scoreC = 100;
  } else if (type === 'REQUESTS') {
    scoreB = requestFulfillmentRate * 1.1; // Boost request score
    if (scoreB > 100) scoreB = 100;
    scoreC = fairnessScore * 0.85 + 15; // Slightly reduced weight for fairness
  } else {
    // MIXED
    scoreB = requestFulfillmentRate;
    scoreC = fairnessScore;
  }

  const totalScore = (scoreA * 0.5) + (scoreB * 0.3) + (scoreC * 0.2);

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (scoreA >= 95) strengths.push('رعایت کامل قوانین خط قرمز و ساختاری شیفت‌بندی (رعایت قوانین کلی)');
  else if (scoreA >= 80) strengths.push('رعایت قابل قبول قوانین پایه‌ای (رعایت قوانین کلی)');
  else weaknesses.push('وجود خطاهای مهم در ساختار الزامی شیفت‌ها');

  if (scoreB >= 85) strengths.push('تخصیص موفقیت‌آمیز بخش عمده‌ای از درخواست‌های پرسنل');
  else if (scoreB >= 70) strengths.push('بخش قابل قبولی از درخواست‌های پرسنل برآورده شده');
  else weaknesses.push('عدم موفقیت در برآورده کردن کامل درخواست‌های ثبت شده');

  if (scoreC >= 85) strengths.push('توزیع عادلانه و متوازن شیفت‌ها بین نفرات با روتین مشابه');
  else if (scoreC >= 70) strengths.push('توزیع نسبتاً متوازن ساعات کاری بین پرسنل');
  else weaknesses.push('وجود اختلاف در توزیع عادلانه ساعات و شیفت‌ها');

  let analysis = '';
  if (type === 'FAIRNESS') {
    analysis = 'این برنامه تمرکز بالایی بر مساوات بین پرسنل دارد. برای ماه‌هایی با درخواست‌های کمتر مناسب است.';
  } else if (type === 'REQUESTS') {
    analysis = 'این برنامه بیشترین رضایت پرسنل را در پاسخ به درخواست‌ها جلب می‌کند اما ممکن است کمی توازن ساعات به هم بخورد.';
  } else {
    analysis = 'این برنامه تعادل بسیار خوبی بین رعایت عدالت و پذیرش درخواست‌ها برقرار کرده است و گزینه‌ای ایده‌آل است.';
  }

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
    analysis
  };
}

export function generateScoringReportText(scoredSchedules: ScoredSchedule[]): string {
  let report = '';
  let bestSchedule = scoredSchedules[0];

  scoredSchedules.forEach(s => {
    if (s.totalScore > bestSchedule.totalScore) {
      bestSchedule = s;
    }
    const typeFa = s.type === 'FAIRNESS' ? 'عدالت‌محور' : (s.type === 'REQUESTS' ? 'درخواست‌محور' : 'تلفیقی');

    report += `📋 برنامه شماره ${s.id} - نوع: ${typeFa}\n\n`;
    report += `📊 تفکیک امتیازات:\n`;
    report += `- رعایت قوانین کلی  [${s.scoreA.toFixed(0)} از ۱۰۰]\n`;
    report += `- رعایت درخواست های پرسنل  [${s.scoreB.toFixed(0)} از ۱۰۰]\n`;
    report += `- رعایت عدالت در چینش  [${s.scoreC.toFixed(0)} از ۱۰۰]\n\n`;

    report += `💡 نقاط قوت:\n`;
    s.strengths.forEach(st => report += `- ${st}\n`);
    report += `\n`;

    if (s.weaknesses.length > 0) {
      report += `⚠️ نقاط ضعف یا خطاهای احتمالی:\n`;
      s.weaknesses.forEach(w => report += `- ${w}\n`);
      report += `\n`;
    }

    report += `🧐 تحلیل نهایی: ${s.analysis}\n`;
    report += `---\n\n`;
  });

  report += `🏆 پیشنهاد نهایی سیستم: برنامه شماره ${bestSchedule.id} (${bestSchedule.type === 'MIXED' ? 'تلفیقی' : bestSchedule.type === 'FAIRNESS' ? 'عدالت‌محور' : 'درخواست‌محور'}) با امتیاز کلی ${bestSchedule.totalScore.toFixed(2)}`;

  return report;
}
