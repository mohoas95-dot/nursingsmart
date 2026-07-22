/**
 * Prisma Atomic Transaction — Design for final schedule saving
 * Per requirement: Final schedule saving must execute inside Atomic Database Transaction (Prisma $transaction)
 * Currently S3 is used with fail-closed, but this file shows how to migrate to Prisma with atomic guarantees
 */

import type { MonthlySchedule } from '../../lib/types';

// This is a design placeholder — actual Prisma client import would be:
// import { prisma } from '../../lib/prisma';

export interface PrismaTransactionPersistence {
  saveScheduleAtomic(schedule: MonthlySchedule, departmentId: string, monthKey: string): Promise<void>;
}

/**
 * Example implementation with Prisma $transaction
 * Either all shifts saved successfully, or complete rollback upon failure
 */
export async function saveScheduleWithPrismaTransaction(
  prisma: any, // PrismaClient
  schedule: MonthlySchedule,
  departmentId: string,
  monthKey: string
): Promise<void> {
  // Per instruction: Either all shifts are saved successfully, or complete rollback
  await prisma.$transaction(async (tx: any) => {
    // 1. Delete existing assignments for this month/department
    await tx.scheduleAssignment.deleteMany({
      where: { departmentId, monthKey },
    });

    // 2. Create new assignments atomically
    const assignmentsToCreate = Object.entries(schedule.assignments).flatMap(([personnelId, days]) =>
      Object.entries(days).map(([day, shift]) => ({
        departmentId,
        monthKey,
        personnelId,
        day: parseInt(day, 10),
        shift,
      }))
    );

    // Batch create
    await tx.scheduleAssignment.createMany({
      data: assignmentsToCreate,
    });

    // 3. Update schedule metadata atomically
    await tx.monthlySchedule.upsert({
      where: { departmentId_monthKey: { departmentId, monthKey } },
      update: {
        year: schedule.year,
        month: schedule.month,
        warnings: schedule.warnings,
        shiftLeaders: schedule.shiftLeaders,
        finalized: schedule.finalized,
        finalizedNurses: schedule.finalizedNurses,
        finalizedAssistants: schedule.finalizedAssistants,
        changeLogs: schedule.changeLogs,
      },
      create: {
        departmentId,
        monthKey,
        year: schedule.year,
        month: schedule.month,
        warnings: schedule.warnings,
        shiftLeaders: schedule.shiftLeaders,
        assignments: {}, // stored via scheduleAssignment table for atomicity
        finalized: schedule.finalized,
        finalizedNurses: schedule.finalizedNurses,
        finalizedAssistants: schedule.finalizedAssistants,
        changeLogs: schedule.changeLogs,
      },
    });

    // If any step fails, entire transaction rolls back — data integrity guaranteed
  });
}

/**
 * Current S3 implementation is fail-closed and emulates atomic via ETag + saveQueue
 * This is good but not as strong as Prisma $transaction
 * Migration path:
 * Phase 1 (now): Keep S3 fail-closed, add this design doc
 * Phase 2: Dual-write S3 + Prisma in transaction
 * Phase 3: Move to Prisma only with $transaction
 */
export const S3_VS_PRISMA_COMPARISON = {
  s3: {
    pros: ['Simple', 'Works with current infra', 'Fail-closed prevents partial writes'],
    cons: ['No multi-object transaction', 'Requires ETag handling', 'Eventual consistency'],
  },
  prisma: {
    pros: ['True ACID transaction', 'Either all saved or rollback', 'Strong data integrity per requirement'],
    cons: ['Requires PostgreSQL', 'Migration needed'],
  },
};
