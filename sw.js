// LVTrack — Service Worker v6 (vrai support hors-ligne)
const CACHE_NAME = 'lvtrack-v6';

// Fichiers de l'application elle-même (même origine).
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// Bibliothèques externes dont l'app a besoin pour fonctionner — sans elles,
// l'app ne peut pas démarrer du tout hors-ligne (Supabase, Excel, ZIP, graphiques).
// Elles sont versionnées dans l'URL, donc sans risque de rester en cache longtemps.
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/umd/supabase.min.js',
  'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => caches.open(CACHE_NAME))
      .then(async cache => {
        await cache.addAll(APP_SHELL);
        // Chaque lib est ajoutée séparément : si une CDN est indisponible au
        // moment de l'installation, ça ne doit pas empêcher le reste de marcher.
        await Promise.all(
          LIBS.map(url =>
            fetch(url, { mode: 'cors' })
              .then(resp => resp.ok && cache.put(url, resp))
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

self.addEventListener('fetch', e => {
  const url = e.request.url;

  if (url.includes('supabase.co')) {
    // Données métier : toujours essayer le réseau en premier (on ne veut
    // jamais afficher une écriture périmée), l'app gère elle-même son cache
    // local (localStorage) pour la consultation hors-ligne.
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  if (isLib(url)) {
    // Bibliothèques versionnées : servir depuis le cache en priorité (rapide
    // et fonctionne hors-ligne), tout en rafraîchissant le cache en arrière-plan.
    e.respondWith(
      caches.match(e.request).then(cached => {
        const network = fetch(e.request).then(resp => {
          if (resp.ok) caches.open(CACHE_NAME).then(c => c.put(e.request, resp.clone()));
          return resp;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Fichiers de l'app elle-même : réseau en premier pour avoir les mises à
  // jour, secours sur le cache si hors-ligne.
  e.respondWith(
    fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      return resp;
    }).catch(() => caches.match(e.request))
  );
});
