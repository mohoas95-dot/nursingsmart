/*
 * Service Worker — کش دارایی‌های ایستا
 *
 * نسخهٔ قبلی این فایل هر درخواست را رهگیری می‌کرد و دقیقاً همان را دوباره
 * می‌فرستاد:
 *
 *   self.addEventListener('fetch', e => e.respondWith(fetch(e.request)));
 *
 * این کار هیچ سودی نداشت و فقط ضرر داشت: هر درخواست از رشتهٔ اصلی به Service
 * Worker و برگشت می‌رفت و مسیر بهینهٔ خود مرورگر دور زده می‌شد.
 *
 * نسخهٔ فعلی فقط دارایی‌های ایستای بدون تغییر (لوگو، آیکون‌ها) را با راهبرد
 * «کش-اول» نگه می‌دارد. درخواست‌های API و ناوبری عمداً دست‌نخورده رها می‌شوند تا
 * هرگز دادهٔ کهنه یا پاسخ احراز هویت کش نشود.
 */

const CACHE_NAME = 'nursingsmart-static-v1';

/** دارایی‌هایی که در نصب، پیش‌واکشی می‌شوند تا بازدید دوم آنی باشد. */
const PRECACHE_URLS = [
  '/logo.png',
  '/icon-192x192.png',
];

self.addEventListener('install', (event) => {
  // نسخهٔ جدید بدون انتظار برای بسته شدن تب‌های قدیمی فعال می‌شود.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim())
      .catch(() => undefined),
  );
});

/** فقط تصاویر و آیکون‌های ایستا کش می‌شوند. */
function isCacheableAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  return /\.(?:png|jpg|jpeg|svg|webp|avif|ico)$/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // هر چیز دیگری (API، ناوبری، اسکریپت‌ها) به مسیر پیش‌فرض مرورگر واگذار می‌شود.
  if (!isCacheableAsset(url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // فقط پاسخ کامل و موفق کش می‌شود (نه ۲۰۶ یا خطا).
        if (response.ok && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      });
    }).catch(() => fetch(request)),
  );
});
