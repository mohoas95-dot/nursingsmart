/**
 * Fairness Calculator — Rolling Window + Monthly Balance
 * Pure, solver-ready
 */

import type { PersonnelDTO, ScenarioAssignmentsDTO, CalendarDayDTO } from '../types';

const SHIFT_HOURS: Record<string, number> = {
  M: 6.5,
  E: 6.5,
  N: 12.5,
  ME: 13.0,
  EN: 19.0,
  MN: 19.0,
  MEN: 25.5,
  OFF: 0,
};

function hours(shift: string): number {
  if (!shift || shift === 'OFF' || shift.startsWith('L')) return 0;
  return SHIFT_HOURS[shift] ?? 0;
}

export interface FairnessMetrics {
  monthlyAvgHours: number;
  monthlyStdDev: number;
  rollingStdDevAvg: number; // average std dev across 7-day windows
  maxConsecutiveWorkDays: number;
  nightShiftDistributionStdDev: number;
  holidayShiftDistributionStdDev: number;
  fairnessScore: number; // 0-100
  detailsFa: string;
}

/**
 * Calculate fairness metrics for a scenario
 */
export function calculateFairness(
  personnel: PersonnelDTO[],
  assignments: ScenarioAssignmentsDTO,
  calendar: CalendarDayDTO[]
): FairnessMetrics {
  const totalDays = calendar.length;
  const active = personnel.filter(p => p.active);

  // Monthly hours per person
  const monthlyHours: number[] = [];
  const nightCounts: number[] = [];
  const holidayCounts: number[] = [];

  // Track max consecutive
  let maxConsecutiveOverall = 0;

  for (const p of active) {
    let mh = 0;
    let nc = 0;
    let hc = 0;
    let consecutive = 0;
    let maxConsec = 0;
    for (let d = 1; d <= totalDays; d++) {
      const s = assignments[p.id]?.[d] ?? 'OFF';
      mh += hours(s);
      if (s.includes('N')) nc++;
      const cal = calendar[d - 1];
      if (cal && cal.isHoliday && s !== 'OFF' && !s.startsWith('L')) hc++;

      if (s === 'OFF' || s.startsWith('L')) {
        consecutive = 0;
      } else {
        consecutive++;
        maxConsec = Math.max(maxConsec, consecutive);
      }
    }
    monthlyHours.push(mh);
    nightCounts.push(nc);
    holidayCounts.push(hc);
    maxConsecutiveOverall = Math.max(maxConsecutiveOverall, maxConsec);
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const stdDev = (arr: number[]) => {
    if (!arr.length) return 0;
    const m = avg(arr);
    const variance = arr.reduce((sum, x) => sum + Math.pow(x - m, 2), 0) / arr.length;
    return Math.sqrt(variance);
  };

  const monthlyAvg = avg(monthlyHours);
  const monthlyStd = stdDev(monthlyHours);
  const nightStd = stdDev(nightCounts);
  const holidayStd = stdDev(holidayCounts);

  // Rolling 7-day std dev average
  let rollingStdSum = 0;
  let rollingWindows = 0;
  for (let start = 1; start <= totalDays - 6; start++) {
    const windowHours: number[] = [];
    for (const p of active) {
      let h = 0;
      for (let d = start; d < start + 7; d++) {
        const s = assignments[p.id]?.[d] ?? 'OFF';
        h += hours(s);
      }
      windowHours.push(h);
    }
    rollingStdSum += stdDev(windowHours);
    rollingWindows++;
  }
  const rollingAvg = rollingWindows ? rollingStdSum / rollingWindows : 0;

  // Score: lower std dev => higher fairness
  // Normalize: assume reasonable ranges
  // monthlyStd: 0-20h -> 100 to 0
  // rollingAvg: 0-15h -> 100 to 0
  // nightStd: 0-5 -> 100 to 0
  const scoreMonthly = Math.max(0, 100 - (monthlyStd / 20) * 100);
  const scoreRolling = Math.max(0, 100 - (rollingAvg / 15) * 100);
  const scoreNight = Math.max(0, 100 - (nightStd / 5) * 100);
  const scoreHoliday = Math.max(0, 100 - (holidayStd / 4) * 100);

  const fairnessScore = Math.round((scoreMonthly * 0.4 + scoreRolling * 0.3 + scoreNight * 0.15 + scoreHoliday * 0.15));

  const detailsFa = `میانگین ماهانه ${monthlyAvg.toFixed(1)} ساعت، انحراف معیار ماهانه ${monthlyStd.toFixed(1)}، میانگین انحراف ۷ روزه ${rollingAvg.toFixed(1)}، انحراف شب‌ها ${nightStd.toFixed(1)}، تعطیلات ${holidayStd.toFixed(1)}، بیشترین کار متوالی ${maxConsecutiveOverall} روز`;

  return {
    monthlyAvgHours: monthlyAvg,
    monthlyStdDev: monthlyStd,
    rollingStdDevAvg: rollingAvg,
    maxConsecutiveWorkDays: maxConsecutiveOverall,
    nightShiftDistributionStdDev: nightStd,
    holidayShiftDistributionStdDev: holidayStd,
    fairnessScore,
    detailsFa,
  };
}
