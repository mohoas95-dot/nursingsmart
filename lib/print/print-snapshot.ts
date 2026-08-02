/**
 * چاپ امن خروجی‌ها — اسنپ‌شات ایستای HTML داخل یک iframe مخفی
 *
 * چرا این روش؟ (ریشه‌ی باگ «PDF saveشده خالی و سفید»)
 * روش قبلی مستقیماً از DOM زنده‌ی صفحه‌ی اصلی چاپ می‌گرفت و پس از window.print()
 * با تایمر/رویداد، state چاپ را پاکسازی می‌کرد. دیالوگ «Save as PDF» مرورگرها
 * اجرای جاوااسکریپت را متوقف نمی‌کند و زمانِ رندرِ PDF نهایی در مرورگرها/پلتفرم‌های
 * مختلف قطعی نیست؛ اگر بین رندر پیش‌نمایش و زدن دکمه‌ی Save هر تغییری در DOM
 * رخ دهد (پاکسازی state، ری‌رندر React، intervalهای صفحه و…)، رندرِ نهایی از روی
 * DOMِ تغییرکرده انجام می‌شود و چون کل محتوای چاپی خارج از دیالوگ display:none/
 * visibility:hidden است، خروجی، صفحه‌ای کاملاً خالی می‌شود.
 *
 * راه‌حل ریشه‌ای: به‌جای چاپ از صفحه‌ی اصلی، یک کپی‌ی ایستا (snapshot) از
 * کانتینر چاپی به‌همراه تمام stylesheetهای فعلی (Tailwind، فونت‌های next/font،
 * استایل‌های styled-jsx و قواعد @media print) داخل یک iframe مخفی ساخته می‌شود.
 * آن سند هیچ جاوااسکریپتی ندارد و توسط چیزی خارج از چرخه‌ی چاپ تغییر نمی‌کند؛
 * بنابراین سندی که پیش‌نمایش می‌بیند دقیقاً همان سندی است که Save می‌شود —
 * در هر مرورگر و هر مدت‌زمان بازماندن دیالوگ.
 */

