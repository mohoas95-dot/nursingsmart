import { INITIAL_SETTINGS } from './mockData';
import type { SystemSettings } from './types';

/**
 * Normalize persisted settings before scenario hydration or solver execution.
 *
 * This function intentionally lives at module scope. Scenario hydration runs
 * during the first authenticated render, so it must never depend on a function
 * initialized later inside the Home component body.
 */
export function normalizeSystemSettings(settings?: SystemSettings | any): SystemSettings {
  if (!settings) return INITIAL_SETTINGS;
  const dutyHours = settings.dutyHours || {};
  const weekday = settings.demand?.weekday || {};
  const holiday = settings.demand?.holiday || {};

  return {
    ...settings,
    autoCalculateDutyHours: settings.autoCalculateDutyHours,
    dutyHours: {
      official: Number(dutyHours.official) || 0,
      contract: Number(dutyHours.contract) || 0,
      conscript: Number(dutyHours.conscript) || 0,
      overtime: Number(dutyHours.overtime) || 0,
    },
    demand: {
      weekday: {
        morningNurse: Number(weekday.morningNurse) || 0,
        morningAssistant: Number(weekday.morningAssistant) || 0,
        afternoonNurse: Number(weekday.afternoonNurse) || 0,
        afternoonAssistant: Number(weekday.afternoonAssistant) || 0,
        afternoonLeader: Number(weekday.afternoonLeader) || 0,
        nightNurse: Number(weekday.nightNurse) || 0,
        nightAssistant: Number(weekday.nightAssistant) || 0,
        nightLeader: Number(weekday.nightLeader) || 0,
      },
      holiday: {
        morningNurse: Number(holiday.morningNurse) || 0,
        morningAssistant: Number(holiday.morningAssistant) || 0,
        afternoonNurse: Number(holiday.afternoonNurse) || 0,
        afternoonAssistant: Number(holiday.afternoonAssistant) || 0,
        afternoonLeader: Number(holiday.afternoonLeader) || 0,
        nightNurse: Number(holiday.nightNurse) || 0,
        nightAssistant: Number(holiday.nightAssistant) || 0,
        nightLeader: Number(holiday.nightLeader) || 0,
      },
    },
  };
}
