import type { BookingChannel } from "./domain";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

const BOOKING_CHANNELS = new Set<BookingChannel>([
  "site",
  "whatsapp",
  "voice",
  "manual"
]);

export class BookingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingValidationError";
  }
}

function requireText(
  value: unknown,
  label: string,
  maxLength: number
) {
  if (typeof value !== "string") {
    throw new BookingValidationError(`${label} non valido.`);
  }

  const clean = value.trim();
  if (!clean || clean.length > maxLength) {
    throw new BookingValidationError(`${label} non valido.`);
  }

  return clean;
}

export function normalizeItalianPhone(value: unknown) {
  const raw = requireText(value, "Numero di telefono", 40);
  const hasInternationalPrefix = raw.startsWith("+") || raw.startsWith("00");
  const digits = raw.replace(/\D/g, "");

  let normalized: string;
  if (raw.startsWith("+")) {
    normalized = `+${digits}`;
  } else if (raw.startsWith("00")) {
    normalized = `+${digits.slice(2)}`;
  } else if (hasInternationalPrefix || digits.startsWith("39")) {
    normalized = `+${digits}`;
  } else {
    normalized = `+39${digits}`;
  }

  if (!E164_PATTERN.test(normalized)) {
    throw new BookingValidationError("Numero di telefono non valido.");
  }

  return normalized;
}

export function validateDate(
  value: unknown,
  {
    now = new Date(),
    maxDaysAhead = 180
  }: { now?: Date; maxDaysAhead?: number } = {}
) {
  const date = requireText(value, "Data", 10);
  if (!DATE_PATTERN.test(date)) {
    throw new BookingValidationError("Data non valida.");
  }

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new BookingValidationError("Data non valida.");
  }

  const todayInRome = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  const today = new Date(`${todayInRome}T00:00:00.000Z`);
  const limit = new Date(today);
  limit.setUTCDate(limit.getUTCDate() + maxDaysAhead);

  if (parsed < today || parsed > limit) {
    throw new BookingValidationError(
      `La data deve essere compresa nei prossimi ${maxDaysAhead} giorni.`
    );
  }

  return date;
}

export function validateTime(value: unknown) {
  const time = requireText(value, "Orario", 5);
  if (!TIME_PATTERN.test(time)) {
    throw new BookingValidationError("Orario non valido.");
  }
  return time;
}

export function validateSlug(value: unknown, label: string) {
  const slug = requireText(value, label, 80);
  if (!SLUG_PATTERN.test(slug)) {
    throw new BookingValidationError(`${label} non valido.`);
  }
  return slug;
}

export function validateChannel(value: unknown) {
  if (
    typeof value !== "string" ||
    !BOOKING_CHANNELS.has(value as BookingChannel)
  ) {
    throw new BookingValidationError("Canale non valido.");
  }
  return value as BookingChannel;
}

export function validateIdempotencyKey(value: string | null) {
  if (value === null || value === "") return null;
  if (!IDEMPOTENCY_PATTERN.test(value)) {
    throw new BookingValidationError("Chiave di richiesta non valida.");
  }
  return value;
}

export type PublicBookingInput = {
  serviceSlug: string;
  date: string;
  startTime: string;
  customerName: string;
  phoneE164: string;
  notes: string;
};

export function parsePublicBookingInput(
  value: unknown,
  options?: { now?: Date }
): PublicBookingInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BookingValidationError("Richiesta non valida.");
  }

  const body = value as Record<string, unknown>;
  const notes =
    body.notes === undefined || body.notes === null
      ? ""
      : typeof body.notes === "string"
        ? body.notes.trim()
        : "";

  if (notes.length > 1000) {
    throw new BookingValidationError("La nota è troppo lunga.");
  }

  return {
    serviceSlug: validateSlug(body.serviceSlug, "Servizio"),
    date: validateDate(body.date, options),
    startTime: validateTime(body.startTime),
    customerName: requireText(body.customerName, "Nome", 160),
    phoneE164: normalizeItalianPhone(body.phone),
    notes
  };
}

export function parseAvailabilityInput(
  searchParams: URLSearchParams,
  options?: { now?: Date }
) {
  const phone = searchParams.get("phone");

  return {
    serviceSlug: validateSlug(searchParams.get("service"), "Servizio"),
    date: validateDate(searchParams.get("date"), options),
    phoneE164: phone ? normalizeItalianPhone(phone) : null
  };
}
