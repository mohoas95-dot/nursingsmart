/**
 * نقطهٔ ورود سازگار برای دسترسی به Prisma.
 *
 * پیاده‌سازی واقعی به `lib/db/client.ts` منتقل شده است تا همهٔ مسیرها از یک
 * نمونهٔ واحد کلاینت، تراکنش‌های مهلت‌دار و تلاش مجدد خودکار در برابر خطاهای
 * موقت هم‌زمانی بهره ببرند.
 *
 * برای کد جدید ترجیحاً مستقیماً از `lib/db` استفاده کنید:
 *   import { dbRead, dbWrite, runInTransaction } from '@/lib/db';
 */

export {
  prisma,
  dbRead,
  dbWrite,
  runInTransaction,
  runInSerializableTransaction,
  checkDatabaseHealth,
  TRANSACTION_DEFAULTS,
  type DbClient,
  type TransactionClient,
} from './db/client';
