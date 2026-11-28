/*
 * オフライン用サービスワーカー
 *  - ネットにつながっているときは、いつも最新版を取りにいく（ネットワーク優先）
 *  - つながらないとき（オフライン・3秒以上かかるとき）は、端末に保存した版を使う
 *  - ファイル一覧を書かなくていいので、ゲームを足しても修正不要
 * VERSION は version.js と同じ値にする（変わると古い保存を消して入れかわる）
 */
const VERSION = "261128.5";
const CACHE = "eg-" + VERSION;
const CORE = ["./", "./index.html", "./version.js", "./hub/hub.css", "./hub/hub.js", "./shared/core.css", "./shared/core.js", "./shared/cloud.js", "./games/registry.js", "./manifest.webmanifest", "./icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      // ブラウザの HTTP キャッシュも通さずに最新を取る。3秒で返ってこなければ保存した版
      const res = await Promise.race([
        fetch(req, { cache: "no-cache" }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
      ]);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      const cached = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
      if (cached) return cached;
      return fetch(req);
    }
  })());
});
