import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookingChannel } from "./domain";
import { interpretBookingAgentTurn } from "./booking-agent-language.ts";
import {
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
};

type AvailabilitySlot = {
  slot_time: string;
};

export type BookingAgentInput = {
  supabase: SupabaseClient;
  businessSlug: string;
  resourceSlug: string;
  phoneE164: string;
  body: string;
  messageSid: string;
  bookingChannel?: Extract<BookingChannel, "whatsapp" | "voice">;
  externalReferencePrefix?: "meta" | "assistant" | "voice";
  now?: Date;
};

export type BookingAgentResult = {
  response: string;
  duplicate: boolean;
};

type BookingAgentDependencies = {
  interpretTurn?: typeof interpretBookingAgentTurn;
  fallback?: (input: BookingAgentInput) => Promise<BookingAgentResult>;
};

const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_VISIBLE_SLOTS = 8;
const ALTERNATIVE_DAY_LOOKAHEAD = 7;

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
  return slots
    .slice(0, MAX_VISIBLE_SLOTS)
    .map((slot) => slot)
    .join(", ");
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
  const changed = turnChangesBooking(turn);
  if (changed) next.confirmationPending = false;

  if (turn.mentioned.service) {
    const service = services.find((item) => item.slug === turn.serviceSlug);
    const serviceChanged = next.serviceSlug !== service?.slug;
    const previousTime = next.startTime;
    next.serviceSlug = service?.slug;
    next.serviceName = service?.name;
    if (serviceChanged) {
      if (!turn.mentioned.time && previousTime) next.requestedTime = previousTime;
      next.startTime = undefined;
      next.availableSlots = undefined;
    }
  }

  if (turn.mentioned.date) {
    const dateChanged = next.date !== (turn.date ?? undefined);
    const previousTime = next.startTime;
    next.date = turn.date ?? undefined;
    if (dateChanged) {
      if (!turn.mentioned.time && previousTime) next.requestedTime = previousTime;
      next.startTime = undefined;
      next.availableSlots = undefined;
    }
  }

  if (turn.mentioned.time) {
    next.requestedTime = turn.requestedTime ?? undefined;
    next.startTime = undefined;
  }

  if (turn.mentioned.name) {
    next.customerName = turn.customerName ?? undefined;
  } else if (!next.customerName && knownCustomerName) {
    next.customerName = knownCustomerName;
  }

  return next;
}

