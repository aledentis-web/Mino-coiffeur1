import { NextRequest, NextResponse } from "next/server";
import { parseVoiceLabInput } from "../../../lib/assistant-lab";
import { isAuthorizedAdminRequest } from "../../../lib/admin-request";
import { BookingValidationError } from "../../../lib/public-booking";
import {
  getServerSupabase,
  SupabaseConfigurationError
} from "../../../lib/supabase/server";
import { handleBookingAssistantMessage } from "../../../lib/whatsapp-assistant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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
    const input = parseVoiceLabInput(await request.json());
    const result = await handleBookingAssistantMessage({
      supabase: getServerSupabase(),
      businessSlug:
        process.env.STUDIO_BARBER_BUSINESS_SLUG?.trim() || "studio-barber-8",
      resourceSlug:
        process.env.STUDIO_BARBER_RESOURCE_SLUG?.trim() || "main",
      phoneE164: input.phoneE164,
      body: input.body,
      messageSid: input.messageId,
      bookingChannel: "voice",
      externalReferencePrefix: "voice"
    });

    return noStore({
      response: result.response,
      duplicate: result.duplicate
    });
  } catch (error) {
    if (error instanceof BookingValidationError) {
      return noStore({ error: error.message }, 400);
    }
    if (error instanceof SupabaseConfigurationError) {
      return noStore({ error: error.message }, 503);
    }
    console.error("voice_lab_assistant_failed", error);
    return noStore(
      { error: "L’assistente vocale non è momentaneamente disponibile." },
      500
    );
  }
}
