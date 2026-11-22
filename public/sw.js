/* Service worker KIVMO : coquille hors ligne et page de saisie d'un plein.
   Les pages contenant des données personnelles (historique, garage, projets…) ne sont jamais
   gardées sur le téléphone, et tout est effacé à la déconnexion (adresse « /?deconnecte=1 »).
   Aucune requête d'écriture n'est mise en cache ni rejouée automatiquement :
   les pleins hors ligne sont gérés par la file visible de l'application. */
const CACHE = "kivmo-v2";
// Seules pages gardées pour un usage hors ligne.
const OFFLINE_PAGES = ["/pleins/nouveau"];
const SHELL = ["/hors-ligne", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    if (url.searchParams.has("deconnecte")) {
      e.waitUntil(caches.delete(CACHE).then(() => caches.open(CACHE)).then((c) => c.addAll(SHELL)));
    }
    const keep = OFFLINE_PAGES.includes(url.pathname);
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (keep && res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(() => (keep ? caches.match(url.pathname) : Promise.resolve(undefined)).then((r) => r || caches.match("/hors-ligne"))),
    );
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.endsWith(".svg") || url.pathname.endsWith(".png")) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })));
  }
});
