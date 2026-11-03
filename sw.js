// オフラインでも開けるように、アプリ本体をキャッシュする。
// ファイルを変更したら VERSION を上げると、次回起動時に新しい版へ入れ替わる。
const VERSION = 'v2';
const CACHE = `job-change-app-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './js/app.js',
  './js/store.js',
  './js/model.js',
  './js/legacy.js',
  './js/firebase-config.js',
  './vendor/firebase.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ネット優先・失敗したらキャッシュ（更新をすぐ反映しつつオフラインでも動く）
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))),
  );
});
