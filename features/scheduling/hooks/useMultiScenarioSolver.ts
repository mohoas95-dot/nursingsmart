'use client';

import { useState, useCallback, useRef } from 'react';
import type { SolverInputDTO, ScenarioDTO } from '../../../domain/solver/types';
import type { ArenaResultDTO } from '../../../domain/solver/arena/arena-types';
import { SolverOrchestrator, type SolverOrchestratorProgress, type SolverOrchestratorOptions } from '../../../domain/solver/worker/solver-orchestrator';
import { CancellationToken } from '../../../domain/solver/worker/cancellation-token';

export interface UseMultiScenarioSolverReturn {
  status: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  progress: SolverOrchestratorProgress | null;
  scenarios: ScenarioDTO[];
  arena: ArenaResultDTO | null;
  best: ScenarioDTO | null;
  error: string | null;
  run: (input: SolverInputDTO, options?: SolverOrchestratorOptions) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  isRunning: boolean;
}

/**
 * Hook for Multi-Scenario Solver with non-blocking execution
 * Provides Persian progress messages and UI lock handling
 */
export function useMultiScenarioSolver(): UseMultiScenarioSolverReturn {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error' | 'cancelled'>('idle');
  const [progress, setProgress] = useState<SolverOrchestratorProgress | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioDTO[]>([]);
  const [arena, setArena] = useState<ArenaResultDTO | null>(null);
  const [best, setBest] = useState<ScenarioDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  const orchestratorRef = useRef<SolverOrchestrator | null>(null);
  const tokenRef = useRef<CancellationToken | null>(null);

  const run = useCallback(async (input: SolverInputDTO, options?: SolverOrchestratorOptions) => {
    setStatus('running');
    setProgress(null);
    setScenarios([]);
    setArena(null);
    setBest(null);
    setError(null);

    const orchestrator = new SolverOrchestrator(
      input,
      {
        onProgress: (p) => {
          setProgress(p);
        },
        onScenario: (sc) => {
          setScenarios(prev => {
            // Keep only last 50 scenarios in state to avoid memory bloat, but arena has all
            const next = [...prev, sc];
            if (next.length > 50) return next.slice(-50);
            return next;
          });
        },
        onDone: (result) => {
          setScenarios(result.scenarios.slice(0, 50)); // keep 50 best for UI
          setArena(result.arena);
          setBest(result.arena.best);
          setStatus('done');
          setProgress({
            current: result.arena.totalScenarios,
            total: result.arena.totalScenarios,
            bestScore: result.arena.best?.score?.total ?? 0,
            elapsedMs: result.elapsedMs,
            messageFa: `تکمیل شد — ${result.arena.totalScenarios} سناریو بررسی شد | بهترین امتیاز: ${result.arena.best?.score?.total ?? 0}`,
            messageEn: `Done — ${result.arena.totalScenarios} scenarios | Best: ${result.arena.best?.score?.total}`,
          });
        },
        onError: (errMsg) => {
          setError(errMsg);
          if (errMsg.includes('Cancelled') || errMsg.includes('لغو')) {
            setStatus('cancelled');
          } else {
            setStatus('error');
          }
        },
      },
      options ?? { repairEnabled: true, maxChainDepth: 3 }
    );

    orchestratorRef.current = orchestrator;
    tokenRef.current = orchestrator.getToken();

    const result = await orchestrator.run();
    if (!result) {
      // If cancelled or busy, status already set via callback
      if (status !== 'cancelled' && status !== 'error') {
        setStatus('idle');
      }
    }
  }, [status]);

  const cancel = useCallback(() => {
    if (tokenRef.current) {
      tokenRef.current.cancel();
      setStatus('cancelled');
      setProgress(prev => prev ? { ...prev, messageFa: 'لغو شد — در حال توقف موتور...', messageEn: 'Cancelling...' } : null);
    }
    if (orchestratorRef.current) {
      orchestratorRef.current.cancel();
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setProgress(null);
    setScenarios([]);
    setArena(null);
    setBest(null);
    setError(null);
    orchestratorRef.current = null;
    tokenRef.current = null;
  }, []);

  return {
    status,
    progress,
    scenarios,
    arena,
    best,
    error,
    run,
    cancel,
    reset,
    isRunning: status === 'running',
  };
}
