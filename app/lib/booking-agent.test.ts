import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  handleBookingAgentMessage,
  nearestAvailableSlots,
  type BookingAgentInput
} from "./booking-agent.ts";
import type { BookingAgentTurn } from "./booking-agent-language-helpers.ts";

const NOW = new Date("2026-08-03T10:00:00.000Z");
const PHONE = "+393331234567";
const SERVICES = [
  {
    name: "Taglio",
    slug: "haircut",
    duration_minutes: 30,
    price_cents: 2500
  },
  {
    name: "Barba",
    slug: "beard",
    duration_minutes: 20,
    price_cents: 1500
  }
];

type Result<T = unknown> = { data: T; error: null };
type StoredConversation = {
  state: string;
  context: Record<string, unknown>;
  last_message_sid: string;
  last_response_text: string;
  expires_at: string;
};

class FakeSupabase {
  readonly conversations = new Map<string, StoredConversation>();
  readonly availability = new Map<string, string[]>();
  readonly bookings: Array<Record<string, unknown>> = [];
  readonly customers = new Map<string, string>();

  from(table: string) {
    return new FakeQuery(this, table);
  }

  async rpc(name: string, args: Record<string, unknown>) {
    if (name === "get_public_availability") {
      const key = `${args.p_service_slug}:${args.p_date}`;
      return {
        data: (this.availability.get(key) ?? []).map((slot_time) => ({
          slot_time
        })),
        error: null
      };
    }
    if (name === "create_public_booking") {
      this.bookings.push(args);
      return { data: [{ appointment_id: "appointment-1" }], error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  }
}

class FakeQuery {
  private readonly filters = new Map<string, unknown>();
  private readonly db: FakeSupabase;
  private readonly table: string;

  constructor(db: FakeSupabase, table: string) {
    this.db = db;
    this.table = table;
  }

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.set(column, value);
    return this;
  }

  async single(): Promise<Result> {
    if (this.table === "businesses") return { data: { id: "business-1" }, error: null };
    throw new Error(`Unexpected single on ${this.table}`);
  }

  async maybeSingle(): Promise<Result> {
    if (this.table === "whatsapp_conversations") {
      return {
        data: this.db.conversations.get(String(this.filters.get("phone_e164"))) ?? null,
        error: null
      };
    }
    if (this.table === "customers") {
      const name = this.db.customers.get(String(this.filters.get("phone_e164")));
      return { data: name ? { name } : null, error: null };
    }
    throw new Error(`Unexpected maybeSingle on ${this.table}`);
  }

  async order(): Promise<Result> {
    if (this.table === "services") return { data: SERVICES, error: null };
    throw new Error(`Unexpected order on ${this.table}`);
  }

  async upsert(value: Record<string, unknown>): Promise<Result> {
    if (this.table !== "whatsapp_conversations") {
      throw new Error(`Unexpected upsert on ${this.table}`);
    }
    this.db.conversations.set(String(value.phone_e164), {
      state: String(value.state),
      context: value.context as Record<string, unknown>,
      last_message_sid: String(value.last_message_sid),
      last_response_text: String(value.last_response_text),
      expires_at: String(value.expires_at)
    });
    return { data: value, error: null };
  }
}

function asClient(db: FakeSupabase) {
  return db as unknown as SupabaseClient;
}

function input(db: FakeSupabase, messageId: string, body: string): BookingAgentInput {
  return {
    supabase: asClient(db),
    businessSlug: "studio-barber-8",
    resourceSlug: "main",
    phoneE164: PHONE,
    body,
    messageSid: messageId,
    bookingChannel: "whatsapp",
    externalReferencePrefix: "meta",
    now: NOW
  };
}

function completeTurn(overrides: Partial<BookingAgentTurn> = {}): BookingAgentTurn {
  return {
    intent: "booking",
    serviceSlug: "haircut",
    date: "2026-08-04",
    requestedTime: "10:00",
    customerName: "Mario Rossi",
    confirmation: "none",
    mentioned: { service: true, date: true, time: true, name: true },
    ...overrides
  };
}

test("propone gli slot reali più vicini a quello richiesto", () => {
  assert.deepEqual(
    nearestAvailableSlots(["09:00", "09:30", "10:30", "11:00"], "10:00", 3),
    ["09:30", "10:30", "09:00"]
  );
});

test("comprende servizio, data, ora e nome nella stessa frase", async () => {
  const db = new FakeSupabase();
  db.availability.set("haircut:2026-08-04", ["09:30", "10:00", "10:30"]);

  const result = await handleBookingAgentMessage(
    input(db, "meta:message-1", "Taglio domani alle 10, sono Mario Rossi"),
    { interpretTurn: async () => completeTurn() }
  );

  assert.match(result.response, /Ti riepilogo/);
  assert.match(result.response, /Taglio/);
  assert.match(result.response, /10:00/);
  const stored = db.conversations.get(PHONE)!;
  assert.equal(stored.state, "awaiting_confirmation");
  assert.equal(stored.context.serviceSlug, "haircut");
  assert.equal(stored.context.customerName, "Mario Rossi");
  assert.equal(stored.context.confirmationPending, true);
  assert.equal(db.bookings.length, 0);
});

test("applica una correzione naturale senza perdere gli altri dati", async () => {
  const db = new FakeSupabase();
  db.availability.set("haircut:2026-08-04", ["10:00"]);
  db.availability.set("beard:2026-08-04", ["10:00", "11:00"]);

  await handleBookingAgentMessage(input(db, "message-1", "prima richiesta"), {
    interpretTurn: async () => completeTurn()
  });
  const correction = completeTurn({
    serviceSlug: "beard",
    date: null,
    requestedTime: "11:00",
    customerName: null,
    mentioned: { service: true, date: false, time: true, name: false }
  });
  const result = await handleBookingAgentMessage(
    input(db, "message-2", "Anzi barba alle 11"),
    { interpretTurn: async () => correction }
  );

  assert.match(result.response, /Barba/);
  assert.match(result.response, /11:00/);
  const stored = db.conversations.get(PHONE)!;
  assert.equal(stored.context.date, "2026-08-04");
  assert.equal(stored.context.customerName, "Mario Rossi");
  assert.equal(stored.context.serviceSlug, "beard");
});

test("non accetta un orario occupato e propone alternative reali", async () => {
  const db = new FakeSupabase();
  db.availability.set("haircut:2026-08-04", ["09:30", "10:30", "11:00"]);

  const result = await handleBookingAgentMessage(
    input(db, "message-1", "Taglio domani alle 10, Mario Rossi"),
    { interpretTurn: async () => completeTurn() }
  );

  assert.match(result.response, /10:00 non è libero/);
  assert.match(result.response, /09:30/);
  assert.match(result.response, /10:30/);
  assert.equal(db.conversations.get(PHONE)?.state, "awaiting_slot");
});

test("crea la prenotazione soltanto dopo il riepilogo e un sì esplicito", async () => {
  const db = new FakeSupabase();
  db.availability.set("haircut:2026-08-04", ["10:00"]);

  await handleBookingAgentMessage(input(db, "message-1", "richiesta completa"), {
    interpretTurn: async () => completeTurn()
  });
  const confirmation = completeTurn({
    serviceSlug: null,
    date: null,
    requestedTime: null,
    customerName: null,
    confirmation: "confirm",
    mentioned: { service: false, date: false, time: false, name: false }
  });
  const result = await handleBookingAgentMessage(input(db, "message-2", "Sì, confermo"), {
    interpretTurn: async () => confirmation
  });

  assert.match(result.response, /Appuntamento confermato/);
  assert.equal(db.bookings.length, 1);
  assert.equal(db.bookings[0].p_channel, "whatsapp");
  assert.equal(db.bookings[0].p_start_time, "10:00");
  assert.equal(db.conversations.get(PHONE)?.state, "idle");
});

test("usa il vecchio assistente quando OpenAI non restituisce un turno valido", async () => {
  const db = new FakeSupabase();
  let fallbackCalled = false;
  const result = await handleBookingAgentMessage(input(db, "message-1", "PRENOTA"), {
    interpretTurn: async () => null,
    fallback: async () => {
      fallbackCalled = true;
      return { response: "fallback sicuro", duplicate: false };
    }
  });

  assert.equal(fallbackCalled, true);
  assert.equal(result.response, "fallback sicuro");
});
