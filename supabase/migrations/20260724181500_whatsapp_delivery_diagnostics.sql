alter table public.whatsapp_conversations
  add column last_delivery_status text
    check (last_delivery_status in ('pending', 'sent', 'failed')),
  add column last_outbound_sid text,
  add column last_delivery_error_code text,
  add column last_delivery_error_message text,
  add column last_delivery_attempt_at timestamptz;

comment on column public.whatsapp_conversations.last_delivery_status is
  'Most recent outbound WhatsApp delivery attempt: pending, sent, or failed.';

comment on column public.whatsapp_conversations.last_delivery_error_message is
  'Sanitized and truncated provider error for operational diagnostics.';
