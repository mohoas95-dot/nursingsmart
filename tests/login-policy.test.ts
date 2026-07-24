import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLoginAttempt, type LoginUserSnapshot } from '../lib/auth/loginPolicy';
import { ForgotPasswordSchema, LoginSchema } from '../lib/auth/validation';

function user(overrides: Partial<LoginUserSnapshot> = {}): LoginUserSnapshot {
  return {
    active: true,
    role: 'PERSONNEL',
    departmentId: 'dept_a',
    lockedUntil: null,
    ...overrides,
  };
}

test('پرسنل با کد ملی و رمز درست از پرتال کادر درمان وارد می‌شود', () => {
  const decision = evaluateLoginAttempt({
    user: user(),
    passwordIsValid: true,
    departmentId: 'dept_a',
    portal: 'staff',
  });
  assert.deepEqual(decision, { outcome: 'accepted', assignDepartmentId: null });
});

test('حساب تازه‌ساخته‌شده با رمز اولیه بلافاصله پذیرفته می‌شود', () => {
  // بازتاب باگ اصلی: پیش‌تر رمز قبل از ساخت حساب بررسی می‌شد و نتیجه false می‌ماند.
  const decision = evaluateLoginAttempt({
    user: user({ departmentId: 'dept_a' }),
    passwordIsValid: true,
    departmentId: 'dept_a',
    portal: 'staff',
  });
  assert.equal(decision.outcome, 'accepted');
});

test('حساب بدون بخش هنگام ورود به بخش انتخاب‌شده متصل می‌شود', () => {
  const decision = evaluateLoginAttempt({
    user: user({ departmentId: null }),
    passwordIsValid: true,
    departmentId: 'dept_b',
    portal: 'staff',
  });
  assert.deepEqual(decision, { outcome: 'accepted', assignDepartmentId: 'dept_b' });
});

test('کد ملی ناموجود بدون شمردن تلاش ناموفق رد می‌شود', () => {
  const decision = evaluateLoginAttempt({ user: null, passwordIsValid: false, portal: 'staff' });
  assert.deepEqual(decision, { outcome: 'rejected', reason: 'credentials', countFailedAttempt: false });
});

test('رمز نادرست برای کاربر موجود، تلاش ناموفق را می‌شمارد', () => {
  const decision = evaluateLoginAttempt({ user: user(), passwordIsValid: false, portal: 'staff' });
  assert.deepEqual(decision, { outcome: 'rejected', reason: 'credentials', countFailedAttempt: true });
});

test('حساب قفل‌شده پیام قفل می‌گیرد و تلاشش دوباره شمرده نمی‌شود', () => {
  const now = new Date('2026-01-01T10:00:00Z');
  const decision = evaluateLoginAttempt({
    user: user({ lockedUntil: new Date('2026-01-01T10:10:00Z') }),
    passwordIsValid: false,
    portal: 'staff',
    now,
  });
  assert.equal(decision.outcome, 'locked');
  assert.equal(decision.outcome === 'locked' && decision.retryAfterMinutes, 10);
});

test('قفل منقضی‌شده مانع ورود نمی‌شود', () => {
  const decision = evaluateLoginAttempt({
    user: user({ lockedUntil: new Date('2026-01-01T09:00:00Z') }),
    passwordIsValid: true,
    departmentId: 'dept_a',
    portal: 'staff',
    now: new Date('2026-01-01T10:00:00Z'),
  });
  assert.equal(decision.outcome, 'accepted');
});

test('حساب غیرفعال با رمز درست پیام شفاف می‌گیرد', () => {
  const decision = evaluateLoginAttempt({
    user: user({ active: false }),
    passwordIsValid: true,
    departmentId: 'dept_a',
    portal: 'staff',
  });
  assert.deepEqual(decision, { outcome: 'rejected', reason: 'inactive', countFailedAttempt: false });
});

test('ورود به بخش دیگر رد می‌شود', () => {
  const decision = evaluateLoginAttempt({
    user: user({ departmentId: 'dept_a' }),
    passwordIsValid: true,
    departmentId: 'dept_b',
    portal: 'staff',
  });
  assert.deepEqual(decision, { outcome: 'rejected', reason: 'department', countFailedAttempt: false });
});

test('سرپرستار نمی‌تواند از پرتال کادر درمان وارد شود و برعکس', () => {
  const headNurseOnStaffPortal = evaluateLoginAttempt({
    user: user({ role: 'HEAD_NURSE' }),
    passwordIsValid: true,
    departmentId: 'dept_a',
    portal: 'staff',
  });
  assert.deepEqual(headNurseOnStaffPortal, { outcome: 'rejected', reason: 'portal', countFailedAttempt: false });

  const staffOnHeadNursePortal = evaluateLoginAttempt({
    user: user({ role: 'PERSONNEL' }),
    passwordIsValid: true,
    departmentId: 'dept_a',
    portal: 'head-nurse',
  });
  assert.deepEqual(staffOnHeadNursePortal, { outcome: 'rejected', reason: 'portal', countFailedAttempt: false });
});

test('مدیر سامانه به کنترل بخش محدود نیست', () => {
  const decision = evaluateLoginAttempt({
    user: user({ role: 'ADMIN', departmentId: null }),
    passwordIsValid: true,
    departmentId: 'dept_b',
    portal: 'head-nurse',
  });
  assert.deepEqual(decision, { outcome: 'accepted', assignDepartmentId: null });
});

test('ورود با ارقام فارسی برای کد ملی و رمز پیش‌فرض نرمال می‌شود', () => {
  const parsed = LoginSchema.parse({
    nationalId: '۰۰۱۰۰۰۰۰۰۳',
    password: '۱۲۳۴',
    departmentId: 'dept_a',
    portal: 'staff',
  });
  assert.equal(parsed.nationalId, '0010000003');
  assert.equal(parsed.password, '1234');
});

test('درخواست فراموشی رمز، بخش را همراه کد ملی می‌پذیرد', () => {
  const parsed = ForgotPasswordSchema.parse({ nationalId: '۰۰۱۰۰۰۰۰۰۳', departmentId: 'dept_a' });
  assert.deepEqual(parsed, { nationalId: '0010000003', departmentId: 'dept_a' });
});
