/**
 * Diversity Strategies for Multi-Scenario Generation
 * Each strategy intentionally explores different decision paths
 */

export type DiversityStrategy =
  | 'shuffle_draft'
  | 'request_priority_jitter'
  | 'staffing_greedy_tilt_morning_first'
  | 'staffing_greedy_tilt_night_first'
  | 'fairness_tilt'
  | 'routine_preservation'
  | 'lookahead_sacrifice'
  | 'random_disturbance'
  | 'seniority_reverse'
  | 'request_satisfaction_first';

export interface StrategyConfig {
  name: DiversityStrategy;
  weight: number; // used to distribute scenario counts
  descriptionFa: string;
  descriptionEn: string;
}

export const DIVERSITY_STRATEGIES: StrategyConfig[] = [
  {
    name: 'shuffle_draft',
    weight: 0.20,
    descriptionFa: 'ترتیب Draft پرسنل (وظیفه اول) با Seed تصادفی بهم ریخته — تنوع در تخصیص شیفت ناخواسته',
    descriptionEn: 'Shuffle drafting order',
  },
  {
    name: 'request_priority_jitter',
    weight: 0.15,
    descriptionFa: 'جابجایی جزئی اولویت درخواست‌های هم‌سطح — یک درخواست Soft OFF نزدیک به Hard',
    descriptionEn: 'Jitter request priorities',
  },
  {
    name: 'staffing_greedy_tilt_morning_first',
    weight: 0.10,
    descriptionFa: 'حریصانه صبح‌محور: ابتدا شیفت صبح پر شود، سپس عصر و شب',
    descriptionEn: 'Greedy morning-first',
  },
  {
    name: 'staffing_greedy_tilt_night_first',
    weight: 0.10,
    descriptionFa: 'حریصانه شب‌محور: ابتدا شب پر شود برای پیشگیری از کمبود شب‌ها',
    descriptionEn: 'Greedy night-first',
  },
  {
    name: 'fairness_tilt',
    weight: 0.10,
    descriptionFa: 'سختگیری عدالت: وزن Fairness موقتاً افزایش یابد — توزیع ۷ روزه متعادل‌تر',
    descriptionEn: 'Fairness tilt',
  },
  {
    name: 'routine_preservation',
    weight: 0.10,
    descriptionFa: 'حفظ کامل روتین استنتاج‌شده — ضد تکه‌تکه شدن',
    descriptionEn: 'Routine preservation',
  },
  {
    name: 'lookahead_sacrifice',
    weight: 0.10,
    descriptionFa: 'قربانی پیشگیرانه: عمداً یک OFF نرم اوایل ماه فدا شود تا بن‌بست سطح A انتهای ماه رخ ندهد',
    descriptionEn: 'Lookahead sacrifice',
  },
  {
    name: 'random_disturbance',
    weight: 0.10,
    descriptionFa: 'اختلال تصادفی کنترل‌شده: ۵٪ سلول‌ها جابجا شوند برای کشف بهینه محلی جدید',
    descriptionEn: 'Random disturbance',
  },
  {
    name: 'request_satisfaction_first',
    weight: 0.05,
    descriptionFa: 'رضایت درخواست اول: ابتدا تمام Leave/OFF/SHIFT برآورده شود، سپس پوشش پر شود',
    descriptionEn: 'Request satisfaction first',
  },
];

/**
 * Select strategy distribution for N scenarios
 * Ensures meaningful diversity, not just random
 */
export function distributeStrategies(totalScenarios: number): DiversityStrategy[] {
  const result: DiversityStrategy[] = [];
  let allocated = 0;

  for (const strat of DIVERSITY_STRATEGIES) {
    const count = Math.round(totalScenarios * strat.weight);
    for (let i = 0; i < count && allocated < totalScenarios; i++) {
      result.push(strat.name);
      allocated++;
    }
  }

  // Fill remainder with shuffle_draft if due to rounding
  while (allocated < totalScenarios) {
    result.push('shuffle_draft');
    allocated++;
  }

  // Shuffle final list with seeded random for reproducibility (simple shuffle)
  // Caller should shuffle with seed if needed
  return result;
}

/**
 * Seeded random (mulberry32) for reproducibility
 */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
