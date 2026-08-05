import { NextResponse } from "next/server";
import { recordAssistantUsage } from "../../../../lib/assistant-control";
import {
  getServerSupabase,
  SupabaseConfigurationError
} from "../../../../lib/supabase/server";
import {
  requireVoiceAgentOperational,
  requireVoiceToolAuthorization,
  VoiceAgentPausedError,
  VoiceToolAuthorizationError
} from "../../../../lib/voice-tool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  try {
    requireVoiceToolAuthorization(request);
    const supabase = getServerSupabase();
    const { control } = await requireVoiceAgentOperational({ supabase });
    const { data, error } = await supabase
      .from("services")
      .select("name, slug, description, duration_minutes, price_cents")
      .eq("business_id", control.businessId)
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (error) throw new Error(error.message);

    await recordAssistantUsage({
      supabase,
      businessId: control.businessId,
      channel: "voice",
      provider: "sip",
      eventType: "services_tool",
      inputUnits: 1,
      currency: "EUR",
      metadata: { unit: "tool_calls" }
    });

    return noStore({
      services: (data ?? []).map((service) => ({
        name: service.name,
        slug: service.slug,
        description: service.description,
        durationMinutes: service.duration_minutes,
        priceCents: service.price_cents
      }))
    });
  } catch (error) {
    if (error instanceof VoiceToolAuthorizationError) {
      return noStore(
        {
          error:
            error.message === "VOICE_TOOL_NOT_CONFIGURED"
              ? "Strumenti vocali non configurati."
              : "Accesso non autorizzato."
        },
        error.message === "VOICE_TOOL_NOT_CONFIGURED" ? 503 : 401
      );
    }
    if (error instanceof VoiceAgentPausedError) {
      return noStore({ error: "Agente telefonico in pausa." }, 423);
    }
    if (error instanceof SupabaseConfigurationError) {
      return noStore({ error: error.message }, 503);
    }
    console.error("voice_services_tool_failed", error);
    return noStore({ error: "Servizi non disponibili." }, 500);
  }
}
