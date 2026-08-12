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
