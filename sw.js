const APP_VERSION = "1.3.8";
const UPDATE_SUMMARY = "本次更新：首页问卷背景支持换行，问卷编辑后可选择保存新版本或另存为独立副本。已有问卷、记录和草稿不会被覆盖。";
const CACHE_NAME = `research-notebook-${APP_VERSION}`;
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=1.3.8",
  "./manifest.webmanifest?v=1.3.8",
  "./assets/App-icon2.svg",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/ear-pain-points.png",
  "./assets/arrow-left.svg",
  "./assets/chevron-right.svg",
  "./assets/check.svg",
  "./assets/trash.svg",
  "./assets/copy.svg",
  "./assets/plus.svg",
  "./js/app.js?v=1.3.8",
  "./js/db.js?v=1.3.8",
  "./js/default-template.js?v=1.3.8",
  "./js/questionnaire-editor.js?v=1.3.8",
  "./js/questionnaire-schema.js?v=1.3.8",
  "./js/question-reorder.js?v=1.3.8",
  "./js/statistics.js?v=1.3.8"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION") event.ports?.[0]?.postMessage({ version: APP_VERSION });
  if (event.data?.type === "GET_VERSION_INFO") event.ports?.[0]?.postMessage({ version: APP_VERSION, summary: UPDATE_SUMMARY });
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(async () => (await caches.match(event.request)) || caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
