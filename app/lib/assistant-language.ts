import "server-only";

import {
  validateAssistantLanguageIntent,
  type AssistantConversationState,
  type AssistantLanguageIntent
} from "./assistant-language-helpers";
import type { ServiceOption } from "./whatsapp-assistant-helpers";

const DEFAULT_MODEL = "gpt-5-mini";
const REQUEST_TIMEOUT_MS = 8_000;

type ResponsesPayload = {
  output_text?: unknown;
  output?: Array<{
    content?: Array<{
      type?: unknown;
      text?: unknown;
    }>;
  }>;
};

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: {
      type: "string",
      enum: [
        "none",
        "start",
        "cancel",
        "service",
        "date",
        "slot",
        "affirmative",
        "negative"
      ]
    },
    service_slug: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
    slot: { type: ["string", "null"] }
  },
  required: ["action", "service_slug", "date", "slot"]
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

export async function interpretBookingLanguage({
  body,
  state,
  services = [],
  slots = [],
  now = new Date()
}: {
  body: string;
  state: AssistantConversationState;
  services?: ServiceOption[];
  slots?: string[];
  now?: Date;
}): Promise<AssistantLanguageIntent | null> {
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
        model:
          process.env.OPENAI_ASSISTANT_MODEL?.trim() || DEFAULT_MODEL,
        store: false,
        input: [
          {
            role: "developer",
            content: [
              {
                type: "input_text",
                text:
                  "Interpreta un singolo turno di prenotazione per un barbiere italiano. " +
                  "Non inventare mai servizi, date o orari. Usa action=none se la frase non è inequivocabile. " +
                  "service_slug deve provenire dall'elenco servizi, date deve essere YYYY-MM-DD, " +
                  "slot deve provenire dall'elenco orari. start significa che il cliente vuole iniziare una prenotazione; " +
                  "cancel significa interrompere l'intero flusso."
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify({
                  state,
                  today_rome: new Intl.DateTimeFormat("sv-SE", {
                    timeZone: "Europe/Rome",
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit"
                  }).format(now),
                  services: services.map(({ name, slug }) => ({ name, slug })),
                  available_slots: slots,
                  customer_message: body
                })
              }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "booking_intent",
            strict: true,
            schema: INTENT_SCHEMA
          }
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      console.warn("openai_language_interpreter_rejected", {
        status: response.status
      });
      return null;
    }

    const text = extractOutputText((await response.json()) as ResponsesPayload);
    if (!text) return null;

    return validateAssistantLanguageIntent({
      value: JSON.parse(text) as unknown,
      state,
      services,
      slots,
      now
    });
  } catch (error) {
    console.warn("openai_language_interpreter_unavailable", {
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
