import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  BookingValidationError,
  parsePublicBookingInput,
  validateIdempotencyKey
} from "../../../lib/public-booking";
import {
  getServerSupabase,
  SupabaseConfigurationError
} from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 16_384;

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
      return noStoreJson({ error: "Richiesta troppo grande." }, 413);
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return noStoreJson({ error: "Formato della richiesta non valido." }, 415);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return noStoreJson({ error: "JSON non valido." }, 400);
    }

    const input = parsePublicBookingInput(body);
    const suppliedKey = validateIdempotencyKey(
      request.headers.get("idempotency-key")
    );
    const externalReference = suppliedKey ?? `site:${randomUUID()}`;
    const businessSlug =
      process.env.STUDIO_BARBER_BUSINESS_SLUG ?? "studio-barber-8";
    const resourceSlug =
      process.env.STUDIO_BARBER_RESOURCE_SLUG ?? "main";
    const supabase = getServerSupabase();

    const { data, error } = await supabase.rpc("create_public_booking", {
      p_business_slug: businessSlug,
      p_service_slug: input.serviceSlug,
      p_date: input.date,
      p_start_time: input.startTime,
      p_customer_name: input.customerName,
      p_phone_e164: input.phoneE164,
      p_channel: "site",
      p_notes: input.notes,
      p_external_reference: externalReference,
      p_resource_slug: resourceSlug
    });

    if (error) {
      if (
        error.code === "23P01" ||
        error.message.includes("SLOT_NOT_AVAILABLE")
      ) {
        return noStoreJson(
          { error: "Questo orario non è più disponibile." },
          409
        );
      }
      if (error.message.includes("_NOT_FOUND")) {
        return noStoreJson({ error: "Attività o servizio non trovato." }, 404);
      }
      if (error.code === "22023" || error.message.includes("INVALID_")) {
        return noStoreJson({ error: "Dati della prenotazione non validi." }, 400);
      }
      console.error("public_booking_rpc_failed", {
        code: error.code,
        message: error.message
      });
      return noStoreJson(
        { error: "Non è stato possibile confermare l’appuntamento." },
        500
      );
    }

    const appointment = Array.isArray(data) ? data[0] : null;
    if (!appointment) {
      return noStoreJson(
        { error: "Non è stato possibile confermare l’appuntamento." },
        500
      );
    }

    return noStoreJson(
      {
        appointment: {
          id: appointment.appointment_id,
          startsAt: appointment.appointment_starts_at,
          endsAt: appointment.appointment_ends_at,
          durationMinutes: appointment.appointment_duration_minutes
        },
        idempotent: appointment.idempotent
      },
      appointment.idempotent ? 200 : 201
    );
  } catch (error) {
    if (error instanceof BookingValidationError) {
      return noStoreJson({ error: error.message }, 400);
    }
    if (error instanceof SupabaseConfigurationError) {
      return noStoreJson({ error: error.message }, 503);
    }
    console.error("public_booking_request_failed", error);
    return noStoreJson(
      { error: "Non è stato possibile confermare l’appuntamento." },
      500
    );
  }
}
