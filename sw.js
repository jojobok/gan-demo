'use strict';
// Service worker: lets the installed app open without internet.
//
// What is stored on the device: ONLY the app's own files (HTML, CSS, JS, icons),
// taken from index.html. Nothing else is ever cached: no Supabase/API request,
// no other-origin request, no data about children or staff.
//
// Strategy for those app files: network first (online = always the newest version),
// device copy only when the network fails.
const CACHE = 'gan-crm-shell-v1';
const FIXED = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/brand.png', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];

async function shellFiles() {
  // every <script src> and <link href> that index.html loads, so the list never goes stale
  const html = await (await fetch('index.html', { cache: 'no-store' })).text();
  const refs = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(u => !/^[a-z]+:/i.test(u));
  return [...new Set(FIXED.concat(refs))];
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(await shellFiles());
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE && key.startsWith('gan-crm-')) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase and every other server: never touched
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const known = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    if (!known) return fetch(req); // not an app file: straight to the network, never stored
    try {
      const fresh = await fetch(req, { cache: 'no-store' });
      if (fresh.ok) await cache.put(key, fresh.clone());
      return fresh;
    } catch (e) {
      return known; // offline: the app files from the device
    }
  })());
});
