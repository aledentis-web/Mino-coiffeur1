import { NextResponse } from "next/server";
import { recordAssistantUsage } from "../../../../lib/assistant-control";
import {
  BookingValidationError,
  parseAvailabilityInput
} from "../../../../lib/public-booking";
import {
  getServerSupabase,
  SupabaseConfigurationError
} from "../../../../lib/supabase/server";
import {
  configuredVoiceResourceSlug,
  requireVoiceAgentOperational,
  requireVoiceToolAuthorization,
  VoiceAgentPausedError,
  VoiceToolAuthorizationError
} from "../../../../lib/voice-tool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 8_192;

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  try {
    requireVoiceToolAuthorization(request);

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
      return noStore({ error: "Richiesta troppo grande." }, 413);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStore({ error: "JSON non valido." }, 400);
    }

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return noStore({ error: "Richiesta non valida." }, 400);
    }

    const payload = body as Record<string, unknown>;
    const searchParams = new URLSearchParams();
    if (typeof payload.serviceSlug === "string") {
      searchParams.set("service", payload.serviceSlug);
    }
    if (typeof payload.date === "string") {
      searchParams.set("date", payload.date);
    }
    if (typeof payload.phone === "string" && payload.phone.trim()) {
      searchParams.set("phone", payload.phone);
    }

    const input = parseAvailabilityInput(searchParams);
    const supabase = getServerSupabase();
    const { control, businessSlug } = await requireVoiceAgentOperational({
      supabase
    });
    const { data, error } = await supabase.rpc("get_public_availability", {
      p_business_slug: businessSlug,
      p_service_slug: input.serviceSlug,
      p_date: input.date,
      p_phone_e164: input.phoneE164,
      p_resource_slug: configuredVoiceResourceSlug()
    });

    if (error) {
      if (error.message.includes("_NOT_FOUND")) {
        return noStore({ error: "Attività o servizio non trovato." }, 404);
      }
      throw new Error(`VOICE_AVAILABILITY_FAILED:${error.code}`);
    }

    await recordAssistantUsage({
      supabase,
      businessId: control.businessId,
      channel: "voice",
      provider: "sip",
      eventType: "availability_tool",
      inputUnits: 1,
      currency: "EUR",
      metadata: {
        unit: "tool_calls",
        serviceSlug: input.serviceSlug,
        date: input.date
      }
    });

    return noStore({
      serviceSlug: input.serviceSlug,
      date: input.date,
      slots: data ?? []
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
    if (error instanceof BookingValidationError) {
      return noStore({ error: error.message }, 400);
    }
    if (error instanceof SupabaseConfigurationError) {
      return noStore({ error: error.message }, 503);
    }
    console.error("voice_availability_tool_failed", error);
    return noStore({ error: "Orari non disponibili." }, 500);
  }
}
