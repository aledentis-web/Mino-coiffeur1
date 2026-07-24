import {
  BookingValidationError,
  validateDate
} from "./public-booking.ts";

export type ServiceOption = {
  name: string;
  slug: string;
  duration_minutes: number;
  price_cents: number;
};

export function normalizeWhatsAppText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function dateInRome(now: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function addUtcDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function isoDate(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

export function parseItalianBookingDate(value: string, now = new Date()) {
  const clean = normalizeWhatsAppText(value);
  const today = dateInRome(now);

  if (clean === "oggi") return validateDate(today, { now });
  if (clean === "domani") {
    return validateDate(addUtcDays(today, 1), { now });
  }

  const isoMatch = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return validateDate(
      isoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])),
      { now }
    );
  }

  const italianMatch = clean.match(
    /^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2}|\d{4}))?$/
  );
  if (!italianMatch) {
    throw new BookingValidationError("Data non valida.");
  }

  const day = Number(italianMatch[1]);
  const month = Number(italianMatch[2]);
  const todayYear = Number(today.slice(0, 4));
  let year = italianMatch[3]
    ? Number(
        italianMatch[3].length === 2
          ? `20${italianMatch[3]}`
          : italianMatch[3]
      )
    : todayYear;
  let candidate = isoDate(year, month, day);

  if (!italianMatch[3] && candidate < today) {
    year += 1;
    candidate = isoDate(year, month, day);
  }

  return validateDate(candidate, { now });
}

export function resolveServiceChoice(
  value: string,
  services: ServiceOption[]
) {
  const clean = normalizeWhatsAppText(value);
  const numericChoice = Number(clean);
  if (
    Number.isInteger(numericChoice) &&
    numericChoice >= 1 &&
    numericChoice <= services.length
  ) {
    return services[numericChoice - 1];
  }

  const exact = services.find(
    (service) =>
      normalizeWhatsAppText(service.name) === clean ||
      normalizeWhatsAppText(service.slug) === clean
  );
  if (exact) return exact;

  const partial = services.filter((service) => {
    const name = normalizeWhatsAppText(service.name);
    return name.includes(clean) || clean.includes(name);
  });
  return partial.length === 1 ? partial[0] : null;
}

export function resolveSlotChoice(value: string, slots: string[]) {
  const clean = value.trim();
  const numericChoice = Number(clean);
  if (
    Number.isInteger(numericChoice) &&
    numericChoice >= 1 &&
    numericChoice <= slots.length
  ) {
    return slots[numericChoice - 1];
  }

  const timeMatch = clean.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!timeMatch) return null;
  const normalizedTime = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
  return slots.includes(normalizedTime) ? normalizedTime : null;
}
