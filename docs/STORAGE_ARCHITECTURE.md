# Defensive S3 storage architecture

## Object layout

Every environment uses a separate bucket selected by `STORAGE_ENV`, plus a hard-coded environment prefix:

```text
nursingsmart/{development|staging|production}/v1/
  departments/index.json
  departments/{departmentId}/personnel.json
  departments/{departmentId}/requests.json
  departments/{departmentId}/settings.json
  departments/{departmentId}/holidays.json
  departments/{departmentId}/first-day-of-week.json
  departments/{departmentId}/schedules/{yyyy_m}.json
```

Department removal is only possible through the re-authenticated hard-delete endpoint (`DELETE /api/head-nurse/department`): it unpublishes the department from the conditional index update, permanently deletes every document under `departments/{departmentId}/` (personnel, requests, settings, holidays, first-day-of-week and all monthly schedules), and wipes the related database users and sessions. There is no unauthenticated or soft-delete path; bucket lifecycle/versioning policy remains the recovery net.

## Required environment variables

```dotenv
STORAGE_ENV=development # no implicit default
S3_ENDPOINT=https://...
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET_DEVELOPMENT=nursingsmart-development
S3_BUCKET_STAGING=nursingsmart-staging
S3_BUCKET_PRODUCTION=nursingsmart-production
```

Use separate credentials with least-privilege policies for each bucket. Do not expose S3 credentials through `NEXT_PUBLIC_*` variables.

## Concurrency contract

* A GET returns an ETag map under `versions`.
* Existing resources declare their last-known ETag (`If-Match: "etag"`). `PUT /api/storage` calls `writeResourceResolvingConflict`, a bounded resolver that:
  (1) attempts the write with the client's precondition,
  (2) on 412/PreconditionFailed re-reads the committed document and accepts the save without a rewrite when the committed value already equals the requested one (idempotent retries),
  (3) retries once against the freshest ETag, and
  (4) otherwise completes the write unconditionally (last-writer-wins) so a legitimate save never fails falsely.
* HTTP 409 (`ETAG_CONFLICT`) can still surface only when the target document was deleted after the client snapshot (e.g. admin hard-deleted the department), which must fail closed. The strict conditional `writeResource` primitive remains for the create-only onboarding/migration paths (`If-None-Match: *`).
* The frontend serializes local writes so requests from one tab cannot complete out of order.
* Every document is validated with a strict Zod schema before `PutObject`.

S3 has no atomic transaction spanning multiple keys. A user action that changes several resources is a small ordered batch, not a transaction. Required documents for a new department are written before the index publishes that department. A partial batch failure blocks subsequent writes and requires reload/reconciliation. If strict cross-document atomicity is a business requirement, use a transactional database (PostgreSQL/DynamoDB) and keep S3 for snapshots/exports.

## Provider compatibility gate

Conditional headers vary across S3-compatible providers. Run this against every environment before deployment:

```bash
STORAGE_ENV=development npm run storage:test-conditional
```

The test verifies create-only `If-None-Match` and stale `If-Match` both fail with HTTP 412. Do not deploy writes if the test fails. A HEAD-then-PUT implementation is not an acceptable fallback because it has a TOCTOU race.

## ایجاد محیط جدید و مهاجرت

برای نصب جدید، نیازی به Seed خودکار S3 نیست: ثبت‌نام صریح سرپرستار از `POST /api/onboarding/head-nurse` اولین Index و Objectهای خالی بخش را با Conditional Write ایجاد می‌کند. هر سرپرستار فقط مدیر بخش خودش است.

برای مهاجرت داده قدیمی:

1. Stop writes in the old application.
2. Download and independently back up the legacy JSON.
3. Validate/migrate into an empty environment prefix:

```bash
STORAGE_ENV=development \
MIGRATION_SOURCE_FILE=./hospital-personnel-db.recovered.json \
npm run storage:migrate
```

Migration is create-only and writes `departments/index.json` last. It never reads or seeds the old key implicitly. If migration fails partway through, inspect/remove the new-prefix objects or choose a new schema prefix; do not turn it into overwrite mode.

4. Start the new application and verify `GET /api/storage`.
5. Repeat for staging, then production, using separate buckets and credentials.
6. Retain the legacy object read-only until the retention period expires.

## Failure policy

* Missing, malformed, empty, inaccessible, or schema-invalid required objects result in HTTP 503.
* There is no initial-state fallback and no automatic seed.
* Three storage failures open a process-local circuit for 30 seconds. Responses include `Retry-After` while open.
* `Cache-Control: no-store` prevents personnel snapshots from being cached by browsers/CDNs.
* The obsolete whole-state POST endpoint returns HTTP 410.

## Operational controls

* Enable bucket versioning and lifecycle retention in every environment.
* Enable server access/audit logs and alarms for 409/412/503 rates.
* Back up to a second account/bucket with immutable retention.
* Store checksums, request IDs, actor IDs and audit records in a separate append-only system.
* Add integration tests for simultaneous writers, corrupt JSON, missing objects and circuit recovery.

## Security boundary

`GET` and `PUT /api/storage` now require a server-verified Prisma session, completed first-login password change, and department/role authorization. Non-admin reads are restricted to the authenticated user's department. Never log document bodies because they contain personnel data. Legacy credential fields still present in old department JSON must be removed after migration; active authentication uses only bcrypt password hashes in PostgreSQL.
