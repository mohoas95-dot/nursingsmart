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

## Concurrency

Transaction rules, the automatic retry layer for transient database errors (deadlocks, lock timeouts, pool exhaustion), duplicate-request protection, and the error-handling contract are documented in [`docs/CONCURRENCY.md`](docs/CONCURRENCY.md).

All database access must go through `lib/db` (`dbRead` / `dbWrite` / `runInTransaction`) rather than the raw Prisma client. Health of the database and object storage is exposed at `GET /api/health`.

## Tests

```bash
npm test
```
