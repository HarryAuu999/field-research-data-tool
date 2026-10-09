const APP_VERSION = "1.4.3";
const UPDATE_SUMMARY = "热力图改为连续人数色阶与收紧羽化，截面图换成黑色曲线；问卷和记录保留。";
const CACHE_NAME = `research-notebook-${APP_VERSION}`;
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=1.4.3",
  "./manifest.webmanifest?v=1.4.3",
  "./assets/App-icon2.svg",
  "./assets/icon-180.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/ear-pain-points.png",
  "./assets/ear-side.png",
  "./assets/ear-side-section.png",
  "./assets/ear-back.png",
  "./examples/ear-image-range-test.json",
  "./assets/arrow-left.svg",
  "./assets/chevron-right.svg",
  "./assets/check.svg",
  "./assets/trash.svg",
  "./assets/copy.svg",
  "./assets/plus.svg",
  "./js/app.js?v=1.4.3",
  "./js/db.js?v=1.4.3",
  "./js/default-template.js?v=1.4.3",
  "./js/questionnaire-editor.js?v=1.4.3",
  "./js/questionnaire-schema.js?v=1.4.3",
  "./js/question-reorder.js?v=1.4.3",
  "./js/statistics.js?v=1.4.3",
  "./js/image-range.js?v=1.4.3",
  "./js/image-range-heatmap.js?v=1.4.3",
  "./js/xlsx-export.js?v=1.4.3"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("research-notebook-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
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
