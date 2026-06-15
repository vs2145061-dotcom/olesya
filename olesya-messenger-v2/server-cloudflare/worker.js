/* Olesya Messenger — Cloudflare Worker API (binds D1: olesya-messenger-db)
   Deploy: see README. No secret keys live in the client — this Worker is the
   public API; the D1 binding stays server-side. */
const cors = {
  'content-type': 'application/json',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS'
};
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: cors });

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const u = new URL(req.url);
    const p = u.pathname;
    const db = env.DB;
    try {
      if (p === '/' || p === '/health')
        return J({ ok: true, service: 'olesya-messenger', ts: Date.now() });

      if (p === '/lookup') {
        const phone = u.searchParams.get('phone') || '';
        const r = await db.prepare(
          'SELECT id,phone,name,avatar,color,pass_hint FROM om_users WHERE phone=?'
        ).bind(phone).first();
        return J({ user: r || null });
      }

      if (p === '/register' && req.method === 'POST') {
        const b = await req.json();
        const ex = await db.prepare('SELECT id FROM om_users WHERE phone=?').bind(b.phone).first();
        if (ex) return J({ error: 'taken' }, 409);
        await db.prepare(
          'INSERT INTO om_users(id,phone,name,avatar,color,pass_hash,pass_hint,online,last_seen,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
        ).bind(b.id, b.phone, b.name, b.avatar || '🙂', b.color || '#6C7BFF',
               b.pass_hash, b.pass_hint || null, 1, Date.now(), Date.now()).run();
        return J({ ok: true });
      }

      if (p === '/login' && req.method === 'POST') {
        const b = await req.json();
        const r = await db.prepare(
          'SELECT id,phone,name,avatar,color,pass_hint FROM om_users WHERE phone=? AND pass_hash=?'
        ).bind(b.phone, b.hash).first();
        return J({ user: r || null });
      }

      if (p === '/send' && req.method === 'POST') {
        const m = await req.json();
        await db.prepare(
          'INSERT OR IGNORE INTO om_messages(id,chat_key,from_id,to_id,type,text,t) VALUES(?,?,?,?,?,?,?)'
        ).bind(m.id, m.chat_key, m.from_id, m.to_id, m.type || 'text', m.text || null, m.t || Date.now()).run();
        return J({ ok: true });
      }

      if (p === '/bus' && req.method === 'POST') {
        const b = await req.json();
        await db.prepare('INSERT INTO om_bus(to_id,payload,t) VALUES(?,?,?)')
          .bind(b.to || '*', JSON.stringify(b.payload), Date.now()).run();
        return J({ ok: true });
      }

      if (p === '/poll') {
        const uid = u.searchParams.get('uid') || '';
        const since = parseInt(u.searchParams.get('since') || '0', 10);
        const rs = await db.prepare(
          'SELECT seq,payload FROM om_bus WHERE (to_id=? OR to_id=?) AND seq>? ORDER BY seq LIMIT 100'
        ).bind(uid, '*', since).all();
        const events = (rs.results || []).map(r => ({ seq: r.seq, payload: JSON.parse(r.payload) }));
        return J({ events });
      }

      return J({ error: 'not_found' }, 404);
    } catch (e) {
      return J({ error: String((e && e.message) || e) }, 500);
    }
  }
};
