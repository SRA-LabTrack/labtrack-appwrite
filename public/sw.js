const CACHE_NAME = "labtrack-shell-v1";
const FALLBACK_URL = "/";

const APP_SHELL = [
  "/",
  "/index.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Appwrite API traffic is handled by the IndexedDB offline layer. Never
  // place authenticated API responses inside the shared service-worker cache.
  if (
    url.hostname.includes("appwrite") ||
    url.pathname.startsWith("/v1/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/", copy));
          return response;
        })
        .catch(async () => {
          return (
            (await caches.match(request)) ||
            (await caches.match(FALLBACK_URL))
          );
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "labtrack-sync") return;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        clients.forEach((client) =>
          client.postMessage({ type: "LABTRACK_CONNECTIVITY_RESTORED" })
        );
      })
  );
});
