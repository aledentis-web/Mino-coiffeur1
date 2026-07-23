import type {
  Appointment,
  BusinessConfig,
  Customer,
  Service
} from "./domain";

export const businessConfig: BusinessConfig = {
  name: "Studio Barber 8",
  tagline: "Tagli precisi. Tempo rispettato.",
  address: "Via del Taglio 8, Novara",
  phone: "+39 0321 000 008",
  timezone: "Europe/Rome",
  slotIntervalMinutes: 15,
  openingHours: {
    0: [],
    1: [],
    2: [
      { start: "09:00", end: "12:30" },
      { start: "14:00", end: "19:30" }
    ],
    3: [
      { start: "09:00", end: "12:30" },
      { start: "14:00", end: "19:30" }
    ],
    4: [
      { start: "09:00", end: "12:30" },
      { start: "14:00", end: "19:30" }
    ],
    5: [
      { start: "09:00", end: "12:30" },
      { start: "14:00", end: "19:30" }
    ],
    6: [{ start: "09:00", end: "18:00" }]
  }
};

export const services: Service[] = [
  {
    id: "haircut",
    name: "Taglio",
    description: "Consulenza, taglio e styling finale.",
    durationMinutes: 30,
    price: 25
  },
  {
    id: "beard",
    name: "Barba",
    description: "Regolazione, contorni e finitura.",
    durationMinutes: 20,
    price: 15
  },
  {
    id: "haircut-beard",
    name: "Taglio + barba",
    description: "Il servizio completo, senza fretta.",
    durationMinutes: 45,
    price: 37
  },
  {
    id: "quick-finish",
    name: "Sistemazione",
    description: "Ritocco rapido di contorni e styling.",
    durationMinutes: 15,
    price: 12
  }
];

const firstNames = [
  "Alessandro",
  "Luca",
  "Matteo",
  "Andrea",
  "Marco",
  "Davide",
  "Federico",
  "Simone",
  "Riccardo",
  "Francesco",
  "Gabriele",
  "Stefano",
  "Michele",
  "Tommaso",
  "Pietro",
  "Filippo",
  "Edoardo",
  "Giovanni",
  "Niccolò",
  "Samuele"
];

const lastNames = ["Rossi", "Bianchi", "Ferrari", "Esposito", "Romano"];

export const syntheticCustomers: Customer[] = Array.from(
  { length: 100 },
  (_, index) => {
    const service = services[index % services.length];
    const hasOverride = index % 3 === 0;
    const overrideDelta = index % 2 === 0 ? 10 : -5;
    const duration = Math.max(15, service.durationMinutes + overrideDelta);

    return {
      id: `customer-${String(index + 1).padStart(3, "0")}`,
      name: `${firstNames[index % firstNames.length]} ${
        lastNames[Math.floor(index / firstNames.length) % lastNames.length]
      }`,
      phone: `+39 000 000 ${String(index + 1).padStart(4, "0")}`,
      preferredServiceId: service.id,
      durationOverrides: hasOverride ? { [service.id]: duration } : {},
      notes: hasOverride
        ? `Durata abituale personalizzata: ${duration} minuti.`
        : "Cliente test con durata standard."
    };
  }
);

export function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

export function nextOpenDates(count = 10, from = new Date()) {
  const results: string[] = [];
  const cursor = new Date(from);

  for (let offset = 0; results.length < count && offset < 45; offset += 1) {
    const candidate = new Date(cursor);
    candidate.setDate(cursor.getDate() + offset);
    const ranges = businessConfig.openingHours[candidate.getDay()] ?? [];
    if (ranges.length > 0) {
      results.push(toDateKey(candidate));
    }
  }

  return results;
}

export function createSeedAppointments(): Appointment[] {
  const dates = nextOpenDates(4);
  const seed = [
    { customerIndex: 0, serviceIndex: 0, dateIndex: 0, time: "09:30", channel: "site" },
    { customerIndex: 5, serviceIndex: 2, dateIndex: 0, time: "10:30", channel: "whatsapp" },
    { customerIndex: 17, serviceIndex: 1, dateIndex: 0, time: "14:30", channel: "voice" },
    { customerIndex: 31, serviceIndex: 0, dateIndex: 0, time: "16:00", channel: "manual" },
    { customerIndex: 44, serviceIndex: 2, dateIndex: 1, time: "09:15", channel: "site" },
    { customerIndex: 67, serviceIndex: 0, dateIndex: 1, time: "11:00", channel: "whatsapp" }
  ] as const;

  return seed.map((item, index) => {
    const customer = syntheticCustomers[item.customerIndex];
    const service = services[item.serviceIndex];
    const duration =
      customer.durationOverrides[service.id] ?? service.durationMinutes;
    const [hours, minutes] = item.time.split(":").map(Number);
    const end = hours * 60 + minutes + duration;

    return {
      id: `seed-appointment-${index + 1}`,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      serviceId: service.id,
      serviceName: service.name,
      date: dates[item.dateIndex],
      startTime: item.time,
      endTime: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(
        end % 60
      ).padStart(2, "0")}`,
      durationMinutes: duration,
      channel: item.channel,
      status: "confirmed",
      notes: "Appuntamento demo iniziale.",
      createdAt: new Date().toISOString()
    };
  });
}

