const CACHE = "cositeca-v1";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "add.js",
  "edit.js",
  "ui.js",
  "rules.js",
  "manifest.webmanifest",
  "catalog.json",
  "meta.json",
  "assets/tmdb.svg",
  "assets/icon.svg",
];
const POSTER_LIMIT = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isPoster(url) {
  return url.hostname === "image.tmdb.org";
}

async function trimPosters(cache) {
  const keys = await cache.keys();
  const posters = keys.filter((req) => isPoster(new URL(req.url)));
  for (const req of posters.slice(0, Math.max(0, posters.length - POSTER_LIMIT))) {
    await cache.delete(req);
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      if (isPoster(new URL(request.url))) await trimPosters(cache);
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await cache.match("./");
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !isPoster(url)) return;
  event.respondWith(networkFirst(request));
});
