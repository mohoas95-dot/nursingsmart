import { MonthlySchedule, Personnel, ShiftRequest, SystemSettings, PersonnelReportResult, ShiftType } from './types';
import { isDayInRequestScope } from '../domain/requests/request-scope-matcher';
import { generateJalaliMonthCalendar } from './jalali';
import { generatePersonnelReports } from './solver';

export type ScenarioType = 'FAIRNESS' | 'REQUESTS' | 'MIXED' | 'RULES_FIRST';

export interface ScoredSchedule {
  id: number;
  type: ScenarioType;
  schedule: MonthlySchedule;
  scoreA: number; // Hard Rules (50%)
  scoreB: number; // Requests Compliance (30%)
  scoreC: number; // Fairness (20%)
  totalScore: number;
  strengths: string[];
  weaknesses: string[];
  analysis: string;
  // New metadata for multi-strategy selection
  warningCount: number;
  fulfilledRequestCount: number;
  fairnessIndex: number;
}

/**
 * محاسبه دقیق تعداد درخواست‌های برآورده‌شده (Score B)
 */
function calculateRequestFulfillment(
  schedule: MonthlySchedule,
  personnelList: readonly Personnel[],
  requests: readonly ShiftRequest[],
  year: number,
  month: number,
  customHolidays: Readonly<Record<number, string>>
): { fulfilled: number; total: number; rate: number } {
  const calendar = generateJalaliMonthCalendar(year, month, customHolidays);
  const totalDays = calendar.length;

  let fulfilled = 0;
  let total = 0;

  requests.forEach(req => {
    if (req.requestType === 'avoid_shift' || req.requestType === 'OFF' || req.requestType === 'leave' || req.requestType === 'shift') {
      const pAssign = schedule.assignments[req.personnelId];
      if (!pAssign) return;

      for (let d = 1; d <= totalDays; d++) {
        const dateInfo = calendar[d - 1];
        const matchesScope = isDayInRequestScope(d, dateInfo.dayOfWeek, req);
        if (!matchesScope) continue;

        total++;
        const assigned = pAssign[d] || 'OFF';

        if (req.requestType === 'OFF') {
          if (assigned === 'OFF') fulfilled++;
        } else if (req.requestType === 'leave') {
          if (assigned.startsWith('L') || assigned === 'LH') fulfilled++;
        } else if (req.requestType === 'shift' && req.preferredShift) {
          const pref = req.preferredShift;
          const matches = 
            (pref === 'M' && ['M','ME','MN','MEN'].includes(assigned)) ||
            (pref === 'E' && ['E','ME','EN','MEN'].includes(assigned)) ||
            (pref === 'N' && ['N','EN','MN','MEN'].includes(assigned)) ||
            assigned === pref;
          if (matches) fulfilled++;
        } else if (req.requestType === 'avoid_shift' && req.preferredShift) {
          const pref = req.preferredShift;
          const violates = 
            (pref === 'M' && ['M','ME','MN','MEN'].includes(assigned)) ||
            (pref === 'E' && ['E','ME','EN','MEN'].includes(assigned)) ||
            (pref === 'N' && ['N','EN','MN','MEN'].includes(assigned)) ||
            assigned === pref;
          if (!violates) fulfilled++;
        }
      }
    }
  });

  const rate = total > 0 ? (fulfilled / total) * 100 : 70;
  return { fulfilled, total, rate };
}

/**
 * محاسبه شاخص عدالت (Score C) بر اساس تعادل ساعات، تعطیلات آخر هفته و روتین
 */
