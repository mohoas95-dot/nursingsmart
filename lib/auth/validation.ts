import { z } from 'zod';

export function toEnglishDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
}

export function isValidIranianNationalId(value: string): boolean {
  const nationalId = toEnglishDigits(value).trim();
  if (!/^\d{10}$/.test(nationalId) || /^(\d)\1{9}$/.test(nationalId)) return false;

  const checkDigit = Number(nationalId[9]);
  const sum = nationalId
    .slice(0, 9)
    .split('')
    .reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
  const remainder = sum % 11;
  return checkDigit === (remainder < 2 ? remainder : 11 - remainder);
}

export const NationalIdSchema = z.string()
  .transform(value => toEnglishDigits(value).trim())
  .refine(isValidIranianNationalId, 'کد ملی معتبر نیست.');

export const PasswordInputSchema = z.string()
  .min(1, 'رمز عبور را وارد کنید.')
  .max(200)
  .transform(value => toEnglishDigits(value));

export const LoginSchema = z.object({
  nationalId: NationalIdSchema,
  password: PasswordInputSchema,
  departmentId: z.string().min(1).max(128).optional(),
  portal: z.enum(['staff', 'head-nurse']).optional(),
}).strict();

export const ForgotPasswordSchema = z.object({
  nationalId: NationalIdSchema,
  departmentId: z.string().min(1).max(128).optional(),
}).strict();

export const ChangePasswordSchema = z.object({
  currentPassword: PasswordInputSchema,
  newPassword: z.string()
    .min(1, 'رمز عبور جدید را وارد کنید.')
    .max(200),
  confirmPassword: z.string().max(200),
}).strict().refine(data => data.newPassword === data.confirmPassword, {
  path: ['confirmPassword'],
  message: 'تکرار رمز عبور با رمز جدید یکسان نیست.',
});
