-- AutoParts Workshop - customer app (v1)
-- Run once in Supabase Dashboard -> SQL Editor -> New query -> Run,
-- AFTER SUPABASE_SETUP.sql. Then publish your shop (last block of this file).

-- Shops that agreed to show their tire catalog and accept requests publicly.
create table if not exists public.customer_shops (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

-- Booking / help requests sent by customers from the public page.
create table if not exists public.customer_requests (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('booking', 'tire', 'emergency')),
  customer_name text not null check (char_length(customer_name) between 2 and 80),
  phone text not null check (phone ~ '^[0-9+][0-9 -]{7,19}$'),
  plate text not null default '' check (char_length(plate) <= 16),
  service text not null default '' check (char_length(service) <= 80),
  tire_size text not null default '' check (char_length(tire_size) <= 30),
  preferred_date date,
  preferred_time text not null default '' check (char_length(preferred_time) <= 10),
  notes text not null default '' check (char_length(notes) <= 500),
  lang text not null default 'he' check (lang in ('he', 'ru', 'ar', 'en')),
  status text not null default 'new' check (status in ('new', 'confirmed', 'done', 'cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists customer_requests_owner_created_idx
  on public.customer_requests (owner_id, created_at desc);
create index if not exists customer_requests_phone_created_idx
  on public.customer_requests (owner_id, phone, created_at desc);

alter table public.customer_shops enable row level security;
alter table public.customer_requests enable row level security;

-- Only the shop owner sees and manages their own rows. Customers never read
-- this table; they write through customer_submit_request() below.
drop policy if exists "Owners read their shop" on public.customer_shops;
create policy "Owners read their shop"
  on public.customer_shops for select to authenticated
  using (owner_id = auth.uid());

drop policy if exists "Owners manage their requests" on public.customer_requests;
create policy "Owners manage their requests"
  on public.customer_requests for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

grant select on public.customer_shops to authenticated;
grant select, update, delete on public.customer_requests to authenticated;

-- Public tire catalog: name, size-ish name, sale price and an in-stock flag.
-- Purchase prices, exact quantities, notes and locations are never exposed.
create or replace function public.customer_catalog(
  p_shop uuid,
  p_category text default 'צמיגים וגלגלים'
)
returns table(id bigint, name text, sku text, category text, sale_minor bigint, in_stock boolean)
language sql
stable
security definer
set search_path = public
as $$
  select (p->>'id')::bigint,
         p->>'name',
         coalesce(p->>'sku', ''),
         coalesce(p->>'category', ''),
         coalesce((p->>'saleMinor')::bigint, 0),
         coalesce((p->>'quantity')::int, 0) > 0
    from public.workshop_states s
    join public.customer_shops c on c.owner_id = s.owner_id and c.enabled
    cross join lateral jsonb_array_elements(s.data->'products') p
   where s.owner_id = p_shop
     and coalesce((p->>'active')::boolean, true)
     and (p_category is null or p_category = '' or p->>'category' = p_category)
   order by p->>'name'
   limit 500;
$$;

create or replace function public.customer_submit_request(
  p_shop uuid,
  p_kind text,
  p_name text,
  p_phone text,
  p_plate text default '',
  p_service text default '',
  p_tire_size text default '',
  p_date date default null,
  p_time text default '',
  p_notes text default '',
  p_lang text default 'he'
)
returns table(request_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text := regexp_replace(trim(coalesce(p_phone, '')), '\s+', ' ', 'g');
  v_id bigint;
begin
  if not exists (select 1 from public.customer_shops where owner_id = p_shop and enabled) then
    raise exception 'SHOP_NOT_FOUND';
  end if;
  if p_date is not null and (p_date < current_date or p_date > current_date + 60) then
    raise exception 'INVALID_DATE';
  end if;
  -- Basic abuse limits: per phone and per shop per day.
  if (select count(*) from public.customer_requests
       where owner_id = p_shop and phone = v_phone and created_at > now() - interval '1 day') >= 5 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;
  if (select count(*) from public.customer_requests
       where owner_id = p_shop and created_at > now() - interval '1 day') >= 300 then
    raise exception 'TOO_MANY_REQUESTS';
  end if;

  insert into public.customer_requests
    (owner_id, kind, customer_name, phone, plate, service, tire_size, preferred_date, preferred_time, notes, lang)
  values
    (p_shop, p_kind, trim(coalesce(p_name, '')), v_phone, upper(trim(coalesce(p_plate, ''))),
     trim(coalesce(p_service, '')), trim(coalesce(p_tire_size, '')), p_date,
     trim(coalesce(p_time, '')), trim(coalesce(p_notes, '')), coalesce(p_lang, 'he'))
  returning id into v_id;

  return query select v_id;
end;
$$;

revoke all on function public.customer_catalog(uuid, text) from public;
revoke all on function public.customer_submit_request(uuid, text, text, text, text, text, text, date, text, text, text) from public;
grant execute on function public.customer_catalog(uuid, text) to anon, authenticated;
grant execute on function public.customer_submit_request(uuid, text, text, text, text, text, text, date, text, text, text) to anon, authenticated;

-- Publish your shop: replace the e-mail with the one you use in the inventory
-- app, run it, then copy the returned owner_id into customer/js/customer-config.js.
-- insert into public.customer_shops (owner_id)
--   select id from auth.users where email = 'YOUR-EMAIL@example.com'
--   on conflict (owner_id) do update set enabled = true
--   returning owner_id;
