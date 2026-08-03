# NursingSmart

سامانه هوشمند برنامه‌ریزی شیفت پرستاری — موتور زمان‌بندی، حل‌کننده (solver)، مدیریت
درخواست‌ها، مرخصی، ساعات موظفی و گزارش‌گیری.

This repository contains everything you need to run the app locally.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local`, configure PostgreSQL, and initialize authentication:
   `npm run db:generate && npm run db:migrate && npm run db:seed`
3. Configure the environment-specific S3 variables described in [`docs/STORAGE_ARCHITECTURE.md`](docs/STORAGE_ARCHITECTURE.md).
4. Run the S3 conditional-write compatibility test:
   `npm run storage:test-conditional`
5. Run the app:
   `npm run dev`

## Storage architecture

The granular object layout, optimistic-locking contract, circuit breaker, and one-time migration procedure are documented in [`docs/STORAGE_ARCHITECTURE.md`](docs/STORAGE_ARCHITECTURE.md).

## Authentication

PostgreSQL/Prisma setup, national-ID login, session security, first-login password change, and the head-nurse password-reset workflow are documented in [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md).

## Code audit

A full audit — duplicate code, error boundaries, memory leaks, re-render stability, and API authorization — is documented in [`docs/CODE_AUDIT.md`](docs/CODE_AUDIT.md).

Authorization rules for storage resources live in `lib/auth/resource-authorization.ts` as pure, testable functions. **UI checks are never a security boundary**: every rule enforced in the client must also be enforced there.

## Performance

Initial-load analysis — data-fetching waterfalls, lazy month loading, static asset optimization, and caching — is documented in [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md).

`GET /api/storage` accepts an optional `?months=YYYY_M,...` parameter so clients load only the schedule documents they display; the response reports `availableMonths` for lazy navigation.

## Concurrency

Transaction rules, the automatic retry layer for transient database errors (deadlocks, lock timeouts, pool exhaustion), duplicate-request protection, and the error-handling contract are documented in [`docs/CONCURRENCY.md`](docs/CONCURRENCY.md).

All database access must go through `lib/db` (`dbRead` / `dbWrite` / `runInTransaction`) rather than the raw Prisma client. Health of the database and object storage is exposed at `GET /api/health`.

## Tests

```bash
npm test
```
