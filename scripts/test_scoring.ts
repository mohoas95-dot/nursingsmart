import { evaluateSchedule, generateScoringReportText, ScoredSchedule } from '../lib/scoring';
import { MonthlySchedule } from '../lib/types';

const mockSchedule: MonthlySchedule = { year: 1403, month: 5, assignments: {}, shiftLeaders: {}, warnings: [] };

const schedules: ScoredSchedule[] = [];

// 3 Fairness
for (let i = 1; i <= 3; i++) {
  schedules.push(evaluateSchedule(i, 'FAIRNESS', mockSchedule, [], [], {} as any, [], 1403, 5, {}, undefined, null));
}

// 3 Requests
for (let i = 4; i <= 6; i++) {
  schedules.push(evaluateSchedule(i, 'REQUESTS', mockSchedule, [], [], {} as any, [], 1403, 5, {}, undefined, null));
}

// 4 Mixed
for (let i = 7; i <= 10; i++) {
  schedules.push(evaluateSchedule(i, 'MIXED', mockSchedule, [], [], {} as any, [], 1403, 5, {}, undefined, null));
}

console.log(generateScoringReportText(schedules));
