/* ═══════════════════════════════════════════════════════════════════
   Olesya Messenger — Production API Worker v3
   Cloudflare Worker + D1 (olesya-messenger-db)

   РЕЖИМЫ АВТОРИЗАЦИИ (приоритет сверху вниз):
   1. Firebase Phone Auth (БЕСПЛАТНО 10 000 SMS/мес)
      → клиент верифицирует через Firebase SDK
      → передаёт Firebase ID-токен в POST /auth/firebase
      → Worker проверяет через Firebase REST API
   2. Custom OTP (Twilio + Vonage)
      → POST /otp/send → /otp/verify (только если Firebase не настроен)

   ОБЯЗАТЕЛЬНЫЕ SECRETS:
   ─────────────────────────────────────────────────────────────────
   SESSION_SECRET       — случайная строка 64+ символа
   FIREBASE_PROJECT_ID  — ID проекта из Firebase Console
   FIREBASE_WEB_API_KEY — Web API Key из Firebase Console
                          (Project Settings → General → Web API Key)

   ОПЦИОНАЛЬНЫЕ (для режима Custom OTP как резерв):
   TWILIO_SID / TWILIO_TOKEN / TWILIO_FROM
   VONAGE_KEY / VONAGE_SECRET / VONAGE_FROM
   ═══════════════════════════════════════════════════════════════════ */

/* Разрешённые источники. Можно переопределить переменной ALLOWED_ORIGINS
   (список через запятую) или '*' для совместимости. По умолчанию — сайт на GitHub Pages. */
const DEFAULT_ALLOWED = ['https://vs2145061-dotcom.github.io'];
function corsHeaders(req, env) {
  const allowed = (env && env.ALLOWED_ORIGINS)
    ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : DEFAULT_ALLOWED;
  const origin = req.headers.get('Origin') || '';
  // нет Origin (нативное приложение / same-origin) → разрешаем; '*' в списке → открыто
  const allow = (!origin || allowed.includes('*') || allowed.includes(origin)) ? (origin || '*') : '';
  const h = {
    'content-type': 'application/json',
    'access-control-allow-headers': 'content-type,x-session-token',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'vary': 'Origin'
  };
  if (allow) h['access-control-allow-origin'] = allow;
  return h;
}
const ts = () => Date.now();

/* ── Новости (RSS из интернета, тянутся сервером — без CORS-проблем у клиента) ── */
const FEED_SOURCES = {
  news:    ['https://lenta.ru/rss/news', 'https://rssexport.rbc.ru/rbcnews/news/30/full.rss'],
  finance: ['https://rssexport.rbc.ru/rbcnews/finances/30/full.rss', 'https://lenta.ru/rss/news/economics'],
  stories: ['https://nplus1.ru/rss', 'https://lenta.ru/rss/articles']
};
function rssClean(s) { return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim(); }
function rssStrip(s) {
  return rssClean(s).replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}
function parseRss(xml) {
  const items = [];
  const blocks = String(xml).split(/<item[\s>]/i).slice(1);
  for (const raw of blocks) {
    const seg = raw.split(/<\/item>/i)[0];
    const pick = tag => { const m = seg.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i')); return m ? m[1] : ''; };
    const title = rssStrip(pick('title'));
    let link = rssClean(pick('link'));
    if (!link) { const m = seg.match(/<link[^>]*href="([^"]+)"/i); if (m) link = m[1]; }
    let desc = pick('description') || pick('yandex:full-text') || '';
    let img = ''; const em = seg.match(/<enclosure[^>]*url="([^"]+)"/i) || seg.match(/<media:content[^>]*url="([^"]+)"/i) || seg.match(/<media:thumbnail[^>]*url="([^"]+)"/i);
    if (em) img = em[1];
    if (!img) { const im = String(desc).match(/<img[^>]*src="([^"]+)"/i); if (im) img = im[1]; }
    const date = rssClean(pick('pubDate'));
    desc = rssStrip(desc).slice(0, 400);
    if (title) items.push({ title, link, summary: desc, date, image: img });
  }
  return items;
}

