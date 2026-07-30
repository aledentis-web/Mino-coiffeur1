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

  return {
    bookingEngine,
    languageAgent,
    whatsapp,
    browserVoice: bookingEngine && languageAgent,
    phoneVoice:
      bookingEngine &&
      languageAgent &&
      hasEnvironmentValue("VOICE_SIP_FORWARDING_NUMBER"),
    automations: hasEnvironmentValue("N8N_AUTOMATION_SECRET")
  };
}
