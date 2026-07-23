create extension if not exists btree_gist with schema extensions;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  timezone text not null default 'Europe/Rome',
  phone_e164 text,
  address text not null default '',
  opening_hours jsonb not null default '{}'::jsonb
    check (jsonb_typeof(opening_hours) = 'object'),
  slot_interval_minutes integer not null default 15
    check (slot_interval_minutes between 5 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'barber', 'staff')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index business_members_user_id_idx
  on public.business_members (user_id, business_id);

create table public.resources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, slug)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text not null default '',
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  price_cents integer not null check (price_cents >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, slug)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, phone_e164)
);

create table public.customer_service_profiles (
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null,
  service_id uuid not null,
  duration_override_minutes integer
    check (duration_override_minutes between 5 and 480),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, customer_id, service_id),
  foreign key (business_id, customer_id)
    references public.customers(business_id, id) on delete cascade,
  foreign key (business_id, service_id)
    references public.services(business_id, id) on delete cascade
);

create index customer_service_profiles_customer_id_idx
  on public.customer_service_profiles (customer_id);

create index customer_service_profiles_service_id_idx
  on public.customer_service_profiles (service_id);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  resource_id uuid not null,
  customer_id uuid not null,
  service_id uuid not null,
  customer_name text not null,
  customer_phone_e164 text not null,
  service_name text not null,
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  channel text not null check (channel in ('site', 'whatsapp', 'voice', 'manual')),
  status text not null default 'confirmed'
    check (status in ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  external_reference text,
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at = starts_at + make_interval(mins => duration_minutes)),
  foreign key (business_id, resource_id)
    references public.resources(business_id, id),
  foreign key (business_id, customer_id)
    references public.customers(business_id, id),
  foreign key (business_id, service_id)
    references public.services(business_id, id),
  exclude using gist (
    resource_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending', 'confirmed'))
);

create index appointments_business_agenda_idx
  on public.appointments (business_id, starts_at)
  where status in ('pending', 'confirmed');

create index appointments_customer_id_idx
  on public.appointments (customer_id, starts_at desc);

create index appointments_service_id_idx
  on public.appointments (service_id);

create unique index appointments_external_reference_uidx
  on public.appointments (business_id, channel, external_reference)
  where external_reference is not null;

create function private.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger businesses_touch_updated_at
before update on public.businesses
for each row execute function private.touch_updated_at();

create trigger resources_touch_updated_at
before update on public.resources
for each row execute function private.touch_updated_at();

create trigger services_touch_updated_at
before update on public.services
for each row execute function private.touch_updated_at();

create trigger customers_touch_updated_at
before update on public.customers
for each row execute function private.touch_updated_at();

create trigger customer_service_profiles_touch_updated_at
before update on public.customer_service_profiles
for each row execute function private.touch_updated_at();

create trigger appointments_touch_updated_at
before update on public.appointments
for each row execute function private.touch_updated_at();

create function private.has_business_access(
  requested_business_id uuid,
  allowed_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_members
    where business_id = requested_business_id
      and user_id = (select auth.uid())
      and (allowed_roles is null or role = any(allowed_roles))
  );
$$;

revoke all on function private.touch_updated_at() from public, anon, authenticated;
revoke all on function private.has_business_access(uuid, text[]) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.has_business_access(uuid, text[]) to authenticated;

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.resources enable row level security;
alter table public.services enable row level security;
alter table public.customers enable row level security;
alter table public.customer_service_profiles enable row level security;
alter table public.appointments enable row level security;

create policy businesses_select_members
on public.businesses for select to authenticated
using (private.has_business_access(id));

create policy businesses_update_owners
on public.businesses for update to authenticated
using (private.has_business_access(id, array['owner']))
with check (private.has_business_access(id, array['owner']));

create policy business_members_select_members
on public.business_members for select to authenticated
using (private.has_business_access(business_id));

create policy business_members_insert_owners
on public.business_members for insert to authenticated
with check (private.has_business_access(business_id, array['owner']));

