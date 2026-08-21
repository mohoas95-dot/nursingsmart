import assert from 'node:assert/strict';
import test, { before, beforeEach, mock } from 'node:test';
import {
  getS3Client,
  readDatabaseState,
  __resetCircuitBreakerForTests,
} from '../lib/s3Storage';
import type { StorageResource } from '../lib/storageSchemas';

// مدارشکن state سراسری ماژول است؛ بین تست‌ها بسته می‌شود تا شکست‌های یک تست
// تست بعدی را تحت تأثیر قرار ندهد.
beforeEach(() => {
  __resetCircuitBreakerForTests();
});

/**
 * بازتولید دقیق سناریوی «لاگین موفق ولی خالی ماندن فهرست پرسنل».
 *
 * پس از ورود، صفحهٔ اصلی فقط یک منبع داده دارد: `GET /api/storage`.
 * اگر آن درخواست با ۵۰۳ (پیکربندی S3 ناقص، سطل خالی، سند گم‌شده یا حذف بخش)
 * جواب دهد، کلاینت هیچ پرسنل/برنامه‌ای نشان نمی‌دهد. این فایل همان شکست‌ها را
 * در سطح مسیر واقعی (`app/api/storage/route.ts`) بازتولید می‌کند تا علت
 * «داشبورد خالی پس از ورود» دقیقاً قابل ردیابی باشد.
 */

// ── پیکربندی پایه (در سطح ماژول؛ getS3Config هنگام فراخوانی خوانده می‌شود) ──
const ENV_KEYS = [
  'STORAGE_ENV', 'S3_ENDPOINT', 'S3_REGION',
  'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET_DEVELOPMENT',
] as const;

const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) ORIGINAL_ENV[key] = process.env[key];

function applyBaseConfig() {
  process.env.STORAGE_ENV = 'development';
  process.env.S3_ENDPOINT = 'https://mock.s3.local';
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_ACCESS_KEY_ID = 'mock-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'mock-secret-key';
  process.env.S3_BUCKET_DEVELOPMENT = 'mock-bucket';
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key]!;
  }
}

applyBaseConfig();

const PREFIX = 'nursingsmart/development/v1';
const DEP_ID = 'dep-1';

const DEMAND = {
  morningNurse: 3, morningAssistant: 1,
  afternoonNurse: 2, afternoonAssistant: 1, afternoonLeader: 1,
  nightNurse: 2, nightAssistant: 1, nightLeader: 1,
};

const PERSONNEL = [
  {
    id: 'p-1',
    firstName: 'زهرا',
    lastName: 'احمدی',
    personalCode: '',
    jobGroup: 'nurse',
    position: 'staff',
    employmentType: 'official',
    experienceYears: 5,
    active: true,
    canBeShiftLeader: false,
    orderIndex: 0,
  },
  {
    id: 'p-2',
    firstName: 'علی',
    lastName: 'رضایی',
    personalCode: '',
    jobGroup: 'assistant',
    position: 'general',
    employmentType: 'contract',
    experienceYears: 3,
    active: true,
    canBeShiftLeader: true,
    orderIndex: 1,
  },
];

const SETTINGS_DOC = {
  activeYear: 1404,
  settings_system: {
    dutyHours: { official: 176, contract: 190, conscript: 176, overtime: 0 },
    demand: { weekday: DEMAND, holiday: DEMAND },
  },
  settings_credentials: { username: 'prisma-managed', password: '' },
};

function objectKey(resource: StorageResource): string {
  switch (resource.type) {
    case 'departments': return `${PREFIX}/departments/index.json`;
    case 'personnel': return `${PREFIX}/departments/${resource.departmentId}/personnel.json`;
    case 'requests': return `${PREFIX}/departments/${resource.departmentId}/requests.json`;
    case 'settings': return `${PREFIX}/departments/${resource.departmentId}/settings.json`;
    case 'holidays': return `${PREFIX}/departments/${resource.departmentId}/holidays.json`;
    case 'firstDayOfWeek': return `${PREFIX}/departments/${resource.departmentId}/first-day-of-week.json`;
    case 'schedule': return `${PREFIX}/departments/${resource.departmentId}/schedules/${resource.monthKey}.json`;
    case 'activeScenarios': return `${PREFIX}/departments/${resource.departmentId}/active-scenarios.json`;
    case 'scenarioVotes': return `${PREFIX}/departments/${resource.departmentId}/scenario-votes.json`;
  }
}

