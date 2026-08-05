import "server-only";

import {
  estimateOpenAiTextCostMicrousd,
  recordAssistantUsage
} from "./assistant-control.ts";
import {
  validateBookingAgentTurn,
  type BookingAgentTurn
} from "./booking-agent-language-helpers.ts";
import type { BookingAgentContext } from "./booking-agent.ts";
import type { ServiceOption } from "./whatsapp-assistant-helpers.ts";

const DEFAULT_MODEL = "gpt-5-mini";
const REQUEST_TIMEOUT_MS = 10_000;

type ResponsesPayload = {
  id?: unknown;
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      type?: unknown;
      text?: unknown;
    }>;
  }>;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
  };
};

const FIELD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["not_mentioned", "valid", "invalid"]
    },
    value: { type: ["string", "null"] }
  },
  required: ["status", "value"]
} as const;

const TURN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: ["booking", "abort_booking", "cancel_existing_booking", "other"]
    },
    service: FIELD_SCHEMA,
    date: FIELD_SCHEMA,
    time: FIELD_SCHEMA,
    name: FIELD_SCHEMA,
    confirmation: {
      type: "string",
      enum: ["none", "confirm", "reject"]
    }
  },
  required: ["intent", "service", "date", "time", "name", "confirmation"]
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

function usageTokens(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
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

  const model = process.env.OPENAI_ASSISTANT_MODEL?.trim() || DEFAULT_MODEL;
  const startedAt = Date.now();
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
        model,
        store: false,
        input: [
          {
            role: "developer",
            content: [
              {
                type: "input_text",
                text:
                  "Estrai i dati da un singolo messaggio rivolto al segretario di un barbiere italiano. " +
                  "Per ciascun campo usa status=not_mentioned se non compare, valid se è compreso e valido, invalid se il cliente prova a indicarlo o correggerlo ma non è comprensibile o valido. " +
                  "Con status not_mentioned o invalid usa value=null. Con valid usa soltanto gli slug dell'elenco servizi, date YYYY-MM-DD basate su today_rome e orari HH:MM. " +
                  "Non copiare il contesto precedente nei campi non ripetuti. confirmation=confirm richiede un sì esplicito; reject indica rifiuto del riepilogo. " +
                  "intent=abort_booking solo per abbandonare la richiesta in corso. intent=cancel_existing_booking quando chiede di cancellare un appuntamento già fissato. Non inventare dati."
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
      console.warn("openai_booking_agent_rejected", { status: response.status });
      return null;
    }

    const payload = (await response.json()) as ResponsesPayload;
    const inputTokens = usageTokens(payload.usage?.input_tokens);
    const outputTokens = usageTokens(payload.usage?.output_tokens);
    const estimatedCost = estimateOpenAiTextCostMicrousd({
      model,
      inputTokens,
      outputTokens
    });

    await recordAssistantUsage({
      channel: "shared",
      provider: "openai",
      eventType: "language_turn",
      model,
      inputUnits: inputTokens,
      outputUnits: outputTokens,
      durationMs: Date.now() - startedAt,
      costMicrounits: estimatedCost ?? 0,
      currency: "USD",
      providerEventId:
        typeof payload.id === "string" ? payload.id : undefined,
      metadata: {
        unit: "tokens",
        priced: estimatedCost !== null,
        pricingSnapshot: "2026-08-05"
      },
      occurredAt: now
    });

    const output = extractOutputText(payload);
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
