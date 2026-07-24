import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BookingChannel } from "./domain";
import {
  normalizeWhatsAppText,
  parseItalianBookingDate,
  resolveServiceChoice,
  resolveSlotChoice,
  type ServiceOption
} from "./whatsapp-assistant-helpers";

type ConversationState =
  | "idle"
  | "awaiting_service"
  | "awaiting_date"
  | "awaiting_slot"
  | "awaiting_name"
  | "awaiting_confirmation";

type ConversationContext = {
  serviceSlug?: string;
  serviceName?: string;
  date?: string;
  availableSlots?: string[];
  startTime?: string;
  customerName?: string;
};

type ConversationRow = {
  state: ConversationState;
  context: ConversationContext | null;
  last_message_sid: string | null;
  last_response_text: string | null;
  expires_at: string;
};

type AvailabilitySlot = {
  slot_time: string;
};

type AssistantInput = {
  supabase: SupabaseClient;
  businessSlug: string;
  resourceSlug: string;
  phoneE164: string;
  body: string;
  messageSid: string;
  bookingChannel?: Extract<BookingChannel, "whatsapp" | "voice">;
  externalReferencePrefix?: "meta" | "twilio" | "voice";
  now?: Date;
};

export type BookingAssistantResult = {
  response: string;
  duplicate: boolean;
};

export type WhatsAppAssistantResult = BookingAssistantResult;

const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_VISIBLE_SLOTS = 12;

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
    .map((slot, index) => `${index + 1}. ${slot}`)
    .join("\n");
}

function formatItalianDate(date: string) {
  return new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Rome"
  }).format(new Date(`${date}T12:00:00.000Z`));
}

function isExpired(expiresAt: string, now: Date) {
  const timestamp = Date.parse(expiresAt);
  return Number.isNaN(timestamp) || timestamp <= now.getTime();
}

function isAffirmative(value: string) {
  return ["si", "sì", "confermo", "ok", "va bene"].includes(
    value.trim().toLowerCase()
  );
}

function isNegative(value: string) {
  return ["no", "annulla", "annullare"].includes(
    value.trim().toLowerCase()
  );
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
  context: ConversationContext;
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
      expires_at: new Date(
        now.getTime() + CONVERSATION_TTL_MS
      ).toISOString()
    },
    { onConflict: "business_id,phone_e164" }
  );

  if (error) throw new Error(`WHATSAPP_CONVERSATION_SAVE_FAILED:${error.code}`);
  return {
    response,
    duplicate: false
  } satisfies BookingAssistantResult;
}

async function getServices(
  supabase: SupabaseClient,
  businessId: string
) {
  const { data, error } = await supabase
    .from("services")
    .select("name, slug, duration_minutes, price_cents")
    .eq("business_id", businessId)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (error) throw new Error(`WHATSAPP_SERVICES_FAILED:${error.code}`);
  return (data ?? []) as ServiceOption[];
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

  if (error) throw new Error(`WHATSAPP_AVAILABILITY_FAILED:${error.code}`);
  return ((data ?? []) as AvailabilitySlot[]).map((slot) => slot.slot_time);
}

async function startBooking({
  supabase,
  businessId,
  phoneE164,
  messageSid,
  now
}: {
  supabase: SupabaseClient;
  businessId: string;
  phoneE164: string;
  messageSid: string;
  now: Date;
}) {
  const services = await getServices(supabase, businessId);
  if (services.length === 0) {
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "idle",
      context: {},
      messageSid,
      response:
        "Al momento non ci sono servizi prenotabili. Riprova più tardi.",
      now
    });
  }

  return saveConversation({
    supabase,
    businessId,
    phoneE164,
    state: "awaiting_service",
    context: {},
    messageSid,
    response: `Perfetto, iniziamo. Quale servizio vuoi prenotare?\n\n${formatServiceList(
      services
    )}\n\nRispondi con il numero o con il nome del servizio. Scrivi ANNULLA per uscire.`,
    now
  });
}

