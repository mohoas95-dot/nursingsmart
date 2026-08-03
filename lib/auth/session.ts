import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { dbRead, dbWrite, isRecordNotFoundError } from '../db';
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
  return {
    id: user.id,
    nationalId: user.nationalId,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    departmentId: user.departmentId,
    personnelId: user.personnelId,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function createSession(
  userId: string,
  metadata: { userAgent?: string | null; ipAddress?: string | null } = {},
) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionDurationMs());
  await dbWrite(client => client.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      userAgent: metadata.userAgent?.slice(0, 500) || null,
      ipAddress: metadata.ipAddress?.slice(0, 100) || null,
    },
  }), { label: 'session-create' });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

/**
 * خواندن کاربر نشست جاری.
 *
 * این پرمصرف‌ترین مسیر پایگاه داده است (هر درخواست API یک‌بار آن را صدا می‌زند)،
 * بنابراین با `dbRead` اجرا می‌شود تا یک اختلال لحظه‌ای اتصال، کل رابط کاربری را
 * به صفحهٔ ورود پرت نکند.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await dbRead(client => client.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  }), { label: 'session-lookup' });

  if (!session || session.expiresAt <= new Date() || !session.user.active) {
    if (session) {
      // پاک‌سازی نشست منقضی «بهترین تلاش» است: اگر درخواست دیگری هم‌زمان همان
      // رکورد را حذف کرده باشد (P2025) یا پایگاه داده لحظه‌ای در دسترس نباشد،
      // نباید مسیر احراز هویت شکست بخورد. از deleteMany استفاده می‌شود چون
      // برخلاف delete، نبودِ رکورد را خطا نمی‌داند.
      await dbWrite(client => client.session.deleteMany({ where: { id: session.id } }), {
        label: 'session-cleanup',
        maxAttempts: 2,
      }).catch(error => {
        if (!isRecordNotFoundError(error)) {
          console.warn('[session] حذف نشست منقضی انجام نشد:', error);
        }
      });
    }
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

/**
 * خروج از حساب. کوکی حتی اگر حذف رکورد نشست شکست بخورد پاک می‌شود، تا کاربر
 * هرگز در وضعیت «نه داخل، نه بیرون» گیر نکند.
 */
export async function destroyCurrentSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  try {
    if (token) {
      await dbWrite(client => client.session.deleteMany({ where: { tokenHash: hashToken(token) } }), {
        label: 'session-destroy',
      });
    }
  } finally {
    cookieStore.delete(SESSION_COOKIE);
  }
}

export async function revokeOtherSessions(userId: string) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  await dbWrite(client => client.session.deleteMany({
    where: {
      userId,
      ...(token ? { tokenHash: { not: hashToken(token) } } : {}),
    },
  }), { label: 'session-revoke-others' });
}

export async function revokeAllUserSessions(userId: string) {
  await dbWrite(client => client.session.deleteMany({ where: { userId } }), {
    label: 'session-revoke-all',
  });
}