async function saveConversation({
  supabase,
  businessId,
  phoneE164,
  state,
  context,
  messageSid,
  response,
  now
}: {
  supabase: SupabaseClient;
  businessId: string;
  phoneE164: string;
  state: ConversationState;
  context: BookingAgentContext;
  messageSid: string;
  response: string;
  now: Date;
}) {
  const { error } = await supabase.from("whatsapp_conversations").upsert(
    {
      business_id: businessId,
      phone_e164: phoneE164,
      state,
      context,
      last_message_sid: messageSid,
      last_response_text: response,
      expires_at: new Date(now.getTime() + CONVERSATION_TTL_MS).toISOString()
    },
    { onConflict: "business_id,phone_e164" }
  );

  if (error) throw new Error(`BOOKING_AGENT_CONVERSATION_SAVE_FAILED:${error.code}`);
  return { response, duplicate: false } satisfies BookingAgentResult;
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
  const alternatives: Array<{ date: string; slots: string[] }> = [];
  for (let offset = 1; offset <= ALTERNATIVE_DAY_LOOKAHEAD; offset += 1) {
    const candidateDate = addDays(date, offset);
    const slots = await getAvailability({
      supabase,
      businessSlug,
      resourceSlug,
      serviceSlug,
      date: candidateDate,
      phoneE164
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

async function runNaturalBookingAgent(
  input: BookingAgentInput,
  turn: BookingAgentTurn
): Promise<BookingAgentResult> {
  const {
    supabase,
    businessSlug,
    resourceSlug,
    phoneE164,
    body,
    messageSid,
    bookingChannel = "whatsapp",
    externalReferencePrefix = "assistant",
    now = new Date()
  } = input;

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("slug", businessSlug)
    .eq("active", true)
    .single();
  if (businessError || !business) {
    throw new Error(`BOOKING_AGENT_BUSINESS_FAILED:${businessError?.code ?? "NOT_FOUND"}`);
  }
  const businessId = business.id as string;

  const { data: storedConversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .select("state, context, last_message_sid, last_response_text, expires_at")
    .eq("business_id", businessId)
    .eq("phone_e164", phoneE164)
    .maybeSingle();
  if (conversationError) {
    throw new Error(`BOOKING_AGENT_CONVERSATION_READ_FAILED:${conversationError.code}`);
  }
  const previous = storedConversation as ConversationRow | null;
  if (previous?.last_message_sid === messageSid && previous.last_response_text) {
    return { response: previous.last_response_text, duplicate: true };
  }

  const { data: servicesData, error: servicesError } = await supabase
    .from("services")
    .select("name, slug, duration_minutes, price_cents")
    .eq("business_id", businessId)
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (servicesError) throw new Error(`BOOKING_AGENT_SERVICES_FAILED:${servicesError.code}`);
  const services = (servicesData ?? []) as ServiceOption[];

  if (turn.intent === "cancel") {
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "idle",
      context: {},
      messageSid,
      response: "Va bene, ho annullato la richiesta. Quando vuoi possiamo ripartire.",
      now
    });
  }

  const current =
    previous && !isExpired(previous.expires_at, now) && previous.context
      ? previous.context
      : {};
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("name")
    .eq("business_id", businessId)
    .eq("phone_e164", phoneE164)
    .maybeSingle();
  if (customerError) throw new Error(`BOOKING_AGENT_CUSTOMER_FAILED:${customerError.code}`);

  let context = mergeBookingAgentContext({
    current,
    turn,
    services,
    knownCustomerName: customer?.name as string | undefined
  });
  const changed = turnChangesBooking(turn);

  if (turn.intent === "other" && !contextHasValues(context)) {
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "idle",
      context: {},
      messageSid,
      response:
        "Ciao! Posso aiutarti a prenotare da Studio Barber 8. Dimmi pure servizio, giorno e orario, anche tutti nella stessa frase.",
      now
    });
  }

  if (services.length === 0) {
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "idle",
      context: {},
      messageSid,
      response: "Al momento non ci sono servizi prenotabili. Riprova più tardi.",
      now
    });
  }

  if (!context.serviceSlug) {
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "awaiting_service",
      context,
      messageSid,
      response: `Quale servizio preferisci?\n\n${formatServiceList(services)}`,
      now
    });
  }

  if (!context.date) {
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "awaiting_date",
      context,
      messageSid,
      response: `Perfetto, ${context.serviceName}. Per quale giorno vuoi venire?`,
      now
    });
  }

  const serviceSlug = context.serviceSlug;
  const bookingDate = context.date;

  let slots = await getAvailability({
    supabase,
    businessSlug,
    resourceSlug,
    serviceSlug,
    date: bookingDate,
    phoneE164
  });
  context = { ...context, availableSlots: slots };

  if (slots.length === 0) {
    const alternatives = await findAlternativeDays({
      supabase,
      businessSlug,
      resourceSlug,
      serviceSlug,
      date: bookingDate,
      phoneE164
    });
    const alternativeText = alternatives.length
      ? ` Le prime alternative sono ${alternatives
          .map(
            (item) =>
              `${formatItalianDate(item.date)}: ${formatSlotList(item.slots)}`
          )
          .join("; ")}.`
      : " Indicami un altro giorno e controllo subito.";
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "awaiting_date",
      context: {
        ...context,
        startTime: undefined,
        requestedTime: undefined,
        confirmationPending: false
      },
      messageSid,
      response: `Non risultano orari liberi per ${formatItalianDate(
        bookingDate
      )}.${alternativeText}`,
      now
    });
  }

  const requestedTime = context.requestedTime;
  if (requestedTime) {
    if (slots.includes(requestedTime)) {
      context = { ...context, startTime: requestedTime, requestedTime: undefined };
    } else {
      const alternatives = nearestAvailableSlots(slots, requestedTime);
      return saveConversation({
        supabase,
        businessId,
        phoneE164,
        state: "awaiting_slot",
        context: {
          ...context,
          requestedTime: undefined,
          startTime: undefined,
          confirmationPending: false
        },
        messageSid,
        response: `Alle ${requestedTime} non è libero. Gli orari più vicini disponibili sono ${formatSlotList(
          alternatives
        )}. Quale preferisci?`,
        now
      });
    }
  } else if (context.startTime && !slots.includes(context.startTime)) {
    const alternatives = nearestAvailableSlots(slots, context.startTime);
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "awaiting_slot",
      context: {
        ...context,
        startTime: undefined,
        confirmationPending: false
      },
      messageSid,
      response: `L’orario delle ${context.startTime} non è più libero. Posso proporti ${formatSlotList(
        alternatives
      )}. Quale scegli?`,
      now
    });
  }

  if (!context.startTime) {
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "awaiting_slot",
      context,
      messageSid,
      response: `Per ${formatItalianDate(bookingDate)} sono disponibili: ${formatSlotList(
        slots
      )}. A che ora preferisci?`,
      now
    });
  }

  const startTime = context.startTime;

  if (!context.customerName) {
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "awaiting_name",
      context,
      messageSid,
      response: "A che nome registro l’appuntamento?",
      now
    });
  }

  const customerName = context.customerName;

  if (turn.confirmation === "reject" && !changed) {
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "awaiting_confirmation",
      context: { ...context, confirmationPending: true },
      messageSid,
      response:
        "Nessun problema. Cosa vuoi cambiare: servizio, giorno, orario o nome?",
      now
    });
  }

  if (
    turn.confirmation === "confirm" &&
    current.confirmationPending === true &&
    !changed
  ) {
    const { data, error } = await supabase.rpc("create_public_booking", {
      p_business_slug: businessSlug,
      p_service_slug: serviceSlug,
      p_date: bookingDate,
      p_start_time: startTime,
      p_customer_name: customerName,
      p_phone_e164: phoneE164,
      p_channel: bookingChannel,
      p_notes:
        bookingChannel === "voice"
          ? "Prenotazione gestita dall’agente conversazionale vocale."
          : "Prenotazione gestita dall’agente conversazionale WhatsApp.",
      p_external_reference: messageSid.startsWith(`${externalReferencePrefix}:`)
        ? messageSid
        : `${externalReferencePrefix}:${messageSid}`,
      p_resource_slug: resourceSlug
    });

    if (error) {
      if (error.code === "23P01" || error.message.includes("SLOT_NOT_AVAILABLE")) {
        slots = await getAvailability({
          supabase,
          businessSlug,
          resourceSlug,
          serviceSlug,
          date: bookingDate,
          phoneE164
        });
        const alternatives = slots.length
          ? nearestAvailableSlots(slots, startTime)
          : [];
        return saveConversation({
          supabase,
          businessId,
          phoneE164,
          state: slots.length ? "awaiting_slot" : "awaiting_date",
          context: {
            ...context,
            availableSlots: slots,
            startTime: undefined,
            confirmationPending: false
          },
          messageSid,
          response: alternatives.length
            ? `Quell’orario è stato appena occupato. Ora sono disponibili ${formatSlotList(
                alternatives
              )}. Quale preferisci?`
            : "Quell’orario è stato appena occupato e il giorno è ora pieno. Indicami un altro giorno.",
          now
        });
      }
      throw new Error(`BOOKING_AGENT_BOOKING_FAILED:${error.code}`);
    }

    const appointment = Array.isArray(data) ? data[0] : null;
    if (!appointment) throw new Error("BOOKING_AGENT_BOOKING_FAILED:EMPTY");
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "idle",
      context: {},
      messageSid,
      response: `Appuntamento confermato ✅\n\n${bookingSummary(context)}\n\nTi aspettiamo da Studio Barber 8!`,
      now
    });
  }

  context = { ...context, confirmationPending: true };
  return saveConversation({
    supabase,
    businessId,
    phoneE164,
    state: stateForContext(context),
    context,
    messageSid,
    response: `Ti riepilogo:\n\n${bookingSummary(
      context
    )}\n\nConfermi? Rispondi sì per creare la prenotazione, oppure dimmi cosa vuoi cambiare.`,
    now
  });
}

