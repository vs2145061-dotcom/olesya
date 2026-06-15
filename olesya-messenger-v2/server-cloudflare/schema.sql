-- Уже применено к базе olesya-messenger-db. Файл — на случай пересоздания.
CREATE TABLE IF NOT EXISTS om_users(
  id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  avatar TEXT, color TEXT, pass_hash TEXT NOT NULL, pass_hint TEXT,
  online INTEGER DEFAULT 0, last_seen INTEGER, sessions TEXT DEFAULT '{}', created_at INTEGER);
CREATE TABLE IF NOT EXISTS om_messages(
  id TEXT PRIMARY KEY, chat_key TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text', text TEXT, data_url TEXT, dur INTEGER,
  orig TEXT, orig_lang TEXT, reactions TEXT DEFAULT '{}', read_by TEXT DEFAULT '[]', t INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS om_messages_chat ON om_messages(chat_key, t);
CREATE TABLE IF NOT EXISTS om_bus(
  seq INTEGER PRIMARY KEY AUTOINCREMENT, to_id TEXT NOT NULL, payload TEXT NOT NULL, t INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS om_bus_to ON om_bus(to_id, seq);
