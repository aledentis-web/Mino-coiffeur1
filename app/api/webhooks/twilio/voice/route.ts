import { NextResponse } from "next/server";
import {
  getTwilioWebhookUrls,
  isValidTwilioFormRequest
} from "../../../../lib/twilio-webhook";
import {
  buildVoiceGatherResponse,
  buildVoiceHangupResponse,
  buildVoiceMessageId,
  getVoiceTurnText,
  isVoiceConversationComplete,
  parseIncomingVoiceTurn
} from "../../../../lib/twilio-voice";
import {
  getServerSupabase,
  SupabaseConfigurationError
} from "../../../../lib/supabase/server";
import { handleBookingAssistantMessage } from "../../../../lib/whatsapp-assistant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const VOICE_PATH = "/api/webhooks/twilio/voice";
const FALLBACK_MESSAGE =
  "In questo momento non riesco a consultare l’agenda. Riprova tra poco.";

function xmlResponse(xml: string, status = 200) {
  return new NextResponse(xml, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/xml; charset=utf-8"
    }
  });
}

function getAttempt(request: Request) {
  const value = Number.parseInt(new URL(request.url).searchParams.get("attempt") ?? "0", 10);
  return Number.isFinite(value) && value >= 0 && value <= 3 ? value : 0;
}

function actionForAttempt(attempt: number) {
  return `${VOICE_PATH}?attempt=${attempt}`;
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  if (!authToken) {
    return xmlResponse(
      buildVoiceHangupResponse("Il servizio telefonico non è configurato."),
      503
    );
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return xmlResponse(buildVoiceHangupResponse("Richiesta non valida."), 415);
  }

  const signature = request.headers.get("x-twilio-signature") ?? "";
  const params = new URLSearchParams(await request.text());
  const stableVoiceUrl = process.env.TWILIO_VOICE_WEBHOOK_URL?.trim();
  const validSignature =
    Boolean(signature) &&
    getTwilioWebhookUrls(request, stableVoiceUrl).some((url) =>
      isValidTwilioFormRequest({
        authToken,
        signature,
        url,
        params
      })
    );

  if (!validSignature) {
    console.warn("twilio_voice_signature_rejected");
    return xmlResponse(buildVoiceHangupResponse("Richiesta non autorizzata."), 403);
  }

  const turn = parseIncomingVoiceTurn(params);
  if (!turn) {
    return xmlResponse(
      buildVoiceHangupResponse(
        "Non riesco a identificare il numero chiamante. Contatta direttamente il negozio."
      )
    );
  }

  const attempt = getAttempt(request);
  const userText = getVoiceTurnText(turn);
  if (!userText && attempt >= 2) {
    return xmlResponse(
      buildVoiceHangupResponse(
        "Non ho ricevuto una risposta. Puoi richiamare quando vuoi. A presto."
      )
    );
  }

  const assistantInput = userText || "prenota";
  try {
    const result = await handleBookingAssistantMessage({
      supabase: getServerSupabase(),
      businessSlug:
        process.env.STUDIO_BARBER_BUSINESS_SLUG?.trim() || "studio-barber-8",
      resourceSlug:
        process.env.STUDIO_BARBER_RESOURCE_SLUG?.trim() || "main",
      phoneE164: turn.from,
      body: assistantInput,
      messageSid: buildVoiceMessageId(turn),
      bookingChannel: "voice",
      externalReferencePrefix: "voice"
    });
    const complete = isVoiceConversationComplete(result.response);

    console.info("twilio_voice_turn_completed", {
      callSid: turn.callSid,
      complete,
      duplicate: result.duplicate
    });

    return xmlResponse(
      buildVoiceGatherResponse({
        message: result.response,
        action: actionForAttempt(userText ? 1 : attempt + 1),
        complete
      })
    );
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      console.error("twilio_voice_supabase_not_configured");
    } else {
      console.error("twilio_voice_assistant_failed", error);
    }
    return xmlResponse(buildVoiceHangupResponse(FALLBACK_MESSAGE), 500);
  }
}
