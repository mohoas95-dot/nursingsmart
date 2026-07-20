'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import type { MonthlySchedule } from '../../../domain/types';
import type { JobGroup } from '../../../lib/types';

/**
 * useScheduleState — Custom Hook
 *
 * RESPONSIBILITY:
 *   Manage schedule-related state: schedule, solving target, finalized months,
 *   locked rows, dismissed warnings, and editing cell.
 *
 * Extracted from: app/page.tsx (Phase 4)
 * Purpose: Reduce state clutter in main component
 */

export interface UseScheduleStateReturn {
  // Schedule
  schedule: MonthlySchedule | null;
  setSchedule: Dispatch<SetStateAction<MonthlySchedule | null>>;

  // Solving state
  solvingTarget: JobGroup | null;
  setSolvingTarget: Dispatch<SetStateAction<JobGroup | null>>;

  // Finalized months
  finalizedNursesMonths: string[];
  setFinalizedNursesMonths: Dispatch<SetStateAction<string[]>>;
  finalizedAssistantsMonths: string[];
  setFinalizedAssistantsMonths: Dispatch<SetStateAction<string[]>>;

  // Locked rows
  lockedRows: string[];
  setLockedRows: Dispatch<SetStateAction<string[]>>;
  toggleRowLock: (personnelId: string) => void;

  // Dismissed warnings
  dismissedWarnings: string[];
  setDismissedWarnings: Dispatch<SetStateAction<string[]>>;

  // Editing cell
  editingCell: { pId: string; day: number } | null;
  setEditingCell: Dispatch<SetStateAction<{ pId: string; day: number } | null>>;

  // Helpers
  isScheduleLocked: (jobGroup: JobGroup, monthKey: string) => boolean;
  isRowLocked: (personnelId: string) => boolean;
}

export function useScheduleState(): UseScheduleStateReturn {
  // Schedule
  const [schedule, setSchedule] = useState<MonthlySchedule | null>(null);

  // Solving state
  const [solvingTarget, setSolvingTarget] = useState<JobGroup | null>(null);

  // Finalized months
  const [finalizedNursesMonths, setFinalizedNursesMonths] = useState<string[]>([]);
  const [finalizedAssistantsMonths, setFinalizedAssistantsMonths] = useState<string[]>([]);

  // Locked rows
  const [lockedRows, setLockedRows] = useState<string[]>([]);

  // Dismissed warnings
  const [dismissedWarnings, setDismissedWarnings] = useState<string[]>([]);

  // Editing cell
  const [editingCell, setEditingCell] = useState<{ pId: string; day: number } | null>(null);

  // Helper: Toggle row lock
  const toggleRowLock = (personnelId: string) => {
    setLockedRows((prev) =>
      prev.includes(personnelId)
        ? prev.filter((id) => id !== personnelId)
        : [...prev, personnelId]
    );
  };

  // Helper: Check if schedule is locked
  const isScheduleLocked = (jobGroup: JobGroup, monthKey: string): boolean => {
    const finalizedMonths = jobGroup === 'nurse' ? finalizedNursesMonths : finalizedAssistantsMonths;
    return finalizedMonths.includes(monthKey);
  };

  // Helper: Check if row is locked
  const isRowLocked = (personnelId: string): boolean => {
    return lockedRows.includes(personnelId);
  };

  return {
    schedule,
    setSchedule,
    solvingTarget,
    setSolvingTarget,
    finalizedNursesMonths,
    setFinalizedNursesMonths,
    finalizedAssistantsMonths,
    setFinalizedAssistantsMonths,
    lockedRows,
    setLockedRows,
    toggleRowLock,
    dismissedWarnings,
    setDismissedWarnings,
    editingCell,
    setEditingCell,
    isScheduleLocked,
    isRowLocked,
  };
}
