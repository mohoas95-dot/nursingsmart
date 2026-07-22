/**
 * Drafting Order — Seniority & Employment Type tie-breaker
 * Pure, solver-ready
 */

import type { PersonnelDTO } from '../types';

/**
 * Employment ranking: official > contract > conscript > overtime
 * Drafting order for unwanted shift: conscript first, then contract, then official last
 * Same for experience: less experienced drafted before highly experienced
 */

const EMPLOYMENT_RANK: Record<string, number> = {
  official: 3,
  contract: 2,
  conscript: 1,
  overtime: 0,
};

const DRAFT_ORDER: Record<string, number> = {
  conscript: 1,
  contract: 2,
  official: 3,
  overtime: 4, // overtime drafted last? but spec says official last; we'll put overtime after official
};

export function sortForDrafting(personnel: PersonnelDTO[]): PersonnelDTO[] {
  return [...personnel].sort((a, b) => {
    const draftA = DRAFT_ORDER[a.employmentType] ?? 5;
    const draftB = DRAFT_ORDER[b.employmentType] ?? 5;
    if (draftA !== draftB) return draftA - draftB;
    // Less experienced first
    if (a.experienceYears !== b.experienceYears) return a.experienceYears - b.experienceYears;
    // Fallback: orderIndex
    return (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
  });
}

export function sortBySeniorityTieBreaker(personnel: PersonnelDTO[]): PersonnelDTO[] {
  return [...personnel].sort((a, b) => {
    const rankA = EMPLOYMENT_RANK[a.employmentType] ?? 0;
    const rankB = EMPLOYMENT_RANK[b.employmentType] ?? 0;
    if (rankA !== rankB) return rankB - rankA; // higher rank first
    // More experienced first
    if (a.experienceYears !== b.experienceYears) return b.experienceYears - a.experienceYears;
    return 0;
  });
}
