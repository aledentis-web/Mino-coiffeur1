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

const MAX_BODY_BYTES = 8_192;

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function normalizedPhone(value: unknown) {
  if (typeof value !== "string") return null;
  const phone = value.replace(/[\s().-]/g, "").trim();
  return /^\+[1-9][0-9]{7,14}$/.test(phone) ? phone : null;
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

    const phone = normalizedPhone((body as Record<string, unknown>).phone);
    if (!phone) return noStore({ error: "Numero di telefono non valido." }, 400);

    const supabase = getServerSupabase();
    const { control, businessSlug } = await requireVoiceAgentOperational({
      supabase
    });
    const { data, error } = await supabase.rpc(
      "list_customer_upcoming_appointments",
      {
        p_business_slug: businessSlug,
        p_phone_e164: phone
      }
    );
    if (error) throw new Error(`VOICE_APPOINTMENTS_FAILED:${error.code}`);

    await recordAssistantUsage({
      supabase,
      businessId: control.businessId,
      channel: "voice",
      provider: "sip",
      eventType: "appointments_tool",
      inputUnits: 1,
      currency: "EUR",
      metadata: { unit: "tool_calls" }
    });

    return noStore({ appointments: data ?? [] });
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
    console.error("voice_appointments_tool_failed", error);
    return noStore({ error: "Appuntamenti non disponibili." }, 500);
  }
}
