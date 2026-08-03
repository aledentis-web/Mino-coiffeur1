import "server-only";

import {
  validateBookingAgentTurn,
  type BookingAgentTurn
} from "./booking-agent-language-helpers.ts";
import type { BookingAgentContext } from "./booking-agent.ts";
import type { ServiceOption } from "./whatsapp-assistant-helpers.ts";

const DEFAULT_MODEL = "gpt-5-mini";
const REQUEST_TIMEOUT_MS = 10_000;

type ResponsesPayload = {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      type?: unknown;
      text?: unknown;
    }>;
  }>;
};

const TURN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: ["booking", "cancel", "other"]
    },
    service_slug: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
    time: { type: ["string", "null"] },
    customer_name: { type: ["string", "null"] },
    confirmation: {
      type: "string",
      enum: ["none", "confirm", "reject"]
    },
    mentioned: {
      type: "object",
      additionalProperties: false,
      properties: {
        service: { type: "boolean" },
        date: { type: "boolean" },
        time: { type: "boolean" },
        name: { type: "boolean" }
      },
      required: ["service", "date", "time", "name"]
    }
  },
  required: [
    "intent",
    "service_slug",
    "date",
    "time",
    "customer_name",
    "confirmation",
    "mentioned"
  ]
} as const;

function extractOutputText(payload: ResponsesPayload) {
  if (typeof payload.output_text === "string") return payload.output_text;

  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return null;
}

export async function interpretBookingAgentTurn({
  body,
  context,
  services,
  now = new Date()
}: {
  body: string;
  context: BookingAgentContext;
  services: ServiceOption[];
  now?: Date;
}): Promise<BookingAgentTurn | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(process.env.OPENAI_PROJECT_ID?.trim()
          ? { "OpenAI-Project": process.env.OPENAI_PROJECT_ID.trim() }
          : {})
      },
      body: JSON.stringify({
        model: process.env.OPENAI_ASSISTANT_MODEL?.trim() || DEFAULT_MODEL,
        store: false,
        input: [
          {
            role: "developer",
            content: [
              {
                type: "input_text",
                text:
                  "Estrai i dati da un singolo messaggio rivolto al segretario di un barbiere italiano. " +
                  "Il cliente può fornire servizio, data, ora e nome insieme, oppure correggere dati già presenti. " +
                  "Usa soltanto gli slug dell'elenco servizi. Converti le date in YYYY-MM-DD usando today_rome e gli orari in HH:MM. " +
                  "Imposta mentioned.* a true soltanto quando quel dato è espresso o corretto nel nuovo messaggio. " +
                  "Non copiare il contesto precedente nei campi estratti se il cliente non lo ha ripetuto. " +
                  "confirmation=confirm richiede un sì esplicito; reject indica che il cliente non conferma ma non annulla necessariamente. " +
                  "intent=cancel soltanto quando chiede esplicitamente di annullare o interrompere tutto. Non inventare mai dati."
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  today_rome: new Intl.DateTimeFormat("sv-SE", {
                    timeZone: "Europe/Rome",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit"
                  }).format(now),
                  services: services.map(({ name, slug }) => ({ name, slug })),
                  current_booking: {
                    service_slug: context.serviceSlug ?? null,
                    service_name: context.serviceName ?? null,
                    date: context.date ?? null,
                    time: context.startTime ?? context.requestedTime ?? null,
                    customer_name: context.customerName ?? null,
                    awaiting_explicit_confirmation:
                      context.confirmationPending === true
                  },
                  customer_message: body
                })
              }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "booking_agent_turn",
            strict: true,
            schema: TURN_SCHEMA
          }
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      console.warn("openai_booking_agent_rejected", {
        status: response.status
      });
      return null;
    }

    const output = extractOutputText((await response.json()) as ResponsesPayload);
    if (!output) return null;
    return validateBookingAgentTurn({
      value: JSON.parse(output) as unknown,
      services,
      now
    });
  } catch (error) {
    console.warn("openai_booking_agent_unavailable", {
      reason:
        error instanceof DOMException && error.name === "AbortError"
          ? "timeout"
          : "request_failed"
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
