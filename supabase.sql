-- ─────────────────────────────────────────────────────────────
-- 모델 뷰어 · 코멘트  — 수파베이스 세팅
-- 수파베이스 대시보드 → SQL Editor → New query → 전체 붙여넣기 → Run
-- 이미 한 번 돌렸어도 다시 실행해도 됩니다 (컬럼·표·버킷만 보강).
-- 확인: Table Editor에 projects / models / comments / drawings / events,
--       projects.name (프로젝트 이름. 새로 만든 프로젝트는 여기 한 행),
--       models.project_id / comments.project_id (어느 프로젝트 것인지. project 텍스트 칸은 옛 행 호환용),
--       comments.kind = model | pdf | dwg, drawing_id / page (PDF 핀, pos_x·pos_y는 0–1),
--       events.type = file_add | file_replace | comment | done,
--       Storage에 models / photos / drawings (모두 public).
-- ─────────────────────────────────────────────────────────────

-- 1. 표
--    프로젝트가 기준입니다. 모델·코멘트는 전부 어느 프로젝트에 속합니다.
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  owner       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.models (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  path        text not null,
  kind        text not null check (kind in ('ifc','dxf','dwg','glb','dae','3dm')),
  owner       text,
  project     text,
  project_id  uuid references public.projects(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 이미 돌아가던 프로젝트: 모델에 프로젝트 칸만 덧붙임. 최신/이전은 created_at + 같은 파일 이름으로 가릅니다.
alter table public.models add column if not exists project text;
alter table public.models add column if not exists project_id uuid references public.projects(id) on delete set null;

create table if not exists public.comments (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid not null references public.models(id) on delete cascade,
  project_id    uuid references public.projects(id) on delete set null,
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

-- 이미 돌아가던 프로젝트: 코멘트에 상태·사진·프로젝트 칸만 덧붙임
alter table public.comments add column if not exists status text not null default 'open';
alter table public.comments add column if not exists photo_path text;
alter table public.comments add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists comments_project_id_idx on public.comments(project_id);
create index if not exists models_project_id_idx on public.models(project_id);

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

-- kind: model(3D 객체) · pdf(도면 PDF 페이지) · dwg(DWG/DXF 2D 좌표)
alter table public.comments drop constraint if exists comments_kind_check;
alter table public.comments add constraint comments_kind_check check (kind in ('model', 'pdf', 'dwg'));

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

-- 1-1. 옛 행 채우기: models.project 이름으로 projects 행을 만들고, 모델·코멘트에 project_id를 넣습니다.
insert into public.projects (name)
select distinct project from public.models
where project is not null and btrim(project) <> ''
on conflict (name) do nothing;

update public.models m
set project_id = p.id
from public.projects p
where m.project_id is null and m.project = p.name;

update public.comments c
set project_id = m.project_id
from public.models m
where c.project_id is null and c.model_id = m.id and m.project_id is not null;

-- 2. 누가 뭘 할 수 있나 (RLS)
--    anon 키로 누구나 읽고 쓸 수 있게 엽니다. 수업용입니다.
--    지우기(delete)는 열지 않습니다.
--    코멘트만 고치기(update)를 엽니다. 열림/완료·사진 경로용입니다.
alter table public.projects enable row level security;
alter table public.models   enable row level security;
alter table public.comments enable row level security;
alter table public.drawings enable row level security;
alter table public.events   enable row level security;

drop policy if exists "projects_read"   on public.projects;
drop policy if exists "projects_insert" on public.projects;
drop policy if exists "models_read"     on public.models;
drop policy if exists "models_insert"   on public.models;
drop policy if exists "comments_read"   on public.comments;
drop policy if exists "comments_insert" on public.comments;
drop policy if exists "comments_update" on public.comments;
drop policy if exists "drawings_read"   on public.drawings;
drop policy if exists "drawings_insert" on public.drawings;
drop policy if exists "events_read"     on public.events;
drop policy if exists "events_insert"   on public.events;

create policy "projects_read"   on public.projects for select using (true);
create policy "projects_insert" on public.projects for insert with check (true);
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
--    프로젝트: 새로 만든 프로젝트
--    코멘트: 새로 남긴 글 + 열림/완료·사진 변경
--    도면: 새 PDF
--    활동: 파일·코멘트·완료
--    커서(presence): 표가 아니라 채널입니다. 코멘트와 같은 Realtime만 켜 두면 됩니다.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;
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

-- 5. 프로젝트 삭제 (삭제 코드 필요)
--    anon 키로는 어떤 표도 직접 지울 수 없습니다. 대신 이 함수가 코드를 확인하고 지웁니다.
--    코드는 해시로만 저장합니다. 기본 코드는 1234. 바꾸려면:
--      update public.app_settings set value = encode(extensions.digest('새코드', 'sha256'), 'hex') where key = 'delete_code_sha256';
--    Storage의 실제 파일은 남습니다(대시보드 Storage에서 지웁니다). 함수가 그 경로 목록을 돌려줍니다.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_settings (
  key    text primary key,
  value  text not null
);
alter table public.app_settings enable row level security;   -- 정책 없음 = anon은 읽지도 쓰지도 못함

insert into public.app_settings (key, value)
values ('delete_code_sha256', encode(extensions.digest('1234', 'sha256'), 'hex'))
on conflict (key) do nothing;

create or replace function public.delete_project(p_project_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash     text;
  v_name     text;
  v_models   int := 0;
  v_drawings int := 0;
  v_comments int := 0;
  v_events   int := 0;
  v_files    text[] := '{}';
begin
  select value into v_hash from public.app_settings where key = 'delete_code_sha256';
  if v_hash is null or p_code is null or encode(digest(p_code, 'sha256'), 'hex') <> v_hash then
    raise exception 'wrong code' using errcode = '28000';
  end if;

  select name into v_name from public.projects where id = p_project_id;
  if v_name is null then
    raise exception 'no such project' using errcode = 'P0002';
  end if;

  create temp table _victim_models on commit drop as
    select id, path from public.models where project_id = p_project_id or project = v_name;

  select coalesce(array_agg(f.path), '{}') into v_files from (
    select 'models/' || path as path from _victim_models
    union all
    select 'drawings/' || d.path from public.drawings d where d.model_id in (select id from _victim_models)
    union all
    select 'photos/' || c.photo_path from public.comments c
    where c.photo_path is not null and (c.project_id = p_project_id or c.model_id in (select id from _victim_models))
  ) f;

  with d as (
    delete from public.comments where project_id = p_project_id or model_id in (select id from _victim_models) returning 1
  ) select count(*) into v_comments from d;
  with d as (
    delete from public.drawings where model_id in (select id from _victim_models) returning 1
  ) select count(*) into v_drawings from d;
  with d as (
    delete from public.events where project = v_name or model_id in (select id from _victim_models) returning 1
  ) select count(*) into v_events from d;
  with d as (
    delete from public.models where id in (select id from _victim_models) returning 1
  ) select count(*) into v_models from d;
  delete from public.projects where id = p_project_id;

  return jsonb_build_object(
    'name', v_name, 'models', v_models, 'drawings', v_drawings,
    'comments', v_comments, 'events', v_events, 'files', to_jsonb(v_files)
  );
end $$;

revoke all on function public.delete_project(uuid, text) from public;
grant execute on function public.delete_project(uuid, text) to anon, authenticated;

-- 6. 코멘트 수정·삭제 (코드 필요)
--    수정 코드와 삭제 코드는 따로입니다. 기본값: 수정 0000, 삭제는 5번의 코드와 같음.
--      update public.app_settings set value = encode(extensions.digest('새코드', 'sha256'), 'hex') where key = 'edit_code_sha256';
insert into public.app_settings (key, value)
values ('edit_code_sha256', encode(extensions.digest('0000', 'sha256'), 'hex'))
on conflict (key) do nothing;

-- 지운 행도 어느 프로젝트 것이었는지 실시간으로 알 수 있게
alter table public.comments replica identity full;

create or replace function public.check_code(p_key text, p_code text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.app_settings
    where key = p_key and p_code is not null and value = encode(digest(p_code, 'sha256'), 'hex')
  );
$$;
revoke all on function public.check_code(text, text) from public;

create or replace function public.update_comment(p_comment_id uuid, p_code text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.comments;
begin
  if not public.check_code('edit_code_sha256', p_code) then
    raise exception 'wrong code' using errcode = '28000';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception 'empty body' using errcode = '22023';
  end if;
  update public.comments set body = btrim(p_body) where id = p_comment_id returning * into v_row;
  if v_row.id is null then
    raise exception 'no such comment' using errcode = 'P0002';
  end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.delete_comment(p_comment_id uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.comments;
begin
  if not public.check_code('delete_code_sha256', p_code) then
    raise exception 'wrong code' using errcode = '28000';
  end if;
  delete from public.comments where id = p_comment_id returning * into v_row;
  if v_row.id is null then
    raise exception 'no such comment' using errcode = 'P0002';
  end if;
  delete from public.events where ref = p_comment_id::text and type in ('comment', 'done');
  return jsonb_build_object('id', v_row.id, 'photo_path', v_row.photo_path);
end $$;

revoke all on function public.update_comment(uuid, text, text) from public;
revoke all on function public.delete_comment(uuid, text) from public;
grant execute on function public.update_comment(uuid, text, text) to anon, authenticated;
grant execute on function public.delete_comment(uuid, text) to anon, authenticated;