/** اسناد سالم یک بخش کاملاً مقداردهی‌شده (همان چیزی که روی‌بوردینگ می‌سازد). */
function healthyDocs(): Record<string, unknown> {
  return {
    [`${PREFIX}/departments/index.json`]: [{ id: DEP_ID, name: 'بخش نمونه' }],
    [`${PREFIX}/departments/${DEP_ID}/personnel.json`]: PERSONNEL,
    [`${PREFIX}/departments/${DEP_ID}/requests.json`]: [],
    [`${PREFIX}/departments/${DEP_ID}/settings.json`]: SETTINGS_DOC,
    [`${PREFIX}/departments/${DEP_ID}/holidays.json`]: {},
    [`${PREFIX}/departments/${DEP_ID}/first-day-of-week.json`]: {},
    [`${PREFIX}/departments/${DEP_ID}/schedules/1404_5.json`]: {
      year: 1404, month: 5, assignments: {}, shiftLeaders: {}, warnings: [],
    },
  };
}

/**
 * S3 ساختگی و حالت‌دار: `GetObject` از نقشهٔ اسناد می‌خواند، `PutObject` با
 * پیش‌شرط‌های IfNoneMatch/IfMatch می‌نویسد (دقیقاً مانند سطل واقعی) و کلید
 * گم‌شده با NoSuchKey (۴۰۴) جواب داده می‌شود.
 * `failList: true` فهرست‌کردن کلیدها را با خطای شبکه شکست می‌دهد (برای
 * شبیه‌سازی موجی که همهٔ عملیاتش خطا می‌دهد و مدارشکن را باز نگه می‌دارد).
 */
function installFakeS3(docs: Record<string, unknown>, options: { failList?: boolean } = {}) {
  const { client } = getS3Client();
  (client as any).send = async (command: any) => {
    const name = command.constructor.name;

    if (name === 'GetObjectCommand') {
      const key: string = command.input.Key;
      const value = docs[key];
      if (value === undefined) {
        const error: any = new Error('NoSuchKey');
        error.$metadata = { httpStatusCode: 404 };
        throw error;
      }
      return {
        ETag: `"etag-${key}"`,
        Body: { transformToString: async () => JSON.stringify(value) },
      };
    }

    if (name === 'ListObjectsV2Command') {
      if (options.failList) {
        const error: any = new Error('NetworkError');
        error.$metadata = { httpStatusCode: 500 };
        throw error;
      }
      const prefix: string | undefined = command.input.Prefix;
      const keys = prefix
        ? Object.keys(docs).filter(key => key.startsWith(prefix))
        : Object.keys(docs);
      return { Contents: keys.map(key => ({ Key: key })), IsTruncated: false };
    }

    if (name === 'PutObjectCommand') {
      const key: string = command.input.Key;
      const ifNoneMatch = command.input.IfNoneMatch;
      const ifMatch = command.input.IfMatch;
      if (ifNoneMatch === '*' && docs[key] !== undefined) {
        const error: any = new Error('PreconditionFailed');
        error.$metadata = { httpStatusCode: 412 };
        throw error;
      }
      if (ifMatch !== undefined && docs[key] !== undefined && `"etag-${key}"` !== ifMatch) {
        const error: any = new Error('PreconditionFailed');
        error.$metadata = { httpStatusCode: 412 };
        throw error;
      }
      docs[key] = JSON.parse(command.input.Body);
      return { ETag: `"etag-${key}"`, VersionId: 'ver-1' };
    }

    throw new Error(`Unexpected command: ${name}`);
  };
}

// ── تست‌های سطح لایهٔ ذخیره‌سازی (بدون نیاز به module mocking) ────────────────