export async function handleBookingAssistantMessage({
  supabase,
  businessSlug,
  resourceSlug,
  phoneE164,
  body,
  messageSid,
  bookingChannel = "whatsapp",
  externalReferencePrefix = "twilio",
  now = new Date()
}: AssistantInput) {
  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("slug", businessSlug)
    .eq("active", true)
    .single();

  if (businessError || !business) {
    throw new Error(
      `WHATSAPP_BUSINESS_FAILED:${businessError?.code ?? "NOT_FOUND"}`
    );
  }

  const businessId = business.id as string;
  const { data: storedConversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .select(
      "state, context, last_message_sid, last_response_text, expires_at"
    )
    .eq("business_id", businessId)
    .eq("phone_e164", phoneE164)
    .maybeSingle();

  if (conversationError) {
    throw new Error(
      `WHATSAPP_CONVERSATION_READ_FAILED:${conversationError.code}`
    );
  }

  const previous = storedConversation as ConversationRow | null;
  if (
    previous?.last_message_sid === messageSid &&
    previous.last_response_text
  ) {
    return {
      response: previous.last_response_text,
      duplicate: true
    } satisfies BookingAssistantResult;
  }

  const normalizedBody = normalizeWhatsAppText(body);
  const restartRequested = [
    "prenota",
    "prenotazione",
    "nuova prenotazione",
    "appuntamento"
  ].includes(normalizedBody);

  if (restartRequested) {
    return startBooking({
      supabase,
      businessId,
      phoneE164,
      messageSid,
      now
    });
  }

  if (normalizedBody === "annulla") {
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "idle",
      context: {},
      messageSid,
      response:
        "Prenotazione annullata. Quando vuoi ricominciare, scrivi PRENOTA.",
      now
    });
  }

  const state =
    !previous || isExpired(previous.expires_at, now)
      ? "idle"
      : previous.state;
  const context =
    state === "idle" || !previous?.context ? {} : previous.context;

  if (state === "idle") {
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "idle",
      context: {},
      messageSid,
      response:
        "Ciao! Sono il segretario digitale di Studio Barber 8. Posso aiutarti a fissare un appuntamento. Scrivi PRENOTA per iniziare.",
      now
    });
  }

  if (state === "awaiting_service") {
    const services = await getServices(supabase, businessId);
    const service = resolveServiceChoice(body, services);
    if (!service) {
      return saveConversation({
        supabase,
        businessId,
        phoneE164,
        state,
        context,
        messageSid,
        response: `Non ho riconosciuto il servizio. Scegli uno di questi:\n\n${formatServiceList(
          services
        )}\n\nRispondi con il numero o con il nome.`,
        now
      });
    }

    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "awaiting_date",
      context: {
        serviceSlug: service.slug,
        serviceName: service.name
      },
      messageSid,
      response: `Hai scelto ${service.name}. Per quale giorno?\n\nPuoi scrivere OGGI, DOMANI oppure una data come 28/07.`,
      now
    });
  }

  if (state === "awaiting_date") {
    let date: string;
    try {
      date = parseItalianBookingDate(body, now);
    } catch {
      return saveConversation({
        supabase,
        businessId,
        phoneE164,
        state,
        context,
        messageSid,
        response:
          "Non ho capito la data. Scrivi OGGI, DOMANI oppure una data come 28/07.",
        now
      });
    }

    const serviceSlug = context.serviceSlug;
    if (!serviceSlug) {
      return startBooking({
        supabase,
        businessId,
        phoneE164,
        messageSid,
        now
      });
    }

    const slots = await getAvailability({
      supabase,
      businessSlug,
      resourceSlug,
      serviceSlug,
      date,
      phoneE164
    });

    if (slots.length === 0) {
      return saveConversation({
        supabase,
        businessId,
        phoneE164,
        state,
        context,
        messageSid,
        response: `Non ci sono orari liberi per ${formatItalianDate(
          date
        )}. Indicami un altro giorno.`,
        now
      });
    }

    const moreSlots =
      slots.length > MAX_VISIBLE_SLOTS
        ? "\n\nPuoi anche scrivere direttamente un altro orario disponibile."
        : "";
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "awaiting_slot",
      context: {
        ...context,
        date,
        availableSlots: slots
      },
      messageSid,
      response: `Ecco gli orari liberi per ${formatItalianDate(
        date
      )}:\n\n${formatSlotList(
        slots
      )}\n\nRispondi con il numero o con l’orario.${moreSlots}`,
      now
    });
  }

  if (state === "awaiting_slot") {
    const slots = context.availableSlots ?? [];
    const startTime = resolveSlotChoice(body, slots);
    if (!startTime) {
      return saveConversation({
        supabase,
        businessId,
        phoneE164,
        state,
        context,
        messageSid,
        response: `Orario non riconosciuto o non più disponibile. Scegli uno di questi:\n\n${formatSlotList(
          slots
        )}\n\nRispondi con il numero o con l’orario.`,
        now
      });
    }

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("name")
      .eq("business_id", businessId)
      .eq("phone_e164", phoneE164)
      .maybeSingle();

    if (customerError) {
      throw new Error(`WHATSAPP_CUSTOMER_FAILED:${customerError.code}`);
    }

    const nextContext = {
      ...context,
      startTime,
      customerName: customer?.name as string | undefined
    };

    if (!customer?.name) {
      return saveConversation({
        supabase,
        businessId,
        phoneE164,
        state: "awaiting_name",
        context: nextContext,
        messageSid,
        response: "Perfetto. A che nome devo registrare l’appuntamento?",
        now
      });
    }

    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "awaiting_confirmation",
      context: nextContext,
      messageSid,
      response: `Confermi questo appuntamento?\n\n${context.serviceName}\n${formatItalianDate(
        context.date!
      )} alle ${startTime}\nNome: ${customer.name}\n\nRispondi SI per confermare oppure NO per annullare.`,
      now
    });
  }

  if (state === "awaiting_name") {
    const customerName = body.trim().replace(/\s+/g, " ");
    if (customerName.length < 2 || customerName.length > 160) {
      return saveConversation({
        supabase,
        businessId,
        phoneE164,
        state,
        context,
        messageSid,
        response:
          "Scrivimi nome e cognome da usare per l’appuntamento, per esempio Mario Rossi.",
        now
      });
    }

    const nextContext = { ...context, customerName };
    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "awaiting_confirmation",
      context: nextContext,
      messageSid,
      response: `Confermi questo appuntamento?\n\n${context.serviceName}\n${formatItalianDate(
        context.date!
      )} alle ${context.startTime}\nNome: ${customerName}\n\nRispondi SI per confermare oppure NO per annullare.`,
      now
    });
  }

  if (state === "awaiting_confirmation") {
    if (isNegative(body)) {
      return saveConversation({
        supabase,
        businessId,
        phoneE164,
        state: "idle",
        context: {},
        messageSid,
        response:
          "Va bene, non ho creato l’appuntamento. Scrivi PRENOTA per ricominciare.",
        now
      });
    }

    if (!isAffirmative(body)) {
      return saveConversation({
        supabase,
        businessId,
        phoneE164,
        state,
        context,
        messageSid,
        response:
          "Rispondi SI per confermare l’appuntamento oppure NO per annullare.",
        now
      });
    }

    if (
      !context.serviceSlug ||
      !context.serviceName ||
      !context.date ||
      !context.startTime ||
      !context.customerName
    ) {
      return startBooking({
        supabase,
        businessId,
        phoneE164,
        messageSid,
        now
      });
    }

    const { data, error } = await supabase.rpc("create_public_booking", {
      p_business_slug: businessSlug,
      p_service_slug: context.serviceSlug,
      p_date: context.date,
      p_start_time: context.startTime,
      p_customer_name: context.customerName,
      p_phone_e164: phoneE164,
      p_channel: bookingChannel,
      p_notes:
        bookingChannel === "voice"
          ? "Prenotazione gestita dal laboratorio vocale."
          : "Prenotazione gestita dal segretario digitale WhatsApp.",
      p_external_reference: messageSid.startsWith(
        `${externalReferencePrefix}:`
      )
        ? messageSid
        : `${externalReferencePrefix}:${messageSid}`,
      p_resource_slug: resourceSlug
    });

    if (error) {
      if (
        error.code === "23P01" ||
        error.message.includes("SLOT_NOT_AVAILABLE")
      ) {
        return saveConversation({
          supabase,
          businessId,
          phoneE164,
          state: "awaiting_date",
          context: {
            serviceSlug: context.serviceSlug,
            serviceName: context.serviceName
          },
          messageSid,
          response:
            "Mi dispiace, quell’orario è stato appena occupato. Indicami un altro giorno e ti mostro gli orari aggiornati.",
          now
        });
      }
      throw new Error(`WHATSAPP_BOOKING_FAILED:${error.code}`);
    }

    const appointment = Array.isArray(data) ? data[0] : null;
    if (!appointment) throw new Error("WHATSAPP_BOOKING_FAILED:EMPTY");

    return saveConversation({
      supabase,
      businessId,
      phoneE164,
      state: "idle",
      context: {},
      messageSid,
      response: `Appuntamento confermato ✅\n\n${context.serviceName}\n${formatItalianDate(
        context.date
      )} alle ${context.startTime}\nNome: ${
        context.customerName
      }\n\nTi aspettiamo da Studio Barber 8!`,
      now
    });
  }

  return startBooking({
    supabase,
    businessId,
    phoneE164,
    messageSid,
    now
  });
}

export const handleWhatsAppAssistantMessage = handleBookingAssistantMessage;
