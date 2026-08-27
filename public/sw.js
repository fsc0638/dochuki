// 道中記 Service Worker——P5 範圍僅「殼層快取」：只快取靜態資源（JS/CSS bundle、
// icons、manifest），讓應用能被瀏覽器判定為可安裝。頁面與資料一律 network-only，
// 不快取——這裡處理的是金額資料，快取到舊帳比不快取更危險（P6 若要做離線佇列，
// 是另一套 IndexedDB outbox 設計，不是靠這支 SW 快取回應）。
//
// 只在正式環境註冊（見 src/components/ServiceWorkerRegister.tsx）；本檔仍加上
// 環境判斷是防禦性的第二道防線，不是唯一防線。

const SHELL_CACHE = "dochuki-shell-v1";
const SHELL_ASSETS = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  // 不用 cache.addAll()——它是全有全無，SHELL_ASSETS 裡任何一個因為網路
  // 波動抓失敗，install 就整個失敗、SW 直接被瀏覽器捨棄。改成各自獨立抓取，
  // 單一資源失敗不拖累其他資源已經成功快取的部分。
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(
        SHELL_ASSETS.map((url) => fetch(url).then((response) => cache.put(url, response))),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

// /_next/static/ 底下的檔案是內容雜湊命名，同名必同內容，cache-first
// 沒有「拿到舊版」的風險。manifest.json／icons 是固定路徑（不含雜湊），
// 內容改了但檔名不變——這兩者只能 network-first，優先拿新版，離線或
// 網路失敗時才退回快取，避免使用者永遠卡在安裝當下那份舊圖示/manifest
function isHashedAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isVersionlessShellAsset(url) {
  return url.pathname.startsWith("/icons/") || url.pathname === "/manifest.json";
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const clone = response.clone();
          // 快取寫入是額外的背景工作，不掛進 waitUntil 的話 SW 有可能在
          // 寫完之前就被瀏覽器判定閒置而終止，這次快取就悄悄沒寫成功
          event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone)));
          return response;
        });
      }),
    );
    return;
  }

  if (isVersionlessShellAsset(url)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone)));
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
  }
});