create policy business_members_update_owners
on public.business_members for update to authenticated
using (private.has_business_access(business_id, array['owner']))
with check (private.has_business_access(business_id, array['owner']));

create policy business_members_delete_owners
on public.business_members for delete to authenticated
using (private.has_business_access(business_id, array['owner']));

create policy resources_select_members
on public.resources for select to authenticated
using (private.has_business_access(business_id));

create policy resources_write_members
on public.resources for all to authenticated
using (private.has_business_access(business_id))
with check (private.has_business_access(business_id));

create policy services_select_members
on public.services for select to authenticated
using (private.has_business_access(business_id));

create policy services_write_members
on public.services for all to authenticated
using (private.has_business_access(business_id))
with check (private.has_business_access(business_id));

create policy customers_select_members
on public.customers for select to authenticated
using (private.has_business_access(business_id));

create policy customers_write_members
on public.customers for all to authenticated
using (private.has_business_access(business_id))
with check (private.has_business_access(business_id));

create policy customer_service_profiles_select_members
on public.customer_service_profiles for select to authenticated
using (private.has_business_access(business_id));

create policy customer_service_profiles_write_members
on public.customer_service_profiles for all to authenticated
using (private.has_business_access(business_id))
with check (private.has_business_access(business_id));

create policy appointments_select_members
on public.appointments for select to authenticated
using (private.has_business_access(business_id));

create policy appointments_write_members
on public.appointments for all to authenticated
using (private.has_business_access(business_id))
with check (private.has_business_access(business_id));

revoke all on all tables in schema public from anon, authenticated;

grant select, update on public.businesses to authenticated;
grant select, insert, update, delete on public.business_members to authenticated;
grant select, insert, update, delete on public.resources to authenticated;
grant select, insert, update, delete on public.services to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.customer_service_profiles to authenticated;
grant select, insert, update, delete on public.appointments to authenticated;

