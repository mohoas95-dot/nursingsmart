/**
 * Arena Facade — Bridges new multi-scenario engine to legacy S3 persistence
 * Updated per clarifications 2026-07-22
 * - Auto scenario count 100-500, no manual input
 * - No new DB fields, isEssential mapping for OFF hard/soft
 * - isFixedRoutine tag guidance only
 * - Memory freeze from schedules table prevMonthKey
 * - UNFILLED distinct status handling
 * - No-request staff balanced rotating
 * - Sleep OFF human veto with critical warning but allow save
 */

import type { SolverInputDTO, ScenarioDTO } from '../../../domain/solver/types';
import { autoScenarioCount, mapOffHardness } from '../../../domain/solver/types';
import type { MonthlySchedule } from '../../../lib/types';
import type { Personnel, ShiftRequest, SystemSettings } from '../../../lib/types';
import { SolverOrchestrator } from '../../../domain/solver/worker/solver-orchestrator';
import type { ArenaResultDTO } from '../../../domain/solver/arena/arena-types';

export interface ArenaRunInput {
  year: number;
  month: number;
  personnel: Personnel[];
  requests: ShiftRequest[];
  settings: SystemSettings;
  holidays: Record<number, string>;
  firstDayOfWeek: number | undefined;
  monthlyDutyHours: { official: number; contract: number; conscript: number; overtime: number } | null;
  currentSchedule: MonthlySchedule | null;
  previousMonthSchedule?: MonthlySchedule | null; // for memory freeze from DB schedules table prevMonthKey
  finalizedMonths?: string[]; // for ongoing leave detection
  scenarioCount?: number; // kept for compat but ignored — auto 100-500 per clarification #6
  seed?: number;
  humanApprovedLocks?: Array<{ personnelId: string; day: number; shift: string }>;
}

export interface ArenaPersistence {
  saveSchedule(schedule: MonthlySchedule, departmentId: string): Promise<void>;
}

export interface ArenaUIFeedback {
  onProgress?: (msg: string) => void;
  showError: (msg: string) => void;
}

function toPersonnelDTO(p: Personnel, hasRequests: boolean): import('../../../domain/solver/types').PersonnelDTO {
  return {
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    jobGroup: p.jobGroup as any,
    position: p.position as any,
    employmentType: p.employmentType as any,
    experienceYears: p.experienceYears,
    active: p.active,
    canBeShiftLeader: p.canBeShiftLeader,
    orderIndex: p.orderIndex,
    // Lightweight guidance tag per clarification #4 — does NOT restrict solver
    isFixedRoutine: p.isFixedRoutine ?? (p.position === 'supervisor' || p.position === 'staff' ? true : undefined),
    // No-request rule per clarification #8
    hasNoRequests: !hasRequests,
  };
}

function toRequestDTO(r: ShiftRequest, isPublished: boolean): import('../../../domain/solver/types').ShiftRequestDTO {
  // Clarification #3: Do NOT add new DB fields, use existing isEssential boolean + head nurse approval
  const hardness = mapOffHardness(r.isEssential, r.isEssential); // isEssential=true => hard OFF
  return {
    id: r.id,
    personnelId: r.personnelId,
    requestType: r.requestType as any,
    preferredShift: r.preferredShift as any,
    patternSteps: r.patternSteps,
    isEssential: r.isEssential,
    offHardness: hardness, // derived internally only
    scope: r.scope as any,
    startDate: r.startDate,
    endDate: r.endDate,
    selectedDays: r.selectedDays,
    isPublished, // for ongoing leave detection
  };
}

function buildCalendarDays(year: number, month: number, holidays: Record<number, string>, firstDay?: number): import('../../../domain/solver/types').CalendarDayDTO[] {
  const totalDays = 31; // TODO: use jalaaliMonthLength via import
  const fd = firstDay ?? 0;
  const days: import('../../../domain/solver/types').CalendarDayDTO[] = [];
  for (let d = 1; d <= totalDays; d++) {
    const dow = (fd + (d - 1)) % 7;
    const isFriday = dow === 6;
    days.push({
      day: d,
      dayOfWeek: dow,
      isHoliday: isFriday || Boolean(holidays[d]),
      isFriday,
      holidayTitle: holidays[d],
    });
  }
  return days;
}

function buildPreviousMonthMemory(
  previousSchedule: MonthlySchedule | null | undefined
): import('../../../domain/solver/types').PreviousMonthMemoryDTO[] | undefined {
  // Clarification #5: retrieve final 1-2 days of previous month from DB schedules table prevMonthKey
  if (!previousSchedule) return undefined;
  const totalDaysPrev = Object.keys(previousSchedule.assignments[Object.keys(previousSchedule.assignments)[0] ?? ''] ?? {}).length || 31;
  // We'll take last 2 days per personnel
  const mem: import('../../../domain/solver/types').PreviousMonthMemoryDTO[] = [];
  for (const pId of Object.keys(previousSchedule.assignments)) {
    const asgn = previousSchedule.assignments[pId];
    if (!asgn) continue;
    const lastTwo: string[] = [];
    for (let d = Math.max(1, totalDaysPrev - 1); d <= totalDaysPrev; d++) {
      const sh = asgn[d];
      if (sh) lastTwo.push(sh);
    }
    if (lastTwo.length > 0) {
      mem.push({ personnelId: pId, lastTwoDays: lastTwo });
    }
  }
  return mem.length > 0 ? mem : undefined;
}

/**
 * Run Arena — auto 100-500 scenarios, presents top 3-5 alternatives
 */
