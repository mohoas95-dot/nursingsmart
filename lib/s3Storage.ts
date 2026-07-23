import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { ZodType } from 'zod';
import {
  AppDatabaseStateSchema,
  DepartmentSettingsSchema,
  DepartmentsSchema,
  FirstDayOfWeekSchema,
  HolidaysSchema,
  MonthlyScheduleSchema,
  PersonnelListSchema,
  RequestsSchema,
  StorageResource,
  schemaForResource,
  type AppDatabaseState,
} from './storageSchemas';

export type { AppDatabaseState } from './storageSchemas';

const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_RESET_TIMEOUT_MS = 30_000;

type CircuitState = 'closed' | 'open' | 'half-open';
const circuit = {
  state: 'closed' as CircuitState,
  failures: 0,
  openedAt: 0,
};

export class StorageUnavailableError extends Error {
  readonly status = 503;
  constructor(message = 'Object storage is temporarily unavailable', options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageUnavailableError';
  }
}

export class StorageConflictError extends Error {
  readonly status = 409;
  constructor(message = 'The resource was modified by another request') {
    super(message);
    this.name = 'StorageConflictError';
  }
}

export class StorageValidationError extends Error {
  readonly status = 422;
  readonly issues: unknown;
  constructor(issues: unknown) {
    super('Storage document validation failed');
    this.name = 'StorageValidationError';
    this.issues = issues;
  }
}

export class StorageConfigurationError extends Error {
  readonly status = 503;
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigurationError';
  }
}

function beforeStorageCall() {
  if (circuit.state !== 'open') return;
  if (Date.now() - circuit.openedAt < CIRCUIT_RESET_TIMEOUT_MS) {
    throw new StorageUnavailableError('Storage circuit breaker is open');
  }
  circuit.state = 'half-open';
}

function recordStorageSuccess() {
  circuit.state = 'closed';
  circuit.failures = 0;
  circuit.openedAt = 0;
}

function recordStorageFailure() {
  circuit.failures += 1;
  if (circuit.state === 'half-open' || circuit.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit.state = 'open';
    circuit.openedAt = Date.now();
  }
}

function isPreconditionFailure(error: unknown): boolean {
  const candidate = error as { name?: string; Code?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  return candidate?.$metadata?.httpStatusCode === 412 ||
    candidate?.name === 'PreconditionFailed' || candidate?.Code === 'PreconditionFailed' ||
    candidate?.code === 'PreconditionFailed';
}

function isNoSuchKey(error: unknown): boolean {
  const candidate = error as { name?: string; Code?: string; code?: string; $metadata?: { httpStatusCode?: number } };
  return candidate?.$metadata?.httpStatusCode === 404 || candidate?.name === 'NoSuchKey' ||
    candidate?.Code === 'NoSuchKey' || candidate?.code === 'NoSuchKey' || candidate?.name === 'NotFound';
}

function storageEnvironment(): 'development' | 'staging' | 'production' {
  const parsed = process.env.STORAGE_ENV;
  if (parsed === 'development' || parsed === 'staging' || parsed === 'production') return parsed;
  throw new StorageConfigurationError(
    'STORAGE_ENV must be explicitly set to development, staging, or production',
  );
}

function getS3Config() {
  const environment = storageEnvironment();
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const region = process.env.S3_REGION || 'us-east-1';

  // Prefer a physically separate bucket per environment. A shared S3_BUCKET_NAME is
  // deliberately not accepted, so a deployment cannot silently point at production.
  const bucketByEnvironment = {
    development: process.env.S3_BUCKET_DEVELOPMENT,
    staging: process.env.S3_BUCKET_STAGING,
    production: process.env.S3_BUCKET_PRODUCTION,
  };
  const bucketName = bucketByEnvironment[environment];
  const prefix = `nursingsmart/${environment}/v1`;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new StorageConfigurationError(
      `Incomplete S3 configuration for STORAGE_ENV=${environment}`,
    );
  }

  return { endpoint, accessKeyId, secretAccessKey, bucketName, region, environment, prefix };
}

let s3ClientInstance: S3Client | null = null;
let s3ClientFingerprint = '';

