import {
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

export function getCircuitBreakerStatus() {
  return {
    state: circuit.state,
    failures: circuit.failures,
    retryAfterMs: circuit.state === 'open'
      ? Math.max(0, CIRCUIT_RESET_TIMEOUT_MS - (Date.now() - circuit.openedAt))
      : 0,
  };
}
