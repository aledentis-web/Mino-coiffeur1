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

const ITALIAN_MONTHS = new Map([
  ["gennaio", 1],
  ["febbraio", 2],
  ["marzo", 3],
  ["aprile", 4],
  ["maggio", 5],
  ["giugno", 6],
  ["luglio", 7],
  ["agosto", 8],
  ["settembre", 9],
  ["ottobre", 10],
  ["novembre", 11],
  ["dicembre", 12]
]);

const ITALIAN_WEEKDAYS = new Map([
  ["domenica", 0],
  ["lunedi", 1],
  ["martedi", 2],
  ["mercoledi", 3],
  ["giovedi", 4],
  ["venerdi", 5],
  ["sabato", 6]
]);

const ITALIAN_HOURS = new Map([
  ["una", 1],
  ["uno", 1],
  ["due", 2],
  ["tre", 3],
  ["quattro", 4],
  ["cinque", 5],
  ["sei", 6],
  ["sette", 7],
  ["otto", 8],
  ["nove", 9],
  ["dieci", 10],
  ["undici", 11],
  ["dodici", 12],
  ["tredici", 13],
  ["quattordici", 14],
  ["quindici", 15],
  ["sedici", 16],
  ["diciassette", 17],
  ["diciotto", 18],
  ["diciannove", 19],
  ["venti", 20],
  ["ventuno", 21],
  ["ventidue", 22],
  ["ventitre", 23]
]);

export function parseItalianBookingDate(value: string, now = new Date()) {
  const clean = normalizeWhatsAppText(value);
  const today = dateInRome(now);

  if (clean === "oggi") return validateDate(today, { now });
  if (clean === "domani") {
    return validateDate(addUtcDays(today, 1), { now });
  }

  const weekday = ITALIAN_WEEKDAYS.get(
    clean.replace(/^(?:questo|questa|prossimo|prossima)\s+/, "")
  );
  if (weekday !== undefined) {
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const currentWeekday = todayDate.getUTCDay();
    let daysAhead = (weekday - currentWeekday + 7) % 7;
    if (daysAhead === 0) daysAhead = 7;
    return validateDate(addUtcDays(today, daysAhead), { now });
  }

  const isoMatch = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return validateDate(
      isoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])),
      { now }
    );
  }

  const spokenItalianMatch = clean.match(
    /^(?:il\s+)?(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(?:del\s+)?(\d{4}))?$/
  );
  if (spokenItalianMatch) {
    const day = Number(spokenItalianMatch[1]);
    const month = ITALIAN_MONTHS.get(spokenItalianMatch[2])!;
    const todayYear = Number(today.slice(0, 4));
    let year = spokenItalianMatch[3]
      ? Number(spokenItalianMatch[3])
      : todayYear;
    let candidate = isoDate(year, month, day);
    if (!spokenItalianMatch[3] && candidate < today) {
      year += 1;
      candidate = isoDate(year, month, day);
    }
    return validateDate(candidate, { now });
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
  const clean = normalizeWhatsAppText(value)
    .replace(/^alle\s+/, "")
    .replace(/^ore\s+/, "");
  const numericChoice = Number(clean);
  if (
    Number.isInteger(numericChoice) &&
    numericChoice >= 1 &&
    numericChoice <= slots.length
  ) {
    return slots[numericChoice - 1];
  }

  const timeMatch = clean.match(/^(\d{1,2})(?:[:.](\d{2}))?$/);
  let hour: number;
  let minutes: number;

  if (timeMatch) {
    hour = Number(timeMatch[1]);
    minutes = Number(timeMatch[2] ?? "00");
  } else {
    const spokenTime = clean.match(
      /^(una|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti|ventuno|ventidue|ventitre)(?:\s+e\s+(un quarto|quindici|mezza|trenta|tre quarti|quarantacinque))?$/
    );
    if (!spokenTime) return null;
    hour = ITALIAN_HOURS.get(spokenTime[1])!;
    minutes =
      spokenTime[2] === "un quarto" || spokenTime[2] === "quindici"
        ? 15
        : spokenTime[2] === "mezza" || spokenTime[2] === "trenta"
          ? 30
          : spokenTime[2] === "tre quarti" ||
              spokenTime[2] === "quarantacinque"
            ? 45
            : 0;
  }

  const normalizedTime = `${hour.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}`;
  return slots.includes(normalizedTime) ? normalizedTime : null;
}
