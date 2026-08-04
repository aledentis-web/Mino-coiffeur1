import {
  BookingValidationError
} from "./public-booking.ts";
import type { BookingAgentContext } from "./booking-agent.ts";
import type { BookingAgentTurn } from "./booking-agent-language-helpers.ts";
import {
  normalizeWhatsAppText,
  parseItalianBookingDate,
  resolveServiceChoice,
  type ServiceOption
} from "./whatsapp-assistant-helpers.ts";

const emptyField = () => ({ status: "not_mentioned", value: null }) as const;

function valid(value: string) {
  return { status: "valid", value } as const;
}

function invalid() {
  return { status: "invalid", value: null } as const;
}

function extractDate(body: string, now: Date) {
  const normalized = normalizeWhatsAppText(body);
  const candidates = [
    normalized.match(/\b(oggi|domani)\b/)?.[1],
    normalized.match(
      /\b(?:quest[oa]\s+|prossim[oa]\s+)?(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b/
    )?.[0],
    normalized.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/)?.[0],
    normalized.match(/\b\d{1,2}[/.\-]\d{1,2}(?:[/.\-](?:\d{2}|\d{4}))?\b/)?.[0],
    normalized.match(
      /\b(?:il\s+)?\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(?:del\s+)?\d{4})?\b/
    )?.[0]
  ].filter((value): value is string => Boolean(value));

  if (candidates.length === 0) {
    return /\b(?:giorno|data|domani|oggi|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b/.test(
      normalized
    )
      ? invalid()
      : emptyField();
  }

  try {
    return valid(parseItalianBookingDate(candidates[0], now));
  } catch (error) {
    if (error instanceof BookingValidationError) return invalid();
    throw error;
  }
}

function extractTime(body: string) {
  const normalized = normalizeWhatsAppText(body);
  const match = normalized.match(/\b(?:alle|ore)\s+(\d{1,2})(?:[:.](\d{2}))?\b/);
  if (!match) {
    return /\b(?:alle|ore|orario)\b/.test(normalized) ? invalid() : emptyField();
  }
  const hour = Number(match[1]);
  const minutes = Number(match[2] ?? "00");
  if (hour > 23 || minutes > 59) return invalid();
  return valid(
    `${hour.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}`
  );
}

function extractName(body: string) {
  const match = body.match(
    /(?:mi chiamo|sono|a nome di|nome[:\s]+)\s*([\p{L}' -]{1,160})/iu
  );
  if (!match) return emptyField();
  const name = match[1].trim().replace(/\s+/g, " ");
  return name.length >= 2 ? valid(name) : invalid();
}

export async function interpretDeterministicBookingTurn({
  body,
  context,
  services,
  now = new Date()
}: {
  body: string;
  context: BookingAgentContext;
  services: ServiceOption[];
  now?: Date;
}): Promise<BookingAgentTurn> {
  const normalized = normalizeWhatsAppText(body);
  const cancelExisting =
    /\b(?:cancell|annull|disdic)/.test(normalized) &&
    /\b(?:appuntamento|prenotazione)\b/.test(normalized);
  const abort =
    /^(?:annulla|lascia perdere|interrompi|basta|stop)(?:\s+(?:tutto|la richiesta))?$/.test(
      normalized
    );
  const confirm = /^(?:si|confermo|ok|va bene)(?:[!. ]*)$/.test(normalized);
  const reject =
    /^(?:no|non confermo)(?:[!. ]*)$/.test(normalized) ||
    /\b(?:voglio|vorrei)\s+cambiare\b/.test(normalized);

  const serviceChoice = resolveServiceChoice(body, services);
  const mentionsService = services.some((service) =>
    normalized.includes(normalizeWhatsAppText(service.name))
  );
  const service = serviceChoice
    ? valid(serviceChoice.slug)
    : mentionsService || /\bservizio\b/.test(normalized)
      ? invalid()
      : emptyField();

  return {
    intent: cancelExisting
      ? "cancel_existing_booking"
      : abort
        ? "abort_booking"
        : "booking",
    service,
    date: extractDate(body, now),
    time: extractTime(body),
    name: extractName(body),
    confirmation: confirm ? "confirm" : reject ? "reject" : "none"
  };
}