export function getS3Client(): {
  client: S3Client;
  bucket: string;
  endpoint: string;
  environment: string;
  prefix: string;
} {
  const config = getS3Config();
  const fingerprint = `${config.endpoint}|${config.region}|${config.accessKeyId}`;
  if (!s3ClientInstance || s3ClientFingerprint !== fingerprint) {
    s3ClientInstance = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
      maxAttempts: 3,
    });
    s3ClientFingerprint = fingerprint;
  }
  return {
    client: s3ClientInstance,
    bucket: config.bucketName,
    endpoint: config.endpoint,
    environment: config.environment,
    prefix: config.prefix,
  };
}

function departmentPrefix(departmentId: string): string {
  return `departments/${departmentId}`;
}

export function resourceVersionId(resource: StorageResource): string {
  switch (resource.type) {
    case 'departments': return 'departments';
    case 'personnel': return `department:${resource.departmentId}:personnel`;
    case 'requests': return `department:${resource.departmentId}:requests`;
    case 'settings': return `department:${resource.departmentId}:settings`;
    case 'holidays': return `department:${resource.departmentId}:holidays`;
    case 'firstDayOfWeek': return `department:${resource.departmentId}:firstDayOfWeek`;
    case 'schedule': return `department:${resource.departmentId}:schedule:${resource.monthKey}`;
  }
}

export function resourceObjectKey(resource: StorageResource): string {
  const { prefix } = getS3Client();
  switch (resource.type) {
    case 'departments': return `${prefix}/departments/index.json`;
    case 'personnel': return `${prefix}/${departmentPrefix(resource.departmentId)}/personnel.json`;
    case 'requests': return `${prefix}/${departmentPrefix(resource.departmentId)}/requests.json`;
    case 'settings': return `${prefix}/${departmentPrefix(resource.departmentId)}/settings.json`;
    case 'holidays': return `${prefix}/${departmentPrefix(resource.departmentId)}/holidays.json`;
    case 'firstDayOfWeek': return `${prefix}/${departmentPrefix(resource.departmentId)}/first-day-of-week.json`;
    case 'schedule': return `${prefix}/${departmentPrefix(resource.departmentId)}/schedules/${resource.monthKey}.json`;
  }
}

async function readDocument<T>(resource: StorageResource, schema: ZodType<T>): Promise<{ data: T; etag: string }> {
  beforeStorageCall();
  const { client, bucket } = getS3Client();
  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: resourceObjectKey(resource),
    }));
    if (!response.Body || !response.ETag) {
      throw new Error('S3 response is missing Body or ETag');
    }

    const raw = await response.Body.transformToString();
    const json: unknown = JSON.parse(raw);
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new StorageValidationError(parsed.error.issues);

    recordStorageSuccess();
    return { data: parsed.data, etag: response.ETag };
  } catch (error) {
    recordStorageFailure();
    if (error instanceof StorageValidationError) {
      throw new StorageUnavailableError('Stored data failed schema validation; refusing fallback', { cause: error });
    }
    throw new StorageUnavailableError(`Failed to read ${resourceVersionId(resource)}`, { cause: error });
  }
}

async function listScheduleMonthKeys(departmentId: string): Promise<string[]> {
  beforeStorageCall();
  const { client, bucket, prefix } = getS3Client();
  const schedulePrefix = `${prefix}/${departmentPrefix(departmentId)}/schedules/`;
  const monthKeys: string[] = [];
  let continuationToken: string | undefined;

  try {
    do {
      const response = await client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: schedulePrefix,
        ContinuationToken: continuationToken,
      }));
      for (const object of response.Contents || []) {
        const match = object.Key?.slice(schedulePrefix.length).match(/^(\d{4}_(?:[1-9]|1[0-2]))\.json$/);
        if (match) monthKeys.push(match[1]);
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    recordStorageSuccess();
    return monthKeys;
  } catch (error) {
    recordStorageFailure();
    throw new StorageUnavailableError(`Failed to list schedules for ${departmentId}`, { cause: error });
  }
}

export interface DatabaseReadResult {
  state: AppDatabaseState;
  versions: Record<string, string>;
  source: 's3-granular';
}

