import { after, NextRequest, NextResponse } from "next/server";
import {
  getAssistantControl,
  recordAssistantUsage
} from "../../../../lib/assistant-control";
import {
  recordAssistantDelivery,
  sanitizeProviderError
} from "../../../../lib/assistant-delivery";
import {
  getMetaWhatsAppSendConfig,
  isValidMetaWebhookSignature,
  parseMetaWhatsAppMessages,
  sendMetaWhatsAppText,
  verifyMetaWebhookChallenge,
  type MetaWhatsAppMessage
} from "../../../../lib/meta-whatsapp";
import {
  getServerSupabase,
  SupabaseConfigurationError
} from "../../../../lib/supabase/server";
import { handleBookingAgentMessage } from "../../../../lib/booking-agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const FALLBACK_MESSAGE =
  "In questo momento non riesco a consultare l’agenda. Riprova tra poco.";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function configuredBusinessSlug() {
  return process.env.STUDIO_BARBER_BUSINESS_SLUG?.trim() || "studio-barber-8";
}

export async function GET(request: NextRequest) {
  const verifyToken = process.env.META_WHATSAPP_VERIFY_TOKEN?.trim() ?? "";
  if (!verifyToken) {
    return new NextResponse("Webhook Meta non configurato.", { status: 503 });
  }

  const challenge = verifyMetaWebhookChallenge({
    mode: request.nextUrl.searchParams.get("hub.mode"),
    token: request.nextUrl.searchParams.get("hub.verify_token"),
    challenge: request.nextUrl.searchParams.get("hub.challenge"),
    expectedToken: verifyToken
  });

  if (challenge === null) {
    return new NextResponse("Verifica non autorizzata.", { status: 403 });
  }

  return new NextResponse(challenge, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8"
    }
  });
}

async function processMetaMessage(message: MetaWhatsAppMessage) {
  const startedAt = Date.now();
  const businessSlug = configuredBusinessSlug();
  let responseMessage = FALLBACK_MESSAGE;
  let duplicate = false;
  let config: ReturnType<typeof getMetaWhatsAppSendConfig>;

  try {
    config = getMetaWhatsAppSendConfig();
    if (config.phoneNumberId !== message.phoneNumberId) {
      console.warn("meta_whatsapp_phone_number_rejected", {
        inboundMessageId: message.messageId
      });
      return;
    }
  } catch (error) {
    const providerError = sanitizeProviderError(error);
    console.error("meta_whatsapp_not_configured", {
      code: providerError.code,
      message: providerError.message
    });
    return;
  }

  let supabase: ReturnType<typeof getServerSupabase>;
  try {
    supabase = getServerSupabase();
    const control = await getAssistantControl({ supabase, businessSlug });

    await recordAssistantUsage({
      supabase,
      businessId: control.businessId,
      channel: "whatsapp",
      provider: "meta",
      eventType: "inbound_message",
      inputUnits: 1,
      currency: "EUR",
      costMicrounits: 0,
      providerEventId: `inbound:${message.messageId}`,
      metadata: {
        unit: "messages",
        agentEnabled: control.agentEnabled,
        channelEnabled: control.whatsappEnabled
      },
      occurredAt: message.occurredAt
    });

    if (!control.agentEnabled || !control.whatsappEnabled) {
      console.info("meta_whatsapp_ignored_while_paused", {
        inboundMessageId: message.messageId,
        agentEnabled: control.agentEnabled,
        channelEnabled: control.whatsappEnabled,
        durationMs: Date.now() - startedAt
      });
      return;
    }

    const result = await handleBookingAgentMessage({
      supabase,
      businessSlug,
      resourceSlug:
        process.env.STUDIO_BARBER_RESOURCE_SLUG?.trim() || "main",
      phoneE164: message.from,
      body: message.body,
      messageSid: message.messageId,
      bookingChannel: "whatsapp",
      externalReferencePrefix: "meta",
      occurredAt: message.occurredAt
    });
    responseMessage = result.response;
    duplicate = result.duplicate;
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      console.error("meta_whatsapp_supabase_not_configured");
    } else {
      console.error("meta_whatsapp_assistant_failed", error);
    }
    return;
  }

  if (duplicate) {
    console.info("meta_whatsapp_duplicate_ignored", {
      messageId: message.messageId,
      durationMs: Date.now() - startedAt
    });
    return;
  }

  try {
    await recordAssistantDelivery({
      messageId: message.messageId,
      status: "pending"
    });
    const outboundId = await sendMetaWhatsAppText({
      to: message.from,
      body: responseMessage,
      config
    });
    await recordAssistantDelivery({
      messageId: message.messageId,
      status: "sent",
      outboundId
    });
    await recordAssistantUsage({
      supabase,
      businessSlug,
      channel: "whatsapp",
      provider: "meta",
      eventType: "service_reply",
      outputUnits: 1,
      currency: "EUR",
      costMicrounits: 0,
      providerEventId: `outbound:${outboundId}`,
      metadata: {
        unit: "messages",
        category: "service",
        directReplyToInbound: true
      }
    });
    console.info("meta_whatsapp_reply_sent", {
      inboundMessageId: message.messageId,
      outboundMessageId: outboundId,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    const providerError = sanitizeProviderError(error);
    await recordAssistantDelivery({
      messageId: message.messageId,
      status: "failed",
      errorCode: providerError.code,
      errorMessage: providerError.message
    });
    console.error("meta_whatsapp_reply_failed", {
      inboundMessageId: message.messageId,
      durationMs: Date.now() - startedAt,
      code: providerError.code,
      message: providerError.message
    });
  }
}

export async function POST(request: NextRequest) {
  const appSecret = process.env.META_WHATSAPP_APP_SECRET?.trim() ?? "";
  if (!appSecret) {
    return noStore({ error: "Webhook Meta non configurato." }, 503);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  if (
    !isValidMetaWebhookSignature({
      rawBody,
      signature,
      appSecret
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

  const messages = parseMetaWhatsAppMessages(payload);
  if (messages.length > 0) {
    after(async () => {
      for (const message of messages) {
        await processMetaMessage(message);
      }
    });
  }

  return noStore({ received: true });
}
