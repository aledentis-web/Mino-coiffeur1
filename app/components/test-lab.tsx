"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  assertNoOverlaps,
  createBooking,
  getAvailableSlots
} from "../lib/booking-engine";
import type { Appointment, BookingChannel } from "../lib/domain";
import {
  businessConfig,
  nextOpenDates,
  services,
  syntheticCustomers
} from "../lib/seed";
import { Brand } from "./brand";
import {
  ArrowUpRight,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  HeadsetIcon,
  PhoneIcon,
  UsersIcon,
  WhatsAppIcon
} from "./icons";

type SimulationResult = {
  total: number;
  booked: number;
  conflictsBlocked: number;
  overlaps: number;
  personalizedDurations: number;
  elapsedMs: number;
};

function runSimulation(): SimulationResult {
  const startedAt = performance.now();
  const dates = nextOpenDates(20, new Date("2026-07-28T12:00:00"));
  let appointments: Appointment[] = [];
  let conflictsBlocked = 0;

  syntheticCustomers.forEach((customer, index) => {
    const service = services.find(
      (item) => item.id === customer.preferredServiceId
    )!;
    let created = false;

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
          channel: (["site", "whatsapp", "voice", "manual"] as BookingChannel[])[
            index % 4
          ],
          externalReference: `lab-${index + 1}`
        },
        customers: syntheticCustomers,
        services,
        appointments,
        config: businessConfig
      });

      if (result.ok) {
        appointments = [...appointments, result.appointment];
        created = true;

        const conflict = createBooking({
          input: {
            customerId:
              syntheticCustomers[(index + 1) % syntheticCustomers.length].id,
            serviceId: services[0].id,
            date,
            startTime: result.appointment.startTime,
            channel: "whatsapp",
            externalReference: `conflict-${index + 1}`
          },
          customers: syntheticCustomers,
          services,
          appointments,
          config: businessConfig
        });
        if (!conflict.ok) conflictsBlocked += 1;
        break;
      }
    }

    if (!created) return;
  });

  return {
    total: syntheticCustomers.length,
    booked: appointments.length,
    conflictsBlocked,
    overlaps: assertNoOverlaps(appointments) ? 0 : 1,
    personalizedDurations: syntheticCustomers.filter(
      (customer) => Object.keys(customer.durationOverrides).length > 0
    ).length,
    elapsedMs: Math.round(performance.now() - startedAt)
  };
}

export function TestLab() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SimulationResult | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return syntheticCustomers;
    return syntheticCustomers.filter(
      (customer) =>
        customer.name.toLowerCase().includes(normalized) ||
        customer.phone.includes(normalized)
    );
  }, [query]);

  return (
    <main className="lab-shell">
      <header className="lab-header">
        <Brand />
        <div>
          <Link href="/admin">
            Torna all’agenda
          </Link>
          <Link className="nav-pill" href="/">
            Sito pubblico
            <ArrowUpRight />
          </Link>
        </div>
      </header>

      <section className="lab-hero">
        <div>
          <span className="lab-kicker">Studio Barber 8 · Test lab</span>
          <h1>La certezza prima del cliente reale.</h1>
          <p>
            Cento clienti sintetici attraversano lo stesso motore usato da
            sito, WhatsApp, chiamate e inserimento manuale.
          </p>
        </div>
        <button
          className="run-test"
          onClick={() => setResult(runSimulation())}
          type="button"
        >
          <span><CheckIcon /></span>
          <div>
            <strong>Simula 100 clienti</strong>
            <small>Nessun messaggio o chiamata reale</small>
          </div>
          <ArrowUpRight />
        </button>
      </section>

      <section className="channel-test-grid">
        <article>
          <span className="channel-icon site"><CalendarIcon /></span>
          <div><small>Ingresso 01</small><strong>Sito</strong></div>
          <em>Operativo</em>
        </article>
        <article>
          <span className="channel-icon whatsapp"><WhatsAppIcon /></span>
          <div><small>Ingresso 02</small><strong>WhatsApp</strong></div>
          <em className="planned">Meta Cloud API</em>
        </article>
        <article>
          <span className="channel-icon voice"><PhoneIcon /></span>
          <div><small>Ingresso 03</small><strong>Chiamata</strong></div>
          <Link className="planned" href="/admin/voice">Apri test voce</Link>
        </article>
        <article>
          <span className="channel-icon manual"><HeadsetIcon /></span>
          <div><small>Ingresso 04</small><strong>Manuale</strong></div>
          <em>Operativo</em>
        </article>
      </section>

      {result ? (
        <section className="simulation-result">
          <div className="result-heading">
            <span><CheckIcon /></span>
            <div>
              <small>Ultima esecuzione · {result.elapsedMs} ms</small>
              <h2>Simulazione completata</h2>
            </div>
          </div>
          <div className="result-metrics">
            <article><span>Clienti prenotati</span><strong>{result.booked}/{result.total}</strong></article>
            <article><span>Conflitti bloccati</span><strong>{result.conflictsBlocked}</strong></article>
            <article><span>Sovrapposizioni</span><strong>{result.overlaps}</strong></article>
            <article><span>Durate personali</span><strong>{result.personalizedDurations}</strong></article>
          </div>
          <p>
            {result.booked === 100 &&
            result.overlaps === 0 &&
            result.conflictsBlocked === 100
              ? "Gate superato: il motore ha prenotato tutti i clienti e ha respinto ogni tentativo di doppia prenotazione."
              : "Gate non superato: controllare i risultati prima di procedere."}
          </p>
        </section>
      ) : null}

      <section className="customer-dataset">
        <div className="dataset-heading">
          <div>
            <span><UsersIcon /> Dataset sintetico</span>
            <h2>100 clienti conosciuti</h2>
            <p>
              Nome, telefono, servizio abituale e durata personale disponibili
              per il riconoscimento multicanale.
            </p>
          </div>
          <label>
            <span>Cerca cliente</span>
            <input
              placeholder="Nome o telefono"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="customer-table">
          <div className="table-row table-head">
            <span>Cliente</span>
            <span>Contatto test</span>
            <span>Servizio abituale</span>
            <span>Durata</span>
          </div>
          {filtered.slice(0, 20).map((customer) => {
            const service = services.find(
              (item) => item.id === customer.preferredServiceId
            )!;
            const duration =
              customer.durationOverrides[service.id] ?? service.durationMinutes;
            return (
              <div className="table-row" key={customer.id}>
                <span>
                  <i>{customer.name.slice(0, 1)}</i>
                  <strong>{customer.name}</strong>
                </span>
                <span>{customer.phone}</span>
                <span>{service.name}</span>
                <span>
                  <strong>{duration} min</strong>
                  {customer.durationOverrides[service.id] ? (
                    <small>Personalizzata</small>
                  ) : (
                    <small>Standard</small>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <footer>
          <span><ClockIcon /> Mostrati {Math.min(filtered.length, 20)} di {filtered.length}</span>
          <small>I numeri 000 sono sintetici e non vengono contattati.</small>
        </footer>
      </section>
    </main>
  );
}
