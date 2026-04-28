"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  type BookingRequest,
  type BookingStatus,
  STORAGE_KEY,
  formatPrice,
  loadBookings,
  readableDate
} from "../lib/bookings";

const statusStyles: Record<BookingStatus, string> = {
  "In attesa di conferma": "bg-amber-100 text-amber-900 ring-amber-200",
  Confermata: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  Rifiutata: "bg-red-100 text-red-900 ring-red-200"
};

export default function AdminPage() {
  const [bookings, setBookings] = useState<BookingRequest[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setBookings(loadBookings());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded && typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
    }
  }, [bookings, loaded]);

  function updateStatus(id: string, status: BookingStatus) {
    setBookings((current) =>
      current.map((booking) => (booking.id === id ? { ...booking, status } : booking))
    );
  }

  return (
    <main className="min-h-screen px-4 py-4 text-ink sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <div className="rounded-2xl bg-ink px-4 py-3 text-center text-sm font-bold leading-6 text-white shadow-soft">
          Questa è una demo: le prenotazioni non vengono inviate davvero. Serve solo per provare il funzionamento.
        </div>

        <header className="flex items-center justify-between py-6">
          <div>
            <p className="text-sm font-black uppercase tracking-wide text-stonegold">Gestionale</p>
            <h1 className="mt-1 text-3xl font-black">Area Mino — Demo</h1>
          </div>
          <Link
            className="rounded-full border border-espresso/10 bg-white px-4 py-3 text-sm font-black shadow-sm"
            href="/"
          >
            Cliente
          </Link>
        </header>

        <section className="rounded-[2rem] bg-white p-5 shadow-soft ring-1 ring-espresso/10 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black">Richieste ricevute</h2>
              <p className="mt-2 max-w-md leading-7 text-espresso/70">
                Qui Mino vede le richieste ricevute e può decidere se confermarle o rifiutarle.
              </p>
            </div>
            <div className="grid h-16 min-w-16 place-items-center rounded-2xl bg-ink px-4 text-center text-white">
              <span className="text-2xl font-black">{bookings.length}</span>
            </div>
          </div>

          <div className="mt-7 grid gap-4">
            {bookings.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-espresso/15 bg-linen p-8 text-center">
                <p className="text-xl font-black">Nessuna richiesta</p>
                <p className="mx-auto mt-2 max-w-sm leading-7 text-espresso/70">
                  Crea una richiesta dal flusso cliente e apparirà subito qui.
                </p>
              </div>
            ) : (
              bookings.map((booking) => (
                <article key={booking.id} className="rounded-3xl bg-linen p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-2xl font-black">{booking.customerName}</h3>
                      <p className="mt-1 font-bold text-espresso/65">{booking.phone}</p>
                    </div>
                    <StatusBadge status={booking.status} />
                  </div>

                  <div className="mt-5 rounded-2xl bg-white p-4">
                    <Info label="Servizio" value={`${booking.serviceName} · ${formatPrice(booking.price)}`} />
                    <Info label="Data" value={readableDate(booking.date)} />
                    <Info label="Orario" value={booking.time} />
                    <Info label="Stato" value={booking.status} />
                    {booking.notes ? <Info label="Note" value={booking.notes} /> : null}
                  </div>

                  {booking.status === "In attesa di conferma" ? (
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <button
                        className="min-h-14 rounded-2xl bg-emerald-700 px-5 font-black text-white shadow-sm"
                        onClick={() => updateStatus(booking.id, "Confermata")}
                        type="button"
                      >
                        Conferma prenotazione
                      </button>
                      <button
                        className="min-h-14 rounded-2xl border border-red-200 bg-red-50 px-5 font-black text-red-800"
                        onClick={() => updateStatus(booking.id, "Rifiutata")}
                        type="button"
                      >
                        Rifiuta prenotazione
                      </button>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ring-1 ${statusStyles[status]}`}>
      {status}
    </span>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-espresso/10 py-3 last:border-b-0">
      <span className="text-xs font-black uppercase tracking-wide text-espresso/50">{label}</span>
      <span className="max-w-[62%] text-right font-black capitalize">{value}</span>
    </div>
  );
}
