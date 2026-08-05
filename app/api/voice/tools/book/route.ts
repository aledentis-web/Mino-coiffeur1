import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { recordAssistantUsage } from "../../../../lib/assistant-control";
import {
  BookingValidationError,
  parsePublicBookingInput
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

const MAX_BODY_BYTES = 16_384;

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function deterministicVoiceReference(input: {
  serviceSlug: string;
  date: string;
  startTime: string;
  customerName: string;
  phoneE164: string;
}) {
  const digest = createHash("sha256")
    .update(
      [
        input.phoneE164,
        input.serviceSlug,
        input.date,
        input.startTime,
        input.customerName.toLocaleLowerCase("it-IT")
      ].join("|")
    )
    .digest("hex")
    .slice(0, 40);
  return `voice:${digest}`;
}

export async function POST(request: Request) {
  try {
    requireVoiceToolAuthorization(request);

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
      return noStore({ error: "Richiesta troppo grande." }, 413);
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return noStore({ error: "Formato della richiesta non valido." }, 415);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStore({ error: "JSON non valido." }, 400);
    }

    const input = parsePublicBookingInput(body);
    const supabase = getServerSupabase();
    const { control, businessSlug } = await requireVoiceAgentOperational({
      supabase
    });
    const externalReference = deterministicVoiceReference(input);
    const { data, error } = await supabase.rpc("create_public_booking", {
      p_business_slug: businessSlug,
      p_service_slug: input.serviceSlug,
      p_date: input.date,
      p_start_time: input.startTime,
      p_customer_name: input.customerName,
      p_phone_e164: input.phoneE164,
      p_channel: "voice",
      p_notes:
        input.notes || "Prenotazione creata dall’agente telefonico.",
      p_external_reference: externalReference,
      p_resource_slug: configuredVoiceResourceSlug()
    });

    if (error) {
      if (
        error.code === "23P01" ||
        error.message.includes("SLOT_NOT_AVAILABLE")
      ) {
        return noStore(
          { error: "Questo orario non è più disponibile." },
          409
        );
      }
      if (error.message.includes("_NOT_FOUND")) {
        return noStore({ error: "Attività o servizio non trovato." }, 404);
      }
      if (error.code === "22023" || error.message.includes("INVALID_")) {
        return noStore({ error: "Dati della prenotazione non validi." }, 400);
      }
      throw new Error(`VOICE_BOOKING_FAILED:${error.code}`);
    }

    const appointment = Array.isArray(data) ? data[0] : null;
    if (!appointment) {
      throw new Error("VOICE_BOOKING_FAILED:EMPTY");
    }

    await recordAssistantUsage({
      supabase,
      businessId: control.businessId,
      channel: "voice",
      provider: "sip",
      eventType: "booking_tool",
      outputUnits: 1,
      currency: "EUR",
      providerEventId: `booking:${appointment.appointment_id}`,
      metadata: {
        unit: "bookings",
        serviceSlug: input.serviceSlug,
        date: input.date,
        startTime: input.startTime,
        idempotent: appointment.idempotent === true
      }
    });

    return noStore(
      {
        appointment: {
          id: appointment.appointment_id,
          startsAt: appointment.appointment_starts_at,
          endsAt: appointment.appointment_ends_at,
          durationMinutes: appointment.appointment_duration_minutes,
          customerName: input.customerName,
          serviceSlug: input.serviceSlug
        },
        idempotent: appointment.idempotent === true
      },
      appointment.idempotent ? 200 : 201
    );
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
    console.error("voice_booking_tool_failed", error);
    return noStore(
      { error: "Non è stato possibile confermare l’appuntamento." },
      500
    );
  }
}