test('storage: missing S3 configuration throws StorageConfigurationError (علت داشبورد خالی)', () => {
  restoreEnv();
  try {
    assert.throws(
      () => getS3Client(),
      (error: any) => error.name === 'StorageConfigurationError',
    );
  } finally {
    applyBaseConfig();
  }
});

test('storage: سطل خالی (حتی بدون departments/index.json) → خطای در دسترس‌نبودن', async () => {
  installFakeS3({});
  await assert.rejects(
    () => readDatabaseState(),
    (error: any) => error.name === 'StorageUnavailableError',
  );
});

test('storage: بخشی که سند personnel ندارد → خطای در دسترس‌نبودن', async () => {
  const docs = healthyDocs();
  delete docs[`${PREFIX}/departments/${DEP_ID}/personnel.json`];
  installFakeS3(docs);
  await assert.rejects(
    () => readDatabaseState(),
    (error: any) => error.name === 'StorageUnavailableError',
  );
});

test('storage: بخش حساب کاربر از فهرست سطل حذف شده → خطای در دسترس‌نبودن', async () => {
  installFakeS3(healthyDocs());
  await assert.rejects(
    () => readDatabaseState({ departmentIds: ['dep-deleted'] }),
    (error: any) =>
      error.name === 'StorageUnavailableError' &&
      /does not exist in storage/.test(error.message),
  );
});

// ── تست‌های سطح مسیر واقعی GET /api/storage (نیازمند module mocking) ──────────

const moduleMocksSupported = typeof (mock as { module?: unknown }).module === 'function';

/**
 * جایگزینی ماژول نشست: `requireCurrentUser` را بدون نیاز به پایگاه داده شبیه‌سازی
 * می‌کند تا خودِ مسیر ذخیره‌سازی (نه احراز هویت) تست شود.
 */
let mockedActor: {
  role: 'ADMIN' | 'HEAD_NURSE' | 'PERSONNEL';
  departmentId: string | null;
} = { role: 'ADMIN', departmentId: null };

let routeGet: ((req: any) => Promise<Response>) | null = null;

if (moduleMocksSupported) {
  // جایگزینی ماژول نشست باید پیش از اولین import مسیر انجام شود؛ در غیر این
  // صورت مسیر، `requireCurrentUser` واقعی (نیازمند پایگاه داده) را می‌گیرد.
  before(async () => {
    await mock.module(new URL('../lib/auth/session.ts', import.meta.url).href, {
      namedExports: {
        requireCurrentUser: async () => ({
          id: 'u-1',
          nationalId: '0010000001',
          firstName: 'کاربر',
          lastName: 'تست',
          role: mockedActor.role,
          departmentId: mockedActor.departmentId,
          personnelId: null,
          mustChangePassword: false,
        }),
        AuthenticationError: class AuthenticationError extends Error {
          readonly status: number;
          constructor(status: number, message: string) {
            super(message);
            this.status = status;
          }
        },
      },
    });
    const { GET } = await import('../app/api/storage/route');
    routeGet = GET;
  });
}

const routeTestOptions = moduleMocksSupported
  ? {}
  : { skip: 'نیازمند node --experimental-test-module-mocks است' };

test('GET /api/storage: سطل سالم → 200 با پرسنل و برنامه (مسیر موفق)', routeTestOptions, async () => {
  assert.ok(routeGet, 'route not loaded');
  installFakeS3(healthyDocs());
  mockedActor = { role: 'ADMIN', departmentId: null };

  const { NextRequest } = await import('next/server');
  const response = await routeGet!(
    new NextRequest('http://localhost/api/storage?months=1404_5,1404_6'),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.state.departments.length, 1);
  assert.equal(body.state.deptData[DEP_ID].personnel.length, 2);
  assert.equal(body.state.deptData[DEP_ID].personnel[0].firstName, 'زهرا');
  assert.ok(body.state.deptData[DEP_ID].schedules['1404_5']);
  assert.ok(body.versions['department:dep-1:personnel']);
});

