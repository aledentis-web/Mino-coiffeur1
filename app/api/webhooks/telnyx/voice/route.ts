import { after, NextResponse } from "next/server";
import { recordAssistantUsage } from "../../../../lib/assistant-control";
import {
  fetchTelnyxSessionCost,
  isValidTelnyxWebhookSignature,
  parseTelnyxConversationEnded
} from "../../../../lib/telnyx-voice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function lastFour(value: string) {
  return value.replace(/\D/g, "").slice(-4) || "unknown";
}

export async function POST(request: Request) {
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim() ?? "";
  const apiKey = process.env.TELNYX_API_KEY?.trim() ?? "";
  const assistantId = process.env.VOICE_PROVIDER_ASSISTANT_ID?.trim() ?? "";
  if (!publicKey || !apiKey || !assistantId) {
    return noStore({ error: "Webhook telefonico non configurato." }, 503);
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

  const conversation = parseTelnyxConversationEnded(payload);
  if (!conversation) {
    return noStore({ received: true, ignored: true });
  }
  if (conversation.assistantId !== assistantId) {
    console.warn("telnyx_voice_assistant_rejected", {
      eventId: conversation.eventId
    });
    return noStore({ received: true, ignored: true });
  }

  after(async () => {
    await recordAssistantUsage({
      channel: "voice",
      provider: "sip",
      eventType: "call_ended",
      model: conversation.llmModel ?? undefined,
      inputUnits: conversation.durationSeconds,
      durationMs: conversation.durationSeconds * 1_000,
      currency: "USD",
      providerEventId: `telnyx-event:${conversation.eventId}`,
      metadata: {
        unit: "seconds",
        callSessionId: conversation.callSessionId,
        conversationId: conversation.conversationId,
        callerLast4: lastFour(conversation.from),
        sttModel: conversation.sttModel,
        ttsModel: conversation.ttsModel,
        reason: conversation.reason
      },
      occurredAt: conversation.occurredAt
    });

    const cost = await fetchTelnyxSessionCost({
      apiKey,
      callSessionId: conversation.callSessionId,
      occurredAt: conversation.occurredAt
    });
    if (!cost) {
      console.warn("telnyx_voice_cost_not_available", {
        callSessionId: conversation.callSessionId
      });
      return;
    }

    await recordAssistantUsage({
      channel: "voice",
      provider: "sip",
      eventType: "call_cost",
      model: conversation.llmModel ?? undefined,
      costMicrounits: Math.round(cost.total * 1_000_000),
      currency: cost.currency,
      providerEventId: `telnyx-cost:${conversation.callSessionId}`,
      metadata: {
        unit: "calls",
        callSessionId: conversation.callSessionId,
        eventCount: cost.eventCount,
        products: cost.products.join(",")
      },
      occurredAt: conversation.occurredAt
    });
  });

  return noStore({ received: true });
}
