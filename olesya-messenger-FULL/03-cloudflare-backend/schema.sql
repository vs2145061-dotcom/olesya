-- Olesya Messenger — Production Database Schema v2
-- Применить: wrangler d1 execute olesya-messenger-db --file=schema.sql

-- Пользователи
CREATE TABLE IF NOT EXISTS om_users(
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT DEFAULT '🙂',
  color TEXT DEFAULT '#6C7BFF',
  pass_hash TEXT DEFAULT '',
  pass_hint TEXT,
  online INTEGER DEFAULT 0,
  last_seen INTEGER,
  created_at INTEGER
);

-- OTP-коды (генерируются сервером, клиент кода не видит)
CREATE TABLE IF NOT EXISTS om_otp(
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  code_hash TEXT NOT NULL,       -- HMAC-SHA256 кода (ключ SESSION_SECRET)
  expires_at INTEGER NOT NULL,   -- мс с эпохи
  attempts INTEGER DEFAULT 0,    -- счётчик неверных попыток
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS om_otp_phone ON om_otp(phone, created_at);

-- Сессии (токены авторизации)
CREATE TABLE IF NOT EXISTS om_sessions(
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,         -- '' пока пользователь не завершил регистрацию
  phone TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS om_sessions_user ON om_sessions(user_id);

-- Сообщения
CREATE TABLE IF NOT EXISTS om_messages(
  id TEXT PRIMARY KEY,
  chat_key TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text',
  text TEXT,
  data_url TEXT,
  dur INTEGER,
  orig TEXT,
  orig_lang TEXT,
  reactions TEXT DEFAULT '{}',
  read_by TEXT DEFAULT '[]',
  t INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS om_messages_chat ON om_messages(chat_key, t);

-- Шина событий (real-time через polling)
CREATE TABLE IF NOT EXISTS om_bus(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  to_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  t INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS om_bus_to ON om_bus(to_id, seq);
