import { after, NextResponse } from "next/server";
import twilio from "twilio";
import {
  getTwilioWebhookUrl,
  isValidTwilioFormRequest,
  parseIncomingWhatsAppMessage
} from "../../../../lib/twilio-webhook";
import { handleWhatsAppAssistantMessage } from "../../../../lib/whatsapp-assistant";
import {
  getServerSupabase,
  SupabaseConfigurationError
} from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const FALLBACK_MESSAGE =
  "In questo momento non riesco a consultare l’agenda. Riprova tra poco oppure contatta direttamente Studio Barber 8.";

function xmlResponse(xml: string, status = 200) {
  return new NextResponse(xml, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/xml; charset=utf-8"
    }
  });
}

type DeliveryStatus = "pending" | "sent" | "failed";

function getTwilioRestError(error: unknown) {
  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const rawCode = record.code ?? record.status ?? "UNKNOWN";
  const rawMessage =
    typeof record.message === "string" ? record.message : "Unknown Twilio error";

  return {
    code: String(rawCode).slice(0,80),
    message: rawMessage.replace(/\s+/g, " ").slice(0,500)
  };
}

async function recordDeliveryAttempt({
  messageSid,
  status,
  outboundSid,
  errorCode,
  errorMessage
}: {
  messageSid: string;
  status: DeliveryStatus;
  outboundSid?: string;
  errorCode?: string;
  errorMessage?: string;
}) {
  const { error } = await getServerSupabase()
    .from("whatsapp_conversations")
    .update({
      last_delivery_status: status,
      last_outbound_sid: outboundSid ?? null,
      last_delivery_error_code: errorCode ?? null,
      last_delivery_error_message: errorMessage ?? null,
      last_delivery_attempt_at: new Date().toISOString()
    })
    .eq("last_message_sid", messageSid);

  if (error) {
    console.error("twilio_whatsapp_delivery_diagnostic_failed", {
      messageSid,
      code: error.code
    });
  }
}

async function processAndReply({
  accountSid,
  authToken,
  message
}: {
  accountSid: string;
  authToken: string;
  message: NonNullable<ReturnType<typeof parseIncomingWhatsAppMessage>>;
}) {
  const startedAt = Date.now();
  let responseMessage = FALLBACK_MESSAGE;
  let duplicate = false;

  try {
    const businessSlug =
      process.env.STUDIO_BARBER_BUSINESS_SLUG ?? "studio-barber-8";
    const resourceSlug =
      process.env.STUDIO_BARBER_RESOURCE_SLUG ?? "main";
    const result = await handleWhatsAppAssistantMessage({
      supabase: getServerSupabase(),
      businessSlug,
      resourceSlug,
      phoneE164: message.from,
      body: message.body,
      messageSid: message.messageSid
    });
    responseMessage = result.response;
    duplicate = result.duplicate;
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      console.error("twilio_whatsapp_supabase_not_configured");
    } else {
      console.error("twilio_whatsapp_assistant_failed", error);
    }
  }

  if (duplicate) {
    console.info("twilio_whatsapp_duplicate_ignored", {
      messageSid: message.messageSid,
      durationMs: Date.now() - startedAt
    });
    return;
  }

  try {
    await recordDeliveryAttempt({
      messageSid: message.messageSid,
      status: "pending"
    });

    const client = twilio(accountSid, authToken);
    const outbound = await client.messages.create({
      body: responseMessage,
      from: `whatsapp:${message.to}`,
      to: `whatsapp:${message.from}`
    });
    await recordDeliveryAttempt({
      messageSid: message.messageSid,
      status: "sent",
      outboundSid: outbound.sid
    });
    console.info("twilio_whatsapp_reply_sent", {
      inboundMessageSid: message.messageSid,
      outboundMessageSid: outbound.sid,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    const twilioError = getTwilioRestError(error);
    await recordDeliveryAttempt({
      messageSid: message.messageSid,
      status: "failed",
      errorCode: twilioError.code,
      errorMessage: twilioError.message
    });
    console.error("twilio_whatsapp_reply_failed", {
      inboundMessageSid: message.messageSid,
      durationMs: Date.now() - startedAt,
      code: twilioError.code,
      message: twilioError.message
    });
  }
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken) {
    console.error("twilio_webhook_not_configured");
    return xmlResponse("<Response />", 503);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return xmlResponse("<Response />", 415);
  }

  const signature = request.headers.get("x-twilio-signature") ?? "";
  const params = new URLSearchParams(await request.text());
  const webhookUrl = getTwilioWebhookUrl(request);

  if (
    !signature ||
    !isValidTwilioFormRequest({
      authToken,
      signature,
      url: webhookUrl,
      params
    })
  ) {
    console.warn("twilio_webhook_signature_rejected");
    return xmlResponse("<Response />", 403);
  }

  const message = parseIncomingWhatsAppMessage(params);
  if (!message) {
    return xmlResponse("<Response />", 400);
  }

  const accountSid =
    process.env.TWILIO_ACCOUNT_SID?.trim() ||
    params.get("AccountSid")?.trim() ||
    "";
  if (!/^AC[a-zA-Z0-9]{20,40}$/.test(accountSid)) {
    console.error("twilio_account_sid_not_configured");
    return xmlResponse("<Response />", 503);
  }

  console.info("twilio_whatsapp_message_received", {
    messageSid: message.messageSid
  });

  after(() =>
    processAndReply({
      accountSid,
      authToken,
      message
    })
  );

  return xmlResponse("<Response />");
}
