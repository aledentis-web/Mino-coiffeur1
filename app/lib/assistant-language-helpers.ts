import {
  BookingValidationError,
  validateDate
} from "./public-booking.ts";
import type { ServiceOption } from "./whatsapp-assistant-helpers.ts";

export type AssistantConversationState =
  | "idle"
  | "awaiting_service"
  | "awaiting_date"
  | "awaiting_slot"
  | "awaiting_name"
  | "awaiting_confirmation";

export type AssistantLanguageIntent =
  | { action: "start" }
  | { action: "cancel" }
  | { action: "service"; value: string }
  | { action: "date"; value: string }
  | { action: "slot"; value: string }
  | { action: "affirmative" }
  | { action: "negative" };

type IntentCandidate = {
  action?: unknown;
  service_slug?: unknown;
  date?: unknown;
  slot?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateIsoDate(value: string, now: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try {
    return validateDate(value, { now });
  } catch (error) {
    if (error instanceof BookingValidationError) return null;
    throw error;
  }
}

export function validateAssistantLanguageIntent({
  value,
  state,
  services,
  slots,
  now
}: {
  value: unknown;
  state: AssistantConversationState;
  services: ServiceOption[];
  slots: string[];
  now: Date;
}): AssistantLanguageIntent | null {
  if (!isRecord(value)) return null;
  const candidate = value as IntentCandidate;

  if (candidate.action === "start") return { action: "start" };
  if (candidate.action === "cancel") return { action: "cancel" };

  if (
    candidate.action === "service" &&
    state === "awaiting_service" &&
    typeof candidate.service_slug === "string"
  ) {
    const matched = services.find(
      (service) => service.slug === candidate.service_slug
    );
    return matched
      ? { action: "service", value: matched.slug }
      : null;
  }

  if (
    candidate.action === "date" &&
    state === "awaiting_date" &&
    typeof candidate.date === "string"
  ) {
    const date = validateIsoDate(candidate.date, now);
    return date ? { action: "date", value: date } : null;
  }

  if (
    candidate.action === "slot" &&
    state === "awaiting_slot" &&
    typeof candidate.slot === "string" &&
    slots.includes(candidate.slot)
  ) {
    return { action: "slot", value: candidate.slot };
  }

  if (
    candidate.action === "affirmative" &&
    state === "awaiting_confirmation"
  ) {
    return { action: "affirmative" };
  }

  if (
    candidate.action === "negative" &&
    state === "awaiting_confirmation"
  ) {
    return { action: "negative" };
  }

  return null;
}
