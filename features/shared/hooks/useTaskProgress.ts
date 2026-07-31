'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyLearnedEstimates,
  blendDurationEstimate,
  computeProgressPercent,
  estimateRemainingMs,
  findPhaseIndex,
  formatRemainingTime,
  resolvePhaseBounds,
  smoothPercent,
  type ProgressPhase,
  type ResolvedPhase,
} from '../../../domain/progress/task-progress';

/**
 * useTaskProgress — Custom Hook
 *
 * RESPONSIBILITY:
 *   راه‌اندازی نوار پیشرفت ۰ تا ۱۰۰ درصدِ کاملاً هم‌گام با مراحل واقعی یک
 *   عملیات (تولید برنامه، ذخیره‌سازی، بارگذاری و…).
 *
 * چگونه هم‌گام می‌ماند؟
 *   - مصرف‌کننده در شروع هر مرحلهٔ واقعی `beginPhase(id)` را صدا می‌زند؛ درصد
 *     دقیقاً روی نقطهٔ شروع همان مرحله می‌نشیند.
 *   - داخل هر مرحله، تیک زمانی با منحنی ease-out جلو می‌رود و هرگز از سقف
 *     مرحله عبور نمی‌کند؛ پس نوار زودتر از کار پر نمی‌شود.
 *   - مدت واقعی هر مرحله ذخیره و با میانگین متحرک نمایی یاد گرفته می‌شود؛
 *     دفعهٔ بعد تخمین «زمان باقی‌مانده» دقیق‌تر است (در localStorage می‌ماند).
 *
 * PERSISTENCE: کلید ذخیره‌سازی اختیاری است؛ بدون آن هم کار می‌کند (SSR-safe).
 */

const TICK_MS = 90;
const STORAGE_PREFIX = 'nursingsmart_progress_estimates_v1';

export interface TaskProgressState {
  /** درصد نمایشی (۰ تا ۱۰۰) که هرگز عقب نمی‌رود. */
  percent: number;
  /** شناسهٔ مرحلهٔ جاری. */
  phaseId: string | null;
  /** برچسب فارسی مرحلهٔ جاری. */
  phaseLabel: string;
  /** شمارهٔ مرحلهٔ جاری (از ۱). */
  phaseNumber: number;
  /** تعداد کل مراحل. */
  phaseCount: number;
  /** تخمین زمان باقی‌مانده به‌صورت متن فارسی. */
  remainingLabel: string;
  /** تخمین خام زمان باقی‌مانده (میلی‌ثانیه). */
  remainingMs: number;
  /** آیا عملیات فعال است؟ */
  isRunning: boolean;
  /** مراحل حل‌شده به همراه مرزهای درصدی، برای نمایش نقشهٔ مراحل. */
  phases: ResolvedPhase[];
}

export interface TaskProgressControls {
  /** شروع یک عملیات تازه از صفر. */
  start: (phaseId?: string) => void;
  /** ورود به مرحلهٔ بعد؛ درصد روی نقطهٔ شروع آن مرحله قفل می‌شود. */
  beginPhase: (phaseId: string) => void;
  /** گزارش پیشرفت واقعی داخل مرحلهٔ جاری (۰ تا ۱). */
  reportPhaseFraction: (fraction: number | null) => void;
  /** پایان موفق: نوار تا ۱۰۰٪ پر می‌شود و مدت مراحل یاد گرفته می‌شود. */
  complete: () => void;
  /** توقف/لغو بدون رسیدن به ۱۰۰٪. */
  reset: () => void;
}

function readLearnedEstimates(storageKey: string | undefined): Record<string, number> | null {
  if (!storageKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}:${storageKey}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) result[key] = value;
    }
    return result;
  } catch {
    return null;
  }
}

