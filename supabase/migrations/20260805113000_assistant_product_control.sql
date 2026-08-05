create table public.business_assistant_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  agent_enabled boolean not null default false,
  whatsapp_enabled boolean not null default true,
  voice_enabled boolean not null default false,
  activated_at timestamptz,
  paused_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint business_assistant_settings_voice_requires_agent
    check (not voice_enabled or agent_enabled)
);

comment on table public.business_assistant_settings is
  'Interruttori operativi del segretario digitale, isolati per attività.';

create table public.assistant_usage_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel text not null
    check (channel in ('shared', 'whatsapp', 'voice', 'browser_voice', 'system')),
  provider text not null
    check (provider in ('openai', 'meta', 'sip', 'internal')),
  event_type text not null,
  model text,
  input_units bigint not null default 0 check (input_units >= 0),
  output_units bigint not null default 0 check (output_units >= 0),
  duration_ms bigint check (duration_ms is null or duration_ms >= 0),
  cost_microunits bigint not null default 0 check (cost_microunits >= 0),
  currency text not null default 'USD' check (currency in ('USD', 'EUR')),
  provider_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.assistant_usage_events is
  'Registro append-only di utilizzo e costi stimati del segretario digitale.';
comment on column public.assistant_usage_events.cost_microunits is
  'Costo stimato espresso in milionesimi della valuta indicata.';

create unique index assistant_usage_events_provider_event_idx
  on public.assistant_usage_events (provider, provider_event_id)
  where provider_event_id is not null;

create index assistant_usage_events_business_occurred_idx
  on public.assistant_usage_events (business_id, occurred_at desc);

create index assistant_usage_events_business_provider_idx
  on public.assistant_usage_events (business_id, provider, occurred_at desc);

insert into public.business_assistant_settings (business_id)
select business.id
from public.businesses as business
on conflict (business_id) do nothing;

alter table public.business_assistant_settings enable row level security;
alter table public.assistant_usage_events enable row level security;

revoke all on table public.business_assistant_settings from public, anon, authenticated;
revoke all on table public.assistant_usage_events from public, anon, authenticated;

grant select, insert, update on table public.business_assistant_settings to service_role;
grant select, insert on table public.assistant_usage_events to service_role;
