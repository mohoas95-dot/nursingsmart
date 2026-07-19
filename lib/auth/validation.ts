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
  .transform(value => /^[۰-۹٠-٩]+$/.test(value) ? toEnglishDigits(value) : value);

export const LoginSchema = z.object({
  nationalId: NationalIdSchema,
  password: PasswordInputSchema,
  departmentId: z.string().min(1).max(128).optional(),
  portal: z.enum(['staff', 'head-nurse']).optional(),
}).strict();

export const ForgotPasswordSchema = z.object({ nationalId: NationalIdSchema }).strict();

export const ChangePasswordSchema = z.object({
  currentPassword: PasswordInputSchema,
  newPassword: z.string()
    .min(8, 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد.')
    .max(200)
    .regex(/[A-Za-z]/, 'رمز عبور جدید باید حداقل یک حرف داشته باشد.')
    .regex(/\d/, 'رمز عبور جدید باید حداقل یک عدد داشته باشد.'),
  confirmPassword: z.string().max(200),
}).strict().refine(data => data.newPassword === data.confirmPassword, {
  path: ['confirmPassword'],
  message: 'تکرار رمز عبور با رمز جدید یکسان نیست.',
}).refine(data => data.newPassword !== '1234', {
  path: ['newPassword'],
  message: 'رمز عبور جدید نباید رمز پیش‌فرض باشد.',
});
