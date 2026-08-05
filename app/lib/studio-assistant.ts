import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAssistantUsage } from "./assistant-control.ts";
import {
  handleBookingAgentMessage,
  type BookingAgentContext,
  type BookingAgentInput,
  type BookingAgentResult
} from "./booking-agent.ts";
import { interpretDeterministicBookingTurn } from "./booking-agent-fallback.ts";
import { interpretBookingAgentTurn } from "./booking-agent-language.ts";
import type { BookingAgentTurn } from "./booking-agent-language-helpers.ts";
import {
  normalizeWhatsAppText,
  type ServiceOption
} from "./whatsapp-assistant-helpers.ts";

type CancellationContext = BookingAgentContext & {
  cancellationSelectionPending?: boolean;
  cancellationAppointmentId?: string;
  cancellationServiceName?: string;
  cancellationStartsAt?: string;
};

type ConversationRow = {
  state: string;
  context: CancellationContext | null;
  last_message_sid: string | null;
  last_response_text: string | null;
  expires_at: string;
  version: number;
  last_event_order_key: string | null;
};

type UpcomingAppointment = {
  appointment_id: string;
  service_name: string;
  starts_at: string;
  status: "pending" | "confirmed";
};

type EventClaim =
  | { status: "claimed" }
  | { status: "duplicate" | "busy"; response: string };

const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_VISIBLE_APPOINTMENTS = 8;
const MAX_RETRIES = 3;

class ConversationConflictError extends Error {}
class StaleConversationEventError extends Error {}

function isCancellationPhrase(body: string) {
  const normalized = normalizeWhatsAppText(body);
  return (
    /\b(?:cancell|annull|disdic)/.test(normalized) &&
    /\b(?:appuntamento|prenotazione)\b/.test(normalized)
  );
}

function hasCancellationContext(context: CancellationContext | null) {
  return Boolean(
    context?.cancellationSelectionPending ||
      context?.cancellationAppointmentId
  );
}

function isExpired(expiresAt: string, now: Date) {
  const expires = Date.parse(expiresAt);
  return Number.isNaN(expires) || expires <= now.getTime();
}

function localParts(startsAt: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date(startsAt));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`
  };
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

function formatAppointment(appointment: UpcomingAppointment) {
  const local = localParts(appointment.starts_at);
  return `${appointment.service_name} · ${formatItalianDate(local.date)} alle ${
    local.time
  }`;
}

function formatAppointmentList(appointments: UpcomingAppointment[]) {
  return appointments
    .slice(0, MAX_VISIBLE_APPOINTMENTS)
    .map((appointment, index) => `${index + 1}. ${formatAppointment(appointment)}`)
    .join("\n");
}

function selectedAppointmentSummary(context: CancellationContext) {
  if (!context.cancellationStartsAt) {
    return context.cancellationServiceName ?? "Appuntamento";
  }
  const local = localParts(context.cancellationStartsAt);
  return `${context.cancellationServiceName ?? "Appuntamento"}\n${formatItalianDate(
    local.date
  )} alle ${local.time}`;
}

function requestedOrdinal(body: string) {
  const normalized = normalizeWhatsAppText(body).trim();
  const match = normalized.match(
    /^(?:quello\s+|l[' ]|il\s+|la\s+)?(primo|secondo|terzo|quarto|quinto|sesto|settimo|ottavo|[1-8])\b/
  );
  if (!match) return null;
  const mapping: Record<string, number> = {
    primo: 1,
    secondo: 2,
    terzo: 3,
    quarto: 4,
    quinto: 5,
    sesto: 6,
    settimo: 7,
    ottavo: 8
  };
  const parsed = mapping[match[1]] ?? Number(match[1]);
  return Number.isInteger(parsed) ? parsed - 1 : null;
}

function mapConversationError(error: { code?: string; message?: string }) {
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

async function resolveBusinessId(input: BookingAgentInput) {
  const { data, error } = await input.supabase
    .from("businesses")
    .select("id")
    .eq("slug", input.businessSlug)
    .eq("active", true)
    .single();
  if (error || !data) {
    throw new Error(`STUDIO_ASSISTANT_BUSINESS_FAILED:${error?.code ?? "NOT_FOUND"}`);
  }
  return String(data.id);
}

async function loadConversation({
  supabase,
  businessId,
  phoneE164
}: {
  supabase: SupabaseClient;
  businessId: string;
  phoneE164: string;
}) {
  const { data, error } = await supabase.rpc("get_booking_conversation", {
    p_business_id: businessId,
    p_phone_e164: phoneE164
  });
  if (error) {
    throw new Error(`STUDIO_ASSISTANT_CONVERSATION_READ_FAILED:${error.code}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? null) as ConversationRow | null;
}

