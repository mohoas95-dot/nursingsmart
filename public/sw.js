self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// این بخش شرط اصلی کروم برای معتبر شناختن PWA است
self.addEventListener('fetch', (event) => {
  // در حال حاضر فقط درخواست‌ها را عبور می‌دهد اما شرط کروم را پاس می‌کند
  event.respondWith(fetch(event.request));
});

