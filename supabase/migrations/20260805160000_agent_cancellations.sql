alter table public.appointments
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists cancelled_via text
    check (cancelled_via is null or cancelled_via in ('site', 'whatsapp', 'voice', 'manual'));

create function public.list_customer_upcoming_appointments(
  p_business_slug text,
  p_phone_e164 text
)
returns table (
  appointment_id uuid,
  service_name text,
  starts_at timestamptz,
  status text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    appointment.id,
    appointment.service_name,
    appointment.starts_at,
    appointment.status
  from public.appointments as appointment
  join public.businesses as business
    on business.id = appointment.business_id
  where business.slug = p_business_slug
    and business.active = true
    and appointment.customer_phone_e164 = p_phone_e164
    and appointment.status in ('pending', 'confirmed')
    and appointment.starts_at > now()
  order by appointment.starts_at asc
  limit 20;
$$;

create function public.cancel_customer_appointment(
  p_business_slug text,
  p_appointment_id uuid,
  p_phone_e164 text,
  p_cancelled_via text,
  p_reason text default null
)
returns table (
  appointment_id uuid,
  service_name text,
  starts_at timestamptz,
  idempotent boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_appointment public.appointments%rowtype;
begin
  if p_cancelled_via not in ('site', 'whatsapp', 'voice', 'manual') then
    raise exception using errcode = '22023', message = 'INVALID_CANCELLATION_CHANNEL';
  end if;

  select business.id into v_business_id
  from public.businesses as business
  where business.slug = p_business_slug
    and business.active = true;

  if v_business_id is null then
    raise exception using errcode = 'P0002', message = 'BUSINESS_NOT_FOUND';
  end if;

  select * into v_appointment
  from public.appointments as appointment
  where appointment.id = p_appointment_id
    and appointment.business_id = v_business_id
    and appointment.customer_phone_e164 = p_phone_e164
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'APPOINTMENT_NOT_FOUND';
  end if;

  if v_appointment.status = 'cancelled' then
    appointment_id := v_appointment.id;
    service_name := v_appointment.service_name;
    starts_at := v_appointment.starts_at;
    idempotent := true;
    return next;
    return;
  end if;

  if v_appointment.status not in ('pending', 'confirmed')
    or v_appointment.starts_at <= now() then
    raise exception using errcode = '22023', message = 'APPOINTMENT_NOT_CANCELLABLE';
  end if;

  update public.appointments
  set status = 'cancelled',
      cancelled_at = now(),
      cancellation_reason = left(
        coalesce(
          nullif(trim(p_reason), ''),
          'Cancellato dal cliente tramite segretario digitale.'
        ),
        500
      ),
      cancelled_via = p_cancelled_via,
      updated_at = now()
  where id = v_appointment.id
  returning * into v_appointment;

  appointment_id := v_appointment.id;
  service_name := v_appointment.service_name;
  starts_at := v_appointment.starts_at;
  idempotent := false;
  return next;
end;
$$;

create function public.cancel_booking_conversation(
  p_business_id uuid,
  p_phone_e164 text,
  p_expected_version bigint,
  p_event_order_key text,
  p_provider_message_id text,
  p_response_text text,
  p_expires_at timestamptz,
  p_business_slug text,
  p_appointment_id uuid,
  p_cancelled_via text,
  p_reason text default null
)
returns table (
  appointment_id uuid,
  service_name text,
  starts_at timestamptz,
  idempotent boolean,
  new_version bigint
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_cancellation record;
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

  select * into v_cancellation
  from public.cancel_customer_appointment(
    p_business_slug,
    p_appointment_id,
    p_phone_e164,
    p_cancelled_via,
    p_reason
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

  appointment_id := v_cancellation.appointment_id;
  service_name := v_cancellation.service_name;
  starts_at := v_cancellation.starts_at;
  idempotent := v_cancellation.idempotent;
  return next;
end;
$$;

revoke all on function public.list_customer_upcoming_appointments(text, text)
  from public, anon, authenticated;
revoke all on function public.cancel_customer_appointment(text, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.cancel_booking_conversation(
  uuid, text, bigint, text, text, text, timestamptz, text, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.list_customer_upcoming_appointments(text, text)
  to service_role;
grant execute on function public.cancel_customer_appointment(text, uuid, text, text, text)
  to service_role;
grant execute on function public.cancel_booking_conversation(
  uuid, text, bigint, text, text, text, timestamptz, text, uuid, text, text
) to service_role;
