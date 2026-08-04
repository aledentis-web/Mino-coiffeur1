import assert from "node:assert/strict";
import test from "node:test";
import {
  invalidBookingFields,
  turnChangesBooking,
  validateBookingAgentTurn
} from "./booking-agent-language-helpers.ts";

const NOW = new Date("2026-08-03T10:00:00.000Z");
const SERVICES = [
  { name: "Taglio", slug: "haircut", duration_minutes: 30, price_cents: 2500 }
];

test("convalida tutti i dati estratti da una sola frase", () => {
  const turn = validateBookingAgentTurn({
    value: {
      intent: "booking",
      service: { status: "valid", value: "haircut" },
      date: { status: "valid", value: "2026-08-04" },
      time: { status: "valid", value: "10:30" },
      name: { status: "valid", value: "Mario Rossi" },
      confirmation: "none"
    },
    services: SERVICES,
    now: NOW
  });
  assert.deepEqual(turn, {
    intent: "booking",
    service: { status: "valid", value: "haircut" },
    date: { status: "valid", value: "2026-08-04" },
    time: { status: "valid", value: "10:30" },
    name: { status: "valid", value: "Mario Rossi" },
    confirmation: "none"
  });
  assert.equal(turnChangesBooking(turn!), true);
});

test("distingue campi non menzionati, validi e menzionati ma non validi", () => {
  const turn = validateBookingAgentTurn({
    value: {
      intent: "booking",
      service: { status: "valid", value: "inventato" },
      date: { status: "invalid", value: "qualunque" },
      time: { status: "not_mentioned", value: null },
      name: { status: "valid", value: "A" },
      confirmation: "none"
    },
    services: SERVICES,
    now: NOW
  });
  assert.deepEqual(turn?.service, { status: "invalid", value: null });
  assert.deepEqual(turn?.date, { status: "invalid", value: null });
  assert.deepEqual(turn?.time, { status: "not_mentioned", value: null });
  assert.deepEqual(turn?.name, { status: "invalid", value: null });
  assert.deepEqual(invalidBookingFields(turn!), ["service", "date", "name"]);
  assert.equal(turnChangesBooking(turn!), false);
});

test("convalida la distinzione abort flow / cancel existing booking", () => {
  for (const intent of ["abort_booking", "cancel_existing_booking"] as const) {
    const turn = validateBookingAgentTurn({
      value: {
        intent,
        service: { status: "not_mentioned", value: null },
        date: { status: "not_mentioned", value: null },
        time: { status: "not_mentioned", value: null },
        name: { status: "not_mentioned", value: null },
        confirmation: "none"
      },
      services: SERVICES,
      now: NOW
    });
    assert.equal(turn?.intent, intent);
  }
});

test("rifiuta payload strutturalmente incompleti", () => {
  assert.equal(
    validateBookingAgentTurn({
      value: {
        intent: "booking",
        service: { status: "not_mentioned", value: null },
        date: { status: "not_mentioned", value: null },
        time: { status: "not_mentioned", value: null },
        confirmation: "none"
      },
      services: SERVICES,
      now: NOW
    }),
    null
  );
});
