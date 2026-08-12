import { NextRequest, NextResponse } from "next/server";
import {
  getAssistantControl,
  updateAssistantControl
} from "../../../../lib/assistant-control";
import { isAuthorizedAdminRequest } from "../../../../lib/admin-request";
import { getAssistantStatus } from "../../../../lib/assistant-status";
import {
  getServerSupabase,
  SupabaseConfigurationError
} from "../../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

function businessSlug() {
  return process.env.STUDIO_BARBER_BUSINESS_SLUG?.trim() || "studio-barber-8";
}

function currentMonthStart() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year ?? "1970"}-${month ?? "01"}-01T00:00:00.000Z`;
}

type UsageRow = {
  provider: string;
  event_type: string;
  model: string | null;
  input_units: number | string;
  output_units: number | string;
  duration_ms: number | string | null;
  cost_microunits: number | string;
  currency: string;
  occurred_at: string;
};

type InboundRow = {
  status: string;
  delivery_status: string | null;
};

type AppointmentRow = {
  channel: string;
  status: string;
};

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return noStore({ error: "Accesso non autorizzato." }, 401);
  }

  try {
    const supabase = getServerSupabase();
    const control = await getAssistantControl({
      supabase,
      businessSlug: businessSlug()
    });
    const periodStart = currentMonthStart();

    const [usageResult, inboundResult, appointmentResult] = await Promise.all([
      supabase
        .from("assistant_usage_events")
        .select(
          "provider, event_type, model, input_units, output_units, duration_ms, cost_microunits, currency, occurred_at"
        )
        .eq("business_id", control.businessId)
        .gte("occurred_at", periodStart)
        .order("occurred_at", { ascending: false })
        .limit(5000),
      supabase
        .from("booking_inbound_events")
        .select("status, delivery_status")
        .eq("business_id", control.businessId)
        .gte("received_at", periodStart)
        .limit(5000),
      supabase
        .from("appointments")
        .select("channel, status")
        .eq("business_id", control.businessId)
        .gte("created_at", periodStart)
        .limit(5000)
    ]);

    if (usageResult.error) throw new Error(usageResult.error.message);
    if (inboundResult.error) throw new Error(inboundResult.error.message);
    if (appointmentResult.error) throw new Error(appointmentResult.error.message);

    const usage = (usageResult.data ?? []) as UsageRow[];
    const inbound = (inboundResult.data ?? []) as InboundRow[];
    const appointments = (appointmentResult.data ?? []) as AppointmentRow[];
    const openAiUsage = usage.filter((event) => event.provider === "openai");
    const metaUsage = usage.filter((event) => event.provider === "meta");
    const voiceUsage = usage.filter((event) => event.provider === "sip");
    const endedCalls = voiceUsage.filter(
      (event) => event.event_type === "call_ended"
    );
    const agentAppointments = appointments.filter(
      (appointment) =>
        appointment.status !== "cancelled" &&
        (appointment.channel === "whatsapp" || appointment.channel === "voice")
    );

    const metrics = {
      periodStart,
      inboundMessages: inbound.length,
      processedMessages: inbound.filter((event) => event.status === "processed")
        .length,
      repliesSent: inbound.filter((event) => event.delivery_status === "sent")
        .length,
      failures: inbound.filter(
        (event) =>
          event.status === "failed" || event.delivery_status === "failed"
      ).length,
      agentAppointments: agentAppointments.length,
      whatsappAppointments: agentAppointments.filter(
        (appointment) => appointment.channel === "whatsapp"
      ).length,
      voiceAppointments: agentAppointments.filter(
        (appointment) => appointment.channel === "voice"
      ).length,
      openAiCalls: openAiUsage.filter(
        (event) => event.event_type === "language_turn"
      ).length,
      inputTokens: openAiUsage.reduce(
        (total, event) => total + numeric(event.input_units),
        0
      ),
      outputTokens: openAiUsage.reduce(
        (total, event) => total + numeric(event.output_units),
        0
      ),
      openAiCostMicrousd: openAiUsage
        .filter((event) => event.currency === "USD")
        .reduce(
          (total, event) => total + numeric(event.cost_microunits),
          0
        ),
      metaMessages: metaUsage.filter(
        (event) => event.event_type === "service_reply"
      ).length,
      metaCostMicroeur: metaUsage
        .filter((event) => event.currency === "EUR")
        .reduce(
          (total, event) => total + numeric(event.cost_microunits),
          0
        ),
      voiceCalls: endedCalls.length,
      voiceSeconds: Math.round(
        endedCalls.reduce(
          (total, event) => total + numeric(event.duration_ms),
          0
        ) / 1_000
      ),
      voiceCostMicrousd: voiceUsage
        .filter((event) => event.currency === "USD")
        .reduce(
          (total, event) => total + numeric(event.cost_microunits),
          0
        )
    };

    return noStore({
      control,
      configuration: getAssistantStatus(),
      metrics,
      recentUsage: usage.slice(0, 16)
    });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return noStore({ error: error.message }, 503);
    }
    console.error("assistant_control_read_failed", error);
    return noStore(
      { error: "Non è stato possibile leggere lo stato dell’agente." },
      500
    );
  }
}

export async function PATCH(request: NextRequest) {
  if (!isAuthorizedAdminRequest(request)) {
    return noStore({ error: "Accesso non autorizzato." }, 401);
  }

  try {
    const payload = (await request.json()) as Record<string, unknown>;
    const patch: {
      agentEnabled?: boolean;
      whatsappEnabled?: boolean;
      voiceEnabled?: boolean;
    } = {};

    for (const key of [
      "agentEnabled",
      "whatsappEnabled",
      "voiceEnabled"
    ] as const) {
      if (key in payload) {
        if (typeof payload[key] !== "boolean") {
          return noStore({ error: `Valore non valido per ${key}.` }, 400);
        }
        patch[key] = payload[key] as boolean;
      }
    }

    if (Object.keys(patch).length === 0) {
      return noStore({ error: "Nessuna modifica richiesta." }, 400);
    }

    const configuration = getAssistantStatus();
    if (patch.whatsappEnabled === true && !configuration.whatsapp) {
      return noStore(
        { error: "Completa prima il collegamento WhatsApp Meta." },
        409
      );
    }
    if (patch.voiceEnabled === true && !configuration.phoneVoice) {
      return noStore(
        { error: "Completa prima il collegamento del numero telefonico." },
        409
      );
    }

    const supabase = getServerSupabase();
    const current = await getAssistantControl({
      supabase,
      businessSlug: businessSlug()
    });
    const nextWhatsapp = patch.whatsappEnabled ?? current.whatsappEnabled;
    const nextVoice = patch.voiceEnabled ?? current.voiceEnabled;
    if (
      patch.agentEnabled === true &&
      !(
        (nextWhatsapp && configuration.whatsapp) ||
        (nextVoice && configuration.phoneVoice)
      )
    ) {
      return noStore(
        { error: "Collega almeno un canale reale prima di attivare l’agente." },
        409
      );
    }

    const control = await updateAssistantControl({
      supabase,
      businessSlug: businessSlug(),
      patch
    });

    return noStore({ control, configuration });
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return noStore({ error: error.message }, 503);
    }
    const message = error instanceof Error ? error.message : "";
    if (message === "ASSISTANT_CONTROL_MIGRATION_REQUIRED") {
      return noStore(
        { error: "Aggiornamento database del pannello non ancora applicato." },
        503
      );
    }
    if (message === "ASSISTANT_BUSINESS_INACTIVE") {
      return noStore({ error: "L’attività risulta disattivata." }, 409);
    }
    console.error("assistant_control_update_failed", error);
    return noStore(
      { error: "Non è stato possibile modificare lo stato dell’agente." },
      500
    );
  }
}
