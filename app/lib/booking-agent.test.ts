import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  handleBookingAgentMessage,
  nearestAvailableSlots,
  type BookingAgentInput
} from "./booking-agent.ts";
import type {
  BookingAgentField,
  BookingAgentTurn
} from "./booking-agent-language-helpers.ts";

const NOW = new Date("2026-08-03T10:00:00.000Z");
const PHONE = "+393331234567";
const SERVICES = [
  { name: "Taglio", slug: "haircut", duration_minutes: 30, price_cents: 2500 },
  { name: "Barba", slug: "beard", duration_minutes: 20, price_cents: 1500 }
];

type StoredConversation = {
  state: string;
  context: Record<string, unknown>;
  last_message_sid: string;
  last_response_text: string;
  expires_at: string;
  version: number;
  last_event_order_key: string | null;
};

type StoredEvent = {
  status: "processing" | "processed" | "failed";
  response_text: string | null;
  error_code?: string;
};

class FakeSupabase {
  readonly conversations = new Map<string, StoredConversation>();
  readonly events = new Map<string, StoredEvent>();
  readonly availability = new Map<string, string[]>();
  readonly bookings: Array<Record<string, unknown>> = [];
  readonly bookingReferences = new Set<string>();
  readonly customers = new Map<string, string>();
  readonly saveDelays = new Map<string, number>();
  bookingError: { code: string; message: string } | null = null;
  onBookingError: (() => void) | null = null;

  from(table: string) {
    return new FakeQuery(this, table);
  }