/* ── Telegram-канал как новостная лента: парсим публичную страницу t.me/s/<channel> ── */
function tgChannelName(raw) {
  return String(raw || '').trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '')
    .replace(/^s\//, '')
    .split(/[/?#]/)[0]
    .replace(/[^A-Za-z0-9_]/g, '');
}
function parseTelegram(html) {
  const items = [];
  const blocks = String(html).split(/<div class="tgme_widget_message[ "]/i).slice(1);
  for (const raw of blocks) {
    const seg = raw;
    let link = ''; const lm = seg.match(/<a class="tgme_widget_message_date"[^>]*href="([^"]+)"/i); if (lm) link = lm[1];
    let date = ''; const dm = seg.match(/<time[^>]*datetime="([^"]+)"/i); if (dm) date = dm[1];
    let text = ''; const tm = seg.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)
                          || seg.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (tm) text = rssStrip(tm[1].replace(/<br\s*\/?>/gi, '\n'));
    let img = ''; const im = seg.match(/tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*background-image:url\('([^']+)'\)/i); if (im) img = im[1];
    if (text || img) {
      const firstLine = (text.split('\n').find(l => l.trim()) || 'Пост').slice(0, 140);
      items.push({ title: firstLine, text, summary: text.slice(0, 600), link, date, image: img });
    }
  }
  return items.reverse(); // на странице — от старых к новым; разворачиваем к «свежие сверху»
}

function randCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

async function hmac(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function makeToken(uid, secret) {
  const payload = uid + ':' + ts() + ':' + randCode();
  const sig = await hmac(payload, secret);
  return btoa(payload + ':' + sig).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

/* ── Firebase ID-token verification via REST API ── */
async function verifyFirebaseToken(idToken, env) {
  if (!env.FIREBASE_WEB_API_KEY || !env.FIREBASE_PROJECT_ID)
    throw new Error('Firebase secrets not configured');
  const resp = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }) }
  );
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error('Firebase lookup failed: ' + t.slice(0, 200));
  }
  const data = await resp.json();
  const user = data.users?.[0];
  if (!user) throw new Error('Token invalid or revoked');
  if (!user.phoneNumber) throw new Error('No phone number in Firebase user');
  return { phone: user.phoneNumber, firebaseUid: user.localId };
}

/* ── SMS-провайдер SMSC.ru (HTTP API, JSON-ответ fmt=3) ── */
async function sendViaSMSC(env, to, code) {
  const url = 'https://smsc.ru/sys/send.php?' + new URLSearchParams({
    login: env.SMSC_LOGIN, psw: env.SMSC_PASSWORD,
    phones: to, mes: 'Kod dlya vhoda v Olesya Messenger: ' + code,
    fmt: '3', charset: 'utf-8'
  }).toString();
  const r = await fetch(url);
  const d = await r.json();
  if (d.error || d.error_code) throw new Error('SMSC: ' + (d.error || ('code '+d.error_code)));
  return d;
}
async function sendSMS(env, phone, code) {
  const to = phone.startsWith('+') ? phone : ('+' + phone);
  if (!env.SMSC_LOGIN || !env.SMSC_PASSWORD) throw new Error('SMS not configured');
  await sendViaSMSC(env, to, code);
}

/* ── Авторизация запроса по session-токену → возвращает user_id или null ── */
async function authUser(db, req) {
  const token = req.headers.get('x-session-token') || '';
  if (!token) return null;
  const s = await db.prepare(
    'SELECT user_id FROM om_sessions WHERE token=? AND expires_at>?'
  ).bind(token, ts()).first();
  return (s && s.user_id) ? s.user_id : null;
}

