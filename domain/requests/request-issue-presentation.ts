import type {
  RequestConflictReason,
  RequestInvalidReason,
  RequestValidationIssue,
} from './request-domain';

const REASON_LABELS: Record<RequestInvalidReason | RequestConflictReason, string> = {
  DUPLICATE_REQUEST_ID: 'شناسهٔ درخواست تکراری است',
  MISSING_REQUEST_ID: 'شناسهٔ درخواست خالی است',
  MISSING_PERSONNEL_ID: 'پرسنل درخواست مشخص نیست',
  UNKNOWN_PERSONNEL: 'پرسنل درخواست در فهرست فعال وجود ندارد',
  INVALID_REQUEST_TYPE: 'نوع درخواست نامعتبر است',
  INVALID_SCOPE: 'محدودهٔ زمانی درخواست نامعتبر است',
  EMPTY_EFFECTIVE_SCOPE: 'درخواست در این ماه هیچ روز مؤثری ندارد',
  INVALID_DATE_RANGE: 'بازهٔ تاریخ درخواست نامعتبر است',
  INVALID_SELECTED_DAY: 'یکی از روزهای انتخابی نامعتبر است',
  MISSING_PREFERRED_SHIFT: 'شیفت موردنظر ثبت نشده است',
  INVALID_PREFERRED_SHIFT: 'شیفت موردنظر نامعتبر است',
  EMPTY_PATTERN: 'الگوی شیفت خالی است',
  INVALID_PATTERN_STEP: 'یکی از گام‌های الگوی شیفت نامعتبر است',
  DUPLICATE_POSITIVE_INTENT: 'دو درخواست مثبت یکسان برای یک روز ثبت شده است',
  OVERLAPPING_POSITIVE_INTENT: 'چند درخواست مثبت ناسازگار روی یک روز هم‌پوشانی دارند',
};

export function formatRequestGenerationIssues(
  issues: ReadonlyArray<RequestValidationIssue>,
  personnelNameById: ReadonlyMap<string, string> = new Map()
): string {
  if (issues.length === 0) return '';

  const lines = issues.slice(0, 8).map((issue, index) => {
    const person = issue.personnelId
      ? personnelNameById.get(issue.personnelId) ?? issue.personnelId
      : 'نامشخص';
    const days = issue.days?.length ? `؛ روزهای ${issue.days.join('، ')}` : '';
    const requestIds = issue.requestIds.length
      ? `؛ شناسه‌ها: ${issue.requestIds.join('، ')}`
      : '';
    return `${index + 1}) ${REASON_LABELS[issue.reason]} — ${person}${days}${requestIds}`;
  });

  if (issues.length > lines.length) {
    lines.push(`… و ${issues.length - lines.length} مورد دیگر`);
  }

  return [
    'بازتولید متوقف شد چون درخواست‌های ثبت‌شده نیاز به اصلاح دارند:',
    '',
    ...lines,
    '',
    'لطفاً درخواست‌های ذکرشده را ویرایش یا حذف کنید و سپس دوباره بازتولید را اجرا کنید.',
  ].join('\n');
}