async function claimEvent({
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
  if (error) throw new Error(`STUDIO_ASSISTANT_EVENT_CLAIM_FAILED:${error.code}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.claim_status === "claimed") return { status: "claimed" };
  if (row?.claim_status === "duplicate" || row?.claim_status === "busy") {
    return {
      status: row.claim_status,
      response: typeof row.response_text === "string" ? row.response_text : ""
    };
  }
  throw new Error("STUDIO_ASSISTANT_EVENT_CLAIM_FAILED:EMPTY");
}

async function failEvent(input: BookingAgentInput, error: unknown) {
  const failureCode = error instanceof Error ? error.message.split(":")[0] : "UNKNOWN";
  const { error: rpcError } = await input.supabase.rpc("fail_booking_inbound_event", {
    p_provider_message_id: input.messageSid,
    p_error_code: failureCode.slice(0, 80)
  });
  if (rpcError) {
    console.error("studio_assistant_failure_record_failed", {
      messageId: input.messageSid,
      code: rpcError.code
    });
  }
}

async function completeStaleEvent(input: BookingAgentInput, response: string) {
  const { error } = await input.supabase.rpc("complete_booking_inbound_event", {
    p_provider_message_id: input.messageSid,
    p_response_text: response
  });
  if (error) throw new Error(`STUDIO_ASSISTANT_EVENT_COMPLETE_FAILED:${error.code}`);
  return { response, duplicate: true } satisfies BookingAgentResult;
}

async function saveConversation({
  input,
  businessId,
  expectedVersion,
  eventOrderKey,
  state,
  context,
  response,
  now
}: {
  input: BookingAgentInput;
  businessId: string;
  expectedVersion: number;
  eventOrderKey: string;
  state: "idle" | "awaiting_confirmation";
  context: CancellationContext;
  response: string;
  now: Date;
}) {
  const { error } = await input.supabase.rpc("save_booking_conversation", {
    p_business_id: businessId,
    p_phone_e164: input.phoneE164,
    p_expected_version: expectedVersion,
    p_event_order_key: eventOrderKey,
    p_state: state,
    p_context: context,
    p_provider_message_id: input.messageSid,
    p_response_text: response,
    p_expires_at: new Date(now.getTime() + CONVERSATION_TTL_MS).toISOString()
  });
  if (error) {
    const mapped = mapConversationError(error);
    if (mapped) throw mapped;
    throw new Error(`STUDIO_ASSISTANT_CONVERSATION_SAVE_FAILED:${error.code}`);
  }
  return { response, duplicate: false } satisfies BookingAgentResult;
}

async function loadServicesAndAppointments({
  input,
  businessId
}: {
  input: BookingAgentInput;
  businessId: string;
}) {
  const [servicesResult, appointmentsResult] = await Promise.all([
    input.supabase
      .from("services")
      .select("name, slug, duration_minutes, price_cents")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    input.supabase.rpc("list_customer_upcoming_appointments", {
      p_business_slug: input.businessSlug,
      p_phone_e164: input.phoneE164
    })
  ]);
  if (servicesResult.error) {
    throw new Error(`STUDIO_ASSISTANT_SERVICES_FAILED:${servicesResult.error.code}`);
  }
  if (appointmentsResult.error) {
    throw new Error(
      `STUDIO_ASSISTANT_APPOINTMENTS_FAILED:${appointmentsResult.error.code}`
    );
  }
  return {
    services: (servicesResult.data ?? []) as ServiceOption[],
    appointments: (appointmentsResult.data ?? []) as UpcomingAppointment[]
  };
}

async function interpretTurn({
  input,
  context,
  services,
  now
}: {
  input: BookingAgentInput;
  context: CancellationContext;
  services: ServiceOption[];
  now: Date;
}) {
  const languageTurn = await interpretBookingAgentTurn({
    body: input.body,
    context,
    services,
    now
  });
  if (languageTurn) return languageTurn;
  return interpretDeterministicBookingTurn({
    body: input.body,
    context,
    services,
    now
  });
}

function filterAppointments({
  appointments,
  services,
  turn,
  body
}: {
  appointments: UpcomingAppointment[];
  services: ServiceOption[];
  turn: BookingAgentTurn;
  body: string;
}) {
  let matches = appointments;
  if (turn.service.status === "valid") {
    const service = services.find((item) => item.slug === turn.service.value);
    if (service) {
      matches = matches.filter(
        (appointment) => appointment.service_name === service.name
      );
    }
  }
  if (turn.date.status === "valid") {
    matches = matches.filter(
      (appointment) => localParts(appointment.starts_at).date === turn.date.value
    );
  }
  if (turn.time.status === "valid") {
    matches = matches.filter(
      (appointment) => localParts(appointment.starts_at).time === turn.time.value
    );
  }

  const ordinal = requestedOrdinal(body);
  if (ordinal !== null && ordinal >= 0 && ordinal < matches.length) {
    return [matches[ordinal]];
  }
  return matches;
}

function cancellationFieldsInvalid(turn: BookingAgentTurn) {
  return [turn.service, turn.date, turn.time].some(
    (field) => field.status === "invalid"
  );
}

async function runCancellationTurn({
  input,
  businessId,
  conversation,
  eventOrderKey,
  now
}: {
  input: BookingAgentInput;
  businessId: string;
  conversation: ConversationRow | null;
  eventOrderKey: string;
  now: Date;
}): Promise<BookingAgentResult> {
  const expectedVersion = conversation?.version ?? 0;
  const context =
    conversation && !isExpired(conversation.expires_at, now) && conversation.context
      ? conversation.context
      : {};
  const { services, appointments } = await loadServicesAndAppointments({
    input,
    businessId
  });
  const turn = await interpretTurn({ input, context, services, now });

  const respond = (
    state: "idle" | "awaiting_confirmation",
    nextContext: CancellationContext,
    response: string
  ) =>
    saveConversation({
      input,
      businessId,
      expectedVersion,
      eventOrderKey,
      state,
      context: nextContext,
      response,
      now
    });

  const selectAppointment = async () => {
    if (appointments.length === 0) {
      return respond(
        "idle",
        {},
        "Non risultano appuntamenti futuri attivi associati a questo numero. Non ho cancellato nulla."
      );
    }

    if (cancellationFieldsInvalid(turn)) {
      return respond(
        "awaiting_confirmation",
        { cancellationSelectionPending: true, confirmationPending: false },
        `Non ho capito quale appuntamento vuoi cancellare. Scrivi il numero dell’appuntamento oppure giorno e orario.\n\n${formatAppointmentList(
          appointments
        )}`
      );
    }

    const matches = filterAppointments({
      appointments,
      services,
      turn,
      body: input.body
    });
    const hasSelector =
      requestedOrdinal(input.body) !== null ||
      turn.service.status === "valid" ||
      turn.date.status === "valid" ||
      turn.time.status === "valid";

    if (matches.length === 0) {
      return respond(
        "awaiting_confirmation",
        { cancellationSelectionPending: true, confirmationPending: false },
        `Non trovo un appuntamento corrispondente. Scrivi il numero dell’appuntamento oppure giorno e orario.\n\n${formatAppointmentList(
          appointments
        )}`
      );
    }
    if (matches.length > 1) {
      return respond(
        "awaiting_confirmation",
        { cancellationSelectionPending: true, confirmationPending: false },
        `${
          hasSelector
            ? "Ho trovato più appuntamenti compatibili."
            : "Hai più appuntamenti futuri."
        } Scrivi il numero dell’appuntamento oppure giorno e orario.\n\n${formatAppointmentList(
          matches
        )}`
      );
    }

    const selected = matches[0];
    return respond(
      "awaiting_confirmation",
      {
        cancellationAppointmentId: selected.appointment_id,
        cancellationServiceName: selected.service_name,
        cancellationStartsAt: selected.starts_at,
        confirmationPending: true
      },
      `Vuoi cancellare questo appuntamento?\n\n${formatAppointment(
        selected
      )}\n\nRispondi sì per cancellarlo oppure no per lasciarlo invariato.`
    );
  };

  if (context.cancellationAppointmentId) {
    if (turn.intent === "abort_booking" || turn.confirmation === "reject") {
      return respond(
        "idle",
        {},
        "Va bene, l’appuntamento resta confermato. Non ho cancellato nulla."
      );
    }

    const changesSelection =
      isCancellationPhrase(input.body) ||
      requestedOrdinal(input.body) !== null ||
      turn.service.status === "valid" ||
      turn.date.status === "valid" ||
      turn.time.status === "valid";
    if (changesSelection && turn.confirmation !== "confirm") {
      return selectAppointment();
    }

    if (turn.confirmation === "confirm" && context.confirmationPending === true) {
      const response = `Appuntamento cancellato ✅\n\n${selectedAppointmentSummary(
        context
      )}\n\nLo spazio è di nuovo disponibile in agenda.`;
      const channel = input.bookingChannel ?? "whatsapp";
      const { data, error } = await input.supabase.rpc(
        "cancel_booking_conversation",
        {
          p_business_id: businessId,
          p_phone_e164: input.phoneE164,
          p_expected_version: expectedVersion,
          p_event_order_key: eventOrderKey,
          p_provider_message_id: input.messageSid,
          p_response_text: response,
          p_expires_at: new Date(
            now.getTime() + CONVERSATION_TTL_MS
          ).toISOString(),
          p_business_slug: input.businessSlug,
          p_appointment_id: context.cancellationAppointmentId,
          p_cancelled_via: channel,
          p_reason: `Richiesta e confermata dal cliente tramite ${channel}.`
        }
      );
      if (error) {
        const mapped = mapConversationError(error);
        if (mapped) throw mapped;
        if (
          /APPOINTMENT_NOT_FOUND|APPOINTMENT_NOT_CANCELLABLE/.test(
            error.message ?? ""
          )
        ) {
          return respond(
            "idle",
            {},
            "L’appuntamento non risulta più cancellabile. Non ho modificato altri appuntamenti."
          );
        }
        throw new Error(`STUDIO_ASSISTANT_CANCELLATION_FAILED:${error.code}`);
      }
      const cancellation = Array.isArray(data) ? data[0] : data;
      if (!cancellation) {
        throw new Error("STUDIO_ASSISTANT_CANCELLATION_FAILED:EMPTY");
      }

      await recordAssistantUsage({
        supabase: input.supabase,
        businessId,
        channel,
        provider: "internal",
        eventType: "appointment_cancelled",
        outputUnits: 1,
        currency: "EUR",
        providerEventId: `cancellation:${cancellation.appointment_id}`,
        metadata: {
          unit: "cancellations",
          appointmentId: cancellation.appointment_id,
          idempotent: cancellation.idempotent === true
        },
        occurredAt: now
      });

      return { response, duplicate: false };
    }

    return respond(
      "awaiting_confirmation",
      context,
      `Per sicurezza non ho cancellato nulla. Confermi la cancellazione?\n\n${selectedAppointmentSummary(
        context
      )}\n\nRispondi sì oppure no.`
    );
  }

  if (context.cancellationSelectionPending) {
    if (turn.intent === "abort_booking" || turn.confirmation === "reject") {
      return respond(
        "idle",
        {},
        "Va bene, ho interrotto la cancellazione. Nessun appuntamento è stato modificato."
      );
    }
    return selectAppointment();
  }

  return selectAppointment();
}

export async function handleStudioAssistantMessage(
  input: BookingAgentInput
): Promise<BookingAgentResult> {
  const now = input.now ?? new Date();
  const occurredAt = input.occurredAt ?? now;
  const businessId = await resolveBusinessId(input);
  const initialConversation = await loadConversation({
    supabase: input.supabase,
    businessId,
    phoneE164: input.phoneE164
  });
  const currentContext =
    initialConversation &&
    !isExpired(initialConversation.expires_at, now) &&
    initialConversation.context
      ? initialConversation.context
      : null;

  if (!hasCancellationContext(currentContext) && !isCancellationPhrase(input.body)) {
    return handleBookingAgentMessage(input);
  }

  const claim = await claimEvent({ input, businessId, occurredAt });
  if (claim.status !== "claimed") {
    return { response: claim.response, duplicate: true };
  }

  const eventOrderKey = `${occurredAt.toISOString()}|${input.messageSid}`;
  try {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const conversation = await loadConversation({
        supabase: input.supabase,
        businessId,
        phoneE164: input.phoneE164
      });
      try {
        return await runCancellationTurn({
          input,
          businessId,
          conversation,
          eventOrderKey,
          now
        });
      } catch (error) {
        if (error instanceof ConversationConflictError) continue;
        if (error instanceof StaleConversationEventError) {
          const latest = await loadConversation({
            supabase: input.supabase,
            businessId,
            phoneE164: input.phoneE164
          });
          return completeStaleEvent(input, latest?.last_response_text ?? "");
        }
        throw error;
      }
    }
    throw new Error("STUDIO_ASSISTANT_CONVERSATION_CONFLICT_RETRY_EXHAUSTED");
  } catch (error) {
    await failEvent(input, error);
    throw error;
  }
}