export async function handleBookingAgentMessage(
  input: BookingAgentInput,
  dependencies: BookingAgentDependencies = {}
): Promise<BookingAgentResult> {
  const interpretTurn = dependencies.interpretTurn ?? interpretBookingAgentTurn;

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

  const [{ data: servicesData, error: servicesError }, { data: storedConversation, error: conversationError }] =
    await Promise.all([
      input.supabase
        .from("services")
        .select("name, slug, duration_minutes, price_cents")
        .eq("business_id", businessId)
        .eq("active", true)
        .order("sort_order", { ascending: true }),
      input.supabase
        .from("whatsapp_conversations")
        .select("state, context, last_message_sid, last_response_text, expires_at")
        .eq("business_id", businessId)
        .eq("phone_e164", input.phoneE164)
        .maybeSingle()
    ]);
  if (servicesError) throw new Error(`BOOKING_AGENT_SERVICES_FAILED:${servicesError.code}`);
  if (conversationError) {
    throw new Error(`BOOKING_AGENT_CONVERSATION_READ_FAILED:${conversationError.code}`);
  }

  const previous = storedConversation as ConversationRow | null;
  if (previous?.last_message_sid === input.messageSid && previous.last_response_text) {
    return { response: previous.last_response_text, duplicate: true };
  }
  const now = input.now ?? new Date();
  const context =
    previous && !isExpired(previous.expires_at, now) && previous.context
      ? previous.context
      : {};
  const services = (servicesData ?? []) as ServiceOption[];
  const turn = await interpretTurn({
    body: input.body,
    context,
    services,
    now
  });

  if (!turn) {
    const fallback =
      dependencies.fallback ??
      (await import("./whatsapp-assistant.ts")).handleBookingAssistantMessage;
    return fallback(input);
  }
  return runNaturalBookingAgent(input, turn);
}
