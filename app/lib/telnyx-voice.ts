import "server-only";

import { createPublicKey, verify, type KeyObject } from "node:crypto";

const MAX_WEBHOOK_AGE_SECONDS = 300;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type TelnyxAssistantInitialization = {
  eventId: string;
  occurredAt: Date;
  assistantId: string;
  callControlId: string;
  conversationId: string | null;
  conversationChannel: string | null;
  agentTarget: string | null;
  endUserTarget: string | null;
  verified: boolean;
};

export type TelnyxConversationEnded = {
  eventId: string;
  occurredAt: Date;
  assistantId: string;
  callSessionId: string;
  conversationId: string;
  durationSeconds: number;
  from: string;
  to: string;
  llmModel: string | null;
  sttModel: string | null;
  ttsModel: string | null;
  reason: string | null;
};

export type TelnyxSessionCost = {
  total: number;
  currency: "USD" | "EUR";
  eventCount: number;
  products: string[];
};

function telnyxPublicKey(value: string): KeyObject {
  const trimmed = value.trim();
  if (trimmed.includes("BEGIN PUBLIC KEY")) {
    return createPublicKey(trimmed);
  }

  const decoded = /^[A-Fa-f0-9]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  const der =
    decoded.length === 32
      ? Buffer.concat([ED25519_SPKI_PREFIX, decoded])
      : decoded;
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

export function isValidTelnyxWebhookSignature({
  rawBody,
  signature,
  timestamp,
  publicKey,
  now = new Date()
}: {
  rawBody: string;
  signature: string;
  timestamp: string;
  publicKey: string;
  now?: Date;
}) {
  try {
    const timestampSeconds = Number(timestamp);
    if (!Number.isInteger(timestampSeconds) || timestampSeconds <= 0) {
      return false;
    }
    const ageSeconds = Math.abs(now.getTime() / 1000 - timestampSeconds);
    if (ageSeconds > MAX_WEBHOOK_AGE_SECONDS) return false;

    const normalizedSignature = signature.includes(",")
      ? signature.slice(signature.lastIndexOf(",") + 1)
      : signature;
    const signatureBytes = Buffer.from(normalizedSignature.trim(), "base64");
    if (signatureBytes.length !== 64) return false;

    return verify(
      null,
      Buffer.from(`${timestamp}|${rawBody}`, "utf8"),
      telnyxPublicKey(publicKey),
      signatureBytes
    );
  } catch {
    return false;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function eventEnvelope(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = (value as Record<string, unknown>).data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const event = data as Record<string, unknown>;
  const payload = event.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return { event, details: payload as Record<string, unknown> };
}

export function parseTelnyxAssistantInitialization(
  value: unknown
): TelnyxAssistantInitialization | null {
  const envelope = eventEnvelope(value);
  if (!envelope || envelope.event.event_type !== "assistant.initialization") {
    return null;
  }

  const { event, details } = envelope;
  const eventId = stringValue(event.id);
  const occurredAtRaw = stringValue(event.occurred_at);
  const assistantId = stringValue(details.assistant_id);
  const callControlId = stringValue(details.call_control_id);
  const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : null;

  if (
    !eventId ||
    !occurredAt ||
    Number.isNaN(occurredAt.getTime()) ||
    !assistantId ||
    !callControlId
  ) {
    return null;
  }

  return {
    eventId,
    occurredAt,
    assistantId,
    callControlId,
    conversationId: stringValue(details.conversation_id),
    conversationChannel: stringValue(details.telnyx_conversation_channel),
    agentTarget: stringValue(details.telnyx_agent_target),
    endUserTarget: stringValue(details.telnyx_end_user_target),
    verified: details.verified === true
  };
}

export function parseTelnyxConversationEnded(
  value: unknown
): TelnyxConversationEnded | null {
  const envelope = eventEnvelope(value);
  if (!envelope || envelope.event.event_type !== "call.conversation.ended") {
    return null;
  }

  const { event, details } = envelope;
  const eventId = stringValue(event.id);
  const occurredAtRaw = stringValue(event.occurred_at);
  const assistantId = stringValue(details.assistant_id);
  const callSessionId = stringValue(details.call_session_id);
  const conversationId = stringValue(details.conversation_id);
  const from = stringValue(details.from);
  const to = stringValue(details.to);
  const durationSeconds = Number(details.duration_sec);
  const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : null;

  if (
    !eventId ||
    !occurredAt ||
    Number.isNaN(occurredAt.getTime()) ||
    !assistantId ||
    !callSessionId ||
    !conversationId ||
    !from ||
    !to ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0
  ) {
    return null;
  }

  return {
    eventId,
    occurredAt,
    assistantId,
    callSessionId,
    conversationId,
    durationSeconds: Math.round(durationSeconds),
    from,
    to,
    llmModel: stringValue(details.llm_model),
    sttModel: stringValue(details.stt_model),
    ttsModel:
      stringValue(details.tts_model_id) ?? stringValue(details.tts_provider),
    reason: stringValue(details.reason)
  };
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchTelnyxSessionCost({
  apiKey,
  callSessionId,
  occurredAt
}: {
  apiKey: string;
  callSessionId: string;
  occurredAt: Date;
}): Promise<TelnyxSessionCost | null> {
  const delays = [0, 2_000, 5_000, 10_000];
  const dateTime = occurredAt.toISOString();
  const url = new URL(
    `https://api.telnyx.com/v2/session_analysis/call-session/${encodeURIComponent(
      callSessionId
    )}`
  );
  url.searchParams.set("include_children", "true");
  url.searchParams.set("max_depth", "5");
  url.searchParams.set("expand", "none");
  url.searchParams.set("date_time", dateTime);

  for (const delay of delays) {
    if (delay) await wait(delay);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store"
    });
    if (response.status === 404 || response.status === 409) continue;
    if (!response.ok) {
      console.warn("telnyx_session_analysis_rejected", {
        status: response.status
      });
      return null;
    }

    const payload = (await response.json()) as {
      cost?: { total?: unknown; currency?: unknown };
      meta?: { event_count?: unknown; products?: unknown };
    };
    const total = Number(payload.cost?.total);
    const currency = payload.cost?.currency;
    if (
      !Number.isFinite(total) ||
      total < 0 ||
      (currency !== "USD" && currency !== "EUR")
    ) {
      return null;
    }

    return {
      total,
      currency,
      eventCount: Number.isFinite(Number(payload.meta?.event_count))
        ? Math.max(0, Math.round(Number(payload.meta?.event_count)))
        : 0,
      products: Array.isArray(payload.meta?.products)
        ? payload.meta.products.filter(
            (item): item is string => typeof item === "string"
          )
        : []
    };
  }

  return null;
}
