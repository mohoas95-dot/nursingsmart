/**
 * Routine Inference — Infer working routine from historical schedules + requests
 * Pure, solver-ready, minimal implementation for Phase 1
 */

import type { PersonnelDTO, ShiftRequestDTO, ShiftTypeDTO } from '../types';

export interface InferredRoutine {
  personnelId: string;
  type: 'fixed' | 'rotating' | 'flexible' | 'unknown';
  pattern?: ShiftTypeDTO[]; // e.g., ['M','M','E','OFF','N','OFF'] repeating
  preferredShifts: Record<string, number>; // count of M/E/N preferences
  isLightShiftGamer: boolean; // anti-gaming flag
  confidence: number; // 0-1
  detailsFa: string;
}

export interface HistoricalDay {
  day: number;
  shift: ShiftTypeDTO;
}

/**
 * Infer routine for each personnel
 * @param personnel - active personnel
 * @param requests - all requests
 * @param historicalAssignments - optional map personnelId -> array of 30-90 days historic shifts
 */
export function inferRoutines(
  personnel: PersonnelDTO[],
  requests: ShiftRequestDTO[],
  historicalAssignments?: Record<string, HistoricalDay[]>
): InferredRoutine[] {
  const results: InferredRoutine[] = [];

  for (const p of personnel) {
    if (!p.active) continue;

    const pRequests = requests.filter(r => r.personnelId === p.id);

    // Count preferred shifts from requests
    const preferred: Record<string, number> = { M: 0, E: 0, N: 0, OFF: 0 };
    for (const req of pRequests) {
      if (req.requestType === 'shift' && req.preferredShift) {
        const ps = req.preferredShift;
        if (ps.includes('M')) preferred.M++;
        if (ps.includes('E')) preferred.E++;
        if (ps.includes('N')) preferred.N++;
      }
      if (req.requestType === 'OFF') preferred.OFF++;
      if (req.requestType === 'pattern' && req.patternSteps) {
        for (const step of req.patternSteps) {
          if (step.includes('M')) preferred.M++;
          if (step.includes('E')) preferred.E++;
          if (step.includes('N')) preferred.N++;
          if (step === 'OFF') preferred.OFF++;
        }
      }
    }

    // Analyze historical if provided
    const history = historicalAssignments?.[p.id] || [];
    const histCount: Record<string, number> = { M: 0, E: 0, N: 0, OFF: 0 };
    for (const h of history) {
      const s = h.shift;
      if (s === 'OFF' || s.startsWith('L')) histCount.OFF++;
      else {
        if (s.includes('M')) histCount.M++;
        if (s.includes('E')) histCount.E++;
        if (s.includes('N')) histCount.N++;
      }
    }

    const totalPref = preferred.M + preferred.E + preferred.N + preferred.OFF;
    const totalHist = histCount.M + histCount.E + histCount.N + histCount.OFF;

    // Fixed detection: if >80% same shift in history or requests
    let type: InferredRoutine['type'] = 'unknown';
    let pattern: ShiftTypeDTO[] | undefined;
    let confidence = 0.3;

    if (p.isFixedRoutine || p.position === 'supervisor' || p.position === 'staff') {
      // Fixed morning staff
      type = 'fixed';
      confidence = 0.9;
    } else if (pRequests.some(r => r.requestType === 'pattern' && (r.patternSteps?.length ?? 0) > 0)) {
      const patReq = pRequests.find(r => r.requestType === 'pattern');
      if (patReq?.patternSteps) {
        type = 'rotating';
        pattern = patReq.patternSteps as ShiftTypeDTO[];
        confidence = 0.85;
      }
    } else if (totalHist > 15) {
      // Check if rotating pattern can be detected via simple repetition
      // For phase 1, we just detect fixed vs flexible
      const maxHist = Math.max(histCount.M, histCount.E, histCount.N, histCount.OFF);
      if (maxHist / totalHist > 0.8) {
        type = 'fixed';
        confidence = 0.7;
      } else {
        type = 'flexible';
        confidence = 0.5;
      }
    } else if (totalPref > 5) {
      const maxPref = Math.max(preferred.M, preferred.E, preferred.N, preferred.OFF);
      if (maxPref / totalPref > 0.75) {
        type = 'fixed';
        confidence = 0.6;
      } else {
        type = 'flexible';
        confidence = 0.4;
      }
    } else {
      type = 'flexible';
      confidence = 0.3;
    }

    // Anti-Gaming: if only light shifts (only M) and never N/E, and is general, flag
    // Light = only M, no N, E count < 10% of total
    const isLightGamer =
      type !== 'fixed' &&
      p.position === 'general' &&
      preferred.N === 0 &&
      preferred.E === 0 &&
      preferred.M > 3;

    let detailsFa = '';
    if (type === 'fixed') detailsFa = `روتین ثابت تشخیص داده شد (اعتماد ${Math.round(confidence * 100)}٪) — ترجیح: ${Object.entries(preferred).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}`).join('، ')}`;
    else if (type === 'rotating') detailsFa = `روتین چرخشی تشخیص داده شد با الگوی [${pattern?.join(' - ') ?? ''}] (اعتماد ${Math.round(confidence * 100)}٪)`;
    else if (type === 'flexible') detailsFa = `روتین منعطف — پرسنل درخواست متنوع دارد (اعتماد ${Math.round(confidence * 100)}٪)`;
    else detailsFa = `روتین نامشخص — داده کافی نیست`;

    if (isLightGamer) {
      detailsFa += ` — هشدار: الگوی درخواست‌ها سبک و مشکوک به دور زدن بار کاری است (فقط صبح)`;
    }

    results.push({
      personnelId: p.id,
      type,
      pattern,
      preferredShifts: preferred,
      isLightShiftGamer: isLightGamer,
      confidence,
      detailsFa,
    });
  }

  return results;
}
