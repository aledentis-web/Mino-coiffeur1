import { NextResponse } from "next/server";
import {
  BookingValidationError,
  parseAvailabilityInput
} from "../../../lib/public-booking";
import {
  getServerSupabase,
  SupabaseConfigurationError
} from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = parseAvailabilityInput(url.searchParams);
    const businessSlug =
      process.env.STUDIO_BARBER_BUSINESS_SLUG ?? "studio-barber-8";
    const resourceSlug =
      process.env.STUDIO_BARBER_RESOURCE_SLUG ?? "main";
    const supabase = getServerSupabase();

    const { data, error } = await supabase.rpc("get_public_availability", {
      p_business_slug: businessSlug,
      p_service_slug: input.serviceSlug,
      p_date: input.date,
      p_phone_e164: input.phoneE164,
      p_resource_slug: resourceSlug
    });

    if (error) {
      if (error.message.includes("_NOT_FOUND")) {
        return noStoreJson({ error: "Attività o servizio non trovato." }, 404);
      }
      console.error("availability_rpc_failed", {
        code: error.code,
        message: error.message
      });
      return noStoreJson(
        { error: "Non è stato possibile calcolare gli orari." },
        500
      );
    }

    return noStoreJson({ slots: data ?? [] });
  } catch (error) {
    if (error instanceof BookingValidationError) {
      return noStoreJson({ error: error.message }, 400);
    }
    if (error instanceof SupabaseConfigurationError) {
      return noStoreJson({ error: error.message }, 503);
    }
    console.error("availability_request_failed", error);
    return noStoreJson(
      { error: "Non è stato possibile calcolare gli orari." },
      500
    );
  }
}
