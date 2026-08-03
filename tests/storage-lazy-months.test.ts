import assert from 'node:assert/strict';
import test from 'node:test';
import { getS3Client, readDatabaseState } from '../lib/s3Storage';

// پیکربندی حداقلی. getS3Config در زمان فراخوانی خوانده می‌شود (نه هنگام import)،
// پس تنظیم آن در سطح ماژول کافی است.
process.env.STORAGE_ENV = 'development';
process.env.S3_ENDPOINT = 'https://mock.s3.local';
process.env.S3_REGION = 'us-east-1';
process.env.S3_ACCESS_KEY_ID = 'mock-access-key';
process.env.S3_SECRET_ACCESS_KEY = 'mock-secret-key';
process.env.S3_BUCKET_DEVELOPMENT = 'mock-bucket';

const DEPARTMENT_ID = 'dep-1';
const ALL_MONTHS = ['1403_10', '1403_11', '1403_12', '1404_1', '1404_2', '1404_3'];

const DEMAND = {
  morningNurse: 3, morningAssistant: 1,
  afternoonNurse: 2, afternoonAssistant: 1, afternoonLeader: 1,
  nightNurse: 2, nightAssistant: 1, nightLeader: 1,
};

const SETTINGS_DOC = {
  activeYear: 1404,
  settings_system: {
    dutyHours: { official: 176, contract: 190, conscript: 176, overtime: 0 },
    demand: { weekday: DEMAND, holiday: DEMAND },
  },
  settings_credentials: { username: 'prisma-managed', password: '' },
};

function scheduleDoc(monthKey: string) {
  const [year, month] = monthKey.split('_').map(Number);
  return { year, month, assignments: {}, shiftLeaders: {}, warnings: [] };
}

/**
 * S3 ساختگی که هر `GetObject` را می‌شمارد.
 * این شمارنده معیار واقعی ماست: تعداد رفت‌وبرگشت‌های شبکه در بارگذاری اولیه.
 */
function installFakeS3() {
  const { client } = getS3Client();
  const fetchedKeys: string[] = [];

  (client as any).send = async (command: any) => {
    const name = command.constructor.name;

    if (name === 'ListObjectsV2Command') {
      return {
        Contents: ALL_MONTHS.map(monthKey => ({
          Key: `${command.input.Prefix}${monthKey}.json`,
        })),
        IsTruncated: false,
      };
    }

    if (name === 'GetObjectCommand') {
      const key: string = command.input.Key;
      fetchedKeys.push(key);

      const body = (value: unknown) => ({
        ETag: `"etag-${key}"`,
        Body: { transformToString: async () => JSON.stringify(value) },
      });

      if (key.endsWith('/departments/index.json')) {
        return body([{ id: DEPARTMENT_ID, name: 'بخش نمونه' }]);
      }
      if (key.endsWith('/personnel.json')) return body([]);
      if (key.endsWith('/requests.json')) return body([]);
      if (key.endsWith('/settings.json')) return body(SETTINGS_DOC);
      if (key.endsWith('/holidays.json')) return body({});
      if (key.endsWith('/first-day-of-week.json')) return body({});
      if (key.endsWith('/active-scenarios.json')) return body({});
      if (key.endsWith('/scenario-votes.json')) return body({});

      const scheduleMatch = key.match(/\/schedules\/(\d{4}_\d{1,2})\.json$/);
      if (scheduleMatch) return body(scheduleDoc(scheduleMatch[1]));
    }

    throw new Error(`Unexpected command: ${name} ${JSON.stringify(command.input)}`);
  };

  return {
    fetchedKeys,
    scheduleFetchCount: () => fetchedKeys.filter(key => key.includes('/schedules/')).length,
  };
}

// ===========================================================================
// بارگذاری تنبل ماه‌ها
// ===========================================================================

test('بدون تعیین ماه، همهٔ برنامه‌ها خوانده می‌شوند (سازگاری عقب‌رو)', async () => {
  const s3 = installFakeS3();
  const result = await readDatabaseState({ departmentIds: [DEPARTMENT_ID] });

  assert.equal(s3.scheduleFetchCount(), ALL_MONTHS.length);
  assert.deepEqual(
    Object.keys(result.state.deptData[DEPARTMENT_ID].schedules).sort(),
    [...ALL_MONTHS].sort(),
  );
});

