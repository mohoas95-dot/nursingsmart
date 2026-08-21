/**
 * مهاجرت snapshot قدیمیِ داخل سطل به اسناد دانه‌ای — `npm run storage:migrate:s3`
 * ---------------------------------------------------------------------------
 * همان کاری که `storage:migrate` با فایل محلی می‌کند، اما snapshot را از داخل
 * خود سطل S3 پیدا می‌کند؛ پس هیچ نیازی به دانلود/آپلود دستی یا کنسول آروان نیست.
 *
 * ایمنی: همهٔ نوشتن‌ها create-only هستند (If-None-Match: *) و index آخر از همه
 * منتشر می‌شود. اگر سندِ دانه‌ای از قبل وجود داشته باشد، دست‌نخورده می‌ماند.
 *
 * کاربرد:
 *   STORAGE_ENV=production npm run storage:migrate:s3
 */
import {
  migrateLegacySnapshotInPlace,
} from '../lib/legacy-recovery';
import { getS3Client, StorageConfigurationError } from '../lib/s3Storage';

async function main() {
  let config;
  try {
    config = getS3Client();
  } catch (error) {
    if (error instanceof StorageConfigurationError) {
      console.error(`❌ پیکربندی S3 ناقص است: ${error.message}`);
      console.error('ابتدا متغیرهای STORAGE_ENV و S3_* را تعریف کنید (به scripts/check-storage.ts مراجعه کنید).');
      process.exitCode = 2;
      return;
    }
    throw error;
  }
  console.log(`محیط: ${config.environment} | سطل: ${config.bucket}`);

  const outcome = await migrateLegacySnapshotInPlace();
  if (outcome.status === 'already-granular') {
    console.log('ℹ️  اسناد دانه‌ای از قبل وجود دارند؛ مهاجرتی لازم نیست.');
    return;
  }
  if (outcome.status === 'not-found') {
    console.log('❌ snapshot قدیمی‌ای داخل سطل پیدا نشد. اگر دادهٔ قدیمی به‌صورت فایل پشتیبان دارید:');
    console.log('   STORAGE_ENV=<env> MIGRATION_SOURCE_FILE=./legacy.json npm run storage:migrate');
    process.exitCode = 1;
    return;
  }
  console.log(`✅ مهاجرت انجام شد: ${outcome.departments} بخش به اسناد دانه‌ای تبدیل شدند.`);
  if (outcome.notes.length > 0) {
    console.log('\nنکته‌های نرمال‌سازی (تغییرهای پیشنهادی روی داده):');
    for (const note of outcome.notes.slice(0, 20)) console.log(`  - ${note}`);
  }
  console.log('\nحالا صفحهٔ اصلی را تازه‌سازی کنید؛ بارگذاری باید موفق باشد.');
}

main().catch(error => {
  console.error('\nخطای غیرمنتظره:', error);
  process.exitCode = 1;
});
