import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookingChannel } from "./domain";
import { interpretDeterministicBookingTurn } from "./booking-agent-fallback.ts";
import { interpretBookingAgentTurn } from "./booking-agent-language.ts";
import {
  invalidBookingFields,
  turnChangesBooking,
  type BookingAgentTurn
} from "./booking-agent-language-helpers.ts";
import type { ServiceOption } from "./whatsapp-assistant-helpers";

type ConversationState =
  | "idle"
  | "awaiting_service"
  | "awaiting_date"
  | "awaiting_slot"
  | "awaiting_name"
  | "awaiting_confirmation";

export type BookingAgentContext = {
  serviceSlug?: string;
  serviceName?: string;
  date?: string;
  availableSlots?: string[];
  requestedTime?: string;
  startTime?: string;
  customerName?: string;
  confirmationPending?: boolean;
};

type ConversationRow = {
  state: ConversationState;
  context: BookingAgentContext | null;
  last_message_sid: string | null;
  last_response_text: string | null;
  expires_at: string;
  version: number;
  last_event_order_key: string | null;
};

type AvailabilitySlot = { slot_time: string };

export type BookingAgentInput = {
  supabase: SupabaseClient;
  businessSlug: string;
  resourceSlug: string;
  phoneE164: string;
  body: string;
  messageSid: string;
  bookingChannel?: Extract<BookingChannel, "whatsapp" | "voice">;
  externalReferencePrefix?: "meta" | "assistant" | "voice";
  occurredAt?: Date;
  now?: Date;
};

export type BookingAgentResult = {
  response: string;
  duplicate: boolean;
};

type BookingAgentDependencies = {
  interpretTurn?: typeof interpretBookingAgentTurn;
  interpretFallbackTurn?: typeof interpretDeterministicBookingTurn;
};

type EventClaim =
  | { mode: "legacy" }
  | { mode: "durable"; status: "claimed" }
  | { mode: "durable"; status: "duplicate" | "busy"; response: string };

const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_VISIBLE_SLOTS = 8;
const ALTERNATIVE_DAY_LOOKAHEAD = 7;
const MAX_CONVERSATION_RETRIES = 3;

class ConversationConflictError extends Error {}
class StaleConversationEventError extends Error {}

