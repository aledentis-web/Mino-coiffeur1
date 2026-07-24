import { NextResponse } from "next/server";
import {
  buildWhatsAppWelcomeResponse,
  getTwilioWebhookUrl,
  isValidTwilioFormRequest,
  parseIncomingWhatsAppMessage
} from "../../../../lib/twilio-webhook";

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
  return xmlResponse(buildWhatsAppWelcomeResponse());
}