/* ── Shared: найти или создать пользователя по телефону, выдать session ── */
async function loginOrPromptSetup(db, phone, secret, J) {
  const t = ts();
  const existing = await db.prepare(
    'SELECT id,phone,name,avatar,color FROM om_users WHERE phone=?'
  ).bind(phone).first();

  const token = await makeToken(existing?.id || 'new:'+phone, secret);
  const expires = t + 30 * 24 * 60 * 60 * 1000;

  if (existing) {
    await db.prepare('INSERT INTO om_sessions(token,user_id,phone,expires_at,created_at) VALUES(?,?,?,?,?)')
      .bind(token, existing.id, phone, expires, t).run();
    return J({ ok: true, status: 'existing', session_token: token, user: existing });
  } else {
    // Временная сессия до завершения регистрации
    await db.prepare('INSERT INTO om_sessions(token,user_id,phone,expires_at,created_at) VALUES(?,?,?,?,?)')
      .bind(token, '', phone, t + 30 * 60 * 1000, t).run();
    return J({ ok: true, status: 'new', session_token: token });
  }
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const u = new URL(req.url);
    const p = u.pathname;
    const db = env.DB;
    try {

      /* ── health ── */
      if (p === '/' || p === '/health')
        return J({ ok: true, service: 'olesya-messenger', ts: ts(),
          firebase: !!(env.FIREBASE_WEB_API_KEY && env.FIREBASE_PROJECT_ID),
          media: !!env.MEDIA, translate: !!env.ANTHROPIC_API_KEY,
          sms: !!(env.SMSC_LOGIN && env.SMSC_PASSWORD) });

      /* ══════════════════════════════════════════════════════════
         POST /auth/firebase
         body: { idToken: "<Firebase ID token от клиента>" }
         → { ok, status: 'existing'|'new', session_token, user? }
         ════════════════════════════════════════════════════════ */
      if (p === '/auth/firebase' && req.method === 'POST') {
        const { idToken } = await req.json();
        if (!idToken) return J({ error: 'missing_id_token' }, 400);
        let fbUser;
        try { fbUser = await verifyFirebaseToken(idToken, env); }
        catch (e) { return J({ error: 'firebase_token_invalid', detail: e.message }, 401); }
        return loginOrPromptSetup(db, fbUser.phone, env.SESSION_SECRET, J);
      }

      /* ══════════════════════════════════════════════════════════
         POST /otp/send  (Custom OTP — резерв без Firebase)
         ════════════════════════════════════════════════════════ */
      if (p === '/otp/send' && req.method === 'POST') {
        const { phone } = await req.json();
        if (!phone || !/^\+?\d{7,15}$/.test(phone.trim()))
          return J({ error: 'invalid_phone', message: 'Неверный формат номера' }, 400);
        const phoneN = phone.trim();
        const t = ts();
        const recent = await db.prepare(
          'SELECT COUNT(*) AS c FROM om_otp WHERE phone=? AND created_at>?'
        ).bind(phoneN, t - 10*60*1000).first();
        if ((recent?.c || 0) >= 3) {
          const oldest = await db.prepare(
            'SELECT created_at FROM om_otp WHERE phone=? ORDER BY created_at ASC LIMIT 1'
          ).bind(phoneN).first();
          const retry = Math.ceil((oldest.created_at + 10*60*1000 - t) / 1000);
          return J({ error: 'rate_limit', retry_after: retry,
            message: `Подождите ${Math.ceil(retry/60)} мин` }, 429);
        }
        const code = randCode();
        const hash = await hmac(code, env.SESSION_SECRET);
        await db.prepare('DELETE FROM om_otp WHERE phone=? AND expires_at<?').bind(phoneN, t).run();
        await db.prepare('INSERT INTO om_otp(phone,code_hash,expires_at,attempts,created_at) VALUES(?,?,?,0,?)')
          .bind(phoneN, hash, t + 10*60*1000, t).run();
        await sendSMS(env, phoneN, code);
        return J({ ok: true, expires_in: 600 });
      }

      /* POST /otp/verify ── */
      if (p === '/otp/verify' && req.method === 'POST') {
        const { phone, code } = await req.json();
        if (!phone || !code) return J({ error: 'missing_fields' }, 400);
        const phoneN = phone.trim();
        const t = ts();
        const row = await db.prepare(
          'SELECT rowid,code_hash,expires_at,attempts FROM om_otp WHERE phone=? AND expires_at>? ORDER BY created_at DESC LIMIT 1'
        ).bind(phoneN, t).first();
        if (!row) return J({ error: 'code_not_found', message: 'Код устарел. Запросите новый.' }, 404);
        if (row.attempts >= 5) return J({ error: 'too_many_attempts', message: 'Слишком много попыток.' }, 429);
        const inputHash = await hmac(code.trim().replace(/\D/g,''), env.SESSION_SECRET);
        if (inputHash !== row.code_hash) {
          await db.prepare('UPDATE om_otp SET attempts=attempts+1 WHERE rowid=?').bind(row.rowid).run();
          return J({ error: 'wrong_code', attempts_left: Math.max(0, 5 - (row.attempts + 1)), message: 'Неверный код' }, 401);
        }
        await db.prepare('DELETE FROM om_otp WHERE phone=?').bind(phoneN).run();
        return loginOrPromptSetup(db, phoneN, env.SESSION_SECRET, J);
      }

      /* POST /register ── */
      if (p === '/register' && req.method === 'POST') {
        const token = req.headers.get('x-session-token') || '';
        const sess = await db.prepare(
          'SELECT user_id,phone,expires_at FROM om_sessions WHERE token=? AND expires_at>?'
        ).bind(token, ts()).first();
        if (!sess) return J({ error: 'unauthorized' }, 401);
        if (sess.user_id) return J({ error: 'already_registered' }, 409);
        const b = await req.json();
        const phoneN = sess.phone;
        const userId = b.id || crypto.randomUUID();
        const ex = await db.prepare('SELECT id FROM om_users WHERE phone=?').bind(phoneN).first();
        if (ex) return J({ error: 'taken' }, 409);
        await db.prepare(
          'INSERT INTO om_users(id,phone,name,avatar,color,pass_hash,pass_hint,online,last_seen,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
        ).bind(userId, phoneN, b.name, b.avatar||'🙂', b.color||'#6C7BFF', '', null, 1, ts(), ts()).run();
        await db.prepare('UPDATE om_sessions SET user_id=?, expires_at=? WHERE token=?')
          .bind(userId, ts() + 30*24*60*60*1000, token).run();
        const user = await db.prepare('SELECT id,phone,name,avatar,color FROM om_users WHERE id=?').bind(userId).first();
        return J({ ok: true, user });
      }

      /* GET /lookup?phone=... (только для авторизованных — защита от перебора) ── */
      if (p === '/lookup') {
        const me = await authUser(db, req);
        if (!me) return J({ error: 'unauthorized' }, 401);
        const phone = u.searchParams.get('phone') || '';
        const r = await db.prepare('SELECT id,phone,name,avatar,color FROM om_users WHERE phone=?').bind(phone).first();
        return J({ user: r || null });
      }

      /* GET /me ── */
      if (p === '/me') {
        const token = req.headers.get('x-session-token') || '';
        const r = await db.prepare(
          'SELECT u.id,u.phone,u.name,u.avatar,u.color FROM om_sessions s JOIN om_users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?'
        ).bind(token, ts()).first();
        if (!r) return J({ error: 'unauthorized' }, 401);
        return J({ user: r });
      }

      /* POST /logout ── */
      if (p === '/logout' && req.method === 'POST') {
        const token = req.headers.get('x-session-token') || '';
        await db.prepare('DELETE FROM om_sessions WHERE token=?').bind(token).run();
        return J({ ok: true });
      }

      /* POST /send ── */
      if (p === '/send' && req.method === 'POST') {
        const me = await authUser(db, req);
        if (!me) return J({ error: 'unauthorized' }, 401);
        const m = await req.json();
        if (!m.id || !m.chat_key) return J({ error: 'missing_fields' }, 400);
        // нельзя отправлять от чужого имени
        if (m.from_id && m.from_id !== me) return J({ error: 'forbidden' }, 403);
        await db.prepare(
          'INSERT OR IGNORE INTO om_messages(id,chat_key,from_id,to_id,type,text,data_url,dur,orig,orig_lang,t) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
        ).bind(m.id, m.chat_key, me, m.to_id, m.type||'text', m.text||null,
               m.data_url||null, (m.dur!=null?m.dur:null), m.orig||null, m.orig_lang||null, m.t||ts()).run();
        return J({ ok: true });
      }

      /* GET /messages?chat_key=...&since=... — история переписки (синхронизация) ── */
      if (p === '/messages') {
        const me = await authUser(db, req);
        if (!me) return J({ error: 'unauthorized' }, 401);
        const chatKey = u.searchParams.get('chat_key') || '';
        const since = parseInt(u.searchParams.get('since') || '0', 10);
        if (!chatKey) return J({ error: 'missing_chat_key' }, 400);
        // chat_key имеет вид "idA__idB" — пускаем только участника чата
        if (!chatKey.split('__').includes(me)) return J({ error: 'forbidden' }, 403);
        const rs = await db.prepare(
          'SELECT id,chat_key,from_id,to_id,type,text,data_url,dur,orig,orig_lang,t FROM om_messages WHERE chat_key=? AND t>? ORDER BY t LIMIT 200'
        ).bind(chatKey, since).all();
        return J({ messages: rs.results || [] });
      }

      /* POST /bus ── */
      if (p === '/bus' && req.method === 'POST') {
        const me = await authUser(db, req);
        if (!me) return J({ error: 'unauthorized' }, 401);
        const b = await req.json();
        await db.prepare('INSERT INTO om_bus(to_id,payload,t) VALUES(?,?,?)')
          .bind(b.to||'*', JSON.stringify(b.payload), ts()).run();
        // ретенция шины: события старше 6 часов больше не нужны (история — в om_messages)
        await db.prepare('DELETE FROM om_bus WHERE t < ?').bind(ts() - 6*60*60*1000).run();
        return J({ ok: true });
      }

      /* GET /poll?uid=...&since=... ── */
      if (p === '/poll') {
        const me = await authUser(db, req);
        if (!me) return J({ error: 'unauthorized' }, 401);
        const uid = u.searchParams.get('uid') || '';
        // можно читать только собственный поток событий
        if (uid && uid !== me) return J({ error: 'forbidden' }, 403);
        const since = parseInt(u.searchParams.get('since')||'0', 10);
        const rs = await db.prepare(
          'SELECT seq,payload FROM om_bus WHERE (to_id=? OR to_id=?) AND seq>? ORDER BY seq LIMIT 100'
        ).bind(uid, '*', since).all();
        const events = (rs.results||[]).map(r => ({ seq: r.seq, payload: JSON.parse(r.payload) }));
        return J({ events });
      }

      /* ══════════════════════════════════════════════════════════
         POST /translate  — прокси перевода через Claude (ключ в secrets)
         body: { text, target, targetName? }
         Требует secret ANTHROPIC_API_KEY (модель — ANTHROPIC_MODEL или Haiku 4.5)
         ════════════════════════════════════════════════════════ */
      if (p === '/translate' && req.method === 'POST') {
        const me = await authUser(db, req);
        if (!me) return J({ error: 'unauthorized' }, 401);
        if (!env.ANTHROPIC_API_KEY) return J({ error: 'translate_not_configured' }, 503);
        const { text, target, targetName } = await req.json();
        if (!text || !target) return J({ error: 'missing_fields' }, 400);
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
            max_tokens: 1000,
            messages: [{ role: 'user',
              content: 'Translate the message into ' + (targetName || target) + ' (' + target +
                       '). Output ONLY the translation.\n\n' + text }]
          })
        });
        if (!r.ok) return J({ error: 'translate_failed', detail: (await r.text()).slice(0, 200) }, 502);
        const d = await r.json();
        const out = ((d && d.content) || []).map(c => c.text || '').join('').trim();
        if (!out) return J({ error: 'empty' }, 502);
        return J({ ok: true, text: out, engine: 'Claude AI' });
      }

      /* POST /media — загрузка медиа в R2, возвращает { url } (требует binding MEDIA) ── */
      if (p === '/media' && req.method === 'POST') {
        const me = await authUser(db, req);
        if (!me) return J({ error: 'unauthorized' }, 401);
        if (!env.MEDIA) return J({ error: 'media_not_configured' }, 503);
        const ct = req.headers.get('content-type') || 'application/octet-stream';
        const buf = await req.arrayBuffer();
        if (!buf || buf.byteLength === 0) return J({ error: 'empty' }, 400);
        if (buf.byteLength > 20 * 1024 * 1024) return J({ error: 'too_large' }, 413);
        const ext = (ct.split('/')[1] || 'bin').split(';')[0].replace(/[^a-z0-9]/gi, '') || 'bin';
        const key = me + '/' + crypto.randomUUID() + '.' + ext;
        await env.MEDIA.put(key, buf, { httpMetadata: { contentType: ct } });
        return J({ ok: true, url: '/media/' + key });
      }

      /* GET /media/<key> — отдать медиа из R2 (ключ непредсказуем) ── */
      if (p.startsWith('/media/') && req.method === 'GET') {
        if (!env.MEDIA) return J({ error: 'media_not_configured' }, 503);
        const key = decodeURIComponent(p.slice('/media/'.length));
        const obj = await env.MEDIA.get(key);
        if (!obj) return J({ error: 'not_found' }, 404);
        const h = new Headers(cors);
        obj.writeHttpMetadata(h);
        h.set('cache-control', 'public, max-age=31536000, immutable');
        return new Response(obj.body, { headers: h });
      }

      /* POST /profile — обновить свой профиль (имя/аватар/цвет, синхронизация на все устройства и контакты) ── */
      if (p === '/profile' && req.method === 'POST') {
        const me = await authUser(db, req);
        if (!me) return J({ error: 'unauthorized' }, 401);
        const b = await req.json();
        const sets = [], vals = [];
        if (typeof b.name === 'string' && b.name.trim()) { sets.push('name=?'); vals.push(b.name.trim().slice(0, 64)); }
        if (typeof b.avatar === 'string') { sets.push('avatar=?'); vals.push(b.avatar.slice(0, 200000)); }
        if (typeof b.color === 'string') { sets.push('color=?'); vals.push(b.color.slice(0, 32)); }
        if (!sets.length) return J({ error: 'nothing_to_update' }, 400);
        vals.push(me);
        await db.prepare('UPDATE om_users SET ' + sets.join(',') + ' WHERE id=?').bind(...vals).run();
        const user = await db.prepare('SELECT id,phone,name,avatar,color FROM om_users WHERE id=?').bind(me).first();
        return J({ ok: true, user });
      }

      /* GET /profile?id=... — публичный профиль пользователя (чтобы видеть свежий аватар собеседника) ── */
      if (p === '/profile' && req.method === 'GET') {
        const me = await authUser(db, req);
        if (!me) return J({ error: 'unauthorized' }, 401);
        const id = u.searchParams.get('id') || '';
        if (!id) return J({ error: 'missing_id' }, 400);
        const user = await db.prepare('SELECT id,name,avatar,color FROM om_users WHERE id=?').bind(id).first();
        return J({ user: user || null });
      }

      /* GET /feed?cat=news|finance|stories — лента новостей из интернета ── */
      if (p === '/feed') {
        const me = await authUser(db, req);
        if (!me) return J({ error: 'unauthorized' }, 401);
        const cat = (u.searchParams.get('cat') || 'news').toLowerCase();
        const urls = FEED_SOURCES[cat] || FEED_SOURCES.news;
        let xml = null, used = '';
        for (const url of urls) {
          try {
            const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 OlesyaMessenger' }, cf: { cacheTtl: 300 } });
            if (r.ok) { xml = await r.text(); used = url; break; }
          } catch (e) {}
        }
        if (!xml) return J({ error: 'feed_unavailable' }, 502);
        return J({ ok: true, cat, source: used, items: parseRss(xml).slice(0, 24) });
      }

      /* GET /tg?channel=<name> — посты публичного Telegram-канала как новостная лента ── */
      if (p === '/tg') {
        const me = await authUser(db, req);
        if (!me) return J({ error: 'unauthorized' }, 401);
        const ch = tgChannelName(u.searchParams.get('channel') || '');
        if (!ch) return J({ error: 'missing_channel' }, 400);
        let html = null;
        try {
          const r = await fetch('https://t.me/s/' + ch, { headers: { 'user-agent': 'Mozilla/5.0 OlesyaMessenger' }, cf: { cacheTtl: 120 } });
          if (r.ok) html = await r.text();
        } catch (e) {}
        if (!html) return J({ error: 'tg_unavailable' }, 502);
        return J({ ok: true, channel: ch, items: parseTelegram(html).slice(0, 30) });
      }

      /* POST /ai — встроенный ИИ (Claude): пересказ новостей и помощь ── */
      if (p === '/ai' && req.method === 'POST') {
        const me = await authUser(db, req);
        if (!me) return J({ error: 'unauthorized' }, 401);
        if (!env.ANTHROPIC_API_KEY) return J({ error: 'ai_not_configured' }, 503);
        const { prompt } = await req.json();
        if (!prompt) return J({ error: 'missing_prompt' }, 400);
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: env.ANTHROPIC_MODEL || 'claude-haiku-4-5', max_tokens: 700,
            messages: [{ role: 'user', content: String(prompt).slice(0, 8000) }]
          })
        });
        if (!r.ok) return J({ error: 'ai_failed', detail: (await r.text()).slice(0, 200) }, 502);
        const d = await r.json();
        const out = ((d && d.content) || []).map(c => c.text || '').join('').trim();
        if (!out) return J({ error: 'empty' }, 502);
        return J({ ok: true, text: out });
      }

      return J({ error: 'not_found' }, 404);
    } catch(e) {
      console.error('Worker error:', e);
      return J({ error: 'server_error', detail: String(e?.message||e) }, 500);
    }
  }
};
