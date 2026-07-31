import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * نگهبان کیفیت تصویر در مسیر Vision API — طبق دستورالعمل OCR جدول‌های شیفت:
 *
 *   ۱. پی‌لود image_url باید با detail:"high" ارسال شود (پیش‌فرض «auto» باعث
 *      اسکیل‌داون تصویر و از دست رفتن متن ریز سلول‌ها می‌شود).
 *   ۲. فرانت‌اند هرگز تصویر را با کیفیت کمتر از ۰٫۸۵ فشرده نمی‌کند و
 *      حداکثر ابعاد ۲۰۴۸px را رعایت می‌کند (بدون ریزایز شدید).
 *
 * این تست جلوی بازگشت به detail:"auto" یا فشرده‌سازی تهاجمی را می‌گیرد.
 */

async function loadOpenRouterModule(detail?: string) {
  const saved = process.env.OPENROUTER_VISION_IMAGE_DETAIL;
  if (detail === undefined) delete process.env.OPENROUTER_VISION_IMAGE_DETAIL;
  else process.env.OPENROUTER_VISION_IMAGE_DETAIL = detail;
  try {
    return await import(`../lib/ai/openrouter.ts?detail=${Date.now()}-${Math.random()}`);
  } finally {
    if (saved === undefined) delete process.env.OPENROUTER_VISION_IMAGE_DETAIL;
    else process.env.OPENROUTER_VISION_IMAGE_DETAIL = saved;
  }
}

test('پیش‌فرض کیفیت تصویر Vision باید "high" باشد', async () => {
  const { VISION_IMAGE_DETAIL } = await loadOpenRouterModule(undefined);
  assert.equal(
    VISION_IMAGE_DETAIL,
    'high',
    `پارامتر detail پی‌لود تصویر باید پیش‌فرض "high" باشد تا OCR جدول با بالاترین کیفیت انجام شود، اما «${VISION_IMAGE_DETAIL}» یافت شد.`,
  );
});

test('مقدار محیطی معتبر (low/auto) باید قابل override باشد و مقدار نامعتبر به "high" برگردد', async () => {
  const low = await loadOpenRouterModule('low');
  assert.equal(low.VISION_IMAGE_DETAIL, 'low');

  const auto = await loadOpenRouterModule('auto');
  assert.equal(auto.VISION_IMAGE_DETAIL, 'auto');

  const invalid = await loadOpenRouterModule('ultra');
  assert.equal(invalid.VISION_IMAGE_DETAIL, 'high', 'مقدار نامعتبر OPENROUTER_VISION_IMAGE_DETAIL باید به "high" برگردد.');
});

