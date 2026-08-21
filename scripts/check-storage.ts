/**
 * عیب‌یاب ذخیره‌سازی ابری — `npm run storage:check`
 * ---------------------------------------------------------------------------
 * بدون نیاز به کنسول S3/آروان، محتوای سطل را با همان پیکربندیِ خودِ برنامه
 * بررسی می‌کند و دقیقاً می‌گوید کدام سند هست/نیست/معتبر است/قدیمی است/خراب است
 * و چه اقدامی پیشنهاد می‌شود. فقط خواندنی است و هیچ چیزی نمی‌نویسد.
 *
 * کاربرد:
 *   STORAGE_ENV=production npm run storage:check
 */
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  getS3Client,
  getCircuitBreakerStatus,
  StorageConfigurationError,
} from '../lib/s3Storage';
import {
  DepartmentsSchema,
  PersonnelListSchema,
  RequestsSchema,
  DepartmentSettingsSchema,
  HolidaysSchema,
  FirstDayOfWeekSchema,
  MonthlyScheduleSchema,
  schemaForResource,
  type StorageResource,
} from '../lib/storageSchemas';
import { normalizeDocumentFor } from '../lib/legacy-compat';
import { listAllBucketObjects, findLegacySnapshotObject } from '../lib/legacy-recovery';

const RESOURCE_LABEL: Record<StorageResource['type'], string> = {
  departments: 'فهرست بخش‌ها (index)',
  personnel: 'پرسنل',
  requests: 'درخواست‌ها',
  settings: 'تنظیمات',
  holidays: 'تعطیلات/ساعت موظفی',
  firstDayOfWeek: 'اول هفته',
  schedule: 'برنامهٔ ماهانه',
  activeScenarios: 'سناریوهای فعال',
  scenarioVotes: 'آرای سناریو',
};

const RESOURCE_SCHEMA = {
  departments: DepartmentsSchema,
  personnel: PersonnelListSchema,
  requests: RequestsSchema,
  settings: DepartmentSettingsSchema,
  holidays: HolidaysSchema,
  firstDayOfWeek: FirstDayOfWeekSchema,
  schedule: MonthlyScheduleSchema,
} as const;

function verdict(status: 'ok' | 'warn' | 'error', text: string) {
  const icon = status === 'ok' ? '✅' : status === 'warn' ? '⚠️' : '❌';
  console.log(`  ${icon} ${text}`);
}

