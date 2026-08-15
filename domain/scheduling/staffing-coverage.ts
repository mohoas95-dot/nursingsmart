import type { JobGroup, Personnel, ShiftRequest, ShiftType, SystemSettings } from '../../lib/types';
import { isDayInRequestScope, patternStepForDay } from '../requests/request-scope-matcher';
import {
  routineAllowsPeriodAdd,
  shiftMatchesRoutine,
  wouldCreateIsolatedShift,
} from './smart-rules';
import {
  evaluatePostHeavyOffPreference,
  isUnknownShift,
  POST_HEAVY_OFF_PREFERENCE_PENALTY,
  shiftComponents,
  shiftContainsComponent,
  shiftFromComponents,
  shiftSatisfiesRequestedShift,
} from './workload';
import {
  COVERAGE_FILL_HARD_RULES,
  canAssignShift,
} from './hard-constraints';
import {
  effectiveOvertimeCap,
  wouldExceedOvertimeCap,
} from './overtime-cap';

/**
 * Simplified scope matcher for reconcile context where dayOfWeek is not available.
 * Only checks scopes that can be determined from day number alone:
 *   all, even, odd, custom_days, range.
 * Weekday-specific scopes (saturdays–fridays, weekly_even, weekly_odd) always match
 * here to avoid accidentally respecting Soft OFF on those days without full calendar info.
 */
function matchRequestScopeSimple(day: number, request: ShiftRequest): boolean {
  switch (request.scope) {
    case 'all': return true;
    case 'even': return day % 2 === 0;
    case 'odd': return day % 2 === 1;
    case 'custom_days': return !!request.selectedDays && request.selectedDays.includes(day);
    case 'range':
      if (!request.startDate || !request.endDate) return false;
      // Simple day-of-month range matching
      const startDay = parseInt(request.startDate.split('/').pop() || '0', 10);
      const endDay = parseInt(request.endDate.split('/').pop() || '0', 10);
      return day >= startDay && day <= endDay;
    // Weekday-specific scopes: we can't determine dayOfWeek here, so conservatively
    // return true (Soft OFF on these scopes won't get the penalty boost)
    default: return false;
  }
}

export type CoverageShift = 'M' | 'E' | 'N';

