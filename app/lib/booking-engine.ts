import type {
  Appointment,
  BookingInput,
  BookingResult,
  BusinessConfig,
  Customer,
  Service
} from "./domain";

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes: number) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(
    totalMinutes % 60
  ).padStart(2, "0")}`;
}

export function getEffectiveDuration(
  customer: Customer,
  service: Service
) {
  return customer.durationOverrides[service.id] ?? service.durationMinutes;
}

export function overlaps(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number
) {
  return firstStart < secondEnd && secondStart < firstEnd;
}

export function getAvailableSlots({
  date,
  customer,
  service,
  appointments,
  config
}: {
  date: string;
  customer: Customer;
  service: Service;
  appointments: Appointment[];
  config: BusinessConfig;
}) {
  const day = new Date(`${date}T12:00:00`).getDay();
  const ranges = config.openingHours[day] ?? [];
  const duration = getEffectiveDuration(customer, service);
  const busy = appointments.filter(
    (appointment) =>
      appointment.date === date && appointment.status !== "cancelled"
  );

  return ranges.flatMap((range) => {
    const start = timeToMinutes(range.start);
    const end = timeToMinutes(range.end);
    const slots: string[] = [];

    for (
      let candidate = start;
      candidate + duration <= end;
      candidate += config.slotIntervalMinutes
    ) {
      const candidateEnd = candidate + duration;
      const isBusy = busy.some((appointment) =>
        overlaps(
          candidate,
          candidateEnd,
          timeToMinutes(appointment.startTime),
          timeToMinutes(appointment.endTime)
        )
      );

      if (!isBusy) {
        slots.push(minutesToTime(candidate));
      }
    }

    return slots;
  });
}

export function createBooking({
  input,
  customers,
  services,
  appointments,
  config,
  now = new Date()
}: {
  input: BookingInput;
  customers: Customer[];
  services: Service[];
  appointments: Appointment[];
  config: BusinessConfig;
  now?: Date;
}): BookingResult {
  if (input.externalReference) {
    const existing = appointments.find(
      (appointment) =>
        appointment.externalReference === input.externalReference
    );
    if (existing) {
      return { ok: true, appointment: existing, idempotent: true };
    }
  }

  const customer = customers.find((item) => item.id === input.customerId);
  const service = services.find((item) => item.id === input.serviceId);

  if (!customer) {
    return { ok: false, error: "Cliente non trovato." };
  }

  if (!service) {
    return { ok: false, error: "Servizio non trovato." };
  }

  const available = getAvailableSlots({
    date: input.date,
    customer,
    service,
    appointments,
    config
  });

  if (!available.includes(input.startTime)) {
    return {
      ok: false,
      error: "Questo orario non è più disponibile."
    };
  }

  const duration = getEffectiveDuration(customer, service);
  const endTime = minutesToTime(timeToMinutes(input.startTime) + duration);
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `appointment-${now.getTime()}-${appointments.length + 1}`;

  return {
    ok: true,
    idempotent: false,
    appointment: {
      id,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      serviceId: service.id,
      serviceName: service.name,
      date: input.date,
      startTime: input.startTime,
      endTime,
      durationMinutes: duration,
      channel: input.channel,
      status: "confirmed",
      notes: input.notes?.trim() ?? "",
      externalReference: input.externalReference,
      createdAt: now.toISOString()
    }
  };
}

export function assertNoOverlaps(appointments: Appointment[]) {
  const active = appointments.filter(
    (appointment) => appointment.status !== "cancelled"
  );

  for (let first = 0; first < active.length; first += 1) {
    for (let second = first + 1; second < active.length; second += 1) {
      const a = active[first];
      const b = active[second];
      if (
        a.date === b.date &&
        overlaps(
          timeToMinutes(a.startTime),
          timeToMinutes(a.endTime),
          timeToMinutes(b.startTime),
          timeToMinutes(b.endTime)
        )
      ) {
        return false;
      }
    }
  }

  return true;
}

