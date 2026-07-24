import { NextResponse } from "next/server";
import {
  buildWhatsAppResponse,
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

function xmlResponse(xml: string, status = 200) {
  return new NextResponse(xml, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/xml; charset=utf-8"
    }
  });
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

  console.info("twilio_whatsapp_message_received", {
    messageSid: message.messageSid
  });

  try {
    const businessSlug =
      process.env.STUDIO_BARBER_BUSINESS_SLUG ?? "studio-barber-8";
    const resourceSlug =
      process.env.STUDIO_BARBER_RESOURCE_SLUG ?? "main";
    const responseMessage = await handleWhatsAppAssistantMessage({
      supabase: getServerSupabase(),
      businessSlug,
      resourceSlug,
      phoneE164: message.from,
      body: message.body,
      messageSid: message.messageSid
    });
    return xmlResponse(buildWhatsAppResponse(responseMessage));
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      console.error("twilio_whatsapp_supabase_not_configured");
    } else {
      console.error("twilio_whatsapp_assistant_failed", error);
    }
    return xmlResponse(
      buildWhatsAppResponse(
        "In questo momento non riesco a consultare l’agenda. Riprova tra poco oppure contatta direttamente Studio Barber 8."
      )
    );
  }
}