  async rpc(name: string, args: Record<string, unknown>) {
    if (name === "claim_booking_inbound_event") {
      const id = String(args.p_provider_message_id);
      const existing = this.events.get(id);
      if (!existing) {
        this.events.set(id, { status: "processing", response_text: null });
        return { data: [{ claim_status: "claimed", response_text: null }], error: null };
      }
      if (existing.status === "processed") {
        return {
          data: [{ claim_status: "duplicate", response_text: existing.response_text }],
          error: null
        };
      }
      if (existing.status === "processing") {
        return { data: [{ claim_status: "busy", response_text: null }], error: null };
      }
      existing.status = "processing";
      existing.error_code = undefined;
      return { data: [{ claim_status: "claimed", response_text: existing.response_text }], error: null };
    }
    if (name === "get_booking_conversation") {
      const row = this.conversations.get(String(args.p_phone_e164));
      return { data: row ? [structuredClone(row)] : [], error: null };
    }
    if (name === "save_booking_conversation") {
      const id = String(args.p_provider_message_id);
      const delay = this.saveDelays.get(id) ?? 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return this.saveConversation(args);
    }
    if (name === "confirm_booking_conversation") {
      if (this.bookingError) {
        const error = this.bookingError;
        this.bookingError = null;
        this.onBookingError?.();
        this.onBookingError = null;
        return { data: null, error };
      }
      const conflict = this.conversationConflict(args);
      if (conflict) return { data: null, error: conflict };
      const reference = String(args.p_external_reference);
      const idempotent = this.bookingReferences.has(reference);
      if (!idempotent) {
        this.bookingReferences.add(reference);
        this.bookings.push(args);
      }
      const saved = this.saveConversation({
        ...args,
        p_state: "idle",
        p_context: {},
        p_response_text: args.p_response_text
      });
      if (saved.error) return saved;
      return {
        data: [{ appointment_id: "appointment-1", idempotent, new_version: 1 }],
        error: null
      };
    }
    if (name === "complete_booking_inbound_event") {
      const event = this.events.get(String(args.p_provider_message_id))!;
      event.status = "processed";
      event.response_text = String(args.p_response_text);
      return { data: null, error: null };
    }
    if (name === "fail_booking_inbound_event") {
      const event = this.events.get(String(args.p_provider_message_id))!;
      event.status = "failed";
      event.error_code = String(args.p_error_code);
      return { data: null, error: null };
    }
    if (name === "get_public_availability") {
      const key = `${args.p_service_slug}:${args.p_date}`;
      return {
        data: (this.availability.get(key) ?? []).map((slot_time) => ({ slot_time })),
        error: null
      };
    }
    if (name === "create_public_booking") {
      if (this.bookingError) {
        const error = this.bookingError;
        this.bookingError = null;
        return { data: null, error };
      }
      this.bookings.push(args);
      return { data: [{ appointment_id: "appointment-1" }], error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  }

  private conversationConflict(args: Record<string, unknown>) {
    const row = this.conversations.get(String(args.p_phone_e164));
    const expected = Number(args.p_expected_version);
    if ((row?.version ?? 0) !== expected) {
      return { code: "40001", message: "BOOKING_CONVERSATION_VERSION_CONFLICT" };
    }
    if (
      row?.last_event_order_key &&
      String(args.p_event_order_key) <= row.last_event_order_key
    ) {
      return { code: "22000", message: "BOOKING_CONVERSATION_STALE_EVENT" };
    }
    return null;
  }

  private saveConversation(args: Record<string, unknown>) {
    const conflict = this.conversationConflict(args);
    if (conflict) return { data: null, error: conflict };
    const phone = String(args.p_phone_e164);
    const current = this.conversations.get(phone);
    const response = String(args.p_response_text);
    this.conversations.set(phone, {
      state: String(args.p_state),
      context: structuredClone(args.p_context as Record<string, unknown>),
      last_message_sid: String(args.p_provider_message_id),
      last_response_text: response,
      expires_at: String(args.p_expires_at),
      version: (current?.version ?? 0) + 1,
      last_event_order_key: String(args.p_event_order_key)
    });
    const event = this.events.get(String(args.p_provider_message_id))!;
    event.status = "processed";
    event.response_text = response;
    return { data: (current?.version ?? 0) + 1, error: null };
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
  select() { return this; }
  update() { return this; }
  eq(column: string, value: unknown) { this.filters.set(column, value); return this; }
  async single() {
    if (this.table === "businesses") return { data: { id: "business-1" }, error: null };
    throw new Error(`Unexpected single on ${this.table}`);
  }
  async maybeSingle() {
    if (this.table === "whatsapp_conversations") {
      return { data: this.db.conversations.get(String(this.filters.get("phone_e164"))) ?? null, error: null };
    }
    if (this.table === "customers") {
      const name = this.db.customers.get(String(this.filters.get("phone_e164")));
      return { data: name ? { name } : null, error: null };
    }
    throw new Error(`Unexpected maybeSingle on ${this.table}`);
  }
  async order() {
    if (this.table === "services") return { data: SERVICES, error: null };
    throw new Error(`Unexpected order on ${this.table}`);
  }
  async upsert(value: Record<string, unknown>) {
    const phone = String(value.phone_e164);
    const current = this.db.conversations.get(phone);
    this.db.conversations.set(phone, {
      state: String(value.state),
      context: value.context as Record<string, unknown>,
      last_message_sid: String(value.last_message_sid),
      last_response_text: String(value.last_response_text),
      expires_at: String(value.expires_at),
      version: (current?.version ?? 0) + 1,
      last_event_order_key: null
    });
    return { data: value, error: null };
  }
}

const field = (status: BookingAgentField<string>["status"], value: string | null = null) => ({ status, value });
const none = () => field("not_mentioned");
const valid = (value: string) => field("valid", value);
const invalid = () => field("invalid");

function asClient(db: FakeSupabase) {
  return db as unknown as SupabaseClient;
}

function input(
  db: FakeSupabase,
  messageId: string,
  body: string,
  occurredAt = NOW
): BookingAgentInput {
  return {
    supabase: asClient(db),
    businessSlug: "studio-barber-8",
    resourceSlug: "main",
    phoneE164: PHONE,
    body,
    messageSid: messageId,
    bookingChannel: "whatsapp",
    externalReferencePrefix: "meta",
    now: NOW,
    occurredAt
  };
}

function completeTurn(overrides: Partial<BookingAgentTurn> = {}): BookingAgentTurn {
  return {
    intent: "booking",
    service: valid("haircut"),
    date: valid("2026-08-04"),
    time: valid("10:00"),
    name: valid("Mario Rossi"),
    confirmation: "none",
    ...overrides
  };
}

function confirmationTurn(): BookingAgentTurn {
  return {
    intent: "booking",
    service: none(),
    date: none(),
    time: none(),
    name: none(),
    confirmation: "confirm"
  };
}

async function startCompleteConversation(db: FakeSupabase, id = "message-1") {
  db.availability.set("haircut:2026-08-04", ["10:00", "11:00"]);
  return handleBookingAgentMessage(input(db, id, "richiesta completa"), {
    interpretTurn: async () => completeTurn()
  });
}

test("propone gli slot reali più vicini a quello richiesto", () => {
  assert.deepEqual(
    nearestAvailableSlots(["09:00", "09:30", "10:30", "11:00"], "10:00", 3),
    ["09:30", "10:30", "09:00"]
  );
});

test("comprende servizio, data, ora e nome nella stessa frase", async () => {
  const db = new FakeSupabase();
  await startCompleteConversation(db);
  const stored = db.conversations.get(PHONE)!;
  assert.equal(stored.state, "awaiting_confirmation");
  assert.equal(stored.context.serviceSlug, "haircut");
  assert.equal(stored.context.customerName, "Mario Rossi");
  assert.equal(stored.context.confirmationPending, true);
  assert.equal(db.bookings.length, 0);
});

for (const [label, override] of [
  ["servizio", { service: invalid() }],
  ["data", { date: invalid() }],
  ["orario", { time: invalid() }],
  ["nome", { name: invalid() }]
] as const) {
  test(`una correzione ${label} non valida conserva il contesto completo`, async () => {
    const db = new FakeSupabase();
    await startCompleteConversation(db);
    const before = structuredClone(db.conversations.get(PHONE)!.context);
    const invalidCorrection: Partial<BookingAgentTurn> = {
      service: none(), date: none(), time: none(), name: none()
    };
    Object.assign(invalidCorrection, override);
    const result = await handleBookingAgentMessage(input(db, `invalid-${label}`, "correzione incomprensibile", new Date("2026-08-03T10:01:00Z")), {
      interpretTurn: async () => completeTurn(invalidCorrection)
    });
    assert.match(result.response, /Non ho capito/);
    assert.deepEqual(db.conversations.get(PHONE)!.context, before);
  });
}

test("rifiutare il riepilogo chiede cosa cambiare senza cancellare il contesto", async () => {
  const db = new FakeSupabase();
  await startCompleteConversation(db);
  const result = await handleBookingAgentMessage(input(db, "message-2", "No", new Date("2026-08-03T10:01:00Z")), {
    interpretTurn: async () => ({ ...confirmationTurn(), confirmation: "reject" })
  });
  assert.match(result.response, /Cosa vuoi cambiare/);
  assert.equal(db.conversations.get(PHONE)!.context.serviceSlug, "haircut");
  assert.equal(db.bookings.length, 0);
});

test("una correzione dopo il riepilogo genera un nuovo riepilogo", async () => {
  const db = new FakeSupabase();
  await startCompleteConversation(db);
  const result = await handleBookingAgentMessage(input(db, "message-2", "Anzi alle 11", new Date("2026-08-03T10:01:00Z")), {
    interpretTurn: async () => completeTurn({ service: none(), date: none(), time: valid("11:00"), name: none() })
  });
  assert.match(result.response, /Ti riepilogo/);
  assert.match(result.response, /11:00/);
});

test("una giornata piena cerca e propone giorni alternativi reali", async () => {
  const db = new FakeSupabase();
  db.availability.set("haircut:2026-08-06", ["09:30"]);
  db.availability.set("haircut:2026-08-08", ["11:00"]);
  const result = await handleBookingAgentMessage(input(db, "message-1", "richiesta completa"), {
    interpretTurn: async () => completeTurn()
  });
  assert.match(result.response, /Non risultano orari liberi/);
  assert.match(result.response, /6 agosto/);
  assert.match(result.response, /8 agosto/);
});

test("una conversazione scaduta non riutilizza il vecchio contesto", async () => {
  const db = new FakeSupabase();
  db.conversations.set(PHONE, {
    state: "awaiting_confirmation",
    context: { serviceSlug: "haircut", date: "2026-08-04", startTime: "10:00", customerName: "Mario" },
    last_message_sid: "old",
    last_response_text: "old",
    expires_at: "2026-08-02T10:00:00.000Z",
    version: 4,
    last_event_order_key: "2026-08-02T10:00:00.000Z|old"
  });
  const result = await handleBookingAgentMessage(input(db, "new", "ciao"), {
    interpretTurn: async () => ({ ...confirmationTurn(), confirmation: "none", intent: "other" })
  });
  assert.match(result.response, /Dimmi pure servizio/);
  assert.deepEqual(db.conversations.get(PHONE)!.context, {});
});

test("un webhook duplicato restituisce la risposta memorizzata senza rielaborare", async () => {
  const db = new FakeSupabase();
  let interpretations = 0;
  const deps = { interpretTurn: async () => { interpretations += 1; return completeTurn(); } };
  const first = await handleBookingAgentMessage(input(db, "same", "richiesta"), deps);
  const duplicate = await handleBookingAgentMessage(input(db, "same", "richiesta"), deps);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.response, first.response);
  assert.equal(interpretations, 1);
});

test("il retry di un messaggio precedente dopo uno successivo non riscrive il contesto", async () => {
  const db = new FakeSupabase();
  await startCompleteConversation(db, "old-message");
  await handleBookingAgentMessage(input(db, "new-message", "Anzi alle 11", new Date("2026-08-03T10:02:00Z")), {
    interpretTurn: async () => completeTurn({ service: none(), date: none(), time: valid("11:00"), name: none() })
  });
  const version = db.conversations.get(PHONE)!.version;
  const retry = await handleBookingAgentMessage(input(db, "old-message", "richiesta completa"), {
    interpretTurn: async () => { throw new Error("non deve essere richiamato"); }
  });
  assert.equal(retry.duplicate, true);
  assert.equal(db.conversations.get(PHONE)!.version, version);
  assert.equal(db.conversations.get(PHONE)!.context.startTime, "11:00");
});

test("un messaggio fuori ordine mai visto viene registrato ma non muta la conversazione", async () => {
  const db = new FakeSupabase();
  await handleBookingAgentMessage(input(db, "newer", "taglio", new Date("2026-08-03T10:02:00Z")), {
    interpretTurn: async () => completeTurn({ date: none(), time: none(), name: none() })
  });
  const result = await handleBookingAgentMessage(input(db, "older", "barba", new Date("2026-08-03T10:01:00Z")), {
    interpretTurn: async () => completeTurn({ service: valid("beard"), date: none(), time: none(), name: none() })
  });
  assert.equal(result.duplicate, true);
  assert.equal(db.conversations.get(PHONE)!.context.serviceSlug, "haircut");
  assert.equal(db.events.get("older")!.status, "processed");
});

test("due messaggi concorrenti usano il retry CAS senza perdere aggiornamenti", async () => {
  const db = new FakeSupabase();
  db.saveDelays.set("second", 20);
  const first = handleBookingAgentMessage(input(db, "first", "taglio", new Date("2026-08-03T10:01:00Z")), {
    interpretTurn: async () => completeTurn({ date: none(), time: none(), name: none() })
  });
  const second = handleBookingAgentMessage(input(db, "second", "domani", new Date("2026-08-03T10:02:00Z")), {
    interpretTurn: async () => completeTurn({ service: none(), time: none(), name: none() })
  });
  await Promise.all([first, second]);
  const context = db.conversations.get(PHONE)!.context;
  assert.equal(context.serviceSlug, "haircut");
  assert.equal(context.date, "2026-08-04");
  assert.equal(db.conversations.get(PHONE)!.version, 2);
});

test("OpenAI, fallback deterministico e OpenAI condividono il contesto senza duplicati", async () => {
  const db = new FakeSupabase();
  await startCompleteConversation(db);
  const fallbackResult = await handleBookingAgentMessage(input(db, "message-2", "Anzi alle 11", new Date("2026-08-03T10:01:00Z")), {
    interpretTurn: async () => null
  });
  assert.match(fallbackResult.response, /11:00/);
  const confirmed = await handleBookingAgentMessage(input(db, "message-3", "Sì", new Date("2026-08-03T10:02:00Z")), {
    interpretTurn: async () => confirmationTurn()
  });
  assert.match(confirmed.response, /Appuntamento confermato/);
  assert.equal(db.bookings.length, 1);
});

test("uno slot occupato tra riepilogo e conferma propone alternative", async () => {
  const db = new FakeSupabase();
  await startCompleteConversation(db);
  db.bookingError = { code: "23P01", message: "SLOT_NOT_AVAILABLE" };
  db.onBookingError = () => {
    db.availability.set("haircut:2026-08-04", ["11:00"]);
  };
  const result = await handleBookingAgentMessage(input(db, "message-2", "Sì", new Date("2026-08-03T10:01:00Z")), {
    interpretTurn: async () => confirmationTurn()
  });
  assert.match(result.response, /appena occupato/);
  assert.match(result.response, /11:00/);
  assert.equal(db.bookings.length, 0);
});

test("un errore della RPC di creazione lascia il riepilogo intatto e l'evento failed", async () => {
  const db = new FakeSupabase();
  await startCompleteConversation(db);
  db.bookingError = { code: "XX000", message: "database unavailable" };
  await assert.rejects(
    handleBookingAgentMessage(input(db, "message-2", "Sì", new Date("2026-08-03T10:01:00Z")), {
      interpretTurn: async () => confirmationTurn()
    }),
    /BOOKING_AGENT_BOOKING_FAILED:XX000/
  );
  assert.equal(db.conversations.get(PHONE)!.state, "awaiting_confirmation");
  assert.equal(db.events.get("message-2")!.status, "failed");
});

test("la conferma è idempotente sul provider_message_id", async () => {
  const db = new FakeSupabase();
  await startCompleteConversation(db);
  const deps = { interpretTurn: async () => confirmationTurn() };
  await handleBookingAgentMessage(input(db, "confirm-1", "Sì", new Date("2026-08-03T10:01:00Z")), deps);
  const duplicate = await handleBookingAgentMessage(input(db, "confirm-1", "Sì", new Date("2026-08-03T10:01:00Z")), deps);
  assert.equal(duplicate.duplicate, true);
  assert.equal(db.bookings.length, 1);
});

test("abbandonare il flusso cancella solo la richiesta in corso", async () => {
  const db = new FakeSupabase();
  await startCompleteConversation(db);
  const result = await handleBookingAgentMessage(input(db, "abort", "Lascia perdere", new Date("2026-08-03T10:01:00Z")), {
    interpretTurn: async () => ({ ...confirmationTurn(), confirmation: "none", intent: "abort_booking" })
  });
  assert.match(result.response, /abbandonato la richiesta/);
  assert.deepEqual(db.conversations.get(PHONE)!.context, {});
});

test("cancellare un appuntamento esistente non finge una cancellazione", async () => {
  const db = new FakeSupabase();
  await startCompleteConversation(db);
  const before = structuredClone(db.conversations.get(PHONE)!.context);
  const result = await handleBookingAgentMessage(input(db, "cancel-existing", "Cancella il mio appuntamento", new Date("2026-08-03T10:01:00Z")), {
    interpretTurn: async () => ({ ...confirmationTurn(), confirmation: "none", intent: "cancel_existing_booking" })
  });
  assert.match(result.response, /Contatta direttamente il negozio/);
  assert.doesNotMatch(result.response, /passo all.operatore/i);
  assert.match(result.response, /non ho modificato né cancellato/);
  assert.deepEqual(db.conversations.get(PHONE)!.context, before);
  assert.equal(db.bookings.length, 0);
});
