create table public.automation_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null
    references public.businesses(id) on delete cascade,
  event_type text not null
    check (
      event_type in (
        'appointment.created',
        'appointment.cancelled',
        'appointment.reminder_24h'
      )
    ),
  aggregate_type text not null default 'appointment'
    check (aggregate_type = 'appointment'),
  aggregate_id uuid not null,
  deduplication_key text not null unique,
  payload jsonb not null
    check (jsonb_typeof(payload) = 'object'),
  available_at timestamptz not null default now(),
  attempts integer not null default 0
    check (attempts between 0 and 10),
  locked_at timestamptz,
  locked_by text,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.automation_events is
  'Server-only transactional outbox consumed by the Studio Barber 8 n8n worker.';

create index automation_events_ready_idx
  on public.automation_events (available_at, created_at)
  where processed_at is null;

create index automation_events_aggregate_idx
  on public.automation_events (business_id, aggregate_id, created_at desc);

create trigger automation_events_touch_updated_at
before update on public.automation_events
for each row execute function private.touch_updated_at();

alter table public.automation_events enable row level security;

create policy automation_events_deny_client_access
on public.automation_events
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

revoke all on public.automation_events
  from public, anon, authenticated;
grant select, insert, update, delete on public.automation_events
  to service_role;

create function private.appointment_automation_payload(
  p_appointment public.appointments
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'appointmentId', p_appointment.id,
    'businessId', p_appointment.business_id,
    'customerId', p_appointment.customer_id,
    'customerName', p_appointment.customer_name,
    'customerPhoneE164', p_appointment.customer_phone_e164,
    'serviceName', p_appointment.service_name,
    'durationMinutes', p_appointment.duration_minutes,
    'startsAt', p_appointment.starts_at,
    'endsAt', p_appointment.ends_at,
    'channel', p_appointment.channel,
    'status', p_appointment.status
  );
$$;

create function private.enqueue_appointment_automation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_starts_key text;
begin
  v_payload := private.appointment_automation_payload(new);
  v_starts_key := to_char(new.starts_at at time zone 'UTC', 'YYYYMMDDHH24MISS');

  if tg_op = 'INSERT' then
    insert into public.automation_events (
      business_id,
      event_type,
      aggregate_id,
      deduplication_key,
      payload
    )
    values (
      new.business_id,
      'appointment.created',
      new.id,
      'appointment:' || new.id::text || ':created',
      v_payload
    )
    on conflict (deduplication_key) do nothing;
  end if;

  if tg_op = 'UPDATE'
    and new.status = 'cancelled'
    and old.status is distinct from new.status
  then
    update public.automation_events
    set
      processed_at = now(),
      locked_at = null,
      locked_by = null,
      last_error = 'Appointment cancelled before reminder delivery.'
    where aggregate_id = new.id
      and event_type = 'appointment.reminder_24h'
      and processed_at is null;

    insert into public.automation_events (
      business_id,
      event_type,
      aggregate_id,
      deduplication_key,
      payload
    )
    values (
      new.business_id,
      'appointment.cancelled',
      new.id,
      'appointment:' || new.id::text || ':cancelled',
      v_payload
    )
    on conflict (deduplication_key) do nothing;

    return new;
  end if;

  if new.status in ('pending', 'confirmed')
    and new.starts_at > now() + interval '90 minutes'
    and (
      tg_op = 'INSERT'
      or new.starts_at is distinct from old.starts_at
      or new.status is distinct from old.status
    )
  then
    if tg_op = 'UPDATE' then
      update public.automation_events
      set
        processed_at = now(),
        locked_at = null,
        locked_by = null,
        last_error = 'Superseded by an appointment change.'
      where aggregate_id = new.id
        and event_type = 'appointment.reminder_24h'
        and processed_at is null;
    end if;

    insert into public.automation_events (
      business_id,
      event_type,
      aggregate_id,
      deduplication_key,
      payload,
      available_at
    )
    values (
      new.business_id,
      'appointment.reminder_24h',
      new.id,
      'appointment:' || new.id::text || ':reminder24h:' || v_starts_key,
      v_payload,
      greatest(now(), new.starts_at - interval '24 hours')
    )
    on conflict (deduplication_key) do nothing;
  end if;

  return new;
end;
$$;

create trigger appointments_enqueue_automation
after insert or update of starts_at, status
on public.appointments
for each row execute function private.enqueue_appointment_automation();

revoke all on function private.appointment_automation_payload(public.appointments)
  from public, anon, authenticated;
revoke all on function private.enqueue_appointment_automation()
  from public, anon, authenticated;

create function public.claim_automation_events(
  p_worker_id text,
  p_limit integer default 20
)
returns table (
  id uuid,
  event_type text,
  aggregate_id uuid,
  payload jsonb,
  attempts integer,
  available_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(p_worker_id), '') is null
    or length(p_worker_id) > 120
  then
    raise exception 'Invalid automation worker id';
  end if;

  return query
  with candidates as (
    select event.id
    from public.automation_events as event
    where event.processed_at is null
      and event.available_at <= now()
      and event.attempts < 10
      and (
        event.locked_at is null
        or event.locked_at < now() - interval '15 minutes'
      )
    order by event.available_at, event.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  update public.automation_events as event
  set
    locked_at = now(),
    locked_by = p_worker_id,
    attempts = event.attempts + 1
  from candidates
  where event.id = candidates.id
  returning
    event.id,
    event.event_type,
    event.aggregate_id,
    event.payload,
    event.attempts,
    event.available_at;
end;
$$;

create function public.complete_automation_event(
  p_event_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.automation_events as event
  set
    processed_at = case
      when p_succeeded or event.attempts >= 10 then now()
      else null
    end,
    available_at = case
      when p_succeeded or event.attempts >= 10 then event.available_at
      else now() + make_interval(
        mins => least(60, power(2, greatest(0, event.attempts - 1))::integer)
      )
    end,
    locked_at = null,
    locked_by = null,
    last_error = case
      when p_succeeded then null
      else left(coalesce(p_error, 'Automation delivery failed.'), 1000)
    end
  where event.id = p_event_id
    and event.processed_at is null
    and event.locked_by = p_worker_id;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.claim_automation_events(text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_automation_event(
  uuid, text, boolean, text
) from public, anon, authenticated;

grant execute on function public.claim_automation_events(text, integer)
  to service_role;
grant execute on function public.complete_automation_event(
  uuid, text, boolean, text
) to service_role;