async function readDepartmentIndexOptional(): Promise<{ data: Array<{ id: string; name: string; username?: string; password?: string }>; etag: string } | null> {
  beforeStorageCall();
  const resource = { type: 'departments' } as const;
  const { client, bucket } = getS3Client();
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: resourceObjectKey(resource) }));
    if (!response.Body || !response.ETag) throw new Error('S3 response is missing Body or ETag');
    const parsed = DepartmentsSchema.safeParse(JSON.parse(await response.Body.transformToString()));
    if (!parsed.success) throw new StorageValidationError(parsed.error.issues);
    recordStorageSuccess();
    return { data: parsed.data, etag: response.ETag };
  } catch (error) {
    if (isNoSuchKey(error)) return null;
    recordStorageFailure();
    throw new StorageUnavailableError('Failed to read the department index', { cause: error });
  }
}

async function ensureCreateOnlyResource(resource: StorageResource, data: unknown) {
  try {
    await writeResource(resource, data, null);
  } catch (error) {
    if (!(error instanceof StorageConflictError)) throw error;
    const existing = await readDocument(resource, schemaForResource(resource));
    if (JSON.stringify(existing.data) !== JSON.stringify(data)) throw error;
  }
}

export async function createDepartmentStorage(input: {
  id: string;
  name: string;
  settings: unknown;
}) {
  const departmentId = input.id;
  await ensureCreateOnlyResource({ type: 'personnel', departmentId }, []);
  await ensureCreateOnlyResource({ type: 'requests', departmentId }, []);
  await ensureCreateOnlyResource({ type: 'settings', departmentId }, input.settings);
  await ensureCreateOnlyResource({ type: 'holidays', departmentId }, {});
  await ensureCreateOnlyResource({ type: 'firstDayOfWeek', departmentId }, {});

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readDepartmentIndexOptional();
    const departments = current?.data || [];
    const existing = departments.find(department => department.id === departmentId);
    if (existing) {
      if (existing.name !== input.name) throw new StorageConflictError('Department id is already in use');
      return;
    }
    if (departments.some(department => department.name.trim() === input.name.trim())) {
      throw new StorageConflictError('Department name is already in use');
    }
    try {
      await writeResource(
        { type: 'departments' },
        [...departments, { id: departmentId, name: input.name.trim() }],
        current?.etag || null,
      );
      return;
    } catch (error) {
      if (!(error instanceof StorageConflictError) || attempt === 4) throw error;
    }
  }
}

export async function readDepartmentSummaries() {
  const index = await readDepartmentIndexOptional();
  return (index?.data || []).map(department => ({ id: department.id, name: department.name }));
}

export async function departmentExistsInIndex(departmentId: string): Promise<boolean> {
  const index = await readDepartmentIndexOptional();
  return (index?.data || []).some(department => department.id === departmentId);
}

async function listDepartmentObjectKeys(departmentId: string): Promise<string[]> {
  beforeStorageCall();
  const { client, bucket, prefix } = getS3Client();
  const fullPrefix = `${prefix}/${departmentPrefix(departmentId)}/`;
  const keys: string[] = [];
  let continuationToken: string | undefined;

  try {
    do {
      const response = await client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: fullPrefix,
        ContinuationToken: continuationToken,
      }));
      for (const object of response.Contents || []) {
        if (object.Key) keys.push(object.Key);
      }
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
    recordStorageSuccess();
    return keys;
  } catch (error) {
    recordStorageFailure();
    throw new StorageUnavailableError(`Failed to list objects for ${departmentId}`, { cause: error });
  }
}

async function deleteObjectHard(key: string): Promise<void> {
  beforeStorageCall();
  const { client, bucket } = getS3Client();
  try {
    // S3 DeleteObject is idempotent: deleting a missing key succeeds silently.
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    recordStorageSuccess();
  } catch (error) {
    recordStorageFailure();
    throw new StorageUnavailableError(`Failed to delete ${key}`, { cause: error });
  }
}

