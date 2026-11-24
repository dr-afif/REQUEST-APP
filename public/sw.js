// Self-unregistering service worker to migrate legacy PWA users to the new ED-Roster app.
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      try {
        var keys = await caches.keys();
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      } catch (e) {}
      try {
        await self.registration.unregister();
      } catch (e) {}
      try {
        var clients = await self.clients.matchAll({ type: 'window' });
        clients.forEach(function (client) {
          client.navigate('https://dr-afif.github.io/ED-Roster/');
        });
      } catch (e) {}
    })()
  );
});
