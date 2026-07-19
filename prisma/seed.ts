import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { isValidIranianNationalId, toEnglishDigits } from '../lib/auth/validation';

const prisma = new PrismaClient();

async function main() {
  const nationalId = toEnglishDigits(process.env.AUTH_ADMIN_NATIONAL_ID || '').trim();
  if (!isValidIranianNationalId(nationalId)) {
    throw new Error('AUTH_ADMIN_NATIONAL_ID must be a valid Iranian national ID');
  }
  const initialPassword = process.env.AUTH_ADMIN_INITIAL_PASSWORD || '1234';
  const passwordHash = await hash(initialPassword, 12);
  await prisma.user.upsert({
    where: { nationalId },
    update: {},
    create: {
      nationalId,
      passwordHash,
      firstName: process.env.AUTH_ADMIN_FIRST_NAME || 'مدیر',
      lastName: process.env.AUTH_ADMIN_LAST_NAME || 'سامانه',
      role: 'ADMIN',
      mustChangePassword: true,
    },
  });
  console.log('Initial administrator is ready. Password change is required on first login.');
}

main().finally(() => prisma.$disconnect());
