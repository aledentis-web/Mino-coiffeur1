export type BookingStatus = "In attesa di conferma" | "Confermata" | "Rifiutata";

export type Service = {
  id: string;
  name: string;
  price: number;
  description: string;
};

export type BookingRequest = {
  id: string;
  serviceId: string;
  serviceName: string;
  price: number;
  date: string;
  time: string;
  customerName: string;
  phone: string;
  notes: string;
  status: BookingStatus;
  createdAt: string;
};

export const STORAGE_KEY = "mino-coiffeur-demo-bookings";

export const services: Service[] = [
  {
    id: "taglio-uomo",
    name: "Taglio uomo",
    price: 25,
    description: "Taglio curato e rifinitura finale."
  },
  {
    id: "barba",
    name: "Barba",
    price: 15,
    description: "Rasatura, contorni e ordine."
  },
  {
    id: "taglio-barba",
    name: "Taglio + barba",
    price: 35,
    description: "Il servizio completo più richiesto."
  },
  {
    id: "sistemazione",
    name: "Sistemazione veloce",
    price: 10,
    description: "Ritocco rapido per essere in ordine."
  }
];

const weekdays = new Intl.DateTimeFormat("it-IT", { weekday: "long" });
const longDate = new Intl.DateTimeFormat("it-IT", {
  weekday: "long",
  day: "2-digit",
  month: "long"
});

export function formatPrice(price: number) {
  return `${price}€`;
}

export function readableDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return longDate.format(new Date(year, month - 1, day));
}

export function makeDateOptions() {
  const dates: { key: string; label: string; hint: string }[] = [];
  const today = new Date();

  for (let offset = 0; dates.length < 10 && offset < 24; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + offset);

    if (!isOpenDay(date)) {
      continue;
    }

    dates.push({
      key: toDateKey(date),
      label: offset === 0 ? "Oggi" : longDate.format(date),
      hint: weekdays.format(date)
    });
  }

  return dates;
}

export function makeSlots() {
  const slotMinutes = 20;
  const ranges = [
    { start: 8 * 60, end: 12 * 60 + 30 },
    { start: 13 * 60 + 30, end: 19 * 60 }
  ];

  return ranges.flatMap((range) => {
    const slots: string[] = [];
    for (let minute = range.start; minute + slotMinutes <= range.end; minute += slotMinutes) {
      slots.push(minutesToTime(minute));
    }
    return slots;
  });
}

export function loadBookings(): BookingRequest[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isOpenDay(date: Date) {
  const day = date.getDay();
  return day >= 2 && day <= 6;
}

function minutesToTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