export interface PrintDocumentHtmlOptions {
  /** HTML محتوای چاپی (معمولاً outerHTML کانتینر چاپ در لحظه‌ی کلیک) */
  bodyHtml: string;
  /** مجموعه‌ی تگ‌های <style> و <link rel="stylesheet"> کپی‌شده از head سند فعلی */
  headStylesHtml: string;
  /** کلاس‌های <html> سند فعلی — شامل کلاس‌های متغیر فونت next/font */
  htmlClassName?: string;
  /** کلاس‌های <body> سند فعلی */
  bodyClassName?: string;
  /** CSS اضافی‌ی این کار چاپ (مثل قاعده‌ی @page برای اندازه/جهت صفحه) */
  pageCss?: string;
  lang?: string;
  dir?: 'rtl' | 'ltr';
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * ساخت سند HTML کامل و ایستا برای چاپ.
 * این تابع خالص است (هیچ دسترسی به DOM ندارد) تا به‌راحتی تست شود.
 */
export function buildPrintDocumentHtml(options: PrintDocumentHtmlOptions): string {
  const {
    bodyHtml,
    headStylesHtml,
    htmlClassName = '',
    bodyClassName = '',
    pageCss = '',
    lang = 'fa',
    dir = 'rtl',
  } = options;

  const pageStyle = pageCss.trim() ? `<style>${pageCss}</style>` : '';

  return [
    '<!doctype html>',
    `<html lang="${escapeAttr(lang)}" dir="${dir}" class="${escapeAttr(htmlClassName)}">`,
    '<head>',
    '<meta charset="utf-8" />',
    headStylesHtml,
    pageStyle,
    '</head>',
    `<body class="${escapeAttr(bodyClassName)}">`,
    bodyHtml,
    '</body></html>',
  ].join('');
}

/** جمع‌آوری تمام استایل‌های head سند فعلی برای کپی به سند چاپ */
export function collectHeadStylesHtml(doc: Document): string {
  return Array.from(doc.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((node) => (node as HTMLElement).outerHTML)
    .join('\n');
}

export interface PrintJobHandle {
  /** حذف دستی سند چاپ (مثلاً هنگام شروع کار چاپ جدید) */
  cancel(): void;
}

/** حداقل طول‌عمر iframe پس از فراخوانی print — پوشش مرورگرهایی که afterprint را زود شلیک می‌کنند */
const MIN_LIFETIME_AFTER_PRINT_MS = 15_000;
/** مکث کوتاه پس از afterprint پیش از حذف iframe */
const GRACE_AFTER_AFTERPRINT_MS = 2_000;
/** سقف انتظار برای رویداد load سند چاپ */
const MAX_WAIT_FOR_LOAD_MS = 4_000;
/** سقف انتظار برای آماده‌شدن فونت‌ها تا چاپ هرگز معلق نماند */
const MAX_WAIT_FOR_FONTS_MS = 2_500;
/** حذف اضطراری در بدترین سناریو تا iframe هرگز در DOM باقی نماند */
const FAILSAFE_MS = 5 * 60_000;

let activeJob: PrintJobHandle | null = null;

/**
 * چاپ یک اسنپ‌شات ایستای HTML از طریق iframe مخفی.
 * سند چاپ هیچ جاوااسکریپتی ندارد؛ بنابراین پیش‌نمایش و PDF نهایی همیشه یکسان‌اند.
 */
export function printHtmlSnapshot(
  options: Omit<PrintDocumentHtmlOptions, 'headStylesHtml'>
): PrintJobHandle {
  // شروع کار چاپ جدید، بقایای کار قبلی را پاک می‌کند تا دو دیالوگ همزمان نشود
  activeJob?.cancel();

  const html = buildPrintDocumentHtml({
    ...options,
    headStylesHtml: collectHeadStylesHtml(document),
  });

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';

  let removed = false;
  let printedAt = 0;
  const timers = new Set<number>();

  const handle: PrintJobHandle = { cancel: removeIframe };

  function later(fn: () => void, ms: number): number {
    const id = window.setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  }

  function removeIframe(): void {
    if (removed) return;
    removed = true;
    timers.forEach((id) => window.clearTimeout(id));
    timers.clear();
    const w = iframe.contentWindow;
    if (w) w.removeEventListener('afterprint', onAfterPrint);
    iframe.removeEventListener('load', onLoad);
    iframe.remove();
    if (activeJob === handle) activeJob = null;
  }

  function onAfterPrint(): void {
    // afterprint فقط پس از بسته‌شدن دیالوگ (ذخیره یا لغو) قابل‌اعتماد است.
    // برای پوشش موتورهایی که آن را زود شلیک می‌کنند، حذف نه‌تنها کمی مکث دارد،
    // بلکه هرگز زودتر از حداقل طول‌عمر پس از print انجام نمی‌شود.
    const elapsed = printedAt ? Date.now() - printedAt : Number.POSITIVE_INFINITY;
    const delay = Math.max(GRACE_AFTER_AFTERPRINT_MS, MIN_LIFETIME_AFTER_PRINT_MS - elapsed);
    later(removeIframe, delay);
  }

  function invokePrint(): void {
    if (removed || printedAt) return;
    const w = iframe.contentWindow;
    if (!w) {
      removeIframe();
      return;
    }
    printedAt = Date.now();
    try {
      w.focus();
      w.print();
    } catch {
      removeIframe();
    }
  }

  function schedulePrint(): void {
    if (removed) return;
    const fontsReady = iframe.contentDocument?.fonts?.ready ?? Promise.resolve();
    // چاپ فقط پس از آماده‌شدن فونت‌ها (با یک مکث کوتاه برای اعمال رندر) و با سقف انتظار مشخص
    Promise.race([
      fontsReady.catch(() => undefined),
      new Promise<undefined>((resolve) => later(() => resolve(undefined), MAX_WAIT_FOR_FONTS_MS)),
    ]).then(() => {
      later(invokePrint, 120);
    });
  }

  function onLoad(): void {
    schedulePrint();
  }

  iframe.addEventListener('load', onLoad);
  if (iframe.contentWindow) iframe.contentWindow.addEventListener('afterprint', onAfterPrint);
  iframe.srcdoc = html;
  document.body.appendChild(iframe);

  // اگر رویداد load به هر دلیلی شلیک نشد، چاپ رها نمی‌شود
  later(invokePrint, MAX_WAIT_FOR_LOAD_MS);
  // آخرین سپر امنیتی: سند چاپ هرگز برای همیشه در صفحه نمی‌ماند
  later(removeIframe, FAILSAFE_MS);

  activeJob = handle;
  return handle;
}
