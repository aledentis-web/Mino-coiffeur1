"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getEffectiveDuration } from "../lib/booking-engine";
import type { Appointment } from "../lib/domain";
import {
  nextOpenDates,
  services,
  syntheticCustomers
} from "../lib/seed";
import { Brand } from "./brand";
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
  const customers = syntheticCustomers;
  const dates = useMemo(() => nextOpenDates(9), []);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [agendaLoading, setAgendaLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(dates[0]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [serviceId, setServiceId] = useState(services[0].id);
  const [manualDate, setManualDate] = useState(dates[0]);
  const [manualTime, setManualTime] = useState("");
  const [notes, setNotes] = useState("");
  const [feedback, setFeedback] = useState("");
  const [manualSlots, setManualSlots] = useState<
    Array<{ slot_time: string; duration_minutes: number }>
  >([]);
  const [manualLoading, setManualLoading] = useState(false);

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
  const bookedMinutes = dayAppointments.reduce(
    (total, appointment) => total + appointment.durationMinutes,
    0
  );
  const utilization = Math.min(100, Math.round((bookedMinutes / 540) * 100));

  async function loadAgenda(dateKey: string) {
    setAgendaLoading(true);
    setFeedback("");
    try {
      const response = await fetch(
        `/api/admin/agenda?date=${encodeURIComponent(dateKey)}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        appointments?: Appointment[];
        error?: string;
      };
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      if (!response.ok) {
        throw new Error(payload.error ?? "Agenda non disponibile.");
      }
      setAppointments(payload.appointments ?? []);
    } catch (requestError) {
      setFeedback(
        requestError instanceof Error
          ? requestError.message
          : "Agenda non disponibile."
      );
    } finally {
      setAgendaLoading(false);
    }
  }

  useEffect(() => {
    void loadAgenda(selectedDate);
  }, [selectedDate]);

  useEffect(() => {
    if (!manualOpen || !selectedCustomer) return;

    const controller = new AbortController();
    const search = new URLSearchParams({
      service: serviceId,
      date: manualDate,
      phone: selectedCustomer.phone
    });
    setManualLoading(true);
    setManualTime("");

    fetch(`/api/public/availability?${search.toString()}`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          slots?: Array<{ slot_time: string; duration_minutes: number }>;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "Orari non disponibili.");
        }
        setManualSlots(payload.slots ?? []);
      })
      .catch((requestError: unknown) => {
        if (requestError instanceof DOMException && requestError.name === "AbortError") {
          return;
        }
        setManualSlots([]);
        setFeedback(
          requestError instanceof Error
            ? requestError.message
            : "Orari non disponibili."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setManualLoading(false);
      });

    return () => controller.abort();
  }, [manualDate, manualOpen, selectedCustomer, serviceId]);

  async function createManualBooking() {
    setFeedback("");
    if (!selectedCustomer || !manualTime) {
      setFeedback("Scegli cliente e orario.");
      return;
    }

    setManualLoading(true);
    try {
      const response = await fetch("/api/admin/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": `manual:${crypto.randomUUID()}`
        },
        body: JSON.stringify({
          serviceSlug: serviceId,
          date: manualDate,
          startTime: manualTime,
          customerName: selectedCustomer.name,
          phone: selectedCustomer.phone,
          notes
        })
      });
      const payload = (await response.json()) as { error?: string };
      if (response.status === 401) {
        window.location.assign("/admin/login");
        return;
      }
      if (!response.ok) {
        throw new Error(
          payload.error ?? "Non è stato possibile creare l’appuntamento."
        );
      }

      setSelectedDate(manualDate);
      setManualOpen(false);
      setManualTime("");
      setNotes("");
      await loadAgenda(manualDate);
    } catch (requestError) {
      setFeedback(
        requestError instanceof Error
          ? requestError.message
          : "Non è stato possibile creare l’appuntamento."
      );
    } finally {
      setManualLoading(false);
    }
  }

  async function cancelAppointment(appointmentId: string) {
    setFeedback("");
    const response = await fetch(
      `/api/admin/bookings?id=${encodeURIComponent(appointmentId)}`,
      { method: "DELETE" }
    );
    const payload = (await response.json()) as { error?: string };
    if (response.status === 401) {
      window.location.assign("/admin/login");
      return;
    }
    if (!response.ok) {
      setFeedback(
        payload.error ?? "Non è stato possibile annullare l’appuntamento."
      );
      return;
    }
    await loadAgenda(selectedDate);
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
          <Link href="/admin/voice">
            <HeadsetIcon />
            Assistente
            <small>Test voce</small>
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <span className="system-status"><i /> Sistema operativo</span>
          <Link href="/">
            Sito pubblico
            <ArrowUpRight />
          </Link>
          <button
            className="quiet-button"
            onClick={async () => {
              await fetch("/api/admin/session", { method: "DELETE" });
              window.location.assign("/admin/login");
            }}
            type="button"
          >
            Esci dall’agenda
          </button>
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
          {feedback && !manualOpen ? (
            <p className="form-error">{feedback}</p>
          ) : null}
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
              <strong>Twilio attivo</strong>
              <small><i /> WhatsApp collegato · voce pronta</small>
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
              {agendaLoading ? (
                <div className="empty-agenda">
                  <span><ClockIcon /></span>
                  <h3>Aggiornamento agenda</h3>
                  <p>Sto leggendo gli appuntamenti dalla fonte centrale.</p>
                </div>
              ) : dayAppointments.length > 0 ? (
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
                          {services.find(
                            (service) => service.name === appointment.serviceName
                          )?.durationMinutes !== appointment.durationMinutes
                            ? " · durata personale"
                            : ""}
                        </small>
                      </div>
                      <ChannelBadge channel={appointment.channel} />
                      <button
                        className="row-action"
                        onClick={() => void cancelAppointment(appointment.id)}
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
              <strong>Agenda centrale attiva</strong>
              <p>
                Sito e inserimento manuale leggono e scrivono sullo stesso
                database. Ogni modifica è visibile da tutti i dispositivi.
              </p>
            </div>
            <button onClick={() => void loadAgenda(selectedDate)} type="button">
              Aggiorna
            </button>
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
                    {manualSlots[0]?.duration_minutes ??
                      (selectedCustomer
                        ? getEffectiveDuration(selectedCustomer, selectedService)
                        : selectedService.durationMinutes)} minuti
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
                      className={manualTime === slot.slot_time ? "selected" : ""}
                      key={slot.slot_time}
                      onClick={() => setManualTime(slot.slot_time)}
                      type="button"
                    >
                      {slot.slot_time}
                    </button>
                  ))}
                  {!manualLoading && manualSlots.length === 0 ? (
                    <small>Nessun orario disponibile.</small>
                  ) : null}
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
              disabled={!manualTime || manualLoading}
              onClick={() => void createManualBooking()}
              type="button"
            >
              <CheckIcon />
              {manualLoading
                ? "Aggiornamento in corso…"
                : "Conferma e aggiungi all’agenda"}
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
