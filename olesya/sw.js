/* Olesya Messenger — service worker.
   Нужен для показа системных уведомлений (на Android их можно показать только
   через registration.showNotification) и для перехода в нужный чат по клику. */
self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

// Клик по уведомлению — фокусируем открытую вкладку (или открываем) и сообщаем, какой чат открыть
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const peer = event.notification.data && event.notification.data.peer;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { try { await c.focus(); } catch (e) {} if (peer) c.postMessage({ type: 'open-chat', peer }); return; }
    }
    if (self.clients.openWindow) {
      const u = await self.clients.openWindow('./' + (peer ? ('#chat=' + encodeURIComponent(peer)) : ''));
      if (u && peer) { try { u.postMessage({ type: 'open-chat', peer }); } catch (e) {} }
    }
  })());
});

// Push (для будущего серверного пуша через VAPID; сейчас не обязателен)
self.addEventListener('push', event => {
  let d = {}; try { d = event.data ? event.data.json() : {}; } catch (e) {}
  const title = d.title || 'Olesya Messenger';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'Новое сообщение', icon: d.icon, tag: d.tag || 'om-msg',
    data: { peer: d.peer || null }
  }));
});
