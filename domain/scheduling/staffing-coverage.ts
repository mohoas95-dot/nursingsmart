import type { JobGroup, Personnel, ShiftType, SystemSettings } from '../../lib/types';
import {
  shiftMatchesRoutine,
  wouldBreachConsecutiveCap,
  wouldCreateIsolatedShift,
} from './smart-rules';

export type CoverageShift = 'M' | 'E' | 'N';

export interface StaffingCalendarDay {
  day: number;
  isHoliday: boolean;
}

export interface StaffingCoverageGap {
  day: number;
  jobGroup: JobGroup;
  shift: CoverageShift;
  required: number;
  assigned: number;
}

export interface StaffingCoverageResult {
  assignments: Record<string, Record<number, ShiftType>>;
  unresolvedGaps: StaffingCoverageGap[];
}

const COVERAGE_SHIFTS: readonly CoverageShift[] = ['M', 'E', 'N'];

const SHIFT_COMPONENTS: Readonly<Record<string, readonly CoverageShift[]>> = {
  M: ['M'],
  E: ['E'],
  N: ['N'],
  ME: ['M', 'E'],
  EN: ['E', 'N'],
  MN: ['M', 'N'],
  MEN: ['M', 'E', 'N'],
  OFF: [],
};

const COMPONENTS_TO_SHIFT: Readonly<Record<string, ShiftType>> = {
  '': 'OFF',
  M: 'M',
  E: 'E',
  N: 'N',
  ME: 'ME',
  EN: 'EN',
  MN: 'MN',
  MEN: 'MEN',
};

/** Return whether a (possibly combined) shift covers one staffing period. */
export function shiftCoversPeriod(shift: ShiftType | undefined, period: CoverageShift): boolean {
  if (!shift) return false;
  return SHIFT_COMPONENTS[shift]?.includes(period) ?? false;
}

function componentCount(shift: ShiftType | undefined): number {
  if (!shift) return 0;
  return SHIFT_COMPONENTS[shift]?.length ?? 0;
}

function setShiftPeriod(
  shift: ShiftType | undefined,
  period: CoverageShift,
  enabled: boolean
): ShiftType {
  const components = new Set<CoverageShift>(SHIFT_COMPONENTS[shift || 'OFF'] || []);
  if (enabled) components.add(period);
  else components.delete(period);

  // Canonical component order is important for the combined-shift keys.
  const key = COVERAGE_SHIFTS.filter(component => components.has(component)).join('');
  return COMPONENTS_TO_SHIFT[key] || 'OFF';
}

function requiredCoverage(
  settings: SystemSettings,
  isHoliday: boolean,
  jobGroup: JobGroup,
  shift: CoverageShift
): number {
  const demand = isHoliday ? settings.demand.holiday : settings.demand.weekday;
  const rawValue = jobGroup === 'nurse'
    ? shift === 'M'
      ? demand.morningNurse
      : shift === 'E'
        ? demand.afternoonNurse
        : demand.nightNurse
    : shift === 'M'
      ? demand.morningAssistant
      : shift === 'E'
        ? demand.afternoonAssistant
        : demand.nightAssistant;

  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : 0;
}

/**
 * Reconcile a schedule with the configured headcount for every day and shift.
 *
 * Staffing counts are treated as a hard scheduling constraint. Reconciliation is
 * component based, so removing M from ME yields E and adding N to E yields EN;
 * changing one period therefore cannot accidentally alter another period's count.
 * Locked rows and approved leave entries are never modified. If those protections
 * make the configured count impossible, the mismatch is returned in unresolvedGaps
 * and will also be reported by the normal schedule verifier.
 */
export function reconcileStaffingCoverage(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  personnelList: readonly Personnel[],
  settings: SystemSettings,
  calendarDays: readonly StaffingCalendarDay[],
  targetJobGroups: readonly JobGroup[] = ['nurse', 'assistant'],
  lockedRows: readonly string[] = []
): StaffingCoverageResult {
  const reconciled: Record<string, Record<number, ShiftType>> = {};
  for (const [personnelId, dayAssignments] of Object.entries(assignments)) {
    reconciled[personnelId] = { ...dayAssignments };
  }

  const lockedIds = new Set(lockedRows);
  const unresolvedGaps: StaffingCoverageGap[] = [];
  const totalDays = calendarDays.reduce((max, calendarDay) => Math.max(max, calendarDay.day), 0);

  for (const jobGroup of targetJobGroups) {
    const group = personnelList.filter(person => person.active && person.jobGroup === jobGroup);
    for (const person of group) {
      if (!reconciled[person.id]) reconciled[person.id] = {};
    }

    for (const calendarDay of calendarDays) {
      const day = calendarDay.day;

      for (const shift of COVERAGE_SHIFTS) {
        const required = requiredCoverage(settings, calendarDay.isHoliday, jobGroup, shift);
        const assignedPersonnel = () => group.filter(person =>
          shiftCoversPeriod(reconciled[person.id]?.[day], shift)
        );

        let assigned = assignedPersonnel().length;

        if (assigned > required) {
          const removable = assignedPersonnel()
            .filter(person => !lockedIds.has(person.id) && !person.locked)
            // Prefer removing a standalone period before breaking a combined shift.
            .sort((left, right) =>
              componentCount(reconciled[left.id]?.[day]) - componentCount(reconciled[right.id]?.[day])
            );

          for (const person of removable) {
            if (assigned <= required) break;
            reconciled[person.id][day] = setShiftPeriod(reconciled[person.id][day], shift, false);
            assigned -= 1;
          }
        } else if (assigned < required) {
          // Staffing stays a hard constraint, but candidate ordering respects the
          // smart regeneration rules first: breaching the 5-consecutive-shift cap
          // or creating an isolated single shift pushes a candidate to the back of
          // the queue; candidates whose work-routine tag matches the shift come first.
          const candidatePriority = (person: Personnel): number => {
            const nextShift = setShiftPeriod(reconciled[person.id]?.[day], shift, true);
            let priority = componentCount(reconciled[person.id]?.[day]);
            if (wouldBreachConsecutiveCap(reconciled, person.id, day, nextShift, totalDays)) {
              priority += 100;
            }
            if (wouldCreateIsolatedShift(reconciled, person.id, day, totalDays, nextShift)) {
              priority += 40;
            }
            if (person.workRoutine) {
              priority += shiftMatchesRoutine(nextShift, person.workRoutine) ? -10 : 10;
            }
            return priority;
          };

          const available = group
            .filter(person => {
              if (lockedIds.has(person.id) || person.locked) return false;
              const currentShift = reconciled[person.id]?.[day] || 'OFF';
              if (currentShift.startsWith('L')) return false;
              return !shiftCoversPeriod(currentShift, shift);
            })
            // Prefer a normal single shift over creating an avoidable double/triple shift.
            .sort((left, right) => candidatePriority(left) - candidatePriority(right));

          for (const person of available) {
            if (assigned >= required) break;
            reconciled[person.id][day] = setShiftPeriod(reconciled[person.id][day], shift, true);
            assigned += 1;
          }
        }

        const finalAssigned = assignedPersonnel().length;
        if (finalAssigned !== required) {
          unresolvedGaps.push({
            day,
            jobGroup,
            shift,
            required,
            assigned: finalAssigned,
          });
        }
      }
    }
  }

  return { assignments: reconciled, unresolvedGaps };
}
