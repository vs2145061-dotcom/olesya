-- ============================================================
--  Olesya Messenger — настройка Supabase (бесплатный план)
--  1) Создайте проект на supabase.com (Free: 500 МБ БД, 1 ГБ файлы, 50k MAU)
--  2) SQL Editor → вставьте и выполните этот файл
--  3) Settings → API → скопируйте Project URL и anon public key
--  4) Вставьте их в приложении: Настройки → Облачный сервер → Supabase
-- ============================================================

create table if not exists om_users (
  id text primary key,
  phone text unique not null,
  name text not null,
  avatar text,
  color text,
  pass_hash text not null,
  pass_hint text,
  online int default 0,
  last_seen bigint,
  created_at bigint
);

create table if not exists om_messages (
  id text primary key,
  chat_key text not null,
  from_id text not null,
  to_id text not null,
  type text not null default 'text',
  text text,
  t bigint not null
);
create index if not exists om_messages_chat on om_messages(chat_key, t);

create table if not exists om_bus (
  seq bigserial primary key,
  to_id text not null,
  payload text not null,
  t bigint not null
);
create index if not exists om_bus_to on om_bus(to_id, seq);

-- RLS. ВНИМАНИЕ: политики ниже — демо-уровень (открытый доступ для anon-ключа),
-- этого достаточно для прототипа/стартапа на раннем этапе. Для продакшена
-- ужесточите правила (привязка к auth.uid(), серверная проверка пароля и т.п.).
alter table om_users    enable row level security;
alter table om_messages enable row level security;
alter table om_bus      enable row level security;

create policy om_users_all    on om_users    for all using (true) with check (true);
create policy om_messages_all on om_messages for all using (true) with check (true);
create policy om_bus_all      on om_bus      for all using (true) with check (true);

-- Realtime (необязательно, для мгновенной доставки):
alter publication supabase_realtime add table om_bus;
