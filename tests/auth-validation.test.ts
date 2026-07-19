import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChangePasswordSchema,
  isValidIranianNationalId,
  LoginSchema,
  toEnglishDigits,
} from '../lib/auth/validation';

test('normalizes Persian and Arabic digits', () => {
  assert.equal(toEnglishDigits('۱۲٣۴'), '1234');
});

test('validates Iranian national ID checksum and rejects repeated digits', () => {
  assert.equal(isValidIranianNationalId('0010000003'), true);
  assert.equal(isValidIranianNationalId('0010000004'), false);
  assert.equal(isValidIranianNationalId('1111111111'), false);
});

test('accepts Persian digits for the initial numeric password', () => {
  const result = LoginSchema.parse({ nationalId: '۰۰۱۰۰۰۰۰۰۳', password: '۱۲۳۴' });
  assert.deepEqual(result, { nationalId: '0010000003', password: '1234' });
});

test('requires a strong replacement password and matching confirmation', () => {
  assert.equal(ChangePasswordSchema.safeParse({
    currentPassword: '1234',
    newPassword: 'secure123',
    confirmPassword: 'secure123',
  }).success, true);
  assert.equal(ChangePasswordSchema.safeParse({
    currentPassword: '1234',
    newPassword: '1234',
    confirmPassword: '1234',
  }).success, false);
});