function formatItalianDate(date: string) {
  return new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Rome"
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function formatServiceList(services: ServiceOption[]) {
  return services
    .map((service, index) => {
      const price = new Intl.NumberFormat("it-IT", {
        style: "currency",
        currency: "EUR"
      }).format(service.price_cents / 100);
      return `${index + 1}. ${service.name} · ${service.duration_minutes} min · ${price}`;
    })
    .join("\n");
}

function formatSlotList(slots: string[]) {
  return slots.slice(0, MAX_VISIBLE_SLOTS).join(", ");
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function minutesFromTime(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function nearestAvailableSlots(
  slots: string[],
  requestedTime: string,
  limit = 4
) {
  const requestedMinutes = minutesFromTime(requestedTime);
  return [...slots]
    .sort((left, right) => {
      const leftDistance = Math.abs(minutesFromTime(left) - requestedMinutes);
      const rightDistance = Math.abs(minutesFromTime(right) - requestedMinutes);
      return leftDistance - rightDistance || left.localeCompare(right);
    })
    .slice(0, limit);
}

function isExpired(expiresAt: string, now: Date) {
  const timestamp = Date.parse(expiresAt);
  return Number.isNaN(timestamp) || timestamp <= now.getTime();
}

function contextHasValues(context: BookingAgentContext) {
  return Boolean(
    context.serviceSlug ||
      context.date ||
      context.requestedTime ||
      context.startTime ||
      context.customerName
  );
}

function stateForContext(context: BookingAgentContext): ConversationState {
  if (!context.serviceSlug) return "awaiting_service";
  if (!context.date) return "awaiting_date";
  if (!context.startTime) return "awaiting_slot";
  if (!context.customerName) return "awaiting_name";
  return "awaiting_confirmation";
}

export function mergeBookingAgentContext({
  current,
  turn,
  services,
  knownCustomerName
}: {
  current: BookingAgentContext;
  turn: BookingAgentTurn;
  services: ServiceOption[];
  knownCustomerName?: string;
}) {
  const next: BookingAgentContext = { ...current };
  if (turnChangesBooking(turn)) next.confirmationPending = false;

  if (turn.service.status === "valid") {
    const service = services.find((item) => item.slug === turn.service.value)!;
    const serviceChanged = next.serviceSlug !== service.slug;
    const previousTime = next.startTime;
    next.serviceSlug = service.slug;
    next.serviceName = service.name;
    if (serviceChanged) {
      if (turn.time.status !== "valid" && previousTime) {
        next.requestedTime = previousTime;
      }
      next.startTime = undefined;
      next.availableSlots = undefined;
    }
  }

  if (turn.date.status === "valid") {
    const dateChanged = next.date !== turn.date.value;
    const previousTime = next.startTime;
    next.date = turn.date.value!;
    if (dateChanged) {
      if (turn.time.status !== "valid" && previousTime) {
        next.requestedTime = previousTime;
      }
      next.startTime = undefined;
      next.availableSlots = undefined;
    }
  }

  if (turn.time.status === "valid") {
    next.requestedTime = turn.time.value!;
    next.startTime = undefined;
  }

  if (turn.name.status === "valid") {
    next.customerName = turn.name.value!;
  } else if (!next.customerName && knownCustomerName) {
    next.customerName = knownCustomerName;
  }

  return next;
}

function isRpcUnavailable(error: { code?: string; message?: string } | null) {
  return Boolean(
    error &&
      (error.code === "PGRST202" ||
        error.code === "42883" ||
        /function .* does not exist|schema cache/i.test(error.message ?? ""))
  );
}

function mapConcurrencyError(error: { code?: string; message?: string }) {
  if (
    error.code === "40001" ||
    /BOOKING_CONVERSATION_VERSION_CONFLICT/.test(error.message ?? "")
  ) {
    return new ConversationConflictError();
  }
  if (/BOOKING_CONVERSATION_STALE_EVENT/.test(error.message ?? "")) {
    return new StaleConversationEventError();
  }
  return null;
}

async function claimInboundEvent({
  input,
  businessId,
  occurredAt
}: {
  input: BookingAgentInput;
  businessId: string;
  occurredAt: Date;
}): Promise<EventClaim> {
  const { data, error } = await input.supabase.rpc("claim_booking_inbound_event", {
    p_provider_message_id: input.messageSid,
    p_business_id: businessId,
    p_phone_e164: input.phoneE164,
    p_channel: input.bookingChannel ?? "whatsapp",
    p_provider_occurred_at: occurredAt.toISOString()
  });
  if (isRpcUnavailable(error)) return { mode: "legacy" };
  if (error) throw new Error(`BOOKING_AGENT_EVENT_CLAIM_FAILED:${error.code}`);
  const row = Array.isArray(data) ? data[0] : data;
  const status = row?.claim_status;
  if (status === "claimed") return { mode: "durable", status };
  if (status === "duplicate" || status === "busy") {
    return {
      mode: "durable",
      status,
      response: typeof row?.response_text === "string" ? row.response_text : ""
    };
  }
  throw new Error("BOOKING_AGENT_EVENT_CLAIM_FAILED:EMPTY");
}

async function failInboundEvent(input: BookingAgentInput, claim: EventClaim, error: unknown) {
  if (claim.mode !== "durable" || claim.status !== "claimed") return;
  const failureCode = error instanceof Error ? error.message.split(":")[0] : "UNKNOWN";
  const { error: rpcError } = await input.supabase.rpc("fail_booking_inbound_event", {
    p_provider_message_id: input.messageSid,
    p_error_code: failureCode.slice(0, 80)
  });
  if (rpcError) {
    console.error("booking_agent_event_failure_record_failed", {
      messageId: input.messageSid,
      code: rpcError.code
    });
  }
}

async function loadConversation({
  input,
  businessId,
  durable
}: {
  input: BookingAgentInput;
  businessId: string;
  durable: boolean;
}) {
  if (durable) {
    const { data, error } = await input.supabase.rpc("get_booking_conversation", {
      p_business_id: businessId,
      p_phone_e164: input.phoneE164
    });
    if (error) {
      throw new Error(`BOOKING_AGENT_CONVERSATION_READ_FAILED:${error.code}`);
    }
    const row = Array.isArray(data) ? data[0] : data;
    return (row ?? null) as ConversationRow | null;
  }

  const { data, error } = await input.supabase
    .from("whatsapp_conversations")
    .select("state, context, last_message_sid, last_response_text, expires_at")
    .eq("business_id", businessId)
    .eq("phone_e164", input.phoneE164)
    .maybeSingle();
  if (error) throw new Error(`BOOKING_AGENT_CONVERSATION_READ_FAILED:${error.code}`);
  if (!data) return null;
  return { ...(data as Omit<ConversationRow, "version" | "last_event_order_key">), version: 0, last_event_order_key: null };
}

async function saveConversation({
  input,
  businessId,
  expectedVersion,
  eventOrderKey,
  durable,
  state,
  context,
  response,
  now
}: {
  input: BookingAgentInput;
  businessId: string;
  expectedVersion: number;
  eventOrderKey: string;
  durable: boolean;
  state: ConversationState;
  context: BookingAgentContext;
  response: string;
  now: Date;
}) {
  const expiresAt = new Date(now.getTime() + CONVERSATION_TTL_MS).toISOString();
  if (durable) {
    const { error } = await input.supabase.rpc("save_booking_conversation", {
      p_business_id: businessId,
      p_phone_e164: input.phoneE164,
      p_expected_version: expectedVersion,
      p_event_order_key: eventOrderKey,
      p_state: state,
      p_context: context,
      p_provider_message_id: input.messageSid,
      p_response_text: response,
      p_expires_at: expiresAt
    });
    if (error) {
      const concurrencyError = mapConcurrencyError(error);
      if (concurrencyError) throw concurrencyError;
      throw new Error(`BOOKING_AGENT_CONVERSATION_SAVE_FAILED:${error.code}`);
    }
  } else {
    const { error } = await input.supabase.from("whatsapp_conversations").upsert(
      {
        business_id: businessId,
        phone_e164: input.phoneE164,
        state,
        context,
        last_message_sid: input.messageSid,
        last_response_text: response,
        expires_at: expiresAt
      },
      { onConflict: "business_id,phone_e164" }
    );
    if (error) throw new Error(`BOOKING_AGENT_CONVERSATION_SAVE_FAILED:${error.code}`);
  }
  return { response, duplicate: false } satisfies BookingAgentResult;
}

async function completeStaleEvent(
  input: BookingAgentInput,
  response: string
): Promise<BookingAgentResult> {
  const { error } = await input.supabase.rpc("complete_booking_inbound_event", {
    p_provider_message_id: input.messageSid,
    p_response_text: response
  });
  if (error) throw new Error(`BOOKING_AGENT_EVENT_COMPLETE_FAILED:${error.code}`);
  return { response, duplicate: true };
}

async function getAvailability({
  supabase,
  businessSlug,
  resourceSlug,
  serviceSlug,
  date,
  phoneE164
}: {
  supabase: SupabaseClient;
  businessSlug: string;
  resourceSlug: string;
  serviceSlug: string;
  date: string;
  phoneE164: string;
}) {
  const { data, error } = await supabase.rpc("get_public_availability", {
    p_business_slug: businessSlug,
    p_service_slug: serviceSlug,
    p_date: date,
    p_phone_e164: phoneE164,
    p_resource_slug: resourceSlug
  });
  if (error) throw new Error(`BOOKING_AGENT_AVAILABILITY_FAILED:${error.code}`);
  return ((data ?? []) as AvailabilitySlot[]).map((slot) => slot.slot_time);
}

async function findAlternativeDays({
  input,
  serviceSlug,
  date
}: {
  input: BookingAgentInput;
  serviceSlug: string;
  date: string;
}) {
  const alternatives: Array<{ date: string; slots: string[] }> = [];
  for (let offset = 1; offset <= ALTERNATIVE_DAY_LOOKAHEAD; offset += 1) {
    const candidateDate = addDays(date, offset);
    const slots = await getAvailability({
      supabase: input.supabase,
      businessSlug: input.businessSlug,
      resourceSlug: input.resourceSlug,
      serviceSlug,
      date: candidateDate,
      phoneE164: input.phoneE164
    });
    if (slots.length > 0) alternatives.push({ date: candidateDate, slots });
    if (alternatives.length === 2) break;
  }
  return alternatives;
}

function bookingSummary(context: BookingAgentContext) {
  return `${context.serviceName}\n${formatItalianDate(context.date!)} alle ${
    context.startTime
  }\nNome: ${context.customerName}`;
}

function invalidClarification(
  fields: ReturnType<typeof invalidBookingFields>,
  context: BookingAgentContext,
  services: ServiceOption[]
) {
  const labels = fields.map((field) => {
    if (field === "service") return "il servizio";
    if (field === "date") return "la data";
    if (field === "time") return "l’orario";
    return "il nome";
  });
  const retained = [
    context.serviceName,
    context.date ? formatItalianDate(context.date) : null,
    context.startTime ? `ore ${context.startTime}` : null,
    context.customerName
  ].filter(Boolean);
  const serviceHint = fields.includes("service")
    ? ` I servizi disponibili sono: ${services.map((service) => service.name).join(", ")}.`
    : "";
  return `Non ho capito ${labels.join(" e ")}. Conservo i dati già validi${
    retained.length ? ` (${retained.join(", ")})` : ""
  }. Puoi indicarmi di nuovo ${labels.join(" e ")}?${serviceHint}`;
}

async function runNaturalBookingAgent({
  input,
  turn,
  businessId,
  previous,
  services,
  knownCustomerName,
  durable,
  eventOrderKey,
  now
}: {
  input: BookingAgentInput;
  turn: BookingAgentTurn;
  businessId: string;
  previous: ConversationRow | null;
  services: ServiceOption[];
  knownCustomerName?: string;
  durable: boolean;
  eventOrderKey: string;
  now: Date;
}): Promise<BookingAgentResult> {
  const expectedVersion = previous?.version ?? 0;
  const respond = (
    state: ConversationState,
    context: BookingAgentContext,
    response: string
  ) =>
    saveConversation({
      input,
      businessId,
      expectedVersion,
      eventOrderKey,
      durable,
      state,
      context,
      response,
      now
    });

  const current =
    previous && !isExpired(previous.expires_at, now) && previous.context
      ? previous.context
      : {};

  if (turn.intent === "cancel_existing_booking") {
    return respond(
      contextHasValues(current) ? stateForContext(current) : "idle",
      current,
      "Non posso ancora cancellare questo appuntamento. Contatta direttamente il negozio. Nel frattempo non ho modificato né cancellato alcun appuntamento."
    );
  }
  if (turn.intent === "abort_booking") {
    return respond(
      "idle",
      {},
      "Va bene, ho abbandonato la richiesta di prenotazione in corso. Nessun appuntamento esistente è stato cancellato."
    );
  }

  let context = mergeBookingAgentContext({
    current,
    turn,
    services,
    knownCustomerName
  });
  const invalidFields = invalidBookingFields(turn);
  if (invalidFields.length > 0) {
    return respond(
      stateForContext(context),
      context,
      invalidClarification(invalidFields, context, services)
    );
  }

  const changed = turnChangesBooking(turn);
  if (turn.intent === "other" && !contextHasValues(context)) {
    return respond(
      "idle",
      {},
      "Ciao! Posso aiutarti a prenotare da Studio Barber 8. Dimmi pure servizio, giorno e orario, anche tutti nella stessa frase."
    );
  }
  if (services.length === 0) {
    return respond(
      "idle",
      {},
      "Al momento non ci sono servizi prenotabili. Riprova più tardi."
    );
  }
  if (!context.serviceSlug) {
    return respond(
      "awaiting_service",
      context,
      `Quale servizio preferisci?\n\n${formatServiceList(services)}`
    );
  }
  if (!context.date) {
    return respond(
      "awaiting_date",
      context,
      `Perfetto, ${context.serviceName}. Per quale giorno vuoi venire?`
    );
  }

  const serviceSlug = context.serviceSlug;
  const bookingDate = context.date;
  let slots = await getAvailability({
    supabase: input.supabase,
    businessSlug: input.businessSlug,
    resourceSlug: input.resourceSlug,
    serviceSlug,
    date: bookingDate,
    phoneE164: input.phoneE164
  });
  context = { ...context, availableSlots: slots };

  if (slots.length === 0) {
    const alternatives = await findAlternativeDays({ input, serviceSlug, date: bookingDate });
    const alternativeText = alternatives.length
      ? ` Le prime alternative sono ${alternatives
          .map((item) => `${formatItalianDate(item.date)}: ${formatSlotList(item.slots)}`)
          .join("; ")}.`
      : " Indicami un altro giorno e controllo subito.";
    return respond(
      "awaiting_date",
      {
        ...context,
        startTime: undefined,
        requestedTime: undefined,
        confirmationPending: false
      },
      `Non risultano orari liberi per ${formatItalianDate(bookingDate)}.${alternativeText}`
    );
  }

  if (context.requestedTime) {
    const requestedTime = context.requestedTime;
    if (slots.includes(requestedTime)) {
      context = { ...context, startTime: requestedTime, requestedTime: undefined };
    } else {
      return respond(
        "awaiting_slot",
        {
          ...context,
          requestedTime: undefined,
          startTime: undefined,
          confirmationPending: false
        },
        `Alle ${requestedTime} non è libero. Gli orari più vicini disponibili sono ${formatSlotList(
          nearestAvailableSlots(slots, requestedTime)
        )}. Quale preferisci?`
      );
    }
  } else if (context.startTime && !slots.includes(context.startTime)) {
    const previousTime = context.startTime;
    return respond(
      "awaiting_slot",
      { ...context, startTime: undefined, confirmationPending: false },
      `L’orario delle ${previousTime} non è più libero. Posso proporti ${formatSlotList(
        nearestAvailableSlots(slots, previousTime)
      )}. Quale scegli?`
    );
  }

  if (!context.startTime) {
    return respond(
      "awaiting_slot",
      context,
      `Per ${formatItalianDate(bookingDate)} sono disponibili: ${formatSlotList(
        slots
      )}. A che ora preferisci?`
    );
  }
  if (!context.customerName) {
    return respond("awaiting_name", context, "A che nome registro l’appuntamento?");
  }

  if (turn.confirmation === "reject" && !changed) {
    return respond(
      "awaiting_confirmation",
      { ...context, confirmationPending: true },
      "Nessun problema. Cosa vuoi cambiare: servizio, giorno, orario o nome?"
    );
  }

  if (
    turn.confirmation === "confirm" &&
    current.confirmationPending === true &&
    !changed
  ) {
    const response = `Appuntamento confermato ✅\n\n${bookingSummary(
      context
    )}\n\nTi aspettiamo da Studio Barber 8!`;
    const externalReferencePrefix = input.externalReferencePrefix ?? "assistant";
    const externalReference = input.messageSid.startsWith(`${externalReferencePrefix}:`)
      ? input.messageSid
      : `${externalReferencePrefix}:${input.messageSid}`;
    const rpcName = durable
      ? "confirm_booking_conversation"
      : "create_public_booking";
    const rpcArgs = durable
      ? {
          p_business_id: businessId,
          p_phone_e164: input.phoneE164,
          p_expected_version: expectedVersion,
          p_event_order_key: eventOrderKey,
          p_provider_message_id: input.messageSid,
          p_response_text: response,
          p_expires_at: new Date(now.getTime() + CONVERSATION_TTL_MS).toISOString(),
          p_business_slug: input.businessSlug,
          p_service_slug: serviceSlug,
          p_date: bookingDate,
          p_start_time: context.startTime,
          p_customer_name: context.customerName,
          p_channel: input.bookingChannel ?? "whatsapp",
          p_notes:
            (input.bookingChannel ?? "whatsapp") === "voice"
              ? "Prenotazione gestita dall’agente conversazionale vocale."
              : "Prenotazione gestita dall’agente conversazionale WhatsApp.",
          p_external_reference: externalReference,
          p_resource_slug: input.resourceSlug
        }
      : {
          p_business_slug: input.businessSlug,
          p_service_slug: serviceSlug,
          p_date: bookingDate,
          p_start_time: context.startTime,
          p_customer_name: context.customerName,
          p_phone_e164: input.phoneE164,
          p_channel: input.bookingChannel ?? "whatsapp",
          p_notes:
            (input.bookingChannel ?? "whatsapp") === "voice"
              ? "Prenotazione gestita dall’agente conversazionale vocale."
              : "Prenotazione gestita dall’agente conversazionale WhatsApp.",
          p_external_reference: externalReference,
          p_resource_slug: input.resourceSlug
        };
    const { data, error } = await input.supabase.rpc(rpcName, rpcArgs);
    if (error) {
      const concurrencyError = mapConcurrencyError(error);
      if (concurrencyError) throw concurrencyError;
      if (error.code === "23P01" || /SLOT_NOT_AVAILABLE/.test(error.message ?? "")) {
        slots = await getAvailability({
          supabase: input.supabase,
          businessSlug: input.businessSlug,
          resourceSlug: input.resourceSlug,
          serviceSlug,
          date: bookingDate,
          phoneE164: input.phoneE164
        });
        const alternatives = slots.length
          ? nearestAvailableSlots(slots, context.startTime)
          : [];
        return respond(
          slots.length ? "awaiting_slot" : "awaiting_date",
          {
            ...context,
            availableSlots: slots,
            startTime: undefined,
            confirmationPending: false
          },
          alternatives.length
            ? `Quell’orario è stato appena occupato. Ora sono disponibili ${formatSlotList(
                alternatives
              )}. Quale preferisci?`
            : "Quell’orario è stato appena occupato e il giorno è ora pieno. Indicami un altro giorno."
        );
      }
      throw new Error(`BOOKING_AGENT_BOOKING_FAILED:${error.code}`);
    }
    const appointment = Array.isArray(data) ? data[0] : data;
    if (!appointment) throw new Error("BOOKING_AGENT_BOOKING_FAILED:EMPTY");
    if (durable) return { response, duplicate: false };
    return respond("idle", {}, response);
  }

  context = { ...context, confirmationPending: true };
  return respond(
    "awaiting_confirmation",
    context,
    `Ti riepilogo:\n\n${bookingSummary(
      context
    )}\n\nConfermi? Rispondi sì per creare la prenotazione, oppure dimmi cosa vuoi cambiare.`
  );
}

export async function handleBookingAgentMessage(
  input: BookingAgentInput,
  dependencies: BookingAgentDependencies = {}
): Promise<BookingAgentResult> {
  const now = input.now ?? new Date();
  const occurredAt = input.occurredAt ?? now;
  const eventOrderKey = `${occurredAt.toISOString()}|${input.messageSid}`;
  const { data: business, error: businessError } = await input.supabase
    .from("businesses")
    .select("id")
    .eq("slug", input.businessSlug)
    .eq("active", true)
    .single();
  if (businessError || !business) {
    throw new Error(`BOOKING_AGENT_BUSINESS_FAILED:${businessError?.code ?? "NOT_FOUND"}`);
  }
  const businessId = business.id as string;
  const claim = await claimInboundEvent({ input, businessId, occurredAt });
  if (claim.mode === "durable" && claim.status !== "claimed") {
    return { response: claim.response, duplicate: true };
  }
  const durable = claim.mode === "durable";

  try {
    for (let attempt = 0; attempt < MAX_CONVERSATION_RETRIES; attempt += 1) {
      const [servicesResult, conversation, customerResult] = await Promise.all([
        input.supabase
          .from("services")
          .select("name, slug, duration_minutes, price_cents")
          .eq("business_id", businessId)
          .eq("active", true)
          .order("sort_order", { ascending: true }),
        loadConversation({ input, businessId, durable }),
        input.supabase
          .from("customers")
          .select("name")
          .eq("business_id", businessId)
          .eq("phone_e164", input.phoneE164)
          .maybeSingle()
      ]);
      if (servicesResult.error) {
        throw new Error(`BOOKING_AGENT_SERVICES_FAILED:${servicesResult.error.code}`);
      }
      if (customerResult.error) {
        throw new Error(`BOOKING_AGENT_CUSTOMER_FAILED:${customerResult.error.code}`);
      }
      const services = (servicesResult.data ?? []) as ServiceOption[];
      const context =
        conversation && !isExpired(conversation.expires_at, now) && conversation.context
          ? conversation.context
          : {};
      const interpretTurn = dependencies.interpretTurn ?? interpretBookingAgentTurn;
      let turn = await interpretTurn({ body: input.body, context, services, now });
      if (!turn) {
        const fallback =
          dependencies.interpretFallbackTurn ?? interpretDeterministicBookingTurn;
        turn = await fallback({ body: input.body, context, services, now });
      }

      try {
        return await runNaturalBookingAgent({
          input,
          turn,
          businessId,
          previous: conversation,
          services,
          knownCustomerName: customerResult.data?.name as string | undefined,
          durable,
          eventOrderKey,
          now
        });
      } catch (error) {
        if (error instanceof ConversationConflictError) continue;
        if (error instanceof StaleConversationEventError) {
          const latest = await loadConversation({ input, businessId, durable });
          return completeStaleEvent(input, latest?.last_response_text ?? "");
        }
        throw error;
      }
    }
    throw new Error("BOOKING_AGENT_CONVERSATION_CONFLICT_RETRY_EXHAUSTED");
  } catch (error) {
    await failInboundEvent(input, claim, error);
    throw error;
  }
}
