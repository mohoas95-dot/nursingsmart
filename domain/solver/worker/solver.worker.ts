/**
 * Solver Web Worker — Non-blocking execution for 50-500 scenarios
 * Must only process plain JSON DTOs, no class instances across boundary
 *
 * This file runs in Worker context, not main thread.
 * For Next.js, it should be loaded via: new Worker(new URL('./solver.worker.ts', import.meta.url))
 */

// NOTE: This worker file is written to be compatible with Web Worker API
// It does NOT import React or Next.js

import type { SolverInputDTO, ScenarioDTO } from '../types';
import { generateScenarios } from '../generator/scenario-generator';
import { scoreScenario } from '../scoring/scoring-engine';
import { autoRepairScenario } from '../repair/auto-repair-engine';
import { selectArena } from '../arena/arena-selector';

export interface WorkerRequest {
  type: 'START' | 'CANCEL';
  payload?: SolverInputDTO;
}

export interface WorkerResponse {
  type: 'PROGRESS' | 'SCENARIO_DONE' | 'DONE' | 'ERROR';
  payload: any;
}

let cancelled = false;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { type, payload } = event.data;

  if (type === 'CANCEL') {
    cancelled = true;
    return;
  }

  if (type === 'START' && payload) {
    cancelled = false;
    const input = payload as SolverInputDTO;
    const startTime = Date.now();

    try {
      const total = Math.min(500, Math.max(50, input.scenarioCount));
      const scenarios = generateScenarios({
        input,
        onProgress: (current, tot, bestScore) => {
          const progressMsg: WorkerResponse = {
            type: 'PROGRESS',
            payload: {
              current,
              total: tot,
              bestScore,
              elapsedMs: Date.now() - startTime,
            },
          };
          // @ts-ignore self.postMessage exists in worker
          self.postMessage(progressMsg);
        },
      });

      let bestScore = 0;
      const repairedScenarios: ScenarioDTO[] = [];

      for (let i = 0; i < scenarios.length; i++) {
        if (cancelled) {
          const cancelMsg: WorkerResponse = {
            type: 'ERROR',
            payload: { message: 'Cancelled by user' },
          };
          // @ts-ignore
          self.postMessage(cancelMsg);
          return;
        }

        let sc = scenarios[i];

        // Score
        const score = scoreScenario({
          scenario: sc,
          personnel: input.personnel,
          calendar: input.calendar,
          requests: input.requests,
          demand: input.demand,
          dutyHours: input.dutyHours,
          previousMonthMemory: input.previousMonthMemory,
          baselineAssignments: input.baselineAssignments,
          humanApprovedLocks: input.humanApprovedLocks,
        });
        sc.score = score;
        if (score.total > bestScore) bestScore = score.total;

        // Repair if needed (lightweight in worker to avoid heavy blocking)
        if (score.total < 90 || sc.violations.length > 0) {
          const repairRes = autoRepairScenario(
            sc,
            input.personnel,
            input.calendar,
            input.demand,
            input.requests,
            input.dutyHours,
            {
              maxIterations: 30,
              maxTimeMs: 300,
              maxChainDepth: input.maxChainDepth ?? 3,
              enableChainSwap: true,
            }
          );
          sc = repairRes.scenario;
          const newScore = scoreScenario({
            scenario: sc,
            personnel: input.personnel,
            calendar: input.calendar,
            requests: input.requests,
            demand: input.demand,
            dutyHours: input.dutyHours,
            previousMonthMemory: input.previousMonthMemory,
            baselineAssignments: input.baselineAssignments,
            humanApprovedLocks: input.humanApprovedLocks,
          });
          sc.score = newScore;
          if (newScore.total > bestScore) bestScore = newScore.total;
        }

        repairedScenarios.push(sc);

        // Send scenario done every 5
        if (i % 5 === 0) {
          const msg: WorkerResponse = {
            type: 'SCENARIO_DONE',
            payload: { scenario: sc },
          };
          // @ts-ignore
          self.postMessage(msg);
        }

        // Yield to event loop every 20 to keep worker responsive
        if (i % 20 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Progress
        if (i % 10 === 0) {
          const prog: WorkerResponse = {
            type: 'PROGRESS',
            payload: {
              current: i + 1,
              total,
              bestScore,
              elapsedMs: Date.now() - startTime,
            },
          };
          // @ts-ignore
          self.postMessage(prog);
        }
      }

      const arena = selectArena({
        scenarios: repairedScenarios,
        personnel: input.personnel,
        calendar: input.calendar,
        requests: input.requests,
        demand: input.demand,
        dutyHours: input.dutyHours,
        elapsedMs: Date.now() - startTime,
      });

      const doneMsg: WorkerResponse = {
        type: 'DONE',
        payload: {
          scenarios: arena.allScenariosSorted,
          arena,
          elapsedMs: Date.now() - startTime,
        },
      };
      // @ts-ignore
      self.postMessage(doneMsg);
    } catch (err: any) {
      const errorMsg: WorkerResponse = {
        type: 'ERROR',
        payload: {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        },
      };
      // @ts-ignore
      self.postMessage(errorMsg);
    }
  }
};

// For TypeScript to treat this as module
export {};
