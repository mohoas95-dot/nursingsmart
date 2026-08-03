// عمداً بدون `server-only`: این ماژول منطق خالص مجوزدهی است (بدون I/O، بدون
// دسترسی به cookie یا پایگاه داده) تا بتوان آن را مستقیماً و بدون بالا آوردن
// محیط Next.js تست کرد. قواعد امنیتی باید ساده و آزمون‌پذیر بمانند.
import type { AuthenticatedUser } from './types';
import type { StorageResource } from '../storageSchemas';
import { AuthenticationError } from './errors';

/**
 * مجوز نوشتن روی منابع ذخیره‌سازی — لایهٔ دفاعی سمت سرور
 * ---------------------------------------------------------------------------
 * چرا این فایل جدا شد؟ منطق مجوزدهی پیش‌تر داخل route handler بود و فقط «نوع
 * منبع» را بررسی می‌کرد، نه «محتوای» آن. این تفکیک اجازه می‌دهد قواعد مالکیت
 * (چه کسی اجازهٔ تغییر چه رکوردی را دارد) به‌صورت خالص و قابل تست نوشته شود.
 *
 * اصل حاکم: رابط کاربری هرگز مرز امنیتی نیست. اینکه دکمه‌ای در UI برای پرسنل
 * غیرفعال است هیچ محافظتی ایجاد نمی‌کند، چون کاربر می‌تواند مستقیماً درخواست
 * HTTP بفرستد. هر قاعده‌ای باید اینجا هم اعمال شود.
 */

/** نقش‌هایی که مدیریت کامل بخش را دارند. */
function isDepartmentManager(user: AuthenticatedUser) {
  return user.role === 'ADMIN' || user.role === 'HEAD_NURSE';
}

/**
 * کنترل دسترسی در سطح «نوع منبع».
 *
 * این تابع فقط تعیین می‌کند کاربر اجازهٔ لمس این نوع سند را دارد یا نه؛
 * محدودیت‌های محتوایی (مالکیت رکورد) در `assertRequestOwnership` بررسی می‌شود.
 */
export function authorizeResourceWrite(user: AuthenticatedUser, resource: StorageResource) {
  if (user.role === 'ADMIN') return;

  if (resource.type === 'departments') {
    throw new AuthenticationError(403, 'فقط مدیر سامانه اجازه تغییر فهرست بخش‌ها را دارد.');
  }

  // از اینجا به بعد همهٔ منابع به یک بخش تعلق دارند: کاربر باید عضو همان بخش باشد.
  if (!user.departmentId || user.departmentId !== resource.departmentId) {
    throw new AuthenticationError(403, 'اجازه تغییر اطلاعات این بخش را ندارید.');
  }

  if (resource.type === 'activeScenarios') {
    if (user.role !== 'HEAD_NURSE') {
      throw new AuthenticationError(403, 'فقط سرپرستار اجازه مدیریت سناریوها را دارد.');
    }
    return;
  }

  // رأی دادن به سناریو عمداً برای پرسنل باز است (سازوکار نظرسنجی شیفت).
  if (resource.type === 'scenarioVotes') return;

  if (isDepartmentManager(user)) return;

  // ── پرسنل ────────────────────────────────────────────────────────────────
  //
  // ⚠️ اصلاح آسیب‌پذیری ارتقای سطح دسترسی:
  // پیش‌تر شرط به شکل زیر بود و `schedule` را از محدودیت مستثنا می‌کرد:
  //
  //   if (role === 'PERSONNEL' && type !== 'requests' && type !== 'schedule') throw ...
  //
  // نتیجه این بود که یک پرسنل عادی می‌توانست با یک درخواست مستقیم HTTP کل سند
  // برنامهٔ ماه بخش را بازنویسی کند: شیفت سایر همکاران، پرچم قفل نهایی
  // (`finalizedNurses`/`finalizedAssistants`)، هشدارها و ردیف‌های قفل‌شده.
  // در رابط کاربری این کار ممکن نبود، ولی UI هرگز مرز امنیتی نیست.
  //
  // اکنون پرسنل فقط اجازهٔ نوشتن سند «درخواست‌ها» را دارد و مالکیت رکوردها هم
  // جداگانه در `assertRequestOwnership` بررسی می‌شود.
  if (resource.type !== 'requests') {
    throw new AuthenticationError(403, 'پرسنل فقط اجازه ثبت درخواست‌های شیفت خود را دارند.');
  }
}