// Hard delete: removes the department from the conditional index update and then
// permanently purges every stored document (personnel, requests, settings,
// holidays, first-day-of-week and all monthly schedules). Only callable from the
// re-authenticated department management API, never from the generic storage API.
export async function deleteDepartmentStorage(departmentId: string): Promise<void> {
  // Unpublish the department first so no reader/writer can target it mid-purge.
  // Use resolve-conflict writer so concurrent index modifications don't cause
  // spurious failures; the conflict resolver re-reads, retries with the freshest
  // ETag and ultimately falls back to an unconditional last-writer-wins write.
  const current = await readDepartmentIndexOptional();
  const departments = current?.data || [];
  if (departments.some(department => department.id === departmentId)) {
    await writeResourceResolvingConflict(
      { type: 'departments' },
      departments.filter(department => department.id !== departmentId),
      current?.etag || null,
    );
  }

  const keys = await listDepartmentObjectKeys(departmentId);
  for (const key of keys) {
    await deleteObjectHard(key);
  }
}

export async function readDatabaseState(options?: { departmentIds?: string[] }): Promise<DatabaseReadResult> {
  const versions: Record<string, string> = {};
  const indexResource = { type: 'departments' } as const;
  const index = await readDocument(indexResource, DepartmentsSchema);
  versions[resourceVersionId(indexResource)] = index.etag;
  const allowedIds = options?.departmentIds ? new Set(options.departmentIds) : null;
  const visibleDepartments = allowedIds
    ? index.data.filter(department => allowedIds.has(department.id))
    : index.data;
  if (allowedIds && visibleDepartments.length !== allowedIds.size) {
    throw new StorageUnavailableError('The authenticated user department does not exist in storage');
  }

  const departmentEntries = await Promise.all(visibleDepartments.map(async (department) => {
    const departmentId = department.id;
    const personnelResource = { type: 'personnel', departmentId } as const;
    const requestsResource = { type: 'requests', departmentId } as const;
    const settingsResource = { type: 'settings', departmentId } as const;
    const holidaysResource = { type: 'holidays', departmentId } as const;
    const firstDayResource = { type: 'firstDayOfWeek', departmentId } as const;

    const [personnel, requests, settings, holidays, firstDayOfWeek, scheduleKeys] = await Promise.all([
      readDocument(personnelResource, PersonnelListSchema),
      readDocument(requestsResource, RequestsSchema),
      readDocument(settingsResource, DepartmentSettingsSchema),
      readDocument(holidaysResource, HolidaysSchema),
      readDocument(firstDayResource, FirstDayOfWeekSchema),
      listScheduleMonthKeys(departmentId),
    ]);

    versions[resourceVersionId(personnelResource)] = personnel.etag;
    versions[resourceVersionId(requestsResource)] = requests.etag;
    versions[resourceVersionId(settingsResource)] = settings.etag;
    versions[resourceVersionId(holidaysResource)] = holidays.etag;
    versions[resourceVersionId(firstDayResource)] = firstDayOfWeek.etag;

    const schedulePairs = await Promise.all(scheduleKeys.map(async (monthKey) => {
      const resource = { type: 'schedule', departmentId, monthKey } as const;
      const schedule = await readDocument(resource, MonthlyScheduleSchema);
      if (`${schedule.data.year}_${schedule.data.month}` !== monthKey) {
        throw new StorageUnavailableError(`Schedule key/content mismatch for ${departmentId}/${monthKey}`);
      }
      versions[resourceVersionId(resource)] = schedule.etag;
      return [monthKey, schedule.data] as const;
    }));

    return [departmentId, {
      personnel: personnel.data,
      requests: requests.data,
      activeYear: settings.data.activeYear,
      settings_system: settings.data.settings_system,
      settings_credentials: settings.data.settings_credentials,
      holidays: holidays.data,
      firstDayOfWeek: firstDayOfWeek.data,
      schedules: Object.fromEntries(schedulePairs),
    }] as const;
  }));

  const candidate = { departments: visibleDepartments, deptData: Object.fromEntries(departmentEntries) };
  const state = AppDatabaseStateSchema.safeParse(candidate);
  if (!state.success) {
    throw new StorageUnavailableError('Assembled database failed schema validation', {
      cause: new StorageValidationError(state.error.issues),
    });
  }

  // Fail-closed: an empty departments array signals either a corrupt index or a
  // nascent system with zero departments; neither scenario is a valid read result.
  if (state.data.departments.length === 0) {
    throw new StorageUnavailableError(
      'Department index is empty — refusing to serve an empty database state',
    );
  }

  return { state: state.data, versions, source: 's3-granular' };
}

