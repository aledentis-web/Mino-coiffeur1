import { NextRequest, NextResponse } from "next/server";
import type { AppointmentStatus, BookingChannel } from "../../../lib/domain";
import { isAuthorizedAdminRequest } from "../../../lib/admin-request";
import {
  BookingValidationError,
  validateDate
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

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return noStore({ error: "Accesso non autorizzato." }, 401);
  }

  try {
    const date = validateDate(request.nextUrl.searchParams.get("date"));
    const businessSlug =
      process.env.STUDIO_BARBER_BUSINESS_SLUG?.trim() || "studio-barber-8";
    const supabase = getServerSupabase();
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id, timezone")
      .eq("slug", businessSlug)
      .single();

    if (businessError || !business) {
      throw new Error(businessError?.message ?? "BUSINESS_NOT_FOUND");
    }

    const anchor = new Date(`${date}T00:00:00.000Z`);
    const from = new Date(anchor);
    from.setUTCDate(from.getUTCDate() - 1);
    const to = new Date(anchor);
    to.setUTCDate(to.getUTCDate() + 2);

    const { data, error } = await supabase
      .from("appointments")
      .select(
        "id, customer_id, customer_name, customer_phone_e164, service_id, service_name, duration_minutes, starts_at, ends_at, channel, status, notes, external_reference, created_at"
      )
      .eq("business_id", business.id)
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString())
      .order("starts_at", { ascending: true });

    if (error) throw new Error(error.message);

    const dateFormatter = new Intl.DateTimeFormat("sv-SE", {
      timeZone: business.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    const timeFormatter = new Intl.DateTimeFormat("it-IT", {
      timeZone: business.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });

    const appointments = (data ?? [])
      .filter((appointment) => dateFormatter.format(new Date(appointment.starts_at)) === date)
      .map((appointment) => ({
        id: appointment.id,
        customerId: appointment.customer_id,
        customerName: appointment.customer_name,
        customerPhone: appointment.customer_phone_e164,
        serviceId: appointment.service_id,
        serviceName: appointment.service_name,
        date,
        startTime: timeFormatter.format(new Date(appointment.starts_at)),
        endTime: timeFormatter.format(new Date(appointment.ends_at)),
        durationMinutes: appointment.duration_minutes,
        channel: appointment.channel as BookingChannel,
        status: appointment.status as AppointmentStatus,
        notes: appointment.notes,
        externalReference: appointment.external_reference ?? undefined,
        createdAt: appointment.created_at
      }));

    return noStore({ appointments });
  } catch (error) {
    if (error instanceof BookingValidationError) {
      return noStore({ error: error.message }, 400);
    }
    if (error instanceof SupabaseConfigurationError) {
      return noStore({ error: error.message }, 503);
    }
    console.error("admin_agenda_failed", error);
    return noStore({ error: "Non è stato possibile caricare l’agenda." }, 500);
  }
}
