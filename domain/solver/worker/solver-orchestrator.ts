/**
 * Solver Orchestrator — Main thread orchestrator for Web Worker
 * Handles progress, cancellation, UI lock, arena selection
 * Non-blocking architecture to prevent UI freezing
 */

import type { SolverInputDTO, ScenarioDTO } from '../types';
import type { ArenaResultDTO } from '../arena/arena-types';
import { generateScenarios } from '../generator/scenario-generator';
import { scoreScenario } from '../scoring/scoring-engine';
import { autoRepairScenario } from '../repair/auto-repair-engine';
import { selectArena } from '../arena/arena-selector';
import { CancellationToken, SolverUILock } from './cancellation-token';

export interface SolverOrchestratorProgress {
  current: number;
  total: number;
  bestScore: number;
  elapsedMs: number;
  messageFa: string;
  messageEn: string;
}

export interface SolverOrchestratorCallbacks {
  onProgress?: (progress: SolverOrchestratorProgress) => void;
  onScenario?: (scenario: ScenarioDTO) => void;
  onDone?: (result: { scenarios: ScenarioDTO[]; arena: ArenaResultDTO; elapsedMs: number }) => void;
  onError?: (error: string) => void;
}

export interface SolverOrchestratorOptions {
  repairEnabled: boolean;
  maxChainDepth: number;
  blastRadiusDays?: number;
  centerDay?: number;
}

export class SolverOrchestrator {
  private cancellationToken: CancellationToken;
  private uiLock: SolverUILock;
  private startTime: number = 0;

  constructor(
    private input: SolverInputDTO,
    private callbacks: SolverOrchestratorCallbacks = {},
    private options: SolverOrchestratorOptions = { repairEnabled: true, maxChainDepth: 3 }
  ) {
    this.cancellationToken = new CancellationToken();
    this.uiLock = new SolverUILock();
  }

  getToken(): CancellationToken {
    return this.cancellationToken;
  }

  getLock(): SolverUILock {
    return this.uiLock;
  }

  cancel(): void {
    this.cancellationToken.cancel();
  }

  /**
   * Run orchestrator — generates scenarios, repairs, scores, selects arena
   * This runs in main thread but chunked with setTimeout to avoid blocking
   * For true non-blocking, use Web Worker version
   */
  async run(): Promise<{ scenarios: ScenarioDTO[]; arena: ArenaResultDTO; elapsedMs: number } | null> {
    const lockOwner = `orchestrator_${Date.now()}`;
    if (!this.uiLock.acquire(lockOwner)) {
      this.callbacks.onError?.('موتور حل‌کننده در حال اجراست — لطفاً صبر کنید (Solver is busy)');
      return null;
    }

    this.startTime = Date.now();
    this.cancellationToken = new CancellationToken(); // fresh token

    try {
      const total = Math.min(500, Math.max(50, this.input.scenarioCount));
      const scenarios = generateScenarios({
        input: this.input,
        onProgress: (current, tot, bestScore) => {
          this.callbacks.onProgress?.({
            current,
            total: tot,
            bestScore,
            elapsedMs: Date.now() - this.startTime,
            messageFa: `سناریو ${current} از ${tot} | بهترین امتیاز: ${bestScore.toFixed(1)}`,
            messageEn: `Scenario ${current} of ${tot} | Best Score: ${bestScore.toFixed(1)}`,
          });
        },
      });

      // Score initial scenarios
      let bestScore = 0;
      for (let i = 0; i < scenarios.length; i++) {
        this.cancellationToken.throwIfCancelled();

        // Chunk yield every 20 scenarios to avoid UI freeze
        if (i % 20 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        const sc = scenarios[i];
        const score = scoreScenario({
          scenario: sc,
          personnel: this.input.personnel,
          calendar: this.input.calendar,
          requests: this.input.requests,
          demand: this.input.demand,
          dutyHours: this.input.dutyHours,
          previousMonthMemory: this.input.previousMonthMemory,
          baselineAssignments: this.input.baselineAssignments,
          humanApprovedLocks: this.input.humanApprovedLocks,
        });
        sc.score = score;
        if (score.total > bestScore) bestScore = score.total;

        this.callbacks.onScenario?.(sc);

        // Auto repair if enabled and score < threshold or violations exist
        if (this.options.repairEnabled && (score.total < 85 || sc.violations.length > 0)) {
          // Repair only if not localized or inside blast radius
          const shouldRepair = this.options.blastRadiusDays === undefined || !this.options.centerDay || (() => {
            // If localized, only repair if scenario has violation inside blast radius
            if (!this.options.centerDay) return true;
            const center = this.options.centerDay;
            const radius = this.options.blastRadiusDays ?? 3;
            return sc.violations.some(v => v.day && Math.abs(v.day - center) <= radius) || sc.understaffedSlots.some(u => Math.abs(u.day - center) <= radius);
          })();

          if (shouldRepair) {
            const repairResult = autoRepairScenario(
              sc,
              this.input.personnel,
              this.input.calendar,
              this.input.demand,
              this.input.requests,
              this.input.dutyHours,
              {
                maxIterations: 50,
                maxTimeMs: 500,
                maxChainDepth: this.options.maxChainDepth,
                enableChainSwap: true,
                blastRadiusDays: this.options.blastRadiusDays,
                centerDay: this.options.centerDay,
              }
            );
            // Replace with repaired
            scenarios[i] = repairResult.scenario;
            // Re-score after repair
            const newScore = scoreScenario({
              scenario: repairResult.scenario,
              personnel: this.input.personnel,
              calendar: this.input.calendar,
              requests: this.input.requests,
              demand: this.input.demand,
              dutyHours: this.input.dutyHours,
              previousMonthMemory: this.input.previousMonthMemory,
              baselineAssignments: this.input.baselineAssignments,
              humanApprovedLocks: this.input.humanApprovedLocks,
            });
            scenarios[i].score = newScore;
            if (newScore.total > bestScore) bestScore = newScore.total;
          }
        }

        if (i % 10 === 0) {
          this.callbacks.onProgress?.({
            current: i + 1,
            total,
            bestScore,
            elapsedMs: Date.now() - this.startTime,
            messageFa: `سناریو ${i + 1} از ${total} | بهترین امتیاز: ${bestScore.toFixed(1)}`,
            messageEn: `Scenario ${i + 1} of ${total} | Best Score: ${bestScore.toFixed(1)}`,
          });
        }
      }

      // Arena selection
      const arena = selectArena({
        scenarios,
        personnel: this.input.personnel,
        calendar: this.input.calendar,
        requests: this.input.requests,
        demand: this.input.demand,
        dutyHours: this.input.dutyHours,
        elapsedMs: Date.now() - this.startTime,
      });

      const elapsedMs = Date.now() - this.startTime;
      this.callbacks.onDone?.({ scenarios: arena.allScenariosSorted, arena, elapsedMs });

      return { scenarios: arena.allScenariosSorted, arena, elapsedMs };
    } catch (err: any) {
      if (err.message === 'Cancelled') {
        this.callbacks.onError?.('اجرای موتور لغو شد (Cancelled)');
        return null;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.callbacks.onError?.(msg);
      return null;
    } finally {
      this.uiLock.release(lockOwner);
    }
  }

  /**
   * Create Web Worker version (if available)
   * Returns worker instance, caller must handle onmessage
   */
  static createWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null;
    try {
      // Next.js App Router Web Worker loading
      // This path must be adjusted based on bundler; for now we return null and use main thread fallback
      // In production, you'd do: new Worker(new URL('./solver.worker.ts', import.meta.url))
      return null;
    } catch {
      return null;
    }
  }
}
