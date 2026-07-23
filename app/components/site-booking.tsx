"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { getAvailableSlots, getEffectiveDuration } from "../lib/booking-engine";
import type { Customer } from "../lib/domain";
import {
  businessConfig,
  nextOpenDates,
  services,
  syntheticCustomers
} from "../lib/seed";
import { Brand } from "./brand";
import { useBookingStore } from "./booking-provider";
import {
  ArrowUpRight,
  CalendarIcon,
  CheckIcon,
  ChevronLeft,
  ClockIcon,
  HeadsetIcon,
  PhoneIcon,
  ScissorsIcon,
  WhatsAppIcon
} from "./icons";

const dateFormatter = new Intl.DateTimeFormat("it-IT", {
  weekday: "short",
  day: "numeric",
  month: "short"
});

function formatDate(dateKey: string) {
  return dateFormatter.format(new Date(`${dateKey}T12:00:00`));
}

export function SiteBooking() {
  const { appointments, customers, bookForContact } = useBookingStore();
  const dates = useMemo(() => nextOpenDates(8), []);
  const [step, setStep] = useState(1);
  const [serviceId, setServiceId] = useState(services[0].id);
  const [date, setDate] = useState(dates[0]);
  const [time, setTime] = useState("");
  const [name, setName] = useState(syntheticCustomers[0].name);
  const [phone, setPhone] = useState(syntheticCustomers[0].phone);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [confirmedId, setConfirmedId] = useState("");

  const service = services.find((item) => item.id === serviceId)!;
  const matchedCustomer = customers.find(
    (customer) =>
      customer.phone.replace(/\s/g, "") === phone.replace(/\s/g, "")
  );
  const availabilityCustomer: Customer =
    matchedCustomer ??
    ({
      id: "new-customer-preview",
      name,
      phone,
      preferredServiceId: serviceId,
      durationOverrides: {},
      notes: ""
    } satisfies Customer);
  const duration = getEffectiveDuration(availabilityCustomer, service);
  const slots = getAvailableSlots({
    date,
    customer: availabilityCustomer,
    service,
    appointments,
    config: businessConfig
  });

  function chooseService(nextServiceId: string) {
    setServiceId(nextServiceId);
    setTime("");
  }

  function chooseDate(nextDate: string) {
    setDate(nextDate);
    setTime("");
  }

  function submitBooking() {
    setError("");
    if (!name.trim() || phone.replace(/\D/g, "").length < 8) {
      setError("Inserisci nome e numero di telefono.");
      return;
    }
    if (!time) {
      setError("Scegli un orario disponibile.");
      return;
    }

    const result = bookForContact(
      { name, phone },
      {
        serviceId,
        date,
        startTime: time,
        channel: "site",
        notes,
        externalReference: `site-${Date.now()}`
      }
    );

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setConfirmedId(result.appointment.id);
    setStep(4);
  }

  return (
    <main className="public-shell">
      <header className="public-header">
        <Brand />
        <nav className="public-nav" aria-label="Navigazione demo">
          <a href="#servizi">Servizi</a>
          <a href="#come-funziona">Come funziona</a>
          <Link className="nav-pill" href="/admin">
            Agenda demo
            <ArrowUpRight />
          </Link>
        </nav>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="live-dot" />
            Prenotazioni aperte
          </div>
          <h1>
            Il tuo tempo,
            <br />
            <em>fatto bene.</em>
          </h1>
          <p>
            Scegli il servizio e trova il momento giusto. Senza attese,
            messaggi persi o telefonate a vuoto.
          </p>

          <figure className="hero-media">
            <Image
              alt="Barbiere mentre rifinisce un taglio con forbici e pettine"
              fill
              priority
              sizes="(max-width: 980px) 100vw, 50vw"
              src="/images/barber-cut-editorial.webp"
            />
            <figcaption>
              <span>Studio 01</span>
              <strong>Precisione, senza fretta.</strong>
            </figcaption>
          </figure>

          <div className="entrance-strip" id="come-funziona">
            <span><CalendarIcon /> Sito</span>
            <span><WhatsAppIcon /> WhatsApp</span>
            <span><PhoneIcon /> Chiamata</span>
            <span><ScissorsIcon /> In negozio</span>
          </div>
        </div>

        <div className="booking-card">
          <div className="booking-topline">
            <button
              className={`back-button ${step > 1 && step < 4 ? "visible" : ""}`}
              onClick={() => setStep((current) => Math.max(1, current - 1))}
              type="button"
            >
              <ChevronLeft />
              Indietro
            </button>
            <span className="step-counter">
              {step < 4 ? `0${step} / 03` : "Confermato"}
            </span>
          </div>

          {step === 1 ? (
            <div className="booking-step" id="servizi">
              <div className="step-heading">
                <span>Prima cosa</span>
                <h2>Cosa facciamo?</h2>
                <p>Seleziona il servizio. La durata si adatta al cliente.</p>
              </div>
              <div className="service-list">
                {services.map((item) => (
                  <button
                    className={`service-option ${
                      serviceId === item.id ? "selected" : ""
                    }`}
                    key={item.id}
                    onClick={() => chooseService(item.id)}
                    type="button"
                  >
                    <span className="service-radio">
                      {serviceId === item.id ? <span /> : null}
                    </span>
                    <span className="service-main">
                      <strong>{item.name}</strong>
                      <small>{item.description}</small>
                    </span>
                    <span className="service-meta">
                      <strong>{item.price}€</strong>
                      <small>{item.durationMinutes} min</small>
                    </span>
                  </button>
                ))}
              </div>
              <button className="primary-action" onClick={() => setStep(2)} type="button">
                Scegli il giorno
                <ArrowUpRight />
              </button>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="booking-step">
              <div className="step-heading">
                <span>Quando vuoi</span>
                <h2>Troviamo spazio.</h2>
                <p>
                  Per te abbiamo calcolato {duration} minuti per {service.name.toLowerCase()}.
                </p>
              </div>
              <div className="date-scroller">
                {dates.map((item) => (
                  <button
                    className={date === item ? "selected" : ""}
                    key={item}
                    onClick={() => chooseDate(item)}
                    type="button"
                  >
                    <span>{formatDate(item).split(" ")[0]}</span>
                    <strong>{formatDate(item).split(" ")[1]}</strong>
                    <small>{formatDate(item).split(" ")[2]}</small>
                  </button>
                ))}
              </div>
              <div className="slot-heading">
                <span><ClockIcon /> Orari disponibili</span>
                <small>{slots.length} possibilità</small>
              </div>
              <div className="slot-grid">
                {slots.map((slot) => (
                  <button
                    className={time === slot ? "selected" : ""}
                    key={slot}
                    onClick={() => setTime(slot)}
                    type="button"
                  >
                    {slot}
                  </button>
                ))}
              </div>
              <button
                className="primary-action"
                disabled={!time}
                onClick={() => setStep(3)}
                type="button"
              >
                Inserisci i tuoi dati
                <ArrowUpRight />
              </button>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="booking-step">
              <div className="step-heading">
                <span>Ultimo passaggio</span>
                <h2>Ci siamo quasi.</h2>
                <p>Il numero ci permette di riconoscerti su tutti i canali.</p>
              </div>
              <div className="summary-chip">
                <CalendarIcon />
                <span>
                  <strong>{service.name}</strong>
                  <small>{formatDate(date)} · {time} · {duration} minuti</small>
                </span>
              </div>
              <div className="form-grid">
                <label>
                  <span>Nome e cognome</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} />
                </label>
                <label>
                  <span>Numero di telefono</span>
                  <input value={phone} onChange={(event) => setPhone(event.target.value)} />
                </label>
                <label>
                  <span>Nota facoltativa</span>
                  <textarea
                    placeholder="Qualcosa che dovremmo sapere?"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                </label>
              </div>
              {matchedCustomer ? (
                <div className="recognition-note">
                  <CheckIcon />
                  Cliente test riconosciuto: useremo le sue preferenze abituali.
                </div>
              ) : null}
              {error ? <p className="form-error">{error}</p> : null}
              <button className="primary-action" onClick={submitBooking} type="button">
                Conferma appuntamento
                <ArrowUpRight />
              </button>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="booking-success">
              <span className="success-mark"><CheckIcon /></span>
              <span className="eyebrow-text">Appuntamento confermato</span>
              <h2>Perfetto, {name.split(" ")[0]}.</h2>
              <p>
                Ti aspettiamo {formatDate(date)} alle {time}. L’appuntamento è già
                visibile nell’agenda Studio Barber 8.
              </p>
              <div className="success-ticket">
                <span><ScissorsIcon /></span>
                <div>
                  <strong>{service.name}</strong>
                  <small>{duration} minuti · {service.price}€</small>
                </div>
                <code>#{confirmedId.slice(0, 6).toUpperCase()}</code>
              </div>
              <div className="success-actions">
                <Link className="primary-action" href="/admin">
                  Apri l’agenda
                  <ArrowUpRight />
                </Link>
                <button
                  className="secondary-action"
                  onClick={() => {
                    setStep(1);
                    setTime("");
                    setConfirmedId("");
                  }}
                  type="button"
                >
                  Nuova prenotazione
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="craft-story" aria-labelledby="craft-title">
        <div className="craft-copy">
          <span className="section-index">Il nostro modo</span>
          <h2 id="craft-title">
            Cura nei dettagli.
            <br />
            <em>Semplicità nel resto.</em>
          </h2>
          <p>
            Un servizio preciso merita un’esperienza altrettanto precisa:
            scegli, prenota e arriva al momento giusto.
          </p>
          <div className="craft-principles">
            <span><i>01</i> Tempo rispettato</span>
            <span><i>02</i> Durata su misura</span>
            <span><i>03</i> Un’unica agenda</span>
          </div>
          <small>Visual concept per il business test Studio Barber 8.</small>
        </div>

        <figure className="craft-photo razor-photo">
          <Image
            alt="Dettaglio della rifinitura della barba con rasoio"
            fill
            sizes="(max-width: 680px) 88vw, 28vw"
            src="/images/barber-razor-detail.webp"
          />
          <figcaption>
            <span>Barba</span>
            <strong>Contorni netti</strong>
          </figcaption>
        </figure>

        <figure className="craft-photo studio-photo">
          <Image
            alt="Poltrona e postazione di un moderno barber shop"
            fill
            sizes="(max-width: 680px) 88vw, 28vw"
            src="/images/barber-studio-chair.webp"
          />
          <figcaption>
            <span>Lo spazio</span>
            <strong>Pronto per te</strong>
          </figcaption>
        </figure>
      </section>

      <footer className="public-footer">
        <div>
          <HeadsetIcon />
          <span>
            <strong>Segretario digitale in preparazione</strong>
            <small>Presto disponibile su WhatsApp e chiamata.</small>
          </span>
        </div>
        <p>Studio Barber 8 · Business test by Studio Ares 8</p>
      </footer>
    </main>
  );
}
