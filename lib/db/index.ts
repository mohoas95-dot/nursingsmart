/**
 * لایهٔ ارتباط با پایگاه داده — نقطهٔ ورود واحد.
 *
 * ```ts
 * import { dbRead, dbWrite, runInTransaction, classifyDbError } from '@/lib/db';
 * ```
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
  type TransactionOptions,
} from './client';

export {
  withDbRetry,
  computeBackoffDelay,
  DbRetryExhaustedError,
  RETRY_PROFILES,
  type RetryOptions,
} from './retry';

export {
  classifyDbError,
  describeDbError,
  extractDbErrorCode,
  isDatabaseError,
  isPrismaKnownError,
  isRecordNotFoundError,
  isTransientDbError,
  isUniqueConstraintError,
  uniqueConstraintTargets,
  type DbErrorInfo,
  type DbErrorKind,
} from './errors';

export {
  runIdempotent,
  clearIdempotencyCache,
  idempotencyCacheSize,
} from './idempotency';

export {
  withMutex,
  isMutexBusy,
  MutexBusyError,
} from './mutex';
