"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import { createBooking } from "../lib/booking-engine";
import type {
  Appointment,
  BookingInput,
  BookingResult,
  Customer
} from "../lib/domain";
import {
  businessConfig,
  createSeedAppointments,
  services,
  syntheticCustomers
} from "../lib/seed";

const STORAGE_KEY = "studio-barber-8:demo-store:v1";

type StoreSnapshot = {
  appointments: Appointment[];
  customers: Customer[];
};

type BookingContextValue = StoreSnapshot & {
  ready: boolean;
  book: (input: BookingInput) => BookingResult;
  bookForContact: (
    contact: { name: string; phone: string },
    input: Omit<BookingInput, "customerId">
  ) => BookingResult;
  cancel: (appointmentId: string) => void;
  findOrCreateCustomer: (name: string, phone: string) => Customer;
  resetDemo: () => void;
};

const BookingContext = createContext<BookingContextValue | null>(null);

function initialSnapshot(): StoreSnapshot {
  return {
    appointments: createSeedAppointments(),
    customers: syntheticCustomers
  };
}

export function BookingProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<StoreSnapshot>(initialSnapshot);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as StoreSnapshot;
        if (
          Array.isArray(parsed.appointments) &&
          Array.isArray(parsed.customers)
        ) {
          setSnapshot(parsed);
        }
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }, [ready, snapshot]);

  const findOrCreateCustomer = useCallback(
    (name: string, phone: string) => {
      const normalized = phone.replace(/\s/g, "");
      const existing = snapshot.customers.find(
        (customer) => customer.phone.replace(/\s/g, "") === normalized
      );
      if (existing) return existing;

      const customer: Customer = {
        id: crypto.randomUUID(),
        name: name.trim() || "Nuovo cliente",
        phone: phone.trim(),
        preferredServiceId: services[0].id,
        durationOverrides: {},
        notes: "Cliente creato dal flusso di prenotazione demo."
      };

      setSnapshot((current) => ({
        ...current,
        customers: [...current.customers, customer]
      }));
      return customer;
    },
    [snapshot.customers]
  );

  const book = useCallback(
    (input: BookingInput) => {
      const result = createBooking({
        input,
        customers: snapshot.customers,
        services,
        appointments: snapshot.appointments,
        config: businessConfig
      });

      if (result.ok && !result.idempotent) {
        setSnapshot((current) => ({
          ...current,
          appointments: [...current.appointments, result.appointment]
        }));
      }

      return result;
    },
    [snapshot.appointments, snapshot.customers]
  );

  const bookForContact = useCallback(
    (
      contact: { name: string; phone: string },
      input: Omit<BookingInput, "customerId">
    ) => {
      const normalized = contact.phone.replace(/\s/g, "");
      const existing = snapshot.customers.find(
        (customer) => customer.phone.replace(/\s/g, "") === normalized
      );
      const customer: Customer =
        existing ??
        {
          id: crypto.randomUUID(),
          name: contact.name.trim() || "Nuovo cliente",
          phone: contact.phone.trim(),
          preferredServiceId: input.serviceId,
          durationOverrides: {},
          notes: "Cliente creato dal flusso di prenotazione demo."
        };
      const customers = existing
        ? snapshot.customers
        : [...snapshot.customers, customer];
      const result = createBooking({
        input: { ...input, customerId: customer.id },
        customers,
        services,
        appointments: snapshot.appointments,
        config: businessConfig
      });

      if (result.ok && !result.idempotent) {
        setSnapshot((current) => ({
          customers: existing ? current.customers : [...current.customers, customer],
          appointments: [...current.appointments, result.appointment]
        }));
      }

      return result;
    },
    [snapshot.appointments, snapshot.customers]
  );

  const cancel = useCallback((appointmentId: string) => {
    setSnapshot((current) => ({
      ...current,
      appointments: current.appointments.map((appointment) =>
        appointment.id === appointmentId
          ? { ...appointment, status: "cancelled" }
          : appointment
      )
    }));
  }, []);

  const resetDemo = useCallback(() => {
    const clean = initialSnapshot();
    setSnapshot(clean);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  }, []);

  const value = useMemo(
    () => ({
      ...snapshot,
      ready,
      book,
      bookForContact,
      cancel,
      findOrCreateCustomer,
      resetDemo
    }),
    [
      book,
      bookForContact,
      cancel,
      findOrCreateCustomer,
      ready,
      resetDemo,
      snapshot
    ]
  );

  return (
    <BookingContext.Provider value={value}>
      {children}
    </BookingContext.Provider>
  );
}

export function useBookingStore() {
  const context = useContext(BookingContext);
  if (!context) {
    throw new Error("useBookingStore deve essere usato dentro BookingProvider");
  }
  return context;
}