export async function runArenaFacade(
  input: ArenaRunInput,
  persistence: ArenaPersistence,
  ui: ArenaUIFeedback,
  departmentId: string
): Promise<{ best: ScenarioDTO | null; arena: ArenaResultDTO | null; topAlternatives: ScenarioDTO[]; error?: string }> {
  try {
    const calendar = buildCalendarDays(input.year, input.month, input.holidays, input.firstDayOfWeek);

    const demand = {
      weekday: {
        morningNurse: input.settings.demand.weekday.morningNurse,
        morningAssistant: input.settings.demand.weekday.morningAssistant,
        afternoonNurse: input.settings.demand.weekday.afternoonNurse,
        afternoonAssistant: input.settings.demand.weekday.afternoonAssistant,
        nightNurse: input.settings.demand.weekday.nightNurse,
        nightAssistant: input.settings.demand.weekday.nightAssistant,
        afternoonLeader: input.settings.demand.weekday.afternoonLeader,
        nightLeader: input.settings.demand.weekday.nightLeader,
      },
      holiday: {
        morningNurse: input.settings.demand.holiday.morningNurse,
        morningAssistant: input.settings.demand.holiday.morningAssistant,
        afternoonNurse: input.settings.demand.holiday.afternoonNurse,
        afternoonAssistant: input.settings.demand.holiday.afternoonAssistant,
        nightNurse: input.settings.demand.holiday.nightNurse,
        nightAssistant: input.settings.demand.holiday.nightAssistant,
        afternoonLeader: input.settings.demand.holiday.afternoonLeader,
        nightLeader: input.settings.demand.holiday.nightLeader,
      },
    };

    const currentMonthKey = `${input.year}_${input.month}`;
    const previousMonthKey = input.month > 1 ? `${input.year}_${input.month - 1}` : `${input.year - 1}_12`;

    // Determine which requests belong to published months for ongoing leave detection
    const isPublishedMonth = input.finalizedMonths?.includes(currentMonthKey) ?? false;

    // Group requests by personnel to detect no-request staff
    const requestsByPerson = new Map<string, number>();
    for (const r of input.requests) {
      requestsByPerson.set(r.personnelId, (requestsByPerson.get(r.personnelId) ?? 0) + 1);
    }

    // Auto scenario count per clarification #6 — no manual input required
    const autoCount = autoScenarioCount(input.personnel.filter(p => p.active).length);
    const scenarioCount = Math.min(500, Math.max(100, autoCount));

    const solverInput: SolverInputDTO = {
      year: input.year,
      month: input.month,
      personnel: input.personnel.filter(p => p.active).map(p => toPersonnelDTO(p, (requestsByPerson.get(p.id) ?? 0) > 0)),
      requests: input.requests.map(r => toRequestDTO(r, isPublishedMonth)),
      calendar,
      demand,
      dutyHours: {
        official: input.settings.dutyHours.official,
        contract: input.settings.dutyHours.contract,
        conscript: input.settings.dutyHours.conscript,
        overtime: input.settings.dutyHours.overtime,
      },
      scenarioCount,
      seed: input.seed ?? Date.now(),
      baselineAssignments: input.currentSchedule?.assignments as any,
      previousMonthMemory: buildPreviousMonthMemory(input.previousMonthSchedule),
      previousMonthKey,
      isPublishedMonth,
      finalizedMonths: input.finalizedMonths,
      humanApprovedLocks: input.humanApprovedLocks, // for Sleep OFF human veto
    };

    const orchestrator = new SolverOrchestrator(
      solverInput,
      {
        onProgress: (p) => ui.onProgress?.(p.messageFa),
        onError: (msg) => ui.showError(msg),
      },
      { repairEnabled: true, maxChainDepth: 3 }
    );

    const result = await orchestrator.run();
    if (!result) {
      return { best: null, arena: null, topAlternatives: [], error: 'اجرای آِرنا لغو یا با خطا مواجه شد' };
    }

    // Top 3-5 alternatives per clarification #6
    const topAlternatives = result.arena.allScenariosSorted.slice(0, 5);

    // Persist best as MonthlySchedule, with UNFILLED handling
    if (result.arena.best) {
      const bestScenario = result.arena.best;
      const newSchedule: MonthlySchedule = {
        year: input.year,
        month: input.month,
        assignments: bestScenario.assignments as any,
        shiftLeaders: bestScenario.shiftLeaders as any,
        warnings: [
          ...bestScenario.violations.filter(v => v.level === 'A').map(v => v.messageFa),
          // UNFILLED warnings with blinking red style handled in UI
          ...bestScenario.understaffedSlots.map(u => `UNFILLED: روز ${u.day} شیفت ${u.shift} گروه ${u.jobGroup} کمبود ${u.shortage} — خاکستری تیره + چشمک قرمز`),
        ],
        finalized: false,
        dismissedWarnings: [],
        lockedRows: [],
        changeLogs: [
          `آِرنا هوشمند (۱۰۰-۵۰۰ خودکار): ${result.arena.totalScenarios} سناریو در ${(result.elapsedMs / 1000).toFixed(1)}s — بهترین امتیاز ${bestScenario.score?.total} — استراتژی ${bestScenario.strategy} — TOP ۳-۵ نمایش`,
          ...(bestScenario.repairLog.slice(0, 5).map(l => l.reasonFa)),
        ],
      };

      await persistence.saveSchedule(newSchedule, departmentId);
    }

    return { best: result.arena.best, arena: result.arena, topAlternatives };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    ui.showError(msg);
    return { best: null, arena: null, topAlternatives: [], error: msg };
  }
}
