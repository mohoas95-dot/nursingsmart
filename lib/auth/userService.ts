import 'server-only';
import { prisma } from '../prisma';
import { DEFAULT_INITIAL_PASSWORD, hashPassword } from './password';
import { NationalIdSchema } from './validation';

export type CreateUserInput = {
  nationalId: string;
  firstName: string;
  lastName: string;
  role?: 'ADMIN' | 'HEAD_NURSE' | 'PERSONNEL';
  departmentId?: string | null;
  personnelId?: string | null;
};

export async function createUserWithDefaultPassword(input: CreateUserInput) {
  const nationalId = NationalIdSchema.parse(input.nationalId);
  const passwordHash = await hashPassword(DEFAULT_INITIAL_PASSWORD);
  return prisma.user.create({
    data: {
      nationalId,
      passwordHash,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      role: input.role || 'PERSONNEL',
      departmentId: input.departmentId || null,
      personnelId: input.personnelId || null,
      mustChangePassword: true,
      hasResetRequest: false,
    },
  });
}
