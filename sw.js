const APP_VERSION = "1.4.16";
const UPDATE_SUMMARY = "修复离线打开、备份恢复、简易分析与 Excel 数值导出。";
const CACHE_NAME = `research-notebook-${APP_VERSION}`;
const SCOPE = new URL(self.registration.scope);
const APP_ENTRY = new URL("index.html", SCOPE);
const APP_ASSETS = [
  "./index.html",
  "./styles.css?v=1.4.16",
  "./manifest.webmanifest?v=1.4.16",
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
  "./js/app.js?v=1.4.16",
  "./js/db.js?v=1.4.16",
  "./js/default-template.js?v=1.4.16",
  "./js/questionnaire-editor.js?v=1.4.16",
  "./js/questionnaire-schema.js?v=1.4.16",
  "./js/question-reorder.js?v=1.4.16",
  "./js/statistics.js?v=1.4.16",
  "./js/image-range.js?v=1.4.16",
  "./js/image-range-heatmap.js?v=1.4.16",
  "./js/image-angle.js?v=1.4.16",
  "./js/xlsx-export.js?v=1.4.16"
];

async function precacheApp() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(APP_ASSETS.map((asset) => new Request(new URL(asset, SCOPE), { cache: "reload" })));
  const entry = await cache.match(APP_ENTRY.href);
  if (!(await entry.text()).includes(`./js/app.js?v=${APP_VERSION}"`)) {
    throw new Error("App entry does not match the service worker version");
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheApp());
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
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  if (event.request.mode === "navigate") {
    if (url.pathname === SCOPE.pathname || url.pathname === APP_ENTRY.pathname) {
      // The active worker serves the entry point installed with its own assets.
      event.respondWith(caches.open(CACHE_NAME).then(async (cache) =>
        (await cache.match(APP_ENTRY.href)) || fetch(event.request)
      ));
    }
    return;
  }

  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(cache.put(event.request, copy).catch(() => {}));
    }
    return response;
  }));
});
