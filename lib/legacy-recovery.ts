import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  getS3Client,
  readDepartmentIndexOptional,
  writeResource,
  StorageConflictError,
} from './s3Storage';
import { tryParseAppStateLenient, type AppDatabaseState } from './legacy-compat';

/**
 * بازیابی خودکار از snapshot قدیمیِ تک‌فایله درون همان سطل
 * ---------------------------------------------------------------------------
 * نسخه‌های قدیمی سامانه، کل state را در یک شیء JSON واحد (نه اسناد دانه‌ای)
 * نگه می‌داشتند. اگر استقرار جدید بدون اجرای مهاجرت بالا بیاید، `index.json`
 * دانه‌ای وجود ندارد و `GET /api/storage` با ۵۰۳ «سطل خالی» جواب می‌دهد —
 * در حالی که داده‌های واقعی همچنان در همان سطل هستند.
 *
 * این ماژول همان snapshot را داخل سطل پیدا می‌کند و «درجا» به اسناد دانه‌ای
 * تبدیل می‌کند؛ همهٔ نوشتن‌ها create-only (If-None-Match: *) هستند و index
 * آخر از همه نوشته می‌شود، پس:
 *   - هرگز دادهٔ موجود بازنویسی نمی‌شود؛
 *   - اگر دو نمونه هم‌زمان مهاجرت کنند، یکی برنده می‌شود و دیگری با
 *     StorageConflictError رد می‌شود و به مسیر عادی خواندن برمی‌گردد؛
 *   - هیچ نیازی به دست‌زدن در کنسول S3/آروان نیست.
 */

const MAX_OBJECTS_TO_SCAN = 2000;
const MAX_LEGACY_READ_BYTES = 30 * 1024 * 1024;

export type RecoveryOutcome =
  | { status: 'already-granular' }
  | { status: 'migrated'; departments: number; notes: string[] }
  | { status: 'not-found' };

/** فهرست کامل کلیدهای سطل (با صفحه‌بندی، تا سقف حفاظتی). */
export async function listAllBucketObjects(): Promise<string[]> {
  const { client, bucket } = getS3Client();
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    });
    const response = await client.send(command);
    for (const object of response.Contents || []) {
      if (object.Key) keys.push(object.Key);
      if (keys.length >= MAX_OBJECTS_TO_SCAN) return keys;
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

/**
 * پیدا کردن snapshot قدیمی: شیء JSON که زیر مسیر دانه‌ای `departments/` نیست
 * و به‌صورت کامل قابل تبدیل به AppDatabaseState است.
 */
export async function findLegacySnapshotObject(): Promise<{
  key: string;
  state: AppDatabaseState;
  notes: string[];
} | null> {
  const { client, bucket, prefix } = getS3Client();
  const granularPath = `${prefix}/departments/`;
  const keys = await listAllBucketObjects();

  // اولویت با کلیدهای ریشه/سطح بالای bucket است (الگوی نسخه‌های قدیمی).
  const candidates = keys
    .filter(key => key.endsWith('.json') && !key.startsWith(granularPath))
    .sort((a, b) => a.length - b.length);

  for (const key of candidates) {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    try {
      const response = await client.send(command);
      if (!response.Body) continue;
      // شیءهای خیلی بزرگ (احتمالاً نامربوط) بدون خواندن بدنه رد می‌شوند.
      if (response.ContentLength !== undefined && response.ContentLength > MAX_LEGACY_READ_BYTES) continue;
      const raw = await response.Body.transformToString();
      if (raw.length > MAX_LEGACY_READ_BYTES) continue;
      const parsed = tryParseAppStateLenient(JSON.parse(raw));
      if (parsed.ok) {
        return { key, state: parsed.state, notes: parsed.notes };
      }
    } catch {
      // شیء نامربوط/خراب را نادیده می‌گیریم و سراغ بعدی می‌رویم.
    }
  }
  return null;
}

/**
 * مهاجرت درجای snapshot قدیمی به اسناد دانه‌ای. فقط وقتی اقدامی می‌کند که
 * `departments/index.json` وجود نداشته باشد (سطل هنوز دانه‌ای نشده).
 */
export async function migrateLegacySnapshotInPlace(): Promise<RecoveryOutcome> {
  const index = await readDepartmentIndexOptional();
  if (index !== null) return { status: 'already-granular' };

  const legacy = await findLegacySnapshotObject();
  if (!legacy) return { status: 'not-found' };

  const { state, notes } = legacy;
  const writtenDepartmentIds: string[] = [];

  for (const department of state.departments) {
    const departmentId = department.id;
    const data = state.deptData[departmentId];

    const baseDocuments: Array<{ resource: any; data: unknown }> = [
      { resource: { type: 'personnel', departmentId }, data: data.personnel },
      { resource: { type: 'requests', departmentId }, data: data.requests },
      {
        resource: { type: 'settings', departmentId },
        data: {
          ...(data.activeYear !== undefined ? { activeYear: data.activeYear } : {}),
          settings_system: data.settings_system,
          settings_credentials: data.settings_credentials,
        },
      },
      { resource: { type: 'holidays', departmentId }, data: data.holidays },
      { resource: { type: 'firstDayOfWeek', departmentId }, data: data.firstDayOfWeek },
    ];

    // اسناد اختیاری سناریو فقط اگر در snapshot بودند نوشته می‌شوند.
    if (data.activeScenarios !== undefined) {
      baseDocuments.push({ resource: { type: 'activeScenarios', departmentId }, data: data.activeScenarios });
    }
    if (data.scenarioVotes !== undefined) {
      baseDocuments.push({ resource: { type: 'scenarioVotes', departmentId }, data: data.scenarioVotes });
    }

    for (const [monthKey, schedule] of Object.entries(data.schedules || {})) {
      baseDocuments.push({ resource: { type: 'schedule', departmentId, monthKey }, data: schedule });
    }

    for (const document of baseDocuments) {
      try {
        await writeResource(document.resource, document.data, null);
      } catch (error) {
        // هم‌زمانی با مهاجرت نمونهٔ دیگر یا سندِ از-قبل-موجود: مسأله نیست.
        if (error instanceof StorageConflictError) continue;
        throw error;
      }
    }
    writtenDepartmentIds.push(departmentId);
  }

  // انتشار index در آخرین مرحله: تا این لحظه هیچ‌کس بخش نیمه‌کاره نمی‌بیند.
  try {
    await writeResource({ type: 'departments' }, state.departments, null);
  } catch (error) {
    if (!(error instanceof StorageConflictError)) throw error;
  }

  console.warn(
    `[storage] snapshot قدیمی (${legacy.key}) به اسناد دانه‌ای مهاجرت شد: ${writtenDepartmentIds.length} بخش.`,
  );
  return { status: 'migrated', departments: writtenDepartmentIds.length, notes };
}