test('GET /api/storage: پیکربندی S3 روی سرور تعریف نشده → 503 STORAGE_UNAVAILABLE', routeTestOptions, async () => {
  assert.ok(routeGet, 'route not loaded');
  const { NextRequest } = await import('next/server');
  restoreEnv();
  try {
    const response = await routeGet!(
      new NextRequest('http://localhost/api/storage?months=1404_5'),
    );
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'STORAGE_UNAVAILABLE');
    assert.equal(body.retryable, false);
    assert.match(body.error, /STORAGE_ENV/);
  } finally {
    applyBaseConfig();
  }
});

test('GET /api/storage: سطل خالی (بدون index) → 503 STORAGE_UNAVAILABLE', routeTestOptions, async () => {
  assert.ok(routeGet, 'route not loaded');
  installFakeS3({});
  mockedActor = { role: 'ADMIN', departmentId: null };
  const { NextRequest } = await import('next/server');
  const response = await routeGet!(
    new NextRequest('http://localhost/api/storage?months=1404_5'),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'STORAGE_UNAVAILABLE');
});

test('GET /api/storage: بخش حساب کاربر در سطل وجود ندارد → 503', routeTestOptions, async () => {
  assert.ok(routeGet, 'route not loaded');
  installFakeS3(healthyDocs());
  mockedActor = { role: 'HEAD_NURSE', departmentId: 'dep-deleted' };
  const { NextRequest } = await import('next/server');
  const response = await routeGet!(
    new NextRequest('http://localhost/api/storage?months=1404_5'),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'STORAGE_UNAVAILABLE');
  assert.match(body.error, /does not exist in storage/);
});

test('GET /api/storage: اسناد پایهٔ بخش گم شده → 503 STORAGE_UNAVAILABLE', routeTestOptions, async () => {
  assert.ok(routeGet, 'route not loaded');
  // سطل «نیمه‌مقداردهی‌شده»: index بخش هست ولی هیچ سند پایه‌ای (personnel,
  // requests, settings, ...) وجود ندارد — مثلاً بعد از ساخت دستی index یا
  // مهاجرت ناقص. هر سند گم‌شده یک شکست ذخیره‌سازی ثبت می‌کند. فهرست کلیدها هم
  // شکست می‌خورد تا هیچ عملیات موفقی مدارشکن را نبندد (هر موفقیتِ هم‌زمان در
  // موج، شکست‌ها را صفر می‌کند).
  const docs = healthyDocs();
  for (const key of Object.keys(docs)) {
    if (key.includes(`/departments/${DEP_ID}/`) && !key.includes('/schedules/')) {
      delete docs[key];
    }
  }
  installFakeS3(docs, { failList: true });
  mockedActor = { role: 'ADMIN', departmentId: null };
  const { NextRequest } = await import('next/server');
  const response = await routeGet!(
    new NextRequest('http://localhost/api/storage?months=1404_5'),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'STORAGE_UNAVAILABLE');
});

