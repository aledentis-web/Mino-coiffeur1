import {
  BookingValidationError,
  validateDate
} from "./public-booking.ts";
import type { ServiceOption } from "./whatsapp-assistant-helpers.ts";

export type BookingAgentConfirmation = "none" | "confirm" | "reject";
export type BookingAgentIntent =
  | "booking"
  | "abort_booking"
  | "cancel_existing_booking"
  | "other";
export type BookingAgentFieldStatus = "not_mentioned" | "valid" | "invalid";

export type BookingAgentField<T> = {
  status: BookingAgentFieldStatus;
  value: T | null;
};

export type BookingAgentTurn = {
  intent: BookingAgentIntent;
  service: BookingAgentField<string>;
  date: BookingAgentField<string>;
  time: BookingAgentField<string>;
  name: BookingAgentField<string>;
  confirmation: BookingAgentConfirmation;
};

type BookingAgentTurnCandidate = {
  intent?: unknown;
  service?: unknown;
  date?: unknown;
  time?: unknown;
  name?: unknown;
  confirmation?: unknown;
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

function validateField<T>(
  value: unknown,
  validator: (candidate: unknown) => T | null
): BookingAgentField<T> | null {
  if (!isRecord(value)) return null;
  if (
    value.status !== "not_mentioned" &&
    value.status !== "valid" &&
    value.status !== "invalid"
  ) {
    return null;
  }

  if (value.status === "not_mentioned") {
    return value.value === null ? { status: "not_mentioned", value: null } : null;
  }
  if (value.status === "invalid") {
    return { status: "invalid", value: null };
  }

  const validated = validator(value.value);
  return validated === null
    ? { status: "invalid", value: null }
    : { status: "valid", value: validated };
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
    candidate.intent !== "abort_booking" &&
    candidate.intent !== "cancel_existing_booking" &&
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

  const service = validateField(candidate.service, (serviceSlug) =>
    typeof serviceSlug === "string" &&
    services.some((item) => item.slug === serviceSlug)
      ? serviceSlug
      : null
  );
  const date = validateField(candidate.date, (dateValue) =>
    validateIsoDate(dateValue, now)
  );
  const time = validateField(candidate.time, validateTime);
  const name = validateField(candidate.name, validateCustomerName);
  if (!service || !date || !time || !name) return null;

  return {
    intent: candidate.intent,
    service,
    date,
    time,
    name,
    confirmation: candidate.confirmation
  };
}

export function turnChangesBooking(turn: BookingAgentTurn) {
  return [turn.service, turn.date, turn.time, turn.name].some(
    (field) => field.status === "valid"
  );
}

export function invalidBookingFields(turn: BookingAgentTurn) {
  const fields: Array<"service" | "date" | "time" | "name"> = [];
  if (turn.service.status === "invalid") fields.push("service");
  if (turn.date.status === "invalid") fields.push("date");
  if (turn.time.status === "invalid") fields.push("time");
  if (turn.name.status === "invalid") fields.push("name");
  return fields;
}