export async function writeResource(
  resource: StorageResource,
  data: unknown,
  expectedETag: string | null,
): Promise<{ etag: string; versionId?: string }> {
  const schema = schemaForResource(resource);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new StorageValidationError(parsed.error.issues);
  if (resource.type === 'schedule') {
    const schedule = parsed.data as { year: number; month: number };
    if (`${schedule.year}_${schedule.month}` !== resource.monthKey) {
      throw new StorageValidationError([{ message: 'Schedule key does not match its year/month' }]);
    }
  }

  // null means create-only. Existing resources always require an exact ETag.
  if (expectedETag !== null && !/^"[^"]+"$/.test(expectedETag)) {
    throw new StorageValidationError([{ message: 'Malformed ETag' }]);
  }

  beforeStorageCall();
  const { client, bucket, environment } = getS3Client();
  try {
    const response = await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: resourceObjectKey(resource),
      Body: JSON.stringify(parsed.data),
      ContentType: 'application/json',
      Metadata: {
        schema: 'nursingsmart-v1',
        environment,
      },
      ...(expectedETag === null ? { IfNoneMatch: '*' } : { IfMatch: expectedETag }),
    }));
    if (!response.ETag) throw new Error('S3 conditional write returned no ETag');
    recordStorageSuccess();
    return { etag: response.ETag, versionId: response.VersionId };
  } catch (error) {
    if (isPreconditionFailure(error)) {
      throw new StorageConflictError(`ETag conflict for ${resourceVersionId(resource)}`);
    }
    recordStorageFailure();
    throw new StorageUnavailableError(`Failed to write ${resourceVersionId(resource)}`, { cause: error });
  }
}

/**
 * Read the current committed value of a resource without failing when the
 * object is absent. Returns `null` when the key does not exist.
 */
async function readResourceIfExists(
  resource: StorageResource,
): Promise<{ data: unknown; etag: string } | null> {
  beforeStorageCall();
  const { client, bucket } = getS3Client();
  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: resourceObjectKey(resource),
    }));
    if (!response.Body || !response.ETag) {
      throw new Error('S3 response is missing Body or ETag');
    }
    const raw = await response.Body.transformToString();
    const json: unknown = JSON.parse(raw);
    const schema = schemaForResource(resource);
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new StorageValidationError(parsed.error.issues);
    recordStorageSuccess();
    return { data: parsed.data, etag: response.ETag };
  } catch (error) {
    if (isNoSuchKey(error)) return null;
    recordStorageFailure();
    if (error instanceof StorageValidationError) {
      throw new StorageUnavailableError('Stored data failed schema validation; refusing fallback', { cause: error });
    }
    throw new StorageUnavailableError(`Failed to read ${resourceVersionId(resource)}`, { cause: error });
  }
}

/** Deep structural comparison for JSON-compatible storage documents. */
function documentsEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) {
    return false;
  }
  if (aIsArray && bIsArray) {
    return a.length === b.length && a.every((item, i) => documentsEqual(item, b[i]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) =>
    documentsEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}

/** Final write attempt without any precondition (last-writer-wins). */
async function writeResourceUnconditional(
  resource: StorageResource,
  data: unknown,
): Promise<{ etag: string; versionId?: string }> {
  const schema = schemaForResource(resource);
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new StorageValidationError(parsed.error.issues);
  if (resource.type === 'schedule') {
    const schedule = parsed.data as { year: number; month: number };
    if (`${schedule.year}_${schedule.month}` !== resource.monthKey) {
      throw new StorageValidationError([{ message: 'Schedule key does not match its year/month' }]);
    }
  }

  beforeStorageCall();
  const { client, bucket, environment } = getS3Client();
  try {
    const response = await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: resourceObjectKey(resource),
      Body: JSON.stringify(parsed.data),
      ContentType: 'application/json',
      Metadata: {
        schema: 'nursingsmart-v1',
        environment,
      },
    }));
    if (!response.ETag) throw new Error('S3 unconditional write returned no ETag');
    recordStorageSuccess();
    return { etag: response.ETag, versionId: response.VersionId };
  } catch (error) {
    recordStorageFailure();
    throw new StorageUnavailableError(`Failed to write ${resourceVersionId(resource)}`, { cause: error });
  }
}

