/* 离线缓存：应用外壳缓存优先，导航请求失败回退 index.html */

const VERSION = 'v1.0.1';
const CACHE = `sampling-photo-${VERSION}`;
const DOC = './index.html';

const ASSETS = [
  './',
  DOC,
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/config.js',
  './js/router.js',
  './js/util.js',
  './js/db.js',
  './js/categories.js',
  './js/watermark.js',
  './js/camera.js',
  './js/importer.js',
  './js/forms.js',
  './js/exporter.js',
  './js/views/list.js',
  './js/views/batch.js',
  './js/views/camera.js',
  './js/views/photo.js',
  './js/views/export.js',
  './js/views/settings.js',
  './js/vendor/fflate.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('缓存安装失败', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (!res || !res.ok) throw new Error('navigate failed');
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(DOC, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(DOC).then(r => r || new Response('离线状态，请先联网打开一次。', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        // 后台更新
        fetch(req).then(res => {
          if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res)).catch(() => {});
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
