import assert from "node:assert/strict";
import test from "node:test";
import { validateAssistantLanguageIntent } from "./assistant-language-helpers.ts";

const NOW = new Date("2026-07-29T10:00:00.000Z");
const SERVICES = [
  {
    name: "Taglio",
    slug: "haircut",
    duration_minutes: 30,
    price_cents: 2500
  }
];

test("accetta solo servizi, date e slot appartenenti al contesto reale", () => {
  assert.deepEqual(
    validateAssistantLanguageIntent({
      value: { action: "service", service_slug: "haircut" },
      state: "awaiting_service",
      services: SERVICES,
      slots: [],
      now: NOW
    }),
    { action: "service", value: "haircut" }
  );
  assert.equal(
    validateAssistantLanguageIntent({
      value: { action: "service", service_slug: "inventato" },
      state: "awaiting_service",
      services: SERVICES,
      slots: [],
      now: NOW
    }),
    null
  );
  assert.deepEqual(
    validateAssistantLanguageIntent({
      value: { action: "date", date: "2026-07-30" },
      state: "awaiting_date",
      services: [],
      slots: [],
      now: NOW
    }),
    { action: "date", value: "2026-07-30" }
  );
  assert.deepEqual(
    validateAssistantLanguageIntent({
      value: { action: "slot", slot: "10:30" },
      state: "awaiting_slot",
      services: [],
      slots: ["10:30"],
      now: NOW
    }),
    { action: "slot", value: "10:30" }
  );
  assert.equal(
    validateAssistantLanguageIntent({
      value: { action: "slot", slot: "11:00" },
      state: "awaiting_slot",
      services: [],
      slots: ["10:30"],
      now: NOW
    }),
    null
  );
});

test("limita conferme e negazioni alla fase di conferma", () => {
  assert.deepEqual(
    validateAssistantLanguageIntent({
      value: { action: "affirmative" },
      state: "awaiting_confirmation",
      services: [],
      slots: [],
      now: NOW
    }),
    { action: "affirmative" }
  );
  assert.equal(
    validateAssistantLanguageIntent({
      value: { action: "affirmative" },
      state: "awaiting_date",
      services: [],
      slots: [],
      now: NOW
    }),
    null
  );
});

test("consente start e cancel senza dati inventati", () => {
  assert.deepEqual(
    validateAssistantLanguageIntent({
      value: { action: "start" },
      state: "idle",
      services: [],
      slots: [],
      now: NOW
    }),
    { action: "start" }
  );
  assert.deepEqual(
    validateAssistantLanguageIntent({
      value: { action: "cancel" },
      state: "awaiting_slot",
      services: [],
      slots: [],
      now: NOW
    }),
    { action: "cancel" }
  );
});
