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

-- Хранилище голосовых и видеокружков.
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
