import assert from "node:assert/strict";
import test from "node:test";
import { getAssistantStatus } from "./assistant-status.ts";

const NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "OPENAI_API_KEY",
  "META_WHATSAPP_VERIFY_TOKEN",
  "META_WHATSAPP_APP_SECRET",
  "META_WHATSAPP_ACCESS_TOKEN",
  "META_WHATSAPP_PHONE_NUMBER_ID",
  "META_GRAPH_API_VERSION",
  "VOICE_SIP_FORWARDING_NUMBER",
  "N8N_AUTOMATION_SECRET"
] as const;

test("non dichiara pronti canali con configurazione incompleta", () => {
  const previous = Object.fromEntries(
    NAMES.map((name) => [name, process.env[name]])
  );
  try {
    for (const name of NAMES) delete process.env[name];
    assert.deepEqual(getAssistantStatus(), {
      bookingEngine: false,
      languageAgent: false,
      whatsapp: false,
      browserVoice: false,
      phoneVoice: false,
      automations: false
    });

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.VOICE_SIP_FORWARDING_NUMBER = "+390000000000";
    assert.equal(getAssistantStatus().bookingEngine, true);
    assert.equal(getAssistantStatus().languageAgent, true);
    assert.equal(getAssistantStatus().browserVoice, true);
    assert.equal(getAssistantStatus().phoneVoice, true);
    assert.equal(getAssistantStatus().whatsapp, false);
  } finally {
    for (const name of NAMES) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