export interface StaffingCalendarDay {
  day: number;
  isHoliday: boolean;
  /**
   * روزِ هفته (۰=شنبه … ۶=جمعه) — اختیاری.
   *
   * وقتی داده شود، محدودیت‌های سختِ وابسته به دامنهٔ درخواست (مثل «آف قطعیِ
   * پنجشنبه‌ها») دقیقاً ارزیابی می‌شوند. اگر داده نشود، ارزیابیِ محدودیت سخت
   * محافظه‌کارانه عمل می‌کند و آن دامنه‌ها را «مطابق» می‌گیرد؛ یعنی به‌جای نقض
   * احتمالیِ یک محدودیت سخت، کمبود پوشش گزارش می‌شود.
   */
  dayOfWeek?: number;
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

/** Return whether a (possibly combined) shift covers one staffing period. */
export function shiftCoversPeriod(shift: ShiftType | undefined, period: CoverageShift): boolean {
  return shiftContainsComponent(shift, period);
}

function componentCount(shift: ShiftType | undefined): number {
  return shiftComponents(shift).length;
}

function setShiftPeriod(
  shift: ShiftType | undefined,
  period: CoverageShift,
  enabled: boolean
): ShiftType {
  const components = new Set<CoverageShift>(shiftComponents(shift) as readonly CoverageShift[]);
  if (enabled) components.add(period);
  else components.delete(period);
  return shiftFromComponents(components) || 'OFF';
}

const WEEKDAY_DEPENDENT_SCOPES = new Set([
  'saturdays', 'sundays', 'mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays',
  'weekly_even', 'weekly_odd',
]);

function isExplicitShiftRequestInScope(
  request: ShiftRequest,
  day: number,
  dayOfWeek: number | undefined
): boolean {
  // Without calendar weekday data, preserve an explicit weekday plan rather than
  // guessing that the cell is safe to rewrite.
  if (dayOfWeek === undefined && WEEKDAY_DEPENDENT_SCOPES.has(request.scope)) return true;
  return isDayInRequestScope(day, dayOfWeek ?? -1, request);
}

/**
 * Reconciliation may add or remove a coverage component only when the resulting
 * full-day shift still satisfies every explicit work plan for that cell. The
 * shared workload helper defines the established semantics: M/E/N requests are
 * component-compatible, while composite requests require their exact shift.
 * Pattern steps intentionally retain the solver's existing all-month cadence.
 */
function isExplicitPlanCompatible(
  requests: readonly ShiftRequest[] | undefined,
  personnelId: string,
  day: number,
  dayOfWeek: number | undefined,
  candidateShift: ShiftType
): boolean {
  for (const request of requests ?? []) {
    if (request.personnelId !== personnelId) continue;

    if (request.requestType === 'shift' && request.preferredShift) {
      if (!isExplicitShiftRequestInScope(request, day, dayOfWeek)) continue;
      if (!shiftSatisfiesRequestedShift(candidateShift, request.preferredShift)) return false;
    }

    if (request.requestType === 'pattern' && request.patternSteps?.length) {
      const step = patternStepForDay(request, day, dayOfWeek ?? -1);
      if (!step) continue;
      // Pattern leave markers follow the existing pattern verifier semantics:
      // any numbered/holiday leave marker satisfies a leave step.
      const matchesPatternStep = step.startsWith('L')
        ? candidateShift.startsWith('L')
        : shiftSatisfiesRequestedShift(candidateShift, step);
      if (!matchesPatternStep) return false;
    }
  }
  return true;
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
 * Locked rows, protected cells, and approved leave entries are never modified.
 * If those protections make the configured count impossible, the mismatch is
 * returned in unresolvedGaps and will also be reported by the normal schedule verifier.
 *
 * @param protectedCells - Set of "personnelId:day" strings representing cells
 *   that the head nurse manually edited. These cells are NEVER modified by
 *   reconciliation — not added to, not removed from. This ensures the system
 *   always submits to the head nurse's manual edits.
 */
export function reconcileStaffingCoverage(
  assignments: Readonly<Record<string, Readonly<Record<number, ShiftType>>>>,
  personnelList: readonly Personnel[],
  settings: SystemSettings,
  calendarDays: readonly StaffingCalendarDay[],
  targetJobGroups: readonly JobGroup[] = ['nurse', 'assistant'],
  lockedRows: readonly string[] = [],
  requests?: readonly ShiftRequest[],
  protectedCells?: ReadonlySet<string>,
  monthlyDutyHours?: { overtime?: number } | null
): StaffingCoverageResult {
  const reconciled: Record<string, Record<number, ShiftType>> = {};
  for (const [personnelId, dayAssignments] of Object.entries(assignments)) {
    reconciled[personnelId] = { ...dayAssignments };
  }

  const lockedIds = new Set(lockedRows);
  const protectedSet = protectedCells ?? new Set<string>();
  const isCellProtected = (personId: string, dayNum: number) =>
    protectedSet.has(`${personId}:${dayNum}`);
  const unresolvedGaps: StaffingCoverageGap[] = [];
  const totalDays = calendarDays.reduce((max, calendarDay) => Math.max(max, calendarDay.day), 0);
  // سقف اضافه‌کارِ مؤثر: override ماهانه مقدم بر تنظیمات بخش؛ پیکربندی‌نشده
  // مثل گذشته به ۲۴۰ برمی‌گردد.
  const overtimeCap = effectiveOvertimeCap({ settings, monthlyDutyHours });

  // نفراتی که درخواست شیفت/الگوی کاری ثبت کرده‌اند؛ نفراتِ دارای تگ روتین که هیچ
  // برنامه‌ای ندارند، ترجیحاً فقط در دوره‌های سازگار با تگشان چیده می‌شوند.
  const explicitShiftPlan = new Set<string>(
    (requests ?? [])
      .filter(request => request.requestType === 'shift' || request.requestType === 'pattern')
      .map(request => request.personnelId)
  );

  const hasExplicitWorkRequestForDay = (personnelId: string, day: number, dayOfWeek: number | undefined): boolean =>
    (requests ?? []).some(request => {
      if (request.personnelId !== personnelId) return false;
      if (request.requestType === 'pattern') return true;
      return request.requestType === 'shift'
        && isDayInRequestScope(day, dayOfWeek ?? -1, request);
    });

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
            .filter(person => !lockedIds.has(person.id))
            // سلول‌های محافظت‌شده (ویرایش دستی سرپرستار) هرگز دست‌نخورده باقی می‌مانند
            .filter(person => !isCellProtected(person.id, day))
            .filter(person => {
              const currentShift = reconciled[person.id]?.[day];
              if (isUnknownShift(currentShift)) return false;
              const candidateShift = setShiftPeriod(currentShift, shift, false);
              return isExplicitPlanCompatible(
                requests,
                person.id,
                day,
                calendarDay.dayOfWeek,
                candidateShift
              );
            })
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
          // ====== انتخاب نامزد برای جبران کمبود ======
          //
          // Stage 1: every candidate passes the one shared hard evaluator. Coverage
          // shortage is reported when no legal candidate remains; it is never solved
          // by intentionally violating workload, night-rest, leave, OFF, lock,
          // protection, or Supervisor/Staff E/N restrictions.
          //
          // Stage 2: only genuine preferences rank legal candidates: isolated shifts,
          // routine fit, soft OFF, and post-heavy OFF preference.
          const nextShiftFor = (person: Personnel): ShiftType =>
            setShiftPeriod(reconciled[person.id]?.[day], shift, true);

          const candidatePriority = (person: Personnel): number => {
            const nextShift = nextShiftFor(person);
            let priority = componentCount(reconciled[person.id]?.[day]);
            if (!hasExplicitWorkRequestForDay(person.id, day, calendarDay.dayOfWeek)
              && evaluatePostHeavyOffPreference(reconciled, person.id, day).preferOff) {
              priority += POST_HEAVY_OFF_PREFERENCE_PENALTY;
            }
            if (wouldCreateIsolatedShift(reconciled, person.id, day, totalDays, nextShift)) {
              priority += 40;
            }
            if (person.workRoutine) {
              priority += shiftMatchesRoutine(nextShift, person.workRoutine) ? -10 : 10;
              // نفرات دارای تگ بدون هیچ درخواست شیفت، به‌جز در نبود جایگزین، فقط در
              // دوره‌های سازگار با تگشان چیده می‌شوند.
              if (requests && !explicitShiftPlan.has(person.id) && !routineAllowsPeriodAdd(person.workRoutine, shift)) {
                priority += 60;
              }
            }
            // Soft OFF قابل نقض است، اما همیشه آخرین انتخاب.
            const softOffReq = (requests ?? []).find(r =>
              r.personnelId === person.id &&
              r.requestType === 'OFF' &&
              r.offHardness === 'soft' &&
              // Scope matching for reconcile: simplified check for all/custom_days/even/odd/range
              matchRequestScopeSimple(day, r)
            );
            if (softOffReq) priority += 80;
            // avoid-shift یک ترجیح است، نه محدودیت سخت: کاندیدای سازگار ترجیح داده
            // می‌شود، اما در نبود جایگزین شیفتِ اجتناب‌شده هم قابل تخصیص است.
            const avoidsShift = (requests ?? []).some(r =>
              r.personnelId === person.id &&
              r.requestType === 'avoid_shift' &&
              !!r.preferredShift &&
              isDayInRequestScope(day, calendarDay.dayOfWeek ?? -1, r) &&
              shiftSatisfiesRequestedShift(nextShift, r.preferredShift)
            );
            if (avoidsShift) priority += 80;
            return priority;
          };

          const available = group
            .filter(person => {
              const currentShift = reconciled[person.id]?.[day] || 'OFF';
              // Unknown data is not empty capacity. Keep it verifier-visible until
              // an explicit, safe transformation rule exists.
              if (isUnknownShift(currentShift) || shiftCoversPeriod(currentShift, shift)) return false;
              const candidateShift = nextShiftFor(person);
              if (!isExplicitPlanCompatible(
                requests,
                person.id,
                day,
                calendarDay.dayOfWeek,
                candidateShift
              )) {
                return false;
              }
              if (!canAssignShift(
                {
                  person,
                  day,
                  dayOfWeek: calendarDay.dayOfWeek,
                  isHoliday: calendarDay.isHoliday,
                  period: shift,
                  candidateShift,
                  assignments: reconciled,
                  totalDays,
                  requests,
                  lockedRowIds: lockedIds,
                  protectedCells: protectedSet,
                },
                COVERAGE_FILL_HARD_RULES
              )) {
                return false;
              }
              // سقف اضافه‌کار: کاندیدایی که سقف را رد می‌کند انتخاب نمی‌شود؛ در نبود
              // جایگزین، کمبود پوشش گزارش می‌شود و سقف به‌عمد نقض نمی‌شود.
              return !wouldExceedOvertimeCap(
                reconciled,
                person,
                day,
                candidateShift,
                totalDays,
                overtimeCap
              );
            })
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