async function main() {
  console.log('── عیب‌یاب ذخیره‌سازی ابری NursingSmart ──────────────────────');
  let config;
  try {
    config = getS3Client();
  } catch (error) {
    if (error instanceof StorageConfigurationError) {
      console.error(`\n❌ پیکربندی S3 ناقص است: ${error.message}`);
      console.error('\nمتغیرهای محیطی لازم (روی سرور/ورسل باید تعریف شوند):');
      console.error('  STORAGE_ENV=development|staging|production   ← بدون مقدار پیش‌فرض');
      console.error('  S3_ENDPOINT=...  (مثلاً https://s3.ir-thr-at1.arvanstorage.ir)');
      console.error('  S3_REGION=...  S3_ACCESS_KEY_ID=...  S3_SECRET_ACCESS_KEY=...');
      console.error('  S3_BUCKET_DEVELOPMENT / S3_BUCKET_STAGING / S3_BUCKET_PRODUCTION');
      console.error('\nراه‌حل: این متغیرها را در تنظیمات محیط استقرار (Vercel → Settings → Environment Variables) تعریف کنید.');
      process.exitCode = 2;
      return;
    }
    throw error;
  }

  const { bucket, prefix, environment } = config;
  console.log(`\nمحیط: ${environment} | سطل: ${bucket}`);
  console.log(`prefix: ${prefix}`);

  const circuit = getCircuitBreakerStatus();
  if (circuit.state === 'open') {
    verdict('error', `مدارشکن ذخیره‌سازی باز است (${circuit.failures} شکست) — چند لحظه صبر کنید یا سرور را ری‌استارت کنید.`);
  }

  console.log('\n── فهرست اشیاء سطل ────────────────────────────────────────────');
  const keys = await listAllBucketObjects();
  if (keys.length === 0) {
    verdict('error', 'سطل کاملاً خالی است!');
    console.log('\nاگر نسخهٔ قبلی سامانه از snapshot تک‌فایله استفاده می‌کرد، آن شیء هم اینجا نیست.');
    console.log('  → اگر دادهٔ قبلی جایی پشتیبان دارد، ابتدا آن را بازیابی کنید؛');
    console.log('  → سپس برای ساخت اسناد دانه‌ای از snapshot:  STORAGE_ENV=<env> MIGRATION_SOURCE_FILE=./legacy.json npm run storage:migrate');
    console.log('  → یا اگر snapshot داخل همین سطل است:       npm run storage:migrate:s3');
    process.exitCode = 1;
    return;
  }
  console.log(`  ${keys.length} شیء یافت شد (تا سقف ۲۰۰۰).`);
  const sample = keys.slice(0, 15).map(key => `    ${key}`);
  if (sample.length) console.log(sample.join('\n'));
  if (keys.length > 15) console.log('    …');

  console.log('\n── اسناد دانه‌ای ───────────────────────────────────────────────');
  const { client } = config;

  async function inspect(resource: StorageResource) {
    const key = resource.type === 'departments'
      ? `${prefix}/departments/index.json`
      : `${prefix}/departments/${resource.departmentId}/${resource.type === 'schedule'
          ? `schedules/${resource.monthKey}.json`
          : `${resource.type}.json`}`;
    if (!keys.includes(key)) {
      verdict('error', `گم شده: ${key} (${RESOURCE_LABEL[resource.type]})`);
      return;
    }
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const raw = await response.Body!.transformToString();
      const json: unknown = JSON.parse(raw);
      const schema = RESOURCE_SCHEMA[resource.type as keyof typeof RESOURCE_SCHEMA] ?? schemaForResource(resource);
      const strict = schema.safeParse(json);
      if (strict.success) {
        verdict('ok', `${key} — معتبر است`);
        return;
      }
      const normalized = normalizeDocumentFor(resource, json);
      if (normalized.ok) {
        const reparsed = schema.safeParse(normalized.data);
        if (reparsed.success) {
          verdict('warn', `${key} — قالب قدیمی دارد؛ با نرمال‌سازی خواندنی است (${normalized.notes.length ? `مثال: ${normalized.notes[0]}` : 'فیلدهای ناشناخته/گم‌شده'})`);
          return;
        }
      }
      const firstIssues = strict.error.issues.slice(0, 3).map(i => i.message).join(' | ');
      verdict('error', `${key} — خراب/نامعتبر است: ${firstIssues}`);
    } catch (error) {
      verdict('error', `${key} — خواندن ناموفق: ${(error as Error).message}`);
    }
  }

  // index بخش‌ها
  const indexKey = `${prefix}/departments/index.json`;
  if (!keys.includes(indexKey)) {
    verdict('error', `گم شده: ${indexKey} — اسناد دانه‌ای هنوز ساخته نشده‌اند.`);
  } else {
    await inspect({ type: 'departments' });
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: indexKey }));
      const departments = DepartmentsSchema.parse(JSON.parse(await response.Body!.transformToString()));
      for (const department of departments) {
        console.log(`\nبخش «${department.name}» (${department.id}):`);
        for (const type of ['personnel', 'requests', 'settings', 'holidays', 'firstDayOfWeek'] as const) {
          await inspect({ type, departmentId: department.id } as StorageResource);
        }
        // برنامه‌های ماهانه
        const schedulePrefix = `${prefix}/departments/${department.id}/schedules/`;
        const scheduleKeys = keys.filter(key => key.startsWith(schedulePrefix)).sort();
        if (scheduleKeys.length === 0) {
          verdict('warn', 'هیچ برنامهٔ ماهانه‌ای وجود ندارد (اگر تازه شروع کرده‌اید طبیعی است).');
        }
        for (const scheduleKey of scheduleKeys) {
          const monthKey = scheduleKey.slice(schedulePrefix.length, -'.json'.length);
          await inspect({ type: 'schedule', departmentId: department.id, monthKey } as StorageResource);
        }
      }
    } catch (error) {
      console.error('خواندن index بخش‌ها ناموفق بود:', (error as Error).message);
    }
  }

  console.log('\n── snapshot قدیمی (قالب تک‌فایله) ──────────────────────────────');
  const legacy = await findLegacySnapshotObject();
  if (legacy) {
    verdict('warn', `snapshot قدیمی یافت شد: ${legacy.key} (${legacy.state.departments.length} بخش)`);
    console.log('  اگر بارگذاری فعلاً با خطا مواجه است، دستور زیر آن را به اسناد دانه‌ای تبدیل می‌کند:');
    console.log(`    STORAGE_ENV=${environment} npm run storage:migrate:s3`);
  } else {
    verdict('ok', 'snapshot قدیمی‌ای در سطل پیدا نشد.');
  }

  console.log('\n── جمع‌بندی ─────────────────────────────────────────────────────');
  if (!keys.includes(indexKey)) {
    console.log('❌ نتیجه: اسناد دانه‌ای ساخته نشده‌اند. این علت اصلی «داشبورد خالی» است.');
    console.log('   اقدام: ۱) اگر snapshot قدیمی داخل سطل است → npm run storage:migrate:s3');
    console.log('          ۲) اگر سطل خالی است → داده را از پشتیبان بازیابی کنید و با MIGRATION_SOURCE_FILE مهاجرت دهید.');
    process.exitCode = 1;
  } else {
    console.log('✅ نتیجه: ساختار دانه‌ای سطل برقرار است. اگر باز هم بارگذاری نمی‌شود،');
    console.log('   علت را در خطاهای بالا (❌) یا در بنر قرمز صفحهٔ اصلی ببینید.');
  }
}

main().catch(error => {
  console.error('\nخطای غیرمنتظره:', error);
  process.exitCode = 1;
});
