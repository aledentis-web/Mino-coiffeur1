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

const MAX_BODY_BYTES = 12_288;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

    const payload = body as Record<string, unknown>;
    const phone = normalizedPhone(payload.phone);
    const appointmentId =
      typeof payload.appointmentId === "string" &&
      UUID_PATTERN.test(payload.appointmentId)
        ? payload.appointmentId
        : null;
    if (!phone || !appointmentId) {
      return noStore({ error: "Appuntamento o telefono non valido." }, 400);
    }
    if (payload.confirmed !== true) {
      return noStore(
        { error: "Serve la conferma esplicita del cliente prima di cancellare." },
        409
      );
    }

    const reason =
      typeof payload.reason === "string"
        ? payload.reason.trim().slice(0, 500)
        : "Cancellato dal cliente durante una telefonata con il segretario digitale.";
    const supabase = getServerSupabase();
    const { control, businessSlug } = await requireVoiceAgentOperational({
      supabase
    });
    const { data, error } = await supabase.rpc("cancel_customer_appointment", {
      p_business_slug: businessSlug,
      p_appointment_id: appointmentId,
      p_phone_e164: phone,
      p_cancelled_via: "voice",
      p_reason: reason
    });

    if (error) {
      if (error.message.includes("APPOINTMENT_NOT_FOUND")) {
        return noStore({ error: "Appuntamento non trovato." }, 404);
      }
      if (error.message.includes("APPOINTMENT_NOT_CANCELLABLE")) {
        return noStore({ error: "L’appuntamento non è più cancellabile." }, 409);
      }
      throw new Error(`VOICE_CANCELLATION_FAILED:${error.code}`);
    }

    const cancellation = Array.isArray(data) ? data[0] : data;
    if (!cancellation) throw new Error("VOICE_CANCELLATION_FAILED:EMPTY");

    await recordAssistantUsage({
      supabase,
      businessId: control.businessId,
      channel: "voice",
      provider: "sip",
      eventType: "cancellation_tool",
      outputUnits: 1,
      currency: "EUR",
      providerEventId: `cancellation:${cancellation.appointment_id}`,
      metadata: {
        unit: "cancellations",
        appointmentId: cancellation.appointment_id,
        idempotent: cancellation.idempotent === true
      }
    });

    return noStore({ cancellation });
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
    console.error("voice_cancellation_tool_failed", error);
    return noStore({ error: "Cancellazione non riuscita." }, 500);
  }
}
