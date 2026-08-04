alter table public.whatsapp_conversations
  add column if not exists version bigint not null default 0,
  add column if not exists last_event_order_key text;

create table public.booking_inbound_events (
  provider_message_id text primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  channel text not null check (channel in ('whatsapp', 'voice')),
  provider_occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  attempts integer not null default 1 check (attempts > 0),
  processing_started_at timestamptz not null default now(),
  processed_at timestamptz,
  response_text text,
  error_code text,
  delivery_status text check (delivery_status in ('pending', 'sent', 'failed')),
  outbound_provider_message_id text,
  delivery_error_code text,
  delivery_error_message text,
  delivery_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index booking_inbound_events_business_phone_received_idx
  on public.booking_inbound_events (business_id, phone_e164, received_at desc);
create index booking_inbound_events_status_started_idx
  on public.booking_inbound_events (status, processing_started_at);

alter table public.booking_inbound_events enable row level security;
revoke all on table public.booking_inbound_events from public, anon, authenticated;
grant select, insert, update on table public.booking_inbound_events to service_role;

create function public.claim_booking_inbound_event(
  p_provider_message_id text,
  p_business_id uuid,
  p_phone_e164 text,
  p_channel text,
  p_provider_occurred_at timestamptz
)
returns table (claim_status text, response_text text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer;
  v_event public.booking_inbound_events%rowtype;
begin
  insert into public.booking_inbound_events (
    provider_message_id,
    business_id,
    phone_e164,
    channel,
    provider_occurred_at
  ) values (
    p_provider_message_id,
    p_business_id,
    p_phone_e164,
    p_channel,
    p_provider_occurred_at
  )
  on conflict (provider_message_id) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    return query select 'claimed'::text, null::text;
    return;
  end if;

  select * into v_event
  from public.booking_inbound_events
  where provider_message_id = p_provider_message_id
  for update;

  if v_event.status = 'processed' then
    return query select 'duplicate'::text, v_event.response_text;
    return;
  end if;

  if v_event.status = 'processing'
    and v_event.processing_started_at > now() - interval '5 minutes' then
    return query select 'busy'::text, v_event.response_text;
    return;
  end if;

  update public.booking_inbound_events
  set status = 'processing',
      attempts = attempts + 1,
      processing_started_at = now(),
      processed_at = null,
      error_code = null,
      updated_at = now()
  where provider_message_id = p_provider_message_id;

  return query select 'claimed'::text, v_event.response_text;
end;
$$;

create function public.get_booking_conversation(
  p_business_id uuid,
  p_phone_e164 text
)
returns table (
  state text,
  context jsonb,
  last_message_sid text,
  last_response_text text,
  expires_at timestamptz,
  version bigint,
  last_event_order_key text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    conversation.state,
    conversation.context,
    conversation.last_message_sid,
    conversation.last_response_text,
    conversation.expires_at,
    conversation.version,
    conversation.last_event_order_key
  from public.whatsapp_conversations as conversation
  where conversation.business_id = p_business_id
    and conversation.phone_e164 = p_phone_e164;
$$;

create function public.complete_booking_inbound_event(
  p_provider_message_id text,
  p_response_text text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.booking_inbound_events
  set status = 'processed',
      response_text = p_response_text,
      processed_at = now(),
      error_code = null,
      updated_at = now()
  where provider_message_id = p_provider_message_id;
$$;

create function public.fail_booking_inbound_event(
  p_provider_message_id text,
  p_error_code text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.booking_inbound_events
  set status = 'failed',
      error_code = left(p_error_code, 80),
      updated_at = now()
  where provider_message_id = p_provider_message_id
    and status = 'processing';
$$;

create function public.save_booking_conversation(
  p_business_id uuid,
  p_phone_e164 text,
  p_expected_version bigint,
  p_event_order_key text,
  p_state text,
  p_context jsonb,
  p_provider_message_id text,
  p_response_text text,
  p_expires_at timestamptz
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_new_version bigint;
begin
  select * into v_conversation
  from public.whatsapp_conversations
  where business_id = p_business_id
    and phone_e164 = p_phone_e164
  for update;

  if found then
    if v_conversation.version <> p_expected_version then
      raise exception using errcode = '40001',
        message = 'BOOKING_CONVERSATION_VERSION_CONFLICT';
    end if;
    if v_conversation.last_event_order_key is not null
      and p_event_order_key <= v_conversation.last_event_order_key then
      raise exception using errcode = '22000',
        message = 'BOOKING_CONVERSATION_STALE_EVENT';
    end if;

    update public.whatsapp_conversations
    set state = p_state,
        context = p_context,
        last_message_sid = p_provider_message_id,
        last_response_text = p_response_text,
        expires_at = p_expires_at,
        version = version + 1,
        last_event_order_key = p_event_order_key,
        updated_at = now()
    where business_id = p_business_id
      and phone_e164 = p_phone_e164
    returning version into v_new_version;
  else
    if p_expected_version <> 0 then
      raise exception using errcode = '40001',
        message = 'BOOKING_CONVERSATION_VERSION_CONFLICT';
    end if;
    begin
      insert into public.whatsapp_conversations (
        business_id,
        phone_e164,
        state,
        context,
        last_message_sid,
        last_response_text,
        expires_at,
        version,
        last_event_order_key
      ) values (
        p_business_id,
        p_phone_e164,
        p_state,
        p_context,
        p_provider_message_id,
        p_response_text,
        p_expires_at,
        1,
        p_event_order_key
      )
      returning version into v_new_version;
    exception when unique_violation then
      raise exception using errcode = '40001',
        message = 'BOOKING_CONVERSATION_VERSION_CONFLICT';
    end;
  end if;

  update public.booking_inbound_events
  set status = 'processed',
      response_text = p_response_text,
      processed_at = now(),
      error_code = null,
      updated_at = now()
  where provider_message_id = p_provider_message_id;

  return v_new_version;
end;
$$;

create function public.confirm_booking_conversation(
  p_business_id uuid,
  p_phone_e164 text,
  p_expected_version bigint,
  p_event_order_key text,
  p_provider_message_id text,
  p_response_text text,
  p_expires_at timestamptz,
  p_business_slug text,
  p_service_slug text,
  p_date date,
  p_start_time time,
  p_customer_name text,
  p_channel text,
  p_notes text,
  p_external_reference text,
  p_resource_slug text
)
returns table (appointment_id uuid, idempotent boolean, new_version bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_appointment record;
begin
  select * into v_conversation
  from public.whatsapp_conversations
  where business_id = p_business_id
    and phone_e164 = p_phone_e164
  for update;

  if not found or v_conversation.version <> p_expected_version then
    raise exception using errcode = '40001',
      message = 'BOOKING_CONVERSATION_VERSION_CONFLICT';
  end if;
  if v_conversation.last_event_order_key is not null
    and p_event_order_key <= v_conversation.last_event_order_key then
    raise exception using errcode = '22000',
      message = 'BOOKING_CONVERSATION_STALE_EVENT';
  end if;

  select * into v_appointment
  from public.create_public_booking(
    p_business_slug,
    p_service_slug,
    p_date,
    p_start_time,
    p_customer_name,
    p_phone_e164,
    p_channel,
    p_notes,
    p_external_reference,
    p_resource_slug
  );

  update public.whatsapp_conversations
  set state = 'idle',
      context = '{}'::jsonb,
      last_message_sid = p_provider_message_id,
      last_response_text = p_response_text,
      expires_at = p_expires_at,
      version = version + 1,
      last_event_order_key = p_event_order_key,
      updated_at = now()
  where business_id = p_business_id
    and phone_e164 = p_phone_e164
  returning version into new_version;

  update public.booking_inbound_events
  set status = 'processed',
      response_text = p_response_text,
      processed_at = now(),
      error_code = null,
      updated_at = now()
  where provider_message_id = p_provider_message_id;

  appointment_id := v_appointment.appointment_id;
  idempotent := v_appointment.idempotent;
  return next;
end;
$$;

revoke all on function public.claim_booking_inbound_event(text, uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.get_booking_conversation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_booking_inbound_event(text, text)
  from public, anon, authenticated;
revoke all on function public.fail_booking_inbound_event(text, text)
  from public, anon, authenticated;
revoke all on function public.save_booking_conversation(
  uuid, text, bigint, text, text, jsonb, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.confirm_booking_conversation(
  uuid, text, bigint, text, text, text, timestamptz,
  text, text, date, time, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.claim_booking_inbound_event(text, uuid, text, text, timestamptz)
  to service_role;
grant execute on function public.get_booking_conversation(uuid, text)
  to service_role;
grant execute on function public.complete_booking_inbound_event(text, text)
  to service_role;
grant execute on function public.fail_booking_inbound_event(text, text)
  to service_role;
grant execute on function public.save_booking_conversation(
  uuid, text, bigint, text, text, jsonb, text, text, timestamptz
) to service_role;
grant execute on function public.confirm_booking_conversation(
  uuid, text, bigint, text, text, text, timestamptz,
  text, text, date, time, text, text, text, text, text
) to service_role;