test('پی‌لود تصویر ساخته‌شده باید detail را در ساختار image_url داشته باشد', async () => {
  // ساختار پی‌لود در generateOpenRouterVision باید دقیقاً به شکل زیر باشد:
  //   { "type": "image_url", "image_url": { "url": "data:...;base64,...", "detail": "high" } }
  // این تست با خواندن سورس، حضور پارامتر detail را در مسیر Vision تضمین می‌کند.
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../lib/ai/openrouter.ts', import.meta.url), 'utf-8');
  assert.ok(
    /image_url:\s*\{[\s\S]*?detail:/.test(source),
    'در ساخت پی‌لود image_url پارامتر detail پیدا نشد — پی‌لود باید شامل "detail": "high" باشد.',
  );
});

test('ثابت‌های فرانت‌اند: حداکثر ۲۰۴۸px و کیفیت JPEG هرگز زیر ۰٫۸۵ نباشد', async () => {
  const imageFile = await import(`../lib/image-file.ts?quality=${Date.now()}`);
  assert.equal(
    imageFile.VISION_IMAGE_MAX_DIMENSION,
    2048,
    `حداکثر ابعاد تصویر باید ۲۰۴۸ پیکسل باشد، اما «${imageFile.VISION_IMAGE_MAX_DIMENSION}» یافت شد.`,
  );
  assert.ok(
    imageFile.VISION_JPEG_MIN_QUALITY >= 0.85,
    `کف کیفیت JPEG نباید کمتر از ۰٫۸۵ باشد، اما «${imageFile.VISION_JPEG_MIN_QUALITY}» بود.`,
  );
  assert.ok(
    imageFile.VISION_JPEG_TARGET_QUALITY >= imageFile.VISION_JPEG_MIN_QUALITY,
    'کیفیت هدف باید بزرگ‌تر یا مساوی کف کیفیت باشد.',
  );
  assert.equal(typeof imageFile.prepareImageForVisionUpload, 'function', 'تابع prepareImageForVisionUpload باید وجود داشته باشد.');
});

test('پرامپت OCR جدول باید سه قانون اکید را داشته باشد (ستون‌به‌ستون، [نامفهوم]، JSON پروژه)', async () => {
  const { readFileSync } = await import('node:fs');
  const route = readFileSync(new URL('../app/api/ai/parse-image-request/route.ts', import.meta.url), 'utf-8');
  assert.ok(
    route.includes('تو یک سیستم حرفه‌ای OCR و استخراج داده از جدول‌های شیفت پرستاری هستی'),
    'هستهٔ فارسی پرامپت OCR در مسیر parse-image-request پیدا نشد.',
  );
  assert.ok(route.includes('[نامفهوم]'), 'قانون علامت‌گذاری [نامفهوم] در پرامپت وجود ندارد.');
  assert.ok(route.includes('ستون به ستون و سطر به سطر'), 'قانون خوانش ستون‌به‌ستون در پرامپت وجود ندارد.');
});

test('قانون اعداد: آیتم needsClarification با روزهای خوانده‌شده حذف نمی‌شود و بدون شیفت می‌ماند', async () => {
  const { normalizeShiftRequestList } = await import(`../lib/ai/shift-request-normalizer.ts?nc=${Date.now()}`);

  // ۱) الگوی اصلی: کلمهٔ شیفت [نامفهوم] ولی اعداد روزها خوانده شده — باید حفظ شود
  const clarificationCase = normalizeShiftRequestList(
    [
      {
        requestType: 'shift',
        scope: 'custom_days',
        selectedDays: [5, 8, 12],
        needsClarification: true,
        description: 'روزهای ۵اُم و ۸اُم و ۱۲اُم خوانده شد؛ نوع شیفت [نامفهوم] است',
      },
    ],
    31,
  );
  assert.equal(clarificationCase.droppedCount, 0, 'آیتم needsClarification نباید حذف شود — اعداد خوانده‌شده باید بمانند');
  assert.equal(clarificationCase.requests.length, 1);
  assert.equal(clarificationCase.requests[0].needsClarification, true);
  assert.equal(clarificationCase.requests[0].preferredShift, undefined, 'آیتم [نامفهوم] نباید شیفت حدسی داشته باشد');
  assert.deepEqual(clarificationCase.requests[0].selectedDays, [5, 8, 12]);
  assert.equal(clarificationCase.requests[0].scope, 'custom_days');

  // ۲) needsClarification بدون عدد خوانده‌شده → حذف (فایده‌ای ندارد)
  const noDays = normalizeShiftRequestList(
    [{ requestType: 'shift', scope: 'custom_days', needsClarification: true }],
    31,
  );
  assert.equal(noDays.droppedCount, 1, 'needsClarification بدون روز باید حذف شود');

  // ۳) آیتم معمولی بدون شیفت و بدون پرچم needsClarification → همچنان حذف (قانون قبلی)
  const normalDropped = normalizeShiftRequestList(
    [{ requestType: 'shift', scope: 'custom_days', selectedDays: [5] }],
    31,
  );
  assert.equal(normalDropped.droppedCount, 1, 'شیفت نامشخص بدون پرچم needsClarification باید حذف شود');
});
