import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizePersonnel,
  normalizeRequests,
  normalizeSettings,
  normalizeSchedule,
  normalizeDepartments,
  tryParseAppStateLenient,
} from '../lib/legacy-compat';

/**
 * تست‌های لایهٔ سازگاری با دادهٔ قدیمی: اسنادی که نسخه‌های قبلی نوشته‌اند
 * (فیلدهای جدید ندارند، کلیدهای ناشناخته دارند، رشتهٔ عددی دارند) باید با
 * نرمال‌سازی خواندنی شوند و به قالب جدید برسند.
 */

test('personnel قدیمی: فیلدهای جدید گم‌شده با پیش‌فرض پر می‌شوند و کلیدهای ناشناخته حذف می‌شوند', () => {
  const result = normalizePersonnel([
    {
      id: 'p-1',
      firstName: 'زهرا',
      lastName: 'احمدی',
      jobGroup: 'nurse',
      experienceYears: '5', // رشتهٔ عددی در دادهٔ قدیمی
      active: true,
      phone: '0912...', // کلید ناشناخته (نسخهٔ جدید ندارد)
      shiftPreference: 'M', // کلید ناشناخته
    },
  ]);

  assert.ok(result.ok);
  const item = (result as { data: any[] }).data[0];
  assert.equal(item.position, 'staff');            // پیش‌فرض
  assert.equal(item.employmentType, 'official');   // پیش‌فرض
  assert.equal(item.canBeShiftLeader, false);      // پیش‌فرض
  assert.equal(item.experienceYears, 5);           // تبدیل رشته → عدد
  assert.equal(item.personalCode, '');             // پیش‌فرض
  assert.equal(item.active, true);
  assert.equal(item.phone, undefined);             // حذف کلید ناشناخته
  assert.equal(item.shiftPreference, undefined);
});

test('personnel با jobGroup/position نامعتبر به مقادیر امن تبدیل می‌شود', () => {
  const result = normalizePersonnel([
    { id: 'p-2', firstName: 'علی', lastName: 'رضایی', jobGroup: 'unknown', position: 'x' },
  ]);
  assert.ok(result.ok);
  const item = (result as { data: any[] }).data[0];
  assert.equal(item.jobGroup, 'nurse');
  assert.equal(item.position, 'staff');
});

test('personnel بدون نام → قابل نرمال‌سازی نیست (گزارش خطا)', () => {
  const result = normalizePersonnel([{ id: 'p-3', lastName: 'فقط-نام-خانوادگی' }]);
  assert.equal(result.ok, false);
});

test('requests قدیمی: scope و isEssential گم‌شده با پیش‌فرض پر می‌شوند', () => {
  const result = normalizeRequests([
    { id: 'r-1', personnelId: 'p-1', requestType: 'OFF', preferredShift: 'OFF' },
  ]);
  assert.ok(result.ok);
  const item = (result as { data: any[] }).data[0];
  assert.equal(item.scope, 'all');
  assert.equal(item.isEssential, false);
});

test('settings قدیمی: dutyHours و demand ناقص با صفر پر می‌شوند', () => {
  const result = normalizeSettings({
    activeYear: '1404',
    settings_system: {
      dutyHours: { official: 176 },
      demand: { weekday: { morningNurse: 3 } },
    },
    settings_credentials: { username: 'u', password: '' },
  });
  assert.ok(result.ok);
  const data = (result as { data: any }).data;
  assert.equal(data.activeYear, 1404);
  assert.equal(data.settings_system.dutyHours.contract, 0);
  assert.equal(data.settings_system.demand.weekday.afternoonNurse, 0);
  assert.equal(data.settings_system.demand.holiday.nightNurse, 0);
});

test('schedule قدیمی: assignments/shiftLeaders/warnings گم‌شده خالی می‌شوند', () => {
  const result = normalizeSchedule({ year: 1404, month: 5 });
  assert.ok(result.ok);
  const data = (result as { data: any }).data;
  assert.deepEqual(data.assignments, {});
  assert.deepEqual(data.shiftLeaders, {});
  assert.deepEqual(data.warnings, []);
});

test('departments قدیمی: کلیدهای اضافه حذف و بدون id/name رد می‌شود', () => {
  const ok = normalizeDepartments([{ id: 'dep-1', name: 'بخش سپهر', extra: 1 }]);
  assert.ok(ok.ok);
  assert.equal((ok as { data: any[] }).data[0].extra, undefined);

  const bad = normalizeDepartments([{ name: 'بدون شناسه' }]);
  assert.equal(bad.ok, false);
});

test('snapshot کل قدیمی: با کلیدهای اضافه و اسناد ناقص به state معتبر تبدیل می‌شود', () => {
  const raw = {
    version: 'legacy-1', // کلید ناشناختهٔ سطح بالا
    departments: [{ id: 'dep-1', name: 'بخش سپهر', username: 'x', password: 'y' }],
    deptData: {
      'dep-1': {
        personnel: [
          { id: 'p-1', firstName: 'زهرا', lastName: 'احمدی', jobGroup: 'nurse' },
        ],
        requests: [],
        settings_system: { dutyHours: { official: 176 } },
        settings_credentials: { username: 'x', password: '' },
        holidays: {},
        firstDayOfWeek: { '1404_5': 6 },
        schedules: {
          '1404_5': { year: 1404, month: 5, assignments: {}, shiftLeaders: {}, warnings: [] },
        },
      },
    },
  };

  const result = tryParseAppStateLenient(raw);
  assert.ok(result.ok, result.ok ? '' : (result as { reason: string }).reason);
  const state = (result as { state: any }).state;
  assert.equal(state.departments.length, 1);
  const personnel = state.deptData['dep-1'].personnel;
  assert.equal(personnel[0].employmentType, 'official');
  assert.equal(personnel[0].position, 'staff');
  assert.ok(state.deptData['dep-1'].schedules['1404_5']);
});

test('snapshot خراب (بدون departments) قابل نرمال‌سازی نیست', () => {
  const result = tryParseAppStateLenient({ deptData: {} });
  assert.equal(result.ok, false);
});
