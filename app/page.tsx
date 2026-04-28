"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  type BookingRequest,
  STORAGE_KEY,
  formatPrice,
  loadBookings,
  makeDateOptions,
  makeSlots,
  readableDate,
  services
} from "./lib/bookings";

const totalSteps = 4;

const stepCopy = [
  {
    title: "Scegli il servizio",
    description: "Tocca il trattamento che vuoi prenotare."
  },
  {
    title: "Scegli il giorno",
    description: "Mostriamo solo i giorni in cui Mino Coiffeur è aperto."
  },
  {
    title: "Scegli l'orario",
    description: "Gli slot sono ogni 20 minuti. La pausa pranzo è esclusa."
  },
  {
    title: "Conferma richiesta",
    description: "Controlla i dati e invia la richiesta demo."
  }
];

export default function Home() {
  const dateOptions = useMemo(() => makeDateOptions(), []);
  const slots = useMemo(() => makeSlots(), []);
  const [bookings, setBookings] = useState<BookingRequest[]>([]);
  const [bookingsLoaded, setBookingsLoaded] = useState(false);
  const [step, setStep] = useState(1);
  const [selectedServiceId, setSelectedServiceId] = useState(services[2].id);
  const [selectedDate, setSelectedDate] = useState(dateOptions[0]?.key ?? "");
  const [selectedTime, setSelectedTime] = useState(slots[0] ?? "");
  const [customerName, setCustomerName] = useState("Cliente Demo");
  const [phone, setPhone] = useState("333 000 0000");
  const [notes, setNotes] = useState("");
  const [lastSubmittedId, setLastSubmittedId] = useState<string | null>(null);

  const selectedService = services.find((service) => service.id === selectedServiceId) ?? services[0];
  const lastSubmitted = bookings.find((booking) => booking.id === lastSubmittedId);
  const currentCopy = stepCopy[step - 1];

  useEffect(() => {
    setBookings(loadBookings());
    setBookingsLoaded(true);
  }, []);

  useEffect(() => {
    if (bookingsLoaded && typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
    }
  }, [bookings, bookingsLoaded]);

  function goNext() {
    setStep((current) => Math.min(totalSteps, current + 1));
  }

  function goBack() {
    setStep((current) => Math.max(1, current - 1));
  }

  function submitDemoRequest() {
    const booking: BookingRequest = {
      id: crypto.randomUUID(),
      serviceId: selectedService.id,
      serviceName: selectedService.name,
      price: selectedService.price,
      date: selectedDate,
      time: selectedTime,
      customerName: customerName.trim() || "Cliente Demo",
      phone: phone.trim() || "333 000 0000",
      notes: notes.trim(),
      status: "In attesa di conferma",
      createdAt: new Date().toISOString()
    };

    setBookings((current) => [booking, ...current]);
    setLastSubmittedId(booking.id);
  }

  return (
    <main className="min-h-screen px-4 py-4 text-ink sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-xl flex-col">
        <div className="rounded-2xl bg-ink px-4 py-3 text-center text-sm font-bold leading-6 text-white shadow-soft">
          Questa è una demo: le prenotazioni non vengono inviate davvero. Serve solo per provare il funzionamento.
        </div>

        <header className="flex items-center justify-between py-6">
          <div>
            <p className="text-2xl font-black">Mino Coiffeur</p>
            <p className="mt-1 text-sm font-bold text-espresso/65">Prenota in pochi secondi</p>
          </div>
          <Link
            className="rounded-full border border-espresso/10 bg-white px-4 py-3 text-sm font-black shadow-sm"
            href="/admin"
          >
            Area Mino
          </Link>
        </header>

        <section className="mb-5 rounded-[2rem] bg-ink p-6 text-white shadow-soft">
          <p className="text-sm font-black uppercase tracking-wide text-stonegold">Demo prenotazioni</p>
          <h1 className="mt-3 text-4xl font-black leading-tight">Mino Coiffeur</h1>
          <p className="mt-3 text-xl font-bold text-stone-100">
            Prenota il tuo appuntamento in pochi secondi
          </p>
          <p className="mt-4 leading-7 text-stone-200">
            Taglio, barba e stile. Scegli servizio, giorno e orario: Mino confermerà la tua richiesta.
          </p>
        </section>

        <section className="flex flex-1 flex-col rounded-[2rem] bg-white p-5 shadow-soft ring-1 ring-espresso/10 sm:p-6">
          {lastSubmitted ? (
            <Success booking={lastSubmitted} />
          ) : (
            <>
              <Progress step={step} />

              <div className="py-7 text-center">
                <p className="text-sm font-black uppercase tracking-wide text-stonegold">
                  Step {step} of {totalSteps}
                </p>
                <h2 className="mt-2 text-3xl font-black">{currentCopy.title}</h2>
                <p className="mx-auto mt-3 max-w-sm text-base leading-7 text-espresso/70">
                  {currentCopy.description}
                </p>
              </div>

              <div className="flex-1">{renderStep()}</div>

              <div className="mt-8 flex gap-3">
                {step > 1 ? (
                  <button
                    className="min-h-14 flex-1 rounded-2xl border border-espresso/10 bg-linen px-5 text-base font-black"
                    onClick={goBack}
                    type="button"
                  >
                    Indietro
                  </button>
                ) : null}
                {step < totalSteps ? (
                  <button
                    className="min-h-14 flex-[1.4] rounded-2xl bg-ink px-5 text-base font-black text-white shadow-lg"
                    onClick={goNext}
                    type="button"
                  >
                    Continua
                  </button>
                ) : (
                  <button
                    className="min-h-14 flex-[1.4] rounded-2xl bg-ink px-5 text-base font-black text-white shadow-lg"
                    onClick={submitDemoRequest}
                    type="button"
                  >
                    Invia richiesta demo
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );

  function renderStep() {
    if (step === 1) {
      return (
        <div className="grid gap-4">
          {services.map((service) => {
            const selected = service.id === selectedServiceId;
            return (
              <button
                key={service.id}
                className={`rounded-3xl border p-5 text-left shadow-sm transition ${
                  selected
                    ? "border-stonegold bg-warm ring-4 ring-stonegold/15"
                    : "border-espresso/10 bg-linen hover:border-stonegold/50"
                }`}
                onClick={() => setSelectedServiceId(service.id)}
                type="button"
              >
                <span className="flex items-start justify-between gap-4">
                  <span>
                    <span className="block text-xl font-black">{service.name}</span>
                    <span className="mt-2 block text-sm leading-6 text-espresso/70">{service.description}</span>
                  </span>
                  <span className="rounded-full bg-ink px-4 py-2 text-sm font-black text-white">
                    {formatPrice(service.price)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      );
    }

    if (step === 2) {
      return (
        <div className="grid gap-3">
          {dateOptions.map((date) => (
            <button
              key={date.key}
              className={`rounded-3xl border p-5 text-left shadow-sm transition ${
                selectedDate === date.key
                  ? "border-stonegold bg-ink text-white ring-4 ring-stonegold/20"
                  : "border-espresso/10 bg-linen hover:border-stonegold/50"
              }`}
              onClick={() => setSelectedDate(date.key)}
              type="button"
            >
              <span className="block text-xl font-black capitalize">{date.label}</span>
              <span className="mt-1 block text-sm font-bold capitalize opacity-70">{date.hint}</span>
            </button>
          ))}
        </div>
      );
    }

    if (step === 3) {
      return (
        <div className="grid grid-cols-3 gap-3">
          {slots.map((slot) => (
            <button
              key={slot}
              className={`min-h-14 rounded-2xl border text-lg font-black shadow-sm transition ${
                selectedTime === slot
                  ? "border-stonegold bg-stonegold text-white ring-4 ring-stonegold/20"
                  : "border-espresso/10 bg-linen hover:border-stonegold/50"
              }`}
              onClick={() => setSelectedTime(slot)}
              type="button"
            >
              {slot}
            </button>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <div className="rounded-3xl bg-linen p-5">
          <SummaryRow label="Servizio" value={`${selectedService.name} · ${formatPrice(selectedService.price)}`} />
          <SummaryRow label="Data" value={readableDate(selectedDate)} />
          <SummaryRow label="Orario" value={selectedTime} />
        </div>

        <div className="grid gap-4">
          <label>
            <span className="mb-2 block text-sm font-black text-espresso">Nome</span>
            <input
              className="min-h-14 w-full rounded-2xl border border-espresso/10 bg-linen px-4 text-base outline-none ring-stonegold/30 transition focus:border-stonegold focus:ring-4"
              onChange={(event) => setCustomerName(event.target.value)}
              value={customerName}
            />
          </label>
          <label>
            <span className="mb-2 block text-sm font-black text-espresso">Telefono</span>
            <input
              className="min-h-14 w-full rounded-2xl border border-espresso/10 bg-linen px-4 text-base outline-none ring-stonegold/30 transition focus:border-stonegold focus:ring-4"
              onChange={(event) => setPhone(event.target.value)}
              value={phone}
            />
          </label>
          <label>
            <span className="mb-2 block text-sm font-black text-espresso">Note opzionali</span>
            <textarea
              className="min-h-24 w-full rounded-2xl border border-espresso/10 bg-linen px-4 py-4 text-base outline-none ring-stonegold/30 transition focus:border-stonegold focus:ring-4"
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Esempio: arrivo puntuale, ho poco tempo."
              value={notes}
            />
          </label>
        </div>
      </div>
    );
  }
}

function Progress({ step }: { step: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm font-black text-espresso/70">
        <span>
          Step {step} of {totalSteps}
        </span>
        <span>{Math.round((step / totalSteps) * 100)}%</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {Array.from({ length: totalSteps }, (_, index) => (
          <div
            key={index}
            className={`h-2 rounded-full ${index < step ? "bg-stonegold" : "bg-espresso/10"}`}
          />
        ))}
      </div>
    </div>
  );
}

function Success({ booking }: { booking: BookingRequest }) {
  return (
    <div className="flex min-h-[520px] flex-col justify-center text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl font-black text-emerald-800">
        OK
      </div>
      <h2 className="mt-6 text-3xl font-black">Richiesta demo inviata</h2>
      <p className="mx-auto mt-3 max-w-sm leading-7 text-espresso/70">
        In una versione reale, Mino riceverebbe la richiesta e potrebbe confermarla o rifiutarla.
      </p>

      <div className="mt-7 rounded-3xl bg-linen p-5 text-left">
        <SummaryRow label="Servizio" value={`${booking.serviceName} · ${formatPrice(booking.price)}`} />
        <SummaryRow label="Data" value={readableDate(booking.date)} />
        <SummaryRow label="Orario" value={booking.time} />
        <SummaryRow label="Nome" value={booking.customerName} />
        <SummaryRow label="Telefono" value={booking.phone} />
        <SummaryRow label="Stato" value={booking.status} />
      </div>

      <div className="mt-7 grid gap-3">
        <Link className="rounded-2xl bg-ink px-5 py-4 font-black text-white" href="/admin">
          Vedi in Area Mino
        </Link>
        <button
          className="rounded-2xl border border-espresso/10 bg-white px-5 py-4 font-black"
          onClick={() => window.location.reload()}
          type="button"
        >
          Nuova richiesta demo
        </button>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-espresso/10 py-3 last:border-b-0">
      <span className="text-sm font-black uppercase tracking-wide text-espresso/50">{label}</span>
      <span className="max-w-[62%] text-right font-black capitalize">{value}</span>
    </div>
  );
}
