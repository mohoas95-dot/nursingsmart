/**
 * Arena Types — Categories for best alternative scenarios
 */

import type { ScenarioDTO } from '../types';

export type ArenaCategory =
  | 'best_overall'
  | 'fairness_optimized'
  | 'lowest_warnings'
  | 'highest_request_satisfaction'
  | 'minimum_changes';

export interface ArenaCategoryResultDTO {
  category: ArenaCategory;
  titleFa: string;
  titleEn: string;
  scenario: ScenarioDTO | null;
  reasonFa: string;
  reasonEn: string;
}

export interface ArenaResultDTO {
  categories: ArenaCategoryResultDTO[];
  allScenariosSorted: ScenarioDTO[]; // sorted by total score desc
  best: ScenarioDTO | null;
  generatedAt: string;
  totalScenarios: number;
  elapsedMs: number;
}

export const ARENA_CATEGORY_META: Record<ArenaCategory, { titleFa: string; titleEn: string; descriptionFa: string }> = {
  best_overall: {
    titleFa: 'بهترین کلی',
    titleEn: 'Best Overall',
    descriptionFa: 'بالاترین امتیاز ترکیبی با وزن‌دهی ۴۰/۲۵/۱۵/۱۰/۱۰',
  },
  fairness_optimized: {
    titleFa: 'عدالت‌محور',
    titleEn: 'Fairness Optimized',
    descriptionFa: 'بالاترین امتیاز عدالت و توزیع ۷ روزه متعادل',
  },
  lowest_warnings: {
    titleFa: 'کمترین هشدار',
    titleEn: 'Lowest Warning Count',
    descriptionFa: 'کمترین تعداد تخلف و هشدار حتی اگر کمی عدالت کمتر باشد',
  },
  highest_request_satisfaction: {
    titleFa: 'بیشترین رضایت درخواست',
    titleEn: 'Highest Request Satisfaction',
    descriptionFa: 'بیشترین برآورده‌سازی مرخصی و OFF و شیفت‌های درخواستی (Leave > OFF > Shift)',
  },
  minimum_changes: {
    titleFa: 'کمترین تغییرات',
    titleEn: 'Minimum Changes',
    descriptionFa: 'نزدیک‌ترین به برنامه منتشرشده قبلی — اصل حداقل تغییر',
  },
};
