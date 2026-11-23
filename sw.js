/*
 * オフライン用サービスワーカー
 * 一度ひらいたページは端末に保存され、電波がなくても遊べる。
 * ネットにつながっていれば最新版を取りにいく（stale-while-revalidate）。
 * ファイル一覧を書かなくていいので、ゲームを足しても修正不要。
 */
const CACHE = "eg-v1";
const CORE = ["./", "./index.html", "./shared/core.css", "./shared/core.js", "./games/registry.js", "./manifest.webmanifest", "./icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
      const fresh = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
