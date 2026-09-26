/* ZORVELD — service worker.
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

/* Адрес сервера. Служебный поток живёт отдельно от страницы и её настроек не
   видит, поэтому адрес здесь свой. Тот же, что у страницы по умолчанию. */
const СЕРВЕР = 'https://d5d5j7dqdhjflpo07rpo.iwzqm34r.apigw.yandexcloud.net';

/* Кто это и как его назвать. Имя, а если его нет — номер телефона: владелец
   26.09.2026 просил показывать номер, когда имя неизвестно. */
function какЗовут(о) {
  const имя = String((о && о.имя) || '').trim();
  if (имя) return имя;
  const тел = String((о && о.телефон) || '').trim();
  return тел || '';
}

/* Спросить у сервера, что пришло. Сигнал push от нас приходит ПУСТЫМ: положить
   в него содержимое можно только зашифровав ключами подписки, а сервер этого
   пока не умеет. Поэтому спрашиваем сами — по адресу собственной подписки,
   который служба доставки выдала лично этому браузеру. */
async function чтоПришло() {
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (!sub || !sub.endpoint) return null;
    /* Две с половиной секунды. Уведомление ОБЯЗАНО быть показано, иначе система
       посчитает push бесполезным и в следующий раз может его не доставить.
       Лучше общий текст вовремя, чем точный с опозданием. */
    const стоп = new AbortController();
    const т = setTimeout(() => { try { стоп.abort(); } catch (e) {} }, 2500);
    const о = await fetch(СЕРВЕР + '/push/what', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
      signal: стоп.signal,
    });
    clearTimeout(т);
    if (!о.ok) return null;
    return await о.json();
  } catch (e) { return null; }
}

self.addEventListener('push', event => {
  /* Содержимое, если оно вдруг пришло, важнее наших догадок. */
  let d = {}; try { d = event.data ? event.data.json() : {}; } catch (e) {}
  event.waitUntil((async () => {
    let title = d.title || 'ZORVELD';
    let body = d.body || '';
    let tag = d.tag || 'om-msg';
    if (!body) {
      const что = await чтоПришло();
      const кто = какЗовут(что);
      if (что && что.вид === 'звонок') {
        title = '📞 ZORVELD';
        body = кто ? ('Входящий звонок от ' + кто) : 'Входящий звонок';
        /* Своя метка: новый вызов заменяет старое уведомление о вызове, а не
           копится стопкой. У сообщений метка другая, они не мешают звонку. */
        tag = 'om-call';
      } else {
        body = кто ? ('Новое сообщение от ' + кто) : 'Новое сообщение';
      }
    }
    await self.registration.showNotification(title, {
      body: body, icon: d.icon, tag: tag,
      data: { peer: d.peer || null }
    });
  })());
});
