import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertRequestOwnership,
  authorizeResourceWrite,
} from '../lib/auth/resource-authorization';
import { AuthenticationError } from '../lib/auth/errors';
import type { AuthenticatedUser } from '../lib/auth/types';
import type { StorageResource } from '../lib/storageSchemas';

const DEPT = 'dept-a';
const OTHER_DEPT = 'dept-b';

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'u1',
    nationalId: '0010000003',
    firstName: 'کاربر',
    lastName: 'نمونه',
    role: 'PERSONNEL',
    departmentId: DEPT,
    personnelId: 'p1',
    mustChangePassword: false,
    ...overrides,
  };
}

const personnel = user();
const headNurse = user({ id: 'u2', role: 'HEAD_NURSE', personnelId: null });
const admin = user({ id: 'u3', role: 'ADMIN', departmentId: null, personnelId: null });

function request(id: string, personnelId: string, extra: Record<string, unknown> = {}) {
  return { id, personnelId, requestType: 'OFF', isEssential: false, scope: 'all', ...extra };
}

function expectForbidden(fn: () => void, hint: string) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof AuthenticationError, `${hint}: باید AuthenticationError باشد`);
    assert.equal((error as AuthenticationError).status, 403, hint);
    return true;
  }, hint);
}

// ===========================================================================
// آسیب‌پذیری ارتقای سطح دسترسی: پرسنل نباید بتواند برنامهٔ ماه را بازنویسی کند
// ===========================================================================

test('امنیت: پرسنل اجازهٔ نوشتن سند برنامهٔ ماه را ندارد', () => {
  // این همان حفره بود: `schedule` از محدودیت مستثنا شده بود، پس پرسنل می‌توانست
  // شیفت همه، قفل نهایی و هشدارها را با یک درخواست HTTP بازنویسی کند.
  const resource: StorageResource = { type: 'schedule', departmentId: DEPT, monthKey: '1404_5' };
  expectForbidden(() => authorizeResourceWrite(personnel, resource), 'schedule برای پرسنل');
});

test('امنیت: پرسنل اجازهٔ تغییر تنظیمات، پرسنل، تعطیلات و روز اول هفته را ندارد', () => {
  const blocked: StorageResource[] = [
    { type: 'settings', departmentId: DEPT },
    { type: 'personnel', departmentId: DEPT },
    { type: 'holidays', departmentId: DEPT },
    { type: 'firstDayOfWeek', departmentId: DEPT },
    { type: 'activeScenarios', departmentId: DEPT },
  ];
  for (const resource of blocked) {
    expectForbidden(() => authorizeResourceWrite(personnel, resource), resource.type);
  }
});

test('امنیت: هیچ نقشی جز مدیر سامانه فهرست بخش‌ها را تغییر نمی‌دهد', () => {
  const resource: StorageResource = { type: 'departments' };
  expectForbidden(() => authorizeResourceWrite(personnel, resource), 'departments/personnel');
  expectForbidden(() => authorizeResourceWrite(headNurse, resource), 'departments/head-nurse');
  assert.doesNotThrow(() => authorizeResourceWrite(admin, resource), 'admin باید مجاز باشد');
});

test('امنیت: کاربر نمی‌تواند روی بخش دیگری بنویسد (جداسازی بخش‌ها)', () => {
  const foreign: StorageResource = { type: 'requests', departmentId: OTHER_DEPT };
  expectForbidden(() => authorizeResourceWrite(personnel, foreign), 'بخش بیگانه/پرسنل');
  expectForbidden(() => authorizeResourceWrite(headNurse, foreign), 'بخش بیگانه/سرپرستار');
});

test('دسترسی‌های مجاز حفظ شده‌اند (بدون شکستن قابلیت فعلی)', () => {
  assert.doesNotThrow(() => authorizeResourceWrite(personnel, { type: 'requests', departmentId: DEPT }));
  assert.doesNotThrow(() => authorizeResourceWrite(personnel, { type: 'scenarioVotes', departmentId: DEPT }));
  assert.doesNotThrow(() => authorizeResourceWrite(headNurse, { type: 'schedule', departmentId: DEPT, monthKey: '1404_5' }));
  assert.doesNotThrow(() => authorizeResourceWrite(headNurse, { type: 'activeScenarios', departmentId: DEPT }));
  assert.doesNotThrow(() => authorizeResourceWrite(admin, { type: 'schedule', departmentId: OTHER_DEPT, monthKey: '1404_5' }));
});

