const CACHE_NAME = "labtrack-shell-economy-v2-logo";
const FALLBACK_URL = "/";
const APP_SHELL = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
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

async function cacheSameOrigin(request, response) {
  if (response?.ok && new URL(request.url).origin === self.location.origin) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Authentication and database responses are private and belong in the
  // user-scoped IndexedDB layer, never in a shared service-worker cache.
  if (isAppwriteRequest(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached = (await caches.match(request)) || (await caches.match(FALLBACK_URL));
        const network = fetch(request)
          .then((response) => cacheSameOrigin(request, response))
          .catch(() => null);

        if (cached) {
          event.waitUntil(network);
          return cached;
        }

        return (await network) || Response.error();
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        return await cacheSameOrigin(request, response);
      } catch {
        return cached || Response.error();
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }

  if (event.data?.type === "CACHE_URLS") {
    const urls = (event.data.urls || []).filter((value) => {
      try {
        return new URL(value, self.location.origin).origin === self.location.origin;
      } catch {
        return false;
      }
    });

    event.waitUntil(
      caches.open(CACHE_NAME).then(async (cache) => {
        for (const url of urls) {
          try {
            await cache.add(url);
          } catch {
            // One optional asset must not prevent the rest from being cached.
          }
        }
      })
    );
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "labtrack-sync") return;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        clients.forEach((client) =>
          client.postMessage({ type: "LABTRACK_CONNECTIVITY_RESTORED" })
        );
      })
  );
});
