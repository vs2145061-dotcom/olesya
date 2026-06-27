// ═══════════════════════════════════════════════════════════════
//  Olesya Messenger — Worker (вставьте этот код в редактор Cloudflare)
//  dash.cloudflare.com → Workers & Pages → ваш воркер → Edit code
//  Ctrl+A → Delete → Ctrl+V (вставить) → Deploy
//
//  ПЕРЕМЕННЫЕ (Settings → Variables and Secrets → Add):
//  SESSION_SECRET       = любые 64 случайных символа
//  FIREBASE_PROJECT_ID  = messenger-olesya123
//  FIREBASE_WEB_API_KEY = ваш Web API Key из Firebase Console
//
//  BINDING (Settings → Bindings → Add → D1 Database):
//  Variable name: DB   →   Database: olesya-messenger-db
// ═══════════════════════════════════════════════════════════════

export default {
  async fetch(req, env) {
    // CORS: разрешённые источники (ALLOWED_ORIGINS через запятую, '*' = открыто).
    // По умолчанию — сайт на GitHub Pages.
    const allowedOrigins = (env.ALLOWED_ORIGINS)
      ? env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
      : ['https://vs2145061-dotcom.github.io'];
    const reqOrigin = req.headers.get('Origin') || '';
    const allowOrigin = (!reqOrigin || allowedOrigins.includes('*') || allowedOrigins.includes(reqOrigin))
      ? (reqOrigin || '*') : '';
    const cors = {
      'content-type': 'application/json',
      'access-control-allow-headers': 'content-type,x-session-token',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'vary': 'Origin'
    };
    if (allowOrigin) cors['access-control-allow-origin'] = allowOrigin;
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });
    const now = () => Date.now();

    /* ── Новости (RSS, тянутся сервером) ── */
    const FEED_SOURCES = {
      news:    ['https://lenta.ru/rss/news', 'https://rssexport.rbc.ru/rbcnews/news/30/full.rss'],
      finance: ['https://rssexport.rbc.ru/rbcnews/finances/30/full.rss', 'https://lenta.ru/rss/news/economics'],
      stories: ['https://nplus1.ru/rss', 'https://lenta.ru/rss/articles']
    };
    const rssClean = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    const rssStrip = s => rssClean(s).replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
    function parseRss(xml) {
      const items = [];
      const blocks = String(xml).split(/<item[\s>]/i).slice(1);
      for (const raw of blocks) {
        const seg = raw.split(/<\/item>/i)[0];
        const pick = tag => { const m = seg.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i')); return m ? m[1] : ''; };
        const title = rssStrip(pick('title'));
        let link = rssClean(pick('link'));
        if (!link) { const m = seg.match(/<link[^>]*href="([^"]+)"/i); if (m) link = m[1]; }
        let desc = pick('description') || '';
        let img = ''; const em = seg.match(/<enclosure[^>]*url="([^"]+)"/i) || seg.match(/<media:content[^>]*url="([^"]+)"/i) || seg.match(/<media:thumbnail[^>]*url="([^"]+)"/i);
        if (em) img = em[1];
        if (!img) { const im = String(desc).match(/<img[^>]*src="([^"]+)"/i); if (im) img = im[1]; }
        const date = rssClean(pick('pubDate'));
        desc = rssStrip(desc).slice(0, 400);
        if (title) items.push({ title, link, summary: desc, date, image: img });
      }
      return items;
    }
    /* ── Telegram-канал как новости: t.me/s/<channel> ── */
    const tgChannelName = raw => String(raw || '').trim()
      .replace(/^@/, '').replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '').replace(/^s\//, '')
      .split(/[/?#]/)[0].replace(/[^A-Za-z0-9_]/g, '');
    function parseTelegram(html) {
      const items = [];
      const blocks = String(html).split(/<div class="tgme_widget_message[ "]/i).slice(1);
      for (const seg of blocks) {
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
      return items.reverse();
    }

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const u = new URL(req.url);
    const p = u.pathname;
    const db = env.DB;

    // Генерация токена
    async function makeToken(uid) {
      const data = uid + ':' + now() + ':' + Math.random();
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET || 'fallback'),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
      const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
      return btoa(data + ':' + hex).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
    }

    // Хэш для OTP
    async function hashCode(code) {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET || 'fallback'),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(code));
      return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
    }

    // Авторизация по session-токену → user_id или null
    async function authUser() {
      const token = req.headers.get('x-session-token') || '';
      if (!token) return null;
      const s = await db.prepare('SELECT user_id FROM om_sessions WHERE token=? AND expires_at>?')
        .bind(token, now()).first();
      return (s && s.user_id) ? s.user_id : null;
    }

    // Вход или начало регистрации
    async function loginOrSetup(phone) {
      const t = now();
      const user = await db.prepare('SELECT id,phone,name,avatar,color FROM om_users WHERE phone=?').bind(phone).first();
      const token = await makeToken(user?.id || 'new:' + phone);
      const exp = user ? t + 30*24*60*60*1000 : t + 30*60*1000;
      await db.prepare('INSERT INTO om_sessions(token,user_id,phone,expires_at,created_at) VALUES(?,?,?,?,?)')
        .bind(token, user?.id || '', phone, exp, t).run();
      if (user) return J({ ok:true, status:'existing', session_token:token, user });
      return J({ ok:true, status:'new', session_token:token });
    }

    try {
      // Проверка работоспособности
      if (p === '/' || p === '/health')
        return J({ ok:true, service:'olesya-messenger', ts:now(),
          firebase: !!(env.FIREBASE_WEB_API_KEY), db: !!db,
          media: !!env.MEDIA, translate: !!env.ANTHROPIC_API_KEY,
          sms: !!(env.SMSC_LOGIN && env.SMSC_PASSWORD) });

      // ═══════════════════════════════════════════════════════════
      // POST /otp/send — отправка SMS-кода через SMSC.ru (для РФ-номеров)
      //   body: { phone: "+7..." }
      //   Требует secrets: SMSC_LOGIN, SMSC_PASSWORD
      // ═══════════════════════════════════════════════════════════
      if (p === '/otp/send' && req.method === 'POST') {
        const { phone } = await req.json();
        if (!phone || !/^\+?\d{7,15}$/.test(String(phone).trim()))
          return J({ error:'invalid_phone', message:'Неверный формат номера' }, 400);
        if (!env.SMSC_LOGIN || !env.SMSC_PASSWORD)
          return J({ error:'sms_not_configured', message:'SMS-провайдер не настроен' }, 503);
        const phoneN = String(phone).trim();
        const t = now();
        // Rate-limit: не более 3 кодов за 10 минут на номер
        const recent = await db.prepare(
          'SELECT COUNT(*) AS c FROM om_otp WHERE phone=? AND created_at>?'
        ).bind(phoneN, t - 10*60*1000).first();
        if ((recent?.c || 0) >= 3) {
          const oldest = await db.prepare(
            'SELECT created_at FROM om_otp WHERE phone=? ORDER BY created_at ASC LIMIT 1'
          ).bind(phoneN).first();
          const retry = Math.ceil(((oldest?.created_at||t) + 10*60*1000 - t) / 1000);
          return J({ error:'rate_limit', retry_after:retry,
            message:`Подождите ${Math.ceil(retry/60)} мин перед повторным запросом` }, 429);
        }
        // Генерируем код, храним только HMAC-хэш
        const code = String(Math.floor(100000 + Math.random()*900000));
        const codeHash = await hashCode(code);
        await db.prepare('DELETE FROM om_otp WHERE phone=? AND expires_at<?').bind(phoneN, t).run();
        await db.prepare('INSERT INTO om_otp(phone,code_hash,expires_at,attempts,created_at) VALUES(?,?,?,0,?)')
          .bind(phoneN, codeHash, t + 10*60*1000, t).run();
        // Отправка через SMSC.ru (HTTP API, JSON-ответ)
        const smscUrl = 'https://smsc.ru/sys/send.php?' + new URLSearchParams({
          login: env.SMSC_LOGIN, psw: env.SMSC_PASSWORD,
          phones: phoneN, mes: 'Kod dlya vhoda v Olesya Messenger: ' + code,
          fmt: '3', charset: 'utf-8'
        }).toString();
        try {
          const r = await fetch(smscUrl);
          const d = await r.json();
          if (d.error || d.error_code) {
            return J({ error:'sms_failed', detail: d.error || ('code '+d.error_code),
              message:'Не удалось отправить SMS. Попробуйте позже.' }, 502);
          }
        } catch(e) {
          return J({ error:'sms_failed', detail:String(e?.message||e),
            message:'SMS-сервис недоступен' }, 502);
        }
        return J({ ok:true, expires_in:600 });
      }

      // POST /otp/verify — проверка SMS-кода, вход или начало регистрации
      //   body: { phone: "+7...", code: "123456" }
      if (p === '/otp/verify' && req.method === 'POST') {
        const { phone, code } = await req.json();
        if (!phone || !code) return J({ error:'missing_fields' }, 400);
        const phoneN = String(phone).trim();
        const t = now();
        const row = await db.prepare(
          'SELECT rowid,code_hash,expires_at,attempts FROM om_otp WHERE phone=? AND expires_at>? ORDER BY created_at DESC LIMIT 1'
        ).bind(phoneN, t).first();
        if (!row) return J({ error:'code_not_found', message:'Код устарел. Запросите новый.' }, 404);
        if (row.attempts >= 5) return J({ error:'too_many_attempts', message:'Слишком много попыток. Запросите новый код.' }, 429);
        const inputHash = await hashCode(String(code).trim().replace(/\D/g,''));
        if (inputHash !== row.code_hash) {
          await db.prepare('UPDATE om_otp SET attempts=attempts+1 WHERE rowid=?').bind(row.rowid).run();
          return J({ error:'wrong_code', attempts_left: Math.max(0, 4 - row.attempts), message:'Неверный код' }, 401);
        }
        await db.prepare('DELETE FROM om_otp WHERE phone=?').bind(phoneN).run();
        return loginOrSetup(phoneN);
      }

      // POST /auth/firebase — верификация через Firebase ID-токен
      if (p === '/auth/firebase' && req.method === 'POST') {
        const { idToken } = await req.json();
        if (!idToken) return J({ error:'missing_id_token' }, 400);
        if (!env.FIREBASE_WEB_API_KEY) return J({ error:'firebase_not_configured' }, 500);
        const r = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`,
          { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ idToken }) }
        );
        if (!r.ok) return J({ error:'firebase_token_invalid' }, 401);
        const data = await r.json();
        const fbUser = data.users?.[0];
        if (!fbUser?.phoneNumber) return J({ error:'no_phone_in_token' }, 401);
        return loginOrSetup(fbUser.phoneNumber);
      }

      // POST /register — завершение регистрации нового пользователя
      if (p === '/register' && req.method === 'POST') {
        const token = req.headers.get('x-session-token') || '';
        const sess = await db.prepare(
          'SELECT user_id,phone FROM om_sessions WHERE token=? AND expires_at>?'
        ).bind(token, now()).first();
        if (!sess) return J({ error:'unauthorized' }, 401);
        if (sess.user_id) return J({ error:'already_registered' }, 409);
        const b = await req.json();
        const userId = b.id || crypto.randomUUID();
        const ex = await db.prepare('SELECT id FROM om_users WHERE phone=?').bind(sess.phone).first();
        if (ex) return J({ error:'taken' }, 409);
        await db.prepare(
          'INSERT INTO om_users(id,phone,name,avatar,color,pass_hash,pass_hint,online,last_seen,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
        ).bind(userId, sess.phone, b.name, b.avatar||'🙂', b.color||'#6C7BFF', '', null, 1, now(), now()).run();
        await db.prepare('UPDATE om_sessions SET user_id=?,expires_at=? WHERE token=?')
          .bind(userId, now()+30*24*60*60*1000, token).run();
        const user = await db.prepare('SELECT id,phone,name,avatar,color FROM om_users WHERE id=?').bind(userId).first();
        return J({ ok:true, user });
      }

      // GET /me
      if (p === '/me') {
        const token = req.headers.get('x-session-token') || '';
        const r = await db.prepare(
          'SELECT u.id,u.phone,u.name,u.avatar,u.color FROM om_sessions s JOIN om_users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>?'
        ).bind(token, now()).first();
        if (!r) return J({ error:'unauthorized' }, 401);
        return J({ user:r });
      }

      // POST /logout
      if (p === '/logout' && req.method === 'POST') {
        const token = req.headers.get('x-session-token') || '';
        await db.prepare('DELETE FROM om_sessions WHERE token=?').bind(token).run();
        return J({ ok:true });
      }

      // GET /lookup?phone=... (только для авторизованных — защита от перебора)
      if (p === '/lookup') {
        const me = await authUser();
        if (!me) return J({ error:'unauthorized' }, 401);
        const phone = u.searchParams.get('phone') || '';
        const r = await db.prepare('SELECT id,phone,name,avatar,color FROM om_users WHERE phone=?').bind(phone).first();
        return J({ user:r || null });
      }

      // POST /send
      if (p === '/send' && req.method === 'POST') {
        const me = await authUser();
        if (!me) return J({ error:'unauthorized' }, 401);
        const m = await req.json();
        if (!m.id || !m.chat_key) return J({ error:'missing_fields' }, 400);
        if (m.from_id && m.from_id !== me) return J({ error:'forbidden' }, 403);
        await db.prepare(
          'INSERT OR IGNORE INTO om_messages(id,chat_key,from_id,to_id,type,text,data_url,dur,orig,orig_lang,t) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
        ).bind(m.id, m.chat_key, me, m.to_id, m.type||'text', m.text||null,
               m.data_url||null, (m.dur!=null?m.dur:null), m.orig||null, m.orig_lang||null, m.t||now()).run();
        return J({ ok:true });
      }

      // GET /messages?chat_key=...&since=... — история переписки (синхронизация)
      if (p === '/messages') {
        const me = await authUser();
        if (!me) return J({ error:'unauthorized' }, 401);
        const chatKey = u.searchParams.get('chat_key') || '';
        const since = parseInt(u.searchParams.get('since')||'0', 10);
        if (!chatKey) return J({ error:'missing_chat_key' }, 400);
        if (!chatKey.split('__').includes(me)) return J({ error:'forbidden' }, 403);
        const rs = await db.prepare(
          'SELECT id,chat_key,from_id,to_id,type,text,data_url,dur,orig,orig_lang,t FROM om_messages WHERE chat_key=? AND t>? ORDER BY t LIMIT 200'
        ).bind(chatKey, since).all();
        return J({ messages: rs.results || [] });
      }

      // POST /bus
      if (p === '/bus' && req.method === 'POST') {
        const me = await authUser();
        if (!me) return J({ error:'unauthorized' }, 401);
        const b = await req.json();
        await db.prepare('INSERT INTO om_bus(to_id,payload,t) VALUES(?,?,?)')
          .bind(b.to||'*', JSON.stringify(b.payload), now()).run();
        // ретенция шины: события старше 6 часов больше не нужны (история — в om_messages)
        await db.prepare('DELETE FROM om_bus WHERE t < ?').bind(now() - 6*60*60*1000).run();
        return J({ ok:true });
      }

      // GET /poll?uid=...&since=...
      if (p === '/poll') {
        const me = await authUser();
        if (!me) return J({ error:'unauthorized' }, 401);
        const uid = u.searchParams.get('uid') || '';
        if (uid && uid !== me) return J({ error:'forbidden' }, 403);
        const since = parseInt(u.searchParams.get('since')||'0', 10);
        const rs = await db.prepare(
          'SELECT seq,payload FROM om_bus WHERE (to_id=? OR to_id=?) AND seq>? ORDER BY seq LIMIT 100'
        ).bind(uid, '*', since).all();
        return J({ events:(rs.results||[]).map(r=>({seq:r.seq, payload:JSON.parse(r.payload)})) });
      }

      // POST /translate — прокси перевода через Claude (ключ ANTHROPIC_API_KEY в secrets)
      if (p === '/translate' && req.method === 'POST') {
        const me = await authUser();
        if (!me) return J({ error:'unauthorized' }, 401);
        if (!env.ANTHROPIC_API_KEY) return J({ error:'translate_not_configured' }, 503);
        const { text, target, targetName } = await req.json();
        if (!text || !target) return J({ error:'missing_fields' }, 400);
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method:'POST',
          headers:{ 'content-type':'application/json', 'x-api-key':env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
          body: JSON.stringify({
            model: env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
            max_tokens: 1000,
            messages: [{ role:'user', content:'Translate the message into ' + (targetName||target) + ' (' + target + '). Output ONLY the translation.\n\n' + text }]
          })
        });
        if (!r.ok) return J({ error:'translate_failed', detail:(await r.text()).slice(0,200) }, 502);
        const d = await r.json();
        const out = ((d && d.content) || []).map(c => c.text || '').join('').trim();
        if (!out) return J({ error:'empty' }, 502);
        return J({ ok:true, text: out, engine:'Claude AI' });
      }

      // POST /media — загрузка медиа в R2 (требует binding MEDIA), возвращает { url }
      if (p === '/media' && req.method === 'POST') {
        const me = await authUser();
        if (!me) return J({ error:'unauthorized' }, 401);
        if (!env.MEDIA) return J({ error:'media_not_configured' }, 503);
        const ct = req.headers.get('content-type') || 'application/octet-stream';
        const buf = await req.arrayBuffer();
        if (!buf || buf.byteLength === 0) return J({ error:'empty' }, 400);
        if (buf.byteLength > 20*1024*1024) return J({ error:'too_large' }, 413);
        const ext = (ct.split('/')[1] || 'bin').split(';')[0].replace(/[^a-z0-9]/gi,'') || 'bin';
        const key = me + '/' + crypto.randomUUID() + '.' + ext;
        await env.MEDIA.put(key, buf, { httpMetadata:{ contentType: ct } });
        return J({ ok:true, url:'/media/' + key });
      }

      // GET /media/<key> — отдать медиа из R2
      if (p.startsWith('/media/') && req.method === 'GET') {
        if (!env.MEDIA) return J({ error:'media_not_configured' }, 503);
        const key = decodeURIComponent(p.slice('/media/'.length));
        const obj = await env.MEDIA.get(key);
        if (!obj) return J({ error:'not_found' }, 404);
        const h = new Headers(cors);
        obj.writeHttpMetadata(h);
        h.set('cache-control', 'public, max-age=31536000, immutable');
        return new Response(obj.body, { headers: h });
      }

      /* POST /profile — обновить свой профиль (имя/аватар/цвет) ── */
      if (p === '/profile' && req.method === 'POST') {
        const me = await authUser();
        if (!me) return J({ error:'unauthorized' }, 401);
        const b = await req.json();
        const sets = [], vals = [];
        if (typeof b.name === 'string' && b.name.trim()) { sets.push('name=?'); vals.push(b.name.trim().slice(0,64)); }
        if (typeof b.avatar === 'string') { sets.push('avatar=?'); vals.push(b.avatar.slice(0,200000)); }
        if (typeof b.color === 'string') { sets.push('color=?'); vals.push(b.color.slice(0,32)); }
        if (!sets.length) return J({ error:'nothing_to_update' }, 400);
        vals.push(me);
        await db.prepare('UPDATE om_users SET ' + sets.join(',') + ' WHERE id=?').bind(...vals).run();
        const user = await db.prepare('SELECT id,phone,name,avatar,color FROM om_users WHERE id=?').bind(me).first();
        return J({ ok:true, user });
      }

      /* GET /profile?id=... — публичный профиль (свежий аватар собеседника) ── */
      if (p === '/profile' && req.method === 'GET') {
        const me = await authUser();
        if (!me) return J({ error:'unauthorized' }, 401);
        const id = u.searchParams.get('id') || '';
        if (!id) return J({ error:'missing_id' }, 400);
        const user = await db.prepare('SELECT id,name,avatar,color FROM om_users WHERE id=?').bind(id).first();
        return J({ user: user || null });
      }

      /* GET /feed?cat=news|finance|stories — новости из интернета ── */
      if (p === '/feed') {
        const me = await authUser();
        if (!me) return J({ error:'unauthorized' }, 401);
        const cat = (u.searchParams.get('cat') || 'news').toLowerCase();
        const urls = FEED_SOURCES[cat] || FEED_SOURCES.news;
        let xml = null, used = '';
        for (const url of urls) {
          try { const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 OlesyaMessenger' }, cf: { cacheTtl: 300 } }); if (r.ok) { xml = await r.text(); used = url; break; } } catch (e) {}
        }
        if (!xml) return J({ error:'feed_unavailable' }, 502);
        return J({ ok:true, cat, source: used, items: parseRss(xml).slice(0, 24) });
      }

      /* GET /tg?channel=<name> — посты публичного Telegram-канала как новости ── */
      if (p === '/tg') {
        const me = await authUser();
        if (!me) return J({ error:'unauthorized' }, 401);
        const ch = tgChannelName(u.searchParams.get('channel') || '');
        if (!ch) return J({ error:'missing_channel' }, 400);
        let html = null;
        try { const r = await fetch('https://t.me/s/' + ch, { headers: { 'user-agent': 'Mozilla/5.0 OlesyaMessenger' }, cf: { cacheTtl: 120 } }); if (r.ok) html = await r.text(); } catch (e) {}
        if (!html) return J({ error:'tg_unavailable' }, 502);
        return J({ ok:true, channel: ch, items: parseTelegram(html).slice(0, 30) });
      }

      /* POST /ai — встроенный ИИ (Claude): пересказ новостей и помощь ── */
      if (p === '/ai' && req.method === 'POST') {
        const me = await authUser();
        if (!me) return J({ error:'unauthorized' }, 401);
        if (!env.ANTHROPIC_API_KEY) return J({ error:'ai_not_configured' }, 503);
        const { prompt } = await req.json();
        if (!prompt) return J({ error:'missing_prompt' }, 400);
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type':'application/json', 'x-api-key':env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
          body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-haiku-4-5', max_tokens: 700, messages: [{ role:'user', content: String(prompt).slice(0, 8000) }] })
        });
        if (!r.ok) return J({ error:'ai_failed' }, 502);
        const d = await r.json();
        const out = ((d && d.content) || []).map(c => c.text || '').join('').trim();
        if (!out) return J({ error:'empty' }, 502);
        return J({ ok:true, text: out });
      }

      return J({ error:'not_found' }, 404);

    } catch(e) {
      return J({ error:'server_error', detail: String(e?.message||e) }, 500);
    }
  }
};