// ===========================================================================
// مالکیت رکورد: پرسنل فقط درخواست‌های خودش را تغییر می‌دهد
// ===========================================================================

test('امنیت: پرسنل نمی‌تواند درخواست همکارش را حذف کند', () => {
  const committed = [request('r1', 'p1'), request('r2', 'p2')];
  const submitted = [request('r1', 'p1')]; // r2 متعلق به فرد دیگری حذف شده
  expectForbidden(() => assertRequestOwnership(personnel, committed, submitted), 'حذف درخواست دیگری');
});

test('امنیت: پرسنل نمی‌تواند درخواست همکارش را ویرایش کند', () => {
  const committed = [request('r2', 'p2', { isEssential: false })];
  const submitted = [request('r2', 'p2', { isEssential: true })];
  expectForbidden(() => assertRequestOwnership(personnel, committed, submitted), 'ویرایش درخواست دیگری');
});

test('امنیت: پرسنل نمی‌تواند درخواست جدید به نام دیگری ثبت کند', () => {
  const committed: unknown[] = [];
  const submitted = [request('r9', 'p2')];
  expectForbidden(() => assertRequestOwnership(personnel, committed, submitted), 'جعل هویت');
});

test('امنیت: تغییر مالکیت رکورد دیگری به خود مسدود است', () => {
  // مسیر دورزدن: رکورد فرد دیگر را بردار و personnelId را به خودت تغییر بده.
  const committed = [request('r2', 'p2')];
  const submitted = [request('r2', 'p1')];
  expectForbidden(() => assertRequestOwnership(personnel, committed, submitted), 'ربودن رکورد');
});

test('امنیت: پرسنلِ بدون پروندهٔ پرسنلی اجازهٔ نوشتن ندارد', () => {
  const unlinked = user({ personnelId: null });
  expectForbidden(() => assertRequestOwnership(unlinked, [], [request('r1', 'p1')]), 'حساب متصل‌نشده');
});

// ===========================================================================
// عملکرد قانونی نباید بشکند
// ===========================================================================

test('پرسنل می‌تواند درخواست خودش را بسازد، ویرایش و حذف کند', () => {
  const committed = [request('r1', 'p1'), request('r2', 'p2')];

  // افزودن
  assert.doesNotThrow(() => assertRequestOwnership(
    personnel, committed, [...committed, request('r3', 'p1')]));

  // ویرایش
  assert.doesNotThrow(() => assertRequestOwnership(
    personnel, committed, [request('r1', 'p1', { isEssential: true }), request('r2', 'p2')]));

  // حذف
  assert.doesNotThrow(() => assertRequestOwnership(
    personnel, committed, [request('r2', 'p2')]));
});

test('ارسال بدون تغییر (idempotent) پذیرفته می‌شود', () => {
  const committed = [request('r1', 'p1'), request('r2', 'p2')];
  assert.doesNotThrow(() => assertRequestOwnership(personnel, committed, [...committed]));
});

test('ترتیب متفاوت کلیدها «تغییر» تلقی نمی‌شود', () => {
  const committed = [{ id: 'r2', personnelId: 'p2', isEssential: false, scope: 'all' }];
  const submitted = [{ scope: 'all', isEssential: false, personnelId: 'p2', id: 'r2' }];
  assert.doesNotThrow(() => assertRequestOwnership(personnel, committed, submitted));
});

test('سرپرستار و مدیر می‌توانند درخواست همهٔ پرسنل را مدیریت کنند', () => {
  const committed = [request('r1', 'p1'), request('r2', 'p2')];
  assert.doesNotThrow(() => assertRequestOwnership(headNurse, committed, [request('r1', 'p1')]));
  assert.doesNotThrow(() => assertRequestOwnership(admin, committed, []));
});

test('سند اولیه (هنوز موجود نیست) برای درخواست خود کاربر مجاز است', () => {
  assert.doesNotThrow(() => assertRequestOwnership(personnel, null, [request('r1', 'p1')]));
});
