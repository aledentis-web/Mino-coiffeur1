create or replace function public.get_public_availability(
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
      select coalesce(
        (
          select profile.duration_override_minutes
          from public.customer_service_profiles as profile
          where profile.business_id = v_business.id
            and profile.customer_id = v_customer_id
            and profile.service_id = v_service_id
        ),
        v_duration
      )
      into v_duration;
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
