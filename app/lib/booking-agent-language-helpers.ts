import {
  BookingValidationError,
  validateDate
} from "./public-booking.ts";
import type { ServiceOption } from "./whatsapp-assistant-helpers.ts";

export type BookingAgentConfirmation = "none" | "confirm" | "reject";

export type BookingAgentTurn = {
  intent: "booking" | "cancel" | "other";
  serviceSlug: string | null;
  date: string | null;
  requestedTime: string | null;
  customerName: string | null;
  confirmation: BookingAgentConfirmation;
  mentioned: {
    service: boolean;
    date: boolean;
    time: boolean;
    name: boolean;
  };
};

type BookingAgentTurnCandidate = {
  intent?: unknown;
  service_slug?: unknown;
  date?: unknown;
  time?: unknown;
  customer_name?: unknown;
  confirmation?: unknown;
  mentioned?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateIsoDate(value: unknown, now: Date) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  try {
    return validateDate(value, { now });
  } catch (error) {
    if (error instanceof BookingValidationError) return null;
    throw error;
  }
}

function validateTime(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? value : null;
}

function validateCustomerName(value: unknown) {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 2 && name.length <= 160 ? name : null;
}

export function validateBookingAgentTurn({
  value,
  services,
  now
}: {
  value: unknown;
  services: ServiceOption[];
  now: Date;
}): BookingAgentTurn | null {
  if (!isRecord(value)) return null;
  const candidate = value as BookingAgentTurnCandidate;
  if (
    candidate.intent !== "booking" &&
    candidate.intent !== "cancel" &&
    candidate.intent !== "other"
  ) {
    return null;
  }
  if (
    candidate.confirmation !== "none" &&
    candidate.confirmation !== "confirm" &&
    candidate.confirmation !== "reject"
  ) {
    return null;
  }
  if (!isRecord(candidate.mentioned)) return null;

  const mentioned = {
    service: candidate.mentioned.service === true,
    date: candidate.mentioned.date === true,
    time: candidate.mentioned.time === true,
    name: candidate.mentioned.name === true
  };

  const service =
    typeof candidate.service_slug === "string"
      ? services.find((item) => item.slug === candidate.service_slug) ?? null
      : null;

  return {
    intent: candidate.intent,
    serviceSlug: service?.slug ?? null,
    date: validateIsoDate(candidate.date, now),
    requestedTime: validateTime(candidate.time),
    customerName: validateCustomerName(candidate.customer_name),
    confirmation: candidate.confirmation,
    mentioned
  };
}

export function turnChangesBooking(turn: BookingAgentTurn) {
  return (
    turn.mentioned.service ||
    turn.mentioned.date ||
    turn.mentioned.time ||
    turn.mentioned.name
  );
}
