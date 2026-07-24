create table public.whatsapp_conversations (
  business_id uuid not null
    references public.businesses(id) on delete cascade,
  phone_e164 text not null
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  state text not null default 'idle'
    check (
      state in (
        'idle',
        'awaiting_service',
        'awaiting_date',
        'awaiting_slot',
        'awaiting_name',
        'awaiting_confirmation'
      )
    ),
  context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context) = 'object'),
  last_message_sid text,
  last_response_text text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, phone_e164),
  unique (last_message_sid)
);

comment on table public.whatsapp_conversations is
  'Server-only state for signed WhatsApp booking conversations.';

create index whatsapp_conversations_expires_at_idx
  on public.whatsapp_conversations (expires_at);

create trigger whatsapp_conversations_touch_updated_at
before update on public.whatsapp_conversations
for each row execute function private.touch_updated_at();

alter table public.whatsapp_conversations enable row level security;

create policy whatsapp_conversations_deny_client_access
on public.whatsapp_conversations
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

revoke all on public.whatsapp_conversations
  from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp_conversations
  to service_role;
