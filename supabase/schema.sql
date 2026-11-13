-- Zero · схема Supabase
-- Выполните этот файл в Supabase → SQL Editor → New query → Run.
-- Колонка `phone` — это ключ аккаунта. Сейчас в ней хранится email (Gmail),
-- название оставлено для совместимости со старой схемой.

create table if not exists public.zero_states (
  phone text primary key,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.zero_states enable row level security;

-- Демо-политики для publishable/anon ключа.
-- Внимание: любой, у кого есть ключ, может читать/писать эти записи.
-- Для продакшена замените на Supabase Auth и политики по auth.uid().
drop policy if exists "zero_states read" on public.zero_states;
create policy "zero_states read"
  on public.zero_states for select
  using (true);

drop policy if exists "zero_states insert" on public.zero_states;
create policy "zero_states insert"
  on public.zero_states for insert
  with check (true);

drop policy if exists "zero_states update" on public.zero_states;
create policy "zero_states update"
  on public.zero_states for update
  using (true)
  with check (true);

create index if not exists zero_states_updated_at_idx
  on public.zero_states (updated_at desc);

-- ── Настоящий чат между людьми ─────────────────────────────────────
-- Профили: по ним приложение ищет людей по @username / Gmail.
create table if not exists public.zero_profiles (
  email text primary key,
  username text not null,
  name text not null,
  avatar text,
  bio text not null default '',
  status text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists zero_profiles_username_idx
  on public.zero_profiles (lower(username));

-- Сообщения: conversation = «меньший email|больший email».
create table if not exists public.zero_messages (
  id uuid primary key default gen_random_uuid(),
  client_id text,
  conversation text not null,
  sender_email text not null,
  recipient_email text not null,
  sender_name text not null default '',
  sender_username text not null default '',
  sender_avatar text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists zero_messages_conversation_idx
  on public.zero_messages (conversation, created_at);
create index if not exists zero_messages_recipient_idx
  on public.zero_messages (recipient_email, created_at desc);

alter table public.zero_profiles enable row level security;
alter table public.zero_messages enable row level security;

-- Демо-политики (publishable/anon key): приложение входит по OTP, но не
-- хранит Supabase-сессию между перезагрузками. Для продакшена замените
-- using/with check на auth.uid() и свяжите профиль с auth.users.
drop policy if exists "zero_profiles read" on public.zero_profiles;
create policy "zero_profiles read"
  on public.zero_profiles for select using (true);

drop policy if exists "zero_profiles insert" on public.zero_profiles;
create policy "zero_profiles insert"
  on public.zero_profiles for insert with check (true);

drop policy if exists "zero_profiles update" on public.zero_profiles;
create policy "zero_profiles update"
  on public.zero_profiles for update using (true) with check (true);

drop policy if exists "zero_messages read" on public.zero_messages;
create policy "zero_messages read"
  on public.zero_messages for select using (true);

drop policy if exists "zero_messages insert" on public.zero_messages;
create policy "zero_messages insert"
  on public.zero_messages for insert with check (true);

-- Realtime для мгновенной доставки новых сообщений.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'zero_messages'
  ) then
    alter publication supabase_realtime add table public.zero_messages;
  end if;
end $$;

-- ── Storage ────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('zero-media', 'zero-media', true)
on conflict (id) do update set public = true;

drop policy if exists "zero_media read" on storage.objects;
create policy "zero_media read"
  on storage.objects for select
  using (bucket_id = 'zero-media');

drop policy if exists "zero_media insert" on storage.objects;
create policy "zero_media insert"
  on storage.objects for insert
  with check (bucket_id = 'zero-media');

drop policy if exists "zero_media update" on storage.objects;
create policy "zero_media update"
  on storage.objects for update
  using (bucket_id = 'zero-media')
  with check (bucket_id = 'zero-media');
