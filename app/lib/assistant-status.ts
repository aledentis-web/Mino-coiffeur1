export type AssistantStatus = {
  bookingEngine: boolean;
  languageAgent: boolean;
  whatsapp: boolean;
  browserVoice: boolean;
  phoneVoice: boolean;
  automations: boolean;
};

function hasEnvironmentValue(name: string) {
  return Boolean(process.env[name]?.trim());
}

function hasStrongEnvironmentSecret(name: string) {
  return (process.env[name]?.trim().length ?? 0) >= 32;
}

export function getAssistantStatus(): AssistantStatus {
  const bookingEngine =
    hasEnvironmentValue("NEXT_PUBLIC_SUPABASE_URL") &&
    hasEnvironmentValue("SUPABASE_SECRET_KEY");
  const languageAgent = hasEnvironmentValue("OPENAI_API_KEY");
  const whatsapp = [
    "META_WHATSAPP_VERIFY_TOKEN",
    "META_WHATSAPP_APP_SECRET",
    "META_WHATSAPP_ACCESS_TOKEN",
    "META_WHATSAPP_PHONE_NUMBER_ID",
    "META_GRAPH_API_VERSION"
  ].every(hasEnvironmentValue);
  const phoneVoice =
    bookingEngine &&
    hasStrongEnvironmentSecret("VOICE_TOOL_SECRET") &&
    hasEnvironmentValue("VOICE_PROVIDER_ASSISTANT_ID") &&
    hasEnvironmentValue("VOICE_PHONE_NUMBER");

  return {
    bookingEngine,
    languageAgent,
    whatsapp,
    browserVoice: bookingEngine && languageAgent,
    phoneVoice,
    automations: hasStrongEnvironmentSecret("N8N_AUTOMATION_SECRET")
  };
}