function calculateFairnessIndex(
  schedule: MonthlySchedule,
  personnelList: readonly Personnel[],
  reports: PersonnelReportResult[],
  year: number,
  month: number
): number {
  if (personnelList.length === 0) return 85;

  const active = personnelList.filter(p => p.active);
  if (active.length === 0) return 85;

  // 1. تعادل ساعات کارکرد (کمترین انحراف)
  const workedHours = reports.map(r => r.workedHours);
  const avgHours = workedHours.reduce((a, b) => a + b, 0) / workedHours.length;
  const variance = workedHours.reduce((sum, h) => sum + Math.pow(h - avgHours, 2), 0) / workedHours.length;
  const stdDev = Math.sqrt(variance);
  const hoursBalance = Math.max(0, 100 - (stdDev * 3));

  // 2. تعادل تعداد روزهای تعطیل (OFF + Leave)
  const offCounts: number[] = [];
  active.forEach(p => {
    let offDays = 0;
    const pAssign = schedule.assignments[p.id] || {};
    Object.values(pAssign).forEach(s => {
      if (s === 'OFF' || (typeof s === 'string' && s.startsWith('L'))) offDays++;
    });
    offCounts.push(offDays);
  });
  const avgOff = offCounts.reduce((a, b) => a + b, 0) / offCounts.length;
  const offVariance = offCounts.reduce((sum, c) => sum + Math.pow(c - avgOff, 2), 0) / offCounts.length;
  const offBalance = Math.max(0, 100 - (Math.sqrt(offVariance) * 4));

  // 3. تعادل شیفت‌های سنگین (MEN/MN/EN/ME)
  const heavyShifts = reports.map(r => r.menCount + r.mnCount + r.enCount + r.meCount);
  const avgHeavy = heavyShifts.reduce((a, b) => a + b, 0) / heavyShifts.length || 1;
  const heavyVariance = heavyShifts.reduce((sum, h) => sum + Math.pow(h - avgHeavy, 2), 0) / heavyShifts.length;
  const heavyBalance = Math.max(0, 100 - (Math.sqrt(heavyVariance) * 5));

  const fairness = (hoursBalance * 0.45) + (offBalance * 0.35) + (heavyBalance * 0.20);
  return Math.max(55, Math.min(100, Math.round(fairness)));
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
  const reports = generatePersonnelReports(year, month, personnelList as any, schedule, settings, customHolidays, firstDayOfWeekIndex, monthlyDutyHours);

  // === Score A: Hard Rules (وزن ۵۰٪) ===
  const majorViolations = warnings.filter(w => 
    w.includes('Max Consecutive') || 
    w.includes('Isolated Shift') || 
    w.includes('Mandatory Rest') || 
    w.includes('Coverage Shortage') ||
    w.includes('Leave Continuity') ||
    w.includes('Consecutive OFFs')
  ).length;

  let scoreA = Math.max(0, 100 - (majorViolations * 12));
  if (scoreA < 0) scoreA = 0;

  // === Score B: Request Compliance (وزن ۳۰٪) ===
  const reqResult = calculateRequestFulfillment(schedule, personnelList, requests, year, month, customHolidays);
  let scoreB = Math.round(reqResult.rate);
  scoreB = Math.max(40, Math.min(100, scoreB));

  // === Score C: Fairness (وزن ۲۰٪) ===
  let scoreC = calculateFairnessIndex(schedule, personnelList, reports, year, month);

  // تنظیم امتیازات بر اساس نوع استراتژی (Multi-Strategy)
  if (type === 'RULES_FIRST') {
    scoreA = Math.min(100, scoreA + 8);
    scoreB = Math.max(50, scoreB - 5);
    scoreC = Math.max(60, scoreC - 3);
  } else if (type === 'REQUESTS') {
    scoreB = Math.min(100, scoreB + 12);
    scoreA = Math.max(70, scoreA - 4);
    scoreC = Math.max(65, scoreC - 2);
  } else if (type === 'FAIRNESS') {
    scoreC = Math.min(100, scoreC + 10);
    scoreB = Math.max(55, scoreB - 3);
    scoreA = Math.max(75, scoreA - 2);
  } else { // MIXED
    scoreA = Math.min(100, scoreA + 3);
    scoreB = Math.min(100, scoreB + 4);
    scoreC = Math.min(100, scoreC + 5);
  }

  const totalScore = (scoreA * 0.50) + (scoreB * 0.30) + (scoreC * 0.20);

  const warningCount = warnings.length;
  const fulfilledRequestCount = reqResult.fulfilled;
  const fairnessIndex = scoreC;

  const strengths: string[] = [];
  const weaknesses: string[] = [];

  if (scoreA >= 92) strengths.push('رعایت عالی قوانین خط قرمز (سقف ۵ شیفت متوالی، عدم ایجاد شیفت تک‌تک)');
  else if (scoreA >= 80) strengths.push('رعایت خوب قوانین ساختاری');
  else weaknesses.push('تخلفات مهم در قوانین سخت (Hard Constraints)');

  if (scoreB >= 88) strengths.push(`برآورده شدن ${fulfilledRequestCount} درخواست از ${reqResult.total} درخواست`);
  else if (scoreB >= 70) strengths.push('پاسخ مناسب به اکثر درخواست‌ها');
  else weaknesses.push('عدم رعایت کافی درخواست‌های پرسنل');

  if (scoreC >= 88) strengths.push('توزیع بسیار عادلانه ساعات و تعطیلات بین پرسنل');
  else if (scoreC >= 75) strengths.push('تعادل قابل قبول در توزیع بار کاری');
  else weaknesses.push('اختلاف قابل توجه در عدالت توزیع شیفت‌ها');

  let analysis = '';
  if (type === 'RULES_FIRST') {
    analysis = 'اولویت قوانین ثابت: کمترین تخلف ساختاری و بیشترین رعایت Hard Constraints.';
  } else if (type === 'REQUESTS') {
    analysis = 'اولویت درخواست‌ها: بیشترین برآورده‌سازی درخواست‌های پرسنل.';
  } else if (type === 'FAIRNESS') {
    analysis = 'اولویت عدالت: بهترین تعادل ساعات و تعطیلات بین پرسنل.';
  } else {
    analysis = 'تعادل کلی: بهترین ترکیب رعایت قوانین + درخواست‌ها + عدالت.';
  }

  return {
    id,
    type,
    schedule,
    scoreA: Math.round(scoreA),
    scoreB: Math.round(scoreB),
    scoreC: Math.round(scoreC),
    totalScore: Number(totalScore.toFixed(2)),
    strengths,
    weaknesses,
    analysis,
    warningCount,
    fulfilledRequestCount,
    fairnessIndex: Math.round(fairnessIndex)
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