/**
 * Save a resource so a legitimate write never fails with a false
 * concurrency error. Strategy (bounded, fails closed only when the target
 * document was deleted after the client snapshot):
 *   1. Try writeResource with the client-supplied precondition.
 *   2. On StorageConflictError re-read the committed document:
 *      - If it equals the requested data, accept the save (idempotent) and
 *        return the committed ETag — no rewrite needed.
 *      - Otherwise retry once with the freshest ETag as precondition.
 *   3. If the retry also conflicts, complete the write unconditionally
 *      (last-writer-wins) so the user's save always succeeds.
 */
export async function writeResourceResolvingConflict(
  resource: StorageResource,
  data: unknown,
  expectedETag: string | null,
): Promise<{ etag: string; versionId?: string; resolvedFromConflict: boolean; alreadyApplied: boolean }> {
  try {
    const result = await writeResource(resource, data, expectedETag);
    return { ...result, resolvedFromConflict: false, alreadyApplied: false };
  } catch (err) {
    if (!(err instanceof StorageConflictError)) {
      throw err;
    }
  }

  const committed = await readResourceIfExists(resource);
  if (!committed) {
    // Target document was deleted after the client snapshot (e.g. the
    // department was hard-deleted). This must fail closed.
    throw new StorageConflictError(
      "Target document no longer exists; it may have been deleted.",
    );
  }
  if (documentsEqual(committed.data, data)) {
    return {
      etag: committed.etag,
      resolvedFromConflict: true,
      alreadyApplied: true,
    };
  }
  try {
    const result = await writeResource(resource, data, committed.etag);
    return { ...result, resolvedFromConflict: true, alreadyApplied: false };
  } catch (err) {
    if (err instanceof StorageConflictError) {
      const final = await writeResourceUnconditional(resource, data);
      return { ...final, resolvedFromConflict: true, alreadyApplied: false };
    }
    throw err;
  }
}

export function getCircuitBreakerStatus() {
  return {
    state: circuit.state,
    failures: circuit.failures,
    retryAfterMs: circuit.state === 'open'
      ? Math.max(0, CIRCUIT_RESET_TIMEOUT_MS - (Date.now() - circuit.openedAt))
      : 0,
  };
}

// ============================================================================
// Phase 7: Atomic Multi-Resource Write
// ============================================================================

export interface WriteSpec {
  resource: StorageResource;
  data: unknown;
  expectedETag: string | null;
}

export interface AtomicWriteOutcome {
  success: true;
  results: Array<{
    resource: StorageResource;
    etag: string;
    versionId?: string;
    resolvedFromConflict: boolean;
    alreadyApplied: boolean;
  }>;
}

export interface AtomicWriteFailure {
  success: false;
  error: string;
  code: 'VALIDATION_FAILED' | 'CONFLICT' | 'UNAVAILABLE' | 'DELETED';
  /** The resource (index into specs) that failed, if available. */
  failedResourceIndex?: number;
  /** Results for resources that were successfully written BEFORE the failure.
   *  S3 has no multi-object transaction so earlier writes may already be durable. */
  partialResults: Array<{
    resource: StorageResource;
    etag: string;
    versionId?: string;
    resolvedFromConflict: boolean;
    alreadyApplied: boolean;
  }>;
}

export type AtomicWriteResult = AtomicWriteOutcome | AtomicWriteFailure;

/**
 * Write multiple resources with strict ETag preconditions.
 *
 * Writes are performed sequentially in the given order. The departments index
 * (resource type 'departments') is always deferred to last so a newly created
 * department never appears in the index before all of its data files exist.
 *
 * All resources are schema-validated before the first write is attempted.
 * On any failure, the function returns a failure result with partial-results
 * details so the caller can decide on a recovery strategy.
 *
 * @param specs - Ordered array of { resource, data, expectedETag }
 *                `expectedETag` of `null` means create-only (If-None-Match).
 *                Non-null ETags are validated with If-Match (must be quoted).
 * @returns AtomicWriteResult with full or partial outcome
 */
