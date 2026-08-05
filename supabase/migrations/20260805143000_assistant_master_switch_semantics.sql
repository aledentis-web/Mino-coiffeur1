alter table public.business_assistant_settings
  drop constraint if exists business_assistant_settings_voice_requires_agent;

comment on column public.business_assistant_settings.agent_enabled is
  'Interruttore generale. Quando è spento i canali restano selezionati ma non operativi.';
comment on column public.business_assistant_settings.whatsapp_enabled is
  'Preferenza persistente del canale WhatsApp, indipendente dal master switch.';
comment on column public.business_assistant_settings.voice_enabled is
  'Preferenza persistente del canale voce, indipendente dal master switch.';
