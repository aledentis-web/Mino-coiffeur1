export type BookingChannel = "site" | "whatsapp" | "voice" | "manual";

export type AppointmentStatus =
  | "confirmed"
  | "completed"
  | "cancelled"
  | "no_show";

export type Service = {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  price: number;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  preferredServiceId: string;
  durationOverrides: Record<string, number>;
  notes: string;
};

export type Appointment = {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  serviceId: string;
  serviceName: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  channel: BookingChannel;
  status: AppointmentStatus;
  notes: string;
  externalReference?: string;
  createdAt: string;
};

export type OpeningRange = {
  start: string;
  end: string;
};

export type BusinessConfig = {
  name: string;
  tagline: string;
  address: string;
  phone: string;
  timezone: string;
  slotIntervalMinutes: number;
  openingHours: Record<number, OpeningRange[]>;
};

export type BookingInput = {
  customerId: string;
  serviceId: string;
  date: string;
  startTime: string;
  channel: BookingChannel;
  notes?: string;
  externalReference?: string;
};

export type BookingResult =
  | { ok: true; appointment: Appointment; idempotent: boolean }
  | { ok: false; error: string };

