/**
 * Service Worker: App, Bibliotheken und Weltkarte liegen im Cache.
 * config.json und daten/ kommen zuerst aus dem Netz, sonst aus dem Cache.
 * CACHE_VERSION hochzählen, wenn sich App-Dateien ändern.
 */

const CACHE_VERSION = 'v4';
const CACHE_NAME = `reisetracker-${CACHE_VERSION}`;

const APP_DATEIEN = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/crypto.js',
  './js/trip.js',
  './js/map.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/schiff.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
];

const CDN_DATEIEN = [
  'https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm',
  'https://cdn.jsdelivr.net/npm/d3-selection@3.0.0/+esm',
  'https://cdn.jsdelivr.net/npm/d3-zoom@3.0.0/+esm',
  'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm',
  'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json',
  'https://cdn.jsdelivr.net/fontsource/fonts/fredoka@5.2.8/latin-400-normal.woff2',
  'https://cdn.jsdelivr.net/fontsource/fonts/fredoka@5.2.8/latin-700-normal.woff2',
];

self.addEventListener('install', (ereignis) => {
  ereignis.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_DATEIEN);
    await cdnMitAbhaengigkeiten(cache, CDN_DATEIEN);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (ereignis) => {
  ereignis.waitUntil((async () => {
    const namen = await caches.keys();
    await Promise.all(
      namen
        .filter((name) => name.startsWith('reisetracker-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (ereignis) => {
  const anfrage = ereignis.request;
  if (anfrage.method !== 'GET') return;

  const url = new URL(anfrage.url);
  if (url.origin === self.location.origin && url.pathname.endsWith('/sw.js')) return;
  // Upload-Seite gehört nicht in den Eltern-Cache.
  if (istAdminDatei(url)) return;
  // GitHub-API nicht cachen, sonst wären Grüße veraltet.
  if (url.origin !== self.location.origin && url.hostname !== 'cdn.jsdelivr.net') return;

  if (istNetzwerkZuerst(url)) {
    ereignis.respondWith(netzwerkZuerst(anfrage));
    return;
  }

  ereignis.respondWith(cacheZuerst(anfrage));
});

function istAdminDatei(url) {
  if (url.origin !== self.location.origin) return false;
  return url.pathname.endsWith('/admin.html')
    || url.pathname.endsWith('/js/admin.js')
    || url.pathname.endsWith('/admin-manifest.json');
}

function istNetzwerkZuerst(url) {
  if (url.origin !== self.location.origin) return false;
  return url.pathname.endsWith('/config.json') || url.pathname.includes('/daten/');
}

async function netzwerkZuerst(anfrage) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const antwort = await fetch(anfrage);
    if (antwort.ok) await cache.put(anfrage, antwort.clone());
    return antwort;
  } catch {
    const gespeichert = await cache.match(anfrage);
    if (gespeichert) return gespeichert;
    throw new Error('offline');
  }
}

async function cacheZuerst(anfrage) {
  const cache = await caches.open(CACHE_NAME);
  const gespeichert = await cache.match(anfrage, { ignoreSearch: true });
  if (gespeichert) return gespeichert;
  const antwort = await fetch(anfrage);
  if (antwort.ok) await cache.put(anfrage, antwort.clone());
  return antwort;
}

/** jsDelivr-ESM zieht weitere /npm/…/+esm-Dateien nach. Die kommen mit in den Cache. */
async function cdnMitAbhaengigkeiten(cache, startUrls) {
  const gesehen = new Set();
  const warteschlange = [...startUrls];
  while (warteschlange.length > 0) {
    const adresse = warteschlange.pop();
    if (gesehen.has(adresse)) continue;
    gesehen.add(adresse);
    const antwort = await fetch(adresse);
    if (!antwort.ok) throw new Error(`cdn:${adresse}`);
    await cache.put(adresse, antwort.clone());
    const typ = antwort.headers.get('content-type') || '';
    if (!typ.includes('javascript') && !typ.includes('ecmascript')) continue;
    const text = await antwort.clone().text();
    for (const treffer of text.matchAll(/from\s*["'](\/npm\/[^"']+)["']/g)) {
      warteschlange.push(`https://cdn.jsdelivr.net${treffer[1]}`);
    }
  }
}