function writeLearnedEstimates(storageKey: string | undefined, estimates: Record<string, number>) {
  if (!storageKey || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}:${storageKey}`, JSON.stringify(estimates));
  } catch {
    // ذخیره‌سازی تخمین‌ها اختیاری است؛ خطای سهمیه نباید رابط کاربری را بشکند.
  }
}

export function useTaskProgress(
  phases: ReadonlyArray<ProgressPhase>,
  options: { storageKey?: string; autoStart?: boolean } = {}
): TaskProgressState & TaskProgressControls {
  const { storageKey, autoStart = false } = options;

  // مقدار اولیه فقط از تعریف مراحل ساخته می‌شود (قطعی و SSR-safe)؛ تخمین‌های
  // یادگرفته‌شده از localStorage به‌صورت تنبل و در نخستین رویداد کاربر خوانده
  // می‌شوند تا نه ناسازگاری hydration رخ دهد و نه رندر آبشاری.
  const [bounds, setBounds] = useState<ResolvedPhase[]>(() => resolvePhaseBounds(phases));
  const [isRunning, setIsRunning] = useState<boolean>(autoStart);
  const [displayPercent, setDisplayPercent] = useState<number>(0);
  const [remainingMs, setRemainingMs] = useState<number>(0);
  const [phaseIndex, setPhaseIndex] = useState<number>(0);

  const boundsRef = useRef<ResolvedPhase[]>(bounds);
  const phasesRef = useRef<ReadonlyArray<ProgressPhase>>(phases);
  const learnedRef = useRef<Record<string, number> | null>(null);
  const learnedLoadedRef = useRef(false);
  const storageKeyRef = useRef(storageKey);

  const phasesSignature = useMemo(
    () => phases.map(phase => `${phase.id}:${phase.weight ?? 1}:${phase.estimateMs ?? 0}`).join('|'),
    [phases]
  );

  const phaseIndexRef = useRef(0);
  const phaseStartedAtRef = useRef<number>(0);
  const reportedFractionRef = useRef<number | null>(null);
  const displayPercentRef = useRef(0);
  const runningRef = useRef(autoStart);
  const measuredDurationsRef = useRef<Record<string, number>>({});

  // به‌روزرسانی مراجع خارج از فاز رندر انجام می‌شود.
  useEffect(() => {
    phasesRef.current = phases;
    storageKeyRef.current = storageKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phasesSignature, storageKey]);

  /**
   * تخمین‌های یادگرفته‌شده را (یک‌بار) از localStorage می‌خواند و مرزهای مراحل
   * را با آن‌ها بازمی‌سازد. فقط از دل رویدادها صدا زده می‌شود، نه حین رندر.
   */
  const refreshBounds = useCallback((): ResolvedPhase[] => {
    if (!learnedLoadedRef.current) {
      learnedRef.current = readLearnedEstimates(storageKeyRef.current);
      learnedLoadedRef.current = true;
    }
    const nextBounds = resolvePhaseBounds(applyLearnedEstimates(phasesRef.current, learnedRef.current));
    boundsRef.current = nextBounds;
    setBounds(nextBounds);
    return nextBounds;
  }, []);

  const applyState = useCallback((completed: boolean) => {
    const now = Date.now();
    const elapsedInPhaseMs = phaseStartedAtRef.current > 0 ? now - phaseStartedAtRef.current : 0;
    const computation = {
      bounds: boundsRef.current,
      phaseIndex: phaseIndexRef.current,
      elapsedInPhaseMs,
      reportedFraction: reportedFractionRef.current,
      completed,
    };
    const target = computeProgressPercent(computation);
    const next = completed ? 100 : smoothPercent(displayPercentRef.current, target);
    displayPercentRef.current = next;
    setDisplayPercent(next);
    setRemainingMs(estimateRemainingMs(computation));
  }, []);

  const start = useCallback((phaseId?: string) => {
    // مرزها با تخمین‌های یادگرفته‌شده تازه‌سازی می‌شوند تا نوار این اجرا با
    // مدت‌های واقعی اجراهای قبلی هم‌گام باشد.
    const currentBounds = refreshBounds();
    const index = findPhaseIndex(currentBounds, phaseId);
    phaseIndexRef.current = index;
    phaseStartedAtRef.current = Date.now();
    reportedFractionRef.current = null;
    displayPercentRef.current = currentBounds[index]?.start ?? 0;
    measuredDurationsRef.current = {};
    runningRef.current = true;
    setPhaseIndex(index);
    setDisplayPercent(displayPercentRef.current);
    setRemainingMs(estimateRemainingMs({
      bounds: currentBounds,
      phaseIndex: index,
      elapsedInPhaseMs: 0,
      reportedFraction: null,
    }));
    setIsRunning(true);
  }, [refreshBounds]);

  const beginPhase = useCallback((phaseId: string) => {
    // نخستین فراخوانی (مثلاً در حالت autoStart) هم باید تخمین‌های یادگرفته‌شده را بخواند.
    const currentBounds = learnedLoadedRef.current ? boundsRef.current : refreshBounds();
    const nextIndex = findPhaseIndex(currentBounds, phaseId);
    if (nextIndex === phaseIndexRef.current && phaseStartedAtRef.current > 0 && runningRef.current) {
      // فراخوانی تکراری برای همان مرحله نباید تایمر مرحله را ریست کند.
      return;
    }
    const previousPhase = currentBounds[phaseIndexRef.current];

    // مدت واقعی مرحلهٔ قبلی ثبت می‌شود تا تخمین دفعهٔ بعد دقیق‌تر شود.
    if (previousPhase && phaseStartedAtRef.current > 0 && nextIndex !== phaseIndexRef.current) {
      measuredDurationsRef.current[previousPhase.id] = Date.now() - phaseStartedAtRef.current;
    }

    phaseIndexRef.current = nextIndex;
    phaseStartedAtRef.current = Date.now();
    reportedFractionRef.current = null;
    // درصد به نقطهٔ شروع مرحلهٔ واقعی می‌پرد (فقط رو به جلو).
    const phaseStart = currentBounds[nextIndex]?.start ?? 0;
    if (phaseStart > displayPercentRef.current) {
      displayPercentRef.current = phaseStart;
      setDisplayPercent(phaseStart);
    }
    runningRef.current = true;
    setPhaseIndex(nextIndex);
    setIsRunning(true);
  }, [refreshBounds]);

  const reportPhaseFraction = useCallback((fraction: number | null) => {
    if (fraction === null || !Number.isFinite(fraction)) {
      reportedFractionRef.current = null;
      return;
    }
    const clamped = Math.min(1, Math.max(0, fraction));
    const previous = reportedFractionRef.current;
    // گزارش پیشرفت هرگز عقب نمی‌رود.
    reportedFractionRef.current = previous === null ? clamped : Math.max(previous, clamped);
  }, []);

  const complete = useCallback(() => {
    const currentBounds = boundsRef.current;
    const lastPhase = currentBounds[phaseIndexRef.current];
    if (lastPhase && phaseStartedAtRef.current > 0) {
      measuredDurationsRef.current[lastPhase.id] = Date.now() - phaseStartedAtRef.current;
    }

    // یادگیری مدت مراحل برای تخمین دقیق‌تر در اجراهای بعدی.
    const measured = measuredDurationsRef.current;
    if (Object.keys(measured).length > 0) {
      const base = learnedRef.current || {};
      const updated: Record<string, number> = { ...base };
      for (const [id, duration] of Object.entries(measured)) {
        updated[id] = blendDurationEstimate(base[id], duration);
      }
      learnedRef.current = updated;
      learnedLoadedRef.current = true;
      writeLearnedEstimates(storageKeyRef.current, updated);
    }

    runningRef.current = false;
    displayPercentRef.current = 100;
    setDisplayPercent(100);
    setRemainingMs(0);
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    runningRef.current = false;
    phaseIndexRef.current = 0;
    phaseStartedAtRef.current = 0;
    reportedFractionRef.current = null;
    displayPercentRef.current = 0;
    measuredDurationsRef.current = {};
    setPhaseIndex(0);
    setDisplayPercent(0);
    setRemainingMs(0);
    setIsRunning(false);
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    if (phaseStartedAtRef.current === 0) phaseStartedAtRef.current = Date.now();
    const timer = window.setInterval(() => {
      if (!runningRef.current) return;
      applyState(false);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [isRunning, applyState]);

  const activePhase = bounds[Math.min(phaseIndex, bounds.length - 1)];

  return {
    percent: displayPercent,
    phaseId: activePhase?.id ?? null,
    phaseLabel: activePhase?.label ?? 'در حال پردازش',
    phaseNumber: Math.min(phaseIndex + 1, bounds.length),
    phaseCount: bounds.length,
    remainingLabel: formatRemainingTime(remainingMs),
    remainingMs,
    isRunning,
    phases: bounds,
    start,
    beginPhase,
    reportPhaseFraction,
    complete,
    reset,
  };
}