/** حداقل شکل لازم از یک درخواست شیفت برای بررسی مالکیت. */
type OwnedRequest = { id: string; personnelId: string };

function toOwnedRequests(value: unknown): OwnedRequest[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is OwnedRequest =>
    typeof item === 'object' && item !== null &&
    typeof (item as OwnedRequest).id === 'string' &&
    typeof (item as OwnedRequest).personnelId === 'string');
}

function stableSerialize(request: OwnedRequest): string {
  // کلیدها مرتب می‌شوند تا تفاوت صرفاً در ترتیب کلیدها، «تغییر» تلقی نشود.
  const record = request as unknown as Record<string, unknown>;
  return JSON.stringify(Object.keys(record).sort().map(key => [key, record[key]]));
}

/**
 * تضمین اینکه پرسنل فقط درخواست‌های *خودش* را تغییر می‌دهد.
 *
 * سند «درخواست‌ها» یک آرایهٔ مشترک برای کل بخش است، پس صرفِ اجازهٔ نوشتن روی آن
 * کافی نیست: بدون این بررسی، پرسنل می‌توانست کل آرایه را با نسخه‌ای بفرستد که
 * درخواست‌های همکارانش حذف یا دستکاری شده باشد.
 *
 * روش: سند ارسالی با سند فعلیِ ذخیره‌شده مقایسه می‌شود و هر تفاوتی که به رکورد
 * متعلق به شخص دیگری مربوط باشد، رد می‌شود.
 *
 * @param committed محتوای فعلی سند در ذخیره‌سازی (`null` یعنی هنوز وجود ندارد)
 * @param submitted محتوای پیشنهادی کاربر
 */
export function assertRequestOwnership(
  user: AuthenticatedUser,
  committed: unknown,
  submitted: unknown,
) {
  // مدیران بخش اجازهٔ ویرایش درخواست همهٔ پرسنل را دارند.
  if (isDepartmentManager(user) || user.role === 'ADMIN') return;

  // پرسنلی که هنوز به پروندهٔ پرسنلی وصل نشده، نباید چیزی بنویسد.
  if (!user.personnelId) {
    throw new AuthenticationError(403, 'پروندهٔ پرسنلی شما هنوز تکمیل نشده است؛ با سرپرستار تماس بگیرید.');
  }

  const before = new Map(toOwnedRequests(committed).map(item => [item.id, item]));
  const after = new Map(toOwnedRequests(submitted).map(item => [item.id, item]));

  // ۱) رکوردهای اضافه یا تغییریافته باید متعلق به خود کاربر باشند.
  for (const [id, next] of after) {
    const previous = before.get(id);
    if (previous && stableSerialize(previous) === stableSerialize(next)) continue;

    if (next.personnelId !== user.personnelId) {
      throw new AuthenticationError(403, 'فقط می‌توانید درخواست‌های خودتان را ثبت یا ویرایش کنید.');
    }
    // تغییر مالکیت یک رکورد موجود به خود، مسیر دورزدن قاعدهٔ بالا بود.
    if (previous && previous.personnelId !== user.personnelId) {
      throw new AuthenticationError(403, 'اجازه تغییر درخواست سایر پرسنل را ندارید.');
    }
  }

  // ۲) رکوردهای حذف‌شده هم باید متعلق به خود کاربر بوده باشند.
  for (const [id, previous] of before) {
    if (after.has(id)) continue;
    if (previous.personnelId !== user.personnelId) {
      throw new AuthenticationError(403, 'اجازه حذف درخواست سایر پرسنل را ندارید.');
    }
  }
}