test('GET /api/storage: سند personnel با قالب قدیمی → 200 + legacyNormalizedResources', routeTestOptions, async () => {
  assert.ok(routeGet, 'route not loaded');
  const docs = healthyDocs();
  // سند نوشته‌شده توسط نسخهٔ قدیمی: فیلدهای جدید ندارد و کلید ناشناخته دارد.
  docs[`${PREFIX}/departments/${DEP_ID}/personnel.json`] = [
    {
      id: 'p-1',
      firstName: 'زهرا',
      lastName: 'احمدی',
      personalCode: '123',
      jobGroup: 'nurse',
      experienceYears: '5', // رشته در دادهٔ قدیمی
      active: true,
      phone: '0912...', // کلید ناشناخته
    },
  ];
  installFakeS3(docs);
  mockedActor = { role: 'ADMIN', departmentId: null };
  const { NextRequest } = await import('next/server');
  const response = await routeGet!(
    new NextRequest('http://localhost/api/storage?months=1404_5'),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  // پرسنل با پیش‌فرض‌های امن لود می‌شود:
  const person = body.state.deptData[DEP_ID].personnel[0];
  assert.equal(person.firstName, 'زهرا');
  assert.equal(person.employmentType, 'official');
  assert.equal(person.position, 'staff');
  assert.equal(person.phone, undefined);
  // و پرچم قالب قدیمی به کلاینت اعلام می‌شود:
  assert.ok(Array.isArray(body.legacyNormalizedResources));
  assert.ok(body.legacyNormalizedResources.includes('department:dep-1:personnel'));
});

test('GET /api/storage: سطل فقط snapshot قدیمی دارد → مهاجرت خودکار و بارگذاری موفق', routeTestOptions, async () => {
  assert.ok(routeGet, 'route not loaded');
  // سطل نسخهٔ قدیمی: فقط یک شیء تک‌فایله با کل state (بدون اسناد دانه‌ای).
  const legacySnapshot = {
    version: 'legacy',
    departments: [{ id: DEP_ID, name: 'بخش نمونه' }],
    deptData: {
      [DEP_ID]: {
        personnel: [
          {
            id: 'p-1',
            firstName: 'مریم',
            lastName: 'محمدی',
            jobGroup: 'nurse',
            // فیلدهای جدید گم‌شده — باید با پیش‌فرض لود شوند
          },
        ],
        requests: [],
        settings_system: {
          dutyHours: { official: 176, contract: 190 },
          demand: {
            weekday: { morningNurse: 3, morningAssistant: 1, afternoonNurse: 2, afternoonAssistant: 1, afternoonLeader: 1, nightNurse: 2, nightAssistant: 1, nightLeader: 1 },
            holiday: { morningNurse: 3, morningAssistant: 1, afternoonNurse: 2, afternoonAssistant: 1, afternoonLeader: 1, nightNurse: 2, nightAssistant: 1, nightLeader: 1 },
          },
        },
        settings_credentials: { username: 'x', password: '' },
        holidays: {},
        firstDayOfWeek: {},
        schedules: {},
      },
    },
  };
  // کلید snapshot قدیمی: خارج از مسیر دانه‌ای (مثلاً ریشهٔ محیط، بدون /v1).
  const docs: Record<string, unknown> = {
    'nursingsmart/development/database.json': legacySnapshot,
  };
  installFakeS3(docs);
  mockedActor = { role: 'ADMIN', departmentId: null };
  const { NextRequest } = await import('next/server');
  const response = await routeGet!(
    new NextRequest('http://localhost/api/storage?months=1404_5'),
  );
  assert.equal(response.status, 200, (await response.clone().json())?.error || '');
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.state.departments.length, 1);
  const person = body.state.deptData[DEP_ID].personnel[0];
  assert.equal(person.firstName, 'مریم');
  assert.equal(person.employmentType, 'official');
  // اسناد دانه‌ای باید ساخته شده باشند:
  assert.ok(docs[`${PREFIX}/departments/index.json`], 'index ساخته نشد');
  assert.ok(docs[`${PREFIX}/departments/${DEP_ID}/personnel.json`], 'personnel.json ساخته نشد');
});

test('GET /api/storage: سه شکست پیدرپی → مدارشکن باز می‌شود (503 با circuit=open)', routeTestOptions, async () => {
  assert.ok(routeGet, 'route not loaded');
  // موجی که همهٔ عملیاتش خطا می‌دهد: بیش از ۳ شکست، مدارشکن را باز می‌کند.
  const docs = healthyDocs();
  for (const key of Object.keys(docs)) {
    if (key.includes(`/departments/${DEP_ID}/`) && !key.includes('/schedules/')) {
      delete docs[key];
    }
  }
  installFakeS3(docs, { failList: true });
  mockedActor = { role: 'ADMIN', departmentId: null };
  const { NextRequest } = await import('next/server');
  const response = await routeGet!(
    new NextRequest('http://localhost/api/storage?months=1404_5'),
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, 'STORAGE_UNAVAILABLE');
  assert.equal(body.circuit, 'open');
  assert.ok(response.headers.get('Retry-After'));
});