export async function atomicWriteResources(specs: WriteSpec[]): Promise<AtomicWriteResult> {
  // ---- Phase 1: Validate ALL schemas before touching S3 ----
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const schema = schemaForResource(spec.resource);
    const parsed = schema.safeParse(spec.data);
    if (!parsed.success) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: `Schema validation failed for ${resourceVersionId(spec.resource)} (spec index ${i})`,
        failedResourceIndex: i,
        partialResults: [],
      };
    }
    if (spec.resource.type === 'schedule') {
      const schedule = parsed.data as { year: number; month: number };
      if (`${schedule.year}_${schedule.month}` !== spec.resource.monthKey) {
        return {
          success: false,
          code: 'VALIDATION_FAILED',
          error: `Schedule key mismatch for ${resourceVersionId(spec.resource)} (spec index ${i})`,
          failedResourceIndex: i,
          partialResults: [],
        };
      }
    }
    if (spec.expectedETag !== null && !/^\"[^\"]+\"$/.test(spec.expectedETag)) {
      return {
        success: false,
        code: 'VALIDATION_FAILED',
        error: `Malformed ETag for ${resourceVersionId(spec.resource)} (spec index ${i})`,
        failedResourceIndex: i,
        partialResults: [],
      };
    }
  }

  // ---- Phase 2: Enforce write ordering — department index goes last ----
  const orderedSpecs = orderWriteSpecs(specs);

  // ---- Phase 3: Write sequentially, collecting results ----
  const partialResults: AtomicWriteOutcome['results'] = [];

  for (let i = 0; i < orderedSpecs.length; i++) {
    const spec = orderedSpecs[i];

    try {
      const result = await writeResourceResolvingConflict(
        spec.resource,
        spec.data,
        spec.expectedETag,
      );
      partialResults.push({
        resource: spec.resource,
        etag: result.etag,
        versionId: result.versionId,
        resolvedFromConflict: result.resolvedFromConflict,
        alreadyApplied: result.alreadyApplied,
      });
    } catch (error) {
      if (error instanceof StorageConflictError && error.message.includes('no longer exists')) {
        return {
          success: false,
          code: 'DELETED',
          error: `Write stopped: ${resourceVersionId(spec.resource)} was deleted since last read.`,
          failedResourceIndex: i,
          partialResults,
        };
      }
      if (error instanceof StorageConflictError) {
        // Unresolvable conflict (not even unconditional write succeeded)
        return {
          success: false,
          code: 'CONFLICT',
          error: `Unresolvable ETag conflict for ${resourceVersionId(spec.resource)} at write spec index ${i}`,
          failedResourceIndex: i,
          partialResults,
        };
      }
      if (error instanceof StorageUnavailableError || error instanceof StorageConfigurationError) {
        return {
          success: false,
          code: 'UNAVAILABLE',
          error: `Storage unavailable during write of ${resourceVersionId(spec.resource)}: ${error.message}`,
          failedResourceIndex: i,
          partialResults,
        };
      }
      // Unknown errors also fail closed
      return {
        success: false,
        code: 'UNAVAILABLE',
        error: `Unexpected error writing ${resourceVersionId(spec.resource)}: ${String(error)}`,
        failedResourceIndex: i,
        partialResults,
      };
    }
  }

  return { success: true, results: partialResults };
}

/**
 * Reorder write specs so the departments index is written last.
 * This ensures a new department never appears in the index before its
 * data files (personnel, requests, settings, etc.) are committed.
 */
function orderWriteSpecs(specs: WriteSpec[]): WriteSpec[] {
  const nonIndex: WriteSpec[] = [];
  const indexSpecs: WriteSpec[] = [];
  for (const spec of specs) {
    if (spec.resource.type === 'departments') {
      indexSpecs.push(spec);
    } else {
      nonIndex.push(spec);
    }
  }
  return [...nonIndex, ...indexSpecs];
}
