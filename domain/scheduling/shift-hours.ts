/**
 * Shift hours — the single source of truth for per-shift worked hours.
 *
 * This module was extracted from `lib/solver.ts` so that domain-layer writers
 * (reconciliation, repair, overtime cap) can compute worked hours without
 * importing the solver and creating a dependency cycle. The hour arithmetic is
 * unchanged; `lib/solver.ts` re-exports these symbols for compatibility.
 */

import type { ShiftType } from '../../lib/types';
import { HOLIDAY_LEAVE_HOURS, HOLIDAY_LEAVE_SHIFT } from './smart-rules';

// Shift durations in hours
export const SHIFT_HOURS: { [key in ShiftType]: number } = {
  M: 6.5,
  E: 6.5,
  N: 12.5,
  ME: 13.0,
  EN: 19.0,
  MN: 19.0,
  MEN: 25.5,
  OFF: 0.0,
  L1: 7.0,
  L2: 7.0,
  L3: 7.0,
  L4: 7.0,
  L5: 7.0,
};

// Leave hours by employment type
export function getLeaveHours(employmentType: string): number {
  switch (employmentType) {
    case 'official': return 7.0;
    case 'contract': return 7.5;
    case 'conscript': return 7.666;
    default: return 0;
  }
}

// Get dynamic shift hours considering personnel's employment type for leaves
export function getShiftHours(shift: string, employmentType: string): number {
  // قانون مرخصی روز تعطیل: دقیقاً ۷ ساعت اعتبار برای تمام انواع استخدام
  if (shift === HOLIDAY_LEAVE_SHIFT) {
    return HOLIDAY_LEAVE_HOURS;
  }
  if (shift.startsWith('L')) {
    return getLeaveHours(employmentType);
  }
  return SHIFT_HOURS[shift] || 0.0;
}
