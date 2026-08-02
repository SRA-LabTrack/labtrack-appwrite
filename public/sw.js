const CACHE_NAME = "labtrack-client-write-text-repair-20260802";
const FALLBACK_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(["/", "/index.html"]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("labtrack-shell-") && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isAppwriteRequest(url) {
  return url.hostname.includes("appwrite") || url.pathname.startsWith("/v1/");
}

async function cacheStatic(request, response) {
  const url = new URL(request.url);

  if (
    response?.ok &&
    url.origin === self.location.origin &&
    request.method === "GET" &&
    request.destination !== "document"
  ) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }

  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isAppwriteRequest(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => response)
        .catch(async () => {
          return (
            (await caches.match(request)) ||
            (await caches.match(FALLBACK_URL)) ||
            Response.error()
          );
        })
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);

      try {
        const response = await fetch(request);
        return await cacheStatic(request, response);
      } catch {
        return cached || Response.error();
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
