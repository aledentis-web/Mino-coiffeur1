"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getAvailableSlots, getEffectiveDuration } from "../lib/booking-engine";
import {
  businessConfig,
  nextOpenDates,
  services
} from "../lib/seed";
import { Brand } from "./brand";
import { useBookingStore } from "./booking-provider";
import { ChannelBadge } from "./channel-badge";
import {
  ArrowUpRight,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  HeadsetIcon,
  MenuIcon,
  PlusIcon,
  ScissorsIcon,
  UsersIcon
} from "./icons";

const longDate = new Intl.DateTimeFormat("it-IT", {
  weekday: "long",
  day: "numeric",
  month: "long"
});

const shortDate = new Intl.DateTimeFormat("it-IT", {
  weekday: "short",
  day: "numeric"
});

function formatDate(dateKey: string, long = false) {
  return (long ? longDate : shortDate).format(
    new Date(`${dateKey}T12:00:00`)
  );
}

export function AdminDashboard() {
  const { appointments, customers, book, cancel, resetDemo } =
    useBookingStore();
  const dates = useMemo(() => nextOpenDates(9), []);
  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(services[0].id);
  const [manualDate, setManualDate] = useState(dates[0]);
  const [manualTime, setManualTime] = useState("");
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState("");

  const dayAppointments = appointments
    .filter(
      (appointment) =>
        appointment.date === selectedDate &&
        appointment.status !== "cancelled"
    )
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const selectedCustomer =
    customers.find((customer) => customer.id === customerId) ?? customers[0];
  const selectedService =
    services.find((service) => service.id === serviceId) ?? services[0];
  const manualSlots = selectedCustomer
    ? getAvailableSlots({
        date: manualDate,
        customer: selectedCustomer,
        service: selectedService,
        appointments,
        config: businessConfig
      })
    : [];
  const bookedMinutes = dayAppointments.reduce(
    (total, appointment) => total + appointment.durationMinutes,
    0
  );
  const utilization = Math.min(100, Math.round((bookedMinutes / 540) * 100));

  function createManualBooking() {
    setFeedback("");
    if (!selectedCustomer || !manualTime) {
      setFeedback("Scegli cliente e orario.");
      return;
    }

    const result = book({
      customerId: selectedCustomer.id,
      serviceId,
      date: manualDate,
      startTime: manualTime,
      channel: "manual",
      notes,
      externalReference: `manual-${Date.now()}`
    });

    if (!result.ok) {
      setFeedback(result.error);
      return;
    }

    setSelectedDate(manualDate);
    setManualOpen(false);
    setManualTime("");
    setNotes("");
  }

  return (
    <main className="admin-shell">
      <aside
        className={`admin-sidebar ${sidebarOpen ? "open" : ""}`}
        aria-label="Navigazione gestionale"
      >
        <Brand />
        <button
          className="admin-sidebar-close"
          onClick={() => setSidebarOpen(false)}
          type="button"
        >
          Chiudi
        </button>
        <nav>
          <Link className="active" href="/admin">
            <CalendarIcon />
            Agenda
          </Link>
          <Link href="/lab">
            <UsersIcon />
            Clienti test
          </Link>
          <a href="#assistente">
            <HeadsetIcon />
            Assistente
            <small>Presto</small>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <span className="system-status"><i /> Sistema operativo</span>
          <Link href="/">
            Sito pubblico
            <ArrowUpRight />
          </Link>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-header">
          <button
            aria-expanded={sidebarOpen}
            aria-label="Apri menu"
            className="mobile-menu"
            onClick={() => setSidebarOpen(true)}
            type="button"
          >
            <MenuIcon />
          </button>
          <div>
            <span>Agenda operativa</span>
            <h1>{formatDate(selectedDate, true)}</h1>
          </div>
          <div className="header-actions">
            <Link className="quiet-button" href="/lab">
              Test lab
            </Link>
            <button
              className="admin-primary"
              onClick={() => setManualOpen(true)}
              type="button"
            >
              <PlusIcon />
              Nuovo appuntamento
            </button>
          </div>
        </header>

        <div className="admin-content">
          <section className="metric-grid">
            <article>
              <span>Appuntamenti</span>
              <strong>{String(dayAppointments.length).padStart(2, "0")}</strong>
              <small><CalendarIcon /> giornata selezionata</small>
            </article>
            <article>
              <span>Tempo prenotato</span>
              <strong>{Math.floor(bookedMinutes / 60)}h {bookedMinutes % 60}m</strong>
              <small><ClockIcon /> su 9 ore disponibili</small>
            </article>
            <article className="utilization-card">
              <span>Occupazione</span>
              <strong>{utilization}%</strong>
              <div><i style={{ width: `${utilization}%` }} /></div>
            </article>
            <article className="assistant-card" id="assistente">
              <span>Segretario digitale</span>
              <strong>In preparazione</strong>
              <small><i /> Booking Engine collegato</small>
            </article>
          </section>

          <section className="agenda-panel">
            <div className="date-rail">
              {dates.map((date) => (
                <button
                  className={selectedDate === date ? "selected" : ""}
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  type="button"
                >
                  <span>{formatDate(date).split(" ")[0]}</span>
                  <strong>{formatDate(date).split(" ")[1]}</strong>
                </button>
              ))}
            </div>

            <div className="agenda-toolbar">
              <div>
                <h2>Programma della giornata</h2>
                <p>
                  Quattro ingressi, un’unica agenda sempre coerente.
                </p>
              </div>
              <div className="channel-legend">
                <span className="dot site" /> Sito
                <span className="dot whatsapp" /> WhatsApp
                <span className="dot voice" /> Chiamata
                <span className="dot manual" /> Manuale
              </div>
            </div>

            <div className="appointment-list">
              {dayAppointments.length > 0 ? (
                dayAppointments.map((appointment) => (
                  <article className="appointment-row" key={appointment.id}>
                    <div className="appointment-time">
                      <strong>{appointment.startTime}</strong>
                      <span>{appointment.endTime}</span>
                    </div>
                    <span className={`timeline-pin ${appointment.channel}`} />
                    <div className="appointment-card">
                      <div className="appointment-customer">
                        <span>{appointment.customerName.slice(0, 1)}</span>
                        <div>
                          <strong>{appointment.customerName}</strong>
                          <small>{appointment.customerPhone}</small>
                        </div>
                      </div>
                      <div className="appointment-service">
                        <strong>{appointment.serviceName}</strong>
                        <small>
                          {appointment.durationMinutes} minuti
                          {customers.find(
                            (customer) => customer.id === appointment.customerId
                          )?.durationOverrides[appointment.serviceId]
                            ? " · durata personale"
                            : ""}
                        </small>
                      </div>
                      <ChannelBadge channel={appointment.channel} />
                      <button
                        className="row-action"
                        onClick={() => cancel(appointment.id)}
                        type="button"
                      >
                        Annulla
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-agenda">
                  <span><ScissorsIcon /></span>
                  <h3>Nessun appuntamento</h3>
                  <p>La giornata è libera. Puoi aggiungere un cliente manualmente.</p>
                  <button
                    className="admin-primary"
                    onClick={() => {
                      setManualDate(selectedDate);
                      setManualOpen(true);
                    }}
                    type="button"
                  >
                    <PlusIcon />
                    Aggiungi appuntamento
                  </button>
                </div>
              )}
            </div>
          </section>

          <div className="demo-note">
            <span><CheckIcon /></span>
            <div>
              <strong>Modalità business test</strong>
              <p>
                I dati sono sintetici e persistono soltanto in questa preview.
                Il Booking Engine è già indipendente dall’archivio demo.
              </p>
            </div>
            <button onClick={resetDemo} type="button">Ripristina dati</button>
          </div>
        </div>
      </section>

      {manualOpen ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setManualOpen(false);
          }}
        >
          <section
            aria-labelledby="manual-modal-title"
            aria-modal="true"
            className="manual-modal"
            role="dialog"
          >
            <div className="modal-heading">
              <div>
                <span>Ingresso 04 · Manuale</span>
                <h2 id="manual-modal-title">Nuovo appuntamento</h2>
                <p>Per telefonate gestite dal barbiere e clienti entrati in negozio.</p>
              </div>
              <button onClick={() => setManualOpen(false)} type="button">Chiudi</button>
            </div>

            <div className="manual-form">
              <label>
                <span>Cliente</span>
                <select
                  value={customerId}
                  onChange={(event) => {
                    setCustomerId(event.target.value);
                    setManualTime("");
                  }}
                >
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name} · {customer.phone}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-pair">
                <label>
                  <span>Servizio</span>
                  <select
                    value={serviceId}
                    onChange={(event) => {
                      setServiceId(event.target.value);
                      setManualTime("");
                    }}
                  >
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Durata calcolata</span>
                  <div className="readonly-field">
                    {selectedCustomer
                      ? getEffectiveDuration(selectedCustomer, selectedService)
                      : selectedService.durationMinutes} minuti
                  </div>
                </label>
              </div>
              <label>
                <span>Giorno</span>
                <select
                  value={manualDate}
                  onChange={(event) => {
                    setManualDate(event.target.value);
                    setManualTime("");
                  }}
                >
                  {dates.map((date) => (
                    <option key={date} value={date}>
                      {formatDate(date, true)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Orario disponibile</span>
                <div className="modal-slots">
                  {manualSlots.map((slot) => (
                    <button
                      className={manualTime === slot ? "selected" : ""}
                      key={slot}
                      onClick={() => setManualTime(slot)}
                      type="button"
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              </label>
              <label>
                <span>Nota</span>
                <textarea
                  placeholder="Informazioni utili per l’appuntamento"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </label>
            </div>

            {feedback ? <p className="form-error">{feedback}</p> : null}
            <button
              className="admin-primary modal-submit"
              disabled={!manualTime}
              onClick={createManualBooking}
              type="button"
            >
              <CheckIcon />
              Conferma e aggiungi all’agenda
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
