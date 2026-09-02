-- AutoParts Workshop Cloud v5.0
-- Run this file once in Supabase Dashboard -> SQL Editor -> New query -> Run.

create table if not exists public.workshop_states (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.workshop_backups (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('daily', 'manual', 'before_restore')),
  backup_day date,
  revision bigint not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (owner_id, kind, backup_day)
);

create index if not exists workshop_backups_owner_created_idx
  on public.workshop_backups (owner_id, created_at desc);

alter table public.workshop_states enable row level security;
alter table public.workshop_backups enable row level security;

drop policy if exists "Owners manage their workshop" on public.workshop_states;
create policy "Owners manage their workshop"
  on public.workshop_states for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "Owners read their backups" on public.workshop_backups;
create policy "Owners read their backups"
  on public.workshop_backups for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists "Owners insert their backups" on public.workshop_backups;
create policy "Owners insert their backups"
  on public.workshop_backups for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "Owners delete their backups" on public.workshop_backups;
create policy "Owners delete their backups"
  on public.workshop_backups for delete to authenticated
  using (owner_id = auth.uid());

grant select, insert, update, delete on public.workshop_states to authenticated;
grant select, insert, delete on public.workshop_backups to authenticated;
grant usage, select on sequence public.workshop_backups_id_seq to authenticated;

create or replace function public.workshop_commit(
  p_expected_revision bigint,
  p_data jsonb,
  p_reason text default 'change'
)
returns table(new_revision bigint)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new_revision bigint;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'INVALID_DATA'; end if;

  update public.workshop_states
     set data = p_data, revision = revision + 1, updated_at = now()
   where owner_id = auth.uid() and revision = p_expected_revision
   returning revision into v_new_revision;

  if v_new_revision is null then
    raise exception 'DATA_CHANGED' using errcode = '40001';
  end if;

  insert into public.workshop_backups (owner_id, kind, backup_day, revision, data)
  values (auth.uid(), 'daily', current_date, v_new_revision, p_data)
  on conflict (owner_id, kind, backup_day)
  do update set revision = excluded.revision, data = excluded.data, created_at = now();

  delete from public.workshop_backups
   where id in (
     select id from public.workshop_backups
      where owner_id = auth.uid() and kind = 'daily'
      order by created_at desc offset 45
   );

  return query select v_new_revision;
end;
$$;

create or replace function public.workshop_manual_backup()
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  insert into public.workshop_backups (owner_id, kind, revision, data)
  select owner_id, 'manual', revision, data
    from public.workshop_states
   where owner_id = auth.uid();

  delete from public.workshop_backups
   where id in (
     select id from public.workshop_backups
      where owner_id = auth.uid() and kind = 'manual'
      order by created_at desc offset 25
   );
end;
$$;

create or replace function public.workshop_restore(
  p_expected_revision bigint,
  p_data jsonb
)
returns table(new_revision bigint)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old_revision bigint;
  v_old_data jsonb;
  v_new_revision bigint;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'INVALID_DATA'; end if;

  select revision, data into v_old_revision, v_old_data
    from public.workshop_states
   where owner_id = auth.uid() and revision = p_expected_revision;

  if v_old_revision is null then
    raise exception 'DATA_CHANGED' using errcode = '40001';
  end if;

  insert into public.workshop_backups (owner_id, kind, revision, data)
  values (auth.uid(), 'before_restore', v_old_revision, v_old_data);

  update public.workshop_states
     set data = p_data, revision = revision + 1, updated_at = now()
   where owner_id = auth.uid() and revision = p_expected_revision
   returning revision into v_new_revision;

  delete from public.workshop_backups
   where id in (
     select id from public.workshop_backups
      where owner_id = auth.uid() and kind = 'before_restore'
      order by created_at desc offset 20
   );

  return query select v_new_revision;
end;
$$;

grant execute on function public.workshop_commit(bigint, jsonb, text) to authenticated;
grant execute on function public.workshop_manual_backup() to authenticated;
grant execute on function public.workshop_restore(bigint, jsonb) to authenticated;

revoke all on public.workshop_states from anon;
revoke all on public.workshop_backups from anon;
