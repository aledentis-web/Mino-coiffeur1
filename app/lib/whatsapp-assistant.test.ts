import assert from "node:assert/strict";
import test from "node:test";
import {
  parseItalianBookingDate,
  resolveServiceChoice,
  resolveSlotChoice
} from "./whatsapp-assistant-helpers.ts";

const NOW = new Date("2026-07-24T10:00:00.000Z");
const SERVICES = [
  {
    name: "Taglio",
    slug: "haircut",
    duration_minutes: 30,
    price_cents: 2500
  },
  {
    name: "Barba",
    slug: "beard",
    duration_minutes: 20,
    price_cents: 1500
  },
  {
    name: "Taglio + barba",
    slug: "haircut-beard",
    duration_minutes: 45,
    price_cents: 3700
  }
];

test("interpreta date italiane, oggi e domani", () => {
  assert.equal(parseItalianBookingDate("oggi", NOW), "2026-07-24");
  assert.equal(parseItalianBookingDate("DOMANI", NOW), "2026-07-25");
  assert.equal(parseItalianBookingDate("28/07", NOW), "2026-07-28");
  assert.equal(parseItalianBookingDate("28-07-2026", NOW), "2026-07-28");
});

test("rifiuta date impossibili o fuori dalla finestra", () => {
  assert.throws(() => parseItalianBookingDate("31/02/2026", NOW));
  assert.throws(() => parseItalianBookingDate("ieri", NOW));
});

test("riconosce servizi per numero, nome e slug", () => {
  assert.equal(resolveServiceChoice("1", SERVICES)?.slug, "haircut");
  assert.equal(resolveServiceChoice("barba", SERVICES)?.slug, "beard");
  assert.equal(
    resolveServiceChoice("haircut-beard", SERVICES)?.name,
    "Taglio + barba"
  );
  assert.equal(resolveServiceChoice("servizio casuale", SERVICES), null);
});

test("riconosce slot per numero e orario", () => {
  const slots = ["09:00", "09:30", "10:00"];
  assert.equal(resolveSlotChoice("2", slots), "09:30");
  assert.equal(resolveSlotChoice("9.00", slots), "09:00");
  assert.equal(resolveSlotChoice("11:00", slots), null);
});
