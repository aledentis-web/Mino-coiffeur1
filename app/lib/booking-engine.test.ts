import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoOverlaps,
  createBooking,
  getAvailableSlots,
  getEffectiveDuration
} from "./booking-engine.ts";
import {
  businessConfig,
  services,
  syntheticCustomers
} from "./seed.ts";
import type { Appointment, BookingChannel } from "./domain.ts";

const testDate = "2026-07-28";

test("applica la durata personalizzata del cliente", () => {
  const customer = syntheticCustomers[0];
  const service = services.find(
    (item) => item.id === customer.preferredServiceId
  )!;
  assert.equal(
    getEffectiveDuration(customer, service),
    customer.durationOverrides[service.id]
  );
});

test("impedisce una doppia prenotazione", () => {
  const first = createBooking({
    input: {
      customerId: syntheticCustomers[0].id,
      serviceId: services[0].id,
      date: testDate,
      startTime: "09:00",
      channel: "site"
    },
    customers: syntheticCustomers,
    services,
    appointments: [],
    config: businessConfig
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const second = createBooking({
    input: {
      customerId: syntheticCustomers[1].id,
      serviceId: services[0].id,
      date: testDate,
      startTime: "09:15",
      channel: "whatsapp"
    },
    customers: syntheticCustomers,
    services,
    appointments: [first.appointment],
    config: businessConfig
  });

  assert.equal(second.ok, false);
});

test("un webhook duplicato non crea due appuntamenti", () => {
  const input = {
    customerId: syntheticCustomers[2].id,
    serviceId: services[1].id,
    date: testDate,
    startTime: "11:00",
    channel: "whatsapp" as const,
    externalReference: "wa-message-001"
  };
  const first = createBooking({
    input,
    customers: syntheticCustomers,
    services,
    appointments: [],
    config: businessConfig
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const replay = createBooking({
    input,
    customers: syntheticCustomers,
    services,
    appointments: [first.appointment],
    config: businessConfig
  });
  assert.equal(replay.ok, true);
  if (!replay.ok) return;
  assert.equal(replay.idempotent, true);
  assert.equal(replay.appointment.id, first.appointment.id);
});

test("i quattro ingressi usano lo stesso motore", () => {
  const channels: BookingChannel[] = [
    "site",
    "whatsapp",
    "voice",
    "manual"
  ];
  let appointments: Appointment[] = [];

  channels.forEach((channel, index) => {
    const customer = syntheticCustomers[index + 10];
    const service = services[index];
    const slots = getAvailableSlots({
      date: testDate,
      customer,
      service,
      appointments,
      config: businessConfig
    });
    const result = createBooking({
      input: {
        customerId: customer.id,
        serviceId: service.id,
        date: testDate,
        startTime: slots[0],
        channel
      },
      customers: syntheticCustomers,
      services,
      appointments,
      config: businessConfig
    });
    assert.equal(result.ok, true);
    if (result.ok) appointments = [...appointments, result.appointment];
  });

  assert.deepEqual(
    appointments.map((appointment) => appointment.channel),
    channels
  );
  assert.equal(assertNoOverlaps(appointments), true);
});

test("simula 100 clienti senza sovrapposizioni", () => {
  let appointments: Appointment[] = [];
  const dates = [
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-01",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
    "2026-08-08"
  ];

  syntheticCustomers.forEach((customer, index) => {
    const service = services.find(
      (item) => item.id === customer.preferredServiceId
    )!;
    let booked = false;

    for (const date of dates) {
      const slots = getAvailableSlots({
        date,
        customer,
        service,
        appointments,
        config: businessConfig
      });
      if (slots.length === 0) continue;

      const result = createBooking({
        input: {
          customerId: customer.id,
          serviceId: service.id,
          date,
          startTime: slots[index % slots.length],
          channel: (["site", "whatsapp", "voice", "manual"] as const)[
            index % 4
          ],
          externalReference: `simulation-${index + 1}`
        },
        customers: syntheticCustomers,
        services,
        appointments,
        config: businessConfig
      });

      if (result.ok) {
        appointments = [...appointments, result.appointment];
        booked = true;
        break;
      }
    }

    assert.equal(booked, true, `Cliente ${customer.id} non prenotato`);
  });

  assert.equal(appointments.length, 100);
  assert.equal(assertNoOverlaps(appointments), true);
});

