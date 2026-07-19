import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '../prisma';
import type { AuthenticatedUser } from './types';

const SESSION_COOKIE = 'nursingsmart_session';
const DEFAULT_SESSION_HOURS = 12;

export class AuthenticationError extends Error {
  constructor(public readonly status: 401 | 403, message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function sessionDurationMs() {
  const hours = Number(process.env.AUTH_SESSION_HOURS || DEFAULT_SESSION_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_SESSION_HOURS) * 60 * 60 * 1000;
}

function toAuthenticatedUser(user: {
  id: string;
  nationalId: string;
  firstName: string;
  lastName: string;
  role: 'ADMIN' | 'HEAD_NURSE' | 'PERSONNEL';
  departmentId: string | null;
  personnelId: string | null;
  mustChangePassword: boolean;
}): AuthenticatedUser {
  return user;
}

export async function createSession(
  userId: string,
  metadata: { userAgent?: string | null; ipAddress?: string | null } = {},
) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionDurationMs());
  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      userAgent: metadata.userAgent?.slice(0, 500) || null,
      ipAddress: metadata.ipAddress?.slice(0, 100) || null,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt <= new Date() || !session.user.active) {
    if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    // Cookie mutation is only legal in a Route Handler/Server Action. Callers treat
    // this stale token as unauthenticated; the logout endpoint clears it explicitly.
    return null;
  }
  return toAuthenticatedUser(session.user);
}

export async function requireCurrentUser(options?: {
  roles?: Array<'ADMIN' | 'HEAD_NURSE' | 'PERSONNEL'>;
  allowPasswordChangeRequired?: boolean;
}) {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError(401, 'برای ادامه وارد حساب کاربری شوید.');
  if (user.mustChangePassword && !options?.allowPasswordChangeRequired) {
    throw new AuthenticationError(403, 'ابتدا رمز عبور پیش‌فرض را تغییر دهید.');
  }
  if (options?.roles && !options.roles.includes(user.role)) {
    throw new AuthenticationError(403, 'دسترسی به این بخش مجاز نیست.');
  }
  return user;
}

export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  cookieStore.delete(SESSION_COOKIE);
}

export async function revokeOtherSessions(userId: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  await prisma.session.deleteMany({
    where: {
      userId,
      ...(token ? { tokenHash: { not: hashToken(token) } } : {}),
    },
  });
}

export async function revokeAllUserSessions(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}
