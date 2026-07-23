/**
 * RoutineStrategy — Routine-Tag Assignment Guidance (Pure Domain Module)
 *
 * RESPONSIBILITY:
 *   تبدیل برچسب روتین کاری پرسنل (routineTag) به یک نقشهٔ اولویت‌بندی برای
 *   موتور تخصیص شیفت، به‌گونه‌ای که پیش از پناه بردن به شیفت‌های سنگین،
 *   نوبت‌های هم‌خوان با روتین فرد ترجیح داده شوند.
 *
 *   - Task 1 (Routine Tag Guidance): routineTag به‌عنوان نقشهٔ تخصیص اولویت‌دار.
 *   - Task 2 (No-Request Staff Handling): پرسنل بدون هیچ درخواستی به‌عنوان
 *     ROTATING_GENERAL رفتار شده و برنامهٔ چرخشی متعادل می‌گیرند.
 *
 * DESIGN:
 *   - کاملاً خالص (Pure) و قطعی (Deterministic).
 *   - بدون وابستگی به React/Next/Browser یا خودِ solver.
 *
 * @module lib/routineStrategy
 */

import type { Personnel, ShiftRequest, RoutineTag } from './types';

/** نوبت‌های پایهٔ قابل تخصیص. */
export type ShiftSlot = 'M' | 'E' | 'N';

/**
 * نقشهٔ راهنمای روتین: هر برچسب ← نوبت‌های ترجیحی پایه.
 *   - MORNING_ONLY      → M
 *   - LONG_SHIFT (ME)   → M, E
 *   - EVENING_NIGHT (EN)→ E, N
 *   - FULL_ROTATION_MEN → M, E, N
 *   - ROTATING_GENERAL  → []  (چرخشی متعادل، بدون ترجیح صریح)
 */
export const ROUTINE_TAG_PREFERRED_SLOTS: Readonly<
  Record<RoutineTag, ReadonlyArray<ShiftSlot>>
> = {
  MORNING_ONLY: ['M'],
  LONG_SHIFT: ['M', 'E'],
  EVENING_NIGHT: ['E', 'N'],
  FULL_ROTATION_MEN: ['M', 'E', 'N'],
  ROTATING_GENERAL: [],
};

/** شیفت نمایندهٔ هر برچسب روتین (برای نمایش/مقداردهی اولیه). */
export function routineRepresentativeShift(tag: RoutineTag): 'M' | 'ME' | 'EN' | 'MEN' {
  switch (tag) {
    case 'MORNING_ONLY':
      return 'M';
    case 'LONG_SHIFT':
      return 'ME';
    case 'EVENING_NIGHT':
      return 'EN';
    case 'FULL_ROTATION_MEN':
      return 'MEN';
    case 'ROTATING_GENERAL':
      return 'M';
  }
}

/** آیا پرسنل هیچ درخواستی ثبت نکرده است؟ @pure */
export function hasNoRequests(
  personnelId: string,
  requests: ReadonlyArray<ShiftRequest>
): boolean {
  return !requests.some((r) => r.personnelId === personnelId);
}

/**
 * برچسب روتین «مؤثر» پرسنل.
 *
 *   - پرسنل بدون هیچ درخواستی → ROTATING_GENERAL (Task 2: برنامهٔ چرخشی متعادل).
 *   - در غیر این صورت → routineTag خود شخص، با پیش‌فرض ROTATING_GENERAL.
 *
 * @pure
 */
export function getEffectiveRoutineTag(
  personnel: Pick<Personnel, 'id' | 'routineTag'>,
  requests: ReadonlyArray<ShiftRequest>
): RoutineTag {
  if (hasNoRequests(personnel.id, requests)) return 'ROTATING_GENERAL';
  return personnel.routineTag ?? 'ROTATING_GENERAL';
}

/**
 * امتیاز تطابق یک نوبت (M/E/N) با برچسب روتین.
 *   بالاتر = تطابق بهتر؛ 0 یعنی بدون ترجیح (ROTATING_GENERAL یا نوبت خارج از روتین).
 *
 * @pure
 */
export function routineShiftScore(tag: RoutineTag, shiftChar: ShiftSlot): number {
  return ROUTINE_TAG_PREFERRED_SLOTS[tag].includes(shiftChar) ? 1 : 0;
}

/**
 * ساخت نگاشت personnelId → برچسب روتین مؤثر، برای مصرف یک‌باره در solver.
 * @pure
 */
export function buildEffectiveRoutineTags(
  personnel: ReadonlyArray<Personnel>,
  requests: ReadonlyArray<ShiftRequest>
): Record<string, RoutineTag> {
  const map: Record<string, RoutineTag> = {};
  for (const p of personnel) {
    map[p.id] = getEffectiveRoutineTag(p, requests);
  }
  return map;
}
