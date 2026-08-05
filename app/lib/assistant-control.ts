import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "./supabase/server";

export type AssistantControlState = {
  businessId: string;
  businessActive: boolean;
  agentEnabled: boolean;
  whatsappEnabled: boolean;
  voiceEnabled: boolean;
  activatedAt: string | null;
  pausedAt: string | null;
  updatedAt: string | null;
  source: "database" | "legacy";
};

type AssistantControlPatch = {
  agentEnabled?: boolean;
  whatsappEnabled?: boolean;
  voiceEnabled?: boolean;
};

type UsageMetadataValue = string | number | boolean | null;

export type AssistantUsageEventInput = {
  supabase?: SupabaseClient;
  businessId?: string;
  businessSlug?: string;
  channel: "shared" | "whatsapp" | "voice" | "browser_voice" | "system";
  provider: "openai" | "meta" | "sip" | "internal";
  eventType: string;
  model?: string;
  inputUnits?: number;
  outputUnits?: number;
  durationMs?: number;
  costMicrounits?: number;
  currency?: "USD" | "EUR";
  providerEventId?: string;
  metadata?: Record<string, UsageMetadataValue>;
  occurredAt?: Date;
};

const OPENAI_TEXT_PRICES_USD_PER_MILLION = {
  "gpt-5-mini": { input: 0.25, output: 2 }
} as const;

function isMissingRelationError(error: { code?: string; message?: string } | null) {
  return Boolean(
    error &&
      (error.code === "42P01" ||
        error.code === "PGRST204" ||
        error.code === "PGRST205" ||
        /business_assistant_settings|assistant_usage_events/i.test(
          error.message ?? ""
        ))
  );
}

async function resolveBusiness(supabase: SupabaseClient, businessSlug: string) {
  const { data, error } = await supabase
    .from("businesses")
    .select("id, active")
    .eq("slug", businessSlug)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "ASSISTANT_BUSINESS_NOT_FOUND");
  }

  return {
    id: String(data.id),
    active: data.active !== false
  };
}

export async function getAssistantControl({
  supabase,
  businessSlug
}: {
  supabase: SupabaseClient;
  businessSlug: string;
}): Promise<AssistantControlState> {
  const business = await resolveBusiness(supabase, businessSlug);
  const { data, error } = await supabase
    .from("business_assistant_settings")
    .select(
      "agent_enabled, whatsapp_enabled, voice_enabled, activated_at, paused_at, updated_at"
    )
    .eq("business_id", business.id)
    .maybeSingle();

  if (isMissingRelationError(error)) {
    return {
      businessId: business.id,
      businessActive: business.active,
      agentEnabled: business.active,
      whatsappEnabled: true,
      voiceEnabled: false,
      activatedAt: null,
      pausedAt: null,
      updatedAt: null,
      source: "legacy"
    };
  }

  if (error) throw new Error(error.message);

  if (!data) {
    const now = new Date().toISOString();
    const { data: inserted, error: insertError } = await supabase
      .from("business_assistant_settings")
      .insert({ business_id: business.id })
      .select(
        "agent_enabled, whatsapp_enabled, voice_enabled, activated_at, paused_at, updated_at"
      )
      .single();

    if (insertError || !inserted) {
      throw new Error(insertError?.message ?? "ASSISTANT_SETTINGS_CREATE_FAILED");
    }

    return {
      businessId: business.id,
      businessActive: business.active,
      agentEnabled: false,
      whatsappEnabled: inserted.whatsapp_enabled !== false,
      voiceEnabled: false,
      activatedAt: null,
      pausedAt: null,
      updatedAt: String(inserted.updated_at ?? now),
      source: "database"
    };
  }

  return {
    businessId: business.id,
    businessActive: business.active,
    agentEnabled: business.active && data.agent_enabled === true,
    whatsappEnabled: data.whatsapp_enabled === true,
    voiceEnabled:
      business.active && data.agent_enabled === true && data.voice_enabled === true,
    activatedAt:
      typeof data.activated_at === "string" ? data.activated_at : null,
    pausedAt: typeof data.paused_at === "string" ? data.paused_at : null,
    updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
    source: "database"
  };
}

