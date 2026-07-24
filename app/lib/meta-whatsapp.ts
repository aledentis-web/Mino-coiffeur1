import { createHmac, timingSafeEqual } from "node:crypto";

const META_SIGNATURE_PREFIX = "sha256=";
const META_MESSAGE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,300}$/;
const META_PHONE_NUMBER_ID_PATTERN = /^[0-9]{5,30}$/;
const GRAPH_VERSION_PATTERN = /^v[0-9]{1,2}\.[0-9]{1,2}$/;

export type MetaWhatsAppMessage = {
  body: string;
  from: string;
  messageId: string;
  phoneNumberId: string;
};

export class MetaWhatsAppConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MetaWhatsAppConfigurationError";
  }
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function verifyMetaWebhookChallenge({
  mode,
  token,
  challenge,
  expectedToken
}: {
  mode: string | null;
  token: string | null;
  challenge: string | null;
  expectedToken: string;
}) {
  if (
    mode !== "subscribe" ||
    !token ||
    !challenge ||
    !expectedToken ||
    !safeEqual(token, expectedToken)
  ) {
    return null;
  }

  return challenge;
}

export function isValidMetaWebhookSignature({
  rawBody,
  signature,
  appSecret
}: {
  rawBody: string;
  signature: string;
  appSecret: string;
}) {
  if (!signature.startsWith(META_SIGNATURE_PREFIX) || !appSecret) {
    return false;
  }

  const expected = `${META_SIGNATURE_PREFIX}${createHmac(
    "sha256",
    appSecret
  )
    .update(rawBody)
    .digest("hex")}`;

  return safeEqual(signature, expected);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export function parseMetaWhatsAppMessages(payload: unknown) {
  const root = asRecord(payload);
  if (!root || root.object !== "whatsapp_business_account") return [];

  const messages: MetaWhatsAppMessage[] = [];

  for (const entryValue of asArray(root.entry)) {
    const entry = asRecord(entryValue);
    if (!entry) continue;

    for (const changeValue of asArray(entry.changes)) {
      const change = asRecord(changeValue);
      const value = asRecord(change?.value);
      const metadata = asRecord(value?.metadata);
      const phoneNumberId =
        typeof metadata?.phone_number_id === "string"
          ? metadata.phone_number_id.trim()
          : "";

      if (!META_PHONE_NUMBER_ID_PATTERN.test(phoneNumberId)) continue;

      for (const messageValue of asArray(value?.messages)) {
        const message = asRecord(messageValue);
        const text = asRecord(message?.text);
        const from = typeof message?.from === "string" ? message.from : "";
        const messageId =
          typeof message?.id === "string" ? message.id.trim() : "";
        const body = typeof text?.body === "string" ? text.body.trim() : "";

        if (
          message?.type !== "text" ||
          !/^[1-9][0-9]{7,14}$/.test(from) ||
          !META_MESSAGE_ID_PATTERN.test(messageId) ||
          !body
        ) {
          continue;
        }

        messages.push({
          body: body.slice(0, 4096),
          from: `+${from}`,
          messageId,
          phoneNumberId
        });
      }
    }
  }

  return messages;
}

export function getMetaWhatsAppSendConfig() {
  const accessToken = process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() ?? "";
  const graphVersion = process.env.META_GRAPH_API_VERSION?.trim() ?? "";
  const phoneNumberId =
    process.env.META_WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";

  if (!accessToken) {
    throw new MetaWhatsAppConfigurationError(
      "META_WHATSAPP_ACCESS_TOKEN non configurato."
    );
  }
  if (!GRAPH_VERSION_PATTERN.test(graphVersion)) {
    throw new MetaWhatsAppConfigurationError(
      "META_GRAPH_API_VERSION non valida."
    );
  }
  if (!META_PHONE_NUMBER_ID_PATTERN.test(phoneNumberId)) {
    throw new MetaWhatsAppConfigurationError(
      "META_WHATSAPP_PHONE_NUMBER_ID non valido."
    );
  }

  return { accessToken, graphVersion, phoneNumberId };
}

export async function sendMetaWhatsAppText({
  to,
  body,
  config = getMetaWhatsAppSendConfig()
}: {
  to: string;
  body: string;
  config?: ReturnType<typeof getMetaWhatsAppSendConfig>;
}) {
  const recipient = to.replace(/\D/g, "");
  if (!/^[1-9][0-9]{7,14}$/.test(recipient)) {
    throw new Error("META_WHATSAPP_RECIPIENT_INVALID");
  }

  const response = await fetch(
    `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: {
          body: body.slice(0, 4096),
          preview_url: false
        }
      }),
      cache: "no-store"
    }
  );

  const payload = (await response.json().catch(() => null)) as {
    messages?: Array<{ id?: string }>;
    error?: { code?: number; message?: string; type?: string };
  } | null;

  if (!response.ok) {
    const providerError = new Error(
      payload?.error?.message || "Meta WhatsApp ha rifiutato il messaggio."
    ) as Error & { code?: string };
    providerError.code = String(
      payload?.error?.code ?? response.status ?? "META_SEND_FAILED"
    );
    throw providerError;
  }

  const outboundId = payload?.messages?.[0]?.id;
  if (!outboundId) throw new Error("META_WHATSAPP_EMPTY_RESPONSE");
  return outboundId;
}
