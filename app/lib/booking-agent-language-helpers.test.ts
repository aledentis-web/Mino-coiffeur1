import assert from "node:assert/strict";
import test from "node:test";
import {
  turnChangesBooking,
  validateBookingAgentTurn
} from "./booking-agent-language-helpers.ts";

const NOW = new Date("2026-08-03T10:00:00.000Z");
const SERVICES = [
  {
    name: "Taglio",
    slug: "haircut",
    duration_minutes: 30,
    price_cents: 2500
  }
];

test("convalida tutti i dati estratti da una sola frase", () => {
  const turn = validateBookingAgentTurn({
    value: {
      intent: "booking",
      service_slug: "haircut",
      date: "2026-08-04",
      time: "10:30",
      customer_name: "Mario Rossi",
      confirmation: "none",
      mentioned: { service: true, date: true, time: true, name: true }
    },
    services: SERVICES,
    now: NOW
  });

  assert.deepEqual(turn, {
    intent: "booking",
    serviceSlug: "haircut",
    date: "2026-08-04",
    requestedTime: "10:30",
    customerName: "Mario Rossi",
    confirmation: "none",
    mentioned: { service: true, date: true, time: true, name: true }
  });
  assert.equal(turnChangesBooking(turn!), true);
});

test("non accetta servizi inventati, date scadute o orari non validi", () => {
  const turn = validateBookingAgentTurn({
    value: {
      intent: "booking",
      service_slug: "inventato",
      date: "2025-01-01",
      time: "29:99",
      customer_name: "  A  ",
      confirmation: "none",
      mentioned: { service: true, date: true, time: true, name: true }
    },
    services: SERVICES,
    now: NOW
  });

  assert.equal(turn?.serviceSlug, null);
  assert.equal(turn?.date, null);
  assert.equal(turn?.requestedTime, null);
  assert.equal(turn?.customerName, null);
});

test("rifiuta conferme implicite o payload strutturalmente incompleti", () => {
  assert.equal(
    validateBookingAgentTurn({
      value: {
        intent: "booking",
        service_slug: null,
        date: null,
        time: null,
        customer_name: null,
        confirmation: "forse",
        mentioned: { service: false, date: false, time: false, name: false }
      },
      services: SERVICES,
      now: NOW
    }),
    null
  );
});