export async function updateAssistantControl({
  supabase,
  businessSlug,
  patch
}: {
  supabase: SupabaseClient;
  businessSlug: string;
  patch: AssistantControlPatch;
}): Promise<AssistantControlState> {
  const current = await getAssistantControl({ supabase, businessSlug });
  if (current.source !== "database") {
    throw new Error("ASSISTANT_CONTROL_MIGRATION_REQUIRED");
  }
  if (!current.businessActive && patch.agentEnabled === true) {
    throw new Error("ASSISTANT_BUSINESS_INACTIVE");
  }

  const now = new Date().toISOString();
  const agentEnabled = patch.agentEnabled ?? current.agentEnabled;
  const whatsappEnabled = patch.whatsappEnabled ?? current.whatsappEnabled;
  const voiceRequested = patch.voiceEnabled ?? current.voiceEnabled;
  const voiceEnabled = agentEnabled && voiceRequested;
  const activatedAt =
    agentEnabled && !current.agentEnabled ? now : current.activatedAt;
  const pausedAt = !agentEnabled && current.agentEnabled ? now : agentEnabled ? null : current.pausedAt;

  const { error } = await supabase
    .from("business_assistant_settings")
    .update({
      agent_enabled: agentEnabled,
      whatsapp_enabled: whatsappEnabled,
      voice_enabled: voiceEnabled,
      activated_at: activatedAt,
      paused_at: pausedAt,
      updated_at: now
    })
    .eq("business_id", current.businessId);

  if (error) throw new Error(error.message);
  return getAssistantControl({ supabase, businessSlug });
}

export function estimateOpenAiTextCostMicrousd({
  model,
  inputTokens,
  outputTokens
}: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}) {
  const normalizedModel = model.trim().toLowerCase();
  const priceKey = Object.keys(OPENAI_TEXT_PRICES_USD_PER_MILLION).find(
    (candidate) =>
      normalizedModel === candidate || normalizedModel.startsWith(`${candidate}-`)
  ) as keyof typeof OPENAI_TEXT_PRICES_USD_PER_MILLION | undefined;

  if (!priceKey) return null;
  const price = OPENAI_TEXT_PRICES_USD_PER_MILLION[priceKey];
  return Math.max(
    0,
    Math.round(inputTokens * price.input + outputTokens * price.output)
  );
}

export async function recordAssistantUsage(
  input: AssistantUsageEventInput
): Promise<boolean> {
  try {
    const supabase = input.supabase ?? getServerSupabase();
    let businessId = input.businessId;
    if (!businessId) {
      const businessSlug =
        input.businessSlug ??
        process.env.STUDIO_BARBER_BUSINESS_SLUG?.trim() ??
        "studio-barber-8";
      businessId = (await resolveBusiness(supabase, businessSlug)).id;
    }

    const { error } = await supabase.from("assistant_usage_events").insert({
      business_id: businessId,
      channel: input.channel,
      provider: input.provider,
      event_type: input.eventType.slice(0, 80),
      model: input.model?.slice(0, 120) ?? null,
      input_units: Math.max(0, Math.round(input.inputUnits ?? 0)),
      output_units: Math.max(0, Math.round(input.outputUnits ?? 0)),
      duration_ms:
        input.durationMs === undefined
          ? null
          : Math.max(0, Math.round(input.durationMs)),
      cost_microunits: Math.max(0, Math.round(input.costMicrounits ?? 0)),
      currency: input.currency ?? "USD",
      provider_event_id: input.providerEventId?.slice(0, 255) ?? null,
      metadata: input.metadata ?? {},
      occurred_at: (input.occurredAt ?? new Date()).toISOString()
    });

    if (!error || error.code === "23505") return true;
    if (isMissingRelationError(error)) return false;
    console.warn("assistant_usage_record_failed", { code: error.code });
    return false;
  } catch (error) {
    console.warn("assistant_usage_record_unavailable", {
      reason: error instanceof Error ? error.name : "unknown"
    });
    return false;
  }
}
