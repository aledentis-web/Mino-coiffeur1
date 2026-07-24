import twilio from "twilio";

const WHATSAPP_PREFIX = "whatsapp:";

export class TwilioWebhookConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwilioWebhookConfigurationError";
  }
}

export function formParamsToRecord(params: URLSearchParams) {
  const record: Record<string, string | string[]> = {};

  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    record[key] = values.length === 1 ? values[0] : values;
  }

  return record;
}

function appendIncomingSearch(
  configuredUrl: string | undefined,
  requestUrl: string
) {
  if (!configuredUrl) return undefined;

  try {
    const stableUrl = new URL(configuredUrl);
    stableUrl.search = new URL(requestUrl).search;
    return stableUrl.toString();
  } catch {
    return configuredUrl;
  }
}

export function getTwilioWebhookUrls(
  request: Request,
  configuredUrl = process.env.TWILIO_WHATSAPP_WEBHOOK_URL?.trim()
) {
  const stableUrl = appendIncomingSearch(configuredUrl, request.url);
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const incomingUrl = new URL(request.url);

  if (forwardedHost) {
    incomingUrl.host = forwardedHost.split(",")[0]?.trim() || incomingUrl.host;
    incomingUrl.protocol = `${forwardedProto?.split(",")[0]?.trim() || "https"}:`;
  }

  return Array.from(
    new Set([stableUrl, incomingUrl.toString(), request.url].filter(Boolean))
  ) as string[];
}

export function getTwilioWebhookUrl(request: Request) {
  return getTwilioWebhookUrls(request)[0] ?? request.url;
}

export function isValidTwilioFormRequest({
  authToken,
  signature,
  url,
  params
}: {
  authToken: string;
  signature: string;
  url: string;
  params: URLSearchParams;
}) {
  return twilio.validateRequest(
    authToken,
    signature,
    url,
    formParamsToRecord(params)
  );
}

export function parseIncomingWhatsAppMessage(params: URLSearchParams) {
  const from = params.get("From")?.trim() ?? "";
  const to = params.get("To")?.trim() ?? "";
  const messageSid = params.get("MessageSid")?.trim() ?? "";
  const body = params.get("Body")?.trim() ?? "";

  if (
    !from.startsWith(WHATSAPP_PREFIX) ||
    !to.startsWith(WHATSAPP_PREFIX) ||
    !/^SM[a-zA-Z0-9]{20,40}$/.test(messageSid)
  ) {
    return null;
  }

  return {
    from: from.slice(WHATSAPP_PREFIX.length),
    to: to.slice(WHATSAPP_PREFIX.length),
    messageSid,
    body: body.slice(0, 4096)
  };
}

export function buildWhatsAppWelcomeResponse() {
  return buildWhatsAppResponse(
    "Ciao! Sono il segretario digitale di Studio Barber 8. Il collegamento WhatsApp è attivo. Scrivi PRENOTA per iniziare."
  );
}

export function buildWhatsAppResponse(message: string) {
  const response = new twilio.twiml.MessagingResponse();
  response.message(message.slice(0, 4096));
  return response.toString();
}
