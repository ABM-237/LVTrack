// LVTrack - Service Worker v7
// Correction : l'application continue de s'ouvrir meme si le serveur repond
// une erreur (503, 500, 404...). Auparavant la page d'erreur etait servie ET
// mise en cache, ce qui rendait l'application inutilisable durablement.

const CACHE_NAME = 'lvtrack-v7';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
];

const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/umd/supabase.min.js',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        // Chaque fichier separement : un echec ne doit pas tout annuler.
        await Promise.all(
          APP_SHELL.map(u =>
            fetch(u, { cache: 'reload' })
              .then(r => (r.ok ? cache.put(u, r) : null))
              .catch(() => null)
          )
        );
        await Promise.all(
          LIBS.map(url =>
            fetch(url, { mode: 'cors' })
              .then(r => (r.ok ? cache.put(url, r) : null))
              .catch(() => null)
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isLib(url) {
  return LIBS.some(l => url.startsWith(l)) ||
    url.includes('cdnjs.cloudflare.com') ||
    url.includes('cdn.jsdelivr.net') ||
    url.includes('cdn.sheetjs.com') ||
    url.includes('fonts.googleapis.com') ||
    url.includes('fonts.gstatic.com');
}

// Reponse de secours quand tout echoue sur une navigation.
async function secours(request) {
  const cache = await caches.open(CACHE_NAME);
  return (await cache.match(request)) ||
         (await cache.match('./index.html')) ||
         (await cache.match('./')) ||
         new Response(
           '<!doctype html><meta charset="utf-8">' +
           '<div style="font-family:sans-serif;padding:24px;text-align:center">' +
           '<h2>LVTrack momentanement indisponible</h2>' +
           '<p>Le serveur ne repond pas et aucune version hors-ligne n\'est enregistree.</p>' +
           '<p>Reessayez dans quelques minutes.</p></div>',
           { headers: { 'Content-Type': 'text/html; charset=utf-8' }, status: 200 }
         );
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;

  if (req.method !== 'GET') return;

  // Donnees metier : reseau prioritaire, jamais de cache d'erreur.
  if (url.includes('supabase.co') || url.includes('lambda-url')) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Bibliotheques versionnees : cache prioritaire.
  if (isLib(url)) {
    e.respondWith(
      caches.match(req).then(cached => {
        const reseau = fetch(req).then(r => {
          if (r && r.ok) caches.open(CACHE_NAME).then(c => c.put(req, r.clone()));
          return r;
        }).catch(() => cached);
        return cached || reseau;
      })
    );
    return;
  }

  // Fichiers de l'application : reseau en premier, MAIS on ne met en cache
  // et on ne sert que les reponses valides. Toute erreur serveur bascule
  // sur la version hors-ligne.
  e.respondWith((async () => {
    try {
      const r = await fetch(req);
      if (r && r.ok) {
        const copie = r.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copie)).catch(() => {});
        return r;
      }
      // 503, 500, 404... : on prefere la version en cache.
      const cache = await caches.open(CACHE_NAME);
      const enCache = await cache.match(req);
      if (enCache) return enCache;
      if (req.mode === 'navigate') return await secours(req);
      return r;
    } catch (err) {
      // Hors ligne / reseau coupe.
      const cache = await caches.open(CACHE_NAME);
      const enCache = await cache.match(req);
      if (enCache) return enCache;
      if (req.mode === 'navigate') return await secours(req);
      throw err;
    }
  })());
});