test('با تعیین ماه، فقط همان ماه‌ها دانلود می‌شوند', async () => {
  const s3 = installFakeS3();
  const window = ['1403_12', '1404_1', '1404_2'];
  const result = await readDatabaseState({
    departmentIds: [DEPARTMENT_ID],
    monthKeys: window,
  });

  assert.equal(s3.scheduleFetchCount(), 3, 'فقط سه سند برنامه باید خوانده شود');
  assert.deepEqual(
    Object.keys(result.state.deptData[DEPARTMENT_ID].schedules).sort(),
    [...window].sort(),
  );
});

test('پنجرهٔ کوچک، تعداد رفت‌وبرگشت‌ها را واقعاً کم می‌کند', async () => {
  const full = installFakeS3();
  await readDatabaseState({ departmentIds: [DEPARTMENT_ID] });
  const fullCount = full.fetchedKeys.length;

  const scoped = installFakeS3();
  await readDatabaseState({ departmentIds: [DEPARTMENT_ID], monthKeys: ['1404_1'] });
  const scopedCount = scoped.fetchedKeys.length;

  assert.ok(
    scopedCount < fullCount,
    `بارگذاری محدود باید کمتر باشد (محدود: ${scopedCount}, کامل: ${fullCount})`,
  );
  assert.equal(fullCount - scopedCount, ALL_MONTHS.length - 1);
});

test('availableMonths همهٔ ماه‌های موجود را گزارش می‌کند حتی اگر بارگذاری نشوند', async () => {
  installFakeS3();
  const result = await readDatabaseState({
    departmentIds: [DEPARTMENT_ID],
    monthKeys: ['1404_1'],
  });

  // رابط کاربری باید بداند چه ماه‌هایی وجود دارد تا ناوبری تقویم درست کار کند.
  assert.deepEqual(result.availableMonths[DEPARTMENT_ID], [...ALL_MONTHS].sort());
  assert.deepEqual(result.loadedMonths[DEPARTMENT_ID], ['1404_1']);
});

test('درخواست ماهی که وجود ندارد خطا نمی‌دهد و بی‌صدا نادیده گرفته می‌شود', async () => {
  installFakeS3();
  const result = await readDatabaseState({
    departmentIds: [DEPARTMENT_ID],
    monthKeys: ['1404_1', '1499_7'],
  });

  assert.deepEqual(result.loadedMonths[DEPARTMENT_ID], ['1404_1']);
  assert.equal(result.state.deptData[DEPARTMENT_ID].schedules['1499_7'], undefined);
});

test('پنجرهٔ خالی هیچ برنامه‌ای نمی‌خواند ولی داده‌های پایه را می‌آورد', async () => {
  const s3 = installFakeS3();
  const result = await readDatabaseState({
    departmentIds: [DEPARTMENT_ID],
    monthKeys: [],
  });

  assert.equal(s3.scheduleFetchCount(), 0);
  // پرسنل، درخواست‌ها و تنظیمات همچنان باید بارگذاری شوند.
  assert.ok(result.state.deptData[DEPARTMENT_ID].personnel !== undefined);
  assert.ok(result.state.deptData[DEPARTMENT_ID].settings_system !== undefined);
  assert.deepEqual(result.availableMonths[DEPARTMENT_ID], [...ALL_MONTHS].sort());
});

// ===========================================================================
// موازی‌سازی
// ===========================================================================

test('اسناد سناریو در همان موج موازیِ اسناد پایه خوانده می‌شوند', async () => {
  const { client } = getS3Client();
  const startOrder: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  (client as any).send = async (command: any) => {
    const name = command.constructor.name;
    if (name === 'ListObjectsV2Command') {
      return { Contents: [], IsTruncated: false };
    }

    const key: string = command.input.Key;
    startOrder.push(key);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // تأخیر مصنوعی تا هم‌پوشانی واقعی درخواست‌ها قابل اندازه‌گیری باشد.
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight -= 1;

    const body = (value: unknown) => ({
      ETag: `"etag-${key}"`,
      Body: { transformToString: async () => JSON.stringify(value) },
    });
    if (key.endsWith('/departments/index.json')) return body([{ id: DEPARTMENT_ID, name: 'بخش نمونه' }]);
    if (key.endsWith('/settings.json')) return body(SETTINGS_DOC);
    if (key.endsWith('/personnel.json') || key.endsWith('/requests.json')) return body([]);
    return body({});
  };

  await readDatabaseState({ departmentIds: [DEPARTMENT_ID], monthKeys: [] });

  // پنج سند پایه + دو سند سناریو باید با هم پرواز کنند.
  // پیش‌تر activeScenarios و scenarioVotes دو `await` سریالی جدا بودند.
  assert.ok(
    maxInFlight >= 7,
    `اسناد پایه و سناریو باید موازی خوانده شوند (بیشینهٔ هم‌زمان: ${maxInFlight})`,
  );
});
