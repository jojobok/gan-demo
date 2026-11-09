'use strict';
// Installable app: register the service worker (classic script, loaded last).
// Only on a real web address (http/https). Not when the page is opened from a file,
// and not inside a frame (e.g. a preview), where it would not belong to the app.
(function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol) || EMBEDDED) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(err => console.warn('service worker not registered:', err && err.message));
  });
})();