create function public.get_public_availability(
  p_business_slug text,
  p_service_slug text,
  p_date date,
  p_phone_e164 text default null,
  p_resource_slug text default 'main'
)
returns table (
  slot_time text,
  starts_at timestamptz,
  ends_at timestamptz,
  duration_minutes integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business public.businesses%rowtype;
  v_resource_id uuid;
  v_service_id uuid;
  v_duration integer;
  v_customer_id uuid;
begin
  select *
  into v_business
  from public.businesses
  where slug = p_business_slug
    and active = true;

  if not found then
    raise exception using errcode = 'P0002', message = 'BUSINESS_NOT_FOUND';
  end if;

  select id
  into v_resource_id
  from public.resources
  where business_id = v_business.id
    and slug = p_resource_slug
    and active = true;

  if not found then
    raise exception using errcode = 'P0002', message = 'RESOURCE_NOT_FOUND';
  end if;

  select service.id, service.duration_minutes
  into v_service_id, v_duration
  from public.services as service
  where service.business_id = v_business.id
    and service.slug = p_service_slug
    and service.active = true;

  if not found then
    raise exception using errcode = 'P0002', message = 'SERVICE_NOT_FOUND';
  end if;

  if p_phone_e164 is not null then
    select id
    into v_customer_id
    from public.customers
    where business_id = v_business.id
      and phone_e164 = p_phone_e164;

    if found then
      select coalesce(profile.duration_override_minutes, v_duration)
      into v_duration
      from public.customer_service_profiles as profile
      where profile.business_id = v_business.id
        and profile.customer_id = v_customer_id
        and profile.service_id = v_service_id;
    end if;
  end if;

  return query
  with opening_ranges as (
    select
      (opening_range ->> 'start')::time as opens_at,
      (opening_range ->> 'end')::time as closes_at
    from jsonb_array_elements(
      coalesce(
        v_business.opening_hours -> extract(dow from p_date)::integer::text,
        '[]'::jsonb
      )
    ) as opening_range
  ),
  local_slots as (
    select generate_series(
      p_date + opens_at,
      p_date + closes_at - make_interval(mins => v_duration),
      make_interval(mins => v_business.slot_interval_minutes)
    ) as local_start
    from opening_ranges
    where closes_at > opens_at
      and closes_at - opens_at >= make_interval(mins => v_duration)
  ),
  slots as (
    select local_start at time zone v_business.timezone as starts_at
    from local_slots
  )
  select
    to_char(slots.starts_at at time zone v_business.timezone, 'HH24:MI'),
    slots.starts_at,
    slots.starts_at + make_interval(mins => v_duration),
    v_duration
  from slots
  where slots.starts_at > now()
    and not exists (
      select 1
      from public.appointments
      where resource_id = v_resource_id
        and status in ('pending', 'confirmed')
        and tstzrange(
          appointments.starts_at,
          appointments.ends_at,
          '[)'
        ) && tstzrange(
          slots.starts_at,
          slots.starts_at + make_interval(mins => v_duration),
          '[)'
        )
    )
  order by slots.starts_at;
end;
$$;

create function public.create_public_booking(
  p_business_slug text,
  p_service_slug text,
  p_date date,
  p_start_time time,
  p_customer_name text,
  p_phone_e164 text,
  p_channel text,
  p_notes text default '',
  p_external_reference text default null,
  p_resource_slug text default 'main'
)
returns table (
  appointment_id uuid,
  appointment_starts_at timestamptz,
  appointment_ends_at timestamptz,
  appointment_duration_minutes integer,
  idempotent boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses%rowtype;
  v_resource public.resources%rowtype;
  v_service public.services%rowtype;
  v_customer public.customers%rowtype;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_duration integer;
  v_appointment public.appointments%rowtype;
begin
  if p_channel not in ('site', 'whatsapp', 'voice', 'manual') then
    raise exception using errcode = '22023', message = 'INVALID_CHANNEL';
  end if;

  if char_length(trim(p_customer_name)) not between 1 and 160 then
    raise exception using errcode = '22023', message = 'INVALID_CUSTOMER_NAME';
  end if;

  if p_phone_e164 !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception using errcode = '22023', message = 'INVALID_PHONE';
  end if;

  select *
  into v_business
  from public.businesses
  where slug = p_business_slug
    and active = true;

  if not found then
    raise exception using errcode = 'P0002', message = 'BUSINESS_NOT_FOUND';
  end if;

  if p_external_reference is not null then
    select *
    into v_appointment
    from public.appointments
    where business_id = v_business.id
      and channel = p_channel
      and external_reference = p_external_reference;

    if found then
      return query select
        v_appointment.id,
        v_appointment.starts_at,
        v_appointment.ends_at,
        v_appointment.duration_minutes,
        true;
      return;
    end if;
  end if;

  select *
  into v_resource
  from public.resources
  where business_id = v_business.id
    and slug = p_resource_slug
    and active = true;

  if not found then
    raise exception using errcode = 'P0002', message = 'RESOURCE_NOT_FOUND';
  end if;

  select *
  into v_service
  from public.services
  where business_id = v_business.id
    and slug = p_service_slug
    and active = true;

  if not found then
    raise exception using errcode = 'P0002', message = 'SERVICE_NOT_FOUND';
  end if;

  insert into public.customers (business_id, name, phone_e164)
  values (v_business.id, trim(p_customer_name), p_phone_e164)
  on conflict (business_id, phone_e164)
  do update set
    name = excluded.name,
    updated_at = now()
  returning * into v_customer;

  select coalesce(profile.duration_override_minutes, v_service.duration_minutes)
  into v_duration
  from (select 1) as seed
  left join public.customer_service_profiles as profile
    on profile.business_id = v_business.id
   and profile.customer_id = v_customer.id
   and profile.service_id = v_service.id;

  v_starts_at := (p_date + p_start_time) at time zone v_business.timezone;
  v_ends_at := v_starts_at + make_interval(mins => v_duration);

  if not exists (
    select 1
    from public.get_public_availability(
      p_business_slug,
      p_service_slug,
      p_date,
      p_phone_e164,
      p_resource_slug
    ) as available
    where available.starts_at = v_starts_at
  ) then
    raise exception using errcode = '22023', message = 'SLOT_NOT_AVAILABLE';
  end if;

  begin
    insert into public.appointments (
      business_id,
      resource_id,
      customer_id,
      service_id,
      customer_name,
      customer_phone_e164,
      service_name,
      duration_minutes,
      starts_at,
      ends_at,
      channel,
      external_reference,
      notes
    )
    values (
      v_business.id,
      v_resource.id,
      v_customer.id,
      v_service.id,
      v_customer.name,
      v_customer.phone_e164,
      v_service.name,
      v_duration,
      v_starts_at,
      v_ends_at,
      p_channel,
      p_external_reference,
      coalesce(trim(p_notes), '')
    )
    returning * into v_appointment;
  exception
    when exclusion_violation then
      raise exception using errcode = '23P01', message = 'SLOT_NOT_AVAILABLE';
    when unique_violation then
      if p_external_reference is null then
        raise;
      end if;

      select *
      into v_appointment
      from public.appointments
      where business_id = v_business.id
        and channel = p_channel
        and external_reference = p_external_reference;

      if not found then
        raise;
      end if;

      return query select
        v_appointment.id,
        v_appointment.starts_at,
        v_appointment.ends_at,
        v_appointment.duration_minutes,
        true;
      return;
  end;

  return query select
    v_appointment.id,
    v_appointment.starts_at,
    v_appointment.ends_at,
    v_appointment.duration_minutes,
    false;
end;
$$;

revoke all on function public.get_public_availability(text, text, date, text, text)
  from public, anon, authenticated;
revoke all on function public.create_public_booking(
  text, text, date, time, text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.get_public_availability(text, text, date, text, text)
  to service_role;
grant execute on function public.create_public_booking(
  text, text, date, time, text, text, text, text, text, text
) to service_role;

insert into public.businesses (
  id,
  name,
  slug,
  timezone,
  phone_e164,
  address,
  opening_hours,
  slot_interval_minutes
)
values (
  '00000000-0000-4000-8000-000000000008',
  'Studio Barber 8',
  'studio-barber-8',
  'Europe/Rome',
  '+390321000008',
  'Via del Taglio 8, Novara',
  '{
    "0": [],
    "1": [],
    "2": [{"start":"09:00","end":"12:30"},{"start":"14:00","end":"19:30"}],
    "3": [{"start":"09:00","end":"12:30"},{"start":"14:00","end":"19:30"}],
    "4": [{"start":"09:00","end":"12:30"},{"start":"14:00","end":"19:30"}],
    "5": [{"start":"09:00","end":"12:30"},{"start":"14:00","end":"19:30"}],
    "6": [{"start":"09:00","end":"18:00"}]
  }'::jsonb,
  15
);

insert into public.resources (id, business_id, name, slug)
values (
  '10000000-0000-4000-8000-000000000008',
  '00000000-0000-4000-8000-000000000008',
  'Postazione principale',
  'main'
);

insert into public.services (
  id,
  business_id,
  name,
  slug,
  description,
  duration_minutes,
  price_cents,
  sort_order
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000008',
    'Taglio',
    'haircut',
    'Consulenza, taglio e styling finale.',
    30,
    2500,
    1
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000008',
    'Barba',
    'beard',
    'Regolazione, contorni e finitura.',
    20,
    1500,
    2
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000008',
    'Taglio + barba',
    'haircut-beard',
    'Il servizio completo, senza fretta.',
    45,
    3700,
    3
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000008',
    'Sistemazione',
    'quick-finish',
    'Ritocco rapido di contorni e styling.',
    15,
    1200,
    4
  );
