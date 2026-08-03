/**
 * Unit Tests — Warning Severity (Domain Layer)
 *
 * Run: tsx --test tests/domain/warning-severity.test.ts
 *
 * قرارداد بخش ۶ معماری برنامهٔ مبنا:
 *  · هشدارهای سطح A (بحرانی) هرگز مخفی نمی‌شوند — حتی برای پرسنل قفل‌شده.
 *  · هشدارهای سطح B/C فقط زمانی برای مصرف‌کننده حذف می‌شوند که تمام افرادِ
 *    نام‌برده‌شده در متن هشدار قفل باشند.
 *  · هشدار ناشناخته همیشه به‌صورت پیش‌فرض «بحرانی» طبقه‌بندی می‌شود (Fail-Safe).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyWarningSeverity,
  extractWarningPersonnelIds,
  filterWarningsForLockedPersonnel,
  isCriticalWarning,
  summarizeWarningsBySeverity,
} from '../../domain/scheduling/warning-severity';
import type { Personnel } from '../../lib/types';

function createPersonnel(id: string, firstName: string, lastName: string, jobGroup: 'nurse' | 'assistant' = 'nurse'): Personnel {
  return {
    id,
    firstName,
    lastName,
    personalCode: id,
    jobGroup,
    position: 'general',
    employmentType: 'official',
    experienceYears: 3,
    active: true,
    canBeShiftLeader: false,
  };
}

const personnel: Personnel[] = [
  createPersonnel('p1', 'سارا', 'کریمی'),
  createPersonnel('p2', 'علی', 'محمدی'),
  createPersonnel('p3', 'نگار', 'رضایی', 'assistant'),
];

// ============================================================================
// classifyWarningSeverity
// ============================================================================

test('classifyWarningSeverity: تمام پیشوندهای قوانین سخت موجود سیستم سطح A هستند', () => {
  const criticalWarnings = [
    'Coverage Shortage: کمبود نیرو (پرستار) در روز 4 شیفت M',
    'Overstaffing: نیروی مازاد (کمک بهیار) در روز 5 شیفت N',
    'Missing Shift Leader: نبود سرشیفت در نوبت شب روز 12',
    'Max Consecutive: عدم رعایت سقف ۵ شیفت متوالی برای سارا کریمی از روز 3 تا روز 9',
    'Mandatory Rest: پرسنل علی محمدی در پایان این ماه به سقف ۵ شیفت متوالی رسیده است',
  ];
  for (const warning of criticalWarnings) {
    assert.equal(classifyWarningSeverity(warning), 'A', warning);
    assert.equal(isCriticalWarning(warning), true, warning);
  }
});

test('classifyWarningSeverity: پیام کمبود نیروی باقی‌ماندهٔ solver بدون پیشوند نیز بحرانی است', () => {
  assert.equal(classifyWarningSeverity('کمبود نیرو (پرستاران) در روز 7 شیفت M - 1 نفر باقی ماند'), 'A');
});

test('classifyWarningSeverity: هشدارهای مدیریت‌پذیرِ پرسنلی سطح B هستند', () => {
  const moderateWarnings = [
    'Mismatched Request: برای سارا کریمی در روز 3 درخواست OFF ثبت شده اما شیفت M تخصیص یافته است',
    'Consecutive OFFs: عدم رعایت سقف آف متوالی (بیش از ۳ روز متوالی) برای علی محمدی از روز 4 تا روز 8 به مدت 5 روز متوالی',
    'Leave Continuity: نقض پیوستگی مرخصی نگار رضایی — روز 12 (M) بین روزهای مرخصی قرار گرفته',
    'Isolated Shift: شیفت تک (N) برای سارا کریمی در روز 9 در میان روزهای کاری با الگوی متفاوت قرار گرفته است',
  ];
  for (const warning of moderateWarnings) {
    assert.equal(classifyWarningSeverity(warning), 'B', warning);
  }
});

test('classifyWarningSeverity: اعلان‌های جایگزینی/اصلاح خودکار سطح C هستند', () => {
  assert.equal(
    classifyWarningSeverity('Isolated Shift Fixed: شیفت تک (E) پرسنل سارا کریمی در روز 6 برای حفظ الگوی پیوسته به علی محمدی منتقل شد'),
    'C'
  );
  assert.equal(
    classifyWarningSeverity('OFF Removed: حذف OFF ناخواسته پرسنل علی محمدی در روز 10 به دلیل قانون ممنوعیت آف بعد از مرخصی'),
    'C'
  );
});

test('classifyWarningSeverity: «Isolated Shift Fixed» با «Isolated Shift» اشتباه گرفته نمی‌شود', () => {
  assert.notEqual(
    classifyWarningSeverity('Isolated Shift Fixed: شیفت تک (E) پرسنل سارا کریمی در روز 6 به علی محمدی منتقل شد'),
    'B'
  );
});

test('classifyWarningSeverity: هشدار ناشناخته همیشه بحرانی (Fail-Safe) محسوب می‌شود', () => {
  assert.equal(classifyWarningSeverity('هر متن ناشناختهٔ دیگری'), 'A');
  assert.equal(classifyWarningSeverity('Brand New Rule: something never seen before'), 'A');
});

// ============================================================================
// extractWarningPersonnelIds
// ============================================================================

test('extractWarningPersonnelIds: همهٔ افراد نام‌برده‌شده در هشدار برگردانده می‌شوند', () => {
  const ids = extractWarningPersonnelIds(
    'Isolated Shift Fixed: شیفت تک (E) پرسنل سارا کریمی در روز 6 برای حفظ الگوی پیوسته به علی محمدی منتقل شد',
    personnel
  );
  assert.deepEqual(new Set(ids), new Set(['p1', 'p2']));
});

test('extractWarningPersonnelIds: هشدار عمومی بدون نام پرسنل فهرست خالی می‌دهد', () => {
  const ids = extractWarningPersonnelIds('Coverage Shortage: کمبود نیرو (پرستار) در روز 4 شیفت M', personnel);
  assert.deepEqual(ids, []);
});

// ============================================================================
// filterWarningsForLockedPersonnel
// ============================================================================

test('filterWarningsForLockedPersonnel: بدون قفل، خروجی همان ورودی است', () => {
  const warnings = [
    'Mismatched Request: برای سارا کریمی در روز 3 درخواست OFF ثبت شده اما شیفت M تخصیص یافته است',
    'Coverage Shortage: کمبود نیرو (پرستار) در روز 4 شیفت M',
  ];
  assert.deepEqual(filterWarningsForLockedPersonnel(warnings, personnel, []), warnings);
});

test('filterWarningsForLockedPersonnel: هشدارهای سطح B/C پرسنل قفل‌شده حذف می‌شوند', () => {
  const warnings = [
    'Mismatched Request: برای سارا کریمی در روز 3 درخواست OFF ثبت شده اما شیفت M تخصیص یافته است',
    'Consecutive OFFs: عدم رعایت سقف آف متوالی (بیش از ۳ روز متوالی) برای علی محمدی از روز 4 تا روز 8 به مدت 5 روز متوالی',
  ];
  const filtered = filterWarningsForLockedPersonnel(warnings, personnel, ['p1']);
  assert.deepEqual(filtered, [warnings[1]]); // هشدار p1 (قفل) حذف، هشدار p2 (آزاد) باقی
});

test('filterWarningsForLockedPersonnel: هشدار سطح A هرگز برای پرسنل قفل‌شده هم مخفی نمی‌شود', () => {
  const warnings = [
    'Max Consecutive: عدم رعایت سقف ۵ شیفت متوالی برای سارا کریمی از روز 3 تا روز 9',
    'Mandatory Rest: پرسنل سارا کریمی در پایان این ماه به سقف ۵ شیفت متوالی رسیده است',
    'Coverage Shortage: کمبود نیرو (پرستار) در روز 4 شیفت M',
    'کمبود نیرو (پرستاران) در روز 7 شیفت M - 1 نفر باقی ماند',
  ];
  const filtered = filterWarningsForLockedPersonnel(warnings, personnel, ['p1']);
  assert.deepEqual(filtered, warnings); // هیچ‌کدام حذف نمی‌شوند
});

test('filterWarningsForLockedPersonnel: هشدار B/C مشترک (قفل + آزاد) باقی می‌ماند', () => {
  const warnings = [
    'Isolated Shift Fixed: شیفت تک (E) پرسنل سارا کریمی در روز 6 برای حفظ الگوی پیوسته به علی محمدی منتقل شد',
  ];
  // سارا قفل است ولی علی آزاد است → اعلان باید دیده شود
  assert.deepEqual(filterWarningsForLockedPersonnel(warnings, personnel, ['p1']), warnings);
  // اگر هر دو قفل باشند، حذف می‌شود
  assert.deepEqual(filterWarningsForLockedPersonnel(warnings, personnel, ['p1', 'p2']), []);
});

test('filterWarningsForLockedPersonnel: هشدار عمومیِ سطح B/C بدون نسبت پرسنلی هرگز حذف نمی‌شود', () => {
  // تمام هشدارهای B/C فعلی سیستم پرسنلی هستند، اما اگر روزی هشدار عمومیِ
  // غیربحرانی معرفی شود، قرارداد Fail-Safe آن را نگه می‌دارد.
  const warnings = ['OFF Removed: اعلان عمومی آزمایشی بدون نام پرسنل'];
  assert.deepEqual(filterWarningsForLockedPersonnel(warnings, personnel, ['p1', 'p2', 'p3']), warnings);
});

// ============================================================================
// summarizeWarningsBySeverity
// ============================================================================

test('summarizeWarningsBySeverity: شمارش دقیق بر اساس سطح', () => {
  const summary = summarizeWarningsBySeverity([
    'Coverage Shortage: کمبود نیرو (پرستار) در روز 4 شیفت M',
    'Mismatched Request: برای سارا کریمی در روز 3 درخواست OFF ثبت شده اما شیفت M تخصیص یافته است',
    'OFF Removed: حذف OFF ناخواسته پرسنل علی محمدی در روز 10',
    'متن ناشناخته (Fail-Safe → A)',
  ]);
  assert.deepEqual(summary, { A: 2, B: 1, C: 1 });
});
