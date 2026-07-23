import assert from "node:assert/strict";
import test from "node:test";
import {
  BookingValidationError,
  normalizeItalianPhone,
  parseAvailabilityInput,
  parsePublicBookingInput,
  validateDate,
  validateIdempotencyKey
} from "./public-booking.ts";

const NOW = new Date("2026-07-24T10:00:00.000Z");

test("normalizza numeri italiani e internazionali in E.164", () => {
  assert.equal(normalizeItalianPhone("333 123 4567"), "+393331234567");
  assert.equal(normalizeItalianPhone("0039 333 123 4567"), "+393331234567");
  assert.equal(normalizeItalianPhone("+41 79 123 45 67"), "+41791234567");
});

test("rifiuta telefoni incompleti", () => {
  assert.throws(
    () => normalizeItalianPhone("123"),
    BookingValidationError
  );
});

test("accetta solo date reali nella finestra di prenotazione", () => {
  assert.equal(validateDate("2026-07-24", { now: NOW }), "2026-07-24");
  assert.throws(
    () => validateDate("2026-02-30", { now: NOW }),
    BookingValidationError
  );
  assert.throws(
    () => validateDate("2026-07-23", { now: NOW }),
    BookingValidationError
  );
});

test("valida una richiesta completa senza fidarsi dei dati grezzi", () => {
  assert.deepEqual(
    parsePublicBookingInput(
      {
        serviceSlug: "haircut-beard",
        date: "2026-07-25",
        startTime: "09:15",
        customerName: "  Mario Rossi ",
        phone: "333 123 4567",
        notes: "  Sfumatura bassa "
      },
      { now: NOW }
    ),
    {
      serviceSlug: "haircut-beard",
      date: "2026-07-25",
      startTime: "09:15",
      customerName: "Mario Rossi",
      phoneE164: "+393331234567",
      notes: "Sfumatura bassa"
    }
  );
});

test("valida disponibilità e chiavi idempotenti", () => {
  const query = new URLSearchParams({
    service: "haircut",
    date: "2026-07-25",
    phone: "+39 333 123 4567"
  });

  assert.deepEqual(parseAvailabilityInput(query, { now: NOW }), {
    serviceSlug: "haircut",
    date: "2026-07-25",
    phoneE164: "+393331234567"
  });
  assert.equal(
    validateIdempotencyKey("site:550e8400-e29b-41d4-a716-446655440000"),
    "site:550e8400-e29b-41d4-a716-446655440000"
  );
  assert.throws(
    () => validateIdempotencyKey("short"),
    BookingValidationError
  );
});
