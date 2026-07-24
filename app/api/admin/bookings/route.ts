import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRequest } from "../../../lib/admin-request";
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

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return noStore({ error: "Accesso non autorizzato." }, 401);
  }

  try {
    const input = parsePublicBookingInput(await request.json());
    const suppliedKey = validateIdempotencyKey(
      request.headers.get("idempotency-key")
    );
    const businessSlug =
      process.env.STUDIO_BARBER_BUSINESS_SLUG?.trim() || "studio-barber-8";
    const resourceSlug =
      process.env.STUDIO_BARBER_RESOURCE_SLUG?.trim() || "main";
    const supabase = getServerSupabase();
    const { data, error } = await supabase.rpc("create_public_booking", {
      p_business_slug: businessSlug,
      p_service_slug: input.serviceSlug,
      p_date: input.date,
      p_start_time: input.startTime,
      p_customer_name: input.customerName,
      p_phone_e164: input.phoneE164,
      p_channel: "manual",
      p_notes: input.notes,
      p_external_reference: suppliedKey ?? `manual:${randomUUID()}`,
      p_resource_slug: resourceSlug
    });

    if (error) {
      if (
        error.code === "23P01" ||
        error.message.includes("SLOT_NOT_AVAILABLE")
      ) {
        return noStore({ error: "Questo orario non è più disponibile." }, 409);
      }
      if (error.message.includes("_NOT_FOUND")) {
        return noStore({ error: "Attività o servizio non trovato." }, 404);
      }
      if (error.code === "22023" || error.message.includes("INVALID_")) {
        return noStore({ error: "Dati della prenotazione non validi." }, 400);
      }
      throw new Error(error.message);
    }

    const appointment = Array.isArray(data) ? data[0] : null;
    if (!appointment) {
      throw new Error("BOOKING_NOT_CREATED");
    }

    return noStore(
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
      return noStore({ error: error.message }, 400);
    }
    if (error instanceof SupabaseConfigurationError) {
      return noStore({ error: error.message }, 503);
    }
    console.error("admin_booking_failed", error);
    return noStore({ error: "Non è stato possibile creare l’appuntamento." }, 500);
  }
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return noStore({ error: "Accesso non autorizzato." }, 401);
  }

  const appointmentId = request.nextUrl.searchParams.get("id");
  if (
    !appointmentId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      appointmentId
    )
  ) {
    return noStore({ error: "Appuntamento non valido." }, 400);
  }

  try {
    const businessSlug =
      process.env.STUDIO_BARBER_BUSINESS_SLUG?.trim() || "studio-barber-8";
    const supabase = getServerSupabase();
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id")
      .eq("slug", businessSlug)
      .single();

    if (businessError || !business) {
      throw new Error(businessError?.message ?? "BUSINESS_NOT_FOUND");
    }

    const { data, error } = await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", appointmentId)
      .eq("business_id", business.id)
      .neq("status", "cancelled")
      .select("id")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return noStore({ error: "Appuntamento non trovato." }, 404);
    return noStore({ ok: true });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return noStore({ error: error.message }, 503);
    }
    console.error("admin_booking_cancel_failed", error);
    return noStore({ error: "Non è stato possibile annullare l’appuntamento." }, 500);
  }
}
