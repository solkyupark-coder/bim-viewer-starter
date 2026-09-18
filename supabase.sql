-- ─────────────────────────────────────────────────────────────
-- 모델 뷰어 · 코멘트  — 수파베이스 세팅
-- 수파베이스 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run
-- 이미 한 번 돌렸어도 다시 실행해도 됩니다 (컬럼·표·버킷만 보강).
-- 확인: Table Editor에 models / comments / drawings / events,
--       models.project (프로젝트 이름. 정림 샘플 / 현대 H LAB / 새로 만든 이름),
--       comments.kind / drawing_id / page (도면 핀, pos_x·pos_y는 0–1),
--       events.type = file_add | file_replace | comment | done,
--       Storage에 models / photos / drawings (모두 public).
-- ─────────────────────────────────────────────────────────────

-- 1. 표
create table if not exists public.models (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  path        text not null,
  kind        text not null check (kind in ('ifc','dxf','dwg','glb','dae','3dm')),
  owner       text,
  project     text,
  created_at  timestamptz not null default now()
);

-- 이미 돌아가던 프로젝트: 모델에 폴더 이름만 덧붙임. 최신/이전은 created_at + 같은 파일 이름으로 가릅니다.
alter table public.models add column if not exists project text;

create table if not exists public.comments (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid not null references public.models(id) on delete cascade,
  author        text,
  body          text not null,
  pos_x         double precision,
  pos_y         double precision,
  pos_z         double precision,
  element_id    bigint,
  element_name  text,
  status        text not null default 'open',
  photo_path    text,
  created_at    timestamptz not null default now()
);

-- 이미 돌아가던 프로젝트: 코멘트에 상태·사진 칸만 덧붙임
alter table public.comments add column if not exists status text not null default 'open';
alter table public.comments add column if not exists photo_path text;

create table if not exists public.drawings (
  id          uuid primary key default gen_random_uuid(),
  model_id    uuid not null references public.models(id) on delete cascade,
  name        text not null,
  path        text not null,
  created_at  timestamptz not null default now()
);

-- 도면 핀은 comments에 같이 둡니다. kind='pdf', pos_x/pos_y는 페이지 정규화 좌표.
alter table public.comments add column if not exists kind text not null default 'model';
alter table public.comments add column if not exists drawing_id uuid references public.drawings(id) on delete cascade;
alter table public.comments add column if not exists page integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'comments_kind_check') then
    alter table public.comments add constraint comments_kind_check check (kind in ('model', 'pdf'));
  end if;
end $$;

-- 활동. 표가 없어도 뷰어는 파일·코멘트에서 목록을 만듭니다.
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  project     text,
  model_id    uuid references public.models(id) on delete set null,
  type        text not null check (type in ('file_add', 'file_replace', 'comment', 'done')),
  author      text,
  ref         text,
  created_at  timestamptz not null default now()
);

-- 2. 누가 뭘 할 수 있나 (RLS)
--    anon 키로 누구나 읽고 쓸 수 있게 엽니다. 수업용입니다.
--    지우기(delete)는 열지 않습니다.
--    코멘트만 고치기(update)를 엽니다. 열림/완료·사진 경로용입니다.
alter table public.models   enable row level security;
alter table public.comments enable row level security;
alter table public.drawings enable row level security;
alter table public.events   enable row level security;

drop policy if exists "models_read"     on public.models;
drop policy if exists "models_insert"   on public.models;
drop policy if exists "comments_read"   on public.comments;
drop policy if exists "comments_insert" on public.comments;
drop policy if exists "comments_update" on public.comments;
drop policy if exists "drawings_read"   on public.drawings;
drop policy if exists "drawings_insert" on public.drawings;
drop policy if exists "events_read"     on public.events;
drop policy if exists "events_insert"   on public.events;

create policy "models_read"     on public.models   for select using (true);
create policy "models_insert"   on public.models   for insert with check (true);
create policy "comments_read"   on public.comments for select using (true);
create policy "comments_insert" on public.comments for insert with check (true);
create policy "comments_update" on public.comments for update using (true) with check (true);
create policy "drawings_read"   on public.drawings for select using (true);
create policy "drawings_insert" on public.drawings for insert with check (true);
create policy "events_read"     on public.events   for select using (true);
create policy "events_insert"   on public.events   for insert with check (true);

-- 3. 파일 저장소 (공개 버킷)
insert into storage.buckets (id, name, public)
values
  ('models', 'models', true),
  ('photos', 'photos', true),
  ('drawings', 'drawings', true)
on conflict (id) do nothing;

drop policy if exists "models_bucket_read"     on storage.objects;
drop policy if exists "models_bucket_upload"   on storage.objects;
drop policy if exists "photos_bucket_read"     on storage.objects;
drop policy if exists "photos_bucket_upload"   on storage.objects;
drop policy if exists "drawings_bucket_read"   on storage.objects;
drop policy if exists "drawings_bucket_upload" on storage.objects;

create policy "models_bucket_read"     on storage.objects for select using (bucket_id = 'models');
create policy "models_bucket_upload"   on storage.objects for insert with check (bucket_id = 'models');
create policy "photos_bucket_read"     on storage.objects for select using (bucket_id = 'photos');
create policy "photos_bucket_upload"   on storage.objects for insert with check (bucket_id = 'photos');
create policy "drawings_bucket_read"   on storage.objects for select using (bucket_id = 'drawings');
create policy "drawings_bucket_upload" on storage.objects for insert with check (bucket_id = 'drawings');

-- 4. 남의 화면에도 바로 뜨게 (실시간)
--    코멘트: 새로 남긴 글 + 열림/완료·사진 변경
--    도면: 새 PDF
--    활동: 파일·코멘트·완료
--    커서(presence): 표가 아니라 채널입니다. 코멘트와 같은 Realtime만 켜 두면 됩니다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'drawings'
  ) then
    alter publication supabase_realtime add table public.drawings;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
end $$;
