import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterImportantOccasions,
  isImportantOccasion,
} from '../features/calendar/occasion-filter';

// ============================================================================
// فهرست زیر تقویم باید کوتاه و فقط شامل مناسبت‌های مهم باشد
// ============================================================================

test('مناسبت‌های مذهبی درجه‌یک نگه داشته می‌شوند', () => {
  assert.ok(isImportantOccasion('شهادت حضرت امام علی(ع)'));
  assert.ok(isImportantOccasion('ولادت حضرت خدیجه (س)'));
  assert.ok(isImportantOccasion('عید سعید فطر'));
  assert.ok(isImportantOccasion('شب قدر'));
  assert.ok(isImportantOccasion('تاسوعای حسینی'));
  assert.ok(isImportantOccasion('اربعین حسینی'));
});

test('مناسبت‌های ملی و انقلابی نگه داشته می‌شوند', () => {
  assert.ok(isImportantOccasion('روز ملی شدن صنعت نفت ایران'));
  assert.ok(isImportantOccasion('پیروزی انقلاب اسلامی'));
  assert.ok(isImportantOccasion('آزادسازی خرمشهر'));
  assert.ok(isImportantOccasion('جشن نوروز'));
});

test('مناسبت‌های ریز و تبلیغاتی حذف می‌شوند', () => {
  assert.equal(isImportantOccasion('روز جهانی عسل'), false);
  assert.equal(isImportantOccasion('روز جهانی شیر مادر'), false);
  assert.equal(isImportantOccasion('روز ملی بیمه'), false);
  assert.equal(isImportantOccasion('روز جهانی آمار'), false);
  assert.equal(isImportantOccasion('روز درختکاری'), false);
  assert.equal(isImportantOccasion('روز تکریم همسایگان'), false);
});

test('هر مناسبتی که روزش تعطیل رسمی است، بی‌قید و شرط مهم شمرده می‌شود', () => {
  assert.ok(isImportantOccasion('تعطیل رسمی جمهوری اسلامی ایران', true));
  assert.ok(isImportantOccasion('مناسبت محلی بخش', true));
});

test('filterImportantOccasions فهرست را خلاصه و بدون تکرار برمی‌گرداند', () => {
  const result = filterImportantOccasions([
    'روز جهانی عسل',
    'شهادت حضرت امام علی(ع)',
    'روز جهانی شیر مادر',
    'شهادت حضرت امام علی(ع)',
  ]);
  assert.deepEqual(result, ['شهادت حضرت امام علی(ع)']);
});

test('اگر روز تعطیل باشد ولی هیچ عنوان مهمی نباشد، دست‌کم یک عنوان می‌ماند', () => {
  const result = filterImportantOccasions(['تعطیلی انتخابی بخش'], true);
  assert.equal(result.length, 1);
});

test('روز بدون مناسبت مهم، فهرست خالی می‌دهد', () => {
  assert.deepEqual(filterImportantOccasions(['روز جهانی عسل', 'روز ملی بیمه']), []);
  assert.deepEqual(filterImportantOccasions([]), []);
});

test('عنوان‌های خالی یا فقط فاصله نادیده گرفته می‌شوند', () => {
  assert.deepEqual(filterImportantOccasions(['', '   ']), []);
  assert.equal(isImportantOccasion('   '), false);
});
