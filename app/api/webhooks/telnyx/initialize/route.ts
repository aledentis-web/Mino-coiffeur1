import { after, NextResponse } from "next/server";
import {
  getAssistantControl,
  recordAssistantUsage
} from "../../../../lib/assistant-control";
import {
  getServerSupabase,
  SupabaseConfigurationError
} from "../../../../lib/supabase/server";
import {
  isValidTelnyxWebhookSignature,
  parseTelnyxAssistantInitialization
} from "../../../../lib/telnyx-voice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function businessSlug() {
  return process.env.STUDIO_BARBER_BUSINESS_SLUG?.trim() || "studio-barber-8";
}

function lastFour(value: string | null) {
  return value?.replace(/\D/g, "").slice(-4) || "unknown";
}

function normalizedCallerNumber(value: string | null) {
  if (!value) return "";
  const normalized = value.replace(/[\s().-]/g, "").trim();
  return /^\+[1-9][0-9]{7,14}$/.test(normalized) ? normalized : "";
}

function dynamicVariables({
  active,
  fallbackNumber,
  callerNumber
}: {
  active: boolean;
  fallbackNumber: string;
  callerNumber: string;
}) {
  return {
    agent_mode: active ? "active" : "paused",
    agent_enabled: active ? "true" : "false",
    agent_greeting: active
      ? "Ciao, hai chiamato Studio Barber 8. Sono l’assistente digitale: posso aiutarti a prenotare o cancellare un appuntamento."
      : "Ciao, hai chiamato Studio Barber 8. Il servizio automatico è momentaneamente in pausa.",
    caller_number: callerNumber,
    fallback_number: fallbackNumber,
    business_name: "Studio Barber 8",
    business_timezone: "Europe/Rome"
  };
}

export async function POST(request: Request) {
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim() ?? "";
  const assistantId = process.env.VOICE_PROVIDER_ASSISTANT_ID?.trim() ?? "";
  if (!publicKey || !assistantId) {
    return noStore({ error: "Inizializzazione telefonica non configurata." }, 503);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("telnyx-signature-ed25519") ?? "";
  const timestamp = request.headers.get("telnyx-timestamp") ?? "";
  if (
    !isValidTelnyxWebhookSignature({
      rawBody,
      signature,
      timestamp,
      publicKey
    })
  ) {
    return noStore({ error: "Firma webhook non valida." }, 403);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return noStore({ error: "Payload non valido." }, 400);
  }

  const initialization = parseTelnyxAssistantInitialization(payload);
  if (!initialization) {
    return noStore({ error: "Evento di inizializzazione non valido." }, 400);
  }
  if (initialization.assistantId !== assistantId) {
    return noStore({ error: "Assistente non autorizzato." }, 403);
  }

  const fallbackNumber = process.env.VOICE_FALLBACK_NUMBER?.trim() ?? "";
  const callerNumber = normalizedCallerNumber(initialization.endUserTarget);

  try {
    const supabase = getServerSupabase();
    const control = await getAssistantControl({
      supabase,
      businessSlug: businessSlug()
    });
    const active = control.agentEnabled && control.voiceEnabled;

    after(async () => {
      await recordAssistantUsage({
        supabase,
        businessId: control.businessId,
        channel: "voice",
        provider: "sip",
        eventType: "call_initialized",
        inputUnits: 1,
        currency: "USD",
        providerEventId: `telnyx-init:${initialization.eventId}`,
        metadata: {
          unit: "calls",
          mode: active ? "active" : "paused",
          callControlId: initialization.callControlId,
          callerLast4: lastFour(initialization.endUserTarget),
          verified: initialization.verified
        },
        occurredAt: initialization.occurredAt
      });
    });

    return noStore({
      dynamic_variables: dynamicVariables({
        active,
        fallbackNumber,
        callerNumber
      })
    });
  } catch (error) {
    if (!(error instanceof SupabaseConfigurationError)) {
      console.error("telnyx_initialization_control_failed", error);
    }

    return noStore({
      dynamic_variables: dynamicVariables({
        active: false,
        fallbackNumber,
        callerNumber
      })
    });
  }
}
