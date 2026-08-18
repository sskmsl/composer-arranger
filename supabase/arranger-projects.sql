-- Composer Arranger cloud project sync
create table if not exists public.arranger_projects (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  data jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists arranger_projects_owner_id_idx
  on public.arranger_projects(owner_id);

alter table public.arranger_projects enable row level security;

drop policy if exists "arranger_projects_select_own" on public.arranger_projects;
create policy "arranger_projects_select_own"
  on public.arranger_projects for select
  using (auth.uid() = owner_id);

drop policy if exists "arranger_projects_insert_own" on public.arranger_projects;
create policy "arranger_projects_insert_own"
  on public.arranger_projects for insert
  with check (auth.uid() = owner_id);

drop policy if exists "arranger_projects_update_own" on public.arranger_projects;
create policy "arranger_projects_update_own"
  on public.arranger_projects for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "arranger_projects_delete_own" on public.arranger_projects;
create policy "arranger_projects_delete_own"
  on public.arranger_projects for delete
  using (auth.uid() = owner_id);

-- 同時編集では新しいupdated_atだけを受理し、古い端末の遅延通信で上書きしない。
create or replace function public.upsert_arranger_project(
  p_id text,
  p_data jsonb,
  p_updated_at timestamptz,
  p_deleted_at timestamptz default null
)
returns void
language sql
security invoker
set search_path = public
set statement_timeout = '60s'
as $$
  insert into public.arranger_projects (
    id,
    owner_id,
    data,
    updated_at,
    deleted_at
  )
  values (
    p_id,
    auth.uid(),
    p_data,
    p_updated_at,
    p_deleted_at
  )
  on conflict (id) do update
  set
    data = excluded.data,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at
  where arranger_projects.owner_id = auth.uid()
    and excluded.updated_at >= arranger_projects.updated_at;
$$;

revoke all on function public.upsert_arranger_project(
  text,
  jsonb,
  timestamptz,
  timestamptz
) from public;
grant execute on function public.upsert_arranger_project(
  text,
  jsonb,
  timestamptz,
  timestamptz
) to authenticated;

-- 大容量JSONBを全件返さず、同期判断に必要な軽量情報だけを取得する。
create or replace function public.list_arranger_project_metadata()
returns table (
  id text,
  updated_at timestamptz,
  deleted_at timestamptz
)
language sql
stable
security invoker
set search_path = public
set statement_timeout = '15s'
as $$
  select
    project.id,
    project.updated_at,
    project.deleted_at
  from public.arranger_projects as project
  where project.owner_id = auth.uid()
  order by project.updated_at desc;
$$;

revoke all on function public.list_arranger_project_metadata() from public;
grant execute on function public.list_arranger_project_metadata()
  to authenticated;

-- 必要と判定したprojectだけを個別取得する。同期専用に最大60秒まで許可する。
create or replace function public.get_arranger_project(p_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public
set statement_timeout = '60s'
as $$
  select project.data
  from public.arranger_projects as project
  where project.id = p_id
    and project.owner_id = auth.uid()
    and project.deleted_at is null;
$$;

revoke all on function public.get_arranger_project(text) from public;
grant execute on function public.get_arranger_project(text)
  to authenticated;
