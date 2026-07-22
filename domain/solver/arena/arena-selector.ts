/**
 * Arena Selector — Select best scenarios per category
 * Pure, solver-ready
 */

import type { ScenarioDTO } from '../types';
import type { ArenaResultDTO, ArenaCategoryResultDTO } from './arena-types';
import { ARENA_CATEGORY_META } from './arena-types';
import { scoreScenario } from '../scoring/scoring-engine';
import type { PersonnelDTO, CalendarDayDTO, ShiftRequestDTO, SystemDemandDTO } from '../types';

export interface ArenaSelectorInput {
  scenarios: ScenarioDTO[];
  personnel: PersonnelDTO[];
  calendar: CalendarDayDTO[];
  requests: ShiftRequestDTO[];
  demand: SystemDemandDTO;
  dutyHours: { official: number; contract: number; conscript: number; overtime: number };
  elapsedMs: number;
}

export function selectArena(input: ArenaSelectorInput): ArenaResultDTO {
  const { scenarios, personnel, calendar, requests, demand, dutyHours, elapsedMs } = input;

  // Ensure each scenario has score
  for (const sc of scenarios) {
    if (!sc.score) {
      sc.score = scoreScenario({
        scenario: sc,
        personnel,
        calendar,
        requests,
        demand,
        dutyHours,
      });
    }
  }

  const sorted = [...scenarios].sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0));
  const best = sorted[0] ?? null;

  const categories: ArenaCategoryResultDTO[] = [];

  // Best Overall
  categories.push({
    category: 'best_overall',
    titleFa: ARENA_CATEGORY_META.best_overall.titleFa,
    titleEn: ARENA_CATEGORY_META.best_overall.titleEn,
    scenario: best,
    reasonFa: best ? `امتیاز کلی ${best.score?.total} — ${best.score?.breakdown.safety.detailsFa} | ${best.score?.breakdown.coverage.detailsFa}` : 'سناریویی یافت نشد',
    reasonEn: best ? `Total score ${best.score?.total}` : 'No scenario',
  });

  // Fairness Optimized
  const fairnessBest = [...scenarios].sort((a, b) => (b.score?.fairness ?? 0) - (a.score?.fairness ?? 0))[0] ?? null;
  categories.push({
    category: 'fairness_optimized',
    titleFa: ARENA_CATEGORY_META.fairness_optimized.titleFa,
    titleEn: ARENA_CATEGORY_META.fairness_optimized.titleEn,
    scenario: fairnessBest,
    reasonFa: fairnessBest ? `عدالت ${fairnessBest.score?.fairness}٪ — ${fairnessBest.score?.breakdown.fairness.detailsFa}` : 'یافت نشد',
    reasonEn: fairnessBest ? `Fairness ${fairnessBest.score?.fairness}` : 'Not found',
  });

  // Lowest Warnings
  const lowestWarn = [...scenarios].sort((a, b) => a.violations.length - b.violations.length)[0] ?? null;
  categories.push({
    category: 'lowest_warnings',
    titleFa: ARENA_CATEGORY_META.lowest_warnings.titleFa,
    titleEn: ARENA_CATEGORY_META.lowest_warnings.titleEn,
    scenario: lowestWarn,
    reasonFa: lowestWarn ? `${lowestWarn.violations.length} هشدار — کمترین تعداد تخلف` : 'یافت نشد',
    reasonEn: lowestWarn ? `${lowestWarn.violations.length} violations` : 'Not found',
  });

  // Highest Request Satisfaction
  const highestReq = [...scenarios].sort((a, b) => (b.score?.requestSatisfaction ?? 0) - (a.score?.requestSatisfaction ?? 0))[0] ?? null;
  categories.push({
    category: 'highest_request_satisfaction',
    titleFa: ARENA_CATEGORY_META.highest_request_satisfaction.titleFa,
    titleEn: ARENA_CATEGORY_META.highest_request_satisfaction.titleEn,
    scenario: highestReq,
    reasonFa: highestReq ? `رضایت ${highestReq.score?.requestSatisfaction}٪ — ${highestReq.score?.breakdown.requestSatisfaction.detailsFa}` : 'یافت نشد',
    reasonEn: highestReq ? `Request ${highestReq.score?.requestSatisfaction}` : 'Not found',
  });

  // Minimum Changes
  const minChanges = [...scenarios].sort((a, b) => (b.score?.stability ?? 0) - (a.score?.stability ?? 0))[0] ?? null;
  categories.push({
    category: 'minimum_changes',
    titleFa: ARENA_CATEGORY_META.minimum_changes.titleFa,
    titleEn: ARENA_CATEGORY_META.minimum_changes.titleEn,
    scenario: minChanges,
    reasonFa: minChanges ? `پایداری ${minChanges.score?.stability}٪ — ${minChanges.score?.breakdown.stability.detailsFa}` : 'یافت نشد',
    reasonEn: minChanges ? `Stability ${minChanges.score?.stability}` : 'Not found',
  });

  return {
    categories,
    allScenariosSorted: sorted,
    best,
    generatedAt: new Date().toISOString(),
    totalScenarios: scenarios.length,
    elapsedMs,
  };
}
